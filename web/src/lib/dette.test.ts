import { describe, expect, it } from 'vitest';

import type { ReponseStatut } from '@/api/contrat';
import { texteBilan } from '@/composants/actions/RattraperSommeil';
import { bilan, heuresProposees, propositionPossible } from './dette';
import { heureLocale } from './temps';

const FUSEAU = 'America/Cayenne';

function statut(coucher: string, ouverture: string, extra: Partial<ReponseStatut> = {}): ReponseStatut {
  return {
    phase: 'soiree',
    dette_cumulee_reelle_min: 150,
    journee: {
      date: '2026-11-01',
      fuseau: FUSEAU,
      coucherApplique: coucher,
      coucherPrevu: coucher,
      ouverture,
      leverSuivant: '2026-11-02T09:00:00Z',
      decisionDeNuitPrise: false,
    },
    ...extra,
  } as ReponseStatut;
}

const heures = (s: ReponseStatut, maintenant: string) => heuresProposees(s, Date.parse(maintenant)).map((t) => heureLocale(t, FUSEAU));

describe('heures proposées', () => {
  it('du coucher appliqué au quart d’heure suivant maintenant', () => {
    // Coucher 22:37 (01:37Z), maintenant 21:52 (00:52Z) à Cayenne.
    expect(heures(statut('2026-11-02T01:37:00Z', '2026-11-01T23:00:00Z'), '2026-11-02T00:52:10Z')).toEqual(['22:37', '22:30', '22:15', '22:00']);
  });

  it('pile sur un quart d’heure : maintenant compte', () => {
    expect(heures(statut('2026-11-02T01:30:00Z', '2026-11-01T23:00:00Z'), '2026-11-02T01:00:00Z')).toEqual(['22:30', '22:15', '22:00']);
  });

  it('coucher après minuit : les heures de 00:00 à 11:59 sont celles du lendemain', () => {
    expect(heures(statut('2026-11-02T03:30:00Z', '2026-11-01T23:00:00Z'), '2026-11-02T02:40:00Z')).toEqual(['00:30', '00:15', '00:00', '23:45']);
  });

  it('moins d’un quart d’heure à gagner : pas de proposition', () => {
    const s = statut('2026-11-02T01:30:00Z', '2026-11-01T23:00:00Z');
    expect(propositionPossible(s, Date.parse('2026-11-02T01:10:00Z'))).toBe(true);
    expect(propositionPossible(s, Date.parse('2026-11-02T01:16:00Z'))).toBe(false);
  });

  it('coucher déjà avancé : pas de proposition', () => {
    const s = statut('2026-11-02T01:30:00Z', '2026-11-01T23:00:00Z');
    s.journee.coucherPrevu = '2026-11-02T02:00:00Z';
    expect(propositionPossible(s, Date.parse('2026-11-02T00:00:00Z'))).toBe(false);
  });
});

describe('bilan', () => {
  it('gain plafonné à la dette pour le reste, jamais négatif', () => {
    expect(bilan(1000 * 60_000, 940 * 60_000, 150)).toEqual({ gainMin: 60, resteMin: 90 });
    expect(bilan(1000 * 60_000, 820 * 60_000, 150)).toEqual({ gainMin: 180, resteMin: 0 });
    expect(texteBilan(60, 90)).toBe('+1 h de sommeil · reste 1 h 30');
    expect(texteBilan(180, 0)).toBe('+3 h de sommeil · dette remboursée');
    expect(texteBilan(0, 150)).toBe('Glisse à gauche pour dormir plus.');
  });
});
