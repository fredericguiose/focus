// Conversions entre heure locale (fuseau IANA) et instant UTC, via Intl uniquement.
// Les instants manipulés en interne sont des millisecondes depuis l'époque Unix.

import type { DateLocale, HeureLocale, Instant, JourSemaine } from './types';

export const MINUTE = 60_000;
const JOUR_MS = 86_400_000;

const JOURS: JourSemaine[] = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
export const JOURS_SEMAINE: JourSemaine[] = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];

const RE_HEURE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const RE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// ─── Heures et dates locales ──────────────────────────────────────────────────

export function estHeure(texte: string): boolean {
  return RE_HEURE.test(texte);
}

/** "HH:MM" → minutes depuis minuit. */
export function minutesDe(heure: HeureLocale): number {
  const m = RE_HEURE.exec(heure);
  if (!m) throw new Error(`heure invalide « ${heure} » (attendu HH:MM)`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function estDate(texte: string): boolean {
  const m = RE_DATE.exec(texte);
  if (!m) return false;
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(a, mo - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j;
}

function partiesDate(date: DateLocale): [number, number, number] {
  const m = RE_DATE.exec(date);
  if (!m || !estDate(date)) throw new Error(`date invalide « ${date} » (attendu AAAA-MM-JJ)`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function dateDepuisUtc(ms: number): DateLocale {
  return new Date(ms).toISOString().slice(0, 10);
}

export function ajouterJours(date: DateLocale, n: number): DateLocale {
  const [a, m, j] = partiesDate(date);
  return dateDepuisUtc(Date.UTC(a, m - 1, j + n));
}

/** Nombre de jours de `de` à `a` (positif si `a` est après). */
export function ecartJours(de: DateLocale, a: DateLocale): number {
  const [a1, m1, j1] = partiesDate(de);
  const [a2, m2, j2] = partiesDate(a);
  return Math.round((Date.UTC(a2, m2 - 1, j2) - Date.UTC(a1, m1 - 1, j1)) / JOUR_MS);
}

export function jourSemaine(date: DateLocale): JourSemaine {
  const [a, m, j] = partiesDate(date);
  return JOURS[new Date(Date.UTC(a, m - 1, j)).getUTCDay()]!;
}

// ─── Instants ─────────────────────────────────────────────────────────────────

export function lireInstant(instant: Instant): number {
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) throw new Error(`instant invalide « ${instant} » (attendu ISO 8601 UTC)`);
  return ms;
}

export function ecrireInstant(ms: number): Instant {
  const iso = new Date(ms).toISOString();
  return iso.endsWith('.000Z') ? `${iso.slice(0, -5)}Z` : iso;
}

// ─── Fuseaux ──────────────────────────────────────────────────────────────────

const formateurs = new Map<string, Intl.DateTimeFormat>();

function formateur(fuseau: string): Intl.DateTimeFormat {
  let f = formateurs.get(fuseau);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: fuseau,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formateurs.set(fuseau, f);
  }
  return f;
}

export function estFuseau(fuseau: string): boolean {
  try {
    formateur(fuseau);
    return true;
  } catch {
    return false;
  }
}

/** Heure murale (lue comme si elle était UTC) de l'instant dans le fuseau, via Intl (coûteux). */
function muraleIntl(ms: number, fuseau: string): number {
  const p: Record<string, number> = {};
  for (const { type, value } of formateur(fuseau).formatToParts(new Date(ms))) {
    if (type !== 'literal') p[type] = Number(value);
  }
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
}

/**
 * Décalage d'un fuseau gardé par quart d'heure UTC : les changements d'heure tombent toujours sur
 * un quart d'heure UTC (décalages multiples de 15 min), le décalage est donc constant dans chaque
 * quart d'heure. Intl.formatToParts faisait l'essentiel du temps CPU du statut (revue du 01/11 :
 * plan gratuit de Workers, 10 ms par appel).
 */
const QUART_MS = 15 * 60_000;
const DECALAGES_MAX = 20_000;
const decalages = new Map<string, Map<number, number>>();

function decalageDuQuart(ms: number, fuseau: string): number {
  let parFuseau = decalages.get(fuseau);
  if (!parFuseau) decalages.set(fuseau, (parFuseau = new Map()));
  const quart = Math.floor(ms / QUART_MS);
  let d = parFuseau.get(quart);
  if (d === undefined) {
    const debut = quart * QUART_MS;
    d = muraleIntl(debut, fuseau) - debut;
    if (parFuseau.size >= DECALAGES_MAX) parFuseau.clear();
    parFuseau.set(quart, d);
  }
  return d;
}

/** Vide le cache des décalages (mesures de CPU « à froid », tests). */
export function viderCacheDesDecalages(): void {
  decalages.clear();
}

/** Pour les tests : l'heure murale calculée par Intl seul, sans cache. */
export const muraleSansCache = (ms: number, fuseau: string) => muraleIntl(Math.floor(ms / 1000) * 1000, fuseau);

/** Heure murale (lue comme si elle était UTC) de l'instant dans le fuseau, à la seconde. */
export function muraleUtc(ms: number, fuseau: string): number {
  const secondes = Math.floor(ms / 1000) * 1000;
  return secondes + decalageDuQuart(secondes, fuseau);
}

/** Décalage du fuseau à cet instant, en ms (heure murale − UTC). */
function decalage(ms: number, fuseau: string): number {
  const secondes = Math.floor(ms / 1000) * 1000;
  return muraleUtc(secondes, fuseau) - secondes;
}

/**
 * Écart entre deux fuseaux le jour `date` (à midi UTC), en minutes, valeur absolue. Calculé avec
 * Intl : l'heure d'été de chaque fuseau à cette date est comprise.
 */
export function ecartDeFuseauxMin(date: DateLocale, a: string, b: string): number {
  if (a === b) return 0;
  const [an, m, j] = partiesDate(date);
  const midi = Date.UTC(an, m - 1, j, 12);
  return Math.abs(decalage(midi, a) - decalage(midi, b)) / MINUTE;
}

/**
 * Instant d'une heure murale locale. `minutes` peut sortir de [0, 1440) : la date est décalée.
 * Au changement d'heure : une heure qui n'existe pas est repoussée d'autant (02:30 → 03:30) ;
 * une heure qui existe deux fois prend la première occurrence.
 */
export function instantLocal(date: DateLocale, minutes: number, fuseau: string): number {
  const [a, m, j] = partiesDate(date);
  const murale = Date.UTC(a, m - 1, j, 0, minutes);
  const avant = decalage(murale - JOUR_MS, fuseau);
  const apres = decalage(murale + JOUR_MS, fuseau);
  const candidats = [murale - avant, murale - apres]
    .filter((ms) => muraleUtc(ms, fuseau) === murale)
    .sort((x, y) => x - y);
  return candidats[0] ?? murale - avant;
}

export function instantDepuisHeure(date: DateLocale, heure: HeureLocale, fuseau: string): number {
  return instantLocal(date, minutesDe(heure), fuseau);
}

/** Date et heure locales d'un instant. */
export function local(ms: number, fuseau: string): { date: DateLocale; heure: HeureLocale } {
  const iso = new Date(muraleUtc(ms, fuseau)).toISOString();
  return { date: iso.slice(0, 10), heure: iso.slice(11, 16) };
}

export function dateLocale(ms: number, fuseau: string): DateLocale {
  return local(ms, fuseau).date;
}

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** « 8 oct. », « 1er nov. » : date locale au format court français (textes destinés à l'utilisateur). */
export function dateCourte(date: DateLocale): string {
  const [, mois, jour] = date.split('-').map(Number);
  return `${jour === 1 ? '1er' : jour} ${MOIS_COURTS[mois! - 1]}`;
}
