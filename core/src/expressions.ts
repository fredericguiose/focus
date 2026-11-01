// Durées ("8h", "30min", "1h30") et expressions d'heure ("18:00", "$coucher - 2h").

import type { Condition, DateLocale, HeureLocale } from './types';
import { ajouterJours, estHeure, instantDepuisHeure, MINUTE } from './temps';

const RE_DUREE = /^(?:(\d+)h(?:([0-5]\d))?|(\d+)min)$/;
const RE_VARIABLE = /^\$([A-Za-z_][A-Za-z0-9_]*)(?:\s*([+-])\s*(\S+))?$/;

export const VARIABLES_RESERVEES = ['lever', 'coucher'] as const;

/** Minutes d'une durée, ou null si le texte n'est pas une durée. */
export function minutesDuree(texte: string): number | null {
  const m = RE_DUREE.exec(texte.trim());
  if (!m) return null;
  if (m[3] !== undefined) return Number(m[3]);
  return Number(m[1]) * 60 + Number(m[2] ?? 0);
}

export type Expression =
  | { heure: HeureLocale }
  | { variable: string; decalageMin: number };

export function lireExpression(texte: string): Expression | null {
  const t = texte.trim();
  if (estHeure(t)) return { heure: t };
  const m = RE_VARIABLE.exec(t);
  if (!m) return null;
  if (m[2] === undefined) return { variable: m[1]!, decalageMin: 0 };
  const duree = minutesDuree(m[3]!);
  if (duree === null) return null;
  return { variable: m[1]!, decalageMin: m[2] === '-' ? -duree : duree };
}

export function variableDe(texte: string): string | undefined {
  const e = lireExpression(texte);
  return e && 'variable' in e ? e.variable : undefined;
}

/** Toutes les expressions d'heure d'une condition (bornes `apres` et `avant`). */
export function expressionsDe(condition: Condition): string[] {
  if (typeof condition === 'string') return [];
  if ('heure' in condition) {
    return [condition.heure.apres, condition.heure.avant].filter((e): e is string => e !== undefined);
  }
  if ('tous' in condition) return condition.tous.flatMap(expressionsDe);
  if ('unParmi' in condition) return condition.unParmi.flatMap(expressionsDe);
  if ('pas' in condition) return expressionsDe(condition.pas);
  return [];
}

/** Paramètres ($ouverture…) cités par des conditions, hors $lever et $coucher. */
export function parametresCites(conditions: Condition[]): string[] {
  const noms = new Set<string>();
  for (const c of conditions) {
    for (const e of expressionsDe(c)) {
      const v = variableDe(e);
      if (v !== undefined && !(VARIABLES_RESERVEES as readonly string[]).includes(v)) noms.add(v);
    }
  }
  return [...noms];
}

export interface Repere {
  date: DateLocale;
  fuseau: string;
  lever: number;
  coucher: number;
  parametres: Record<string, string>;
}

/**
 * Instant d'une expression dans la journée `date`. Une heure "HH:MM" désigne sa première
 * occurrence à partir du lever : "02:00" est donc la nuit qui suit, pas la nuit d'avant.
 */
export function resoudreExpression(texte: string, repere: Repere): number {
  const e = lireExpression(texte);
  if (!e) throw new Error(`expression d'heure invalide « ${texte} »`);
  if ('heure' in e) {
    const t = instantDepuisHeure(repere.date, e.heure, repere.fuseau);
    return t >= repere.lever ? t : instantDepuisHeure(ajouterJours(repere.date, 1), e.heure, repere.fuseau);
  }
  return valeurVariable(e.variable, repere) + e.decalageMin * MINUTE;
}

function valeurVariable(nom: string, repere: Repere): number {
  if (nom === 'lever') return repere.lever;
  if (nom === 'coucher') return repere.coucher;
  const valeur = repere.parametres[nom];
  if (valeur === undefined) throw new Error(`paramètre $${nom} sans valeur le ${repere.date}`);
  return resoudreExpression(valeur, { ...repere, parametres: {} });
}
