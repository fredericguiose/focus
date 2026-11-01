import { describe, expect, it } from 'vitest';
import { compteSemaine, dettesHebdomadaires, lundiDe, lundiDeLaNuit } from '../src/dette';

describe('dette de sommeil hebdomadaire (CDC §4, 01/11)', () => {
  const n = (nuit: string, endormi_min: number | null, siestes_min = 0) => ({ nuit, endormi_min, siestes_min });

  it('semaine du lundi au dimanche, en dates locales', () => {
    expect(lundiDe('2026-11-02')).toBe('2026-11-02'); // lundi
    expect(lundiDe('2026-11-08')).toBe('2026-11-02'); // dimanche
    expect(lundiDe('2026-11-09')).toBe('2026-11-09');
    expect(lundiDe('2026-11-01')).toBe('2026-10-26');
  });

  it('une nuit appartient à la semaine du matin où elle se termine', () => {
    expect(lundiDeLaNuit('2026-11-01')).toBe('2026-11-02'); // dimanche → lundi : ouvre la semaine du 02/11
    expect(lundiDeLaNuit('2026-11-07')).toBe('2026-11-02'); // samedi → dimanche : clôt la semaine
    expect(lundiDeLaNuit('2026-11-08')).toBe('2026-11-09');
  });

  it('manques, surplus et siestes ; non mesurées à part', () => {
    // Troisième champ : siestes de la journée D ; elles rattrapent la nuit D − 1.
    const nuits = [
      n('2026-11-01', 400), // dimanche → lundi : −80, ouvre la semaine du 02/11
      n('2026-11-02', 420, 20), // −60 ; sieste du lundi : rattrape la nuit du dimanche 01/11, même semaine
      n('2026-11-03', null, 30), // non mesurée ; sieste du mardi : rattrape la nuit du 02/11
      n('2026-11-04', 510), // +30
      n('2026-11-05', 480), // pile
      n('2026-11-06', 390), // −90
      n('2026-11-07', 470), // samedi → dimanche : −10, clôt la semaine
      n('2026-11-08', 300), // dimanche → lundi : semaine suivante
      n('2026-11-09', 200, 15), // semaine suivante ; sa sieste du lundi rattrape la nuit du dimanche 08/11
    ];
    expect(compteSemaine('2026-11-02', nuits, 480)).toEqual({
      debut: '2026-11-02', fin: '2026-11-08', dette_min: 240, rattrape_min: 80, reste_min: 160, nuits_mesurees: 6, nuits_total: 7,
    });
    expect(compteSemaine('2026-11-09', nuits, 480)).toMatchObject({ dette_min: 460, rattrape_min: 15, reste_min: 445, nuits_mesurees: 2, nuits_total: 2 });
  });

  it('nuit de dimanche à lundi et sieste du lundi : nouvelle semaine ; le dimanche soir vise la nouvelle semaine', () => {
    const nuits = [n('2026-11-07', 420), n('2026-11-08', 400)];
    // Lundi 09/11 : la nuit de dimanche à lundi (−80) et la sieste du lundi (30) ouvrent la semaine du 09/11.
    const lundi = dettesHebdomadaires('2026-11-09', nuits, 480, 30);
    expect(lundi.dette_semaine).toEqual({
      debut: '2026-11-09', fin: '2026-11-15', dette_min: 80, rattrape_min: 30, reste_min: 50, nuits_restantes: 6, nuits_mesurees: 1, nuits_total: 1,
    });
    expect(lundi.bilans_semaines[0]).toMatchObject({ debut: '2026-11-02', dette_min: 60, rattrape_min: 0, non_rattrape_min: 60 });
    // Dimanche 08/11 au soir : la nuit de ce soir ouvre la semaine du 09/11, encore vide ; la semaine du 02/11 est close.
    const dimanche = dettesHebdomadaires('2026-11-08', [n('2026-11-07', 420)], 480, 0);
    expect(dimanche.dette_semaine).toEqual({
      debut: '2026-11-09', fin: '2026-11-15', dette_min: 0, rattrape_min: 0, reste_min: 0, nuits_restantes: 7, nuits_mesurees: 0, nuits_total: 0,
    });
    expect(dimanche.bilans_semaines[0]).toMatchObject({ debut: '2026-11-02', dette_min: 60, non_rattrape_min: 60 });
  });

  it('rattrapé au-delà de la dette : reste nul, jamais négatif', () => {
    expect(compteSemaine('2026-11-02', [n('2026-11-02', 450), n('2026-11-03', 540, 60)], 480)).toMatchObject({ dette_min: 30, rattrape_min: 120, reste_min: 0 });
  });

  it('semaine en cours : nuits finies, siestes du jour, nuits restantes jusqu’à celle de samedi à dimanche ; 4 bilans clos', () => {
    const nuits = [n('2026-10-12', 420), n('2026-10-26', 400), n('2026-11-01', 450), n('2026-11-02', 420), n('2026-11-03', 450)];
    // Mercredi 04/11 : nuits du 01 (dimanche → lundi), 02 et 03 ; sieste du jour (25) pour la nuit du 03.
    const r = dettesHebdomadaires('2026-11-04', nuits, 480, 25);
    expect(r.dette_semaine).toEqual({
      debut: '2026-11-02', fin: '2026-11-08', dette_min: 120, rattrape_min: 25, reste_min: 95, nuits_restantes: 4, nuits_mesurees: 3, nuits_total: 3,
    });
    expect(r.bilans_semaines.map((b) => [b.debut, b.dette_min, b.non_rattrape_min])).toEqual([
      ['2026-10-26', 80, 80],
      ['2026-10-19', 0, 0],
      ['2026-10-12', 60, 60],
      ['2026-10-05', 0, 0],
    ]);
    expect(dettesHebdomadaires('2026-11-07', [], 480, 0).dette_semaine.nuits_restantes).toBe(1); // samedi : cette dernière nuit
    expect(dettesHebdomadaires('2026-11-09', nuits, 480, 0).dette_semaine).toMatchObject({ debut: '2026-11-09', nuits_restantes: 6, nuits_total: 0, dette_min: 0 });
  });
});
