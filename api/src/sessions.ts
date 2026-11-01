// Sessions de travail (conception §4.5). Rien de calculable n'est stocké : le plafond du jour
// et le rang des « continue » sont recalculés depuis les tables à chaque demande.
import type { Config, Contexte, Instant, Journee, Moteur, Tache } from '../../core/src/types';
import { instructionsInvalider } from './cache';
import { chargerContexte, nouvelIdentifiant } from './contexte';
import type { Dependances, JetonAuthentifie } from './env';
import { ErreurApi, requeteInvalide } from './erreurs';
import { decaler, heureLocale, ms, versInstant } from './temps';
import { type Corps, listeDeTextes, texte } from './validation';

type MotifFin = 'fermee' | 'arretee' | 'sans_reponse' | 'tache_terminee' | 'mode_interdit' | 'plafond_atteint';

interface LigneSession {
  id: string;
  type: 'travail' | 'recherche_rapide';
  tache_id: string | null;
  tache_nom: string | null;
  appareil: string;
  apps: string;
  ouverte_le: string;
  fermee_le: string | null;
  motif_fin: MotifFin | null;
}

interface LigneQuestion {
  id: string;
  posee_a: string;
  attente_s: number;
  expire_a: string;
}

interface SessionChargee {
  session: LigneSession;
  /** La question sans réponse, s'il y en a une (jamais plus d'une à la fois). */
  question: LigneQuestion | null;
}

export interface VueSession {
  id: string;
  type: LigneSession['type'];
  tache: { id: string; nom: string } | null;
  appareil: string;
  apps: string[];
  domaines?: string[];
  identifiants_iphone?: string[];
  ouverte_le: string;
  fermee_le: string | null;
  motif_fin: MotifFin | null;
  question: { id: string; posee_a: string; attente_s: number; expire_a: string } | null;
  /**
   * Session ouverte : l'instant où elle sera fermée quoi qu'on réponde (plafond quotidien atteint,
   * ou début d'un mode qui interdit les sessions sur son appareil), dans l'horizon du planning ;
   * null si rien ne la ferme d'ici là. Le client cesse de libérer ses apps à cet instant.
   */
  fin_au_plus_tard: string | null;
}

const COLONNES_SESSION = `s.id, s.type, s.tache_id, s.tache_nom, s.appareil, s.apps, s.ouverte_le, s.fermee_le, s.motif_fin`;

async function chargerSessions(db: D1Database, utilisateur: string, filtre: string, valeurs: unknown[]): Promise<SessionChargee[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLONNES_SESSION}, q.id AS q_id, q.posee_a, q.attente_s, q.expire_a
       FROM sessions s
       LEFT JOIN questions q ON q.session_id = s.id AND q.reponse IS NULL AND s.fermee_le IS NULL
       WHERE s.utilisateur = ? AND ${filtre}
       ORDER BY s.ouverte_le`,
    )
    .bind(utilisateur, ...valeurs)
    .all<LigneSession & { q_id: string | null; posee_a: string; attente_s: number; expire_a: string }>();
  return results.map(({ q_id, posee_a, attente_s, expire_a, ...session }) => ({
    session,
    question: q_id ? { id: q_id, posee_a, attente_s, expire_a } : null,
  }));
}

function instructionsFermeture(db: D1Database, s: SessionChargee, fin: Instant, motif: MotifFin): D1PreparedStatement[] {
  const instructions = [
    db.prepare(`UPDATE sessions SET fermee_le = ?, motif_fin = ? WHERE id = ? AND fermee_le IS NULL`).bind(fin, motif, s.session.id),
  ];
  // Une question déjà posée et restée sans réponse est notée « aucune » ; une question pas
  // encore posée n'a jamais existé pour l'utilisateur et reste vide.
  if (s.question && ms(s.question.posee_a) <= ms(fin)) {
    instructions.push(db.prepare(`UPDATE questions SET reponse = 'aucune' WHERE id = ? AND reponse IS NULL`).bind(s.question.id));
  }
  return instructions;
}

/** Horizon dans lequel on cherche le prochain mode qui interdit les sessions (celui du planning). */
const HORIZON_FIN_H = 36;

/** Secondes de session de travail entre `debut` et `maintenant`, sur les lignes données. */
function cumulDepuis(lignes: Pick<LigneSession, 'type' | 'ouverte_le' | 'fermee_le'>[], debut: number, maintenant: number): number {
  const total = lignes.reduce((somme, s) => {
    if (s.type !== 'travail') return somme;
    const fin = Math.min(s.fermee_le ? ms(s.fermee_le) : maintenant, maintenant);
    return somme + Math.max(0, fin - Math.max(ms(s.ouverte_le), debut));
  }, 0);
  return Math.floor(total / 1000);
}

/** Premier instant ≥ `depuis` où le mode de l'appareil interdit les sessions, selon le planning calculé à `depuis`. */
function debutInterdiction(moteur: Moteur, contexte: Contexte, appareil: string, depuis: number, horizonH: number): number | null {
  if (!contexte.config.appareils[appareil]) return depuis;
  const segments = moteur.planifier({ ...contexte, maintenant: versInstant(depuis) }, appareil, Math.max(horizonH, 1 / 60));
  const interdit = segments.find((g) => g.sessions === 'interdites');
  return interdit ? Math.max(ms(interdit.debut), depuis) : null;
}

export interface Fermetures {
  /** Sessions encore ouvertes. */
  restantes: SessionChargee[];
  /** Fin au plus tard de chaque session restante (id → instant ou null). */
  fins: Map<string, string | null>;
}

/**
 * Ferme les sessions dont la question a expiré sans réponse, dont la tâche est terminée, dont
 * l'appareil est passé dans un mode qui interdit les sessions (nuit, journée verrouillée), ou qui
 * ont atteint le plafond quotidien. Appelée par la tâche planifiée et avant chaque lecture : le
 * résultat ne dépend pas de qui passe en premier. Renvoie les sessions encore ouvertes et, pour
 * chacune, l'instant où elle sera fermée quoi qu'il arrive (`fin_au_plus_tard`).
 */
export async function cloturerEchues(db: D1Database, moteur: Moteur, contexte: Contexte, utilisateur: string, maintenant: Date): Promise<Fermetures> {
  const t = maintenant.getTime();
  const journee = moteur.journeeCourante(contexte);
  const lever = ms(journee.lever);
  const lues = await chargerSessions(db, utilisateur, 's.fermee_le IS NULL OR s.fermee_le > ?', [journee.lever]);
  const ouvertes = lues.filter((s) => s.session.fermee_le === null);
  const terminees = new Map(contexte.faits.taches.filter((x) => x.terminee).map((x) => [x.id, x]));
  const plafondS = contexte.config.sessions.plafondQuotidienMin * 60;
  // Plafond : le cumul du jour avance d'autant de secondes par seconde qu'il y a de sessions de travail ouvertes.
  const enCours = ouvertes.filter((s) => s.session.type === 'travail' && ms(s.session.ouverte_le) <= t);
  const resteS = plafondS - cumulDepuis(lues.map((x) => x.session), lever, t);
  const plafondA = enCours.length === 0 ? null : t + (resteS * 1000) / enCours.length;

  const instructions: D1PreparedStatement[] = [];
  const restantes: SessionChargee[] = [];
  const fins = new Map<string, string | null>();
  for (const s of ouvertes) {
    const ouverture = ms(s.session.ouverte_le);
    const candidates: { fin: number; motif: MotifFin }[] = [];
    if (s.question && t >= ms(s.question.expire_a)) {
      candidates.push({ fin: ms(s.question.expire_a), motif: 'sans_reponse' });
    }
    const tache = s.session.tache_id ? terminees.get(s.session.tache_id) : undefined;
    if (tache) {
      const termineeLe = tache.termineeLe ? Math.min(ms(tache.termineeLe), t) : t;
      candidates.push({ fin: Math.max(termineeLe, ouverture), motif: 'tache_terminee' });
    }
    const travail = s.session.type === 'travail' && ouverture <= t;
    if (travail && plafondA !== null && plafondA <= t) candidates.push({ fin: Math.max(plafondA, ouverture), motif: 'plafond_atteint' });
    // Mode qui interdit les sessions maintenant : la session finit au début de l'interdiction.
    const interditMaintenant = !contexte.config.appareils[s.session.appareil] || moteur.etat(contexte, s.session.appareil).sessions === 'interdites';
    if (interditMaintenant) {
      const depuis = Math.min(ouverture, t);
      const debut = debutInterdiction(moteur, contexte, s.session.appareil, depuis, (t - depuis) / 3_600_000 + 1 / 60);
      candidates.push({ fin: Math.min(debut ?? t, t), motif: 'mode_interdit' });
    }
    if (candidates.length === 0) {
      restantes.push(s);
      const prochaine = debutInterdiction(moteur, contexte, s.session.appareil, t, HORIZON_FIN_H);
      const finPlafond = travail && plafondA !== null ? plafondA : null;
      const fin = [prochaine, finPlafond].filter((x): x is number => x !== null);
      fins.set(s.session.id, fin.length > 0 ? versInstant(Math.ceil(Math.min(...fin) / 1000) * 1000) : null);
      continue;
    }
    const premiere = candidates.reduce((a, b) => (b.fin < a.fin ? b : a));
    instructions.push(...instructionsFermeture(db, s, versInstant(Math.floor(premiere.fin / 1000) * 1000), premiere.motif));
  }
  if (instructions.length > 0) await db.batch([...instructions, ...instructionsInvalider(db, utilisateur)]);
  return { restantes, fins };
}

export function vueSession(config: Config, s: SessionChargee, finAuPlusTard: string | null = null): VueSession {
  const apps = JSON.parse(s.session.apps) as string[];
  const iphone = config.appareils[s.session.appareil]?.type === 'iphone';
  const catalogue = apps.map((id) => config.apps[id]).filter((a) => a !== undefined);
  return {
    id: s.session.id,
    type: s.session.type,
    tache: s.session.tache_id ? { id: s.session.tache_id, nom: s.session.tache_nom ?? '' } : null,
    appareil: s.session.appareil,
    apps,
    ...(iphone
      ? { identifiants_iphone: [...new Set(catalogue.flatMap((a) => (a.iphone ? [a.iphone] : [])))].sort() }
      : { domaines: [...new Set(catalogue.flatMap((a) => a.domaines))].sort() }),
    ouverte_le: s.session.ouverte_le,
    fermee_le: s.session.fermee_le,
    motif_fin: s.session.motif_fin,
    question: s.question && !s.session.fermee_le ? { ...s.question } : null,
    fin_au_plus_tard: s.session.fermee_le ? null : finAuPlusTard,
  };
}

/** Secondes de session de travail cumulées depuis le lever de la journée courante. */
export async function cumulSessionsS(db: D1Database, utilisateur: string, journee: Journee, maintenant: Date): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT ouverte_le, fermee_le FROM sessions
       WHERE utilisateur = ? AND type = 'travail' AND ouverte_le < ? AND (fermee_le IS NULL OR fermee_le > ?)`,
    )
    .bind(utilisateur, versInstant(maintenant), journee.lever)
    .all<{ ouverte_le: string; fermee_le: string | null }>();
  const debut = ms(journee.lever);
  const total = results.reduce((somme, s) => {
    const fin = Math.min(s.fermee_le ? ms(s.fermee_le) : maintenant.getTime(), maintenant.getTime());
    return somme + Math.max(0, fin - Math.max(ms(s.ouverte_le), debut));
  }, 0);
  return Math.floor(total / 1000);
}

/** Nombre de « continue » déjà acceptés pour cette tâche depuis le lever. */
async function compterContinues(db: D1Database, utilisateur: string, tacheId: string, journee: Journee): Promise<number> {
  const ligne = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM questions q JOIN sessions s ON s.id = q.session_id
       WHERE q.utilisateur = ? AND s.tache_id = ? AND q.reponse = 'continue' AND q.repondue_le >= ?`,
    )
    .bind(utilisateur, tacheId, journee.lever)
    .first<{ n: number }>();
  return ligne?.n ?? 0;
}

function intervalleS(config: Config, appareil: string): number {
  const iphone = config.appareils[appareil]?.type === 'iphone';
  return (iphone ? config.sessions.intervalleQuestionMin.iphone : config.sessions.intervalleQuestionMin.pc) * 60;
}

function nouvelleQuestion(moteur: Moteur, config: Config, appareil: string, depuis: Date, rang: number): LigneQuestion {
  const posee_a = decaler(depuis, intervalleS(config, appareil));
  const attente_s = moteur.attenteContinue(config, rang);
  return { id: nouvelIdentifiant('q'), posee_a, attente_s, expire_a: decaler(posee_a, config.sessions.expirationQuestionS + attente_s) };
}

function insererQuestion(db: D1Database, utilisateur: string, sessionId: string, q: LigneQuestion): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO questions (id, utilisateur, session_id, posee_a, attente_s, expire_a) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(q.id, utilisateur, sessionId, q.posee_a, q.attente_s, q.expire_a);
}

/** Un jeton appareil n'agit que sur ses propres sessions ; un jeton interface, sur toutes. */
export function appareilAutorise(jeton: JetonAuthentifie, appareil: string): void {
  if (jeton.typeJeton === 'appareil' && jeton.nom !== appareil) {
    throw new ErreurApi(403, 'appareil_non_autorise', `Ce jeton appartient à « ${jeton.nom} », pas à « ${appareil} ».`);
  }
}

export function appareilDeLaRequete(jeton: JetonAuthentifie, demande: unknown, config: Config): string {
  const appareil = demande === undefined && jeton.typeJeton === 'appareil' ? jeton.nom : demande;
  if (typeof appareil !== 'string' || appareil === '') throw requeteInvalide('Champ « appareil » manquant.', { champ: 'appareil' });
  appareilAutorise(jeton, appareil);
  if (!config.appareils[appareil]) {
    throw new ErreurApi(404, 'appareil_inconnu', `L'appareil « ${appareil} » n'existe pas dans la config active.`);
  }
  return appareil;
}

/**
 * Apps demandées, groupes du catalogue dépliés (§4.5) : `["ia_conversationnelle", "youtube"]` donne
 * les apps du groupe plus YouTube, dédoublonnées. Une app prime sur un groupe de même identifiant.
 */
export function deplierApps(config: Config, demandes: string[]): string[] {
  const inconnues = demandes.filter((a) => !config.apps[a] && !config.groupes[a]);
  if (inconnues.length > 0) {
    throw new ErreurApi(422, 'app_inconnue', `App ou groupe absent du catalogue : ${inconnues.join(', ')}.`, { apps: inconnues });
  }
  return [...new Set(demandes.flatMap((a) => (config.apps[a] ? [a] : config.groupes[a]!)))];
}

/** Tâches sur lesquelles une session peut porter : du jour (ou en retard), non terminées, à moi. */
export function tachesDuJour(contexte: Contexte, journee: Journee): Tache[] {
  return contexte.faits.taches.filter(
    (t) => !t.terminee && t.assigneeAMoi && t.echeance !== null && t.echeance <= journee.date,
  );
}

export function eligibleLe(config: Config, tache: Tache): Instant {
  return decaler(tache.creeeLe, config.sessions.delaiNouvelleTacheMin * 60);
}

export interface PossibiliteSession {
  session_possible: boolean;
  session_motif: string | null;
}

/**
 * Pourquoi le mode en vigueur interdit les sessions, en mots : « Journée verrouillée : planning du jour
 * à faire » (mode `pas` : le fait qui manque), « Nuit jusqu'à 05:30 » (fin certaine), sinon la sortie.
 * L'heure vient de `sortie`, jamais du planning (qui suppose Todoist figé).
 */
export function motifModeInterdit(moteur: Moteur, contexte: Contexte, appareil: string, fuseau: string): string {
  const actif = moteur.expliquer(contexte, appareil).find((m) => m.actif);
  const nom = actif?.nom ?? 'Mode en vigueur';
  const manque = actif?.logique === 'pas' ? actif.conditions.find((c) => !c.vraie) : undefined;
  if (manque) return `${nom} : ${minuscule(manque.libelle)} ${manque.detail ?? 'à faire'}`;
  const sortie = moteur.sortie(contexte, appareil);
  if (sortie.certaine) return `${nom} jusqu'à ${heureLocale(new Date(sortie.auPlusTard), fuseau)}`;
  return `${nom} : fin ${sortie.texte}`;
}

const minuscule = (texte: string) => texte.charAt(0).toLowerCase() + texte.slice(1);

/** Règle §4.5 : sessions autorisées, au moins une app bloquée, et (PC) un compte de travail. */
export function possibiliteSession(moteur: Moteur, contexte: Contexte, appareil: string, etat = moteur.etat(contexte, appareil)): PossibiliteSession {
  const def = contexte.config.appareils[appareil];
  const refus = (motif: string) => ({ session_possible: false, session_motif: motif });
  if (def && def.type !== 'iphone' && def.comptesDeTravail.length === 0) return refus('aucun compte de travail sur ce PC');
  if (etat.sessions === 'interdites') {
    return refus(motifModeInterdit(moteur, contexte, appareil, etat.journee.fuseau));
  }
  const bloquees = 'bloquer_domaines' in etat.actions ? etat.actions.bloquer_domaines : etat.actions.bloquer_apps;
  if (bloquees.length === 0) return refus("rien n'est bloqué en ce moment");
  return { session_possible: true, session_motif: null };
}

function exigerSessionPossible(moteur: Moteur, contexte: Contexte, appareil: string): void {
  const etat = moteur.etat(contexte, appareil);
  const { session_possible, session_motif } = possibiliteSession(moteur, contexte, appareil, etat);
  if (!session_possible) {
    throw new ErreurApi(409, 'session_impossible', `Session impossible : ${session_motif}.`, {
      appareil,
      mode: etat.mode,
      motif: session_motif,
    });
  }
}

// ─── Points d'entrée ─────────────────────────────────────────────────────────

async function preparer(deps: Dependances, db: D1Database, jeton: JetonAuthentifie) {
  const maintenant = deps.maintenant();
  const { contexte, version } = await chargerContexte(db, jeton.utilisateur, maintenant);
  const { restantes: ouvertes, fins } = await cloturerEchues(db, deps.moteur, contexte, jeton.utilisateur, maintenant);
  return { maintenant, contexte, version, ouvertes, fins };
}

export async function ouvrirSession(deps: Dependances, db: D1Database, jeton: JetonAuthentifie, corps: Corps) {
  const { maintenant, contexte, version, ouvertes } = await preparer(deps, db, jeton);
  const { config } = contexte;
  const appareil = appareilDeLaRequete(jeton, corps.appareil, config);
  const tacheId = texte(corps, 'tache_id', 100);
  const apps = deplierApps(config, listeDeTextes(corps, 'apps', { min: 1 }));

  exigerSessionPossible(deps.moteur, contexte, appareil);
  const deja = ouvertes.find((s) => s.session.appareil === appareil);
  if (deja) {
    throw new ErreurApi(409, 'session_deja_ouverte', 'Une session est déjà ouverte sur cet appareil : y ajouter l\'app.', {
      session_id: deja.session.id,
    });
  }

  const journee = deps.moteur.journeeCourante(contexte);
  const tache = contexte.faits.taches.find((t) => t.id === tacheId);
  if (!tache) throw new ErreurApi(404, 'tache_inconnue', 'Tâche inconnue : absente des tâches Todoist en cache.');
  if (tache.terminee) throw new ErreurApi(409, 'tache_terminee', 'Cette tâche est déjà terminée.');
  if (!tachesDuJour(contexte, journee).includes(tache)) {
    throw new ErreurApi(409, 'tache_hors_jour', "Cette tâche n'est pas une tâche du jour à ton nom.");
  }
  const eligible = eligibleLe(config, tache);
  if (maintenant.getTime() < ms(eligible)) {
    throw new ErreurApi(409, 'tache_trop_recente', `Tâche créée il y a moins de ${config.sessions.delaiNouvelleTacheMin} min.`, {
      eligible_le: eligible,
    });
  }
  const cumulS = await cumulSessionsS(db, jeton.utilisateur, journee, maintenant);
  if (cumulS >= config.sessions.plafondQuotidienMin * 60) {
    throw new ErreurApi(409, 'plafond_atteint', `Plafond quotidien de sessions atteint (${config.sessions.plafondQuotidienMin} min).`, {
      cumul_min: Math.floor(cumulS / 60),
      plafond_min: config.sessions.plafondQuotidienMin,
    });
  }

  const rang = await compterContinues(db, jeton.utilisateur, tache.id, journee);
  const session: LigneSession = {
    id: nouvelIdentifiant('s'),
    type: 'travail',
    tache_id: tache.id,
    tache_nom: tache.contenu,
    appareil,
    apps: JSON.stringify(apps),
    ouverte_le: versInstant(maintenant),
    fermee_le: null,
    motif_fin: null,
  };
  const question = nouvelleQuestion(deps.moteur, config, appareil, maintenant, rang);
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO sessions (id, utilisateur, type, tache_id, tache_nom, appareil, apps, ouverte_le, version_config)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(session.id, jeton.utilisateur, session.type, session.tache_id, session.tache_nom, appareil, session.apps, session.ouverte_le, version),
      insererQuestion(db, jeton.utilisateur, session.id, question),
      ...instructionsInvalider(db, jeton.utilisateur),
    ]);
  } catch (e) {
    // Deux ouvertures simultanées : l'index unique tranche.
    if (String(e).includes('UNIQUE')) throw new ErreurApi(409, 'session_deja_ouverte', 'Une session vient d\'être ouverte sur cet appareil.');
    throw e;
  }
  // Fin au plus tard : le plafond (le cumul avance d'autant plus vite qu'il y a de sessions ouvertes) ou le prochain mode interdit.
  const enCours = ouvertes.filter((x) => x.session.type === 'travail').length + 1;
  const plafondA = maintenant.getTime() + ((config.sessions.plafondQuotidienMin * 60 - cumulS) * 1000) / enCours;
  const interdit = debutInterdiction(deps.moteur, contexte, appareil, maintenant.getTime(), HORIZON_FIN_H);
  const fin = Math.min(plafondA, interdit ?? Infinity);
  return vueSession(config, { session, question }, versInstant(Math.ceil(fin / 1000) * 1000));
}

async function sessionDuJeton(db: D1Database, jeton: JetonAuthentifie, id: string): Promise<SessionChargee> {
  const [s] = await chargerSessions(db, jeton.utilisateur, 's.id = ?', [id]);
  if (!s) throw new ErreurApi(404, 'session_inconnue', 'Session inconnue.');
  appareilAutorise(jeton, s.session.appareil);
  return s;
}

export async function repondreQuestion(deps: Dependances, db: D1Database, jeton: JetonAuthentifie, id: string, corps: Corps) {
  const questionId = texte(corps, 'question_id', 100);
  const reponse = corps.reponse;
  if (reponse !== 'continue' && reponse !== 'arrete') {
    throw requeteInvalide('Champ « reponse » : « continue » ou « arrete » attendu.', { champ: 'reponse' });
  }
  const { maintenant, contexte, fins } = await preparer(deps, db, jeton);
  const { config } = contexte;
  const s = await sessionDuJeton(db, jeton, id);
  if (s.session.fermee_le) {
    if (s.session.motif_fin === 'mode_interdit' || s.session.motif_fin === 'plafond_atteint') {
      const motif = s.session.motif_fin === 'mode_interdit' ? 'le mode en vigueur interdit les sessions' : 'plafond quotidien de sessions atteint';
      throw new ErreurApi(409, 'session_fermee', `Cette session est fermée : ${motif}.`, { motif_fin: s.session.motif_fin });
    }
    if (s.session.motif_fin === 'sans_reponse') {
      throw new ErreurApi(409, 'question_expiree', "Pas de réponse avant l'échéance : la session est fermée.");
    }
    throw new ErreurApi(409, 'session_fermee', 'Cette session est fermée.', { motif_fin: s.session.motif_fin });
  }
  const q = s.question;
  if (!q || q.id !== questionId) {
    throw new ErreurApi(409, 'question_perimee', "Cette question n'est pas celle qui attend une réponse.", {
      question_id: q?.id ?? null,
    });
  }
  const instant = versInstant(maintenant);

  // « J'arrête » est toujours immédiat, même avant que la question soit posée.
  if (reponse === 'arrete') {
    await db.batch([
      db.prepare(`UPDATE questions SET reponse = 'arrete', repondue_le = ? WHERE id = ? AND reponse IS NULL`).bind(instant, q.id),
      ...instructionsFermeture(db, { ...s, question: null }, instant, 'arretee'),
      ...instructionsInvalider(db, jeton.utilisateur),
    ]);
    return vueSession(config, { session: { ...s.session, fermee_le: instant, motif_fin: 'arretee' }, question: null });
  }

  if (maintenant.getTime() < ms(q.posee_a)) {
    throw new ErreurApi(409, 'question_pas_encore_posee', "La question n'a pas encore été posée.", { posee_a: q.posee_a });
  }
  const disponible = decaler(q.posee_a, q.attente_s);
  if (maintenant.getTime() < ms(disponible)) {
    throw new ErreurApi(409, 'continue_trop_tot', `« Je continue » n'est possible qu'après ${q.attente_s} s d'attente.`, {
      disponible_a: disponible,
    });
  }
  // Garde-fou : la fermeture ci-dessus a déjà fermé une session dont le mode interdit les sessions.
  if (!config.appareils[s.session.appareil] || deps.moteur.etat(contexte, s.session.appareil).sessions === 'interdites') {
    throw new ErreurApi(409, 'session_fermee', 'Cette session est fermée : le mode en vigueur interdit les sessions.', { motif_fin: 'mode_interdit' });
  }
  const journee = deps.moteur.journeeCourante(contexte);
  const rang = s.session.tache_id ? (await compterContinues(db, jeton.utilisateur, s.session.tache_id, journee)) + 1 : 0;
  const suivante = nouvelleQuestion(deps.moteur, config, s.session.appareil, maintenant, rang);
  const [enregistre] = await db.batch([
    db.prepare(`UPDATE questions SET reponse = 'continue', repondue_le = ? WHERE id = ? AND reponse IS NULL`).bind(instant, q.id),
    // La question suivante n'est créée que si la réponse vient d'être enregistrée (deux « continue » simultanés).
    db
      .prepare(
        `INSERT INTO questions (id, utilisateur, session_id, posee_a, attente_s, expire_a)
         SELECT ?, ?, ?, ?, ?, ? WHERE changes() > 0`,
      )
      .bind(suivante.id, jeton.utilisateur, s.session.id, suivante.posee_a, suivante.attente_s, suivante.expire_a),
    ...instructionsInvalider(db, jeton.utilisateur),
  ]);
  if ((enregistre!.meta.changes ?? 0) === 0) throw new ErreurApi(409, 'deja_repondue', 'Cette question a déjà reçu une réponse.');
  return vueSession(config, { session: s.session, question: suivante }, fins.get(s.session.id) ?? null);
}

export async function ajouterApps(deps: Dependances, db: D1Database, jeton: JetonAuthentifie, id: string, corps: Corps) {
  const demandes = corps.app !== undefined ? [texte(corps, 'app', 100)] : listeDeTextes(corps, 'apps', { min: 1 });
  const { contexte, fins } = await preparer(deps, db, jeton);
  const nouvelles = deplierApps(contexte.config, demandes);
  const s = await sessionDuJeton(db, jeton, id);
  if (s.session.fermee_le) throw new ErreurApi(409, 'session_fermee', 'Cette session est fermée.', { motif_fin: s.session.motif_fin });
  exigerSessionPossible(deps.moteur, contexte, s.session.appareil);
  const apps = [...new Set([...(JSON.parse(s.session.apps) as string[]), ...nouvelles])];
  await db.batch([
    db.prepare(`UPDATE sessions SET apps = ? WHERE id = ? AND fermee_le IS NULL`).bind(JSON.stringify(apps), s.session.id),
    ...instructionsInvalider(db, jeton.utilisateur),
  ]);
  return vueSession(contexte.config, { ...s, session: { ...s.session, apps: JSON.stringify(apps) } }, fins.get(s.session.id) ?? null);
}

export async function fermerSession(deps: Dependances, db: D1Database, jeton: JetonAuthentifie, id: string) {
  const { maintenant, contexte } = await preparer(deps, db, jeton);
  const s = await sessionDuJeton(db, jeton, id);
  if (s.session.fermee_le) return vueSession(contexte.config, s);
  const instant = versInstant(maintenant);
  await db.batch([...instructionsFermeture(db, s, instant, 'fermee'), ...instructionsInvalider(db, jeton.utilisateur)]);
  return vueSession(contexte.config, { session: { ...s.session, fermee_le: instant, motif_fin: 'fermee' }, question: null });
}

/** Sessions encore ouvertes, après fermeture des échues ; filtrées par appareil si demandé. */
export async function sessionsOuvertes(db: D1Database, moteur: Moteur, utilisateur: string, contexte: Contexte, maintenant: Date, appareil?: string) {
  const { restantes, fins } = await cloturerEchues(db, moteur, contexte, utilisateur, maintenant);
  return restantes
    .filter((s) => !appareil || s.session.appareil === appareil)
    .map((s) => vueSession(contexte.config, s, fins.get(s.session.id) ?? null));
}
