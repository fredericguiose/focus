// Cloudflare Access vérifié par le Worker (src/acces.ts) : hôte web (JWT exigé partout), hôte de
// l'API (sans Access, sans routes ni jeton d'interface), hôte inconnu refusé, local inchangé.
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moteur } from '../../core/src/index';
import { creerApp } from '../src/app';
import type { Liaisons } from '../src/env';
import { Horloge, MARDI, creerJeton, installerConfig, todoistInterdit } from './aides';

const EQUIPE = 'https://equipe-test.cloudflareaccess.com';
const AUD = 'aud-de-test-0123456789abcdef';
const WEB = 'focus.example.com';
const API = 'api-focus.example.com';
const ALGO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

async function paire() {
  return (await crypto.subtle.generateKey(
    { ...ALGO, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
}

const b64url = (octets: Uint8Array) => btoa(String.fromCharCode(...octets)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const texte64 = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function signer(cle: CryptoKey, charge: Record<string, unknown>, entete: Record<string, unknown> = {}) {
  const debut = `${texte64({ alg: 'RS256', kid: 'cle-1', typ: 'JWT', ...entete })}.${texte64(charge)}`;
  const sig = new Uint8Array(await crypto.subtle.sign(ALGO, cle, new TextEncoder().encode(debut)));
  return `${debut}.${b64url(sig)}`;
}

describe('Cloudflare Access', () => {
  const horloge = Horloge.a(MARDI.matin);
  const t = () => Math.floor(horloge.t / 1000);
  let cles: { kid: string; paire: CryptoKeyPair }[];
  let appelsCerts: string[];
  let certsEnPanne = false;
  let app: ReturnType<typeof creerApp>;
  let jetons: { web: string; pc: string; config: string };
  let erreurs: ReturnType<typeof vi.spyOn>;

  const certs = async (url: string) => {
    appelsCerts.push(url);
    if (certsEnPanne) return new Response('panne', { status: 500 });
    const keys = await Promise.all(
      cles.map(async ({ kid, paire }) => ({ ...(await crypto.subtle.exportKey('jwk', paire.publicKey)), kid, alg: 'RS256', use: 'sig' })),
    );
    return Response.json({ keys, public_cert: {}, public_certs: [] });
  };

  const production: Partial<Liaisons> = {
    FOCUS_ENVIRONNEMENT: undefined,
    HOTE_WEB: WEB,
    HOTE_API: API,
    ACCES_EQUIPE: EQUIPE,
    ACCES_AUD: AUD,
    ACCES_EMAILS: 'bob@example.com, Alice@Example.com',
    ASSETS: { fetch: async () => new Response('<!doctype html><title>Focus</title>', { headers: { 'Content-Type': 'text/html' } }) } as unknown as Fetcher,
  };

  async function requete(
    hote: string,
    chemin: string,
    o: { jwt?: string; cookie?: string; jeton?: string; methode?: string; corps?: unknown; variables?: Partial<Liaisons> } = {},
  ) {
    const headers: Record<string, string> = {};
    if (o.jwt) headers['Cf-Access-Jwt-Assertion'] = o.jwt;
    if (o.cookie) headers.Cookie = `autre=1; CF_Authorization=${o.cookie}`;
    if (o.jeton) headers.Authorization = `Bearer ${o.jeton}`;
    if (o.corps !== undefined) headers['Content-Type'] = 'application/json';
    const r = await app.request(
      `https://${hote}${chemin}`,
      { method: o.methode ?? 'GET', headers, ...(o.corps !== undefined ? { body: JSON.stringify(o.corps) } : {}) },
      { ...env, ...production, ...o.variables },
    );
    const brut = await r.text();
    let corps: unknown = brut;
    try {
      corps = JSON.parse(brut);
    } catch {
      /* page HTML */
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { statut: r.status, corps: corps as any };
  }

  const charge = (surcharges: Record<string, unknown> = {}) => ({
    aud: [AUD],
    email: 'alice@example.com',
    exp: t() + 3600,
    iat: t() - 10,
    nbf: t() - 10,
    iss: EQUIPE,
    type: 'app',
    sub: 'id-alice',
    ...surcharges,
  });
  const jwtValide = (surcharges: Record<string, unknown> = {}) => signer(cles[0]!.paire.privateKey, charge(surcharges));

  beforeEach(async () => {
    horloge.regler(MARDI.matin);
    cles = [{ kid: 'cle-1', paire: await paire() }];
    appelsCerts = [];
    certsEnPanne = false;
    app = creerApp({ moteur, maintenant: horloge.maintenant, todoist: todoistInterdit, recupererCertsAcces: certs });
    await installerConfig();
    jetons = {
      web: await creerJeton('interface', 'web'),
      pc: await creerJeton('appareil', 'pc_linux'),
      config: await creerJeton('config', 'actions'),
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    erreurs = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  describe('hôte web', () => {
    it('JWT valide (en-tête) : la page et l’API passent ; certificats lus une fois', async () => {
      const jwt = await jwtValide();
      const page = await requete(WEB, '/', { jwt });
      expect(page.statut).toBe(200);
      expect(page.corps).toContain('<title>Focus</title>');
      expect((await requete(WEB, '/v1/statut', { jwt, jeton: jetons.web })).statut).toBe(200);
      expect((await requete(WEB, '/assets/index.js', { jwt })).statut).toBe(200);
      expect(appelsCerts).toEqual([`${EQUIPE}/cdn-cgi/access/certs`]);
    });

    it('cookie CF_Authorization en repli ; aud en chaîne accepté', async () => {
      const r = await requete(WEB, '/v1/statut', { cookie: await jwtValide({ aud: AUD }), jeton: jetons.web });
      expect(r.statut).toBe(200);
    });

    it('le jeton d’interface reste exigé en plus du JWT', async () => {
      const r = await requete(WEB, '/v1/statut', { jwt: await jwtValide() });
      expect(r.statut).toBe(401);
      expect(r.corps.erreur).toBe('jeton_absent');
    });

    it('fichier statique sans JWT : 403, rien n’est servi', async () => {
      for (const chemin of ['/', '/index.html', '/manifest.webmanifest', '/assets/index.js']) {
        const r = await requete(WEB, chemin);
        expect(r.statut).toBe(403);
        expect(r.corps.erreur).toBe('acces_refuse');
      }
    });

    it('API sans JWT : 403 même avec un jeton d’interface valide', async () => {
      const r = await requete(WEB, '/v1/statut', { jeton: jetons.web });
      expect(r.statut).toBe(403);
      expect(r.corps.erreur).toBe('acces_refuse');
    });

    it.each([
      ['signature fausse', async () => signer((await paire()).privateKey, charge())],
      ['signature tronquée', async () => (await jwtValide()).slice(0, -6)],
      ['aud faux', async () => jwtValide({ aud: ['autre-application'] })],
      ['iss faux', async () => jwtValide({ iss: 'https://autre-equipe.cloudflareaccess.com' })],
      ['expiré', async () => jwtValide({ exp: t() - 3600 })],
      ['sans exp', async () => jwtValide({ exp: undefined })],
      ['pas encore valable (nbf)', async () => jwtValide({ nbf: t() + 3600 })],
      ['e-mail non autorisé', async () => jwtValide({ email: 'mallory@example.com' })],
      ['sans e-mail (jeton de service)', async () => jwtValide({ email: undefined, common_name: 'x.access' })],
      ['algorithme none', async () => `${texte64({ alg: 'none', kid: 'cle-1' })}.${texte64(charge())}.`],
      ['algorithme HS256', async () => signer(cles[0]!.paire.privateKey, charge(), { alg: 'HS256' })],
      ['kid inconnu', async () => signer(cles[0]!.paire.privateKey, charge(), { kid: 'cle-inconnue' })],
      ['illisible', async () => 'pas.un.jwt'],
    ])('403 : %s', async (_cas, fabriquer) => {
      const jwt = await fabriquer();
      const r = await requete(WEB, '/v1/statut', { jwt, jeton: jetons.web });
      expect(r.statut).toBe(403);
      expect(r.corps.erreur).toBe('acces_refuse');
      expect((await requete(WEB, '/', { jwt })).statut).toBe(403);
    });

    it('rotation des clés : kid inconnu, certificats relus (au plus une fois par minute)', async () => {
      expect((await requete(WEB, '/', { jwt: await jwtValide() })).statut).toBe(200);
      const nouvelle = { kid: 'cle-2', paire: await paire() };
      cles = [cles[0]!, nouvelle];
      const jwt2 = await signer(nouvelle.paire.privateKey, charge(), { kid: 'cle-2' });
      // Moins d'une minute après le chargement : pas de relecture, refus.
      expect((await requete(WEB, '/', { jwt: jwt2 })).statut).toBe(403);
      expect(appelsCerts).toHaveLength(1);
      horloge.avancer(61);
      const jwt2b = await signer(nouvelle.paire.privateKey, charge(), { kid: 'cle-2' });
      expect((await requete(WEB, '/', { jwt: jwt2b })).statut).toBe(200);
      expect(appelsCerts).toHaveLength(2);
      // Clé connue : pas de nouvelle lecture.
      expect((await requete(WEB, '/', { jwt: jwt2b })).statut).toBe(200);
      expect(appelsCerts).toHaveLength(2);
    });

    it('certificats injoignables : 503, rien n’est servi', async () => {
      certsEnPanne = true;
      const r = await requete(WEB, '/', { jwt: await jwtValide() });
      expect(r.statut).toBe(503);
      expect(r.corps.erreur).toBe('acces_indisponible');
    });

    it.each(['ACCES_EQUIPE', 'ACCES_AUD', 'ACCES_EMAILS'] as const)(
      'production sans %s : hôte web fermé (fail closed), message dans les journaux ; hôte API ouvert',
      async (variable) => {
        const variables = { [variable]: undefined };
        const r = await requete(WEB, '/', { jwt: await jwtValide(), variables });
        expect(r.statut).toBe(403);
        expect(r.corps.erreur).toBe('acces_non_configure');
        expect(erreurs).toHaveBeenCalledWith(expect.stringContaining(variable));
        expect((await requete(API, '/v1/planning', { jeton: jetons.pc, variables })).statut).toBe(200);
      },
    );

    it('valeurs de wrangler.jsonc non remplies ou ACCES_EQUIPE hors cloudflareaccess.com : fermé', async () => {
      for (const variables of [{ ACCES_EQUIPE: 'https://exemple.com' }, { ACCES_EQUIPE: 'A-REMPLIR' }, { ACCES_AUD: 'A-REMPLIR' }]) {
        const r = await requete(WEB, '/', { jwt: await jwtValide(), variables });
        expect(r.corps.erreur).toBe('acces_non_configure');
      }
      expect(appelsCerts).toHaveLength(0);
    });
  });

  describe('hôte API (sans Access)', () => {
    it('routes des appareils et de la config sans JWT : passent', async () => {
      expect((await requete(API, '/v1/planning', { jeton: jetons.pc })).statut).toBe(200);
      expect((await requete(API, '/v1/taches', { jeton: jetons.pc })).statut).toBe(200);
      expect((await requete(API, '/v1/blocage?domaine=x.com', { jeton: jetons.pc })).statut).toBe(200);
      expect((await requete(API, '/v1/config/version', { jeton: jetons.config })).statut).toBe(200);
      const r = await requete(API, '/v1/evenements', { jeton: jetons.pc, methode: 'POST', corps: { evenements: [] } });
      expect(r.statut).not.toBe(403);
      expect(r.statut).not.toBe(404);
      expect(appelsCerts).toHaveLength(0);
    });

    it.each([
      ['GET', '/v1/statut'],
      ['POST', '/v1/exceptions/prix'],
      ['POST', '/v1/exceptions'],
      ['POST', '/v1/dev/horloge'],
    ])('route réservée à l’interface : 404 (%s %s), même avec JWT et jeton d’interface', async (methode, chemin) => {
      for (const jeton of [jetons.web, jetons.pc]) {
        const r = await requete(API, chemin, { jeton, methode, corps: methode === 'POST' ? {} : undefined, jwt: await jwtValide() });
        expect(r.statut).toBe(404);
        expect(r.corps.erreur).toBe('introuvable');
      }
    });

    it('jeton d’interface refusé sur les routes partagées : 403', async () => {
      for (const chemin of ['/v1/taches', '/v1/blocage?appareil=pc_linux&domaine=x.com', '/v1/config/version']) {
        const r = await requete(API, chemin, { jeton: jetons.web });
        expect(r.statut).toBe(403);
        expect(r.corps.erreur).toBe('jeton_non_autorise');
      }
      const s = await requete(API, '/v1/sessions', { jeton: jetons.web, methode: 'POST', corps: {} });
      expect(s.statut).toBe(403);
    });

    it('pas de web app : 404 hors /v1/', async () => {
      for (const chemin of ['/', '/index.html', '/assets/index.js']) {
        const r = await requete(API, chemin, { jwt: await jwtValide() });
        expect(r.statut).toBe(404);
      }
    });
  });

  describe('hôte inconnu', () => {
    it('workers.dev ou autre : 403, même avec JWT et jeton', async () => {
      for (const hote of ['focus-api.compte.workers.dev', 'exemple.com', '127.0.0.1']) {
        expect((await requete(hote, '/', { jwt: await jwtValide() })).corps.erreur).toBe('hote_inconnu');
        const r = await requete(hote, '/v1/planning', { jeton: jetons.pc });
        expect(r.statut).toBe(403);
        expect(r.corps.erreur).toBe('hote_inconnu');
      }
    });

    it('production sans HOTE_WEB ni HOTE_API : tout est refusé', async () => {
      const variables = { HOTE_WEB: undefined, HOTE_API: undefined };
      expect((await requete(API, '/v1/planning', { jeton: jetons.pc, variables })).statut).toBe(403);
      expect((await requete(WEB, '/', { jwt: await jwtValide(), variables })).statut).toBe(403);
      expect(erreurs).toHaveBeenCalledWith(expect.stringContaining('HOTE_WEB'));
    });
  });

  describe('local (FOCUS_ENVIRONNEMENT=local)', () => {
    it('un seul hôte sert tout, sans Access, même si les variables de production sont posées', async () => {
      const variables = { FOCUS_ENVIRONNEMENT: 'local' };
      expect((await requete('127.0.0.1:8799', '/', { variables })).statut).toBe(200);
      expect((await requete('127.0.0.1:8799', '/v1/statut', { jeton: jetons.web, variables })).statut).toBe(200);
      expect((await requete('127.0.0.1:8799', '/v1/planning', { jeton: jetons.pc, variables })).statut).toBe(200);
      expect((await requete(WEB, '/v1/statut', { jeton: jetons.web, variables })).statut).toBe(200);
      expect(appelsCerts).toHaveLength(0);
    });
  });
});
