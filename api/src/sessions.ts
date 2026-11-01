// Sessions de travail (conception §4.5). Rien de calculable n'est stocké : le plafond du jour
// et le rang des « continue » sont recalculés depuis les tables à chaque demande.
import type { Config, Contexte, Instant, Journee, Moteur, Tache } from '../../core/src/types';
import { chargerContexte, nouvelIdentifiant } from './contexte';
import type { Dependances, JetonAuthentifie } from './env';
import { ErreurApi, requeteInvalide } from './erreurs';
import { decaler, ms, versInstant } from './temps';
import { type Corps, listeDeTextes, texte } from './validation';

type MotifFin = 'fermee' | 'arretee' | 'sans_reponse' | 'tache_terminee';

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

/**
 * Ferme les sessions dont la question a expiré sans réponse, ou dont la tâche est terminée.
 * Appelée par la tâche planifiée et avant chaque lecture : le résultat ne dépend pas de qui
 * passe en premier. Renvoie les sessions encore ouvertes.
 */
export async function cloturerEchues(db: D1Database, utilisateur: string, maintenant: Date, taches: Tache[]): Promise<SessionChargee[]> {
  const ouvertes = await chargerSessions(db, utilisateur, 's.fermee_le IS NULL', []);
  const terminees = new Map(taches.filter((t) => t.terminee).map((t) => [t.id, t]));
  const instructions: D1PreparedStatement[] = [];
  const restantes: SessionChargee[] = [];
  for (const s of ouvertes) {
    const fins: { fin: number; motif: MotifFin }[] = [];
    if (s.question && maintenant.getTime() >= ms(s.question.expire_a)) {
      fins.push({ fin: ms(s.question.expire_a), motif: 'sans_reponse' });
    }
    const tache = s.session.tache_id ? terminees.get(s.session.tache_id) : undefined;
    if (tache) {
      const termineeLe = tache.termineeLe ? Math.min(ms(tache.termineeLe), maintenant.getTime()) : maintenant.getTime();
      fins.push({ fin: Math.max(termineeLe, ms(s.session.ouverte_le)), motif: 'tache_terminee' });
    }
    if (fins.length === 0) {
      restantes.push(s);
      continue;
    }
    const premiere = fins.reduce((a, b) => (b.fin < a.fin ? b : a));
    instructions.push(...instructionsFermeture(db, s, versInstant(premiere.fin), premiere.motif));
  }
  if (instructions.length > 0) await db.batch(instructions);
  return restantes;
}

export function vueSession(config: Config, s: SessionChargee): VueSession {
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

function verifierApps(config: Config, apps: string[]): void {
  const inconnues = apps.filter((a) => !config.apps[a]);
  if (inconnues.length > 0) {
    throw new ErreurApi(422, 'app_inconnue', `App absente du catalogue : ${inconnues.join(', ')}.`, { apps: inconnues });
  }
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

// ─── Points d'entrée ─────────────────────────────────────────────────────────

async function preparer(deps: Dependances, db: D1Database, jeton: JetonAuthentifie) {
  const maintenant = deps.maintenant();
  const { contexte, version } = await chargerContexte(db, jeton.utilisateur, maintenant);
  const ouvertes = await cloturerEchues(db, jeton.utilisateur, maintenant, contexte.faits.taches);
  return { maintenant, contexte, version, ouvertes };
}

export async function ouvrirSession(deps: Dependances, db: D1Database, jeton: JetonAuthentifie, corps: Corps) {
  const { maintenant, contexte, version, ouvertes } = await preparer(deps, db, jeton);
  const { config } = contexte;
  const appareil = appareilDeLaRequete(jeton, corps.appareil, config);
  const tacheId = texte(corps, 'tache_id', 100);
  const apps = listeDeTextes(corps, 'apps', { min: 1 });
  verifierApps(config, apps);

  const etat = deps.moteur.etat(contexte, appareil);
  if (etat.sessions === 'interdites') {
    throw new ErreurApi(409, 'sessions_interdites', `Le mode en vigueur (${etat.mode}) interdit les sessions.`, { mode: etat.mode });
  }
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
    ]);
  } catch (e) {
    // Deux ouvertures simultanées : l'index unique tranche.
    if (String(e).includes('UNIQUE')) throw new ErreurApi(409, 'session_deja_ouverte', 'Une session vient d\'être ouverte sur cet appareil.');
    throw e;
  }
  return vueSession(config, { session, question });
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
  const { maintenant, contexte } = await preparer(deps, db, jeton);
  const { config } = contexte;
  const s = await sessionDuJeton(db, jeton, id);
  if (s.session.fermee_le) {
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
  const journee = deps.moteur.journeeCourante(contexte);
  const rang = s.session.tache_id ? (await compterContinues(db, jeton.utilisateur, s.session.tache_id, journee)) + 1 : 0;
  const enregistre = await db
    .prepare(`UPDATE questions SET reponse = 'continue', repondue_le = ? WHERE id = ? AND reponse IS NULL`)
    .bind(instant, q.id)
    .run();
  if ((enregistre.meta.changes ?? 0) === 0) throw new ErreurApi(409, 'deja_repondue', 'Cette question a déjà reçu une réponse.');
  const suivante = nouvelleQuestion(deps.moteur, config, s.session.appareil, maintenant, rang);
  await insererQuestion(db, jeton.utilisateur, s.session.id, suivante).run();
  return vueSession(config, { session: s.session, question: suivante });
}

export async function ajouterApps(deps: Dependances, db: D1Database, jeton: JetonAuthentifie, id: string, corps: Corps) {
  const nouvelles = corps.app !== undefined ? [texte(corps, 'app', 100)] : listeDeTextes(corps, 'apps', { min: 1 });
  const { contexte } = await preparer(deps, db, jeton);
  verifierApps(contexte.config, nouvelles);
  const s = await sessionDuJeton(db, jeton, id);
  if (s.session.fermee_le) throw new ErreurApi(409, 'session_fermee', 'Cette session est fermée.', { motif_fin: s.session.motif_fin });
  const apps = [...new Set([...(JSON.parse(s.session.apps) as string[]), ...nouvelles])];
  await db.prepare(`UPDATE sessions SET apps = ? WHERE id = ? AND fermee_le IS NULL`).bind(JSON.stringify(apps), s.session.id).run();
  return vueSession(contexte.config, { ...s, session: { ...s.session, apps: JSON.stringify(apps) } });
}

export async function fermerSession(deps: Dependances, db: D1Database, jeton: JetonAuthentifie, id: string) {
  const { maintenant, contexte } = await preparer(deps, db, jeton);
  const s = await sessionDuJeton(db, jeton, id);
  if (s.session.fermee_le) return vueSession(contexte.config, s);
  const instant = versInstant(maintenant);
  await db.batch(instructionsFermeture(db, s, instant, 'fermee'));
  return vueSession(contexte.config, { session: { ...s.session, fermee_le: instant, motif_fin: 'fermee' }, question: null });
}

/** Sessions encore ouvertes, après fermeture des échues ; filtrées par appareil si demandé. */
export async function sessionsOuvertes(db: D1Database, utilisateur: string, contexte: Contexte, maintenant: Date, appareil?: string) {
  const ouvertes = await cloturerEchues(db, utilisateur, maintenant, contexte.faits.taches);
  return ouvertes.filter((s) => !appareil || s.session.appareil === appareil).map((s) => vueSession(contexte.config, s));
}
