// Bloc « Dormir » dans Google Agenda, tenu à jour par la tâche planifiée (CDC, décision du 02/11 ;
// docs/conception.md §4.4). Un événement par nuit, du coucher appliqué au lever prévu, pour la
// nuit de la journée en cours et la suivante. Rien n'est écrit chez Google si l'heure n'a pas
// changé depuis la dernière écriture (gardée dans le cache `synchro_agenda`) ; une nuit passée
// (lever atteint) n'est plus jamais modifiée.
import type { Contexte, Moteur } from '../../core/src/types';
import { type Chiffre, chiffrer, dechiffrer } from './chiffrement';
import { prendreVerrou, rendreVerrou } from './cache';
import { CLES_CACHE, ecrireCache, lireCache } from './contexte';
import type { Liaisons } from './env';
import { type ClientAgenda, ErreurAgenda, type IdentifiantsGoogle, type NuitAgenda } from './google-agenda';
import { ajouterJours, versInstant } from './temps';

/** Nuits tenues à jour : celle de la journée en cours (ce soir) et la suivante. */
export const NUITS_AGENDA = 2;
/** Suppressions au plus par passage (nuits sorties de la fenêtre sans être passées : rare). */
const SUPPRESSIONS_PAR_PASSAGE = 2;
/** Échéance du verrou : plus longue qu'un passage (délais réseau compris), courte devant la cadence. */
const VERROU_AGENDA_S = 5 * 60;

export interface EcritAgenda {
  debut: string;
  fin: string;
}

export interface EtatAgenda {
  tentee_le: string;
  reussie_le: string | null;
  erreur: string | null;
  /** Ce qui est écrit chez Google, par nuit (seulement les nuits pas encore passées). */
  nuits: Record<string, EcritAgenda>;
}

export interface ReglagesGoogle {
  identifiants: IdentifiantsGoogle;
  /** Seul utilisateur synchronisé : l'agenda Google est le sien. */
  utilisateur: string;
  /** Secret de chiffrement du refresh token gardé en base ; absent : un jeton reçu n'est pas gardé. */
  cle: string | null;
}

/** Les secrets, ou null : sans eux la synchro de l'agenda est désactivée. */
export function reglagesGoogle(env: Liaisons): ReglagesGoogle | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const refreshToken = env.GOOGLE_REFRESH_TOKEN?.trim();
  const utilisateur = env.GOOGLE_UTILISATEUR?.trim();
  if (!clientId || !clientSecret || !refreshToken || !utilisateur) return null;
  return { identifiants: { clientId, clientSecret, refreshToken }, utilisateur, cle: env.CLE_CHIFFREMENT?.trim() || null };
}

// ── « À resynchroniser » ──────────────────────────────────────────────────────

/**
 * Instruction (pour un `db.batch`) qui signale un changement du coucher ou du lever (exception,
 * « je vais dormir », config reçue, actualisation) : le prochain passage de la tâche planifiée
 * resynchronise l'agenda sans attendre sa cadence. Garde l'heure du dernier signal ; posée pour
 * tout utilisateur (une ligne), elle n'a d'effet que si l'agenda est configuré pour lui.
 */
export function instructionMarquerAgenda(db: D1Database, utilisateur: string, instant: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO cache_todoist (utilisateur, cle, valeur, maj_le) VALUES (?, ?, ?, ?)
       ON CONFLICT (utilisateur, cle) DO UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le`,
    )
    .bind(utilisateur, CLES_CACHE.agendaARefaire, JSON.stringify(instant), instant);
}

/**
 * Retard de la synchro de l'agenda (ms, ≥ 0), ou null si elle n'est pas due : jamais tentée,
 * changement signalé depuis le dernier passage, ou cadence atteinte (à 30 s près).
 */
export function retardAgenda(avant: EtatAgenda | undefined, marque: string | undefined, maintenant: Date, intervalleS: number): number | null {
  if (!avant) return 0;
  const t = maintenant.getTime();
  if (marque && marque >= avant.tentee_le) return Math.max(0, t - Date.parse(marque));
  const retard = t - Date.parse(avant.tentee_le) - intervalleS * 1000;
  return retard >= -30_000 ? Math.max(0, retard) : null;
}

// ── Nuits voulues ─────────────────────────────────────────────────────────────

/** Nuits de la fenêtre, pas encore passées (lever prévu dans le futur), coucher avant lever. */
export function nuitsVoulues(moteur: Moteur, contexte: Contexte, maintenant: Date): NuitAgenda[] {
  const courante = moteur.journeeCourante(contexte);
  const nuits: NuitAgenda[] = [];
  for (let k = 0; k < NUITS_AGENDA; k++) {
    const j = k === 0 ? courante : moteur.journee(contexte, ajouterJours(courante.date, k));
    if (Date.parse(j.leverSuivant) <= maintenant.getTime()) continue;
    if (Date.parse(j.coucherApplique) >= Date.parse(j.leverSuivant)) continue;
    nuits.push({ nuit: j.date, debut: j.coucherApplique, fin: j.leverSuivant, fuseau: j.fuseau });
  }
  return nuits;
}

// ── Refresh token tournant ────────────────────────────────────────────────────

const contexteJeton = (utilisateur: string, clientId: string) => `jeton_google:${utilisateur}:${clientId}`;

async function lireJetonGarde(db: D1Database, r: ReglagesGoogle, cle: string): Promise<string | null> {
  const c = (await lireCache<Chiffre>(db, r.utilisateur, CLES_CACHE.jetonGoogle))?.valeur;
  return c ? dechiffrer(cle, c, contexteJeton(r.utilisateur, r.identifiants.clientId)) : null;
}

async function garderJeton(db: D1Database, r: ReglagesGoogle, cle: string, jeton: string, maintenant: Date) {
  await ecrireCache(db, r.utilisateur, CLES_CACHE.jetonGoogle, await chiffrer(cle, jeton, contexteJeton(r.utilisateur, r.identifiants.clientId)), maintenant);
}

async function oublierJeton(db: D1Database, utilisateur: string) {
  await db.prepare(`DELETE FROM cache_todoist WHERE utilisateur = ? AND cle = ?`).bind(utilisateur, CLES_CACHE.jetonGoogle).run();
}

// ── Passage ───────────────────────────────────────────────────────────────────

/**
 * Un passage : compare les nuits voulues à ce qui est écrit, et n'appelle Google que pour une
 * différence (le jeton d'accès n'est demandé qu'à la première écriture). Verrou à échéance
 * `google_agenda:<utilisateur>` : deux passages simultanés ne font pas tourner le jeton ensemble.
 * Renvoie l'état écrit, ou null si un autre passage tient le verrou. Une erreur est notée dans
 * l'état puis relancée (la tâche planifiée la journalise) ; nouvel essai à la cadence suivante.
 */
export async function synchroniserAgenda(
  db: D1Database,
  fabrique: (identifiants: IdentifiantsGoogle) => ClientAgenda,
  reglages: ReglagesGoogle,
  moteur: Moteur,
  contexte: Contexte,
  maintenant: Date,
): Promise<EtatAgenda | null> {
  const verrou = `google_agenda:${reglages.utilisateur}`;
  const detenteur = await prendreVerrou(db, verrou, maintenant, VERROU_AGENDA_S);
  if (!detenteur) return null;
  try {
    return await synchroniserSousVerrou(db, fabrique, reglages, moteur, contexte, maintenant);
  } finally {
    await rendreVerrou(db, verrou, detenteur);
  }
}

async function synchroniserSousVerrou(
  db: D1Database,
  fabrique: (identifiants: IdentifiantsGoogle) => ClientAgenda,
  reglages: ReglagesGoogle,
  moteur: Moteur,
  contexte: Contexte,
  maintenant: Date,
): Promise<EtatAgenda> {
  const { utilisateur, identifiants, cle } = reglages;
  const avant = (await lireCache<EtatAgenda>(db, utilisateur, CLES_CACHE.synchroAgenda))?.valeur;
  const tentee = versInstant(maintenant);
  const t = maintenant.getTime();
  const ecrits: Record<string, EcritAgenda> = {};
  // Une nuit passée sort de l'état sans appel : elle n'est plus jamais modifiée.
  for (const [nuit, e] of Object.entries(avant?.nuits ?? {})) if (Date.parse(e.fin) > t) ecrits[nuit] = e;
  const etat: EtatAgenda = { tentee_le: tentee, reussie_le: avant?.reussie_le ?? null, erreur: null, nuits: ecrits };

  const voulues = nuitsVoulues(moteur, contexte, maintenant);
  const aEcrire = voulues.filter((n) => ecrits[n.nuit]?.debut !== n.debut || ecrits[n.nuit]?.fin !== n.fin);
  const aSupprimer = Object.keys(ecrits)
    .filter((nuit) => !voulues.some((n) => n.nuit === nuit))
    .slice(0, SUPPRESSIONS_PAR_PASSAGE);

  let garde: string | null = null;
  let client: ClientAgenda | null = null;
  let repli = false;
  const avecClient = async (action: (c: ClientAgenda) => Promise<void>) => {
    if (!client) {
      garde = cle ? await lireJetonGarde(db, reglages, cle) : null;
      client = fabrique(garde ? { ...identifiants, refreshToken: garde } : identifiants);
      repli = garde !== null;
    }
    try {
      await action(client);
    } catch (e) {
      if (!repli || !(e instanceof ErreurAgenda) || e.code !== 'jeton_google_revoque') throw e;
      // Jeton gardé refusé : on l'oublie et on revient au secret initial.
      repli = false;
      garde = null;
      await oublierJeton(db, utilisateur);
      client = fabrique(identifiants);
      await action(client);
    }
  };

  try {
    for (const n of aEcrire) {
      await avecClient((c) => c.ecrireNuit(n));
      ecrits[n.nuit] = { debut: n.debut, fin: n.fin };
    }
    for (const nuit of aSupprimer) {
      await avecClient((c) => c.supprimerNuit(nuit));
      delete ecrits[nuit];
    }
    etat.reussie_le = tentee;
    return etat;
  } catch (e) {
    etat.erreur = e instanceof ErreurAgenda ? e.code : 'erreur_interne';
    console.error(`Google Agenda (${utilisateur}) : ${e instanceof ErreurAgenda ? e.message : 'erreur interne'}`);
    throw e;
  } finally {
    await ecrireCache(db, utilisateur, CLES_CACHE.synchroAgenda, etat, maintenant);
    // Signal traité : effacé s'il date d'avant ce passage (un signal plus récent reste dû).
    await db
      .prepare(`DELETE FROM cache_todoist WHERE utilisateur = ? AND cle = ? AND valeur < ?`)
      .bind(utilisateur, CLES_CACHE.agendaARefaire, JSON.stringify(tentee))
      .run();
    const recu = (client as ClientAgenda | null)?.refreshTokenRecu?.() ?? null;
    if (cle && recu && recu !== garde) await garderJeton(db, reglages, cle, recu, maintenant);
  }
}

/** État compact pour GET /v1/statut ; null si jamais tentée (ou agenda non configuré). */
export async function etatSynchroAgenda(db: D1Database, utilisateur: string) {
  const e = (await lireCache<EtatAgenda>(db, utilisateur, CLES_CACHE.synchroAgenda))?.valeur;
  return e ? { derniere_synchro: e.reussie_le, erreur: e.erreur } : null;
}
