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

export interface StatutAppareil {
  /** Nom de l'appareil dans la config, ex. "pc_linux". */
  appareil: string;
  type: TypeAppareil;
  mode: string;
  /** Phrase lisible : pourquoi ce mode. */
  raison: string;
  sessions: 'autorisees' | 'interdites';
  /** Fin du mode en cours, donnée par l'API : sert au compte à rebours (jamais déduite). */
  jusqua?: Instant | null;
  /** Dernier appel authentifié de l'appareil (`dernier_ping`, précision 5 min), null s'il n'a jamais appelé. */
  vu_le: Instant | null;
  /** Actions du mode en vigueur (domaines ou identifiants iPhone bloqués). */
  actions?: ActionsPc | ActionsIphone;
  /** Donné par l'API (`apps_bloquees`) ; absent d'une API plus ancienne, `ApiFocus.appsBloquees` le reconstitue. */
  apps_bloquees?: AppBloquee[];
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

/** Bilan d'une nuit passée : dette positive = moins dormi que la cible. */
export interface NuitPassee {
  nuit: string;
  dette_min: number;
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
  appareils: StatutAppareil[];
  sessions: SessionOuverte[];
  /** Cumul des sessions de la journée et plafond quotidien. */
  sessions_du_jour?: { cumul_min: number; plafond_min: number };
  /** Dernières nuits, de la plus ancienne à la plus récente (optionnel : pas encore renvoyé par l'API réelle). */
  nuits?: NuitPassee[];
  /** Dette de sommeil cumulée sur ces nuits (optionnel, idem). */
  dette_cumulee_min?: number;
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
