// Séances de musculation lues dans Hevy (API publique officielle, comptes Pro), en lecture seule.
// Doc : https://api.hevyapp.com/docs/ — clé d'API dans l'en-tête `api-key`. GET /v1/workouts
// est paginé (10 séances au plus par page) et n'a pas de filtre de date : les séances arrivent
// de la plus récente à la plus ancienne, la lecture s'arrête à la première page qui sort de la période.
import { CLES_CACHE, ecrireCache, lireCache } from './contexte';
import type { Liaisons } from './env';
import { versInstant } from './temps';

export type CodeErreurHevy = 'cle_hevy_refusee' | 'hevy_indisponible' | 'hevy_reponse_invalide';

/** Le message ne contient jamais la clé ni le corps d'une réponse. */
export class ErreurHevy extends Error {
  constructor(
    readonly code: CodeErreurHevy,
    message: string,
  ) {
    super(`${code} : ${message}`);
    this.name = 'ErreurHevy';
  }
}

export interface SeanceHevy {
  id: string;
  debut: string;
  fin: string;
  titre: string;
}

export interface ClientHevy {
  /** Séances commencées depuis `depuis`, toutes (la liste est complète pour la période). */
  seances(depuis: Date): Promise<SeanceHevy[]>;
}

export interface OptionsHevy {
  cle: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

export const URL_HEVY = 'https://api.hevyapp.com/v1/workouts';
const PAR_PAGE = 10;
const PAGES_MAX = 15;
const DELAI_MS = 15_000;

function instant(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : versInstant(t);
}

/** Une séance de la réponse, réduite à ce que Focus garde ; null si elle est illisible. */
export function normaliserSeance(w: unknown): SeanceHevy | null {
  if (typeof w !== 'object' || w === null) return null;
  const o = w as Record<string, unknown>;
  const debut = instant(o.start_time);
  const fin = instant(o.end_time);
  if (typeof o.id !== 'string' || o.id === '' || !debut || !fin) return null;
  return { id: o.id, debut, fin, titre: typeof o.title === 'string' ? o.title : '' };
}

export function creerClientHevy(o: OptionsHevy): ClientHevy {
  const f = o.fetch ?? ((u, i) => fetch(u, i));

  async function page(n: number): Promise<{ pages: number; seances: SeanceHevy[] }> {
    let r: Response;
    try {
      r = await f(`${URL_HEVY}?page=${n}&pageSize=${PAR_PAGE}`, {
        headers: { 'api-key': o.cle, Accept: 'application/json' },
        signal: AbortSignal.timeout(DELAI_MS),
      });
    } catch {
      throw new ErreurHevy('hevy_indisponible', 'pas de réponse de api.hevyapp.com');
    }
    if (r.status === 401 || r.status === 403) throw new ErreurHevy('cle_hevy_refusee', `clé d'API refusée (HTTP ${r.status})`);
    // Au-delà de la dernière page, Hevy répond 404.
    if (r.status === 404 && n > 1) return { pages: n - 1, seances: [] };
    if (!r.ok) throw new ErreurHevy('hevy_indisponible', `HTTP ${r.status}`);
    let corps: { page_count?: unknown; workouts?: unknown };
    try {
      corps = await r.json();
    } catch {
      throw new ErreurHevy('hevy_reponse_invalide', 'réponse illisible');
    }
    if (!Array.isArray(corps.workouts)) throw new ErreurHevy('hevy_reponse_invalide', 'liste des séances absente');
    const seances = corps.workouts.map(normaliserSeance);
    if (seances.some((s) => s === null)) throw new ErreurHevy('hevy_reponse_invalide', 'séance sans identifiant ou sans heures');
    return { pages: typeof corps.page_count === 'number' ? corps.page_count : n, seances: seances as SeanceHevy[] };
  }

  return {
    async seances(depuis) {
      const limite = depuis.getTime();
      const resultat: SeanceHevy[] = [];
      for (let n = 1; n <= PAGES_MAX; n++) {
        const p = await page(n);
        resultat.push(...p.seances.filter((s) => Date.parse(s.debut) >= limite));
        if (n >= p.pages || p.seances.length === 0 || p.seances.some((s) => Date.parse(s.debut) < limite)) return resultat;
      }
      throw new ErreurHevy('hevy_reponse_invalide', `plus de ${PAGES_MAX * PAR_PAGE} séances dans la période`);
    },
  };
}

// ── Synchronisation dans `mesures` ────────────────────────────────────────────

export const INTERVALLE_SYNCHRO_HEVY_S = 3600;
export const JOURS_SYNCHRO_HEVY = 7;
export const JOURS_HISTORIQUE_HEVY = 60;
const JOUR_MS = 86_400_000;

export interface ReglagesHevy {
  cle: string;
  /** Seul utilisateur synchronisé : le compte Hevy est le sien. */
  utilisateur: string;
}

export function reglagesHevy(env: Liaisons): ReglagesHevy | null {
  const cle = env.HEVY_API_KEY?.trim();
  const utilisateur = env.HEVY_UTILISATEUR?.trim();
  return cle && utilisateur ? { cle, utilisateur } : null;
}

export interface EtatSynchroHevy {
  tentee_le: string;
  reussie_le: string | null;
  erreur: string | null;
  seances: number;
}

/** Début de la période à relire : 7 jours, ou depuis la dernière réussite moins un jour (60 jours au plus). */
export function debutDeLecture(avant: EtatSynchroHevy | undefined, maintenant: Date): Date {
  const t = maintenant.getTime();
  const plusAncien = t - JOURS_HISTORIQUE_HEVY * JOUR_MS;
  if (!avant?.reussie_le) return new Date(plusAncien);
  return new Date(Math.max(plusAncien, Math.min(t - JOURS_SYNCHRO_HEVY * JOUR_MS, Date.parse(avant.reussie_le) - JOUR_MS)));
}

/**
 * Insère ou met à jour chaque séance par son identifiant Hevy ; une séance de la période qui
 * n'est plus chez Hevy (supprimée) est effacée.
 */
export async function enregistrerSeances(db: D1Database, utilisateur: string, seances: SeanceHevy[], depuis: Date, maintenant: Date) {
  const recu = versInstant(maintenant);
  await db.batch([
    db
      .prepare(
        `DELETE FROM mesures WHERE utilisateur = ? AND type = 'seance' AND source = 'hevy' AND debut >= ?
           AND cle NOT IN (SELECT value FROM json_each(?))`,
      )
      .bind(utilisateur, versInstant(depuis), JSON.stringify(seances.map((s) => s.id))),
    ...seances.map((s) =>
      db
        .prepare(
          `INSERT INTO mesures (utilisateur, type, source, cle, debut, fin, valeur, details, recu_le)
           VALUES (?, 'seance', 'hevy', ?, ?, ?, ?, ?, ?)
           ON CONFLICT (utilisateur, type, source, cle) DO UPDATE SET
             debut = excluded.debut, fin = excluded.fin, valeur = excluded.valeur, details = excluded.details, recu_le = excluded.recu_le
           WHERE mesures.debut IS NOT excluded.debut OR mesures.fin IS NOT excluded.fin
              OR mesures.valeur IS NOT excluded.valeur OR mesures.details IS NOT excluded.details`,
        )
        .bind(utilisateur, s.id, s.debut, s.fin, Math.round((Date.parse(s.fin) - Date.parse(s.debut)) / 60_000), JSON.stringify({ titre: s.titre }), recu),
    ),
  ]);
}

/** Une fois par heure au plus ; au premier passage, 60 jours d'historique. L'échec est noté et relancé l'heure suivante. */
export async function synchroniserSeances(
  db: D1Database,
  fabrique: (cle: string) => ClientHevy,
  reglages: ReglagesHevy,
  maintenant: Date,
  forcer = false,
): Promise<EtatSynchroHevy | null> {
  const { utilisateur } = reglages;
  const avant = (await lireCache<EtatSynchroHevy>(db, utilisateur, CLES_CACHE.synchroHevy))?.valeur;
  if (!forcer && avant && maintenant.getTime() - Date.parse(avant.tentee_le) < INTERVALLE_SYNCHRO_HEVY_S * 1000) return null;
  const depuis = debutDeLecture(avant, maintenant);
  const etat: EtatSynchroHevy = { tentee_le: versInstant(maintenant), reussie_le: avant?.reussie_le ?? null, erreur: null, seances: 0 };
  try {
    const seances = await fabrique(reglages.cle).seances(depuis);
    await enregistrerSeances(db, utilisateur, seances, depuis, maintenant);
    etat.seances = seances.length;
    etat.reussie_le = etat.tentee_le;
    return etat;
  } catch (e) {
    etat.erreur = e instanceof ErreurHevy ? e.code : 'erreur_interne';
    throw e;
  } finally {
    await ecrireCache(db, utilisateur, CLES_CACHE.synchroHevy, etat, maintenant);
  }
}

export async function etatSynchroHevy(db: D1Database, utilisateur: string) {
  const e = (await lireCache<EtatSynchroHevy>(db, utilisateur, CLES_CACHE.synchroHevy))?.valeur;
  return e ? { derniere_synchro: e.reussie_le, erreur: e.erreur } : null;
}

/** Séances commencées depuis `depuis`, pour la vérification des engagements. */
export async function lireSeances(db: D1Database, utilisateur: string, depuis: string) {
  const { results } = await db
    .prepare(`SELECT debut, fin FROM mesures WHERE utilisateur = ? AND type = 'seance' AND debut >= ? ORDER BY debut`)
    .bind(utilisateur, depuis)
    .all<{ debut: string; fin: string | null }>();
  return results.map((l) => ({ type: 'seance' as const, debut: l.debut, fin: l.fin }));
}
