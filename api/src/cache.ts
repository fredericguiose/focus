// Résultats calculés gardés 60 s (docs/conception.md §4.7) et verrous à échéance.
//
// Le plan gratuit de Workers donne 10 ms de CPU par appel ; le statut complet en demande
// davantage. Les clients interrogent toutes les minutes au plus : un résultat de moins de 60 s
// suffit (décision du 01/11). Toute écriture qui change l'état de l'utilisateur efface ses
// lignes (`invaliderCache`) ; l'échéance borne le reste (une heure de bascule qui passe).
import { versInstant } from './temps';

export const DUREE_CACHE_S = 60;

export const CLES_CALCUL = {
  statut: 'statut',
  planning: (appareil: string) => `planning:${appareil}`,
} as const;

/** Ligne témoin : un compteur augmenté à chaque invalidation (jamais effacé avec les résultats). */
const GENERATION = '~generation';

export interface CalculGarde<T> {
  valeur: T | null;
  /** Génération lue : à rendre à `ecrireCalcul`. */
  generation: string;
}

export async function lireCalcul<T>(db: D1Database, utilisateur: string, cle: string, maintenant: Date): Promise<CalculGarde<T>> {
  const t = versInstant(maintenant);
  const { results } = await db
    .prepare(`SELECT cle, valeur, calcule_le, expire_le FROM cache_calculs WHERE utilisateur = ? AND cle IN (?, ?)`)
    .bind(utilisateur, cle, GENERATION)
    .all<{ cle: string; valeur: string; calcule_le: string; expire_le: string }>();
  const generation = results.find((l) => l.cle === GENERATION)?.valeur ?? '0';
  const ligne = results.find((l) => l.cle === cle && l.calcule_le <= t && t < l.expire_le);
  return { valeur: ligne ? (JSON.parse(ligne.valeur) as T) : null, generation };
}

/**
 * Garde un résultat jusqu'à `expire` (au plus 60 s). N'écrit rien si une écriture d'état a eu
 * lieu depuis la lecture de `generation` : le résultat serait déjà périmé.
 */
export async function ecrireCalcul(
  db: D1Database,
  utilisateur: string,
  cle: string,
  generation: string,
  valeur: unknown,
  maintenant: Date,
  expire: number = maintenant.getTime() + DUREE_CACHE_S * 1000,
): Promise<void> {
  const fin = Math.min(expire, maintenant.getTime() + DUREE_CACHE_S * 1000);
  if (fin <= maintenant.getTime()) return;
  await db
    .prepare(
      `INSERT INTO cache_calculs (utilisateur, cle, valeur, calcule_le, expire_le)
       SELECT ?1, ?2, ?3, ?4, ?5
       WHERE COALESCE((SELECT valeur FROM cache_calculs WHERE utilisateur = ?1 AND cle = ?6), '0') = ?7
       ON CONFLICT (utilisateur, cle) DO UPDATE SET valeur = excluded.valeur, calcule_le = excluded.calcule_le, expire_le = excluded.expire_le`,
    )
    .bind(utilisateur, cle, JSON.stringify(valeur), versInstant(maintenant), versInstant(fin), GENERATION, generation)
    .run();
}

/** Instructions (pour un `db.batch`) qui effacent les résultats gardés de l'utilisateur. */
export function instructionsInvalider(db: D1Database, utilisateur: string): D1PreparedStatement[] {
  return [
    db.prepare(`DELETE FROM cache_calculs WHERE utilisateur = ? AND cle <> ?`).bind(utilisateur, GENERATION),
    db
      .prepare(
        `INSERT INTO cache_calculs (utilisateur, cle, valeur, calcule_le, expire_le) VALUES (?, ?, '1', '', '9999')
         ON CONFLICT (utilisateur, cle) DO UPDATE SET valeur = CAST(CAST(cache_calculs.valeur AS INTEGER) + 1 AS TEXT)`,
      )
      .bind(utilisateur, GENERATION),
  ];
}

export async function invaliderCache(db: D1Database, utilisateur: string): Promise<void> {
  await db.batch(instructionsInvalider(db, utilisateur));
}

/** Horloge de développement réglée : tous les résultats gardés sont faux. */
export async function invaliderTout(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM cache_calculs WHERE cle <> ?`).bind(GENERATION),
    db.prepare(`UPDATE cache_calculs SET valeur = CAST(CAST(valeur AS INTEGER) + 1 AS TEXT) WHERE cle = ?`).bind(GENERATION),
  ]);
}

// ── Verrous ───────────────────────────────────────────────────────────────────

/**
 * Prend le verrou `nom` jusqu'à `maintenant + dureeS` s'il est libre ou échu. Renvoie l'identifiant
 * du détenteur, ou null si un autre le tient. L'échéance libère un verrou dont le détenteur est mort.
 */
export async function prendreVerrou(db: D1Database, nom: string, maintenant: Date, dureeS: number): Promise<string | null> {
  const detenteur = crypto.randomUUID();
  const t = versInstant(maintenant);
  await db
    .prepare(
      `INSERT INTO verrous (nom, detenteur, expire_le) VALUES (?, ?, ?)
       ON CONFLICT (nom) DO UPDATE SET detenteur = excluded.detenteur, expire_le = excluded.expire_le
       WHERE verrous.expire_le <= ?`,
    )
    .bind(nom, detenteur, versInstant(maintenant.getTime() + dureeS * 1000), t)
    .run();
  const ligne = await db.prepare(`SELECT detenteur FROM verrous WHERE nom = ?`).bind(nom).first<{ detenteur: string }>();
  return ligne?.detenteur === detenteur ? detenteur : null;
}

export async function rendreVerrou(db: D1Database, nom: string, detenteur: string): Promise<void> {
  await db.prepare(`DELETE FROM verrous WHERE nom = ? AND detenteur = ?`).bind(nom, detenteur).run();
}
