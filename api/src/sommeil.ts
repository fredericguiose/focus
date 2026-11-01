// Sommeil mesuré (Xiaomi) : synchronisation dans `mesures` et rattachement aux nuits (§4.4, §4.6).
import { CLES_CACHE, ecrireCache, lireCache } from './contexte';
import type { Liaisons } from './env';
import { dateLocale, decaler, versInstant } from './temps';
import {
  type ClientXiaomi,
  type ComplementsSommeil,
  ErreurXiaomi,
  type IdentifiantsXiaomi,
  type PhasesSommeil,
  type SessionSommeil,
} from './xiaomi';

export const JOURS_SYNCHRO = 3;
export const INTERVALLE_SYNCHRO_S = 3600;

export interface EtatSynchro {
  tentee_le: string;
  reussie_le: string | null;
  erreur: string | null;
  sessions: number;
}

/** Les trois secrets, ou null : sans eux la synchro est sautée. */
export function identifiantsXiaomi(env: Liaisons): IdentifiantsXiaomi | null {
  const userId = env.XIAOMI_USER_ID?.trim();
  const passToken = env.XIAOMI_PASS_TOKEN?.trim();
  if (!userId || !passToken) return null;
  return { userId, passToken, region: env.XIAOMI_REGION?.trim() ?? '' };
}

interface DetailsSommeil extends Partial<ComplementsSommeil> {
  eveille_min: number;
  phases: PhasesSommeil | null;
  score: number | null;
  sieste: boolean;
}

/** Insère ou met à jour chaque session par sa clé Xiaomi ; une ligne inchangée n'est pas réécrite. */
export async function enregistrerSessions(db: D1Database, utilisateur: string, sessions: SessionSommeil[], maintenant: Date) {
  if (sessions.length === 0) return;
  const recu = versInstant(maintenant);
  await db.batch(
    sessions.map((s) => {
      if (s.supprimee) {
        return db.prepare(`DELETE FROM mesures WHERE utilisateur = ? AND type = 'sommeil' AND source = 'xiaomi' AND cle = ?`).bind(utilisateur, s.id);
      }
      const details: DetailsSommeil = { eveille_min: s.eveille_min, phases: s.phases, score: s.score, sieste: s.sieste, ...s.complements };
      return db
        .prepare(
          `INSERT INTO mesures (utilisateur, type, source, cle, debut, fin, valeur, details, recu_le)
           VALUES (?, 'sommeil', 'xiaomi', ?, ?, ?, ?, ?, ?)
           ON CONFLICT (utilisateur, type, source, cle) DO UPDATE SET
             debut = excluded.debut, fin = excluded.fin, valeur = excluded.valeur, details = excluded.details, recu_le = excluded.recu_le
           WHERE mesures.debut IS NOT excluded.debut OR mesures.fin IS NOT excluded.fin
              OR mesures.valeur IS NOT excluded.valeur OR mesures.details IS NOT excluded.details`,
        )
        .bind(utilisateur, s.id, s.debut, s.fin, s.endormi_min, JSON.stringify(details), recu);
    }),
  );
}

/** Une fois par heure au plus : relit les 3 derniers jours. L'échec est noté puis relancé. */
export async function synchroniserSommeil(
  db: D1Database,
  client: ClientXiaomi,
  utilisateur: string,
  maintenant: Date,
  forcer = false,
): Promise<EtatSynchro | null> {
  const avant = (await lireCache<EtatSynchro>(db, utilisateur, CLES_CACHE.synchroXiaomi))?.valeur;
  if (!forcer && avant && maintenant.getTime() - Date.parse(avant.tentee_le) < INTERVALLE_SYNCHRO_S * 1000) return null;
  const tentee = versInstant(maintenant);
  try {
    const sessions = await client.sessionsSommeil(new Date(maintenant.getTime() - JOURS_SYNCHRO * 86_400_000), new Date(decaler(maintenant, 3600)));
    await enregistrerSessions(db, utilisateur, sessions, maintenant);
    const etat: EtatSynchro = { tentee_le: tentee, reussie_le: tentee, erreur: null, sessions: sessions.length };
    await ecrireCache(db, utilisateur, CLES_CACHE.synchroXiaomi, etat, maintenant);
    return etat;
  } catch (e) {
    const erreur = e instanceof ErreurXiaomi ? e.code : 'erreur_interne';
    await ecrireCache(db, utilisateur, CLES_CACHE.synchroXiaomi, { tentee_le: tentee, reussie_le: avant?.reussie_le ?? null, erreur, sessions: 0 }, maintenant);
    throw e;
  }
}

// ── Rattachement aux nuits ────────────────────────────────────────────────────

export interface SommeilMesure {
  debut: string;
  fin: string;
  endormi_min: number;
  phases: PhasesSommeil | null;
  sieste: boolean;
}

/**
 * Une nuit appartient au jour du soir : une session est rattachée à la date locale de son
 * milieu moins 12 h (23:00–07:00 et 02:00–10:00 tombent sur le soir de la veille du réveil).
 */
export function nuitDeLaSession(s: { debut: string; fin: string }, fuseau: string): string {
  const milieu = (Date.parse(s.debut) + Date.parse(s.fin)) / 2;
  return dateLocale(new Date(milieu - 12 * 3_600_000), fuseau);
}

export interface NuitMesuree {
  endormi_min: number;
  phases: PhasesSommeil | null;
}

/** Temps endormi et phases cumulés par nuit, siestes exclues. Une nuit sans session est absente. */
export function rattacherAuxNuits(sessions: SommeilMesure[], nuits: { nuit: string; fuseau: string }[]): Map<string, NuitMesuree> {
  const resultat = new Map<string, NuitMesuree>();
  for (const { nuit, fuseau } of nuits) {
    const siennes = sessions.filter((s) => !s.sieste && nuitDeLaSession(s, fuseau) === nuit);
    if (siennes.length === 0) continue;
    const avecPhases = siennes.filter((s) => s.phases !== null);
    resultat.set(nuit, {
      endormi_min: siennes.reduce((t, s) => t + s.endormi_min, 0),
      phases:
        avecPhases.length === 0
          ? null
          : avecPhases.reduce(
              (t, s) => ({
                legere: t.legere + s.phases!.legere,
                profonde: t.profonde + s.phases!.profonde,
                rem: t.rem + s.phases!.rem,
                eveil: t.eveil + s.phases!.eveil,
              }),
              { legere: 0, profonde: 0, rem: 0, eveil: 0 },
            ),
    });
  }
  return resultat;
}

export async function lireSommeil(db: D1Database, utilisateur: string, depuis: string): Promise<SommeilMesure[]> {
  const { results } = await db
    .prepare(
      `SELECT debut, fin, valeur, details FROM mesures
       WHERE utilisateur = ? AND type = 'sommeil' AND fin IS NOT NULL AND debut >= ? ORDER BY debut`,
    )
    .bind(utilisateur, depuis)
    .all<{ debut: string; fin: string; valeur: number | null; details: string | null }>();
  return results.map((l) => {
    const d = (l.details ? JSON.parse(l.details) : {}) as Partial<DetailsSommeil>;
    return { debut: l.debut, fin: l.fin, endormi_min: l.valeur ?? 0, phases: d.phases ?? null, sieste: d.sieste === true };
  });
}

export async function etatSynchro(db: D1Database, utilisateur: string) {
  const e = (await lireCache<EtatSynchro>(db, utilisateur, CLES_CACHE.synchroXiaomi))?.valeur;
  return e ? { derniere_synchro: e.reussie_le, erreur: e.erreur } : null;
}
