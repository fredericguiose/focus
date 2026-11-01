import { describe, expect, it } from 'vitest';

import { etatPing, libelleAppareil } from './appareils';
import { infoMode, raisonLisible } from './modes';
import { formaterEcart } from './temps';

const MIN = 60_000;

describe('affichage', () => {
  it('formate un écart court', () => {
    expect(formaterEcart(70 * MIN)).toBe('dans 1 h 10');
    expect(formaterEcart(5 * MIN + 30_000)).toBe('dans 5 min');
    expect(formaterEcart(20_000)).toBe("dans moins d'une minute");
    expect(formaterEcart(-3 * MIN)).toBe('il y a 3 min');
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
