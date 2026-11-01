import { describe, expect, it } from 'vitest';
import { planifier } from '../src/planning';
import type { Segment } from '../src/types';
import { contexte, faits, tache } from './aides';

const planning = (echeance: string, terminee: boolean) => tache({ etiquettes: ['planning'], echeance, terminee, priorite: 'p4' });

function resume(segments: Segment[]): [string, string, string][] {
  return segments.map((s) => [s.debut, s.fin, s.mode]);
}

function verifierContigus(segments: Segment[], debut: string, finAttendue: string): void {
  expect(segments[0]!.debut).toBe(debut);
  expect(segments.at(-1)!.fin).toBe(finAttendue);
  segments.slice(1).forEach((s, i) => expect(s.debut).toBe(segments[i]!.fin));
}

describe('planifier', () => {
  // Lundi 02/11 midi (11:00Z) + 36 h. Mardi : une P1 reste, le planning est fait.
  const lesFaits = faits({
    taches: [planning('2026-11-02', true), planning('2026-11-03', true), tache({ priorite: 'p1', echeance: '2026-11-03' })],
  });

  it('segments contigus, ruptures aux bons instants, segments identiques fusionnés', () => {
    const segments = planifier(contexte('2026-11-02T11:00:00Z', { faits: lesFaits }), 'pc_linux');
    verifierContigus(segments, '2026-11-02T11:00:00Z', '2026-11-03T23:00:00Z');
    expect(resume(segments)).toEqual([
      ['2026-11-02T11:00:00Z', '2026-11-02T19:30:00Z', 'WORK'], // jusqu'à l'ouverture (20:30)
      ['2026-11-02T19:30:00Z', '2026-11-02T21:30:00Z', 'EVENING_FREE'], // jusqu'au coucher (22:30)
      ['2026-11-02T21:30:00Z', '2026-11-03T05:30:00Z', 'NIGHT_LOCK'], // jusqu'au lever (06:30)
      // L'ouverture du mardi (19:30 = 18:30Z) est un point de rupture, mais WORK continue : fusionné.
      ['2026-11-03T05:30:00Z', '2026-11-03T20:30:00Z', 'WORK'],
      ['2026-11-03T20:30:00Z', '2026-11-03T23:00:00Z', 'NIGHT_LOCK'],
    ]);
    expect(segments[2]).toMatchObject({ sessions: 'interdites', actions: { verrouiller_session: true } });
    expect(segments[1]).toMatchObject({ sessions: 'autorisees', actions: { bloquer_domaines: [] } });
  });

  it('chaque appareil a son planning : MORNING_LOCK pour le PC seulement', () => {
    const matin = faits({ taches: [planning('2026-11-02', true), planning('2026-11-03', false)] });
    const ctx = contexte('2026-11-02T11:00:00Z', { faits: matin });
    expect(resume(planifier(ctx, 'pc_linux')).slice(3)).toEqual([
      ['2026-11-03T05:30:00Z', '2026-11-03T20:30:00Z', 'MORNING_LOCK'],
      ['2026-11-03T20:30:00Z', '2026-11-03T23:00:00Z', 'NIGHT_LOCK'],
    ]);
    expect(resume(planifier(ctx, 'iphone')).slice(3)).toEqual([
      ['2026-11-03T05:30:00Z', '2026-11-03T18:30:00Z', 'WORK'],
      ['2026-11-03T18:30:00Z', '2026-11-03T20:30:00Z', 'EVENING_FREE'],
      ['2026-11-03T20:30:00Z', '2026-11-03T23:00:00Z', 'NIGHT_LOCK'],
    ]);
  });

  it('à travers le passage à l\'heure d\'hiver', () => {
    // Samedi 24/10 12:00 CEST (10:00Z) + 36 h ; dimanche en heure d'hiver.
    const segments = planifier(contexte('2026-10-24T10:00:00Z'), 'pc_linux');
    verifierContigus(segments, '2026-10-24T10:00:00Z', '2026-10-25T22:00:00Z');
    expect(resume(segments)).toEqual([
      ['2026-10-24T10:00:00Z', '2026-10-24T12:00:00Z', 'WORK'], // ouverture 14:00 CEST
      ['2026-10-24T12:00:00Z', '2026-10-24T22:00:00Z', 'EVENING_FREE'], // coucher 00:00 CEST
      ['2026-10-24T22:00:00Z', '2026-10-25T06:00:00Z', 'NIGHT_LOCK'], // lever 07:00 CET
      ['2026-10-25T06:00:00Z', '2026-10-25T13:00:00Z', 'WORK'], // ouverture 14:00 CET
      ['2026-10-25T13:00:00Z', '2026-10-25T20:30:00Z', 'EVENING_FREE'], // coucher 21:30 CET
      ['2026-10-25T20:30:00Z', '2026-10-25T22:00:00Z', 'NIGHT_LOCK'],
    ]);
  });

  it('horizon réglable', () => {
    const segments = planifier(contexte('2026-11-02T11:00:00Z', { faits: lesFaits }), 'pc_linux', 2);
    expect(resume(segments)).toEqual([['2026-11-02T11:00:00Z', '2026-11-02T13:00:00Z', 'WORK']]);
  });
});
