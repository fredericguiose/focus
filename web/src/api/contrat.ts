// Contrat de l'interface avec l'API (docs/conception.md §4). Le format réel des réponses et sa
// conversion vers ces types sont dans fil.ts ; l'API simulée produit directement ces types.
import type {
  ActionsIphone,
  ActionsPc,
  DemandeException,
  Exception,
  FrictionFournie,
  Instant,
  Journee,
  Priorite,
  PrixException,
  TypeAppareil,
} from '../../../core/src/types';

export type { ActionsIphone, ActionsPc, DemandeException, Exception, FrictionFournie, Instant, Journee, Priorite, PrixException, TypeAppareil };

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
  /** Le fait, énoncé positivement (« Planning du matin »), même pour un mode `pas`. */
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
  /** Faux si le mode ne concerne pas cet appareil (ex. matin verrouillé sur l'iPhone). */
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

/** Une sieste : session de sommeil prise pendant la journée de veille. */
export interface Sieste {
  debut: Instant;
  fin: Instant;
  minutes: number;
}

/** Moment de la journée, décidé par l'API. */
export type Phase = 'journee' | 'soiree' | 'nuit';

/** Ce que l'interface peut proposer maintenant : l'API décide, l'interface suit. */
export interface ActionsStatut {
  je_vais_dormir: { disponible: boolean; motif: string | null };
  decaler_coucher: { mode: 'libre' | 'decision_de_nuit' | 'indisponible'; motif: string | null };
}

/** Engagement du lendemain (jour du prochain lever), tel que la config et les exceptions le donnent. */
export interface EngagementDemain {
  /** Clé de l'engagement : c'est elle qu'on envoie dans `retire` et `decale`. */
  id: string;
  nom: string;
  reveil: Instant | null;
  heure: Instant | null;
  annulable: boolean;
  decalable: boolean;
  origine: 'routine' | 'exception';
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
  /** Somme des dettes réelles des nuits mesurées ; null si aucune ne l'est. */
  dette_cumulee_reelle_min?: number | null;
  /** État de la synchro du sommeil mesuré ; null si jamais tentée. */
  sommeil_mesure?: { derniere_synchro: Instant | null; erreur: string | null } | null;
  /** Objectif de sommeil de la config (`sommeil.cible`), en minutes. */
  objectif_sommeil_min?: number;
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
