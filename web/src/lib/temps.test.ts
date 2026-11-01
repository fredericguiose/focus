import { describe, expect, it } from 'vitest';

import { ajouterJours, dateLocale, formaterDette, formaterDuree, instantLocal, versInstant } from './temps';

describe('instantLocal', () => {
  it('convertit une heure locale en instant UTC, heure d’hiver et d’été', () => {
    expect(versInstant(instantLocal('2026-11-03', '06:30', 'Europe/Paris'))).toBe('2026-11-03T05:30:00Z');
    expect(versInstant(instantLocal('2026-07-03', '06:30', 'Europe/Paris'))).toBe('2026-07-03T04:30:00Z');
    expect(versInstant(instantLocal('2026-11-03', '22:00', 'America/Cayenne'))).toBe('2026-11-04T01:00:00Z');
  });
});

describe('dateLocale', () => {
  it('donne le jour local, pas le jour UTC', () => {
    expect(dateLocale(Date.parse('2026-11-04T01:00:00Z'), 'America/Cayenne')).toBe('2026-11-03');
    expect(dateLocale(Date.parse('2026-11-03T23:30:00Z'), 'Europe/Paris')).toBe('2026-11-04');
  });
});

describe('formatage', () => {
  it('ajoute des jours en traversant les mois', () => {
    expect(ajouterJours('2026-10-31', 1)).toBe('2026-11-01');
    expect(ajouterJours('2026-11-01', -1)).toBe('2026-10-31');
  });
  it('formate durées et dette', () => {
    expect(formaterDuree(20)).toBe('20 min');
    expect(formaterDuree(90)).toBe('1 h 30');
    expect(formaterDuree(120)).toBe('2 h');
    expect(formaterDette(0)).toBe('aucune');
    expect(formaterDette(45)).toBe('45 min de dette');
    expect(formaterDette(-30)).toBe("30 min d'avance");
  });
});
