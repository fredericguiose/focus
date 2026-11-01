import { describe, expect, it } from 'vitest';

import type { Journee } from '@/api/contrat';
import { construireFrise, LARGEUR_MIN, largeurs } from './frise';

// Mardi à Paris : lever 06:30, ouverture 19:50, coucher 21:30, lever suivant 05:30.
const journee: Journee = {
  date: '2026-11-03',
  routine: 'semaine',
  fuseau: 'Europe/Paris',
  engagements: [],
  lever: '2026-11-03T05:30:00Z',
  ouverture: '2026-11-03T18:50:00Z',
  coucherPrevu: '2026-11-03T20:30:00Z',
  coucherApplique: '2026-11-03T20:30:00Z',
  leverSuivant: '2026-11-04T04:30:00Z',
  prixDuReportMin: 20,
  detteNuitMin: 0,
  decisionDeNuitPrise: false,
};

describe('frise de la journée', () => {
  it('relève les périodes courtes à la largeur minimale et garde un total de 1', () => {
    const l = largeurs([800, 100, 480]);
    expect(l.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(l[1]).toBeCloseTo(LARGEUR_MIN);
    expect(l[0]!).toBeGreaterThan(l[2]!);
  });

  it('nomme chaque période et la borne par les heures de la journée', () => {
    const f = construireFrise(journee, Date.parse('2026-11-03T14:00:00Z'), 'WORK');
    expect(f.periodes.map((p) => p.nom)).toEqual(['Travail', 'Soirée libre', 'Nuit']);
    expect(f.periodes[0]).toMatchObject({ gauche: 0, debut: Date.parse(journee.lever), fin: Date.parse(journee.ouverture) });
    expect(f.periodes.at(-1)?.droite).toBe(1);
    expect(f.reperes.map((r) => r.cle)).toEqual(['lever', 'ouverture', 'coucher', 'leverSuivant']);
    // Chaque repère tombe sur une frontière de période, dans l'ordre.
    expect(f.reperes.map((r) => r.position)).toEqual([0, f.periodes[1]!.gauche, f.periodes[2]!.gauche, 1]);
    expect(f.maintenant).toBeGreaterThan(0);
    expect(f.maintenant).toBeLessThan(f.periodes[1]!.gauche);
  });

  it('montre le matin verrouillé seulement quand il est en cours, jusqu’à sa fin donnée par l’API', () => {
    const f = construireFrise(journee, Date.parse('2026-11-03T06:00:00Z'), 'MORNING_LOCK', '2026-11-03T07:00:00Z');
    expect(f.periodes.map((p) => p.cle)).toEqual(['matin', 'travail', 'soiree', 'nuit']);
    expect(f.periodes[0]?.fin).toBe(Date.parse('2026-11-03T07:00:00Z'));
  });

  it('sans soirée (ouverture = coucher), pas de période ni de repère d’ouverture', () => {
    const f = construireFrise({ ...journee, ouverture: journee.coucherApplique }, Date.parse('2026-11-03T22:00:00Z'));
    expect(f.periodes.map((p) => p.cle)).toEqual(['travail', 'nuit']);
    expect(f.reperes.map((r) => r.cle)).toEqual(['lever', 'coucher', 'leverSuivant']);
    expect(f.maintenant).toBeGreaterThan(f.periodes[1]!.gauche);
  });
});
