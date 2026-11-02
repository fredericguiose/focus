import { env } from 'cloudflare:workers';
import { moteur } from '../../core/src/index';
import { creerApp } from './app';
import type { Dependances, Liaisons } from './env';
import { HorlogeLocale } from './horloge';
import { executerTachesPlanifiees } from './planifie';
import { creerClientAgenda } from './google-agenda';
import { creerClientHevy } from './hevy';
import { creerClientTodoist } from './todoist';
import { creerClientXiaomi } from './xiaomi';

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

const horloge = new HorlogeLocale(() => env as Liaisons);

export default creerWorker({
  moteur,
  maintenant: horloge.maintenant,
  horloge,
  todoist: (jeton) => creerClientTodoist({ jeton }),
  xiaomi: (identifiants) => creerClientXiaomi(identifiants),
  hevy: (cle) => creerClientHevy({ cle }),
  agenda: (identifiants) => creerClientAgenda(identifiants),
  cacheCalculs: true,
});
