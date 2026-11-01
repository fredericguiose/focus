// Évaluation des conditions (docs/conception.md §2.6), avec une explication lisible.

import type { Condition, Config, DateLocale, FaitsTodoist, FiltreTaches, Journee, Tache } from './types';
import { resoudreExpression, type Repere } from './expressions';
import { ajouterJours, lireInstant, local, MINUTE } from './temps';

export interface Environnement {
  config: Config;
  faits: FaitsTodoist;
  journee: Journee;
  instant: number;
  /** Paramètres du mode évalué, couches déjà appliquées. */
  parametres: Record<string, string>;
}

export interface Jugement {
  vrai: boolean;
  pourquoi: string;
}

// ─── Faits Todoist ────────────────────────────────────────────────────────────

function aFaire(t: Tache): boolean {
  return !t.terminee;
}

export function planningRestant(config: Config, faits: FaitsTodoist, jour: DateLocale): Tache[] {
  const etiquette = config.todoist.etiquettePlanning;
  return faits.taches.filter((t) => aFaire(t) && t.etiquettes.includes(etiquette) && t.echeance !== null && t.echeance <= jour);
}

export function recapRestant(config: Config, faits: FaitsTodoist, jour: DateLocale): Tache[] {
  const etiquette = config.todoist.etiquetteRecap;
  const limite = ajouterJours(jour, -config.todoist.recapToleranceJours);
  return faits.taches.filter((t) => aFaire(t) && t.etiquettes.includes(etiquette) && t.echeance !== null && t.echeance <= limite);
}

/** Tâches prioritaires du jour et en retard (échéance ≤ jour courant), décision du propriétaire. */
export function prioritairesRestantes(config: Config, faits: FaitsTodoist, jour: DateLocale): Tache[] {
  return tachesFiltrees(faits, jour, {
    jour: 'les_deux',
    priorites: config.todoist.prioritaires,
    etiquettesExclues: config.todoist.etiquettesExclues,
  });
}

/** Tâches de la photo des retards encore ouvertes. Une tâche absente des faits est réputée close. */
export function retardsRestants(faits: FaitsTodoist, jour: DateLocale): string[] {
  const photo = faits.photosRetards[jour] ?? [];
  const ouvertes = new Set(faits.taches.filter(aFaire).map((t) => t.id));
  return photo.filter((id) => ouvertes.has(id));
}

const RANG_PRIORITE: Record<Tache['priorite'], number> = { p1: 1, p2: 2, p3: 3, p4: 4 };

/**
 * Tâches qui retiennent une condition de tâches, les plus importantes d'abord : priorité (P1 avant
 * P2), puis échéance la plus ancienne (sans échéance en dernier), puis titre. Même ensemble que
 * celui que compte la condition : `prioritairesRestantes` ou `retardsRestants`.
 */
export function tachesQuiRetiennent(
  config: Config,
  faits: FaitsTodoist,
  jour: DateLocale,
  condition: 'prioritaires_faites' | 'aucun_retard',
): Tache[] {
  let taches: Tache[];
  if (condition === 'prioritaires_faites') {
    taches = prioritairesRestantes(config, faits, jour);
  } else {
    const parId = new Map(faits.taches.map((t) => [t.id, t]));
    taches = retardsRestants(faits, jour).flatMap((id) => parId.get(id) ?? []);
  }
  return [...taches].sort(
    (a, b) =>
      RANG_PRIORITE[a.priorite] - RANG_PRIORITE[b.priorite] ||
      (a.echeance ?? '9999-99-99').localeCompare(b.echeance ?? '9999-99-99') ||
      a.contenu.localeCompare(b.contenu, 'fr') ||
      a.id.localeCompare(b.id),
  );
}

/** Tâches ouvertes et assignées à l'utilisateur qui passent le filtre. */
export function tachesFiltrees(faits: FaitsTodoist, jour: DateLocale, filtre: FiltreTaches): Tache[] {
  return faits.taches.filter((t) => {
    if (!aFaire(t) || !t.assigneeAMoi || t.echeance === null) return false;
    const dansLeJour =
      filtre.jour === 'aujourd_hui' ? t.echeance === jour : filtre.jour === 'retard' ? t.echeance < jour : t.echeance <= jour;
    if (!dansLeJour) return false;
    if (filtre.priorites && !filtre.priorites.includes(t.priorite)) return false;
    if (filtre.etiquettesIncluses && !filtre.etiquettesIncluses.some((e) => t.etiquettes.includes(e))) return false;
    if (filtre.etiquettesExclues?.some((e) => t.etiquettes.includes(e))) return false;
    return true;
  });
}

// ─── Heures ───────────────────────────────────────────────────────────────────

export function repere(env: Environnement): Repere {
  return {
    date: env.journee.date,
    fuseau: env.journee.fuseau,
    lever: lireInstant(env.journee.lever),
    coucher: lireInstant(env.journee.coucherApplique),
    parametres: env.parametres,
  };
}

export type ConditionHeure = Extract<Condition, { heure: unknown }>['heure'];

export function bornes(h: ConditionHeure, env: Environnement): { apres?: number; avant?: number } {
  const r = repere(env);
  const decalage = h.decalePar === 'prix_du_report' ? env.journee.prixDuReportMin * MINUTE : 0;
  return {
    ...(h.apres !== undefined && { apres: resoudreExpression(h.apres, r) + decalage }),
    ...(h.avant !== undefined && { avant: resoudreExpression(h.avant, r) }),
  };
}

/** Tous les instants où une condition d'heure peut basculer (points de rupture du planning). */
export function instantsDeBascule(condition: Condition, env: Environnement): number[] {
  if (typeof condition === 'string') return [];
  if ('heure' in condition) {
    const b = bornes(condition.heure, env);
    return [b.apres, b.avant].filter((t): t is number => t !== undefined);
  }
  if ('tous' in condition) return condition.tous.flatMap((c) => instantsDeBascule(c, env));
  if ('unParmi' in condition) return condition.unParmi.flatMap((c) => instantsDeBascule(c, env));
  if ('pas' in condition) return instantsDeBascule(condition.pas, env);
  return [];
}

// ─── Jugement ─────────────────────────────────────────────────────────────────

function heureLocale(t: number, env: Environnement): string {
  return local(t, env.journee.fuseau).heure;
}

function jugerHeure(h: ConditionHeure, env: Environnement): Jugement {
  const b = bornes(h, env);
  if (b.apres !== undefined && env.instant < b.apres) return { vrai: false, pourquoi: `avant ${heureLocale(b.apres, env)}` };
  if (b.avant !== undefined && env.instant >= b.avant) return { vrai: false, pourquoi: `après ${heureLocale(b.avant, env)}` };
  const morceaux = [
    b.apres !== undefined ? `depuis ${heureLocale(b.apres, env)}` : '',
    b.avant !== undefined ? `jusqu'à ${heureLocale(b.avant, env)}` : '',
  ];
  return { vrai: true, pourquoi: morceaux.filter(Boolean).join(' ') };
}

function compte(n: number, vrai: string, faux: string): Jugement {
  return n === 0 ? { vrai: true, pourquoi: vrai } : { vrai: false, pourquoi: `${faux} : ${n}` };
}

export function juger(condition: Condition, env: Environnement): Jugement {
  const jour = env.journee.date;
  const { config, faits } = env;
  if (condition === 'toujours') return { vrai: true, pourquoi: 'par défaut' };
  if (condition === 'planning_fait') return compte(planningRestant(config, faits, jour).length, 'planning fait', 'planning à faire');
  if (condition === 'recap_fait') return compte(recapRestant(config, faits, jour).length, 'récap fait', 'récaps en retard');
  if (condition === 'prioritaires_faites') {
    return compte(
      prioritairesRestantes(config, faits, jour).length,
      'tâches prioritaires faites',
      'tâches prioritaires restantes (du jour et en retard)',
    );
  }
  if (condition === 'aucun_retard') return compte(retardsRestants(faits, jour).length, 'retards soldés', 'retards restants');
  if ('heure' in condition) return jugerHeure(condition.heure, env);
  if ('nombreDeTaches' in condition) {
    const { filtre, auPlus } = condition.nombreDeTaches;
    const n = tachesFiltrees(faits, jour, filtre).length;
    return { vrai: n <= auPlus, pourquoi: `${n} tâche(s) pour ${auPlus} au plus` };
  }
  if ('tous' in condition) {
    const jugements = condition.tous.map((c) => juger(c, env));
    const faux = jugements.filter((j) => !j.vrai);
    return faux.length === 0
      ? { vrai: true, pourquoi: jugements.map((j) => j.pourquoi).join(', ') }
      : { vrai: false, pourquoi: faux.map((j) => j.pourquoi).join(', ') };
  }
  if ('unParmi' in condition) {
    const jugements = condition.unParmi.map((c) => juger(c, env));
    const premier = jugements.find((j) => j.vrai);
    return premier ?? { vrai: false, pourquoi: jugements.map((j) => j.pourquoi).join(', ') };
  }
  const interieur = juger(condition.pas, env);
  return { vrai: !interieur.vrai, pourquoi: interieur.pourquoi };
}
