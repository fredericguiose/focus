import { Hono } from 'hono';
import { TOUS, exigerJeton } from './auth';
import { recevoirConfig, versionActive } from './config';
import type { Dependances, EnvApp } from './env';
import { ErreurApi, repondreErreur } from './erreurs';
import { enregistrerAccuse, enregistrerEvenements } from './evenements';
import { apercuException, enregistrerException } from './exceptions';
import { planningAppareil, raisonDuBlocage, statut, tachesEligibles } from './planning';
import { ajouterApps, fermerSession, ouvrirSession, repondreQuestion } from './sessions';
import { lireCorps } from './validation';

/** Fabrique de l'app HTTP : le moteur, l'horloge et Todoist sont injectés. */
export function creerApp(deps: Dependances) {
  const app = new Hono<EnvApp>();
  const appareil = exigerJeton(deps, 'appareil');
  const interfaceSeule = exigerJeton(deps, 'interface');
  const interfaceOuAppareil = exigerJeton(deps, 'interface', 'appareil');

  app.get('/v1/planning', appareil, async (c) => {
    const planning = await planningAppareil(deps, c.env.DB, c.get('jeton'));
    c.header('Cache-Control', 'no-store');
    return c.json(planning);
  });

  app.post('/v1/accuses', appareil, async (c) =>
    c.json(await enregistrerAccuse(deps, c.env.DB, c.get('jeton'), await lireCorps(c)), 201),
  );

  app.post('/v1/evenements', appareil, async (c) =>
    c.json(await enregistrerEvenements(deps, c.env.DB, c.get('jeton'), await lireCorps(c))),
  );

  app.get('/v1/statut', interfaceSeule, async (c) => c.json(await statut(deps, c.env.DB, c.get('jeton'))));

  app.get('/v1/taches', interfaceOuAppareil, async (c) => c.json(await tachesEligibles(deps, c.env.DB, c.get('jeton'))));

  app.get('/v1/blocage', interfaceOuAppareil, async (c) =>
    c.json(
      await raisonDuBlocage(deps, c.env.DB, c.get('jeton'), {
        appareil: c.req.query('appareil'),
        domaine: c.req.query('domaine'),
        bundle: c.req.query('bundle'),
      }),
    ),
  );

  app.post('/v1/sessions', interfaceOuAppareil, async (c) =>
    c.json({ session: await ouvrirSession(deps, c.env.DB, c.get('jeton'), await lireCorps(c)) }, 201),
  );

  app.post('/v1/sessions/:id/apps', interfaceOuAppareil, async (c) =>
    c.json({ session: await ajouterApps(deps, c.env.DB, c.get('jeton'), c.req.param('id'), await lireCorps(c)) }),
  );

  app.post('/v1/sessions/:id/reponse', interfaceOuAppareil, async (c) =>
    c.json({ session: await repondreQuestion(deps, c.env.DB, c.get('jeton'), c.req.param('id'), await lireCorps(c)) }),
  );

  app.post('/v1/sessions/:id/fermer', interfaceOuAppareil, async (c) =>
    c.json({ session: await fermerSession(deps, c.env.DB, c.get('jeton'), c.req.param('id')) }),
  );

  app.post('/v1/exceptions/prix', interfaceSeule, async (c) =>
    c.json(await apercuException(deps, c.env.DB, c.get('jeton'), await lireCorps(c))),
  );

  app.post('/v1/exceptions', interfaceSeule, async (c) =>
    c.json(await enregistrerException(deps, c.env.DB, c.get('jeton'), await lireCorps(c)), 201),
  );

  app.post('/v1/config', exigerJeton(deps, 'config'), async (c) =>
    c.json(await recevoirConfig(deps, c.env.DB, c.get('jeton'), await lireCorps(c)), 201),
  );

  app.get('/v1/config/version', exigerJeton(deps, ...TOUS), async (c) => c.json(await versionActive(c.env.DB, c.get('jeton'))));

  app.all('/v1/*', () => {
    throw new ErreurApi(404, 'introuvable', "Point d'entrée inconnu.");
  });

  // Hors /v1, le Worker n'est appelé que si les fichiers statiques n'ont rien trouvé.
  app.notFound((c) => (c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text('Introuvable', 404)));

  app.onError((e, c) => {
    if (e instanceof ErreurApi) return repondreErreur(c, e);
    console.error('Erreur interne :', e);
    return repondreErreur(c, new ErreurApi(500, 'erreur_interne', 'Erreur interne du serveur.'));
  });

  return app;
}
