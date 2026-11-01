// Tâche planifiée unique (cron chaque minute, §4.4). Chaque étape est indépendante : une
// panne de Todoist n'empêche ni la fermeture des sessions échues ni la photo de la nuit.
import type { Condition, Config, Contexte } from '../../core/src/types';
import { CLES_CACHE, type ContexteCharge, chargerContexte, ecrireCache, lireCache } from './contexte';
import type { Dependances, Liaisons } from './env';
import { cloturerEchues } from './sessions';
import { dateLocale, ms, versInstant } from './temps';
import type { SuiviDeadline } from './todoist';

export async function executerTachesPlanifiees(env: Liaisons, deps: Dependances): Promise<void> {
  const maintenant = deps.maintenant();
  const { results } = await env.DB.prepare(`SELECT DISTINCT utilisateur FROM config_versions WHERE valide = 1`).all<{ utilisateur: string }>();
  const erreurs: unknown[] = [];
  for (const { utilisateur } of results) {
    try {
      erreurs.push(...(await pourUtilisateur(env, deps, utilisateur, maintenant)));
    } catch (e) {
      console.error(`Tâche planifiée (${utilisateur}) :`, e);
      erreurs.push(e);
    }
  }
  // Relancer fait apparaître l'exécution en échec dans le tableau de bord Cloudflare.
  if (erreurs.length > 0) throw new AggregateError(erreurs, `Tâche planifiée : ${erreurs.length} étape(s) en échec.`);
}

async function pourUtilisateur(env: Liaisons, deps: Dependances, utilisateur: string, maintenant: Date): Promise<unknown[]> {
  const erreurs: unknown[] = [];
  const etape = async (nom: string, action: () => Promise<unknown>) => {
    try {
      await action();
      return true;
    } catch (e) {
      console.error(`Tâche planifiée « ${nom} » (${utilisateur}) :`, e);
      erreurs.push(e);
      return false;
    }
  };
  const charge = await chargerContexte(env.DB, utilisateur, maintenant);
  const jeton = env.TODOIST_TOKEN;
  const todoistFrais = jeton ? await etape('todoist', () => rafraichirTodoist(env.DB, deps, jeton, utilisateur, charge, maintenant)) : false;
  await etape('sessions', () => cloturerEchues(env.DB, utilisateur, maintenant, charge.contexte.faits.taches));
  // Une photo prise sur un cache périmé figerait de faux retards : on attend un passage réussi.
  if (todoistFrais) await etape('retards', () => photoDesRetards(env.DB, deps, utilisateur, charge.contexte, maintenant));
  await etape('nuit', () => photoDeLaNuit(env.DB, deps, utilisateur, charge, maintenant));
  if (jeton) await etape('etiquettes', () => verifierEtiquettes(env.DB, deps, jeton, utilisateur, charge.contexte, maintenant));
  return erreurs;
}

/** Met à jour le cache et, en mémoire, les faits du contexte pour les étapes suivantes. */
export async function rafraichirTodoist(
  db: D1Database,
  deps: Dependances,
  jeton: string,
  utilisateur: string,
  charge: ContexteCharge,
  maintenant: Date,
): Promise<void> {
  const { config } = charge.contexte;
  const [suivi, idConnu] = await Promise.all([
    lireCache<Record<string, SuiviDeadline>>(db, utilisateur, CLES_CACHE.suiviDeadlines),
    lireCache<string>(db, utilisateur, CLES_CACHE.idUtilisateurTodoist),
  ]);
  const faits = await deps.todoist(jeton).recupererFaits({
    maintenant,
    fuseau: deps.moteur.journeeCourante(charge.contexte).fuseau,
    commentaireMin: config.prixDuReport.commentaireMin,
    etiquettesExclues: config.todoist.etiquettesExclues,
    suiviDeadlines: suivi?.valeur ?? {},
    ...(idConnu ? { idUtilisateur: idConnu.valeur } : {}),
  });
  const ecrits = await Promise.all([
    ecrireCache(db, utilisateur, CLES_CACHE.taches, faits.taches, maintenant),
    ecrireCache(db, utilisateur, CLES_CACHE.reports, faits.reports, maintenant),
    ecrireCache(db, utilisateur, CLES_CACHE.suiviDeadlines, faits.suiviDeadlines, maintenant),
    ecrireCache(db, utilisateur, CLES_CACHE.idUtilisateurTodoist, faits.idUtilisateur, maintenant),
  ]);
  charge.contexte.faits.taches = faits.taches;
  charge.contexte.faits.reports = faits.reports;
  if (ecrits[0] || ecrits[1]) charge.contexte.faits.recupereLe = versInstant(maintenant);
}

/**
 * Photo des retards du jour qui commence à 00:00 dans le fuseau de sa routine. Prise au
 * premier passage réussi de ce jour (00:00 en temps normal, plus tard après une panne).
 */
export async function photoDesRetards(db: D1Database, deps: Dependances, utilisateur: string, contexte: Contexte, maintenant: Date) {
  let fuseau = deps.moteur.journeeCourante(contexte).fuseau;
  let date = dateLocale(maintenant, fuseau);
  // Le jour qui commence peut relever d'une autre routine, donc d'un autre fuseau.
  const fuseauDuJour = deps.moteur.journee(contexte, date).fuseau;
  if (fuseauDuJour !== fuseau) {
    fuseau = fuseauDuJour;
    date = dateLocale(maintenant, fuseau);
  }
  const deja = await db.prepare(`SELECT 1 FROM photos_retards WHERE utilisateur = ? AND date = ?`).bind(utilisateur, date).first();
  if (deja) return;
  const exclues = new Set(contexte.config.todoist.etiquettesExclues);
  const retards = contexte.faits.taches
    .filter((t) => !t.terminee && t.assigneeAMoi && t.echeance !== null && t.echeance < date && !t.etiquettes.some((e) => exclues.has(e)))
    .map((t) => ({ id: t.id, nom: t.contenu }));
  await db.batch([
    db
      .prepare(`INSERT OR IGNORE INTO photos_retards (utilisateur, date, fuseau, prise_le) VALUES (?, ?, ?, ?)`)
      .bind(utilisateur, date, fuseau, versInstant(maintenant)),
    db
      .prepare(
        `INSERT OR IGNORE INTO retards (utilisateur, date, tache_id, tache_nom)
         SELECT ?, ?, json_extract(value, '$.id'), json_extract(value, '$.nom') FROM json_each(?)`,
      )
      .bind(utilisateur, date, JSON.stringify(retards)),
  ]);
}

/** Photo de la nuit au coucher appliqué (historique) ; une seule par nuit. */
export async function photoDeLaNuit(db: D1Database, deps: Dependances, utilisateur: string, charge: ContexteCharge, maintenant: Date) {
  const j = deps.moteur.journeeCourante(charge.contexte);
  if (maintenant.getTime() < ms(j.coucherApplique)) return;
  await db
    .prepare(
      `INSERT OR IGNORE INTO nuits (utilisateur, nuit, routine, lever, coucher_prevu, coucher_applique, decision_de_nuit, photo_le, version_config)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      utilisateur,
      j.date,
      j.routine,
      j.leverSuivant,
      j.coucherPrevu,
      j.coucherApplique,
      j.decisionDeNuitPrise ? 1 : 0,
      versInstant(maintenant),
      charge.version,
    )
    .run();
}

function etiquettesDesConditions(c: Condition, acc: Set<string>): void {
  if (typeof c === 'string' || 'heure' in c) return;
  if ('nombreDeTaches' in c) {
    for (const e of [...(c.nombreDeTaches.filtre.etiquettesIncluses ?? []), ...(c.nombreDeTaches.filtre.etiquettesExclues ?? [])]) acc.add(e);
  } else if ('tous' in c) c.tous.forEach((x) => etiquettesDesConditions(x, acc));
  else if ('unParmi' in c) c.unParmi.forEach((x) => etiquettesDesConditions(x, acc));
  else etiquettesDesConditions(c.pas, acc);
}

export function etiquettesDeLaConfig(config: Config): string[] {
  const acc = new Set([config.todoist.etiquettePlanning, config.todoist.etiquetteRecap, ...config.todoist.etiquettesExclues]);
  for (const mode of Object.values(config.modes)) etiquettesDesConditions(mode.quand, acc);
  for (const routine of Object.values(config.routines)) {
    for (const jour of Object.values(routine.jours)) {
      for (const conditions of Object.values(jour?.conditionsEnPlus ?? {})) conditions.forEach((c) => etiquettesDesConditions(c, acc));
    }
  }
  return [...acc].sort();
}

/** Une fois par jour local : une étiquette mal orthographiée rendrait une condition toujours vraie. */
export async function verifierEtiquettes(db: D1Database, deps: Dependances, jeton: string, utilisateur: string, contexte: Contexte, maintenant: Date) {
  const aujourdhui = dateLocale(maintenant, deps.moteur.journeeCourante(contexte).fuseau);
  const derniere = await lireCache<{ date: string }>(db, utilisateur, CLES_CACHE.etiquettes);
  if (derniere?.valeur.date === aujourdhui) return;
  const existantes = new Set(await deps.todoist(jeton).etiquettesExistantes());
  const manquantes = etiquettesDeLaConfig(contexte.config).filter((e) => !existantes.has(e));
  if (manquantes.length > 0) console.warn(`Étiquettes Todoist absentes (${utilisateur}) : ${manquantes.join(', ')}`);
  await ecrireCache(db, utilisateur, CLES_CACHE.etiquettes, { date: aujourdhui, verifie_le: versInstant(maintenant), manquantes }, maintenant);
}
