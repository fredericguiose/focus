// Tâche planifiée unique (cron chaque minute, §4.4, §4.7). Chaque étape est indépendante : une
// panne de Todoist n'empêche ni la fermeture des sessions échues ni la photo de la nuit. Une
// seule source lourde (Todoist, Xiaomi, Hevy ou Google Agenda) par invocation, à sa cadence (config `synchro`) :
// le plan gratuit de Workers donne 10 ms de CPU et 50 sous-requêtes (D1 compris) par invocation.
import type { Condition, Config, Contexte } from '../../core/src/types';
import { cadencesDeSynchro } from '../../core/src/config';
import { type EtatAgenda, reglagesGoogle, retardAgenda, synchroniserAgenda } from './agenda';
import { instructionsInvalider, invaliderCache } from './cache';
import { CLES_CACHE, type ContexteCharge, chargerContexte, ecrireCache, lireCache, lireCaches } from './contexte';
import type { Dependances, Liaisons } from './env';
import { cloturerEchues } from './sessions';
import { type EtatSynchroHevy, reglagesHevy, retardSeances, synchroniserSeances } from './hevy';
import { type EtatSynchro, reglagesXiaomi, retardSommeil, synchroniserSommeil } from './sommeil';
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

/** Sources lourdes (appels réseau, écritures en lot) : une seule par invocation (§4.7). */
export type SourceLourde = 'todoist' | 'xiaomi' | 'hevy' | 'agenda';

/** État de la synchro Todoist : seulement l'heure du dernier passage tenté (pour la cadence). */
interface EtatSynchroTodoist {
  tentee_le: string;
}

/**
 * La source à synchroniser à cette invocation : parmi celles qui sont dues, la plus en retard sur
 * sa cadence (à égalité : Todoist, Xiaomi, Hevy, Google Agenda). Le retard absolu, pas relatif : Todoist toutes
 * les 2 min n'affame pas Xiaomi (qui passe au plus une minute après son échéance).
 */
export function choisirSource(retards: Partial<Record<SourceLourde, number | null>>): SourceLourde | null {
  let choix: SourceLourde | null = null;
  for (const source of ['todoist', 'xiaomi', 'hevy', 'agenda'] as const) {
    const r = retards[source];
    if (r === null || r === undefined) continue;
    if (choix === null || r > retards[choix]!) choix = source;
  }
  return choix;
}

function retardTodoist(avant: EtatSynchroTodoist | undefined, maintenant: Date, cadenceMin: number): number | null {
  if (!avant) return 0;
  const retard = maintenant.getTime() - Date.parse(avant.tentee_le) - cadenceMin * 60_000;
  return retard >= -30_000 ? Math.max(0, retard) : null;
}

/** Le jeton Todoist n'est utilisé que pour son propriétaire (TODOIST_UTILISATEUR), comme Xiaomi et Hevy. */
export function jetonTodoist(env: Liaisons, utilisateur: string): string | null {
  const jeton = env.TODOIST_TOKEN?.trim();
  const proprietaire = env.TODOIST_UTILISATEUR?.trim();
  return jeton && proprietaire && proprietaire === utilisateur ? jeton : null;
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
  const cadences = cadencesDeSynchro(charge.contexte.config);
  const jeton = jetonTodoist(env, utilisateur);
  const xiaomi = reglagesXiaomi(env);
  const avecXiaomi = !!(xiaomi && deps.xiaomi && xiaomi.utilisateur === utilisateur);
  const hevy = reglagesHevy(env);
  const avecHevy = !!(hevy && deps.hevy && hevy.utilisateur === utilisateur);
  const google = reglagesGoogle(env);
  const avecAgenda = !!(google && deps.agenda && google.utilisateur === utilisateur);

  // Une seule lecture pour décider : l'état des synchros (et le signal « agenda à refaire »).
  const etats = await lireCaches(env.DB, utilisateur, [
    CLES_CACHE.synchroTodoist,
    CLES_CACHE.synchroXiaomi,
    CLES_CACHE.synchroHevy,
    CLES_CACHE.synchroAgenda,
    CLES_CACHE.agendaARefaire,
  ]);
  const source = choisirSource({
    todoist: jeton ? retardTodoist(etats[CLES_CACHE.synchroTodoist] as EtatSynchroTodoist | undefined, maintenant, cadences.todoist) : null,
    xiaomi: avecXiaomi ? retardSommeil(etats[CLES_CACHE.synchroXiaomi] as EtatSynchro | undefined, maintenant, cadences.xiaomi * 60) : null,
    hevy: avecHevy ? retardSeances(etats[CLES_CACHE.synchroHevy] as EtatSynchroHevy | undefined, maintenant, cadences.hevy * 60) : null,
    agenda: avecAgenda
      ? retardAgenda(etats[CLES_CACHE.synchroAgenda] as EtatAgenda | undefined, etats[CLES_CACHE.agendaARefaire] as string | undefined, maintenant, cadences.googleAgenda * 60)
      : null,
  });

  let todoistFrais = false;
  if (source === 'todoist' && jeton) {
    await ecrireCache(env.DB, utilisateur, CLES_CACHE.synchroTodoist, { tentee_le: versInstant(maintenant) }, maintenant);
    todoistFrais = await etape('todoist', () => rafraichirTodoist(env.DB, deps, jeton, utilisateur, charge, maintenant));
  }
  await etape('sessions', () => cloturerEchues(env.DB, deps.moteur, charge.contexte, utilisateur, maintenant));
  // Une photo prise sur un cache périmé figerait de faux retards : on attend un passage réussi.
  if (todoistFrais) await etape('retards', () => photoDesRetards(env.DB, deps, utilisateur, charge.contexte, maintenant));
  await etape('nuit', () => photoDeLaNuit(env.DB, deps, utilisateur, charge, maintenant));
  // Le compte Xiaomi (Hevy) appartient à un seul utilisateur : les autres ne sont jamais synchronisés.
  if (source === 'xiaomi') await etape('sommeil', () => synchroniserSommeil(env.DB, deps.xiaomi!, xiaomi!, maintenant, false, cadences.xiaomi * 60));
  if (source === 'hevy') await etape('seances', () => synchroniserSeances(env.DB, deps.hevy!, hevy!, maintenant, false, cadences.hevy * 60));
  // Bloc « Dormir » : nuits calculées sur le contexte chargé au début de ce passage.
  if (source === 'agenda') await etape('agenda', () => synchroniserAgenda(env.DB, deps.agenda!, google!, deps.moteur, charge.contexte, maintenant));
  // Vérification des étiquettes (deux requêtes, une fois par jour) : jamais avec Xiaomi, Hevy ni l'agenda.
  if (jeton && (source === null || source === 'todoist')) await etape('etiquettes', () => verifierEtiquettes(env.DB, deps, jeton, utilisateur, charge.contexte, maintenant));
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
  if (ecrits[0] || ecrits[1]) {
    charge.contexte.faits.recupereLe = versInstant(maintenant);
    await invaliderCache(db, utilisateur);
  }
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
    ...instructionsInvalider(db, utilisateur),
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
  const r = await db
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
  // Le statut lit les prévus figés par la photo.
  if ((r.meta.changes ?? 0) > 0) await invaliderCache(db, utilisateur);
}

function etiquettesDesConditions(c: Condition, acc: Set<string>): void {
  if (typeof c === 'string' || 'heure' in c) return;
  if ('nombreDeTaches' in c) {
    for (const e of [...(c.nombreDeTaches.filtre.etiquettesIncluses ?? []), ...(c.nombreDeTaches.filtre.etiquettesExclues ?? [])]) acc.add(e);
  } else if ('tous' in c) c.tous.forEach((x) => etiquettesDesConditions(x, acc));
  else if ('unParmi' in c) c.unParmi.forEach((x) => etiquettesDesConditions(x, acc));
  else etiquettesDesConditions(c.pas, acc);
}

/**
 * Rôle d'une étiquette dans la config : étiquette du planning, du récap, exclusion globale
 * (`todoist.etiquettes_exclues`), ou filtre d'une condition de mode (`modes` : les modes concernés).
 */
export type UsageEtiquette = 'planning' | 'recap' | 'exclusion' | 'condition';

export interface UsagesEtiquette {
  usages: UsageEtiquette[];
  modes: string[];
}

/** Toutes les étiquettes citées par la config, avec leurs rôles (pour dire ce qu'une absence casse). */
export function usagesDesEtiquettes(config: Config): Record<string, UsagesEtiquette> {
  const res: Record<string, { usages: Set<UsageEtiquette>; modes: Set<string> }> = {};
  const noter = (e: string, usage: UsageEtiquette, mode?: string) => {
    const u = (res[e] ??= { usages: new Set(), modes: new Set() });
    u.usages.add(usage);
    if (mode) u.modes.add(mode);
  };
  noter(config.todoist.etiquettePlanning, 'planning');
  noter(config.todoist.etiquetteRecap, 'recap');
  config.todoist.etiquettesExclues.forEach((e) => noter(e, 'exclusion'));
  const parMode = (mode: string, c: Condition) => {
    const acc = new Set<string>();
    etiquettesDesConditions(c, acc);
    acc.forEach((e) => noter(e, 'condition', mode));
  };
  for (const [nom, mode] of Object.entries(config.modes)) parMode(nom, mode.quand);
  for (const routine of Object.values(config.routines)) {
    for (const jour of Object.values(routine.jours)) {
      for (const [mode, conditions] of Object.entries(jour?.conditionsEnPlus ?? {})) conditions.forEach((c) => parMode(mode, c));
    }
  }
  const ORDRE: UsageEtiquette[] = ['planning', 'recap', 'condition', 'exclusion'];
  return Object.fromEntries(
    Object.entries(res).map(([e, u]) => [e, { usages: ORDRE.filter((x) => u.usages.has(x)), modes: [...u.modes].sort() }]),
  );
}

export function etiquettesDeLaConfig(config: Config): string[] {
  return Object.keys(usagesDesEtiquettes(config)).sort();
}

/** Une étiquette manquante est revérifiée au plus tard au bout d'une heure : l'alerte s'efface vite une fois corrigée. */
const REVERIFIER_MANQUANTES_MS = 60 * 60 * 1000;

/**
 * Une fois par jour local : une étiquette mal orthographiée rendrait une condition toujours vraie.
 * Revérifie aussi dès que la config cite d'autres étiquettes, et toutes les heures tant qu'il en manque.
 */
export async function verifierEtiquettes(db: D1Database, deps: Dependances, jeton: string, utilisateur: string, contexte: Contexte, maintenant: Date) {
  const aujourdhui = dateLocale(maintenant, deps.moteur.journeeCourante(contexte).fuseau);
  const citees = etiquettesDeLaConfig(contexte.config);
  const derniere = await lireCache<{ date: string; verifie_le?: string; manquantes?: string[]; citees?: string[] }>(db, utilisateur, CLES_CACHE.etiquettes);
  if (derniere) {
    const v = derniere.valeur;
    const memesCitees = v.citees !== undefined && v.citees.join('\n') === citees.join('\n');
    const manquantesRecentes = (v.manquantes ?? []).length === 0 || (v.verifie_le !== undefined && maintenant.getTime() - ms(v.verifie_le) < REVERIFIER_MANQUANTES_MS);
    if (v.date === aujourdhui && memesCitees && manquantesRecentes) return;
  }
  const existantes = new Set(await deps.todoist(jeton).etiquettesExistantes());
  const manquantes = citees.filter((e) => !existantes.has(e));
  if (manquantes.length > 0) console.warn(`Étiquettes Todoist absentes (${utilisateur}) : ${manquantes.join(', ')}`);
  await ecrireCache(db, utilisateur, CLES_CACHE.etiquettes, { date: aujourdhui, verifie_le: versInstant(maintenant), manquantes, citees }, maintenant);
}
