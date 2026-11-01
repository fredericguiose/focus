import { moteur } from '../../core/src/index';
import { creerApp } from './app';
import type { Dependances, Liaisons } from './env';
import { executerTachesPlanifiees } from './planifie';
import { creerClientTodoist } from './todoist';

/** Le moteur, l'horloge et Todoist sont injectés : les tests remplacent chaque pièce. */
export function creerWorker(deps: Dependances): ExportedHandler<Liaisons> {
  const app = creerApp(deps);
  return {
    fetch: app.fetch,
    async scheduled(_controleur, env, ctx) {
      ctx.waitUntil(executerTachesPlanifiees(env, deps));
    },
  };
}

export default creerWorker({
  moteur,
  maintenant: () => new Date(),
  todoist: (jeton) => creerClientTodoist({ jeton }),
});
