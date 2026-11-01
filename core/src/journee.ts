// La journée (docs/conception.md §3.1) : lever, coucher, ouverture, dette de la nuit.
// Une journée D va de lever(D) à lever(D+1) : la nuit appartient au jour du soir.

import type {
  Config,
  Instant,
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
  ecartDeFuseauxMin,
  ecartJours,
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

/** Valeurs par défaut des réglages ajoutés le 01/11 (une config normalisée plus ancienne, gardée en base, ne les a pas). */
export const ENDORMISSEMENT_PAR_DEFAUT_MIN = 0;
export const ECART_LEVER_MAX_PAR_DEFAUT_MIN = 120;

/** Délai d'endormissement et écart maximal des levers, défauts appliqués. */
export function reglagesDuLever(config: Config): { endormissementMin: number; ecartLeverMaxMin: number } {
  const { endormissementMin, ecartLeverMaxMin } = config.sommeil;
  return {
    endormissementMin: Number.isFinite(endormissementMin) ? endormissementMin : ENDORMISSEMENT_PAR_DEFAUT_MIN,
    ecartLeverMaxMin: Number.isFinite(ecartLeverMaxMin) && ecartLeverMaxMin > 0 ? ecartLeverMaxMin : ECART_LEVER_MAX_PAR_DEFAUT_MIN,
  };
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
  if ('sansHeure' in surcharge) {
    return sansIndefinis({ obligatoire: surcharge.obligatoire ?? base.obligatoire, verification: base.verification });
  }
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
  obligatoire: boolean;
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
      obligatoire: e.obligatoire,
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
        obligatoire: d.obligatoire ?? true,
        origine: 'exception',
      }));
    } else if (d.type === 'retire') {
      liste = liste.filter((e) => e.id !== d.engagement);
    } else {
      const preparation = d.preparationMin ?? contexte.config.engagements[d.engagement]?.preparationMin ?? PREPARATION_PAR_DEFAUT_MIN;
      liste = liste.map((e) => (e.id === d.engagement ? decaler(e, minutesDe(d.heure), preparation) : e));
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
    obligatoire: e.obligatoire,
    origine: e.origine,
  }));
}

/** Préparation donnée à un engagement sans heure qui en reçoit une, faute d'en avoir dans la config. */
export const PREPARATION_PAR_DEFAUT_MIN = 30;

/**
 * Décaler déplace l'heure ; le réveil suit du même écart (préparation conservée). Un engagement
 * sans heure en reçoit une : son réveil devient heure − préparation.
 */
function decaler(e: EngagementDuJour, nouvelleHeure: number, preparationSiSansHeure: number): EngagementDuJour {
  if (e.reveilMin === undefined) return { ...e, heureMin: nouvelleHeure, reveilMin: nouvelleHeure - preparationSiSansHeure };
  const reference = e.heureMin ?? e.reveilMin;
  return { ...e, heureMin: nouvelleHeure, reveilMin: e.reveilMin + nouvelleHeure - reference };
}

function sansIndefinis<T extends object>(objet: T): T {
  return Object.fromEntries(Object.entries(objet).filter(([, v]) => v !== undefined)) as T;
}

// ─── Lever calculé (docs/conception.md §3.1) ──────────────────────────────────
//
// Borne d'un jour D : le plus tôt des réveils de ses engagements à heure (exceptions appliquées),
// plafonnée par le reveil_libre de sa routine. Régularité : deux jours à 6 jours ou moins d'écart
// (fenêtre de 7 jours) ont des levers à moins de `ecart_lever_max` l'un de l'autre. On ne fait
// que baisser : L(D) = min(L(D), L(j) + X) pour |j − D| ≤ 6, jusqu'à stabilité. Un jour mesuré
// est fixe. Un jour sans engagement à heure ne descend pas sous lever_plancher, sauf si la borne
// qui l'y pousse vient d'un engagement : l'engagement gagne.
//
// La série est calculée une fois par bloc de 21 jours, avec 21 jours de marge de chaque côté, et
// gardée tant que la config, les exceptions et les mesures sont les mêmes objets.

const FENETRE_JOURS = 6;
const BLOC_JOURS = 21;
const MARGE_JOURS = 21;
/** Un lundi : origine des blocs (les blocs ne dépendent pas de la date demandée). */
const ORIGINE_DES_BLOCS = '2000-01-03';
const MAX_PASSAGES = 200;

interface BorneDuJour {
  date: DateLocale;
  fuseau: string;
  /** Minutes depuis minuit local du jour. */
  minutes: number;
  /** Aucun engagement à heure : le plancher s'applique. */
  libre: boolean;
  /** La borne vient d'un engagement (et non du plafond reveil_libre). */
  parEngagement: boolean;
}

interface SerieDeLevers {
  debut: DateLocale;
  bornes: BorneDuJour[];
  minutes: number[];
}

const SANS_MESURE: Record<DateLocale, Instant> = {};
const caches = new WeakMap<Config, WeakMap<Exception[], WeakMap<object, Map<string, unknown>>>>();

function cacheDe(contexte: Contexte): Map<string, unknown> {
  let parConfig = caches.get(contexte.config);
  if (!parConfig) caches.set(contexte.config, (parConfig = new WeakMap()));
  let parExceptions = parConfig.get(contexte.exceptions);
  if (!parExceptions) parConfig.set(contexte.exceptions, (parExceptions = new WeakMap()));
  const mesures = contexte.leversMesures ?? SANS_MESURE;
  let cache = parExceptions.get(mesures);
  if (!cache) parExceptions.set(mesures, (cache = new Map()));
  return cache;
}

function bornesDuBloc(contexte: Contexte, debut: DateLocale, n: number): BorneDuJour[] {
  const cache = cacheDe(contexte);
  const cle = `bornes|${debut}|${n}`;
  const deja = cache.get(cle) as BorneDuJour[] | undefined;
  if (deja) return deja;
  const bornes: BorneDuJour[] = [];
  for (let i = 0; i < n; i++) {
    const date = ajouterJours(debut, i);
    const { routine } = routineDuJour(contexte.config, date);
    const plafond = reveilLibre(contexte.config, routine);
    const reveils = engagementsDuJour(contexte, date)
      .map((e) => e.reveilMin)
      .filter((r): r is number => r !== undefined);
    const plusTot = reveils.length > 0 ? Math.min(...reveils) : undefined;
    bornes.push({
      date,
      fuseau: routine.fuseau,
      minutes: plusTot === undefined ? plafond : Math.min(plusTot, plafond),
      libre: plusTot === undefined,
      parEngagement: plusTot !== undefined && plusTot <= plafond,
    });
  }
  cache.set(cle, bornes);
  return bornes;
}

/** Minutes depuis minuit local du jour, pour un instant (peut sortir de [0, 1440)). */
function minutesDuJour(date: DateLocale, instant: number, fuseau: string): number {
  return Math.round((instant - instantLocal(date, 0, fuseau)) / MINUTE);
}

// ─── Décalage horaire (CDC §4, 01/11) ─────────────────────────────────────────
//
// Après un séjour dans un autre fuseau, les levers mesurés ne servent pas de référence le temps
// que le corps se recale. Pour planifier un jour au fuseau F, la mesure du jour D est ignorée si :
//   (a) D est dans un autre fuseau que F (écart non nul à la date de D) ;
//   (b) D suit de N jours ou moins un jour E dans un autre fuseau, N = écart horaire entre le
//       fuseau de E et F à la date de E, arrondi à l'heure (Paris → Cayenne fin octobre : 4 h,
//       donc les 4 jours après le retour).
// (b) vaut pour tout jour E des 26 jours précédents (écart maximal entre deux fuseaux) : avec
// plusieurs séjours, c'est le plus contraignant qui l'emporte (le plus récent, sauf si un séjour
// plus ancien a un écart assez grand pour durer plus longtemps).
// Le jour ignoré est alors calculé comme un jour sans mesure ; sa mesure reste son lever.

const RECALAGE_MAX_JOURS = 26;

export type RaisonMesureIgnoree = 'decalage_horaire';

/** Pourquoi la mesure du jour D ne sert pas de référence pour un jour au fuseau `fuseau`, ou null. */
export function mesureIgnoree(config: Config, date: DateLocale, fuseau: string): RaisonMesureIgnoree | null {
  const autre = (jour: DateLocale) => ecartDeFuseauxMin(jour, routineDuJour(config, jour).routine.fuseau, fuseau);
  if (autre(date) !== 0) return 'decalage_horaire';
  for (let n = 1; n <= RECALAGE_MAX_JOURS; n++) {
    if (n <= Math.round(autre(ajouterJours(date, -n)) / 60)) return 'decalage_horaire';
  }
  return null;
}

/** La dernière date mesurée strictement avant `date`, ou '' : seules les mesures d'avant comptent. */
function derniereMesureAvant(contexte: Contexte, date: DateLocale): DateLocale {
  let derniere = '';
  for (const d of Object.keys(contexte.leversMesures ?? {})) if (d < date && d > derniere) derniere = d;
  return derniere;
}

/**
 * Série des levers prévus autour de `date`, avec pour jours fixes les levers mesurés avant
 * `date` : c'est le plan tel qu'il se calculait la veille au soir. Les mesures ignorées pour
 * décalage horaire (vu du fuseau de `date`) ne fixent rien.
 */
function serieDeLevers(contexte: Contexte, date: DateLocale): SerieDeLevers {
  const rang = Math.floor(ecartJours(ORIGINE_DES_BLOCS, date) / BLOC_JOURS) * BLOC_JOURS;
  const debut = ajouterJours(ORIGINE_DES_BLOCS, rang - MARGE_JOURS);
  const coupure = derniereMesureAvant(contexte, date);
  const fuseau = routineDuJour(contexte.config, date).routine.fuseau;
  const cache = cacheDe(contexte);
  const cle = `serie|${debut}|${coupure}|${fuseau}`;
  const deja = cache.get(cle) as SerieDeLevers | undefined;
  if (deja) return deja;

  const { sommeil } = contexte.config;
  const ecart = reglagesDuLever(contexte.config).ecartLeverMaxMin;
  const plancher = minutesDe(sommeil.leverPlancher);
  const bornes = bornesDuBloc(contexte, debut, BLOC_JOURS + 2 * MARGE_JOURS);
  const minutes = bornes.map((b) => b.minutes);
  const parEngagement = bornes.map((b) => b.parEngagement);
  const fixe = bornes.map(() => false);
  bornes.forEach((b, i) => {
    const mesure = contexte.leversMesures?.[b.date];
    if (mesure === undefined || b.date > coupure || mesureIgnoree(contexte.config, b.date, fuseau)) return;
    minutes[i] = minutesDuJour(b.date, lireInstant(mesure), b.fuseau);
    parEngagement[i] = false;
    fixe[i] = true;
  });

  // Point fixe : chaque passage ne fait que baisser des valeurs entières, il s'arrête donc ; la
  // borne du nombre de passages n'est qu'un garde-fou (une chaîne avance d'au moins 6 jours par passage).
  for (let change = true, passe = 0; change && passe < MAX_PASSAGES; passe++) {
    change = false;
    for (let i = 0; i < bornes.length; i++) {
      if (fixe[i]) continue;
      for (let j = Math.max(0, i - FENETRE_JOURS); j <= Math.min(bornes.length - 1, i + FENETRE_JOURS); j++) {
        if (j === i) continue;
        let candidat = minutes[j]! + ecart;
        if (candidat >= minutes[i]!) continue;
        const viaEngagement = parEngagement[j]!;
        if (bornes[i]!.libre && !viaEngagement) candidat = Math.max(candidat, plancher);
        if (candidat >= minutes[i]!) continue;
        minutes[i] = candidat;
        parEngagement[i] = viaEngagement;
        change = true;
      }
    }
  }
  const serie = { debut, bornes, minutes };
  cache.set(cle, serie);
  return serie;
}

/** Lever calculé de D (borne, régularité, plancher), sans l'effet d'« avancer le coucher ». */
export function leverCalcule(contexte: Contexte, date: DateLocale): number {
  const serie = serieDeLevers(contexte, date);
  const i = ecartJours(serie.debut, date);
  return instantLocal(date, serie.minutes[i]!, serie.bornes[i]!.fuseau);
}

/** Lever mesuré de D (fin de la nuit principale), ou null. */
export function leverMesure(contexte: Contexte, date: DateLocale): number | null {
  const m = contexte.leversMesures?.[date];
  return m === undefined ? null : lireInstant(m);
}

/** Durée de la nuit, du coucher au lever : cible + endormissement. */
function nuitPrevueMs(contexte: Contexte): number {
  const { sommeil } = contexte.config;
  return (sommeil.cibleMin + reglagesDuLever(contexte.config).endormissementMin) * MINUTE;
}

/**
 * Lever prévu de D = le lever calculé. Se coucher plus tôt (« je vais dormir », coucher avancé)
 * ne touche jamais au lever : l'avance rembourse la dette (CDC §4, 01/11 : lever fixe).
 */
export function leverPrevu(contexte: Contexte, date: DateLocale): number {
  return leverCalcule(contexte, date);
}

/** Lever de D : mesuré s'il l'est, sinon prévu. */
export function lever(contexte: Contexte, date: DateLocale): number {
  return leverMesure(contexte, date) ?? leverPrevu(contexte, date);
}

/** Coucher prévu de la nuit D = lever calculé de D + 1 − cible − endormissement. */
export function coucherPrevu(contexte: Contexte, date: DateLocale): number {
  return leverCalcule(contexte, ajouterJours(date, 1)) - nuitPrevueMs(contexte);
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
    // Dette prévue : comptée sur le lever prévu (le plan), endormissement déduit.
    detteNuitMin: config.sommeil.cibleMin - ((leverPrevu(contexte, lendemain) - coucher) / MINUTE - reglagesDuLever(config).endormissementMin),
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
