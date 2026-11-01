import type { DateLocale, HeureLocale, Instant } from '../../core/src/types';

/** Instant UTC à la seconde, au format échangé partout : "2026-11-03T09:30:00Z". */
export function versInstant(d: Date | number): Instant {
  return new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function ms(i: Instant): number {
  return Date.parse(i);
}

export function decaler(i: Instant | Date, secondes: number): Instant {
  const base = typeof i === 'string' ? ms(i) : i.getTime();
  return versInstant(base + secondes * 1000);
}

const MOTIF_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const MOTIF_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MOTIF_HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function estInstant(v: unknown): v is Instant {
  return typeof v === 'string' && MOTIF_INSTANT.test(v) && !Number.isNaN(Date.parse(v));
}

export function estDateLocale(v: unknown): v is DateLocale {
  if (typeof v !== 'string' || !MOTIF_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

export function estHeureLocale(v: unknown): v is HeureLocale {
  return typeof v === 'string' && MOTIF_HEURE.test(v);
}

const formats = new Map<string, Intl.DateTimeFormat>();

function format(fuseau: string): Intl.DateTimeFormat {
  let f = formats.get(fuseau);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: fuseau,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formats.set(fuseau, f);
  }
  return f;
}

function parties(d: Date, fuseau: string): Record<string, number> {
  const p: Record<string, number> = {};
  for (const { type, value } of format(fuseau).formatToParts(d)) {
    if (type !== 'literal') p[type] = Number(value);
  }
  return p;
}

const deux = (n: number) => String(n).padStart(2, '0');

export function dateLocale(d: Date, fuseau: string): DateLocale {
  const p = parties(d, fuseau);
  return `${p.year}-${deux(p.month!)}-${deux(p.day!)}`;
}

export function heureLocale(d: Date, fuseau: string): HeureLocale {
  const p = parties(d, fuseau);
  return `${deux(p.hour!)}:${deux(p.minute!)}`;
}

export function ajouterJours(date: DateLocale, n: number): DateLocale {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Écart (ms) entre l'heure murale du fuseau et l'UTC, à l'instant donné. */
export function decalageFuseau(t: number, fuseau: string): number {
  const p = parties(new Date(t), fuseau);
  const mural = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return mural - Math.floor(t / 1000) * 1000;
}

/** Minuit local du jour `date` dans `fuseau`, en instant UTC. */
export function debutJourLocal(date: DateLocale, fuseau: string): Date {
  const minuitUtc = Date.parse(`${date}T00:00:00Z`);
  let t = minuitUtc;
  // Deux passes suffisent : la seconde corrige un changement d'heure entre l'essai et minuit.
  for (let i = 0; i < 3; i++) {
    const essai = minuitUtc - decalageFuseau(t, fuseau);
    if (essai === t) break;
    t = essai;
  }
  return new Date(t);
}
