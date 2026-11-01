// Sommeil mesuré (Xiaomi) : synchronisation dans `mesures` et rattachement aux nuits (§4.4, §4.6).
import { type Chiffre, chiffrer, dechiffrer } from './chiffrement';
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
/** Rattrapage de l'historique : profondeur par défaut, taille d'une lecture, lectures par passage. */
export const JOURS_HISTORIQUE = 60;
export const JOURS_PAR_MORCEAU = 10;
export const MORCEAUX_PAR_PASSAGE = 3;
const RECOUVREMENT_MS = 12 * 3_600_000;
const JOUR_MS = 86_400_000;

export interface EtatSynchro {
  tentee_le: string;
  reussie_le: string | null;
  erreur: string | null;
  sessions: number;
  /** Dernière lecture réussie des 3 derniers jours. */
  recente_le?: string | null;
  /** Rattrapage en cours : reste à lire [depuis, curseur]. */
  rattrapage?: { depuis: string; curseur: string } | null;
  rattrapage_lance_le?: string | null;
}

export interface ReglagesXiaomi {
  identifiants: IdentifiantsXiaomi;
  /** Seul utilisateur synchronisé : le compte Xiaomi est le sien. */
  utilisateur: string;
  /** Début du rattrapage (date AAAA-MM-JJ, UTC) ; absent : 60 jours en arrière. */
  depuis: string | null;
  /** Secret de chiffrement du passToken gardé en base ; absent : le jeton reçu n'est pas gardé. */
  cle: string | null;
}

/** Les secrets, ou null : sans eux (ou sans utilisateur rattaché) la synchro est sautée. */
export function reglagesXiaomi(env: Liaisons): ReglagesXiaomi | null {
  const userId = env.XIAOMI_USER_ID?.trim();
  const passToken = env.XIAOMI_PASS_TOKEN?.trim();
  const utilisateur = env.XIAOMI_UTILISATEUR?.trim();
  if (!userId || !passToken || !utilisateur) return null;
  const depuis = env.XIAOMI_DEPUIS?.trim();
  return {
    identifiants: { userId, passToken, region: env.XIAOMI_REGION?.trim() ?? '' },
    utilisateur,
    depuis: depuis && /^\d{4}-\d{2}-\d{2}$/.test(depuis) ? depuis : null,
    cle: env.CLE_CHIFFREMENT?.trim() || null,
  };
}

// ── passToken tournant ────────────────────────────────────────────────────────

const contexteJeton = (utilisateur: string, userId: string) => `jeton_xiaomi:${utilisateur}:${userId}`;

export async function lireJetonGarde(db: D1Database, utilisateur: string, userId: string, cle: string): Promise<string | null> {
  const c = (await lireCache<Chiffre>(db, utilisateur, CLES_CACHE.jetonXiaomi))?.valeur;
  return c ? dechiffrer(cle, c, contexteJeton(utilisateur, userId)) : null;
}

async function garderJeton(db: D1Database, utilisateur: string, userId: string, cle: string, jeton: string, maintenant: Date) {
  await ecrireCache(db, utilisateur, CLES_CACHE.jetonXiaomi, await chiffrer(cle, jeton, contexteJeton(utilisateur, userId)), maintenant);
}

async function oublierJeton(db: D1Database, utilisateur: string) {
  await db.prepare(`DELETE FROM cache_todoist WHERE utilisateur = ? AND cle = ?`).bind(utilisateur, CLES_CACHE.jetonXiaomi).run();
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

interface Plage {
  debut: Date;
  fin: Date;
  /** Curseur du rattrapage une fois la plage lue ; absent pour la lecture récente. */
  curseur?: string;
}

/**
 * Les plages à lire à ce passage : les 3 derniers jours (une fois par heure), puis au plus
 * MORCEAUX_PAR_PASSAGE morceaux du rattrapage, du plus récent au plus ancien.
 */
export function plagesALire(avant: EtatSynchro | undefined, maintenant: Date, depuis: string | null, aucuneMesure: boolean, forcer = false) {
  const t = maintenant.getTime();
  const recentDebut = t - JOURS_SYNCHRO * JOUR_MS;
  const cible = depuis ? Date.parse(`${depuis}T00:00:00Z`) : t - JOURS_HISTORIQUE * JOUR_MS;
  let rattrapage = avant?.rattrapage ?? null;
  let lance = avant?.rattrapage_lance_le ?? null;
  if (!rattrapage) {
    const derniere = avant?.recente_le ?? avant?.reussie_le ?? null;
    if (!lance || (aucuneMesure && t - Date.parse(lance) >= JOUR_MS)) {
      rattrapage = { depuis: versInstant(new Date(cible)), curseur: versInstant(new Date(recentDebut)) };
      lance = versInstant(maintenant);
    } else if (derniere && Date.parse(derniere) < recentDebut) {
      // Des nuits récentes manquent : la synchro n'a pas tourné pendant plus de 3 jours.
      rattrapage = { depuis: versInstant(new Date(Math.max(cible, Date.parse(derniere) - JOUR_MS))), curseur: versInstant(new Date(recentDebut)) };
      lance = versInstant(maintenant);
    }
  }
  if (rattrapage && rattrapage.curseur <= rattrapage.depuis) rattrapage = null;
  const plages: Plage[] = [];
  const recente = forcer || !avant?.recente_le || t - Date.parse(avant.recente_le) >= INTERVALLE_SYNCHRO_S * 1000 - 60_000;
  if (recente) plages.push({ debut: new Date(recentDebut), fin: new Date(decaler(maintenant, 3600)) });
  if (rattrapage) {
    let curseur = Date.parse(rattrapage.curseur);
    const fin = Date.parse(rattrapage.depuis);
    for (let k = 0; k < MORCEAUX_PAR_PASSAGE && curseur > fin; k++) {
      const debut = Math.max(fin, curseur - JOURS_PAR_MORCEAU * JOUR_MS);
      plages.push({ debut: new Date(debut), fin: new Date(curseur + RECOUVREMENT_MS), curseur: versInstant(new Date(debut)) });
      curseur = debut;
    }
  }
  return { plages, rattrapage, lance };
}

/**
 * Une fois par heure au plus : relit les 3 derniers jours. Au premier passage, ou si des nuits
 * récentes manquent, rattrape l'historique par morceaux, un passage par minute jusqu'au bout.
 * L'échec est noté puis relancé l'heure suivante.
 */
export async function synchroniserSommeil(
  db: D1Database,
  fabrique: (identifiants: IdentifiantsXiaomi) => ClientXiaomi,
  reglages: ReglagesXiaomi,
  maintenant: Date,
  forcer = false,
): Promise<EtatSynchro | null> {
  const { utilisateur, identifiants, cle } = reglages;
  const avant = (await lireCache<EtatSynchro>(db, utilisateur, CLES_CACHE.synchroXiaomi))?.valeur;
  // Rattrapage en cours ou jamais lancé (état d'avant le rattrapage) : pas d'attente d'une heure.
  const enCours = !!avant && avant.erreur === null && (!!avant.rattrapage || !avant.rattrapage_lance_le);
  if (!forcer && avant && !enCours && maintenant.getTime() - Date.parse(avant.tentee_le) < INTERVALLE_SYNCHRO_S * 1000) return null;
  const aucuneMesure = !(await db
    .prepare(`SELECT 1 FROM mesures WHERE utilisateur = ? AND type = 'sommeil' AND source = 'xiaomi' LIMIT 1`)
    .bind(utilisateur)
    .first());
  const { plages, rattrapage, lance } = plagesALire(avant, maintenant, reglages.depuis, aucuneMesure, forcer);
  if (plages.length === 0) return null;

  const tentee = versInstant(maintenant);
  const etat: EtatSynchro = {
    tentee_le: tentee,
    reussie_le: avant?.reussie_le ?? null,
    erreur: null,
    sessions: 0,
    recente_le: avant?.recente_le ?? null,
    rattrapage,
    rattrapage_lance_le: lance,
  };

  let garde = cle ? await lireJetonGarde(db, utilisateur, identifiants.userId, cle) : null;
  let client = fabrique(garde ? { ...identifiants, passToken: garde } : identifiants);
  let repli = garde !== null;
  const lire = async (p: Plage) => {
    try {
      return await client.sessionsSommeil(p.debut, p.fin);
    } catch (e) {
      if (!repli || !(e instanceof ErreurXiaomi) || e.code !== 'jeton_xiaomi_expire') throw e;
      // Jeton gardé refusé : on l'oublie et on revient au secret initial.
      repli = false;
      garde = null;
      await oublierJeton(db, utilisateur);
      client = fabrique(identifiants);
      return client.sessionsSommeil(p.debut, p.fin);
    }
  };

  try {
    for (const p of plages) {
      const sessions = await lire(p);
      await enregistrerSessions(db, utilisateur, sessions, maintenant);
      etat.sessions += sessions.length;
      if (p.curseur === undefined) etat.recente_le = tentee;
      else if (etat.rattrapage) etat.rattrapage = p.curseur > etat.rattrapage.depuis ? { ...etat.rattrapage, curseur: p.curseur } : null;
    }
    etat.reussie_le = tentee;
    return etat;
  } catch (e) {
    etat.erreur = e instanceof ErreurXiaomi ? e.code : 'erreur_interne';
    throw e;
  } finally {
    await ecrireCache(db, utilisateur, CLES_CACHE.synchroXiaomi, etat, maintenant);
    const recu = client.passTokenRecu?.() ?? null;
    if (cle && recu && recu !== garde) await garderJeton(db, utilisateur, identifiants.userId, cle, recu, maintenant);
  }
}

// ── Rattachement aux nuits ────────────────────────────────────────────────────

export interface SommeilMesure {
  debut: string;
  fin: string;
  endormi_min: number;
  phases: PhasesSommeil | null;
  sieste: boolean;
  /** Xiaomi marque la session incomplète (montre retirée, batterie…). */
  incomplete?: boolean;
}

/**
 * Une nuit appartient au jour du soir : une session est rattachée à la date locale de son
 * milieu moins 12 h (23:00–07:00 et 02:00–10:00 tombent sur le soir de la veille du réveil).
 */
export function nuitDeLaSession(s: { debut: string; fin: string }, fuseau: string): string {
  const milieu = (Date.parse(s.debut) + Date.parse(s.fin)) / 2;
  return dateLocale(new Date(milieu - 12 * 3_600_000), fuseau);
}

/** Journée de veille D : du lever de D au coucher appliqué de D (moteur). */
export interface JourneeDeVeille {
  date: string;
  fuseau: string;
  lever: string;
  coucher: string;
}

export interface Sieste {
  debut: string;
  fin: string;
  minutes: number;
}

/**
 * Journée de la sieste, ou null si la session est une nuit. Sieste : marquée comme telle par
 * Xiaomi, ou entièrement comprise entre le lever et le coucher appliqué d'une journée D (Xiaomi
 * ne marque pas toujours ses siestes). Une sieste marquée hors de toute journée connue appartient
 * à la date locale de son milieu.
 */
export function journeeDeLaSieste(s: { debut: string; fin: string; sieste: boolean }, journees: JourneeDeVeille[], fuseau: string): string | null {
  const debut = Date.parse(s.debut);
  const fin = Date.parse(s.fin);
  const dans = journees.find((j) => debut >= Date.parse(j.lever) && fin <= Date.parse(j.coucher));
  if (dans) return dans.date;
  if (!s.sieste) return null;
  const milieu = (debut + fin) / 2;
  const contient = journees.find((j) => milieu >= Date.parse(j.lever) && milieu < Date.parse(j.coucher));
  return contient?.date ?? dateLocale(new Date(milieu), fuseau);
}

/** Sépare les siestes (par journée, dans l'ordre) des sessions de nuit. */
export function separerSiestes(sessions: SommeilMesure[], journees: JourneeDeVeille[], fuseau: string) {
  const nuits: SommeilMesure[] = [];
  const siestes = new Map<string, Sieste[]>();
  for (const s of sessions) {
    const jour = journeeDeLaSieste(s, journees, fuseau);
    if (jour === null) {
      nuits.push(s);
      continue;
    }
    const liste = siestes.get(jour) ?? [];
    liste.push({ debut: s.debut, fin: s.fin, minutes: s.endormi_min });
    siestes.set(jour, liste);
  }
  return { nuits, siestes };
}

export interface NuitMesuree {
  endormi_min: number;
  phases: PhasesSommeil | null;
  incomplete: boolean;
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
      incomplete: siennes.some((s) => s.incomplete === true),
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
    return {
      debut: l.debut,
      fin: l.fin,
      endormi_min: l.valeur ?? 0,
      phases: d.phases ?? null,
      sieste: d.sieste === true,
      incomplete: d.incomplete === true,
    };
  });
}

export async function etatSynchro(db: D1Database, utilisateur: string) {
  const e = (await lireCache<EtatSynchro>(db, utilisateur, CLES_CACHE.synchroXiaomi))?.valeur;
  return e ? { derniere_synchro: e.reussie_le, erreur: e.erreur } : null;
}
