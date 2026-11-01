import { describe, expect, it, vi } from 'vitest';

import { CLES_APPAREIL, CLES_JOURNEE, CLES_STATUT } from '../../../api/src/cles-statut';
import { ErreurFocus } from './erreur';
import { type StatutFil, statutDepuisFil } from './fil';
import { creerApiHttp } from './http';
import { modeAuthentification } from './mode';

function reponse(statut: number, corps: string) {
  return new Response(corps, { status: statut, headers: { 'Content-Type': 'application/json' } });
}

describe('client HTTP', () => {
  it('envoie le jeton et le corps JSON', async () => {
    const recuperer = vi.fn<typeof fetch>(async () => reponse(200, '{"ok":true}'));
    const api = creerApiHttp('jeton-secret', 'https://api.exemple', recuperer);
    await api.repondre('s/1', { question_id: 'q_1', reponse: 'arrete' });
    const [url, init] = recuperer.mock.calls[0] ?? [];
    expect(url).toBe('https://api.exemple/v1/sessions/s%2F1/reponse');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer jeton-secret');
    expect(init?.body).toBe('{"question_id":"q_1","reponse":"arrete"}');
  });

  it('remonte { erreur, message } tel quel', async () => {
    const recuperer = vi.fn<typeof fetch>(async () => reponse(409, '{"erreur":"trop_tot","message":"Trop tôt : attendez encore 3 s."}'));
    const echec = creerApiHttp('j', '', recuperer).statut();
    await expect(echec).rejects.toBeInstanceOf(ErreurFocus);
    await expect(echec).rejects.toMatchObject({ erreur: 'trop_tot', message: 'Trop tôt : attendez encore 3 s.', statutHttp: 409 });
  });

  it('donne un message lisible pour une erreur sans corps JSON', async () => {
    const recuperer = vi.fn<typeof fetch>(async () => new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(creerApiHttp('j', '', recuperer).taches()).rejects.toMatchObject({ erreur: 'http_502', message: 'Erreur HTTP 502.' });
  });

  it('signale une API injoignable', async () => {
    const recuperer = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(creerApiHttp('j', '', recuperer).statut()).rejects.toMatchObject({ erreur: 'reseau' });
  });
});

describe('format réel de l’API', () => {
  it('convertit /v1/statut (snake_case, dernier_ping) et écarte les sessions fermées', async () => {
    const corps = {
      heure_serveur: '2026-11-03T21:00:00Z',
      config_version: 'abc1234',
      journee: {
        date: '2026-11-03',
        routine: 'cours',
        fuseau: 'America/Cayenne',
        engagements: ['salle'],
        lever: '2026-11-03T09:00:00Z',
        lever_suivant: '2026-11-04T09:00:00Z',
        coucher_prevu: '2026-11-04T01:00:00Z',
        coucher_applique: '2026-11-04T01:00:00Z',
        ouverture: '2026-11-03T23:20:00Z',
        prix_du_report_min: 20,
        dette_nuit_min: 0,
        decision_de_nuit_prise: false,
      },
      appareils: [
        {
          nom: 'pc_linux',
          type: 'pc_linux',
          mode: 'WORK',
          sessions: 'autorisees',
          raison: 'WORK',
          actions: { bloquer_domaines: ['youtube.com'], verrouiller_session: false, fermer_comptes_hors_travail: true },
          dernier_ping: '2026-11-03T20:58:00Z',
        },
        {
          nom: 'pc_windows', type: 'pc_windows', mode: 'WORK', sessions: 'autorisees', raison: 'WORK',
          session_possible: false, session_motif: 'aucun compte de travail sur ce PC', dernier_ping: null,
        },
      ],
      sessions: [
        { id: 's1', tache: { id: '1', nom: 'DM' }, appareil: 'pc_linux', apps: ['youtube'], domaines: ['youtube.com'], ouverte_le: '2026-11-03T20:00:00Z', fermee_le: null, question: null },
        { id: 's0', tache: null, appareil: 'pc_linux', apps: [], ouverte_le: '2026-11-03T19:00:00Z', fermee_le: '2026-11-03T19:30:00Z', question: null },
      ],
      sessions_du_jour: { cumul_min: 30, plafond_min: 180 },
    };
    const statut = await creerApiHttp('j', '', vi.fn<typeof fetch>(async () => reponse(200, JSON.stringify(corps)))).statut();
    expect(statut.journee.coucherApplique).toBe('2026-11-04T01:00:00Z');
    expect(statut.journee.prixDuReportMin).toBe(20);
    expect(statut.appareils[0]).toMatchObject({ appareil: 'pc_linux', vu_le: '2026-11-03T20:58:00Z' });
    expect(statut.appareils[1]).toMatchObject({ session_possible: false, session_motif: 'aucun compte de travail sur ce PC' });
    expect(statut.sessions.map((s) => s.id)).toEqual(['s1']);
    expect(statut.sessions_du_jour).toEqual({ cumul_min: 30, plafond_min: 180 });
  });

  it('lit appareil_principal, parcours et sortie quand l’API les donne', async () => {
    const parcours = [
      { mode: 'WORK', nom: 'Travail', applicable: true, actif: true, logique: 'simple', conditions: [{ type: 'toujours', libelle: 'Par défaut', vraie: true, detail: null, a: null }] },
    ];
    const sortie = { texte: 'Dès que le planning est fait', certaine: false, au_plus_tard: '2026-11-04T01:00:00Z' };
    const corps = {
      heure_serveur: '2026-11-03T21:00:00Z',
      config_version: null,
      appareil_principal: 'pc_linux',
      journee: {
        date: '2026-11-03', routine: 'cours', fuseau: 'America/Cayenne', engagements: [],
        lever: '2026-11-03T09:00:00Z', lever_suivant: '2026-11-04T09:00:00Z', coucher_prevu: '2026-11-04T01:00:00Z',
        coucher_applique: '2026-11-04T01:00:00Z', ouverture: '2026-11-03T23:20:00Z', prix_du_report_min: 0,
        dette_nuit_min: 0, decision_de_nuit_prise: false,
      },
      appareils: [{ nom: 'pc_linux', type: 'pc_linux', mode: 'WORK', sessions: 'autorisees', raison: 'WORK', dernier_ping: null, parcours, sortie }],
      sessions: [],
    };
    const statut = await creerApiHttp('j', '', vi.fn<typeof fetch>(async () => reponse(200, JSON.stringify(corps)))).statut();
    expect(statut.appareil_principal).toBe('pc_linux');
    expect(statut.appareils[0]?.parcours).toEqual(parcours);
    expect(statut.appareils[0]?.sortie).toEqual(sortie);
  });

  it('lit phase, actions, engagements_demain et jusqua quand l’API les donne', async () => {
    const corps = {
      heure_serveur: '2026-11-03T21:00:00Z',
      config_version: 'abc1234',
      journee: {
        date: '2026-11-03', routine: 'cours', fuseau: 'America/Cayenne', engagements: [],
        lever: '2026-11-03T09:00:00Z', lever_suivant: '2026-11-04T09:00:00Z', coucher_prevu: '2026-11-04T01:00:00Z',
        coucher_applique: '2026-11-04T01:00:00Z', ouverture: '2026-11-03T23:20:00Z', prix_du_report_min: 0,
        dette_nuit_min: 0, decision_de_nuit_prise: false,
      },
      appareils: [{ nom: 'pc_linux', type: 'pc_linux', mode: 'WORK', sessions: 'autorisees', raison: 'WORK', dernier_ping: null, jusqua: '2026-11-03T23:20:00Z' }],
      sessions: [],
      phase: 'journee',
      actions: { je_vais_dormir: { disponible: true, motif: null }, decaler_coucher: { mode: 'raison', motif: null } },
      engagements_demain: [
        { id: 'salle', nom: 'Salle', reveil: '2026-11-04T08:30:00Z', heure: '2026-11-04T09:00:00Z', obligatoire: false, sans_heure: false, origine: 'routine' },
      ],
      nuits: [{ nuit: '2026-11-02', dette_min: 30, dette_reelle_min: 45, endormi_min: 435, phases: { legere: 250, profonde: 90, rem: 95, eveil: 20 }, incomplete: true }],
      dette_cumulee_min: 30,
      dette_semaine: { debut: '2026-11-02', fin: '2026-11-08', dette_min: 45, rattrape_min: 40, reste_min: 5, nuits_restantes: 6, nuits_mesurees: 1, nuits_total: 1 },
      bilans_semaines: [{ debut: '2026-10-26', fin: '2026-11-01', dette_min: 313, rattrape_min: 120, non_rattrape_min: 193, nuits_mesurees: 7, nuits_total: 7 }],
      sommeil_mesure: { derniere_synchro: '2026-11-03T13:00:00Z', erreur: null },
      objectif_sommeil_min: 480,
      siestes_total_min: 40,
      siestes_du_jour: [{ debut: '2026-11-03T18:00:00Z', fin: '2026-11-03T18:45:00Z', minutes: 40 }],
      siestes_du_jour_min: 40,
      sieste_tardive: { fin: '2026-11-03T18:45:00Z', coucher: '2026-11-04T01:00:00Z' },
      levers: { jours: [{ date: '2026-11-03', fuseau: 'Europe/Paris', prevu: '2026-11-03T09:30:00Z', prevu_fige: true, mesure: '2026-11-03T09:40:00Z', ecart_min: 10 }], amplitude_min: 0, limite_min: 120 },
      couchers: { nuits: [{ nuit: '2026-11-02', fuseau: 'Europe/Paris', prevu: '2026-11-03T01:00:00Z', prevu_fige: true, mesure: '2026-11-03T03:00:00Z', ecart_min: 120 }], amplitude_min: 0, limite_min: 120 },
      todoist: {
        dernier_changement: '2026-11-03T20:00:00Z',
        etiquettes_verifiees_le: '2026-11-03T10:00:00Z',
        etiquettes_manquantes: ['planning'],
        etiquettes_manquantes_detail: [{ etiquette: 'planning', usages: ['planning', 'exclusion'], modes: [] }],
      },
      taches_bloquantes: {
        prioritaires: { total: 4, taches: [{ id: '6XR4GqQQCW6Gv9h4', titre: 'Envoyer le devis', priorite: 'p1', echeance: '2026-11-01', en_retard: true }] },
        retard: { total: 0, taches: [] },
      },
    };
    const statut = await creerApiHttp('j', '', vi.fn<typeof fetch>(async () => reponse(200, JSON.stringify(corps)))).statut();
    expect(statut.phase).toBe('journee');
    expect(statut.actions?.decaler_coucher.mode).toBe('raison');
    expect(statut.engagements_demain?.[0]).toMatchObject({ id: 'salle', obligatoire: false, sans_heure: false });
    expect(statut.appareils[0]?.jusqua).toBe('2026-11-03T23:20:00Z');
    // API sans session_possible : repli sur `sessions`.
    expect(statut.appareils[0]).toMatchObject({ session_possible: true, session_motif: null });
    expect(statut.dette_cumulee_min).toBe(30);
    expect(statut.dette_semaine).toMatchObject({ reste_min: 5, nuits_restantes: 6 });
    expect(statut.bilans_semaines?.[0]).toMatchObject({ debut: '2026-10-26', non_rattrape_min: 193 });
    expect(statut.nuits?.[0]).toMatchObject({ dette_reelle_min: 45, endormi_min: 435, incomplete: true, phases: { profonde: 90 } });
    expect(statut.objectif_sommeil_min).toBe(480);
    expect(statut.sommeil_mesure?.erreur).toBeNull();
    expect(statut).toMatchObject({ siestes_total_min: 40, siestes_du_jour_min: 40, sieste_tardive: { coucher: '2026-11-04T01:00:00Z' } });
    expect(statut.siestes_du_jour).toHaveLength(1);
    // Oubliés un temps par la conversion : la carte Régularité restait vide avec la vraie API.
    expect(statut.levers?.jours[0]).toMatchObject({ date: '2026-11-03', ecart_min: 10 });
    expect(statut.couchers?.nuits[0]).toMatchObject({ nuit: '2026-11-02', ecart_min: 120 });
    // Fuseau de chaque jour et de chaque nuit (voyage) : les heures se lisent dans celui-là.
    expect(statut.levers?.jours[0]?.fuseau).toBe('Europe/Paris');
    expect(statut.couchers?.nuits[0]?.fuseau).toBe('Europe/Paris');
    expect(statut.todoist).toEqual(corps.todoist);
    expect(statut.taches_bloquantes).toEqual(corps.taches_bloquantes);
  });

  it('reprend apps_bloquees de /v1/statut sans interroger /v1/blocage', async () => {
    const corps = {
      heure_serveur: '2026-11-03T21:00:00Z',
      config_version: 'abc1234',
      journee: {
        date: '2026-11-03', routine: 'cours', fuseau: 'America/Cayenne', engagements: [],
        lever: '2026-11-03T09:00:00Z', lever_suivant: '2026-11-04T09:00:00Z', coucher_prevu: '2026-11-04T01:00:00Z',
        coucher_applique: '2026-11-04T01:00:00Z', ouverture: '2026-11-03T23:20:00Z',
        prix_du_report_min: 0, dette_nuit_min: 0, decision_de_nuit_prise: false,
      },
      appareils: [
        {
          nom: 'pc_linux', type: 'pc_linux', mode: 'WORK', sessions: 'autorisees', raison: 'WORK',
          actions: { bloquer_domaines: ['youtube.com'], verrouiller_session: false, fermer_comptes_hors_travail: true },
          apps_bloquees: [{ id: 'youtube', nom: 'YouTube', domaines: ['youtube.com'], iphone: 'com.google.ios.youtube' }],
          dernier_ping: null,
        },
      ],
      sessions: [],
    };
    const recuperer = vi.fn<typeof fetch>(async () => reponse(200, JSON.stringify(corps)));
    const api = creerApiHttp('j', '', recuperer);
    const statut = await api.statut();
    expect(await api.appsBloquees(statut.appareils[0]!)).toEqual([
      { id: 'youtube', nom: 'YouTube', domaines: ['youtube.com'], iphone: 'com.google.ios.youtube' },
    ]);
    expect(recuperer).toHaveBeenCalledTimes(1);
  });

  it('envoie une exception à plat et lit le prix', async () => {
    const prix = {
      admissible: false,
      motif_refus: 'Sommeil trop court.',
      friction: 'raison_phrase',
      resserre: false,
      coucher_avant: 'a',
      coucher_apres: 'b',
      lever_avant: 'c',
      lever_apres: 'd',
      dette_avant_min: 0,
      dette_apres_min: 60,
    };
    const recuperer = vi.fn<typeof fetch>(async () => reponse(200, JSON.stringify({ demande: {}, prix })));
    const api = creerApiHttp('j', '', recuperer);
    const resultat = await api.prixException({
      demande: { type: 'ajoute', date: '2026-11-04', libelle: 'Oral', heure: '08:00', preparationMin: 45 },
      friction: { raison: 'r', phrase: 'p' },
    });
    expect(JSON.parse(String(recuperer.mock.calls[0]?.[1]?.body))).toEqual({
      type: 'ajoute',
      date: '2026-11-04',
      libelle: 'Oral',
      heure: '08:00',
      preparation_min: 45,
      raison: 'r',
      phrase: 'p',
    });
    expect(resultat).toMatchObject({ admissible: false, motifRefus: 'Sommeil trop court.', detteApresMin: 60 });
    expect(resultat.frictionManquante).toBeUndefined();
    recuperer.mockResolvedValueOnce(
      reponse(200, JSON.stringify({ demande: {}, prix: { ...prix, friction: 'raison', friction_manquante: true, motif_refus: 'raison manquante' } })),
    );
    expect(await api.prixException({ demande: { type: 'coucher', nuit: '2026-11-03', heure: '22:00' } })).toMatchObject({
      friction: 'raison',
      frictionManquante: true,
    });
    await api.prixException({ demande: { type: 'decale', date: '2026-11-04', engagement: 'salle', heure: '07:00', preparationMin: 15 } });
    expect(JSON.parse(String(recuperer.mock.calls[2]?.[1]?.body))).toEqual({
      type: 'decale',
      date: '2026-11-04',
      engagement: 'salle',
      heure: '07:00',
      preparation_min: 15,
    });
  });

  it('retrouve les apps bloquées par /v1/blocage', async () => {
    const apps: Record<string, { id: string; nom: string } | null> = {
      'youtube.com': { id: 'youtube', nom: 'YouTube' },
      'www.youtube.com': { id: 'youtube', nom: 'YouTube' },
      'chatgpt.com': { id: 'chatgpt', nom: 'ChatGPT' },
      'inconnu.example': null,
    };
    const recuperer = vi.fn<typeof fetch>(async (url) => {
      const domaine = new URL(String(url), 'https://x').searchParams.get('domaine') ?? '';
      return reponse(200, JSON.stringify({ app: apps[domaine] ?? null }));
    });
    const liste = await creerApiHttp('j', '', recuperer).appsBloquees({
      appareil: 'pc_linux',
      type: 'pc_linux',
      mode: 'WORK',
      raison: '',
      sessions: 'autorisees',
      session_possible: true,
      session_motif: null,
      vu_le: null,
      actions: { bloquer_domaines: Object.keys(apps), verrouiller_session: false, fermer_comptes_hors_travail: true },
    });
    expect(liste).toEqual([
      { id: 'chatgpt', nom: 'ChatGPT', domaines: ['chatgpt.com'] },
      { id: 'youtube', nom: 'YouTube', domaines: expect.arrayContaining(['youtube.com', 'www.youtube.com']) as string[] },
    ]);
    expect(String(recuperer.mock.calls[0]?.[0])).toBe('/v1/blocage?appareil=pc_linux&domaine=youtube.com');
  });
});

// Leçon du 01/11 : un champ oublié dans `statutDepuisFil` disparaît avec la vraie API, alors que le
// mode simulé (qui ne passe pas par fil.ts) et ses tests restent verts. Les listes de champs sont
// celles de l'API (api/src/cles-statut.ts), vérifiées par un test API sur une réponse réelle.
describe('conversion du statut : aucun champ de l’API perdu', () => {
  const appareil: Required<StatutFil['appareils'][number]> = {
    nom: 'pc_linux',
    type: 'pc_linux',
    mode: 'WORK',
    sessions: 'autorisees',
    session_possible: true,
    session_motif: 'motif',
    raison: 'WORK',
    actions: { bloquer_domaines: [], verrouiller_session: false, fermer_comptes_hors_travail: false },
    apps_bloquees: [],
    groupes_bloques: [],
    dernier_ping: '2026-11-03T20:58:00Z',
    jusqua: '2026-11-03T23:20:00Z',
    parcours: [],
    sortie: { texte: 'x', certaine: false, au_plus_tard: '2026-11-04T01:00:00Z' },
  };
  // `Required` : le compilateur exige ici chaque champ déclaré dans StatutFil.
  const fil: Required<StatutFil> = {
    heure_serveur: '2026-11-03T21:00:00Z',
    config_version: 'abc1234',
    journee: {
      date: '2026-11-03', routine: 'cours', fuseau: 'America/Cayenne', engagements: [],
      lever: '2026-11-03T09:00:00Z', lever_suivant: '2026-11-04T09:00:00Z', coucher_prevu: '2026-11-04T01:00:00Z',
      coucher_applique: '2026-11-04T01:00:00Z', ouverture: '2026-11-03T23:20:00Z', prix_du_report_min: 0,
      dette_nuit_min: 0, decision_de_nuit_prise: false,
    },
    appareils: [appareil],
    appareil_principal: 'pc_linux',
    sessions: [],
    sessions_du_jour: { cumul_min: 0, plafond_min: 180 },
    nuits: [],
    dette_cumulee_min: 0,
    dette_semaine: { debut: '2026-11-02', fin: '2026-11-08', dette_min: 0, rattrape_min: 0, reste_min: 0, nuits_restantes: 6, nuits_mesurees: 1, nuits_total: 1 },
    bilans_semaines: [],
    levers: { jours: [], amplitude: null, limite_min: 120 },
    couchers: { nuits: [], amplitude: null, limite_min: 120 },
    sommeil_mesure: null,
    objectif_sommeil_min: 480,
    siestes_total_min: 0,
    siestes_du_jour: [],
    siestes_du_jour_min: 0,
    sieste_tardive: null,
    phase: 'journee',
    actions: { je_vais_dormir: { disponible: true, motif: null }, decaler_coucher: { mode: 'raison', motif: null } },
    engagements_demain: [],
    aujourdhui: '2026-11-03',
    engagements_verifies: [],
    sautes_semaine: 0,
    seances_mesurees: null,
    todoist: { dernier_changement: null, etiquettes_verifiees_le: null, etiquettes_manquantes: [] },
    taches_bloquantes: { prioritaires: { total: 0, taches: [] }, retard: { total: 0, taches: [] } },
  };
  /** Champs renommés par la conversion (nom de l'API → nom de l'interface). */
  const RENOMMES_APPAREIL: Record<string, string> = { nom: 'appareil', dernier_ping: 'vu_le' };
  const camel = (k: string) => k.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());

  it('StatutFil déclare chaque champ de premier niveau de l’API, et la conversion le reprend', () => {
    const converti = statutDepuisFil(fil) as unknown as Record<string, unknown>;
    // Sans exception à ce jour : tout ajout ici doit être une décision, pas un oubli.
    const EXCEPTIONS: string[] = [];
    const absentsDuFil = CLES_STATUT.filter((k) => !(k in fil));
    const perdus = CLES_STATUT.filter((k) => !EXCEPTIONS.includes(k) && !(k in converti));
    expect({ absentsDuFil, perdus }).toEqual({ absentsDuFil: [], perdus: [] });
  });

  it('POST /v1/actualiser : sans corps ni jeton, même conversion que /v1/statut', async () => {
    const recuperer = vi.fn<typeof fetch>(async () => reponse(200, JSON.stringify(fil)));
    const actualise = await creerApiHttp(null, '', recuperer).actualiser();
    const [url, init] = recuperer.mock.calls[0] ?? [];
    expect(url).toBe('/v1/actualiser');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
    expect(actualise).toEqual(statutDepuisFil(fil));
  });

  it('POST /v1/actualiser : Todoist en panne, l’erreur remonte telle quelle', async () => {
    const recuperer = vi.fn<typeof fetch>(async () => reponse(502, '{"erreur":"todoist_indisponible","message":"Todoist ne répond pas : tâches non synchronisées."}'));
    await expect(creerApiHttp(null, '', recuperer).actualiser()).rejects.toMatchObject({ erreur: 'todoist_indisponible', statutHttp: 502 });
  });

  it('la journée et chaque appareil gardent tous leurs champs', () => {
    const converti = statutDepuisFil(fil);
    const journee = converti.journee as unknown as Record<string, unknown>;
    expect(CLES_JOURNEE.filter((k) => !(k in fil.journee) || !(camel(k) in journee))).toEqual([]);
    const a = converti.appareils[0] as unknown as Record<string, unknown>;
    expect(CLES_APPAREIL.filter((k) => !(k in appareil) || !((RENOMMES_APPAREIL[k] ?? k) in a))).toEqual([]);
  });
});

describe('sans jeton (Cloudflare Access ou utilisateur local)', () => {
  it('n’envoie pas d’en-tête Authorization et envoie les cookies de même origine', async () => {
    const recuperer = vi.fn<typeof fetch>(async () => reponse(200, '{"ok":true}'));
    await creerApiHttp(null, '', recuperer).fermerSession('s1');
    const [, init] = recuperer.mock.calls[0] ?? [];
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(init?.credentials).toBe('same-origin');
  });

  it('modeAuthentification : seul un 401 jeton_absent demande la saisie du jeton', async () => {
    const api = (r: () => Promise<Response>) => creerApiHttp(null, '', vi.fn<typeof fetch>(r));
    const absent = () => Promise.resolve(reponse(401, '{"erreur":"jeton_absent","message":"m"}'));
    expect(await modeAuthentification(api(absent))).toBe('jeton');
    const invalide = () => Promise.resolve(reponse(401, '{"erreur":"jeton_invalide","message":"m"}'));
    expect(await modeAuthentification(api(invalide))).toBe('sans_jeton');
    const refuse = () => Promise.resolve(reponse(403, '{"erreur":"utilisateur_inconnu","message":"m"}'));
    expect(await modeAuthentification(api(refuse))).toBe('sans_jeton');
    const reseau = () => Promise.reject(new TypeError('Failed to fetch'));
    expect(await modeAuthentification(api(reseau))).toBe('sans_jeton');
    // Un succès suffit : le contenu n'est pas lu au-delà de la conversion.
    const ok = { statut: async () => ({}) } as unknown as Parameters<typeof modeAuthentification>[0];
    expect(await modeAuthentification(ok)).toBe('sans_jeton');
  });
});
