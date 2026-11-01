// Prix du report (docs/conception.md §3.5) : chaque report d'une tâche prioritaire coûte des
// minutes de soirée, sauf s'il est documenté ou justifié par une deadline lointaine.

import type { Config, DateLocale, FaitsTodoist, Report } from './types';
import { dateLocale, ecartJours, lireInstant } from './temps';

/** Le report compte-t-il pour le jour D : tâche prioritaire, sortie du jour D vers plus tard ? */
export function reportCompte(config: Config, report: Report, date: DateLocale, fuseau: string): boolean {
  return (
    config.todoist.prioritaires.includes(report.priorite) &&
    dateLocale(lireInstant(report.le), fuseau) === date &&
    report.de <= date &&
    report.vers > date
  );
}

export function reportGratuit(config: Config, report: Report, fuseau: string): boolean {
  if (report.documente) return true;
  if (report.deadline === null) return false;
  const regle = config.prixDuReport.deadline;
  const jour = dateLocale(lireInstant(report.le), fuseau);
  const poseeLeJourMeme =
    report.deadlinePoseeLe !== null && dateLocale(lireInstant(report.deadlinePoseeLe), fuseau) === jour;
  return (
    report.vers < report.deadline &&
    report.reportsPrecedents < regle.reportsMax &&
    ecartJours(jour, report.deadline) > regle.joursMinimum &&
    !poseeLeJourMeme
  );
}

/** Minutes ajoutées à l'ouverture du jour D, plafonnées. */
export function prixDuReport(config: Config, faits: FaitsTodoist, date: DateLocale, fuseau: string): number {
  const payants = faits.reports.filter(
    (r) => reportCompte(config, r, date, fuseau) && !reportGratuit(config, r, fuseau),
  ).length;
  return Math.min(payants * config.prixDuReport.parReportMin, config.prixDuReport.plafondMin);
}
