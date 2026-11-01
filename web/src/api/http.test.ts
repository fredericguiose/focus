import { describe, expect, it, vi } from 'vitest';

import { ErreurFocus } from './erreur';
import { creerApiHttp } from './http';

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
      actions: { je_vais_dormir: { disponible: true, motif: null }, decaler_coucher: { mode: 'libre', motif: null } },
      engagements_demain: [
        { id: 'salle', nom: 'Salle', reveil: '2026-11-04T08:30:00Z', heure: '2026-11-04T09:00:00Z', annulable: true, decalable: false, origine: 'routine' },
      ],
      nuits: [{ nuit: '2026-11-02', dette_min: 30, dette_reelle_min: 45, endormi_min: 435, phases: { legere: 250, profonde: 90, rem: 95, eveil: 20 }, incomplete: true }],
      dette_cumulee_min: 30,
      dette_cumulee_reelle_min: 45,
      sommeil_mesure: { derniere_synchro: '2026-11-03T13:00:00Z', erreur: null },
      objectif_sommeil_min: 480,
    };
    const statut = await creerApiHttp('j', '', vi.fn<typeof fetch>(async () => reponse(200, JSON.stringify(corps)))).statut();
    expect(statut.phase).toBe('journee');
    expect(statut.actions?.decaler_coucher.mode).toBe('libre');
    expect(statut.engagements_demain?.[0]).toMatchObject({ id: 'salle', annulable: true, decalable: false });
    expect(statut.appareils[0]?.jusqua).toBe('2026-11-03T23:20:00Z');
    // API sans session_possible : repli sur `sessions`.
    expect(statut.appareils[0]).toMatchObject({ session_possible: true, session_motif: null });
    expect(statut.dette_cumulee_min).toBe(30);
    expect(statut.dette_cumulee_reelle_min).toBe(45);
    expect(statut.nuits?.[0]).toMatchObject({ dette_reelle_min: 45, endormi_min: 435, incomplete: true, phases: { profonde: 90 } });
    expect(statut.objectif_sommeil_min).toBe(480);
    expect(statut.sommeil_mesure?.erreur).toBeNull();
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
