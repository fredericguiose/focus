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
      ['MORNING_LOCK', 'Matin verrouillé', true, true],
      ['EVENING_FREE', 'Soirée libre', true, false],
      ['WORK', 'Travail', true, false],
    ]);
    expect(mode(parcours, 'NIGHT_LOCK').conditions).toEqual([
      { type: 'heure', libelle: 'dès le coucher 22:30', vraie: false, detail: null, a: '2026-11-02T21:30:00Z' },
    ]);
    expect(mode(parcours, 'MORNING_LOCK')).toMatchObject({
      logique: 'pas',
      conditions: [{ type: 'planning', libelle: 'planning du matin pas encore fait', vraie: true, detail: '1 à faire', a: null }],
    });
    expect(mode(parcours, 'EVENING_FREE')).toMatchObject({
      logique: 'tous',
      conditions: [
        { type: 'heure', libelle: 'après 20:30 (+20 min de report)', vraie: false, a: '2026-11-02T19:50:00Z' },
        { type: 'prioritaires', libelle: 'tâches P1/P2 du jour faites', vraie: true, detail: null },
        { type: 'recap', libelle: "récap d'hier fait", vraie: true },
      ],
    });
    expect(mode(parcours, 'WORK')).toMatchObject({ logique: 'simple', conditions: [{ type: 'toujours', vraie: true }] });
    expect(sortie(ctx, 'pc_linux')).toEqual({
      texte: 'dès que le planning du matin est fait',
      certaine: false,
      auPlusTard: '2026-11-02T21:30:00Z',
    });
  });

  it('après l\'ouverture, une P1 reste : soirée libre bloquée, sortie à la main', () => {
    const ctx = contexte('2026-11-02T20:00:00Z', { faits: faits({ taches: [tache({ echeance: '2026-11-02' })] }) });
    const parcours = moteur.expliquer(ctx, 'pc_linux');
    expect(mode(parcours, 'WORK').actif).toBe(true);
    expect(mode(parcours, 'EVENING_FREE').conditions.map((c) => [c.libelle, c.vraie, c.detail])).toEqual([
      ['après 20:30', true, null],
      ['tâches P1/P2 du jour faites', false, '1 restante'],
      ["récap d'hier fait", true, null],
    ]);
    expect(moteur.sortie(ctx, 'pc_linux')).toEqual({
      texte: 'dès que les tâches P1/P2 du jour sont faites',
      certaine: false,
      auPlusTard: '2026-11-02T21:30:00Z',
    });
  });

  it('avant l\'ouverture : la sortie combine la tâche et l\'heure ; tout fait, elle est certaine', () => {
    const p1 = contexte('2026-11-02T15:00:00Z', { faits: faits({ taches: [tache({ echeance: '2026-11-02' })] }) });
    expect(sortie(p1, 'pc_linux')).toEqual({
      texte: 'quand les tâches P1/P2 du jour seront faites et après 20:30',
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
    expect(mode(parcours, 'MORNING_LOCK')).toMatchObject({ applicable: false, actif: false, conditions: [{ vraie: true }] });
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
      ['heure', 'après 14:00', true, null],
      ['prioritaires', 'tâches P1/P2 du jour faites', true, null],
      ['recap', "récap d'hier fait", true, null],
      ['retard', 'aucun retard (photo de 00:00)', false, '1 restant'],
    ]);
    expect(sortie(ctx, 'pc_linux')).toEqual({
      texte: 'dès que les retards de la photo de 00:00 sont soldés',
      certaine: false,
      auPlusTard: '2026-11-01T20:30:00Z',
    });
  });

  it('appareil inconnu : refusé', () => {
    expect(() => expliquer(contexte('2026-11-02T17:00:00Z'), 'tablette')).toThrow(/appareil inconnu/);
  });
});
