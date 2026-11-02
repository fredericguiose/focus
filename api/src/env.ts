import type { Moteur } from '../../core/src/types';
import type { Hote } from './acces';
import type { HorlogeLocale } from './horloge';
import type { ClientAgenda, IdentifiantsGoogle } from './google-agenda';
import type { ClientHevy } from './hevy';
import type { ClientTodoist } from './todoist';
import type { ClientXiaomi, IdentifiantsXiaomi } from './xiaomi';

/** Liaisons du Worker (wrangler.jsonc) et secret Todoist. */
export interface Liaisons {
  DB: D1Database;
  ASSETS?: Fetcher;
  /** Secret Worker ; absent en local tant qu'il n'est pas posé dans .dev.vars. */
  TODOIST_TOKEN?: string;
  /** Utilisateur Focus à qui appartient le compte Todoist ; seul synchronisé. Absent : pas de synchro. */
  TODOIST_UTILISATEUR?: string;
  /** Secrets Worker du cloud Xiaomi (Mi Fitness) ; absents : pas de sommeil mesuré. */
  XIAOMI_USER_ID?: string;
  XIAOMI_PASS_TOKEN?: string;
  /** « de », « sg », « us »… ; vide ou « cn » : hôte chinois. */
  XIAOMI_REGION?: string;
  /** Utilisateur Focus à qui appartient le compte Xiaomi ; seul synchronisé. Absent : pas de synchro. */
  XIAOMI_UTILISATEUR?: string;
  /** Début du rattrapage de l'historique (AAAA-MM-JJ) ; absent : 60 jours en arrière. */
  XIAOMI_DEPUIS?: string;
  /** Clé d'API Hevy (compte Pro) ; absente : pas de séances mesurées. */
  HEVY_API_KEY?: string;
  /** Utilisateur Focus à qui appartient le compte Hevy ; seul synchronisé. */
  HEVY_UTILISATEUR?: string;
  /**
   * Secrets Worker de Google Agenda (bloc « Dormir ») : client OAuth (type « installed ») et
   * refresh token initial (api/scripts/google-autoriser.mjs). Un seul absent : pas de synchro.
   */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  /** Utilisateur Focus à qui appartient l'agenda Google ; seul synchronisé. Absent : pas de synchro. */
  GOOGLE_UTILISATEUR?: string;
  /** Adresse de contact affichée sur les pages publiques (/confidentialite, /conditions) ; absente : pas de ligne de contact. */
  CONTACT_EMAIL?: string;
  /** Secret de chiffrement des jetons gardés en base ; absent : le passToken reçu n'est pas gardé. */
  CLE_CHIFFREMENT?: string;
  /** « local » seulement pour un essai sur la machine : autorise l'horloge réglable. */
  FOCUS_ENVIRONNEMENT?: string;
  /** Instant ISO ou décalage (« +3h », « -90min ») ; ignorée hors environnement local. */
  FOCUS_HORLOGE?: string;
  /** Production : hôte de la web app, derrière Cloudflare Access (ex. focus.example.com). */
  HOTE_WEB?: string;
  /** Production : hôte de l'API des clients, sans Access (ex. api-focus.example.com). */
  HOTE_API?: string;
  /** Domaine d'équipe Access, ex. https://equipe.cloudflareaccess.com (émetteur des JWT). */
  ACCES_EQUIPE?: string;
  /** Tag d'audience (AUD) de l'application Access de la web app. */
  ACCES_AUD?: string;
  /**
   * Secret : correspondance e-mail Access → utilisateur Focus, « a@x.fr=alice,b@y.fr=bob ».
   * Obligatoire en production (hôte web fermé sinon) ; ses e-mails sont les e-mails autorisés.
   */
  ACCES_UTILISATEURS?: string;
  /** Facultatif : restreint encore les e-mails autorisés (virgules ou espaces). */
  ACCES_EMAILS?: string;
  /**
   * Local seulement (posée par scripts/local.mjs) : sans en-tête Authorization, /v1/* vaut jeton
   * « interface » de cet utilisateur. Absente : jeton exigé.
   */
  FOCUS_UTILISATEUR_LOCAL?: string;
}

export type TypeJeton = 'appareil' | 'interface' | 'config';
export type TypeAppareilJeton = 'pc_linux' | 'pc_windows' | 'iphone';

export interface JetonAuthentifie {
  id: number;
  utilisateur: string;
  /** Pour un jeton appareil : identifiant de l'appareil dans la config. */
  nom: string;
  typeJeton: TypeJeton;
  typeAppareil: TypeAppareilJeton | null;
}

/** Tout ce qui vient de l'extérieur est injecté : les tests remplacent chaque pièce. */
export interface Dependances {
  moteur: Moteur;
  maintenant: () => Date;
  todoist: (jeton: string) => ClientTodoist;
  /** Absent : la synchro du sommeil est sautée. */
  xiaomi?: (identifiants: IdentifiantsXiaomi) => ClientXiaomi;
  /** Absent : la synchro des séances est sautée. */
  hevy?: (cle: string) => ClientHevy;
  /** Absent : la synchro du bloc « Dormir » dans Google Agenda est sautée. */
  agenda?: (identifiants: IdentifiantsGoogle) => ClientAgenda;
  /** Présente si l'horloge peut être réglée (en local seulement, voir horloge.ts). */
  horloge?: HorlogeLocale;
  /**
   * Vrai : statut et planning gardés 60 s (table cache_calculs, §4.7). Activé par le Worker ; les
   * tests l'activent explicitement (ils écrivent souvent en base sans passer par l'API).
   */
  cacheCalculs?: boolean;
  /** Lecture des certificats Access ; absent : `fetch`. Les tests la simulent. */
  recupererCertsAcces?: (url: string) => Promise<Response>;
}

export interface EnvApp {
  Bindings: Liaisons;
  Variables: {
    jeton: JetonAuthentifie;
    hote: Hote;
    /**
     * Utilisateur établi sans jeton : e-mail Access vérifié (hôte web) ou FOCUS_UTILISATEUR_LOCAL
     * (local). Absent sur l'hôte de l'API.
     */
    utilisateurImplicite?: string;
  };
}
