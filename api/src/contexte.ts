// Lecture de ce dont le moteur a besoin : config active, faits Todoist en cache, exceptions.
import type { Config, Contexte, DateLocale, Exception, FaitsTodoist, Report, Tache } from '../../core/src/types';
import { journee } from '../../core/src/journee';
import { configAbsente } from './erreurs';
import { type JourneeDeVeille, leversMesures, type LigneSommeil, requeteSommeil, versSommeilMesure } from './sommeil';
import { ajouterJours, versInstant } from './temps';

export const CLES_CACHE = {
  taches: 'taches',
  reports: 'reports',
  suiviDeadlines: 'suivi_deadlines',
  idUtilisateurTodoist: 'id_utilisateur_todoist',
  etiquettes: 'etiquettes',
  synchroXiaomi: 'synchro_xiaomi',
  /** passToken Xiaomi le plus récent, chiffré (AES-GCM). */
  jetonXiaomi: 'jeton_xiaomi',
  synchroHevy: 'synchro_hevy',
  /** Heure du dernier passage Todoist tenté (cadence `synchro.todoist`). */
  synchroTodoist: 'synchro_todoist',
} as const;

/** Assez pour recalculer les 7 dernières nuits du statut (jour UTC et jour local peuvent différer d'un). */
const JOURS_EXCEPTIONS = 9;
const JOURS_PHOTOS = 7;
/**
 * Levers mesurés lus : la régularité (fenêtre de 7 jours) et le journal des levers (7 jours, plan
 * de la veille au soir) remontent au plus de 13 jours ; marge pour le décalage UTC / local.
 */
export const JOURS_LEVERS_MESURES = 15;

export interface ConfigActive {
  config: Config;
  version: string;
  recueLe: string;
}

export interface ContexteCharge {
  contexte: Contexte;
  version: string;
}

export async function chargerConfigActive(db: D1Database, utilisateur: string): Promise<ConfigActive | null> {
  const ligne = await db
    .prepare(
      `SELECT commit_id, json_normalise, recu_le FROM config_versions
       WHERE utilisateur = ? AND valide = 1 ORDER BY id DESC LIMIT 1`,
    )
    .bind(utilisateur)
    .first<{ commit_id: string; json_normalise: string; recu_le: string }>();
  if (!ligne) return null;
  return { config: JSON.parse(ligne.json_normalise) as Config, version: ligne.commit_id, recueLe: ligne.recu_le };
}

export async function lireCache<T>(db: D1Database, utilisateur: string, cle: string): Promise<{ valeur: T; majLe: string } | null> {
  const ligne = await db
    .prepare(`SELECT valeur, maj_le FROM cache_todoist WHERE utilisateur = ? AND cle = ?`)
    .bind(utilisateur, cle)
    .first<{ valeur: string; maj_le: string }>();
  return ligne ? { valeur: JSON.parse(ligne.valeur) as T, majLe: ligne.maj_le } : null;
}

/** Plusieurs clés du cache en une requête : valeur par clé (absente si la ligne n'existe pas). */
export async function lireCaches(db: D1Database, utilisateur: string, cles: string[]): Promise<Record<string, unknown>> {
  const { results } = await db
    .prepare(`SELECT cle, valeur FROM cache_todoist WHERE utilisateur = ? AND cle IN (${cles.map(() => '?').join(', ')})`)
    .bind(utilisateur, ...cles)
    .all<{ cle: string; valeur: string }>();
  return Object.fromEntries(results.map((l) => [l.cle, JSON.parse(l.valeur) as unknown]));
}

/** Réécrit seulement si la valeur a changé : D1 compte les lignes écrites. Renvoie vrai si écrit. */
export async function ecrireCache(db: D1Database, utilisateur: string, cle: string, valeur: unknown, maintenant: Date): Promise<boolean> {
  const json = JSON.stringify(valeur);
  const resultat = await db
    .prepare(
      `INSERT INTO cache_todoist (utilisateur, cle, valeur, maj_le) VALUES (?, ?, ?, ?)
       ON CONFLICT (utilisateur, cle) DO UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le
       WHERE cache_todoist.valeur <> excluded.valeur`,
    )
    .bind(utilisateur, cle, json, versInstant(maintenant))
    .run();
  return (resultat.meta.changes ?? 0) > 0;
}

interface LigneException {
  id: string;
  details: string;
  cree_le: string;
  raison: string | null;
  pendant_nuit: number;
  nuit_decision: string | null;
}

/** Charge config, faits et exceptions en un seul aller-retour vers D1. */
export async function chargerContexte(db: D1Database, utilisateur: string, maintenant: Date): Promise<ContexteCharge> {
  const aujourdhuiUtc: DateLocale = versInstant(maintenant).slice(0, 10);
  const [configs, cache, photos, exceptions, sommeil] = await db.batch([
    db
      .prepare(
        `SELECT commit_id, json_normalise FROM config_versions
         WHERE utilisateur = ? AND valide = 1 ORDER BY id DESC LIMIT 1`,
      )
      .bind(utilisateur),
    db
      .prepare(`SELECT cle, valeur, maj_le FROM cache_todoist WHERE utilisateur = ? AND cle IN (?, ?)`)
      .bind(utilisateur, CLES_CACHE.taches, CLES_CACHE.reports),
    db
      .prepare(
        `SELECT p.date AS date, r.tache_id AS tache_id FROM photos_retards p
         LEFT JOIN retards r ON r.utilisateur = p.utilisateur AND r.date = p.date
         WHERE p.utilisateur = ? AND p.date >= ?`,
      )
      .bind(utilisateur, ajouterJours(aujourdhuiUtc, -JOURS_PHOTOS)),
    db
      .prepare(
        `SELECT id, details, cree_le, raison, pendant_nuit, nuit_decision FROM exceptions
         WHERE utilisateur = ? AND annulee_le IS NULL AND jour >= ? ORDER BY cree_le, rowid`,
      )
      .bind(utilisateur, ajouterJours(aujourdhuiUtc, -JOURS_EXCEPTIONS)),
    requeteSommeil(db, utilisateur, `${ajouterJours(aujourdhuiUtc, -JOURS_LEVERS_MESURES - 2)}T00:00:00Z`),
  ]);

  const config = (configs!.results as { commit_id: string; json_normalise: string }[])[0];
  if (!config) throw configAbsente();

  let taches: Tache[] = [];
  let reports: Report[] = [];
  let recupereLe = versInstant(0);
  for (const ligne of cache!.results as { cle: string; valeur: string; maj_le: string }[]) {
    if (ligne.cle === CLES_CACHE.taches) taches = JSON.parse(ligne.valeur) as Tache[];
    if (ligne.cle === CLES_CACHE.reports) reports = JSON.parse(ligne.valeur) as Report[];
    // Le cache n'est réécrit que s'il change : c'est l'heure du dernier changement constaté.
    if (ligne.maj_le > recupereLe) recupereLe = ligne.maj_le;
  }

  const photosRetards: Record<DateLocale, string[]> = {};
  for (const { date, tache_id } of photos!.results as { date: string; tache_id: string | null }[]) {
    photosRetards[date] ??= [];
    if (tache_id) photosRetards[date].push(tache_id);
  }

  const faits: FaitsTodoist = { recupereLe, taches, reports, photosRetards };
  const contexte: Contexte = {
    config: JSON.parse(config.json_normalise) as Config,
    maintenant: versInstant(maintenant),
    faits,
    exceptions: (exceptions!.results as LigneException[]).map(versException),
  };
  const sessions = (sommeil!.results as LigneSommeil[]).map(versSommeilMesure);
  if (sessions.length > 0) contexte.leversMesures = mesurerLevers(contexte, sessions, aujourdhuiUtc);
  return { version: config.commit_id, contexte };
}

/**
 * Levers mesurés des derniers jours. Les siestes se reconnaissent aux journées du plan, sans
 * mesure : le contexte reçu n'en a pas encore.
 */
function mesurerLevers(plan: Contexte, sessions: ReturnType<typeof versSommeilMesure>[], aujourdhuiUtc: DateLocale): Record<DateLocale, string> {
  const journees: JourneeDeVeille[] = [];
  for (let n = JOURS_LEVERS_MESURES; n >= -1; n--) {
    const j = journee(plan, ajouterJours(aujourdhuiUtc, -n));
    journees.push({ date: j.date, fuseau: j.fuseau, lever: j.lever, coucher: j.coucherApplique });
  }
  // Une session encore en cours de synchro après maintenant n'est pas un lever.
  const avant = sessions.filter((s) => Date.parse(s.fin) <= Date.parse(plan.maintenant));
  return leversMesures(avant, journees, new Date(Date.parse(plan.maintenant)));
}

function versException(l: LigneException): Exception {
  return {
    id: l.id,
    demande: JSON.parse(l.details) as Exception['demande'],
    creeeLe: l.cree_le,
    ...(l.raison ? { raison: l.raison } : {}),
    pendantNuit: l.pendant_nuit === 1,
    ...(l.nuit_decision ? { nuitDecision: l.nuit_decision } : {}),
  };
}

export function nouvelIdentifiant(prefixe: string): string {
  return `${prefixe}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
