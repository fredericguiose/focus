// Contrat de l'interface avec l'API (docs/conception.md §4). Le format réel des réponses et sa
// conversion vers ces types sont dans fil.ts ; l'API simulée produit directement ces types.
import type {
  ActionsIphone,
  ActionsPc,
  DateLocale,
  DemandeException,
  Exception,
  FrictionFournie,
  Instant,
  Journee,
  Priorite,
  PrixException,
  TypeAppareil,
} from '../../../core/src/types';

export type { ActionsIphone, ActionsPc, DateLocale, DemandeException, Exception, FrictionFournie, Instant, Journee, Priorite, PrixException, TypeAppareil };

/** Corps de toute réponse d'erreur (§4.2). */
export interface CorpsErreur {
  erreur: string;
  message: string;
}

/** App bloquée par le mode en vigueur sur un appareil, avant les sessions. */
export interface AppBloquee {
  id: string;
  nom: string;
  /** Domaines exacts, tels qu'écrits dans le fichier hosts (vide pour l'iPhone). */
  domaines: string[];
  /** Identifiant de l'app sur iPhone, s'il y en a un (donné par l'API réelle). */
  iphone?: string | null;
}

/** Type d'une condition de mode (conception §2.6), tel que l'API le résume pour l'affichage. */
export type TypeCondition = 'toujours' | 'heure' | 'planning' | 'recap' | 'prioritaires' | 'retard' | 'taches';

export interface ConditionParcours {
  type: TypeCondition;
  /** Le fait, énoncé positivement (« Planning du jour »), même pour un mode `pas`. */
  libelle: string;
  /** État réel du fait maintenant (fait / pas fait ; heure atteinte ou non). */
  vraie: boolean;
  /** Précision lisible, ex. « à faire », « en retard depuis le 8 oct. », « +20 min de report ». */
  detail: string | null;
  /** Pour une condition `heure` : l'instant à partir duquel le fait est vrai. */
  a: Instant | null;
  /** Le mode exige le contraire du fait (`pas`). Absent d'une API plus ancienne. */
  niee?: boolean;
}

/** Un mode de la routine du jour pour cet appareil, avec ses conditions évaluées maintenant. */
export interface EtapeParcours {
  mode: string;
  nom: string;
  /** Faux si le mode ne concerne pas cet appareil (ex. journée verrouillée sur l'iPhone). */
  applicable: boolean;
  actif: boolean;
  logique: 'tous' | 'un_parmi' | 'pas' | 'simple';
  conditions: ConditionParcours[];
}

/** Comment le mode en cours finira. Seule une sortie `certaine` justifie un compte à rebours. */
export interface SortieMode {
  texte: string;
  certaine: boolean;
  /** Fin au plus tard (ex. le coucher), quoi qu'il arrive. */
  au_plus_tard: Instant;
}

export interface StatutAppareil {
  /** Nom de l'appareil dans la config, ex. "pc_linux". */
  appareil: string;
  type: TypeAppareil;
  mode: string;
  /** Phrase lisible : pourquoi ce mode. */
  raison: string;
  sessions: 'autorisees' | 'interdites';
  /** Une session peut-elle s'ouvrir ici maintenant (§4.5) ; sinon `session_motif` dit pourquoi. */
  session_possible: boolean;
  session_motif: string | null;
  /**
   * Fin du segment en cours si les faits ne changent pas (planning, tâches…) : ce n'est pas une
   * certitude, ne pas l'afficher comme telle ; préférer `sortie`.
   */
  jusqua?: Instant | null;
  /** Modes de la routine, dans l'ordre de priorité (optionnel : absent d'une API plus ancienne). */
  parcours?: EtapeParcours[];
  sortie?: SortieMode;
  /** Dernier appel authentifié de l'appareil (`dernier_ping`, précision 5 min), null s'il n'a jamais appelé. */
  vu_le: Instant | null;
  /** Actions du mode en vigueur (domaines ou identifiants iPhone bloqués). */
  actions?: ActionsPc | ActionsIphone;
  /** Donné par l'API (`apps_bloquees`) ; absent d'une API plus ancienne, `ApiFocus.appsBloquees` le reconstitue. */
  apps_bloquees?: AppBloquee[];
  /** Groupes du catalogue que le mode bloque ici, réduits aux apps bloquées (absent d'une API plus ancienne). */
  groupes_bloques?: GroupeBloque[];
}

export interface GroupeBloque {
  id: string;
  /** Nom lisible, ex. « IA conversationnelle ». */
  nom: string;
  /** Identifiants des apps bloquées du groupe. */
  apps: string[];
}

export interface Question {
  id: string;
  posee_a: Instant;
  /** Secondes à attendre après `posee_a` avant qu'un « continue » soit accepté. */
  attente_s: number;
  expire_a: Instant;
}

export interface SessionOuverte {
  id: string;
  appareil: string;
  /** null pour une session sans tâche (type prévu par l'API, pas ouvert par l'interface). */
  tache: { id: string; nom: string } | null;
  apps: string[];
  domaines: string[];
  ouverte_le: Instant;
  question: Question | null;
  /** Prochaine question prévue, si l'API la donne (champ optionnel, pas encore renvoyé par l'API réelle). */
  prochaine_question_a?: Instant | null;
}

/** Minutes de chaque phase d'une nuit mesurée (montre Xiaomi). */
export interface PhasesSommeil {
  legere: number;
  profonde: number;
  rem: number;
  eveil: number;
}

/** Bilan d'une nuit passée : dette positive = moins dormi que la cible. */
export interface NuitPassee {
  nuit: string;
  /** Dette prévue : cible − (lever − coucher appliqué). */
  dette_min: number;
  /** Dette réelle : cible − temps endormi mesuré ; null ou absente sans mesure. */
  dette_reelle_min?: number | null;
  /** Minutes dormies mesurées par la montre (siestes exclues) ; null ou absent sans mesure. */
  endormi_min?: number | null;
  phases?: PhasesSommeil | null;
  /** La montre a marqué la mesure incomplète. */
  incomplete?: boolean;
  /** Siestes de la journée D (avant la nuit D), en minutes dormies ; absent d'une API plus ancienne. */
  siestes_min?: number;
  siestes?: Sieste[];
}

/**
 * Dette de sommeil d'une semaine (lundi → dimanche ; une nuit appartient à la semaine du matin où elle
 * se termine : celle de dimanche à lundi ouvre la semaine, celle de samedi à dimanche la clôt), règle
 * comptable : `dette_min` = Σ des manques des nuits mesurées ; `rattrape_min` = Σ des surplus +
 * siestes (celle de la journée D + 1 rattrape la nuit D) ; reste = max(0, dette − rattrapé).
 */
export interface DetteSemaine {
  /** Lundi et dimanche de la semaine. */
  debut: DateLocale;
  fin: DateLocale;
  dette_min: number;
  rattrape_min: number;
  reste_min: number;
  /** Nuits de ce soir à celle de samedi à dimanche, incluses (1 le samedi, 7 le dimanche soir). */
  nuits_restantes: number;
  /** Nuits finies de la semaine, et celles que la montre a mesurées. */
  nuits_mesurees: number;
  nuits_total: number;
}

/** Bilan d'une semaine close, recalculé à partir des mesures. */
export interface BilanSemaine {
  debut: DateLocale;
  fin: DateLocale;
  dette_min: number;
  rattrape_min: number;
  non_rattrape_min: number;
  nuits_mesurees: number;
  nuits_total: number;
}

/** Une sieste : session de sommeil prise pendant la journée de veille. */
export interface Sieste {
  debut: Instant;
  fin: Instant;
  minutes: number;
}

/** Lever d'un jour : prévu (plan de la veille au soir) et mesuré par la montre. */
export interface LeverDuJour {
  date: DateLocale;
  /** Fuseau de la routine de ce jour, dans lequel lire ses heures (voyage) ; absent d'une API plus ancienne. */
  fuseau?: string;
  prevu: Instant;
  /** Vrai si le prévu a été figé la veille au soir ; faux s'il est recalculé. */
  prevu_fige: boolean;
  /** null sans mesure. */
  mesure: Instant | null;
  /** Mesuré − prévu en minutes (positif : levé plus tard que prévu) ; null sans mesure. */
  ecart_min: number | null;
  /** Mesure non comptée (référence du plan, amplitude) : retour d'un autre fuseau. Absent sinon. */
  ignore?: 'decalage_horaire';
}

/** Régularité des levers : affichée, ne bloque rien. */
export interface RegulariteLevers {
  /** 7 derniers jours (le dernier = la journée en cours), du plus ancien au plus récent. */
  jours: LeverDuJour[];
  /** Lever mesuré le plus tôt et le plus tard (heures locales, mesures ignorées exclues) ; null sous 2 mesures. */
  amplitude: { plus_tot: Instant; plus_tard: Instant; ecart_min: number; mesures: number } | null;
  /** Écart maximal voulu entre deux levers d'une même semaine (`sommeil.ecart_lever_max`). */
  limite_min: number;
}

/** Coucher d'une nuit : prévu (plan au coucher) et endormissement mesuré par la montre. */
export interface CoucherDeLaNuit {
  /** Date du soir. */
  nuit: DateLocale;
  /** Fuseau de la routine du soir, dans lequel lire ses heures (voyage) ; absent d'une API plus ancienne. */
  fuseau?: string;
  prevu: Instant;
  /** Vrai si le prévu a été figé par la photo de la nuit ; faux s'il est recalculé. */
  prevu_fige: boolean;
  /** Endormissement mesuré (début de la nuit principale) ; null sans mesure. */
  mesure: Instant | null;
  /** Mesuré − prévu en minutes (positif : endormi plus tard que prévu) ; null sans mesure. */
  ecart_min: number | null;
  /** Mesure non comptée dans l'amplitude : retour d'un autre fuseau. Absent sinon. */
  ignore?: 'decalage_horaire';
}

/** Régularité des couchers : affichage seul, aucune contrainte (le coucher prévu découle du lever). */
export interface RegulariteCouchers {
  /** 7 nuits avant la journée en cours, de la plus ancienne à la plus récente. */
  nuits: CoucherDeLaNuit[];
  /** Endormissement mesuré le plus tôt et le plus tard (comptés depuis midi : 23:30 et 00:30 font 1 h) ; null sous 2 mesures. */
  amplitude: { plus_tot: Instant; plus_tard: Instant; ecart_min: number; mesures: number } | null;
  /** Repère : le même écart maximal que les levers (`sommeil.ecart_lever_max`). */
  limite_min: number;
}

/** À quoi sert une étiquette citée par la config (api/src/planifie.ts, `usagesDesEtiquettes`). */
export type UsageEtiquette = 'planning' | 'recap' | 'exclusion' | 'condition';

/** État Todoist : étiquettes citées par la config et introuvables dans Todoist (vérifiées par la tâche planifiée). */
export interface EtatTodoist {
  /** Dernière fois que les tâches Todoist ont changé. */
  dernier_changement: Instant | null;
  /** Dernière vérification des étiquettes ; null si jamais faite. */
  etiquettes_verifiees_le: Instant | null;
  etiquettes_manquantes: string[];
  /** Rôle de chaque étiquette manquante (absent d'une API plus ancienne). */
  etiquettes_manquantes_detail?: { etiquette: string; usages: UsageEtiquette[]; modes: string[] }[];
}

/** Moment de la journée, décidé par l'API. */
export type Phase = 'journee' | 'soiree' | 'nuit';

/** Ce que l'interface peut proposer maintenant : l'API décide, l'interface suit. */
export interface ActionsStatut {
  je_vais_dormir: { disponible: boolean; motif: string | null };
  decaler_coucher: { mode: 'raison' | 'decision_de_nuit' | 'indisponible'; motif: string | null };
}

/** Engagement du lendemain (jour du prochain lever), tel que la config et les exceptions le donnent. */
export interface EngagementDemain {
  /** Clé de l'engagement : c'est elle qu'on envoie dans `retire` et `decale`. */
  id: string;
  nom: string;
  reveil: Instant | null;
  heure: Instant | null;
  /** Obligatoire : le retirer ou le repousser demande une raison. Facultatif : libre. */
  obligatoire: boolean;
  /** Ne fixe pas le réveil ; « décaler » lui donne une heure pour ce jour-là. */
  sans_heure: boolean;
  origine: 'routine' | 'exception';
}

/**
 * fait ; sauté et déclaré (exception « retire ») ; sauté sans le dire ; facultatif et non fait
 * (jamais compté dans les sautés) ; pas encore fait (aujourd'hui ou à venir).
 */
export type StatutEngagement = 'fait' | 'saute_declare' | 'saute_non_declare' | 'facultatif_non_fait' | 'a_faire';

/** Un engagement vérifié par une mesure (ex. séance Hevy) un jour où il était prévu. */
export interface EngagementVerifie {
  date: DateLocale;
  engagement: string;
  nom: string;
  statut: StatutEngagement;
}

/** GET /v1/statut */
export interface ReponseStatut {
  heure_serveur: Instant;
  config_version: string | null;
  journee: Journee;
  /** Appareil dont la web app montre le mode (absent d'une API plus ancienne : le premier). */
  appareil_principal?: string;
  appareils: StatutAppareil[];
  sessions: SessionOuverte[];
  /** Cumul des sessions de la journée et plafond quotidien. */
  sessions_du_jour?: { cumul_min: number; plafond_min: number };
  /** Dernières nuits, de la plus ancienne à la plus récente (optionnel : pas encore renvoyé par l'API réelle). */
  nuits?: NuitPassee[];
  /** Dette de sommeil cumulée sur ces nuits (optionnel, idem). */
  dette_cumulee_min?: number;
  /** Dette de sommeil de la semaine en cours, lundi → dimanche (absente d'une API plus ancienne). */
  dette_semaine?: DetteSemaine;
  /** Bilans des 4 dernières semaines closes, la plus récente d'abord. */
  bilans_semaines?: BilanSemaine[];
  /** État de la synchro du sommeil mesuré ; null si jamais tentée. */
  sommeil_mesure?: { derniere_synchro: Instant | null; erreur: string | null } | null;
  /** Objectif de sommeil de la config (`sommeil.cible`), en minutes. */
  objectif_sommeil_min?: number;
  /** Levers prévus et mesurés des 7 derniers jours (absent d'une API plus ancienne). */
  levers?: RegulariteLevers;
  /** Couchers prévus et endormissements mesurés des 7 dernières nuits (absent d'une API plus ancienne). */
  couchers?: RegulariteCouchers;
  /** Minutes de sieste sur la période (journées des 7 nuits et journée en cours). */
  siestes_total_min?: number;
  /** Siestes de la journée en cours (après la dernière nuit). */
  siestes_du_jour?: Sieste[];
  siestes_du_jour_min?: number;
  /** Sieste du jour finie moins de 4 h avant le coucher appliqué ; null sinon. */
  sieste_tardive?: { fin: Instant; coucher: Instant } | null;
  /** Absents d'une API plus ancienne : l'interface n'invente alors rien (actions désactivées). */
  phase?: Phase;
  actions?: ActionsStatut;
  engagements_demain?: EngagementDemain[];
  /** Date civile du jour (fuseau de la journée). */
  aujourdhui?: DateLocale;
  /** 7 derniers jours, aujourd'hui et le reste de la semaine (lun → dim). */
  engagements_verifies?: EngagementVerifie[];
  /** Sautés (déclarés ou non) du lundi à aujourd'hui. */
  sautes_semaine?: number;
  /** État de la synchro des séances (Hevy) ; null si jamais tentée. */
  seances_mesurees?: { derniere_synchro: Instant | null; erreur: string | null } | null;
  /** Étiquettes Todoist manquantes (absent d'une API plus ancienne). */
  todoist?: EtatTodoist;
}

export interface TacheSession {
  id: string;
  nom: string;
  priorite: Priorite;
  /** Création + 15 min : avant, l'API refuse d'ouvrir une session dessus. */
  eligible_le: Instant;
}

/** GET /v1/taches */
export interface ReponseTaches {
  taches: TacheSession[];
}

/** POST /v1/sessions */
export interface CorpsOuvertureSession {
  appareil: string;
  tache_id: string;
  apps: string[];
}

/** POST /v1/sessions/:id/reponse */
export interface CorpsReponseQuestion {
  question_id: string;
  reponse: 'continue' | 'arrete';
}

/** POST /v1/exceptions/prix et POST /v1/exceptions (envoyé à plat : voir fil.ts). */
export interface CorpsException {
  demande: DemandeException;
  friction?: FrictionFournie;
}

/**
 * Ce dont l'interface a besoin. Les actions sur les sessions et l'enregistrement d'une exception
 * ne lisent pas le corps de la réponse : l'interface relit /v1/statut, ce qui la rend insensible
 * à la forme exacte de ces réponses.
 */
export interface ApiFocus {
  statut(): Promise<ReponseStatut>;
  /** POST /v1/actualiser : synchro Todoist forcée côté serveur, cache effacé, statut frais. */
  actualiser(): Promise<ReponseStatut>;
  taches(): Promise<ReponseTaches>;
  /** Apps (id, nom) bloquées par le mode en vigueur : celles qu'une session peut débloquer. */
  appsBloquees(appareil: StatutAppareil): Promise<AppBloquee[]>;
  ouvrirSession(corps: CorpsOuvertureSession): Promise<void>;
  ajouterApp(sessionId: string, app: string): Promise<void>;
  repondre(sessionId: string, corps: CorpsReponseQuestion): Promise<void>;
  fermerSession(sessionId: string): Promise<void>;
  prixException(corps: CorpsException): Promise<PrixException>;
  enregistrerException(corps: CorpsException): Promise<void>;
}
