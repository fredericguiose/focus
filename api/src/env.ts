import type { Moteur } from '../../core/src/types';
import type { ClientTodoist } from './todoist';

/** Liaisons du Worker (wrangler.jsonc) et secret Todoist. */
export interface Liaisons {
  DB: D1Database;
  ASSETS?: Fetcher;
  /** Secret Worker ; absent en local tant qu'il n'est pas posé dans .dev.vars. */
  TODOIST_TOKEN?: string;
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
}

export interface EnvApp {
  Bindings: Liaisons;
  Variables: { jeton: JetonAuthentifie };
}
