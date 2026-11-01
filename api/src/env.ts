import type { Moteur } from '../../core/src/types';
import type { HorlogeLocale } from './horloge';
import type { ClientTodoist } from './todoist';

/** Liaisons du Worker (wrangler.jsonc) et secret Todoist. */
export interface Liaisons {
  DB: D1Database;
  ASSETS?: Fetcher;
  /** Secret Worker ; absent en local tant qu'il n'est pas posé dans .dev.vars. */
  TODOIST_TOKEN?: string;
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
  /** Présente si l'horloge peut être réglée (en local seulement, voir horloge.ts). */
  horloge?: HorlogeLocale;
}

export interface EnvApp {
  Bindings: Liaisons;
  Variables: { jeton: JetonAuthentifie };
}
