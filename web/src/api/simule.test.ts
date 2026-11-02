import { describe, expect, it } from 'vitest';

import { PHRASE_NUIT } from '@/lib/decisionNuit';
import { ErreurFocus } from './erreur';
import { creerApiSimulee } from './simule';

// Mardi 3 novembre 2026, 15:00 à Paris. Lever 06:30 (travail), lever du mercredi 05:30 (sport),
// donc coucher 21:30 et ouverture 19:30 + 20 min de report = 19:50.
const MARDI_15H = Date.parse('2026-11-03T14:00:00Z');

function simulation(depart = MARDI_15H) {
  let t = depart;
  const api = creerApiSimulee({ maintenant: () => t, fuseau: 'Europe/Paris' });
  return {
    api,
    regler: (iso: string) => {
      t = Date.parse(iso);
    },
    avancer: (ms: number) => {
      t += ms;
    },
  };
}

async function erreurDe(promesse: Promise<unknown>): Promise<ErreurFocus> {
  try {
    await promesse;
  } catch (e) {
    if (e instanceof ErreurFocus) return e;
    throw e;
  }
  throw new Error('La promesse aurait dû être rejetée.');
}

describe('API simulée : statut', () => {
  it('calcule la journée avec des horaires fictifs', async () => {
    const { journee, appareils, sessions } = await simulation().api.statut();
    expect(journee).toMatchObject({
      date: '2026-11-03',
      fuseau: 'Europe/Paris',
      engagements: ['travail', 'revisions'],
      lever: '2026-11-03T05:30:00Z',
      leverSuivant: '2026-11-04T04:30:00Z',
      coucherApplique: '2026-11-03T20:30:00Z',
      ouverture: '2026-11-03T18:50:00Z',
      prixDuReportMin: 20,
      detteNuitMin: 0,
      decisionDeNuitPrise: false,
    });
    expect(appareils.map((a) => [a.appareil, a.mode])).toEqual([
      ['pc_linux', 'WORK'],
      ['pc_windows', 'WORK'],
      ['iphone', 'WORK'],
    ]);
    expect(appareils[0]?.vu_le).toBe('2026-11-03T13:59:20Z');
    expect(appareils[0]?.apps_bloquees?.find((a) => a.id === 'chatgpt')?.domaines).toContain('chatgpt.com');
    expect(sessions[0]?.question?.attente_s).toBe(5);
  });

  it('passe en NIGHT_LOCK au coucher, sessions interdites', async () => {
    const sim = simulation();
    sim.regler('2026-11-03T20:30:00Z');
    const { appareils } = await sim.api.statut();
    expect(appareils[0]).toMatchObject({ mode: 'NIGHT_LOCK', sessions: 'interdites' });
  });
});

describe('API simulée : dette de sommeil hebdomadaire', () => {
  it('semaine en cours et 4 bilans, comme l’API', async () => {
    const s = await simulation().api.statut();
    expect(s.dette_semaine).toEqual({
      debut: '2026-11-02', fin: '2026-11-08', dette_min: 82, rattrape_min: 45, reste_min: 37, nuits_restantes: 5, nuits_mesurees: 2, nuits_total: 2,
    });
    expect(s.bilans_semaines?.map((b) => [b.debut, b.non_rattrape_min])).toEqual([
      ['2026-10-26', 255],
      ['2026-10-19', 135],
      ['2026-10-12', 130],
      ['2026-10-05', 0],
    ]);
    expect(s).not.toHaveProperty('dette_cumulee_reelle_min');
  });

  it('scénario « dette » : une dette à rattraper quel que soit le jour, soirée ouverte', async () => {
    for (const jour of ['2026-11-01T14:00:00Z', '2026-11-02T14:00:00Z', '2026-11-03T14:00:00Z']) {
      const s = await creerApiSimulee({ maintenant: () => Date.parse(jour), fuseau: 'Europe/Paris', scenario: 'dette' }).statut();
      expect(s.phase).toBe('soiree');
      expect(s.dette_semaine!.reste_min).toBeGreaterThan(5);
    }
    // Samedi 7 : la vraie semaine fictive, sur cette dernière nuit.
    const samedi = await creerApiSimulee({ maintenant: () => Date.parse('2026-11-07T14:00:00Z'), fuseau: 'Europe/Paris', scenario: 'dette' }).statut();
    expect(samedi.dette_semaine).toMatchObject({ debut: '2026-11-02', nuits_restantes: 1, nuits_total: 6 });
    expect(samedi.dette_semaine!.reste_min).toBeGreaterThan(5);
  });

  it('dimanche soir : la nuit de ce soir ouvre une nouvelle semaine, encore vide', async () => {
    const s = await creerApiSimulee({ maintenant: () => Date.parse('2026-11-01T14:00:00Z'), fuseau: 'Europe/Paris', phase: 'soiree' }).statut();
    expect(s.dette_semaine).toMatchObject({ debut: '2026-11-02', dette_min: 0, reste_min: 0, nuits_restantes: 7, nuits_total: 0 });
    // La semaine qui finit ce matin est close : elle passe dans les bilans.
    expect(s.bilans_semaines?.[0]).toMatchObject({ debut: '2026-10-26', nuits_total: 7 });
    // Le graphique montre ses 7 nuits, de dimanche à lundi (25/10) à samedi à dimanche (31/10).
    expect(s.nuits_semaine?.map((n) => n.nuit)).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
  });

  it('nuits de la semaine affichée : un mercredi, celles de la semaine en cours, même forme que `nuits`', async () => {
    const s = await creerApiSimulee({ maintenant: () => Date.parse('2026-11-04T14:00:00Z'), fuseau: 'Europe/Paris', phase: 'journee' }).statut();
    expect(s.nuits_semaine?.map((n) => n.nuit)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(s.nuits_semaine).toEqual(s.nuits!.slice(-3));
  });
});

describe('API simulée : phase et actions', () => {
  it('journée : « Je vais dormir » libre, décalage sur raison ; engagements de demain, obligatoires ou non', async () => {
    const statut = await simulation().api.statut();
    expect(statut.phase).toBe('journee');
    expect(statut.actions).toEqual({
      je_vais_dormir: { disponible: true, motif: null },
      decaler_coucher: { mode: 'raison', motif: null },
    });
    expect(statut.engagements_demain).toEqual([
      { id: 'sport', nom: 'Sport', reveil: '2026-11-04T04:30:00Z', heure: '2026-11-04T05:00:00Z', obligatoire: true, sans_heure: false, origine: 'routine' },
      { id: 'travail', nom: 'Travail', reveil: '2026-11-04T05:30:00Z', heure: '2026-11-04T05:30:00Z', obligatoire: true, sans_heure: false, origine: 'routine' },
      { id: 'revisions', nom: 'Révisions', reveil: null, heure: null, obligatoire: false, sans_heure: true, origine: 'routine' },
    ]);
    expect(statut.appareils[0]).toMatchObject({ mode: 'WORK', jusqua: '2026-11-03T18:50:00Z' });
  });

  it('soirée : décision de nuit ; une fois prise, indisponible', async () => {
    const sim = simulation();
    sim.regler('2026-11-03T19:00:00Z');
    const avant = await sim.api.statut();
    expect(avant.phase).toBe('soiree');
    expect(avant.appareils[0]).toMatchObject({ mode: 'EVENING_FREE', jusqua: '2026-11-03T20:30:00Z' });
    expect(avant.actions?.decaler_coucher.mode).toBe('decision_de_nuit');
    await sim.api.enregistrerException({
      demande: { type: 'coucher', nuit: '2026-11-03', heure: '22:00' },
      friction: { raison: 'r'.repeat(50), phrase: PHRASE_NUIT },
    });
    const apres = await sim.api.statut();
    expect(apres.actions?.decaler_coucher).toMatchObject({ mode: 'indisponible' });
    expect(apres.actions?.decaler_coucher.motif).toContain('une seule par nuit');
  });

  it('nuit : « Je vais dormir » n’est plus disponible', async () => {
    const sim = simulation();
    sim.regler('2026-11-03T21:00:00Z');
    const statut = await sim.api.statut();
    expect(statut.phase).toBe('nuit');
    expect(statut.actions?.je_vais_dormir.disponible).toBe(false);
    expect(statut.actions?.decaler_coucher.mode).toBe('decision_de_nuit');
  });

  it('l’option `phase` place l’horloge simulée dans la phase demandée', async () => {
    for (const phase of ['journee', 'soiree', 'nuit'] as const) {
      const api = creerApiSimulee({ maintenant: () => MARDI_15H, fuseau: 'Europe/Paris', phase });
      expect((await api.statut()).phase).toBe(phase);
    }
  });

  it('chaque phase a ses faits : journée verrouillée, travail après l’ouverture, nuit certaine', async () => {
    const enPhase = (phase: 'journee' | 'soiree' | 'nuit') =>
      creerApiSimulee({ maintenant: () => MARDI_15H, fuseau: 'Europe/Paris', phase }).statut();
    const journee = await enPhase('journee');
    expect(journee.appareil_principal).toBe('pc_linux');
    expect(journee.appareils.map((a) => [a.appareil, a.mode, a.sortie?.certaine])).toEqual([
      ['pc_linux', 'MORNING_LOCK', false],
      ['pc_windows', 'MORNING_LOCK', false],
      ['iphone', 'WORK', false],
    ]);
    expect(journee.appareils[0]?.sortie).toEqual({ texte: 'dès que le planning du jour est fait', certaine: false, au_plus_tard: '2026-11-03T20:30:00Z' });
    // Motif comme l'API : le mode et le fait qui manque, pas d'identifiant.
    expect(journee.appareils[0]?.session_motif).toBe('Journée verrouillée : planning du jour à faire');
    // Le fait positif, son état réel, et `niee` pour le mode `pas`.
    expect(journee.appareils[0]?.parcours?.find((e) => e.mode === 'MORNING_LOCK')?.conditions).toEqual([
      { type: 'planning', libelle: 'Planning du jour', vraie: false, detail: 'à faire', a: null, niee: true },
    ]);
    expect(journee.appareils[0]?.parcours?.find((e) => e.actif)?.mode).toBe('MORNING_LOCK');

    const soiree = await enPhase('soiree');
    expect(soiree.phase).toBe('soiree');
    expect(soiree.appareils[0]).toMatchObject({ mode: 'WORK', sortie: { texte: 'dès que les tâches P1/P2 sont faites', certaine: false } });
    const evening = soiree.appareils[0]?.parcours?.find((e) => e.mode === 'EVENING_FREE');
    expect(evening?.conditions.map((c) => [c.libelle, c.vraie, c.detail])).toEqual([
      ['Ouverture à 19:50', true, '+20 min de report'],
      ['Tâches P1/P2 faites', false, '2 tâches restantes dont 1 en retard'],
      ["Récap d'hier", true, null],
    ]);
    // Groupes bloqués en WORK sur le PC : Safari n'a pas de domaine, le groupe Navigateurs n'y est pas.
    expect(soiree.appareils[0]?.groupes_bloques?.map((g) => [g.nom, g.apps])).toEqual([
      ['Divertissement', ['youtube', 'x']],
      ['IA conversationnelle', ['chatgpt', 'gemini', 'claude_ai']],
    ]);

    const nuit = await enPhase('nuit');
    expect(nuit.appareils[0]).toMatchObject({
      mode: 'NIGHT_LOCK',
      sortie: { texte: 'au lever, 05:30', certaine: true, au_plus_tard: '2026-11-04T04:30:00Z' },
    });
  });

  it('retirer : obligatoire, une raison ; facultatif, libre', async () => {
    const { api } = simulation();
    expect(await api.prixException({ demande: { type: 'retire', date: '2026-11-04', engagement: 'sport' } })).toMatchObject({
      admissible: false,
      friction: 'raison',
      frictionManquante: true,
    });
    expect(await api.prixException({ demande: { type: 'retire', date: '2026-11-04', engagement: 'revisions' } })).toMatchObject({
      admissible: true,
      friction: 'aucune',
    });
  });

  it('donner une heure à un engagement sans heure : il fixe le réveil, librement', async () => {
    const { api } = simulation();
    const demande = { type: 'decale' as const, date: '2026-11-04', engagement: 'revisions', heure: '04:30' };
    expect(await api.prixException({ demande })).toMatchObject({ admissible: true, friction: 'aucune', resserre: true, leverApres: '2026-11-04T03:00:00Z' });
    await api.enregistrerException({ demande: { ...demande, preparationMin: 15 } });
    expect((await api.statut()).engagements_demain?.find((e) => e.id === 'revisions')).toMatchObject({
      reveil: '2026-11-04T03:15:00Z',
      heure: '2026-11-04T03:30:00Z',
      sans_heure: false,
    });
  });
});

describe('API simulée : sessions', () => {
  it('refuse une tâche créée il y a moins de 15 min', async () => {
    const { api } = simulation();
    const t3 = (await api.taches()).taches.find((t) => t.id === 't3');
    expect(t3?.eligible_le).toBe('2026-11-03T14:10:00Z');
    const e = await erreurDe(api.ouvrirSession({ appareil: 'pc_linux', tache_id: 't3', apps: ['youtube'] }));
    expect(e.erreur).toBe('tache_trop_recente');
  });

  it('ouvre une session puis pose une question', async () => {
    const sim = simulation();
    await sim.api.ouvrirSession({ appareil: 'pc_linux', tache_id: 't2', apps: ['youtube'] });
    let session = (await sim.api.statut()).sessions.find((s) => s.tache?.id === 't2');
    expect(session?.domaines).toEqual(['m.youtube.com', 'www.youtube.com', 'youtu.be', 'youtube.com']);
    expect(session?.question).toBeNull();
    sim.avancer(30_000);
    session = (await sim.api.statut()).sessions.find((s) => s.tache?.id === 't2');
    expect(session?.question).toMatchObject({ attente_s: 0 });
  });

  it('refuse les sessions la nuit', async () => {
    const sim = simulation();
    sim.regler('2026-11-03T21:00:00Z');
    const e = await erreurDe(sim.api.ouvrirSession({ appareil: 'pc_linux', tache_id: 't1', apps: ['youtube'] }));
    expect(e.erreur).toBe('session_impossible');
  });

  it('session possible ou motif, par appareil ; pc_windows (aucun compte de travail) jamais', async () => {
    const sim = simulation();
    const possibilites = async () =>
      Object.fromEntries((await sim.api.statut()).appareils.map((a) => [a.appareil, [a.session_possible, a.session_motif]]));
    expect(await possibilites()).toEqual({
      pc_linux: [true, null],
      pc_windows: [false, 'aucun compte de travail sur ce PC'],
      iphone: [true, null],
    });
    const e = await erreurDe(sim.api.ouvrirSession({ appareil: 'pc_windows', tache_id: 't1', apps: ['youtube'] }));
    expect(e.erreur).toBe('session_impossible');
    sim.regler('2026-11-03T21:00:00Z');
    expect(await possibilites()).toEqual({
      pc_linux: [false, "Nuit jusqu'à 05:30"],
      pc_windows: [false, 'aucun compte de travail sur ce PC'],
      iphone: [false, "Nuit jusqu'à 05:30"],
    });
  });

  it('applique l’attente progressive puis ferme la session sans réponse', async () => {
    const sim = simulation();
    const session = (await sim.api.statut()).sessions[0];
    const question = session?.question;
    if (!session || !question) throw new Error('session de démonstration absente');

    const tot = await erreurDe(sim.api.repondre(session.id, { question_id: question.id, reponse: 'continue' }));
    expect(tot.erreur).toBe('trop_tot');

    sim.avancer(4_000);
    await sim.api.repondre(session.id, { question_id: question.id, reponse: 'continue' });

    sim.avancer(30_000);
    const suivante = (await sim.api.statut()).sessions[0]?.question;
    expect(suivante?.attente_s).toBe(10);

    sim.avancer(71_000);
    expect((await sim.api.statut()).sessions).toHaveLength(0);
  });

  it('« J’arrête » ferme la session tout de suite, même pendant l’attente', async () => {
    const sim = simulation();
    const session = (await sim.api.statut()).sessions[0];
    await sim.api.repondre(session?.id ?? '', { question_id: session?.question?.id ?? '', reponse: 'arrete' });
    expect((await sim.api.statut()).sessions).toHaveLength(0);
  });
});

describe('API simulée : exceptions', () => {
  it('avant l’ouverture : raison seule, plafonné par le sommeil minimum', async () => {
    const { api } = simulation();
    const raison = { raison: 'r'.repeat(50) };
    const refuse = await api.prixException({ demande: { type: 'coucher', nuit: '2026-11-03', heure: '23:00' }, friction: raison });
    expect(refuse).toMatchObject({ admissible: false, friction: 'raison', resserre: false });
    expect(refuse.frictionManquante).toBeUndefined();
    expect(refuse.motifRefus).toContain('minimum');

    const demande = { type: 'coucher', nuit: '2026-11-03', heure: '22:00' } as const;
    expect(await api.prixException({ demande })).toMatchObject({
      admissible: false,
      friction: 'raison',
      frictionManquante: true,
      motifRefus: "raison d'au moins 50 caractères exigée (0 fournis)",
    });
    expect((await erreurDe(api.enregistrerException({ demande }))).erreur).toBe('friction_requise');

    const accepte = await api.prixException({ demande, friction: raison });
    expect(accepte).toMatchObject({
      admissible: true,
      friction: 'raison',
      coucherAvant: '2026-11-03T20:30:00Z',
      coucherApres: '2026-11-03T21:00:00Z',
      detteAvantMin: 0,
      detteApresMin: 30,
    });
  });

  it('resserrer est toujours permis', async () => {
    const sim = simulation();
    sim.regler('2026-11-03T20:00:00Z');
    const prix = await sim.api.prixException({ demande: { type: 'avancer_coucher', nuit: '2026-11-03', a: '2026-11-03T20:00:00Z' } });
    expect(prix).toMatchObject({ admissible: true, resserre: true, friction: 'aucune', detteApresMin: -30 });
  });

  it('après l’ouverture : raison + phrase, une seule fois par nuit', async () => {
    const sim = simulation();
    sim.regler('2026-11-03T19:00:00Z');
    const demande = { type: 'coucher', nuit: '2026-11-03', heure: '22:30' } as const;
    expect(await sim.api.prixException({ demande })).toMatchObject({ admissible: false, friction: 'raison_phrase', frictionManquante: true });

    const sansFriction = await erreurDe(sim.api.enregistrerException({ demande }));
    expect(sansFriction.erreur).toBe('friction_requise');

    await sim.api.enregistrerException({ demande, friction: { raison: 'r'.repeat(50), phrase: PHRASE_NUIT } });
    const { journee } = await sim.api.statut();
    expect(journee.coucherApplique).toBe('2026-11-03T21:30:00Z');
    expect(journee.decisionDeNuitPrise).toBe(true);
    // « $coucher - 2h » suit le coucher appliqué : l'ouverture a reculé à 20:50 (19:50Z).
    expect(journee.ouverture).toBe('2026-11-03T19:50:00Z');

    sim.regler('2026-11-03T20:00:00Z');
    const encore = await sim.api.prixException({ demande: { type: 'coucher', nuit: '2026-11-03', heure: '22:45' } });
    expect(encore.admissible).toBe(false);
    expect(encore.motifRefus).toContain('une seule par nuit');
  });

  it('retirer un engagement inconnu est refusé avec un motif', async () => {
    const { api } = simulation();
    const prix = await api.prixException({ demande: { type: 'retire', date: '2026-11-04', engagement: 'piscine' } });
    expect(prix.admissible).toBe(false);
    expect(prix.motifRefus).toBe("pas d'engagement « Piscine » le 4 nov.");
  });
});

describe('mode simulé : journal des levers', () => {
  it('7 jours finissant aujourd’hui ; mesuré = prévu + écart fictif ; amplitude des mesurés', async () => {
    const s = await simulation().api.statut();
    const levers = s.levers!;
    expect(levers.jours.map((j) => j.date)).toEqual(['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
    expect(levers.jours[0]).toMatchObject({ mesure: null, ecart_min: null });
    // Mardi : lever prévu 06:30 (travail), mesuré 6 min plus tard.
    expect(levers.jours[6]).toEqual({ date: '2026-11-03', fuseau: 'Europe/Paris', prevu: '2026-11-03T05:30:00Z', prevu_fige: true, mesure: '2026-11-03T05:36:00Z', ecart_min: 6 });
    for (const j of levers.jours) if (j.mesure) expect((Date.parse(j.mesure) - Date.parse(j.prevu)) / 60_000).toBe(j.ecart_min);
    expect(levers.amplitude?.mesures).toBe(6);
    expect(levers.limite_min).toBe(120);
  });

  it('couchers : les 7 nuits d’avant ; endormi = prévu + écart fictif ; amplitude comptée depuis midi', async () => {
    const couchers = (await simulation().api.statut()).couchers!;
    expect(couchers.nuits.map((n) => n.nuit)).toEqual(['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(couchers.nuits[0]).toMatchObject({ mesure: null, ecart_min: null });
    for (const n of couchers.nuits) if (n.mesure) expect((Date.parse(n.mesure) - Date.parse(n.prevu)) / 60_000).toBe(n.ecart_min);
    // Dimanche : prévu 21:30 (Paris), endormi 00:55 le lundi ; du plus tôt (22:40) au plus tard : 2 h 15, pas 21 h 45.
    expect(couchers.nuits[5]).toEqual({ nuit: '2026-11-01', fuseau: 'Europe/Paris', prevu: '2026-11-01T20:30:00Z', prevu_fige: true, mesure: '2026-11-01T23:55:00Z', ecart_min: 205 });
    expect(couchers.amplitude).toEqual({ plus_tot: '2026-10-29T21:40:00Z', plus_tard: '2026-11-01T23:55:00Z', ecart_min: 135, mesures: 5 });
    expect(couchers.limite_min).toBe(120);
  });

  it('le lever du jour n’est mesuré qu’une fois passé', async () => {
    const sim = simulation(Date.parse('2026-11-03T05:32:00Z'));
    const s = await sim.api.statut();
    expect(s.levers!.jours.at(-1)).toMatchObject({ date: '2026-11-03', mesure: null });
  });
});
