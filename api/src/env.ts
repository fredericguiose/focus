import type { Moteur } from '../../core/src/types';
import type { HorlogeLocale } from './horloge';
import type { ClientHevy } from './hevy';
import type { ClientTodoist } from './todoist';
import type { ClientXiaomi, IdentifiantsXiaomi } from './xiaomi';

/** Liaisons du Worker (wrangler.jsonc) et secret Todoist. */
export interface Liaisons {
  DB: D1Database;
  ASSETS?: Fetcher;
  /** Secret Worker ; absent en local tant qu'il n'est pas posé dans .dev.vars. */
  TODOIST_TOKEN?: string;
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
  /** Secret de chiffrement des jetons gardés en base ; absent : le passToken reçu n'est pas gardé. */
  CLE_CHIFFREMENT?: string;
  /** « local » seulement pour un essai sur la machine : autorise l'horloge réglable. */
  FOCUS_ENVIRONNEMENT?: string;
  /** Instant ISO ou décalage (« +3h », « -90min ») ; ignorée hors environnement local. */
  FOCUS_HORLOGE?: string;
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
  /** Présente si l'horloge peut être réglée (en local seulement, voir horloge.ts). */
  horloge?: HorlogeLocale;
}

export interface EnvApp {
  Bindings: Liaisons;
  Variables: { jeton: JetonAuthentifie };
}
