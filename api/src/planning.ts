// Planning d'un appareil (§4.3), statut pour l'interface, tâches du jour, raison d'un blocage.
import type { ActionsIphone, ActionsPc, Config, Contexte, EngagementPrevu, Journee, Moteur, Segment, SortieMode } from '../../core/src/types';
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
import { ajouterJours, decaler, heureLocale, ms, versInstant } from './temps';

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
        ? { mode: 'libre' as const, motif: null }
        : j.decisionDeNuitPrise
          ? { mode: 'indisponible' as const, motif: `décision de nuit déjà prise pour la nuit du ${j.date} (une seule par nuit)` }
          : { mode: 'decision_de_nuit' as const, motif: `soirée ouverte depuis ${ouverture} : raison et phrase exigées, une fois par nuit` },
  };
}

function vueEngagement(e: EngagementPrevu) {
  return { id: e.id, nom: e.nom, reveil: e.reveil, heure: e.heure, annulable: e.annulable, decalable: e.decalable, origine: e.origine };
}

/** Les nuits terminées avant la journée courante, de la plus ancienne à la plus récente. */
export function dernieresNuits(moteur: Moteur, contexte: Contexte, j: Journee) {
  const nuits = [];
  for (let n = NUITS_DU_STATUT; n >= 1; n--) {
    const nuit = ajouterJours(j.date, -n);
    nuits.push({ nuit, dette_min: moteur.journee(contexte, nuit).detteNuitMin });
  }
  return nuits;
}

export async function statut(deps: Dependances, db: D1Database, jeton: JetonAuthentifie) {
  const maintenant = deps.maintenant();
  const { contexte, version } = await chargerContexte(db, jeton.utilisateur, maintenant);
  const { config } = contexte;
  const journee = deps.moteur.journeeCourante(contexte);
  const [pings, etiquettes, sessions, cumulS] = await Promise.all([
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
  ]);
  const vuLe = new Map(pings.results.map((p) => [p.nom, p.vu_le]));
  const phase = phaseDe(journee, maintenant);
  const nuits = dernieresNuits(deps.moteur, contexte, journee);
  return {
    heure_serveur: versInstant(maintenant),
    config_version: version,
    journee: vueJournee(journee),
    phase,
    actions: actionsPossibles(journee, phase),
    engagements_demain: deps.moteur.engagementsPrevus(contexte, ajouterJours(journee.date, 1)).map(vueEngagement),
    nuits,
    dette_cumulee_min: nuits.reduce((total, n) => total + n.dette_min, 0),
    appareils: Object.entries(config.appareils).map(([nom, def]) => {
      const etat = deps.moteur.etat(contexte, nom);
      const segment = deps.moteur.planifier(contexte, nom, HORIZON_H)[0];
      return {
        nom,
        type: def.type,
        mode: etat.mode,
        sessions: etat.sessions,
        ...possibiliteSession(deps.moteur, contexte, nom, etat),
        raison: etat.raison,
        actions: etat.actions,
        apps_bloquees: appsBloquees(config, etat.actions),
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
