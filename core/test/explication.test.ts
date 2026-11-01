import { describe, expect, it } from 'vitest';
import { expliquer, moteur, sortie } from '../src/index';
import type { ModeExplique } from '../src/types';
import { contexte, faits, report, tache } from './aides';

// Lundi 02/11/2026 (UTC+1) : ouverture 20:30 (19:30Z), coucher 22:30 (21:30Z), lever suivant 06:30 (05:30Z).
const planningAFaire = tache({ etiquettes: ['planning'], echeance: '2026-11-02', priorite: 'p4' });

function mode(parcours: ModeExplique[], id: string): ModeExplique {
  return parcours.find((m) => m.mode === id)!;
}

describe('expliquer et sortie (§3.7)', () => {
  it('MORNING_LOCK à 18:00 : conditions, et sortie qui dépend du planning', () => {
    const ctx = contexte('2026-11-02T17:00:00Z', { faits: faits({ taches: [planningAFaire], reports: [report()] }) });
    const parcours = expliquer(ctx, 'pc_linux');
    expect(parcours.map((m) => [m.mode, m.nom, m.applicable, m.actif])).toEqual([
      ['NIGHT_LOCK', 'Nuit', true, false],
      ['MORNING_LOCK', 'Journée verrouillée', true, true],
      ['EVENING_FREE', 'Soirée libre', true, false],
      ['WORK', 'Travail', true, false],
    ]);
    expect(mode(parcours, 'NIGHT_LOCK').conditions).toEqual([
      { type: 'heure', libelle: 'Coucher à 22:30', vraie: false, detail: null, a: '2026-11-02T21:30:00Z', niee: false },
    ]);
    expect(mode(parcours, 'MORNING_LOCK')).toMatchObject({
      logique: 'pas',
      // Le fait positif et son état réel (pas fait), la négation portée par `niee`.
      conditions: [{ type: 'planning', libelle: 'Planning du jour', vraie: false, detail: 'à faire', a: null, niee: true }],
    });
    expect(mode(parcours, 'EVENING_FREE')).toMatchObject({
      logique: 'tous',
      conditions: [
        { type: 'heure', libelle: 'Ouverture à 20:50', vraie: false, detail: '+20 min de report', a: '2026-11-02T19:50:00Z' },
        { type: 'prioritaires', libelle: 'Tâches P1/P2 faites', vraie: true, detail: null },
        { type: 'recap', libelle: "Récap d'hier", vraie: true },
      ],
    });
    expect(mode(parcours, 'WORK')).toMatchObject({ logique: 'simple', conditions: [{ type: 'toujours', vraie: true }] });
    expect(sortie(ctx, 'pc_linux')).toEqual({
      texte: 'dès que le planning du jour est fait',
      certaine: false,
      auPlusTard: '2026-11-02T21:30:00Z',
    });
  });

  it('après l\'ouverture, une P1 reste : soirée libre bloquée, sortie à la main', () => {
    const ctx = contexte('2026-11-02T20:00:00Z', { faits: faits({ taches: [tache({ echeance: '2026-11-02' })] }) });
    const parcours = moteur.expliquer(ctx, 'pc_linux');
    expect(mode(parcours, 'WORK').actif).toBe(true);
    expect(mode(parcours, 'EVENING_FREE').conditions.map((c) => [c.libelle, c.vraie, c.detail])).toEqual([
      ['Ouverture à 20:30', true, null],
      ['Tâches P1/P2 faites', false, '1 tâche restante'],
      ["Récap d'hier", true, null],
    ]);
    expect(moteur.sortie(ctx, 'pc_linux')).toEqual({
      texte: 'dès que les tâches P1/P2 sont faites',
      certaine: false,
      auPlusTard: '2026-11-02T21:30:00Z',
    });
  });

  it('avant l\'ouverture : la sortie combine la tâche et l\'heure ; tout fait, elle est certaine', () => {
    const p1 = contexte('2026-11-02T15:00:00Z', { faits: faits({ taches: [tache({ echeance: '2026-11-02' })] }) });
    expect(sortie(p1, 'pc_linux')).toEqual({
      texte: 'quand les tâches P1/P2 seront faites et après 20:30',
      certaine: false,
      auPlusTard: '2026-11-02T21:30:00Z',
    });
    expect(sortie(contexte('2026-11-02T15:00:00Z'), 'pc_linux')).toEqual({
      texte: 'à 20:30',
      certaine: true,
      auPlusTard: '2026-11-02T19:30:00Z',
    });
  });

  it('nuit : sortie certaine au lever', () => {
    const ctx = contexte('2026-11-02T22:00:00Z');
    expect(mode(expliquer(ctx, 'pc_linux'), 'NIGHT_LOCK')).toMatchObject({ actif: true, conditions: [{ vraie: true }] });
    expect(sortie(ctx, 'pc_linux')).toEqual({ texte: 'au lever, 06:30', certaine: true, auPlusTard: '2026-11-03T05:30:00Z' });
  });

  it('iPhone : MORNING_LOCK non applicable, même planning à faire', () => {
    const ctx = contexte('2026-11-02T17:00:00Z', { faits: faits({ taches: [planningAFaire] }) });
    const parcours = expliquer(ctx, 'iphone');
    expect(mode(parcours, 'MORNING_LOCK')).toMatchObject({ applicable: false, actif: false, conditions: [{ vraie: false, niee: true }] });
    expect(mode(parcours, 'WORK').actif).toBe(true);
    expect(sortie(ctx, 'iphone')).toEqual({ texte: 'à 20:30', certaine: true, auPlusTard: '2026-11-02T19:30:00Z' });
  });

  it('dimanche : aucun_retard ajouté à EVENING_FREE', () => {
    // Dimanche 01/11 : ouverture 14:00 (13:00Z), coucher 21:30 (20:30Z).
    const ctx = contexte('2026-11-01T14:00:00Z', {
      faits: faits({
        taches: [tache({ id: 'retard1', echeance: '2026-10-30', priorite: 'p3' })],
        photosRetards: { '2026-11-01': ['retard1'] },
      }),
    });
    const soiree = mode(expliquer(ctx, 'pc_linux'), 'EVENING_FREE');
    expect(soiree.logique).toBe('tous');
    expect(soiree.conditions.map((c) => [c.type, c.libelle, c.vraie, c.detail])).toEqual([
      ['heure', 'Ouverture à 14:00', true, null],
      ['prioritaires', 'Tâches P1/P2 faites', true, null],
      ['recap', "Récap d'hier", true, null],
      ['retard', 'Retards rattrapés', false, '1 restante (en retard à minuit)'],
    ]);
    expect(sortie(ctx, 'pc_linux')).toEqual({
      texte: 'dès que les retards sont rattrapés',
      certaine: false,
      auPlusTard: '2026-11-01T20:30:00Z',
    });
  });

  it('P1/P2 en retard : elles bloquent la soirée ; le détail date la plus ancienne', () => {
    const taches = [
      tache({ echeance: '2026-11-02' }),
      tache({ priorite: 'p2', echeance: '2026-10-12' }),
      tache({ echeance: '2026-10-30' }),
    ];
    const ctx = contexte('2026-11-02T20:00:00Z', { faits: faits({ taches }) });
    const soiree = mode(expliquer(ctx, 'pc_linux'), 'EVENING_FREE');
    expect(soiree.conditions[1]).toMatchObject({ vraie: false, detail: '3 tâches restantes dont 2 en retard' });
    expect(mode(expliquer(ctx, 'pc_linux'), 'WORK').actif).toBe(true);
    const seule = contexte('2026-11-02T20:00:00Z', { faits: faits({ taches: [tache({ echeance: '2026-11-01' })] }) });
    expect(mode(expliquer(seule, 'pc_linux'), 'EVENING_FREE').conditions[1]!.detail).toBe('1 tâche en retard');
  });

  it('planning et récap : la date de la plus ancienne échéance, jamais un compte', () => {
    const ctx = (taches: ReturnType<typeof tache>[]) => contexte('2026-11-02T17:00:00Z', { faits: faits({ taches }) });
    const detail = (c: ReturnType<typeof contexte>, id: string, i = 0) => mode(expliquer(c, 'pc_linux'), id).conditions[i]!.detail;
    const planning = (echeance: string) => tache({ etiquettes: ['planning'], echeance, priorite: 'p4' });
    const recap = (echeance: string) => tache({ etiquettes: ['recap'], echeance, priorite: 'p4' });
    expect(detail(ctx([planning('2026-11-02')]), 'MORNING_LOCK')).toBe('à faire');
    expect(detail(ctx([planning('2026-11-02'), planning('2026-10-08'), planning('2026-10-20')]), 'MORNING_LOCK')).toBe('pas de planning fait depuis le 8 oct.');
    expect(detail(ctx([planning('2026-11-01')]), 'MORNING_LOCK')).toBe('pas de planning fait hier');
    // Récap d'hier (tolérance 1) : celui d'hier est « à faire », un plus ancien est en retard.
    expect(detail(ctx([recap('2026-11-01')]), 'EVENING_FREE', 2)).toBe('à faire');
    expect(detail(ctx([recap('2026-11-01'), recap('2026-10-08')]), 'EVENING_FREE', 2)).toBe('pas de récap fait depuis le 8 oct.');
  });

  it('appareil inconnu : refusé', () => {
    expect(() => expliquer(contexte('2026-11-02T17:00:00Z'), 'tablette')).toThrow(/appareil inconnu/);
  });
});
