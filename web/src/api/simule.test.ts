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
      engagements: ['travail'],
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

describe('API simulée : phase et actions', () => {
  it('journée : les deux actions sont libres ; engagements de demain avec leurs droits', async () => {
    const statut = await simulation().api.statut();
    expect(statut.phase).toBe('journee');
    expect(statut.actions).toEqual({
      je_vais_dormir: { disponible: true, motif: null },
      decaler_coucher: { mode: 'libre', motif: null },
    });
    expect(statut.engagements_demain).toEqual([
      { id: 'sport', nom: 'Sport', reveil: '2026-11-04T04:30:00Z', heure: '2026-11-04T05:00:00Z', annulable: true, decalable: true, origine: 'routine' },
      { id: 'travail', nom: 'Travail', reveil: '2026-11-04T05:30:00Z', heure: '2026-11-04T05:30:00Z', annulable: false, decalable: false, origine: 'routine' },
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

  it('chaque phase a ses faits : matin verrouillé, travail après l’ouverture, nuit certaine', async () => {
    const enPhase = (phase: 'journee' | 'soiree' | 'nuit') =>
      creerApiSimulee({ maintenant: () => MARDI_15H, fuseau: 'Europe/Paris', phase }).statut();
    const journee = await enPhase('journee');
    expect(journee.appareil_principal).toBe('pc_linux');
    expect(journee.appareils.map((a) => [a.appareil, a.mode, a.sortie?.certaine])).toEqual([
      ['pc_linux', 'MORNING_LOCK', false],
      ['pc_windows', 'MORNING_LOCK', false],
      ['iphone', 'WORK', false],
    ]);
    expect(journee.appareils[0]?.sortie).toEqual({ texte: 'Dès que le planning du jour est fait', certaine: false, au_plus_tard: '2026-11-03T20:30:00Z' });
    expect(journee.appareils[0]?.parcours?.find((e) => e.actif)?.mode).toBe('MORNING_LOCK');

    const soiree = await enPhase('soiree');
    expect(soiree.phase).toBe('soiree');
    expect(soiree.appareils[0]).toMatchObject({ mode: 'WORK', sortie: { texte: 'Dès que les 2 tâches P1/P2 restantes sont faites', certaine: false } });
    const evening = soiree.appareils[0]?.parcours?.find((e) => e.mode === 'EVENING_FREE');
    expect(evening?.conditions.map((c) => [c.type, c.vraie, c.detail])).toEqual([
      ['heure', true, 'report de 20 min compris'],
      ['prioritaires', false, '2 restantes'],
      ['recap', true, null],
    ]);

    const nuit = await enPhase('nuit');
    expect(nuit.appareils[0]).toMatchObject({
      mode: 'NIGHT_LOCK',
      sortie: { texte: 'Au lever de 05:30', certaine: true, au_plus_tard: '2026-11-04T04:30:00Z' },
    });
  });

  it('refuse de retirer un engagement non annulable', async () => {
    const prix = await simulation().api.prixException({ demande: { type: 'retire', date: '2026-11-04', engagement: 'travail' } });
    expect(prix.admissible).toBe(false);
    expect(prix.motifRefus).toContain('annulable');
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
      pc_linux: [false, "sessions interdites : NIGHT_LOCK jusqu'à 05:30"],
      pc_windows: [false, 'aucun compte de travail sur ce PC'],
      iphone: [false, "sessions interdites : NIGHT_LOCK jusqu'à 05:30"],
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
  it('avant l’ouverture : sans friction, plafonné par le sommeil minimum', async () => {
    const { api } = simulation();
    const refuse = await api.prixException({ demande: { type: 'coucher', nuit: '2026-11-03', heure: '23:00' } });
    expect(refuse).toMatchObject({ admissible: false, friction: 'aucune', resserre: false });
    expect(refuse.motifRefus).toContain('minimum');

    const accepte = await api.prixException({ demande: { type: 'coucher', nuit: '2026-11-03', heure: '22:00' } });
    expect(accepte).toMatchObject({
      admissible: true,
      friction: 'aucune',
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
    expect(await sim.api.prixException({ demande })).toMatchObject({ admissible: true, friction: 'raison_phrase' });

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
    expect(prix.motifRefus).toContain('piscine');
  });
});
