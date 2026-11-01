import type { Context } from 'hono';
import { ErreurApi, requeteInvalide } from './erreurs';
import { estDateLocale, estHeureLocale, estInstant } from './temps';

export type Corps = Record<string, unknown>;

export async function lireCorps(c: Context): Promise<Corps> {
  let corps: unknown;
  try {
    corps = await c.req.json();
  } catch {
    throw new ErreurApi(400, 'json_invalide', "Le corps de la requête n'est pas du JSON valide.");
  }
  if (typeof corps !== 'object' || corps === null || Array.isArray(corps)) {
    throw requeteInvalide('Le corps de la requête doit être un objet JSON.');
  }
  return corps as Corps;
}

export function texte(corps: Corps, cle: string, max = 200): string {
  const v = corps[cle];
  if (typeof v !== 'string' || v.trim() === '') {
    throw requeteInvalide(`Champ « ${cle} » manquant ou vide.`, { champ: cle });
  }
  if (v.length > max) throw requeteInvalide(`Champ « ${cle} » trop long (${max} caractères au plus).`, { champ: cle });
  return v;
}

export function texteFacultatif(corps: Corps, cle: string, max = 2000): string | undefined {
  const v = corps[cle];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw requeteInvalide(`Champ « ${cle} » : texte attendu.`, { champ: cle });
  if (v.length > max) throw requeteInvalide(`Champ « ${cle} » trop long (${max} caractères au plus).`, { champ: cle });
  return v;
}

export function instant(corps: Corps, cle: string): string {
  const v = corps[cle];
  if (!estInstant(v)) throw requeteInvalide(`Champ « ${cle} » : instant ISO 8601 attendu.`, { champ: cle });
  return v;
}

export function dateLocale(corps: Corps, cle: string): string {
  const v = corps[cle];
  if (!estDateLocale(v)) throw requeteInvalide(`Champ « ${cle} » : date "AAAA-MM-JJ" attendue.`, { champ: cle });
  return v;
}

export function heureLocale(corps: Corps, cle: string): string {
  const v = corps[cle];
  if (!estHeureLocale(v)) throw requeteInvalide(`Champ « ${cle} » : heure "HH:MM" attendue.`, { champ: cle });
  return v;
}

export function listeDeTextes(corps: Corps, cle: string, { min = 0, max = 50 } = {}): string[] {
  const v = corps[cle];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || x === '')) {
    throw requeteInvalide(`Champ « ${cle} » : liste de textes attendue.`, { champ: cle });
  }
  if (v.length < min || v.length > max) {
    throw requeteInvalide(`Champ « ${cle} » : entre ${min} et ${max} éléments.`, { champ: cle });
  }
  return [...new Set(v as string[])];
}

export function entierFacultatif(corps: Corps, cle: string, min: number, max: number): number | undefined {
  const v = corps[cle];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw requeteInvalide(`Champ « ${cle} » : entier entre ${min} et ${max} attendu.`, { champ: cle });
  }
  return v;
}
