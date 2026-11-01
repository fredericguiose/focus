import { describe, expect, it } from 'vitest';
import { compteSemaine, dettesHebdomadaires, lundiDe } from '../src/dette';

describe('dette de sommeil hebdomadaire (CDC §4, 01/11)', () => {
  const n = (nuit: string, endormi_min: number | null, siestes_min = 0) => ({ nuit, endormi_min, siestes_min });

  it('semaine du lundi au dimanche, en dates locales', () => {
    expect(lundiDe('2026-11-02')).toBe('2026-11-02'); // lundi
    expect(lundiDe('2026-11-08')).toBe('2026-11-02'); // dimanche
    expect(lundiDe('2026-11-09')).toBe('2026-11-09');
    expect(lundiDe('2026-11-01')).toBe('2026-10-26');
  });

  it('manques, surplus et siestes ; la nuit du dimanche ferme la semaine ; non mesurées à part', () => {
    // Troisième champ : siestes de la journée D ; elles rattrapent la nuit D − 1.
    const nuits = [
      n('2026-11-01', 400), // dimanche précédent : autre semaine
      n('2026-11-02', 420, 20), // −60 ; sieste du lundi : rattrape la nuit du dimanche 01/11, autre semaine
      n('2026-11-03', null, 30), // non mesurée ; sieste du mardi : rattrape la nuit du 02/11
      n('2026-11-04', 510), // +30
      n('2026-11-05', 480), // pile
      n('2026-11-06', 390), // −90
      n('2026-11-07', 470), // −10
      n('2026-11-08', 300), // nuit du dimanche au lundi : −180, dans cette semaine
      n('2026-11-09', 200, 15), // semaine suivante ; sa sieste du lundi rattrape la nuit du dimanche 08/11
    ];
    expect(compteSemaine('2026-11-02', nuits, 480)).toEqual({
      debut: '2026-11-02', fin: '2026-11-08', dette_min: 340, rattrape_min: 75, reste_min: 265, nuits_mesurees: 6, nuits_total: 7,
    });
    expect(compteSemaine('2026-10-26', nuits, 480)).toMatchObject({ dette_min: 80, rattrape_min: 20, reste_min: 60, nuits_mesurees: 1, nuits_total: 1 });
  });

  it('rattrapé au-delà de la dette : reste nul, jamais négatif', () => {
    expect(compteSemaine('2026-11-02', [n('2026-11-02', 450), n('2026-11-03', 540, 60)], 480)).toMatchObject({ dette_min: 30, rattrape_min: 120, reste_min: 0 });
  });

  it('semaine en cours : nuits finies, siestes du jour, nuits restantes jusqu’au dimanche inclus ; 4 bilans clos', () => {
    const nuits = [n('2026-10-12', 420), n('2026-10-26', 400), n('2026-11-01', 450), n('2026-11-02', 420), n('2026-11-03', 450)];
    const r = dettesHebdomadaires('2026-11-04', nuits, 480, 25);
    expect(r.dette_semaine).toEqual({
      debut: '2026-11-02', fin: '2026-11-08', dette_min: 90, rattrape_min: 25, reste_min: 65, nuits_restantes: 5, nuits_mesurees: 2, nuits_total: 2,
    });
    expect(r.bilans_semaines.map((b) => [b.debut, b.dette_min, b.non_rattrape_min])).toEqual([
      ['2026-10-26', 110, 110],
      ['2026-10-19', 0, 0],
      ['2026-10-12', 60, 60],
      ['2026-10-05', 0, 0],
    ]);
    expect(dettesHebdomadaires('2026-11-08', [], 480, 0).dette_semaine.nuits_restantes).toBe(1); // dimanche : cette dernière nuit
    expect(dettesHebdomadaires('2026-11-09', nuits, 480, 0).dette_semaine).toMatchObject({ debut: '2026-11-09', nuits_restantes: 7, nuits_total: 0, dette_min: 0 });
  });
});
