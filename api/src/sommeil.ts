// Sommeil mesuré (Xiaomi) : synchronisation dans `mesures` et rattachement aux nuits (§4.4, §4.6).
import { type Chiffre, chiffrer, dechiffrer } from './chiffrement';
import { invaliderCache, prendreVerrou, rendreVerrou } from './cache';
import { CLES_CACHE, ecrireCache, lireCache } from './contexte';
import type { Liaisons } from './env';
import { ajouterJours, dateLocale, decaler, versInstant } from './temps';
import {
  type ClientXiaomi,
  type ComplementsSommeil,
  ErreurXiaomi,
  type IdentifiantsXiaomi,
  type PhasesSommeil,
  type SessionSommeil,
} from './xiaomi';

export const JOURS_SYNCHRO = 3;
/** Cadence par défaut (config `synchro.xiaomi`, 15 min ; jamais sous 10 min : API non officielle). */
export const INTERVALLE_SYNCHRO_S = 15 * 60;
/** Rattrapage de l'historique : profondeur par défaut, taille d'une lecture, lectures par passage. */
export const JOURS_HISTORIQUE = 60;
export const JOURS_PAR_MORCEAU = 10;
export const MORCEAUX_PAR_PASSAGE = 2;
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
  const resultats = await db.batch(
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
  // Le sommeil mesuré change les levers et la dette : les résultats gardés sont périmés.
  if (resultats.some((r) => (r.meta.changes ?? 0) > 0)) await invaliderCache(db, utilisateur);
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
export function plagesALire(
  avant: EtatSynchro | undefined,
  maintenant: Date,
  depuis: string | null,
  aucuneMesure: boolean,
  forcer = false,
  intervalleS = INTERVALLE_SYNCHRO_S,
) {
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
  const recente = forcer || !avant?.recente_le || t - Date.parse(avant.recente_le) >= intervalleS * 1000 - 60_000;
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

/** Rattrapage en cours ou jamais lancé (état d'avant le rattrapage) : pas d'attente de la cadence. */
function rattrapageEnCours(avant: EtatSynchro | undefined): boolean {
  return !!avant && avant.erreur === null && (!!avant.rattrapage || !avant.rattrapage_lance_le);
}

/**
 * Retard de la synchro Xiaomi sur sa cadence (ms, ≥ 0), ou null si elle n'est pas due. La tâche
 * planifiée choisit, à chaque minute, la source la plus en retard (une seule source lourde par appel).
 */
export function retardSommeil(avant: EtatSynchro | undefined, maintenant: Date, intervalleS = INTERVALLE_SYNCHRO_S): number | null {
  if (!avant || rattrapageEnCours(avant)) return 0;
  const retard = maintenant.getTime() - Date.parse(avant.tentee_le) - intervalleS * 1000;
  return retard >= -30_000 ? Math.max(0, retard) : null;
}

/**
 * À la cadence `intervalleS` au plus (15 min par défaut) : relit les 3 derniers jours. Au premier
 * passage, ou si des nuits récentes manquent, rattrape l'historique par morceaux, un passage par
 * minute jusqu'au bout. L'échec est noté puis relancé au passage suivant. Un verrou à échéance
 * empêche deux passages simultanés (deux crons) de faire tourner le passToken en même temps.
 */
export async function synchroniserSommeil(
  db: D1Database,
  fabrique: (identifiants: IdentifiantsXiaomi) => ClientXiaomi,
  reglages: ReglagesXiaomi,
  maintenant: Date,
  forcer = false,
  intervalleS = INTERVALLE_SYNCHRO_S,
): Promise<EtatSynchro | null> {
  const verrou = `xiaomi:${reglages.utilisateur}`;
  const detenteur = await prendreVerrou(db, verrou, maintenant, VERROU_XIAOMI_S);
  if (!detenteur) return null;
  try {
    return await synchroniserSommeilSousVerrou(db, fabrique, reglages, maintenant, forcer, intervalleS);
  } finally {
    await rendreVerrou(db, verrou, detenteur);
  }
}

/** Échéance du verrou : plus longue qu'un passage (délais réseau compris), courte devant la cadence. */
const VERROU_XIAOMI_S = 5 * 60;

async function synchroniserSommeilSousVerrou(
  db: D1Database,
  fabrique: (identifiants: IdentifiantsXiaomi) => ClientXiaomi,
  reglages: ReglagesXiaomi,
  maintenant: Date,
  forcer: boolean,
  intervalleS: number,
): Promise<EtatSynchro | null> {
  const { utilisateur, identifiants, cle } = reglages;
  const avant = (await lireCache<EtatSynchro>(db, utilisateur, CLES_CACHE.synchroXiaomi))?.valeur;
  if (!forcer && retardSommeil(avant, maintenant, intervalleS) === null) return null;
  const aucuneMesure = !(await db
    .prepare(`SELECT 1 FROM mesures WHERE utilisateur = ? AND type = 'sommeil' AND source = 'xiaomi' LIMIT 1`)
    .bind(utilisateur)
    .first());
  const { plages, rattrapage, lance } = plagesALire(avant, maintenant, reglages.depuis, aucuneMesure, forcer, intervalleS);
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
  /** Début de la première tranche de sommeil (léger, profond, REM) de la chronologie, si Xiaomi la donne. */
  premier_sommeil?: string;
  /** Nuit imposée : rendormissement rattaché à la nuit de la session qu'il prolonge. */
  nuit?: string;
}

/** Un réveil suivi d'une nouvelle session moins d'une heure après n'est pas un lever (§4.6). */
export const RENDORMISSEMENT_MS = 60 * 60_000;

/**
 * Une nuit appartient au jour du soir : une session est rattachée à la date locale de son
 * milieu moins 12 h (23:00–07:00 et 02:00–10:00 tombent sur le soir de la veille du réveil).
 */
export function nuitDeLaSession(s: { debut: string; fin: string; nuit?: string }, fuseau: string): string {
  if (s.nuit !== undefined) return s.nuit;
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

/**
 * Sépare les siestes (par journée, dans l'ordre) des sessions de nuit. Une session qui commence
 * moins d'une heure après la fin d'une session de nuit est un rendormissement : elle prolonge la
 * nuit (même rattachement), même si elle tombe après le lever prévu ou que la montre la marque
 * sieste. Une vraie sieste (plus d'une heure après la nuit) reste une sieste.
 */
export function separerSiestes(sessions: SommeilMesure[], journees: JourneeDeVeille[], fuseau: string) {
  const nuits: SommeilMesure[] = [];
  const siestes = new Map<string, Sieste[]>();
  const ordre = [...sessions].sort((a, b) => Date.parse(a.debut) - Date.parse(b.debut));
  let derniereNuit: SommeilMesure | null = null;
  for (const s of ordre) {
    const prolonge: boolean = derniereNuit !== null && Date.parse(s.debut) - Date.parse(derniereNuit.fin) < RENDORMISSEMENT_MS;
    const jour = prolonge ? null : journeeDeLaSieste(s, journees, fuseau);
    if (jour === null) {
      const nuit: SommeilMesure = prolonge ? { ...s, sieste: false, nuit: nuitDeLaSession(derniereNuit!, fuseau) } : s;
      nuits.push(nuit);
      if (derniereNuit === null || Date.parse(nuit.fin) > Date.parse(derniereNuit.fin)) derniereNuit = nuit;
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
  /** Endormissement : premier sommeil de la première session de la nuit (son début à défaut). */
  endormissement: string;
}

/** Endormissement d'une session : sa première tranche de sommeil si la chronologie la donne, sinon son début. */
function endormissementDe(s: SommeilMesure): string {
  return s.premier_sommeil ?? s.debut;
}

/** Temps endormi et phases cumulés par nuit, siestes exclues. Une nuit sans session est absente. */
export function rattacherAuxNuits(sessions: SommeilMesure[], nuits: { nuit: string; fuseau: string }[]): Map<string, NuitMesuree> {
  const resultat = new Map<string, NuitMesuree>();
  for (const { nuit, fuseau } of nuits) {
    const siennes = sessions.filter((s) => !s.sieste && nuitDeLaSession(s, fuseau) === nuit);
    if (siennes.length === 0) continue;
    const avecPhases = siennes.filter((s) => s.phases !== null);
    const premiere = siennes.reduce((a, s) => (Date.parse(s.debut) < Date.parse(a.debut) ? s : a));
    resultat.set(nuit, {
      endormi_min: siennes.reduce((t, s) => t + s.endormi_min, 0),
      endormissement: endormissementDe(premiere),
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

/** Requête des sessions de sommeil terminées depuis `depuis` (pour un `db.batch`). */
export function requeteSommeil(db: D1Database, utilisateur: string, depuis: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT debut, fin, valeur, details FROM mesures
       WHERE utilisateur = ? AND type = 'sommeil' AND fin IS NOT NULL AND debut >= ? ORDER BY debut`,
    )
    .bind(utilisateur, depuis);
}

export interface LigneSommeil {
  debut: string;
  fin: string;
  valeur: number | null;
  details: string | null;
}

/** Phases de sommeil de la chronologie (l'éveil n'en est pas une). */
const PHASES_ENDORMIES = new Set(['legere', 'profonde', 'rem']);

export function versSommeilMesure(l: LigneSommeil): SommeilMesure {
  const d = (l.details ? JSON.parse(l.details) : {}) as Partial<DetailsSommeil>;
  const premier = Array.isArray(d.chronologie) ? d.chronologie.find((t) => t.phase !== null && PHASES_ENDORMIES.has(t.phase)) : undefined;
  return {
    debut: l.debut,
    fin: l.fin,
    endormi_min: l.valeur ?? 0,
    phases: d.phases ?? null,
    sieste: d.sieste === true,
    incomplete: d.incomplete === true,
    ...(premier ? { premier_sommeil: premier.debut } : {}),
  };
}

export async function lireSommeil(db: D1Database, utilisateur: string, depuis: string): Promise<SommeilMesure[]> {
  const { results } = await requeteSommeil(db, utilisateur, depuis).all<LigneSommeil>();
  return results.map(versSommeilMesure);
}

/**
 * Lever mesuré de chaque jour (§3.1) : fin de la dernière session de la nuit principale de la
 * veille, siestes exclues comme pour la dette réelle, rendormissements (nouvelle session moins
 * d'une heure après) inclus. Les journées servent à reconnaître les siestes : ce sont celles du
 * plan, sans mesure (sinon le lever dépendrait de lui-même). Une nuit marquée incomplète par la
 * montre (montre retirée, batterie) ne donne pas de lever : sa fin n'est pas un réveil sûr. Une
 * nuit dont la dernière session a fini il y a moins d'une heure non plus : un rendormissement
 * peut encore suivre. Le lever mesuré ne sert qu'aux jours suivants, jamais à finir la nuit en
 * cours (CDC §4, 01/11).
 */
export function leversMesures(sessions: SommeilMesure[], journees: JourneeDeVeille[], maintenant?: Date): Record<string, string> {
  const fuseau = journees.at(-1)?.fuseau;
  if (!fuseau) return {};
  const dates = new Set(journees.map((j) => j.date));
  const parNuit = new Map<string, SommeilMesure[]>();
  for (const s of separerSiestes(sessions, journees, fuseau).nuits) {
    const nuit = nuitDeLaSession(s, fuseau);
    parNuit.set(nuit, [...(parNuit.get(nuit) ?? []), s]);
  }
  const levers: Record<string, string> = {};
  for (const [nuit, siennes] of parNuit) {
    const date = ajouterJours(nuit, 1);
    if (!dates.has(date) || siennes.some((s) => s.incomplete === true)) continue;
    const fin = siennes.reduce((f, s) => (Date.parse(s.fin) > Date.parse(f) ? s.fin : f), siennes[0]!.fin);
    if (maintenant && maintenant.getTime() - Date.parse(fin) < RENDORMISSEMENT_MS) continue;
    levers[date] = fin;
  }
  return levers;
}

export async function etatSynchro(db: D1Database, utilisateur: string) {
  const e = (await lireCache<EtatSynchro>(db, utilisateur, CLES_CACHE.synchroXiaomi))?.valeur;
  return e ? { derniere_synchro: e.reussie_le, erreur: e.erreur } : null;
}
