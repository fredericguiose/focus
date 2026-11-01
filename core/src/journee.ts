// La journée (docs/conception.md §3.1) : lever, coucher, ouverture, dette de la nuit.
// Une journée D va de lever(D) à lever(D+1) : la nuit appartient au jour du soir.

import type {
  Config,
  Contexte,
  DateLocale,
  DemandeException,
  Engagement,
  EngagementPrevu,
  Exception,
  Journee,
  JourSemaine,
  Routine,
} from './types';
import { resoudreExpression } from './expressions';
import { prixDuReport } from './report';
import {
  ajouterJours,
  dateLocale,
  ecrireInstant,
  instantLocal,
  jourSemaine,
  lireInstant,
  MINUTE,
  minutesDe,
} from './temps';

// ─── Routine du jour ──────────────────────────────────────────────────────────

export function routineDuJour(config: Config, date: DateLocale): { nom: string; routine: Routine } {
  const plage = config.calendrier.find((p) => p.du <= date && date <= p.au);
  const nom = plage?.routine ?? config.routineParDefaut;
  const routine = config.routines[nom];
  if (!routine) throw new Error(`routine inconnue « ${nom} »`);
  return { nom, routine };
}

export function reveilLibre(config: Config, routine: Routine): number {
  return minutesDe(routine.reveilLibre ?? config.reveilLibre);
}

export function modesActifs(routine: Routine, jour: JourSemaine): string[] {
  const retires = routine.jours[jour]?.retirer ?? [];
  return routine.modes.filter((m) => !retires.includes(m));
}

/** Couches : défaut du mode → paramètres de la routine → paramètres du jour. */
export function parametresDuMode(config: Config, routine: Routine, mode: string, jour: JourSemaine): Record<string, string> {
  return {
    ...config.modes[mode]?.parametres,
    ...routine.parametres?.[mode],
    ...routine.jours[jour]?.parametres?.[mode],
  };
}

// ─── Engagements ──────────────────────────────────────────────────────────────

/** Engagement de la config, surchargé par la routine. Une surcharge horaire remplace l'horaire. */
export function engagementEffectif(config: Config, routine: Routine, id: string): Engagement | undefined {
  const base = config.engagements[id];
  if (!base) return undefined;
  const surcharge = routine.engagements?.[id];
  if (!surcharge) return base;
  if ('sansHeure' in surcharge) return { annulable: base.annulable, decalable: base.decalable };
  const horaire = surcharge.heure !== undefined || surcharge.reveil !== undefined;
  const fusion: Engagement = { ...base, ...surcharge };
  if (horaire) {
    if (surcharge.heure === undefined) delete fusion.heure;
    if (surcharge.reveil === undefined) delete fusion.reveil;
  }
  return fusion;
}

function reveilDe(e: { reveil?: string; heure?: string; preparationMin?: number }): number | undefined {
  if (e.reveil !== undefined) return minutesDe(e.reveil);
  if (e.heure !== undefined) return minutesDe(e.heure) - (e.preparationMin ?? 0);
  return undefined;
}

export interface EngagementDuJour {
  id: string;
  /** Minutes depuis minuit du jour ; peut être négatif (réveil la veille au soir). */
  reveilMin?: number;
  heureMin?: number;
  annulable: boolean;
  decalable: boolean;
  origine: 'routine' | 'exception';
}

export function exceptionsTriees(exceptions: Exception[]): Exception[] {
  return exceptions
    .map((e, i) => ({ e, i, t: lireInstant(e.creeeLe) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map(({ e }) => e);
}

/** La nuit concernée : celle qui précède le jour d'un engagement. */
export function nuitDe(demande: DemandeException): DateLocale {
  return 'nuit' in demande ? demande.nuit : ajouterJours(demande.date, -1);
}

export function engagementsDuJour(contexte: Contexte, date: DateLocale): EngagementDuJour[] {
  const { routine } = routineDuJour(contexte.config, date);
  let liste: EngagementDuJour[] = (routine.jours[jourSemaine(date)]?.engagements ?? []).map((id) => {
    const e = engagementEffectif(contexte.config, routine, id)!;
    return sansIndefinis({
      id,
      reveilMin: reveilDe(e),
      heureMin: e.heure !== undefined ? minutesDe(e.heure) : undefined,
      annulable: e.annulable,
      decalable: e.decalable,
      origine: 'routine' as const,
    });
  });
  for (const { demande: d } of exceptionsTriees(contexte.exceptions)) {
    if (!('date' in d) || d.date !== date) continue;
    if (d.type === 'ajoute') {
      liste.push(sansIndefinis({
        id: d.libelle,
        reveilMin: reveilDe(d),
        heureMin: d.heure !== undefined ? minutesDe(d.heure) : undefined,
        annulable: true,
        decalable: true,
        origine: 'exception',
      }));
    } else if (d.type === 'retire') {
      liste = liste.filter((e) => e.id !== d.engagement);
    } else {
      liste = liste.map((e) => (e.id === d.engagement ? decaler(e, minutesDe(d.heure)) : e));
    }
  }
  return liste;
}

function nomEngagement(e: EngagementDuJour): string {
  return e.origine === 'exception' ? e.id : e.id.charAt(0).toUpperCase() + e.id.slice(1);
}

/** Engagements du jour D, exceptions appliquées, avec leurs heures en instants UTC. */
export function engagementsPrevus(contexte: Contexte, date: DateLocale): EngagementPrevu[] {
  const { routine } = routineDuJour(contexte.config, date);
  const instant = (minutes: number | undefined) =>
    minutes === undefined ? null : ecrireInstant(instantLocal(date, minutes, routine.fuseau));
  return engagementsDuJour(contexte, date).map((e) => ({
    id: e.id,
    nom: nomEngagement(e),
    reveil: instant(e.reveilMin),
    heure: instant(e.heureMin),
    annulable: e.annulable,
    decalable: e.decalable,
    origine: e.origine,
  }));
}

/** Décaler déplace l'heure ; le réveil suit du même écart (préparation conservée). */
function decaler(e: EngagementDuJour, nouvelleHeure: number): EngagementDuJour {
  if (e.reveilMin === undefined) return e;
  const reference = e.heureMin ?? e.reveilMin;
  return { ...e, heureMin: nouvelleHeure, reveilMin: e.reveilMin + nouvelleHeure - reference };
}

function sansIndefinis<T extends object>(objet: T): T {
  return Object.fromEntries(Object.entries(objet).filter(([, v]) => v !== undefined)) as T;
}

// ─── Lever et coucher ─────────────────────────────────────────────────────────

/** Lever(D), étapes 1 à 3 : engagements et réveil libre, sans l'effet d'« avancer le coucher ». */
export function leverDeBase(contexte: Contexte, date: DateLocale): number {
  const { routine } = routineDuJour(contexte.config, date);
  const reveils = engagementsDuJour(contexte, date)
    .map((e) => e.reveilMin)
    .filter((r): r is number => r !== undefined);
  return instantLocal(date, Math.min(reveilLibre(contexte.config, routine), ...reveils), routine.fuseau);
}

export function lever(contexte: Contexte, date: DateLocale): number {
  const veille = ajouterJours(date, -1);
  const avance = exceptionsDeNuit(contexte, veille).some((e) => e.demande.type === 'avancer_coucher');
  const sansReveil = engagementsDuJour(contexte, date).every((e) => e.reveilMin === undefined);
  if (!avance || !sansReveil) return leverDeBase(contexte, date);

  const { config } = contexte;
  const { routine } = routineDuJour(config, date);
  const plancher = instantLocal(date, minutesDe(config.sommeil.leverPlancher), routine.fuseau);
  const plafond = instantLocal(date, reveilLibre(config, routine), routine.fuseau);
  const voulu = coucherApplique(contexte, veille) + config.sommeil.cibleMin * MINUTE;
  return Math.min(Math.max(voulu, plancher), plafond);
}

export function coucherPrevu(contexte: Contexte, date: DateLocale): number {
  return leverDeBase(contexte, ajouterJours(date, 1)) - contexte.config.sommeil.cibleMin * MINUTE;
}

function exceptionsDeNuit(contexte: Contexte, nuit: DateLocale): Exception[] {
  return exceptionsTriees(contexte.exceptions).filter(
    (e) => (e.demande.type === 'coucher' || e.demande.type === 'avancer_coucher') && e.demande.nuit === nuit,
  );
}

/** Les exceptions de coucher donnent une heure absolue : la dernière créée l'emporte. */
export function coucherApplique(contexte: Contexte, nuit: DateLocale): number {
  const derniere = exceptionsDeNuit(contexte, nuit).at(-1)?.demande;
  if (!derniere) return coucherPrevu(contexte, nuit);
  if (derniere.type === 'avancer_coucher') return lireInstant(derniere.a);
  if (derniere.type !== 'coucher') throw new Error('exception de coucher attendue');
  const { routine } = routineDuJour(contexte.config, nuit);
  return instantCoucher(nuit, derniere.heure, routine.fuseau);
}

/** "HH:MM" de coucher pour la nuit D : de 12:00 à 23:59 le jour D, de 00:00 à 11:59 le lendemain. */
export function instantCoucher(nuit: DateLocale, heure: string, fuseau: string): number {
  const minutes = minutesDe(heure);
  return instantLocal(minutes >= 12 * 60 ? nuit : ajouterJours(nuit, 1), minutes, fuseau);
}

// ─── Journée ──────────────────────────────────────────────────────────────────

/** Ouverture : paramètre `ouverture` du premier mode actif qui en a un, plus le prix du report. */
function ouverture(contexte: Contexte, date: DateLocale, leverD: number, coucher: number, prixMin: number): number {
  const { config } = contexte;
  const { routine } = routineDuJour(config, date);
  const jour = jourSemaine(date);
  for (const mode of modesActifs(routine, jour)) {
    const parametres = parametresDuMode(config, routine, mode, jour);
    if (parametres.ouverture === undefined) continue;
    const t = resoudreExpression(parametres.ouverture, { date, fuseau: routine.fuseau, lever: leverD, coucher, parametres });
    return Math.min(t + prixMin * MINUTE, coucher);
  }
  return coucher;
}

export function journee(contexte: Contexte, date: DateLocale): Journee {
  const { config } = contexte;
  const { nom, routine } = routineDuJour(config, date);
  const lendemain = ajouterJours(date, 1);
  const leverD = lever(contexte, date);
  const leverSuivant = lever(contexte, lendemain);
  const coucher = coucherApplique(contexte, date);
  const prixMin = prixDuReport(config, contexte.faits, date, routine.fuseau);
  return {
    date,
    routine: nom,
    fuseau: routine.fuseau,
    engagements: engagementsDuJour(contexte, date).map((e) => e.id),
    lever: ecrireInstant(leverD),
    leverSuivant: ecrireInstant(leverSuivant),
    coucherPrevu: ecrireInstant(coucherPrevu(contexte, date)),
    coucherApplique: ecrireInstant(coucher),
    ouverture: ecrireInstant(ouverture(contexte, date, leverD, coucher, prixMin)),
    prixDuReportMin: prixMin,
    detteNuitMin: config.sommeil.cibleMin - (leverSuivant - coucher) / MINUTE,
    decisionDeNuitPrise: contexte.exceptions.some((e) => e.pendantNuit && nuitDe(e.demande) === date),
  };
}

/** La journée D telle que lever(D) ≤ maintenant < lever(D+1). */
export function journeeCourante(contexte: Contexte): Journee {
  const t = lireInstant(contexte.maintenant);
  const parDefaut = contexte.config.routines[contexte.config.routineParDefaut]!;
  let date = dateLocale(t, routineDuJour(contexte.config, dateLocale(t, parDefaut.fuseau)).routine.fuseau);
  for (let essai = 0; essai < 8; essai++) {
    if (t < lever(contexte, date)) date = ajouterJours(date, -1);
    else if (t >= lever(contexte, ajouterJours(date, 1))) date = ajouterJours(date, 1);
    else return journee(contexte, date);
  }
  throw new Error(`aucune journée ne contient l'instant ${contexte.maintenant}`);
}
