import { describe, expect, it } from 'vitest';

import type { Journee } from '@/api/contrat';
import { etatPing, libelleAppareil } from './appareils';
import { positionSurFrise, prochainRepere } from './journee';
import { infoMode, raisonLisible } from './modes';
import { formaterEcart } from './temps';

const MIN = 60_000;
const journee: Journee = {
  date: '2026-11-03',
  routine: 'semaine',
  fuseau: 'Europe/Paris',
  engagements: [],
  lever: '2026-11-03T06:00:00Z',
  ouverture: '2026-11-03T18:50:00Z',
  coucherPrevu: '2026-11-03T20:30:00Z',
  coucherApplique: '2026-11-03T20:30:00Z',
  leverSuivant: '2026-11-04T04:30:00Z',
  prixDuReportMin: 20,
  detteNuitMin: 0,
  decisionDeNuitPrise: false,
};

describe('affichage', () => {
  it('formate un écart court', () => {
    expect(formaterEcart(70 * MIN)).toBe('dans 1 h 10');
    expect(formaterEcart(5 * MIN + 30_000)).toBe('dans 5 min');
    expect(formaterEcart(20_000)).toBe("dans moins d'une minute");
    expect(formaterEcart(-3 * MIN)).toBe('il y a 3 min');
  });

  it('trouve le prochain repère de la journée', () => {
    expect(prochainRepere(journee, Date.parse('2026-11-03T14:00:00Z'))?.cle).toBe('ouverture');
    expect(prochainRepere(journee, Date.parse('2026-11-03T19:00:00Z'))?.cle).toBe('coucher');
    expect(prochainRepere(journee, Date.parse('2026-11-03T22:00:00Z'))?.cle).toBe('leverSuivant');
    expect(prochainRepere(journee, Date.parse('2026-11-04T05:00:00Z'))).toBeNull();
  });

  it('place un instant sur la frise, borné', () => {
    expect(positionSurFrise(journee, Date.parse(journee.lever))).toBe(0);
    expect(positionSurFrise(journee, Date.parse(journee.leverSuivant))).toBe(1);
    expect(positionSurFrise(journee, Date.parse('2026-11-05T00:00:00Z'))).toBe(1);
  });

  it('traduit les modes et retire le code de la raison', () => {
    expect(infoMode('NIGHT_LOCK')).toEqual({ famille: 'nuit', libelle: 'Nuit' });
    expect(infoMode('EVENING_FREE').famille).toBe('soiree');
    expect(infoMode('WEEKEND_CALME')).toEqual({ famille: 'inconnu', libelle: 'Weekend calme' });
    expect(raisonLisible('WORK — tâches prioritaires restantes : 2')).toBe('Tâches prioritaires restantes : 2');
  });

  it('nomme les appareils et classe les pings', () => {
    expect(libelleAppareil({ appareil: 'pc_linux', type: 'pc_linux' })).toBe('PC Linux');
    expect(libelleAppareil({ appareil: 'iphone_victor', type: 'iphone' })).toBe('Iphone victor');
    const t = Date.parse('2026-11-03T14:00:00Z');
    expect(etatPing(new Date(t - 6 * MIN).toISOString(), t)).toBe('recent');
    expect(etatPing(new Date(t - 8 * MIN).toISOString(), t)).toBe('retard');
    expect(etatPing(new Date(t - 2 * 60 * MIN).toISOString(), t)).toBe('absent');
    expect(etatPing(null, t)).toBe('absent');
  });
});
