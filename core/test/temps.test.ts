import { describe, expect, it } from 'vitest';
import { ajouterJours, ecartJours, ecrireInstant, estDate, instantLocal, jourSemaine, local, muraleSansCache, muraleUtc, viderCacheDesDecalages } from '../src/temps';
import { minutesDuree, lireExpression } from '../src/expressions';

const iso = (ms: number) => ecrireInstant(ms);

describe('temps', () => {
  it('convertit une heure locale en instant UTC (Paris hiver/été, Cayenne)', () => {
    expect(iso(instantLocal('2026-11-02', 5 * 60 + 30, 'Europe/Paris'))).toBe('2026-11-02T04:30:00Z');
    expect(iso(instantLocal('2026-07-01', 5 * 60 + 30, 'Europe/Paris'))).toBe('2026-07-01T03:30:00Z');
    expect(iso(instantLocal('2026-07-01', 5 * 60 + 30, 'America/Cayenne'))).toBe('2026-07-01T08:30:00Z');
    expect(iso(instantLocal('2026-12-01', 5 * 60 + 30, 'America/Cayenne'))).toBe('2026-12-01T08:30:00Z');
  });

  it('heure inexistante au passage à l\'heure d\'été : repoussée (02:30 → 03:30)', () => {
    expect(iso(instantLocal('2026-03-29', 2 * 60 + 30, 'Europe/Paris'))).toBe('2026-03-29T01:30:00Z');
    expect(local(Date.parse('2026-03-29T01:30:00Z'), 'Europe/Paris')).toEqual({ date: '2026-03-29', heure: '03:30' });
  });

  it('heure en double au passage à l\'heure d\'hiver : première occurrence', () => {
    expect(iso(instantLocal('2026-10-25', 2 * 60 + 30, 'Europe/Paris'))).toBe('2026-10-25T00:30:00Z');
    expect(local(Date.parse('2026-10-25T01:30:00Z'), 'Europe/Paris')).toEqual({ date: '2026-10-25', heure: '02:30' });
  });

  it('minutes hors de la journée : la date glisse', () => {
    expect(iso(instantLocal('2026-11-02', -15, 'Europe/Paris'))).toBe('2026-11-01T22:45:00Z');
    expect(iso(instantLocal('2026-11-02', 24 * 60 + 30, 'Europe/Paris'))).toBe('2026-11-02T23:30:00Z');
  });

  it('dates locales', () => {
    expect(jourSemaine('2026-11-02')).toBe('lun');
    expect(jourSemaine('2026-11-08')).toBe('dim');
    expect(ajouterJours('2026-12-31', 1)).toBe('2027-01-01');
    expect(ajouterJours('2026-03-01', -1)).toBe('2026-02-28');
    expect(ecartJours('2026-11-02', '2026-11-05')).toBe(3);
    expect(estDate('2026-02-29')).toBe(false);
    expect(estDate('2028-02-29')).toBe(true);
  });

  it('durées et expressions', () => {
    expect(minutesDuree('8h')).toBe(480);
    expect(minutesDuree('30min')).toBe(30);
    expect(minutesDuree('1h30')).toBe(90);
    expect(minutesDuree('1h3')).toBeNull();
    expect(minutesDuree('8 h')).toBeNull();
    expect(lireExpression('$coucher - 2h')).toEqual({ variable: 'coucher', decalageMin: -120 });
    expect(lireExpression('$lever + 30min')).toEqual({ variable: 'lever', decalageMin: 30 });
    expect(lireExpression('18:00')).toEqual({ heure: '18:00' });
    expect(lireExpression('$coucher - 2 h')).toBeNull();
  });
});

// Revue du 01/11 : le décalage est gardé par quart d'heure UTC (CPU). Il doit rester exact autour
// des changements d'heure, y compris pour les fuseaux à demi-heure ou à 45 min.
describe('décalage gardé par quart d\'heure = Intl, minute par minute autour des changements d\'heure', () => {
  const cas: [string, string][] = [
    ['Europe/Paris', '2026-03-29T00:00:00Z'],
    ['Europe/Paris', '2026-10-25T00:00:00Z'],
    ['America/Cayenne', '2026-10-25T00:00:00Z'],
    ['Australia/Lord_Howe', '2026-04-04T13:00:00Z'],
    ['Australia/Lord_Howe', '2026-10-03T14:00:00Z'],
    ['Asia/Kathmandu', '2026-01-01T00:00:00Z'],
    ['America/St_Johns', '2026-11-01T02:00:00Z'],
  ];
  it.each(cas)('%s autour de %s', (fuseau, autour) => {
    viderCacheDesDecalages();
    const t0 = Date.parse(autour);
    for (let m = 0; m < 4 * 60; m += 1) {
      const t = t0 + m * 60_000 + 17_123;
      expect(muraleUtc(t, fuseau)).toBe(muraleSansCache(t, fuseau));
    }
  });
});
