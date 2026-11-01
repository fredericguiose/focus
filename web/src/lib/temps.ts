// Toutes les heures échangées sont des instants UTC ; le fuseau de la journée ne sert qu'à afficher
// et à produire les dates/heures locales attendues par les exceptions.
import type { DateLocale, HeureLocale, Instant } from '../../../core/src/types';

const MINUTE = 60_000;

function parties(ms: number, fuseau: string) {
  const morceaux = new Intl.DateTimeFormat('en-US', {
    timeZone: fuseau,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const valeur = (type: Intl.DateTimeFormatPartTypes) => Number(morceaux.find((m) => m.type === type)?.value ?? 0);
  return {
    annee: valeur('year'),
    mois: valeur('month'),
    jour: valeur('day'),
    heure: valeur('hour'),
    minute: valeur('minute'),
    seconde: valeur('second'),
  };
}

const deuxChiffres = (n: number) => String(n).padStart(2, '0');

/** Instant ISO sans millisecondes, comme dans la conception. */
export function versInstant(ms: number): Instant {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function dateLocale(ms: number, fuseau: string): DateLocale {
  const p = parties(ms, fuseau);
  return `${p.annee}-${deuxChiffres(p.mois)}-${deuxChiffres(p.jour)}`;
}

export function heureLocale(ms: number, fuseau: string): HeureLocale {
  const p = parties(ms, fuseau);
  return `${deuxChiffres(p.heure)}:${deuxChiffres(p.minute)}`;
}

export function ajouterJours(date: DateLocale, n: number): DateLocale {
  const [a, m, j] = date.split('-').map(Number);
  return new Date(Date.UTC(a ?? 0, (m ?? 1) - 1, (j ?? 1) + n)).toISOString().slice(0, 10);
}

/** Instant UTC d'une heure locale dans un fuseau (deux passes pour les changements d'heure). */
export function instantLocal(date: DateLocale, heure: HeureLocale, fuseau: string): number {
  const [a, m, j] = date.split('-').map(Number);
  const [h, mi] = heure.split(':').map(Number);
  const naif = Date.UTC(a ?? 0, (m ?? 1) - 1, j ?? 1, h ?? 0, mi ?? 0);
  const decalage = (ms: number) => {
    const p = parties(ms, fuseau);
    return Date.UTC(p.annee, p.mois - 1, p.jour, p.heure, p.minute, p.seconde) - Math.floor(ms / 1000) * 1000;
  };
  const premier = naif - decalage(naif);
  return naif - decalage(premier);
}

/** 0 = dimanche, comme Date.getDay. */
export function jourDeSemaine(date: DateLocale): number {
  const [a, m, j] = date.split('-').map(Number);
  return new Date(Date.UTC(a ?? 0, (m ?? 1) - 1, j ?? 1)).getUTCDay();
}

export function formaterHeure(instant: Instant, fuseau: string): string {
  return heureLocale(Date.parse(instant), fuseau);
}

/** « 22:30 », ou « lun. 22:30 » si l'instant n'est pas le même jour local que `reference`. */
export function formaterHeureRelative(instant: Instant, fuseau: string, referenceMs: number): string {
  const ms = Date.parse(instant);
  const heure = heureLocale(ms, fuseau);
  if (dateLocale(ms, fuseau) === dateLocale(referenceMs, fuseau)) return heure;
  const jour = new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, weekday: 'short' }).format(new Date(ms));
  return `${jour} ${heure}`;
}

export function formaterDate(date: DateLocale): string {
  const [a, m, j] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(Date.UTC(a ?? 0, (m ?? 1) - 1, j ?? 1)),
  );
}

/** « 20 min », « 1 h », « 1 h 30 » ; le signe est géré par l'appelant. */
export function formaterDuree(minutes: number): string {
  const total = Math.round(Math.abs(minutes));
  const h = Math.floor(total / 60);
  const min = total % 60;
  if (h === 0) return `${min} min`;
  return min === 0 ? `${h} h` : `${h} h ${deuxChiffres(min)}`;
}

/** Dette de sommeil : positive = on dort moins que la cible. */
export function formaterDette(minutes: number): string {
  if (Math.round(minutes) === 0) return 'aucune';
  if (minutes > 0) return `${formaterDuree(minutes)} de dette`;
  return `${formaterDuree(minutes)} d'avance`;
}

export function formaterSecondes(secondes: number): string {
  const s = Math.max(0, Math.ceil(secondes));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${deuxChiffres(s % 60)} s`;
}

export function ilYA(instant: Instant | null, maintenantMs: number): string {
  if (!instant) return 'jamais';
  const ecart = maintenantMs - Date.parse(instant);
  if (ecart < MINUTE) return "à l'instant";
  const minutes = Math.floor(ecart / MINUTE);
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 48) return `il y a ${heures} h`;
  return `il y a ${Math.floor(heures / 24)} j`;
}

/** « dans 1 h 10 », « dans 5 min », « dans moins d'une minute » ; « il y a … » si l'écart est négatif. */
export function formaterEcart(ecartMs: number): string {
  const minutes = Math.floor(Math.abs(ecartMs) / MINUTE);
  if (minutes < 1) return ecartMs >= 0 ? "dans moins d'une minute" : "à l'instant";
  return ecartMs >= 0 ? `dans ${formaterDuree(minutes)}` : `il y a ${formaterDuree(minutes)}`;
}

/** « mar. 4 nov. » */
export function formaterDateCourte(date: DateLocale): string {
  const [a, m, j] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(Date.UTC(a ?? 0, (m ?? 1) - 1, j ?? 1)),
  );
}
