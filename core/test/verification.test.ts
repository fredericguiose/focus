import { describe, expect, it } from 'vitest';
import { lireConfig } from '../src/config';
import { verifierEngagements } from '../src/verification';
import type { Exception, Mesure } from '../src/types';
import { contexte, EXEMPLE, remplacer } from './aides';

// Exemple (Europe/Paris) : sport vérifié par une séance, lun/mer/ven ; travail non vérifié.
// Semaine du lundi 2 nov. 2026 ; mercredi 4 nov. 15:00 locale.
const MERCREDI = '2026-11-04T14:00:00Z';
const seance = (debut: string): Mesure => ({ type: 'seance', debut, fin: null });
const retrait = (date: string): Exception => ({
  id: `e_${date}`,
  demande: { type: 'retire', date, engagement: 'sport' },
  creeeLe: '2026-11-01T10:00:00Z',
  pendantNuit: false,
});

describe('verifierEngagements', () => {
  it('ne juge que les engagements vérifiables prévus, jour par jour', () => {
    const r = verifierEngagements(contexte(MERCREDI), [seance('2026-11-02T05:10:00Z')], '2026-11-02', '2026-11-08');
    expect(r).toEqual([
      { date: '2026-11-02', engagement: 'sport', nom: 'Sport', statut: 'fait' },
      { date: '2026-11-04', engagement: 'sport', nom: 'Sport', statut: 'a_faire' },
      { date: '2026-11-06', engagement: 'sport', nom: 'Sport', statut: 'a_faire' },
    ]);
  });

  it('jour passé sans mesure : sauté non déclaré ; retiré par une exception : sauté déclaré', () => {
    const ctx = contexte('2026-11-07T10:00:00Z', { exceptions: [retrait('2026-11-04')] });
    expect(verifierEngagements(ctx, [], '2026-11-02', '2026-11-06').map((e) => e.statut)).toEqual([
      'saute_non_declare',
      'saute_declare',
      'saute_non_declare',
    ]);
  });

  it('une mesure le jour même l\'emporte, même retiré ; le jour local compte, pas le jour UTC', () => {
    const ctx = contexte('2026-11-07T10:00:00Z', { exceptions: [retrait('2026-11-04')] });
    // 23:30 UTC le 3 nov. = 00:30 le 4 nov. à Paris.
    const r = verifierEngagements(ctx, [seance('2026-11-03T23:30:00Z'), { type: 'sommeil', debut: '2026-11-06T05:00:00Z', fin: null }], '2026-11-04', '2026-11-06');
    expect(r.map((e) => e.statut)).toEqual(['fait', 'saute_non_declare']);
  });

  it('un engagement sans heure (congés) reste vérifiable', () => {
    const r = verifierEngagements(contexte('2026-12-21T20:00:00Z'), [seance('2026-12-21T16:00:00Z')], '2026-12-21', '2026-12-23');
    expect(r.map((e) => [e.date, e.statut])).toEqual([
      ['2026-12-21', 'fait'],
      ['2026-12-23', 'a_faire'],
    ]);
  });

  it('facultatif (congés) : passé ou retiré sans être fait, « facultatif_non_fait », jamais sauté', () => {
    const ctx = contexte('2026-12-26T10:00:00Z', { exceptions: [retrait('2026-12-23')] });
    expect(verifierEngagements(ctx, [seance('2026-12-25T09:00:00Z')], '2026-12-21', '2026-12-26').map((e) => [e.date, e.statut])).toEqual([
      ['2026-12-21', 'facultatif_non_fait'],
      ['2026-12-23', 'facultatif_non_fait'],
      ['2026-12-25', 'fait'],
    ]);
  });

  it('sans champ verification, rien n\'est vérifié', () => {
    const config = lireConfig(remplacer(EXEMPLE, ', verification: { mesure: seance }', ''));
    expect(verifierEngagements({ ...contexte(MERCREDI), config }, [], '2026-11-02', '2026-11-08')).toEqual([]);
  });
});
