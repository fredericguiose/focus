// Page « Connecteurs » : état (GET /v1/connecteurs) et flux OAuth web de Google (connecter, retour,
// déconnecter) avec Google simulé : PKCE, state à usage unique, lié à l'utilisateur, expiré,
// refus, consentement partiel, jeton jamais renvoyé ni gardé en clair, synchro par la page,
// routes absentes de l'hôte de l'API.
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reglagesGooglePour } from '../src/agenda';
import { creerApp } from '../src/app';
import { PORTEE_AGENDA, URL_AUTORISATION_GOOGLE, URL_REVOCATION_GOOGLE } from '../src/connecteurs';
import type { Dependances, Liaisons } from '../src/env';
import { type ClientAgenda, type IdentifiantsGoogle, URL_JETON_GOOGLE } from '../src/google-agenda';
import { executerTachesPlanifiees } from '../src/planifie';
import { Horloge, MARDI, client, installerConfig } from './aides';

const REFRESH = 'refresh-de-la-page-42';
const WEB = {
  FOCUS_UTILISATEUR_LOCAL: 'alice',
  GOOGLE_WEB_CLIENT_ID: 'client-web',
  GOOGLE_WEB_CLIENT_SECRET: 'secret-web',
  CLE_CHIFFREMENT: 'cle-de-test-0123456789',
};

const json = (statut: number, corps: unknown) => new Response(JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json' } });

describe('connecteurs', () => {
  const horloge = Horloge.a(MARDI.matin);
  let appels: { url: string; corps: URLSearchParams }[];
  let reponseJeton: () => Response;
  const fetchGoogle = async (url: string, init: RequestInit) => {
    appels.push({ url, corps: new URLSearchParams(String(init.body)) });
    return url === URL_JETON_GOOGLE ? reponseJeton() : new Response('', { status: 200 });
  };
  const deps: Dependances = { ...client(horloge).deps, fetchGoogle };
  const app = creerApp(deps);
  const requete = (methode: string, chemin: string, variables: Partial<Liaisons> = WEB, base = 'http://127.0.0.1:8799') =>
    app.request(`${base}${chemin}`, { method: methode }, { ...env, ...variables });

  async function connecter(variables: Partial<Liaisons> = WEB) {
    const r = await requete('POST', '/v1/connecteurs/google/connecter', variables);
    expect(r.status).toBe(200);
    return new URL(((await r.json()) as { url: string }).url);
  }
  const retour = async (q: string, variables: Partial<Liaisons> = WEB) => {
    const r = await requete('GET', `/v1/connecteurs/google/retour?${q}`, variables);
    expect(r.status).toBe(303);
    return r.headers.get('Location');
  };
  const ligne = (utilisateur: string, cle: string) =>
    env.DB.prepare(`SELECT valeur FROM cache_todoist WHERE utilisateur = ? AND cle = ?`).bind(utilisateur, cle).first<{ valeur: string }>();

  beforeEach(async () => {
    horloge.regler(MARDI.matin);
    appels = [];
    reponseJeton = () => json(200, { access_token: 'acces', refresh_token: REFRESH, scope: PORTEE_AGENDA, expires_in: 3599 });
    await installerConfig();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('connecter : URL Google (offline, consent, PKCE S256, redirection locale) ; state gardé sous forme d’empreinte', async () => {
    const url = await connecter();
    expect(`${url.origin}${url.pathname}`).toBe(URL_AUTORISATION_GOOGLE);
    const p = url.searchParams;
    expect(p.get('client_id')).toBe('client-web');
    expect(p.get('redirect_uri')).toBe('http://127.0.0.1:8799/v1/connecteurs/google/retour');
    expect(p.get('scope')).toBe(PORTEE_AGENDA);
    expect([p.get('access_type'), p.get('prompt'), p.get('response_type'), p.get('code_challenge_method')]).toEqual(['offline', 'consent', 'code', 'S256']);
    expect(p.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const garde = (await ligne('alice', 'oauth_google'))!.valeur;
    expect(garde).not.toContain(p.get('state')!);
  });

  it('connecter sans client OAuth ni clé : 503', async () => {
    const r = await requete('POST', '/v1/connecteurs/google/connecter', { FOCUS_UTILISATEUR_LOCAL: 'alice' });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { erreur: string }).erreur).toBe('google_non_configure');
  });

  it('retour : échange avec le vérificateur PKCE, jeton chiffré, agenda à refaire, synchro par la page ; state à usage unique', async () => {
    const url = await connecter();
    const state = url.searchParams.get('state')!;
    await env.DB.prepare(`INSERT INTO cache_todoist (utilisateur, cle, valeur, maj_le) VALUES ('alice', 'jeton_google', '"ancien"', 'x')`).run();
    expect(await retour(`code=code-1&state=${state}`)).toBe('/?google=ok#connecteurs');

    const echange = appels[0]!;
    expect(echange.url).toBe(URL_JETON_GOOGLE);
    expect(echange.corps.get('grant_type')).toBe('authorization_code');
    expect(echange.corps.get('redirect_uri')).toBe('http://127.0.0.1:8799/v1/connecteurs/google/retour');
    const defi = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(echange.corps.get('code_verifier')!)));
    const defiB64 = btoa(String.fromCharCode(...defi)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(defiB64).toBe(url.searchParams.get('code_challenge'));

    expect((await ligne('alice', 'connexion_google'))!.valeur).not.toContain(REFRESH);
    expect(await ligne('alice', 'jeton_google')).toBeNull();
    expect(await ligne('alice', 'agenda_a_refaire')).not.toBeNull();
    expect(await ligne('alice', 'oauth_google')).toBeNull();
    const reglages = await reglagesGooglePour({ ...env, ...WEB }, 'alice');
    expect(reglages?.origine).toBe('page');
    expect(reglages?.identifiants).toEqual({ clientId: 'client-web', clientSecret: 'secret-web', refreshToken: REFRESH });

    // Rejoué : refusé, sans nouvel échange.
    expect(await retour(`code=code-1&state=${state}`)).toBe('/?google=erreur&raison=etat_invalide#connecteurs');
    expect(appels).toHaveLength(1);

    // La tâche planifiée synchronise alice avec la connexion de la page (sans GOOGLE_UTILISATEUR).
    const utilises: IdentifiantsGoogle[] = [];
    const fabrique = (ids: IdentifiantsGoogle): ClientAgenda => {
      utilises.push(ids);
      return { async ecrireNuit() {}, async supprimerNuit() {} };
    };
    await executerTachesPlanifiees({ ...env, ...WEB }, { ...client(horloge).deps, agenda: fabrique });
    expect(utilises.map((i) => i.refreshToken)).toEqual([REFRESH]);

    // État : connecté par la page, aucune valeur de jeton dans la réponse.
    const r = await requete('GET', '/v1/connecteurs');
    const texte = await r.text();
    expect(texte).not.toContain(REFRESH);
    const { connecteurs } = JSON.parse(texte) as { connecteurs: { id: string; origine: string | null; connectable: boolean; derniere_synchro: string | null }[] };
    expect(connecteurs.map((c) => c.id)).toEqual(['google_agenda', 'todoist', 'xiaomi', 'hevy']);
    expect(connecteurs[0]).toMatchObject({ origine: 'page', connectable: true, derniere_synchro: MARDI.matin.replace('.000', '') });
    expect(connecteurs[1]).toMatchObject({ origine: null, connectable: false });
  });

  it('state d’un autre utilisateur, expiré, refus, consentement partiel, échange refusé', async () => {
    let state = (await connecter()).searchParams.get('state')!;
    expect(await retour(`code=c&state=${state}`, { ...WEB, FOCUS_UTILISATEUR_LOCAL: 'bob' })).toContain('raison=etat_invalide');

    state = (await connecter()).searchParams.get('state')!;
    horloge.regler(new Date(Date.parse(MARDI.matin) + 11 * 60_000).toISOString());
    expect(await retour(`code=c&state=${state}`)).toContain('raison=etat_expire');
    horloge.regler(MARDI.matin);

    state = (await connecter()).searchParams.get('state')!;
    expect(await retour(`error=access_denied&state=${state}`)).toContain('raison=refuse');

    state = (await connecter()).searchParams.get('state')!;
    reponseJeton = () => json(200, { access_token: 'a', refresh_token: REFRESH, scope: 'openid' });
    expect(await retour(`code=c&state=${state}`)).toContain('raison=portee_refusee');
    expect(appels.at(-1)).toMatchObject({ url: URL_REVOCATION_GOOGLE });
    expect(appels.at(-1)!.corps.get('token')).toBe(REFRESH);

    state = (await connecter()).searchParams.get('state')!;
    reponseJeton = () => json(400, { error: 'invalid_grant' });
    expect(await retour(`code=c&state=${state}`)).toContain('raison=echange_refuse');

    expect(await ligne('alice', 'connexion_google')).toBeNull();
    expect(appels.filter((a) => a.url === URL_JETON_GOOGLE)).toHaveLength(2);
  });

  it('déconnecter : révoque chez Google et efface ; sans connexion : 409 ; secrets seuls : origine « serveur »', async () => {
    const state = (await connecter()).searchParams.get('state')!;
    await retour(`code=c&state=${state}`);
    const r = await requete('POST', '/v1/connecteurs/google/deconnecter');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ revoque: true });
    expect(appels.at(-1)!.url).toBe(URL_REVOCATION_GOOGLE);
    expect(appels.at(-1)!.corps.get('token')).toBe(REFRESH);
    expect(await ligne('alice', 'connexion_google')).toBeNull();
    expect((await requete('POST', '/v1/connecteurs/google/deconnecter')).status).toBe(409);

    const secrets = { ...WEB, GOOGLE_CLIENT_ID: 'i', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REFRESH_TOKEN: 'r', GOOGLE_UTILISATEUR: 'alice', TODOIST_TOKEN: 't', TODOIST_UTILISATEUR: 'alice' };
    const etat = (await (await requete('GET', '/v1/connecteurs', secrets)).json()) as { connecteurs: { origine: string | null }[] };
    expect(etat.connecteurs.map((c) => c.origine)).toEqual(['serveur', 'serveur', null, null]);
  });

  it('hôte de l’API : les quatre routes n’existent pas (404)', async () => {
    const prod = { FOCUS_ENVIRONNEMENT: 'production', HOTE_WEB: 'focus.example.com', HOTE_API: 'api-focus.example.com' };
    for (const [m, chemin] of [
      ['GET', '/v1/connecteurs'],
      ['POST', '/v1/connecteurs/google/connecter'],
      ['GET', '/v1/connecteurs/google/retour?code=c&state=s'],
      ['POST', '/v1/connecteurs/google/deconnecter'],
    ] as const) {
      expect((await requete(m, chemin, prod, 'https://api-focus.example.com')).status).toBe(404);
    }
  });
});
