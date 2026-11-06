// Règle locale de l'extension : mêmes cas que clients/pc/internal/planning (Evaluer).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { echeanceLisible, infoMode, initiale, raisonDetaillee, raisonLisible } from '../src/affichage.ts';
import {
  AGE_MAX_MS,
  type Planning,
  type PlanningRecu,
  type SegmentPlanning,
  type SessionPlanning,
  decider,
  domainesBloques,
  etatQuestion,
  prochainePose,
  questionsDues,
  finDuBlocage,
  validerPlanning,
} from '../src/regles.ts';

const H = 3_600_000;
const T0 = Date.parse('2026-11-01T12:00:00Z');
const iso = (t: number) => new Date(t).toISOString();

function segment(debut: number, fin: number, domaines: string[], extra: Partial<SegmentPlanning> = {}): SegmentPlanning {
  return {
    debut: iso(debut),
    fin: iso(fin),
    mode: 'WORK',
    sessions: 'autorisees',
    actions: { bloquer_domaines: domaines, verrouiller_session: false, fermer_comptes_hors_travail: true },
    ...extra,
  };
}

function session(domaines: string[], extra: Partial<SessionPlanning> = {}): SessionPlanning {
  return { id: 's1', apps: ['youtube'], domaines, question: null, fin_au_plus_tard: null, ...extra };
}

function planning(p: Partial<Planning> = {}): Planning {
  return {
    version: 1,
    appareil: 'pc_linux',
    heure_serveur: iso(T0),
    valable_jusqua: iso(T0 + 4 * H),
    segments: [segment(T0 - H, T0 + 2 * H, ['youtube.com', 'www.youtube.com']), segment(T0 + 2 * H, T0 + 4 * H, [], { mode: 'EVENING_FREE' })],
    sessions: [],
    raison: 'WORK — tâches prioritaires restantes : 2',
    ...p,
  };
}

const recu = (p: Planning, decalageMs = 0, recuLe = T0 - decalageMs): PlanningRecu => ({ planning: p, recuLe, decalageMs });

describe('domainesBloques', () => {
  test('segment en vigueur : début inclus, fin exclue', () => {
    const p = planning();
    assert.deepEqual(domainesBloques(p, T0 - H), ['www.youtube.com', 'youtube.com']);
    assert.deepEqual(domainesBloques(p, T0 + 2 * H - 1), ['www.youtube.com', 'youtube.com']);
    assert.deepEqual(domainesBloques(p, T0 + 2 * H), []);
  });
  test('hors de tout segment : rien ; au-delà de valable_jusqua : expiré (null)', () => {
    const p = planning();
    assert.deepEqual(domainesBloques(p, T0 - 2 * H), []);
    assert.equal(domainesBloques(p, T0 + 4 * H), null);
  });
  test('normalise casse, espaces, point final ; dédoublonne', () => {
    const p = planning({ segments: [segment(T0 - H, T0 + H, [' YouTube.com. ', 'youtube.com', ''])] });
    assert.deepEqual(domainesBloques(p, T0), ['youtube.com']);
  });
  test('une session valide libère ses domaines', () => {
    const p = planning({ sessions: [session(['youtube.com'])] });
    assert.deepEqual(domainesBloques(p, T0), ['www.youtube.com']);
  });
  test('sessions interdites ou écran verrouillé : la session ne libère rien', () => {
    for (const extra of [{ sessions: 'interdites' as const }, { actions: { bloquer_domaines: ['youtube.com'], verrouiller_session: true } }]) {
      const p = planning({ segments: [segment(T0 - H, T0 + H, ['youtube.com'], extra)], sessions: [session(['youtube.com'])] });
      assert.deepEqual(domainesBloques(p, T0), ['youtube.com']);
    }
  });
  test('fin_au_plus_tard atteinte (incluse) : la session ne libère plus', () => {
    const p = planning({ sessions: [session(['youtube.com'], { fin_au_plus_tard: iso(T0 + 1000) })] });
    assert.deepEqual(domainesBloques(p, T0 + 999), ['www.youtube.com']);
    assert.deepEqual(domainesBloques(p, T0 + 1000), ['www.youtube.com', 'youtube.com']);
  });
  test('question expirée : la session ne libère plus', () => {
    const question = { id: 'q1', posee_a: iso(T0 - 1000), attente_s: 60, expire_a: iso(T0 + 1000) };
    const p = planning({ sessions: [session(['youtube.com'], { question })] });
    assert.deepEqual(domainesBloques(p, T0), ['www.youtube.com']);
    assert.deepEqual(domainesBloques(p, T0 + 1000), ['www.youtube.com', 'youtube.com']);
  });
});

describe('decider', () => {
  test('correspondance exacte, comme le fichier hosts', () => {
    const r = recu(planning());
    assert.equal((decider(r, 'youtube.com', T0, null) as { bloque: boolean }).bloque, true);
    assert.equal((decider(r, 'WWW.YouTube.com', T0, null) as { bloque: boolean }).bloque, true);
    assert.equal((decider(r, 'music.youtube.com', T0, null) as { bloque: boolean }).bloque, false);
    assert.equal((decider(r, 'example.com', T0, null) as { bloque: boolean }).bloque, false);
    assert.equal((decider(r, 'mail.google.com', T0, null) as { bloque: boolean }).bloque, false);
  });
  test("l'hôte de l'API n'est jamais bloqué", () => {
    const r = recu(planning({ segments: [segment(T0 - H, T0 + H, ['api-focus.fredericguiose.com'])] }));
    assert.deepEqual(decider(r, 'api-focus.fredericguiose.com', T0, 'api-focus.fredericguiose.com'), {
      utilisable: true,
      bloque: false,
      confirmer: false,
      mode: 'WORK',
    });
  });
  test('aucun planning, trop vieux ou expiré : inutilisable', () => {
    assert.equal(decider(null, 'youtube.com', T0, null).utilisable, false);
    assert.equal(decider(recu(planning()), 'youtube.com', T0 + AGE_MAX_MS + 1, null).utilisable, false);
    assert.equal(decider(recu(planning()), 'youtube.com', T0 + AGE_MAX_MS, null).utilisable, true);
    const court = planning({ valable_jusqua: iso(T0 + 60_000) });
    assert.equal(decider(recu(court), 'youtube.com', T0 + 60_000, null).utilisable, false);
  });
  test("décalage d'horloge : l'heure locale est convertie en heure du serveur", () => {
    // Horloge locale en retard de 3 h : localement T0 − 3 h, au serveur T0 + 2 h → soirée libre.
    const r = recu(planning({ heure_serveur: iso(T0 + 2 * H) }), 3 * H, T0 - H);
    const d = decider(r, 'youtube.com', T0 - H, null);
    assert.deepEqual(d, { utilisable: true, bloque: false, confirmer: false, mode: 'EVENING_FREE' });
  });
  test('bloqué dès la réception : pas de confirmation ; devenu bloqué depuis : confirmer', () => {
    const question = { id: 'q1', posee_a: iso(T0 - 1000), attente_s: 60, expire_a: iso(T0 + 60_000) };
    const r = recu(planning({ sessions: [session(['youtube.com'], { question })] }));
    assert.deepEqual(decider(r, 'www.youtube.com', T0 + 120_000, null), { utilisable: true, bloque: true, confirmer: false, mode: 'WORK' });
    assert.deepEqual(decider(r, 'youtube.com', T0 + 30_000, null), { utilisable: true, bloque: false, confirmer: false, mode: 'WORK' });
    assert.deepEqual(decider(r, 'youtube.com', T0 + 120_000, null), { utilisable: true, bloque: true, confirmer: true, mode: 'WORK' });
  });
});

describe('finDuBlocage', () => {
  test('enchaîne les segments consécutifs qui bloquent le domaine', () => {
    const p = planning({
      valable_jusqua: iso(T0 + 6 * H),
      segments: [
        segment(T0 - H, T0 + H, ['youtube.com']),
        segment(T0 + H, T0 + 3 * H, ['youtube.com'], { mode: 'NIGHT_LOCK' }),
        segment(T0 + 3 * H, T0 + 6 * H, []),
      ],
    });
    assert.equal(finDuBlocage(p, 'youtube.com', T0), T0 + 3 * H);
    assert.equal(finDuBlocage(p, 'example.com', T0), null);
  });
  test('bloqué jusqu’au bout du planning : inconnu (null)', () => {
    const p = planning({ segments: [segment(T0 - H, T0 + 4 * H, ['youtube.com'])] });
    assert.equal(finDuBlocage(p, 'youtube.com', T0), null);
  });
});

describe('validerPlanning', () => {
  test('refuse version inconnue, segment inversé, session sans id', () => {
    assert.throws(() => validerPlanning({ ...planning(), version: 2 }));
    assert.throws(() => validerPlanning(planning({ segments: [segment(T0, T0, [])] })));
    assert.throws(() => validerPlanning(planning({ sessions: [session([], { id: '' })] })));
    assert.throws(() => validerPlanning(null));
    assert.ok(validerPlanning(planning()));
  });
});

describe('affichage', () => {
  test('libellés des modes et raisons sans codes', () => {
    assert.equal(infoMode('MORNING_LOCK').libelle, 'Journée verrouillée');
    assert.equal(infoMode('MODE_INCONNU').libelle, 'Mode inconnu');
    assert.equal(raisonLisible('WORK — tâches prioritaires restantes : 2'), 'Tâches prioritaires restantes : 2');
    assert.equal(raisonLisible('WORK — EVENING_FREE non atteint'), 'Soirée libre non atteint');
  });
  test('échéance et initiale', () => {
    const m = new Date(2026, 10, 1, 10, 0);
    assert.equal(echeanceLisible(new Date(2026, 10, 1, 18, 30), m), '18:30');
    assert.equal(echeanceLisible(new Date(2026, 10, 2, 7, 0), m), 'demain 07:00');
    assert.equal(initiale('www.youtube.com'), 'Y');
  });
});

describe('raisonDetaillee', () => {
  test('mode visé et ce qui manque, en mots courts', () => {
    assert.deepEqual(raisonDetaillee('WORK — EVENING_FREE non atteint : tâches prioritaires restantes (du jour et en retard) : 6, récaps en retard : 1'), {
      objectif: 'Soirée libre',
      manques: ['6 tâches prioritaires à finir', '1 récap en retard'],
    });
    assert.deepEqual(raisonDetaillee('WORK — EVENING_FREE non atteint : avant 21:00, planning à faire : 1'), {
      objectif: 'Soirée libre',
      manques: ['Attendre 21:00', 'Planning du jour à faire'],
    });
  });
  test('sans « non atteint » : la raison lisible seule', () => {
    assert.deepEqual(raisonDetaillee('NIGHT_LOCK — après 23:00'), { objectif: null, manques: ['Après 23:00'] });
    assert.deepEqual(raisonDetaillee(''), { objectif: null, manques: [] });
  });
});

describe('questions posées dans le navigateur', () => {
  const q = (posee: number, attente_s = 5, id = 'q1') => ({ id, posee_a: iso(posee), attente_s, expire_a: iso(posee + (60 + attente_s) * 1000) });
  const normale = session(['youtube.com'], { tache: { id: 't1', nom: 'Maths' }, question: q(T0 + 25 * 60_000) });

  test('question renvoyée à l’avance : pas due avant posee_a, due à posee_a, plus après expire_a', () => {
    const p = planning({ sessions: [normale] });
    assert.deepEqual(questionsDues(p, T0), []);
    assert.equal(prochainePose(p, T0), T0 + 25 * 60_000);
    assert.deepEqual(questionsDues(p, T0 + 25 * 60_000), [{ sessionId: 's1', tache: 'Maths', question: normale.question }]);
    assert.equal(prochainePose(p, T0 + 25 * 60_000), null);
    assert.deepEqual(questionsDues(p, T0 + 25 * 60_000 + 65_000), []);
  });
  test('session à plafond propre (Claude Code) : jamais dans le navigateur', () => {
    const p = planning({ sessions: [{ ...normale, plafond_app: 'claude_code' }] });
    assert.deepEqual(questionsDues(p, T0 + 25 * 60_000), []);
    assert.equal(prochainePose(p, T0), null);
  });
  test('etatQuestion : attente avant « Je continue », puis expiration', () => {
    const question = q(T0, 5);
    assert.deepEqual(etatQuestion(question, T0), { avantContinuerS: 5, avantExpirationS: 65, peutContinuer: false, expiree: false });
    assert.equal(etatQuestion(question, T0 + 5000).peutContinuer, true);
    assert.equal(etatQuestion(question, T0 + 65_000).expiree, true);
  });
});
