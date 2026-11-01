import { describe, expect, it } from 'vitest';
import { lireConfig } from '../src/config';
import { etat } from '../src/etat';
import { journee } from '../src/journee';
import { prixDuReport } from '../src/report';
import { configExemple as config, contexte, EXEMPLE, faits, remplacer, report } from './aides';

const D = '2026-11-02';
const PARIS = 'Europe/Paris';
const prix = (...reports: ReturnType<typeof report>[]) => prixDuReport(config, faits({ reports }), D, PARIS);
const avecDeadline = { deadline: '2026-11-10', deadlinePoseeLe: '2026-10-20T08:00:00Z' };

describe('prix du report', () => {
  it('20 min par report d\'une prioritaire sortie du jour', () => {
    expect(prix(report())).toBe(20);
    expect(prix(report(), report({ tacheId: 'r2', priorite: 'p2' }), report({ tacheId: 'r3' }))).toBe(60);
  });

  it('plafonné à 90 min', () => {
    expect(prix(...Array.from({ length: 5 }, (_, i) => report({ tacheId: `r${i}` })))).toBe(90);
  });

  it('report documenté gratuit, report d\'une P3 gratuit', () => {
    expect(prix(report({ documente: true }))).toBe(0);
    expect(prix(report({ priorite: 'p3' }))).toBe(0);
  });

  it('seuls comptent les reports datés du jour (heure locale) qui sortent la tâche du jour', () => {
    expect(prix(report({ le: '2026-11-01T22:30:00Z' }))).toBe(0); // 23:30 le 01/11 à Paris
    expect(prix(report({ le: '2026-11-01T23:30:00Z' }))).toBe(20); // 00:30 le 02/11 à Paris
    expect(prix(report({ de: '2026-11-03', vers: '2026-11-05' }))).toBe(0); // tâche future déplacée
    expect(prix(report({ de: '2026-11-01', vers: D }))).toBe(0); // retard ramené au jour même
  });

  it('exemption deadline : avant la deadline, peu reportée, deadline lointaine, posée avant', () => {
    expect(prix(report(avecDeadline))).toBe(0);
    expect(prix(report({ ...avecDeadline, deadlinePoseeLe: '2026-11-02T07:00:00Z' }))).toBe(20); // posée le jour même
    expect(prix(report({ ...avecDeadline, reportsPrecedents: 3 }))).toBe(20);
    expect(prix(report({ ...avecDeadline, deadline: '2026-11-04' }))).toBe(20); // à 2 jours seulement
    expect(prix(report({ ...avecDeadline, vers: '2026-11-10' }))).toBe(20); // pas avant la deadline
  });

  it('décale l\'ouverture et EVENING_FREE', () => {
    const deux = faits({ reports: [report(), report({ tacheId: 'r2' })] });
    const j = journee(contexte('2026-11-02T12:00:00Z', { faits: deux }), D);
    expect(j.prixDuReportMin).toBe(40);
    expect(j.ouverture).toBe('2026-11-02T20:10:00Z'); // 20:30 + 40 min
    expect(etat(contexte('2026-11-02T20:05:00Z', { faits: deux }), 'pc_linux').mode).toBe('WORK');
    expect(etat(contexte('2026-11-02T20:10:00Z', { faits: deux }), 'pc_linux').mode).toBe('EVENING_FREE');
  });

  it('l\'ouverture ne dépasse jamais le coucher', () => {
    const configLarge = lireConfig(remplacer(EXEMPLE, 'plafond: "90min"', 'plafond: "3h"'));
    const neuf = faits({ reports: Array.from({ length: 9 }, (_, i) => report({ tacheId: `r${i}` })) });
    const j = journee({ ...contexte('2026-11-02T12:00:00Z', { faits: neuf }), config: configLarge }, D);
    expect(j.prixDuReportMin).toBe(180);
    expect(j.ouverture).toBe(j.coucherApplique);
  });
});
