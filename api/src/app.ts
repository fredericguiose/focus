import { Hono } from 'hono';
import { gardeAcces, horsHoteApi } from './acces';
import { actualiser } from './actualiser';
import { TOUS, exigerJeton } from './auth';
import { invaliderTout } from './cache';
import { recevoirConfig, versionActive } from './config';
import { adresseRetour, connecterGoogle, deconnecterGoogle, etatConnecteurs, retourGoogle } from './connecteurs';
import type { Dependances, EnvApp } from './env';
import { ErreurApi, repondreErreur } from './erreurs';
import { enregistrerAccuse, enregistrerEvenements } from './evenements';
import { apercuException, enregistrerException } from './exceptions';
import { planningAppareil, raisonDuBlocage, statut, tachesEligibles } from './planning';
import { ajouterApps, fermerSession, ouvrirSession, repondreQuestion } from './sessions';
import { CHEMINS_PUBLICS, pagePublique } from './pages-publiques';
import { lireCorps } from './validation';

/** Fabrique de l'app HTTP : le moteur, l'horloge et Todoist sont injectés. */
export function creerApp(deps: Dependances) {
  const app = new Hono<EnvApp>();
  const appareil = exigerJeton(deps, 'appareil');
  // Route réservée au jeton d'interface : 404 sur l'hôte de l'API (src/acces.ts).
  const interfaceSeule = [horsHoteApi, exigerJeton(deps, 'interface')] as const;
  const interfaceOuAppareil = exigerJeton(deps, 'interface', 'appareil');

  // Avant tout le reste, fichiers statiques compris : hôte, et JWT Access sur l'hôte web.
  app.use('*', gardeAcces(deps));

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

  app.get('/v1/statut', ...interfaceSeule, async (c) => c.json(await statut(deps, c.env.DB, c.get('jeton'))));

  // Bouton « actualiser » : synchro Todoist forcée (au plus une toutes les 15 s), cache effacé, statut frais.
  app.post('/v1/actualiser', ...interfaceSeule, async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(await actualiser(c.env, deps, c.get('jeton')));
  });

  // Page « Connecteurs » (src/connecteurs.ts) : hôte web ou local seulement.
  app.get('/v1/connecteurs', ...interfaceSeule, async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(await etatConnecteurs(c.env, c.get('jeton').utilisateur));
  });

  app.post('/v1/connecteurs/google/connecter', ...interfaceSeule, async (c) => {
    c.header('Cache-Control', 'no-store');
    const redirection = adresseRetour(c.env, c.get('hote'), c.req.url);
    return c.json(await connecterGoogle(c.env, deps, c.get('jeton').utilisateur, redirection));
  });

  // Retour de Google (navigation du navigateur, identité Access) : toujours une redirection vers la page.
  app.get('/v1/connecteurs/google/retour', ...interfaceSeule, async (c) => {
    const cible = await retourGoogle(c.env, deps, c.get('jeton').utilisateur, new URL(c.req.url).searchParams);
    c.header('Cache-Control', 'no-store');
    // L'URL de retour porte le code d'autorisation : jamais transmise en Referer.
    c.header('Referrer-Policy', 'no-referrer');
    return c.redirect(cible, 303);
  });

  app.post('/v1/connecteurs/google/deconnecter', ...interfaceSeule, async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(await deconnecterGoogle(c.env, deps, c.get('jeton').utilisateur));
  });

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

  app.post('/v1/exceptions/prix', ...interfaceSeule, async (c) =>
    c.json(await apercuException(deps, c.env.DB, c.get('jeton'), await lireCorps(c))),
  );

  app.post('/v1/exceptions', ...interfaceSeule, async (c) =>
    c.json(await enregistrerException(deps, c.env.DB, c.get('jeton'), await lireCorps(c)), 201),
  );

  app.post('/v1/config', exigerJeton(deps, 'config'), async (c) =>
    c.json(await recevoirConfig(deps, c.env.DB, c.get('jeton'), await lireCorps(c)), 201),
  );

  app.get('/v1/config/version', exigerJeton(deps, ...TOUS), async (c) => c.json(await versionActive(c.env.DB, c.get('jeton'))));

  // Essai local seulement : hors FOCUS_ENVIRONNEMENT=local, la route n'existe pas.
  const localSeulement = async (_c: unknown, suite: () => Promise<void>) => {
    if (!deps.horloge?.estLocale()) throw new ErreurApi(404, 'introuvable', "Point d'entrée inconnu.");
    await suite();
  };
  app.post('/v1/dev/horloge', localSeulement, ...interfaceSeule, async (c) => {
    const horloge = deps.horloge!;
    const corps = await lireCorps(c);
    if (!('horloge' in corps)) throw new ErreurApi(400, 'requete_invalide', 'Champ « horloge » manquant.', { champ: 'horloge' });
    const regle = horloge.regler(corps.horloge);
    await invaliderTout(c.env.DB);
    return c.json({ environnement: 'local', ...regle });
  });

  // Pages publiques (hôte web sans JWT, voir src/acces.ts ; 404 sur l'hôte de l'API, qui ne sert que /v1/*).
  for (const chemin of CHEMINS_PUBLICS) {
    app.get(chemin, (c) => {
      c.header('Cache-Control', 'public, max-age=3600');
      c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Referrer-Policy', 'no-referrer');
      return c.html(pagePublique(chemin, c.env.CONTACT_EMAIL));
    });
  }

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
