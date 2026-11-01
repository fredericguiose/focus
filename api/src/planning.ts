// Planning d'un appareil (§4.3), statut pour l'interface, tâches du jour, raison d'un blocage.
import type { ActionsIphone, ActionsPc, Config, Contexte, EngagementPrevu, JournalDesCouchers, JournalDesLevers, Journee, Mesure, Moteur, Segment, SortieMode } from '../../core/src/types';
import { dettesHebdomadaires, lundiDe, SEMAINES_DE_BILAN } from '../../core/src/dette';
import { JOURS_DU_JOURNAL_DES_LEVERS } from '../../core/src/levers';
import { dateCourte, JOURS_SEMAINE, jourSemaine } from '../../core/src/temps';
import { etatSynchroHevy, lireSeances } from './hevy';
import { CLES_CACHE, chargerContexte, lireCache } from './contexte';
import type { Dependances, JetonAuthentifie } from './env';
import { ErreurApi, requeteInvalide } from './erreurs';
import {
  appareilAutorise,
  cumulSessionsS,
  eligibleLe,
  possibiliteSession,
  sessionsOuvertes,
  tachesDuJour,
  type VueSession,
} from './sessions';
import { etatSynchro, type JourneeDeVeille, lireSommeil, rattacherAuxNuits, type Sieste, type SommeilMesure, separerSiestes } from './sommeil';
import { ajouterJours, dateLocale, debutJourLocal, decaler, heureLocale, ms, versInstant } from './temps';

export const HORIZON_H = 36;
export const VERSION_FORMAT_PLANNING = 1;

export interface Planning {
  version: number;
  appareil: string;
  heure_serveur: string;
  config_version: string;
  valable_jusqua: string;
  comptes_de_travail: string[];
  segments: Segment[];
  sessions: VueSession[];
  raison: string;
}

export function construirePlanning(p: {
  appareil: string;
  config: Config;
  version: string;
  maintenant: Date;
  segments: Segment[];
  sessions: VueSession[];
  raison: string;
}): Planning {
  return {
    version: VERSION_FORMAT_PLANNING,
    appareil: p.appareil,
    heure_serveur: versInstant(p.maintenant),
    config_version: p.version,
    // Au-delà, le client lève tout : chaque verrou porte son échéance.
    valable_jusqua: p.segments.at(-1)?.fin ?? decaler(p.maintenant, HORIZON_H * 3600),
    comptes_de_travail: p.config.appareils[p.appareil]?.comptesDeTravail ?? [],
    segments: p.segments.map(({ debut, fin, mode, sessions, actions }) => ({ debut, fin, mode, sessions, actions })),
    sessions: p.sessions,
    raison: p.raison,
  };
}

function appareilDeLaConfig(contexte: Contexte, appareil: string): void {
  if (!contexte.config.appareils[appareil]) {
    throw new ErreurApi(404, 'appareil_inconnu', `L'appareil « ${appareil} » n'existe pas dans la config active.`);
  }
}

export async function planningAppareil(deps: Dependances, db: D1Database, jeton: JetonAuthentifie): Promise<Planning> {
  const maintenant = deps.maintenant();
  const { contexte, version } = await chargerContexte(db, jeton.utilisateur, maintenant);
  appareilDeLaConfig(contexte, jeton.nom);
  const segments = deps.moteur.planifier(contexte, jeton.nom, HORIZON_H);
  const etat = deps.moteur.etat(contexte, jeton.nom);
  const sessions = await sessionsOuvertes(db, jeton.utilisateur, contexte, maintenant, jeton.nom);
  return construirePlanning({ appareil: jeton.nom, config: contexte.config, version, maintenant, segments, sessions, raison: etat.raison });
}

function vueJournee(j: Journee) {
  return {
    date: j.date,
    routine: j.routine,
    fuseau: j.fuseau,
    engagements: j.engagements,
    lever: j.lever,
    lever_suivant: j.leverSuivant,
    coucher_prevu: j.coucherPrevu,
    coucher_applique: j.coucherApplique,
    ouverture: j.ouverture,
    prix_du_report_min: j.prixDuReportMin,
    dette_nuit_min: j.detteNuitMin,
    decision_de_nuit_prise: j.decisionDeNuitPrise,
  };
}

/** Apps du catalogue touchées par les actions du mode : celles qu'une session peut débloquer. */
export function appsBloquees(config: Config, actions: ActionsPc | ActionsIphone) {
  const pc = 'bloquer_domaines' in actions;
  const cibles = new Set(pc ? actions.bloquer_domaines : actions.bloquer_apps);
  return Object.entries(config.apps)
    .map(([id, app]) => ({
      id,
      nom: app.nom,
      domaines: pc ? app.domaines.filter((d) => cibles.has(d)) : [],
      iphone: app.iphone ?? null,
      bloquee: pc ? app.domaines.some((d) => cibles.has(d)) : app.iphone !== undefined && cibles.has(app.iphone),
    }))
    .filter((a) => a.bloquee)
    .map(({ bloquee: _, ...a }) => a)
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

/** Noms lisibles des groupes connus ; sinon l'identifiant mis en forme (« jeux_video » → « Jeux video »). */
const NOMS_GROUPES: Record<string, string> = {
  ia_conversationnelle: 'IA conversationnelle',
  divertissement: 'Divertissement',
  navigateurs: 'Navigateurs',
  matin: 'Apps du matin',
  reseaux_sociaux: 'Réseaux sociaux',
};

export function nomGroupe(id: string): string {
  const lisible = id.replace(/[_-]+/g, ' ');
  return NOMS_GROUPES[id] ?? lisible.charAt(0).toUpperCase() + lisible.slice(1);
}

/**
 * Groupes que le mode en vigueur bloque (cités dans `bloque`, ou tous pour `tout`), réduits aux apps
 * effectivement bloquées sur l'appareil (§4.6) ; un groupe sans app bloquée n'apparaît pas.
 */
export function groupesBloques(config: Config, mode: string, bloquees: { id: string }[]) {
  const ids = new Set(bloquees.map((a) => a.id));
  const bloque = config.modes[mode]?.effets.bloque;
  const cites = bloque === 'tout' ? null : new Set(bloque ?? []);
  return Object.entries(config.groupes)
    .filter(([id]) => cites === null || cites.has(id))
    .map(([id, apps]) => ({ id, nom: nomGroupe(id), apps: apps.filter((a) => ids.has(a)) }))
    .filter((g) => g.apps.length > 0)
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

function vueSortie(s: SortieMode) {
  return { texte: s.texte, certaine: s.certaine, au_plus_tard: s.auPlusTard };
}

/** Le premier PC qui a un compte de travail, sinon le premier appareil. */
export function appareilPrincipal(config: Config): string | null {
  const appareils = Object.entries(config.appareils);
  const pc = appareils.find(([, a]) => a.type !== 'iphone' && a.comptesDeTravail.length > 0);
  return (pc ?? appareils[0])?.[0] ?? null;
}

export const NUITS_DU_STATUT = 7;

export type Phase = 'journee' | 'soiree' | 'nuit';

export function phaseDe(j: Journee, maintenant: Date): Phase {
  const t = maintenant.getTime();
  if (t >= ms(j.coucherApplique)) return 'nuit';
  if (t >= ms(j.ouverture)) return 'soiree';
  return 'journee';
}

/** Ce que l'interface peut proposer maintenant ; les règles restent celles du moteur (§3.4). */
export function actionsPossibles(j: Journee, phase: Phase) {
  const coucher = heureLocale(new Date(j.coucherApplique), j.fuseau);
  const ouverture = heureLocale(new Date(j.ouverture), j.fuseau);
  return {
    je_vais_dormir:
      phase === 'nuit'
        ? { disponible: false, motif: `la nuit a déjà commencé à ${coucher}` }
        : { disponible: true, motif: null },
    decaler_coucher:
      phase === 'journee'
        ? { mode: 'raison' as const, motif: null }
        : j.decisionDeNuitPrise
          ? { mode: 'indisponible' as const, motif: `décision de nuit déjà prise pour la nuit du ${dateCourte(j.date)} (une seule par nuit)` }
          : { mode: 'decision_de_nuit' as const, motif: `soirée ouverte depuis ${ouverture}` },
  };
}

/** `sans_heure` : ne fixe pas le réveil ce jour-là ; « décaler » lui en donne une. */
function vueEngagement(e: EngagementPrevu) {
  return { id: e.id, nom: e.nom, reveil: e.reveil, heure: e.heure, obligatoire: e.obligatoire, sans_heure: e.reveil === null, origine: e.origine };
}

/** Une sieste qui finit moins de 4 h avant le coucher appliqué rend l'endormissement plus difficile. */
export const SIESTE_TARDIVE_H = 4;

const somme = (siestes: Sieste[] | undefined) => (siestes ?? []).reduce((t, s) => t + s.minutes, 0);

/**
 * Les `nombre` nuits terminées avant la journée courante, de la plus ancienne à la plus récente :
 * dette prévue (moteur) et, si le sommeil a été mesuré, dette réelle = cible − temps endormi de la
 * nuit. Les siestes (§4.6) sont comptées à part, par journée D (`siestes_min` de la nuit D), et
 * celles de la journée courante dans `aujourdhui`.
 */
export function dernieresNuits(moteur: Moteur, contexte: Contexte, j: Journee, sommeil: SommeilMesure[] = [], nombre = NUITS_DU_STATUT) {
  const jours: (JourneeDeVeille & { nuit: string; dette_min: number })[] = [];
  for (let n = nombre; n >= 1; n--) {
    const nuit = ajouterJours(j.date, -n);
    const jn = moteur.journee(contexte, nuit);
    jours.push({ nuit, date: nuit, fuseau: jn.fuseau, lever: jn.lever, coucher: jn.coucherApplique, dette_min: jn.detteNuitMin });
  }
  const veilles: JourneeDeVeille[] = [...jours, { date: j.date, fuseau: j.fuseau, lever: j.lever, coucher: j.coucherApplique }];
  const separees = separerSiestes(sommeil, veilles, j.fuseau);
  const mesurees = rattacherAuxNuits(separees.nuits, jours);
  const cible = contexte.config.sommeil.cibleMin;
  const nuits = jours.map(({ nuit, dette_min }) => {
    const m = mesurees.get(nuit);
    const siestes = separees.siestes.get(nuit) ?? [];
    return {
      nuit,
      dette_min,
      dette_reelle_min: m ? cible - m.endormi_min : null,
      endormi_min: m ? m.endormi_min : null,
      phases: m?.phases ?? null,
      incomplete: m?.incomplete ?? false,
      siestes_min: somme(siestes),
      siestes,
    };
  });
  // Endormissements des nuits complètes : une nuit incomplète (montre retirée) n'a pas de début sûr.
  const endormissements: Record<string, string> = {};
  for (const [nuit, m] of mesurees) if (!m.incomplete) endormissements[nuit] = m.endormissement;
  return { nuits, endormissements, aujourdhui: separees.siestes.get(j.date) ?? [] };
}

/**
 * Nuits à lire pour le statut : les 7 barres, et assez pour la semaine en cours et les bilans. La
 * nuit D compte pour la semaine du matin D + 1 : la plus ancienne utile est le dimanche soir qui
 * ouvre la plus ancienne semaine close.
 */
export function nuitsALire(jour: string): number {
  return Math.max(NUITS_DU_STATUT, JOURS_SEMAINE.indexOf(jourSemaine(ajouterJours(jour, 1))) + 7 * SEMAINES_DE_BILAN);
}

/** La dernière sieste du jour finie moins de 4 h avant le coucher appliqué, ou null (et null une fois la nuit commencée). */
export function siesteTardive(j: Journee, siestes: Sieste[], maintenant: Date): { fin: string; coucher: string } | null {
  if (maintenant.getTime() >= ms(j.coucherApplique)) return null;
  const seuil = ms(j.coucherApplique) - SIESTE_TARDIVE_H * 3_600_000;
  const tardives = siestes.filter((s) => ms(s.fin) > seuil);
  const derniere = tardives.at(-1);
  return derniere ? { fin: derniere.fin, coucher: j.coucherApplique } : null;
}

/**
 * Prévus figés par la photo de la nuit (prise au coucher appliqué) : le lever du lendemain, par
 * date du lever, et le coucher prévu, par date de la nuit, tels que le plan les donnait alors.
 */
export async function prevusFiges(db: D1Database, utilisateur: string, depuisNuit: string) {
  const { results } = await db
    .prepare(`SELECT nuit, lever, coucher_prevu FROM nuits WHERE utilisateur = ? AND nuit >= ?`)
    .bind(utilisateur, depuisNuit)
    .all<{ nuit: string; lever: string; coucher_prevu: string }>();
  return {
    levers: Object.fromEntries(results.map((l) => [ajouterJours(l.nuit, 1), l.lever])) as Record<string, string>,
    couchers: Object.fromEntries(results.map((l) => [l.nuit, l.coucher_prevu])) as Record<string, string>,
  };
}

/** Journal des couchers (§3.1), affichage seul : par nuit, coucher prévu et endormissement mesuré ; amplitude face au repère. */
export function vueCouchers(j: JournalDesCouchers) {
  return {
    nuits: j.nuits.map((x) => ({
      nuit: x.nuit,
      prevu: x.prevu,
      prevu_fige: x.prevuFige,
      mesure: x.mesure,
      ecart_min: x.ecartMin,
      ...(x.ignore ? { ignore: x.ignore } : {}),
    })),
    amplitude: j.amplitude
      ? { plus_tot: j.amplitude.plusTot, plus_tard: j.amplitude.plusTard, ecart_min: j.amplitude.ecartMin, mesures: j.amplitude.mesures }
      : null,
    limite_min: j.limiteMin,
  };
}

/** Journal des levers (§3.1) : par jour, prévu et mesuré (`ignore` : décalage horaire) ; amplitude des mesurés comptés face à la limite. */
export function vueLevers(j: JournalDesLevers) {
  return {
    jours: j.jours.map((x) => ({
      date: x.date,
      prevu: x.prevu,
      prevu_fige: x.prevuFige,
      mesure: x.mesure,
      ecart_min: x.ecartMin,
      ...(x.ignore ? { ignore: x.ignore } : {}),
    })),
    amplitude: j.amplitude
      ? { plus_tot: j.amplitude.plusTot, plus_tard: j.amplitude.plusTard, ecart_min: j.amplitude.ecartMin, mesures: j.amplitude.mesures }
      : null,
    limite_min: j.limiteMin,
  };
}

export const JOURS_VERIFIES = 7;

/**
 * Engagements vérifiés (§4.6) : les 7 derniers jours, aujourd'hui et le reste de la semaine en
 * cours (à venir) ; `sautes_semaine` compte les sautés, déclarés ou non, du lundi à aujourd'hui.
 */
export function engagementsVerifies(moteur: Moteur, contexte: Contexte, mesures: Mesure[], aujourdhui: string) {
  const lundi = lundiDe(aujourdhui);
  const liste = moteur.verifierEngagements(contexte, mesures, ajouterJours(aujourdhui, -JOURS_VERIFIES), ajouterJours(lundi, 6));
  return {
    aujourdhui,
    engagements_verifies: liste.map((e) => ({ date: e.date, engagement: e.engagement, nom: e.nom, statut: e.statut })),
    sautes_semaine: liste.filter((e) => e.date >= lundi && e.date <= aujourdhui && e.statut.startsWith('saute')).length,
  };
}

export async function statut(deps: Dependances, db: D1Database, jeton: JetonAuthentifie) {
  const maintenant = deps.maintenant();
  const { contexte, version } = await chargerContexte(db, jeton.utilisateur, maintenant);
  const { config } = contexte;
  const journee = deps.moteur.journeeCourante(contexte);
  const jourCivil = dateLocale(maintenant, journee.fuseau);
  const [pings, etiquettes, sessions, cumulS, sommeil, synchro, seances, synchroSeances, figes] = await Promise.all([
    db
      .prepare(
        `SELECT nom, MAX(vu_le) AS vu_le FROM appareils
         WHERE utilisateur = ? AND type_jeton = 'appareil' AND revoque_le IS NULL GROUP BY nom`,
      )
      .bind(jeton.utilisateur)
      .all<{ nom: string; vu_le: string | null }>(),
    lireCache<{ verifie_le: string; manquantes: string[] }>(db, jeton.utilisateur, CLES_CACHE.etiquettes),
    sessionsOuvertes(db, jeton.utilisateur, contexte, maintenant),
    cumulSessionsS(db, jeton.utilisateur, journee, maintenant),
    lireSommeil(db, jeton.utilisateur, versInstant(debutJourLocal(ajouterJours(journee.date, -nuitsALire(journee.date) - 1), journee.fuseau))),
    etatSynchro(db, jeton.utilisateur),
    lireSeances(db, jeton.utilisateur, versInstant(debutJourLocal(ajouterJours(jourCivil, -JOURS_VERIFIES - 1), journee.fuseau))),
    etatSynchroHevy(db, jeton.utilisateur),
    prevusFiges(db, jeton.utilisateur, ajouterJours(journee.date, -JOURS_DU_JOURNAL_DES_LEVERS - 1)),
  ]);
  const vuLe = new Map(pings.results.map((p) => [p.nom, p.vu_le]));
  const phase = phaseDe(journee, maintenant);
  const lues = dernieresNuits(deps.moteur, contexte, journee, sommeil, nuitsALire(journee.date));
  const { aujourdhui } = lues;
  const nuits = lues.nuits.slice(-NUITS_DU_STATUT);
  const siestesTotalMin = nuits.reduce((t, n) => t + n.siestes_min, 0) + somme(aujourdhui);
  return {
    heure_serveur: versInstant(maintenant),
    config_version: version,
    journee: vueJournee(journee),
    phase,
    actions: actionsPossibles(journee, phase),
    engagements_demain: deps.moteur.engagementsPrevus(contexte, ajouterJours(journee.date, 1)).map(vueEngagement),
    nuits,
    dette_cumulee_min: nuits.reduce((total, n) => total + n.dette_min, 0),
    ...dettesHebdomadaires(journee.date, lues.nuits, config.sommeil.cibleMin, somme(aujourdhui)),
    siestes_total_min: siestesTotalMin,
    siestes_du_jour: aujourdhui,
    siestes_du_jour_min: somme(aujourdhui),
    sieste_tardive: siesteTardive(journee, aujourdhui, maintenant),
    objectif_sommeil_min: config.sommeil.cibleMin,
    sommeil_mesure: synchro,
    levers: vueLevers(deps.moteur.journalDesLevers(contexte, journee.date, figes.levers)),
    couchers: vueCouchers(deps.moteur.journalDesCouchers(contexte, journee.date, lues.endormissements, figes.couchers)),
    ...engagementsVerifies(deps.moteur, contexte, seances, jourCivil),
    seances_mesurees: synchroSeances,
    appareils: Object.entries(config.appareils).map(([nom, def]) => {
      const etat = deps.moteur.etat(contexte, nom);
      const segment = deps.moteur.planifier(contexte, nom, HORIZON_H)[0];
      const bloquees = appsBloquees(config, etat.actions);
      return {
        nom,
        type: def.type,
        mode: etat.mode,
        sessions: etat.sessions,
        ...possibiliteSession(deps.moteur, contexte, nom, etat),
        raison: etat.raison,
        actions: etat.actions,
        apps_bloquees: bloquees,
        groupes_bloques: groupesBloques(config, etat.mode, bloquees),
        dernier_ping: vuLe.get(nom) ?? null,
        // Suppose les faits Todoist constants : à lire avec `sortie`, pas comme une certitude.
        jusqua: segment?.fin ?? decaler(maintenant, HORIZON_H * 3600),
        parcours: deps.moteur.expliquer(contexte, nom),
        sortie: vueSortie(deps.moteur.sortie(contexte, nom)),
      };
    }),
    appareil_principal: appareilPrincipal(config),
    sessions,
    sessions_du_jour: { cumul_min: Math.floor(cumulS / 60), plafond_min: config.sessions.plafondQuotidienMin },
    todoist: {
      dernier_changement: contexte.faits.recupereLe,
      etiquettes_verifiees_le: etiquettes?.valeur.verifie_le ?? null,
      etiquettes_manquantes: etiquettes?.valeur.manquantes ?? [],
    },
  };
}

const RANG_PRIORITE = { p1: 1, p2: 2, p3: 3, p4: 4 } as const;

export async function tachesEligibles(deps: Dependances, db: D1Database, jeton: JetonAuthentifie) {
  const maintenant = deps.maintenant();
  const { contexte } = await chargerContexte(db, jeton.utilisateur, maintenant);
  const journee = deps.moteur.journeeCourante(contexte);
  const taches = tachesDuJour(contexte, journee)
    .sort((a, b) => RANG_PRIORITE[a.priorite] - RANG_PRIORITE[b.priorite] || a.contenu.localeCompare(b.contenu, 'fr'))
    .map((t) => {
      const eligible = eligibleLe(contexte.config, t);
      return {
        id: t.id,
        nom: t.contenu,
        priorite: t.priorite,
        etiquettes: t.etiquettes,
        echeance: t.echeance,
        eligible_le: eligible,
        eligible: maintenant.getTime() >= ms(eligible),
      };
    });
  return { journee: journee.date, taches };
}

/** Pour l'extension (et le téléphone) : pourquoi cette cible est bloquée, et par quelle app. */
export async function raisonDuBlocage(
  deps: Dependances,
  db: D1Database,
  jeton: JetonAuthentifie,
  requete: { appareil?: string; domaine?: string; bundle?: string },
) {
  const maintenant = deps.maintenant();
  const { contexte } = await chargerContexte(db, jeton.utilisateur, maintenant);
  const appareil = requete.appareil ?? (jeton.typeJeton === 'appareil' ? jeton.nom : undefined);
  if (!appareil) throw requeteInvalide('Paramètre « appareil » manquant.', { champ: 'appareil' });
  appareilAutorise(jeton, appareil);
  appareilDeLaConfig(contexte, appareil);
  const cible = (requete.domaine ?? requete.bundle ?? '').trim().toLowerCase();
  if (!cible) throw requeteInvalide('Paramètre « domaine » ou « bundle » manquant.');

  const { config } = contexte;
  const entrees = Object.entries(config.apps);
  const trouvee = requete.domaine
    ? (entrees.find(([, a]) => a.domaines.includes(cible)) ??
      entrees.find(([, a]) => a.domaines.some((d) => cible.endsWith(`.${d}`))))
    : entrees.find(([, a]) => a.iphone?.toLowerCase() === cible);

  const etat = deps.moteur.etat(contexte, appareil);
  const sessions = await sessionsOuvertes(db, jeton.utilisateur, contexte, maintenant, appareil);
  const session = trouvee ? (sessions.find((s) => s.apps.includes(trouvee[0])) ?? null) : null;
  const pc = 'bloquer_domaines' in etat.actions;
  const bloqueParLeMode = pc
    ? (etat.actions as ActionsPc).bloquer_domaines.some((d) => d === cible || (trouvee?.[1].domaines.includes(d) ?? false))
    : 'bloquer_apps' in etat.actions && trouvee?.[1].iphone !== undefined && etat.actions.bloquer_apps.includes(trouvee[1].iphone);
  const verrouille = pc && (etat.actions as ActionsPc).verrouiller_session;
  return {
    appareil,
    cible,
    app: trouvee ? { id: trouvee[0], nom: trouvee[1].nom } : null,
    bloque: bloqueParLeMode && (verrouille || session === null),
    mode: etat.mode,
    raison: etat.raison,
    sessions: etat.sessions,
    session,
  };
}
