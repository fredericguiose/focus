// Page « Connecteurs » de la web app : état de chaque connecteur (GET /v1/connecteurs) et connexion
// de Google Agenda par le flux OAuth web (client « Web application », PKCE S256).
//
// Doc de référence : https://developers.google.com/identity/protocols/oauth2/web-server
// (paramètres d'autorisation, échange du code, révocation sur https://oauth2.googleapis.com/revoke).
//
// Sécurité : le `state` (32 octets aléatoires) n'est gardé en base que sous forme d'empreinte
// SHA-256, avec le vérificateur PKCE, sous la ligne de l'utilisateur (lié à lui), 10 min au plus ;
// il est consommé (supprimé) au premier retour, quel qu'en soit le résultat (usage unique). Le
// refresh token reçu est chiffré (AES-GCM, CLE_CHIFFREMENT) ; aucune valeur de jeton n'est
// renvoyée au navigateur ni journalisée (seulement des codes d'erreur).
import {
  type ConnexionGoogle,
  clientGoogleWeb,
  contexteConnexion,
  contexteJeton,
  etatSynchroAgenda,
  instructionMarquerAgenda,
  lireConnexionGoogle,
  reglagesGooglePour,
} from './agenda';
import { chiffrer, dechiffrer } from './chiffrement';
import { CLES_CACHE, ecrireCache, lireCache } from './contexte';
import type { Dependances, Liaisons } from './env';
import { ErreurApi } from './erreurs';
import { URL_JETON_GOOGLE } from './google-agenda';
import { reglagesHevy, etatSynchroHevy } from './hevy';
import { type EtatSynchroTodoist, jetonTodoist } from './planifie';
import { etatSynchro, reglagesXiaomi } from './sommeil';
import { versInstant } from './temps';
import { versBase64 } from './xiaomi';

export const URL_AUTORISATION_GOOGLE = 'https://accounts.google.com/o/oauth2/v2/auth';
export const URL_REVOCATION_GOOGLE = 'https://oauth2.googleapis.com/revoke';
export const PORTEE_AGENDA = 'https://www.googleapis.com/auth/calendar.events';
export const CHEMIN_RETOUR_GOOGLE = '/v1/connecteurs/google/retour';
/** Page de la web app après le retour (l'écran vit dans l'ancre, voir web/src/App.tsx). */
export const ANCRE_CONNECTEURS = '#connecteurs';
const DUREE_AUTORISATION_MS = 10 * 60 * 1000;
const DELAI_MS = 15_000;

interface AutorisationEnCours {
  /** Empreinte SHA-256 (hex) du state ; le state lui-même n'est jamais gardé. */
  etat: string;
  verificateur: string;
  redirection: string;
  expire_le: string;
}

const base64url = (o: Uint8Array) => versBase64(o).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const aleatoire = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const sha256 = async (t: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
const hex = (o: Uint8Array) => Array.from(o, (b) => b.toString(16).padStart(2, '0')).join('');

function prerequis(env: Liaisons) {
  const client = clientGoogleWeb(env);
  const cle = env.CLE_CHIFFREMENT?.trim();
  if (!client || !cle) {
    throw new ErreurApi(503, 'google_non_configure', 'Google n’est pas configuré sur le serveur (client OAuth ou clé de chiffrement).');
  }
  return { client, cle };
}

/** URI de redirection : l'hôte web en production, l'origine de la requête en local. */
export function adresseRetour(env: Liaisons, hote: string, urlRequete: string): string {
  if (hote === 'local') return `${new URL(urlRequete).origin}${CHEMIN_RETOUR_GOOGLE}`;
  return `https://${(env.HOTE_WEB ?? '').trim().toLowerCase()}${CHEMIN_RETOUR_GOOGLE}`;
}

/** POST /v1/connecteurs/google/connecter : URL d'autorisation Google (state + PKCE gardés 10 min). */
export async function connecterGoogle(env: Liaisons, deps: Dependances, utilisateur: string, redirection: string) {
  const { client } = prerequis(env);
  const maintenant = deps.maintenant();
  const etat = aleatoire();
  const verificateur = aleatoire();
  const enCours: AutorisationEnCours = {
    etat: hex(await sha256(etat)),
    verificateur,
    redirection,
    expire_le: versInstant(maintenant.getTime() + DUREE_AUTORISATION_MS),
  };
  // Une seule autorisation en cours par utilisateur : une nouvelle remplace la précédente.
  await ecrireCache(env.DB, utilisateur, CLES_CACHE.oauthGoogle, enCours, maintenant);
  const url = new URL(URL_AUTORISATION_GOOGLE);
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirection,
    response_type: 'code',
    scope: PORTEE_AGENDA,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state: etat,
    code_challenge: base64url(await sha256(verificateur)),
    code_challenge_method: 'S256',
  }).toString();
  return { url: url.toString() };
}

class RefusRetour extends Error {
  constructor(readonly raison: string) {
    super(raison);
  }
}

/**
 * GET /v1/connecteurs/google/retour : chemin (relatif) où renvoyer le navigateur, avec
 * `?google=ok` ou `?google=erreur&raison=<code>`. Ne lève jamais d'erreur.
 */
export async function retourGoogle(env: Liaisons, deps: Dependances, utilisateur: string, requete: URLSearchParams): Promise<string> {
  try {
    await recevoirCode(env, deps, utilisateur, requete);
    return `/?google=ok${ANCRE_CONNECTEURS}`;
  } catch (e) {
    const raison = e instanceof RefusRetour ? e.raison : e instanceof ErreurApi ? e.code : 'erreur_interne';
    console.error(`Connexion Google (${utilisateur}) : ${raison}`);
    return `/?google=erreur&raison=${encodeURIComponent(raison)}${ANCRE_CONNECTEURS}`;
  }
}

async function recevoirCode(env: Liaisons, deps: Dependances, utilisateur: string, requete: URLSearchParams) {
  const maintenant = deps.maintenant();
  // Usage unique : l'autorisation en cours est supprimée et lue d'un même geste.
  const ligne = await env.DB.prepare(`DELETE FROM cache_todoist WHERE utilisateur = ? AND cle = ? RETURNING valeur`)
    .bind(utilisateur, CLES_CACHE.oauthGoogle)
    .first<{ valeur: string }>();
  const enCours = ligne ? (JSON.parse(ligne.valeur) as AutorisationEnCours) : null;
  const etat = requete.get('state') ?? '';
  if (!enCours || !etat || hex(await sha256(etat)) !== enCours.etat) throw new RefusRetour('etat_invalide');
  if (Date.parse(enCours.expire_le) <= maintenant.getTime()) throw new RefusRetour('etat_expire');
  const erreurGoogle = requete.get('error');
  if (erreurGoogle) throw new RefusRetour(erreurGoogle === 'access_denied' ? 'refuse' : 'google_erreur');
  const code = requete.get('code');
  if (!code) throw new RefusRetour('code_absent');
  const { client, cle } = prerequis(env);

  const f = deps.fetchGoogle ?? ((u, i) => fetch(u, i));
  let r: Response;
  try {
    r = await f(URL_JETON_GOOGLE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: enCours.redirection,
        code_verifier: enCours.verificateur,
      }).toString(),
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch {
    throw new RefusRetour('google_indisponible');
  }
  let corps: Record<string, unknown> = {};
  try {
    corps = (await r.json()) as Record<string, unknown>;
  } catch {
    // Traité selon le code HTTP.
  }
  if (!r.ok) throw new RefusRetour(r.status >= 500 ? 'google_indisponible' : 'echange_refuse');
  const refresh = typeof corps.refresh_token === 'string' ? corps.refresh_token : '';
  const portees = typeof corps.scope === 'string' ? corps.scope.split(' ') : [];
  if (!portees.includes(PORTEE_AGENDA)) {
    // Consentement partiel : l'accès à l'agenda a été décoché. Le jeton reçu ne sert à rien.
    if (refresh) await revoquer(f, refresh);
    throw new RefusRetour('portee_refusee');
  }
  if (!refresh) throw new RefusRetour('jeton_absent');

  const connexion: ConnexionGoogle = {
    client_id: client.clientId,
    connecte_le: versInstant(maintenant),
    jeton: await chiffrer(cle, refresh, contexteConnexion(utilisateur, client.clientId)),
  };
  const instant = versInstant(maintenant);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO cache_todoist (utilisateur, cle, valeur, maj_le) VALUES (?, ?, ?, ?)
       ON CONFLICT (utilisateur, cle) DO UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le`,
    ).bind(utilisateur, CLES_CACHE.connexionGoogle, JSON.stringify(connexion), instant),
    ...instructionsOublierAgenda(env.DB, utilisateur),
    instructionMarquerAgenda(env.DB, utilisateur, instant),
  ]);
}

/**
 * Jeton tournant d'avant (autre client ou autre compte) et ce qui est écrit dans l'agenda : à
 * oublier, pour que le prochain passage réécrive les nuits avec la nouvelle connexion.
 */
function instructionsOublierAgenda(db: D1Database, utilisateur: string): D1PreparedStatement[] {
  return [
    db
      .prepare(`DELETE FROM cache_todoist WHERE utilisateur = ? AND cle IN (?, ?)`)
      .bind(utilisateur, CLES_CACHE.jetonGoogle, CLES_CACHE.synchroAgenda),
  ];
}

async function revoquer(f: (url: string, init: RequestInit) => Promise<Response>, jeton: string): Promise<boolean> {
  try {
    const r = await f(URL_REVOCATION_GOOGLE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: jeton }).toString(),
      signal: AbortSignal.timeout(DELAI_MS),
    });
    await r.body?.cancel().catch(() => undefined);
    // 400 invalid_token : déjà révoqué ou expiré, l'effet voulu est atteint.
    return r.ok || r.status === 400;
  } catch {
    return false;
  }
}

/** POST /v1/connecteurs/google/deconnecter : révocation chez Google, jeton effacé de la base. */
export async function deconnecterGoogle(env: Liaisons, deps: Dependances, utilisateur: string) {
  const connexion = await lireConnexionGoogle(env.DB, utilisateur);
  if (!connexion) throw new ErreurApi(409, 'google_non_connecte', 'Google n’est pas connecté depuis cette page.');
  const cle = env.CLE_CHIFFREMENT?.trim();
  const jetons: string[] = [];
  if (cle) {
    const garde = (await lireCache<ConnexionGoogle['jeton']>(env.DB, utilisateur, CLES_CACHE.jetonGoogle))?.valeur;
    const tournant = garde ? await dechiffrer(cle, garde, contexteJeton(utilisateur, connexion.client_id)) : null;
    const initial = await dechiffrer(cle, connexion.jeton, contexteConnexion(utilisateur, connexion.client_id));
    for (const j of [tournant, initial]) if (j && !jetons.includes(j)) jetons.push(j);
  }
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM cache_todoist WHERE utilisateur = ? AND cle IN (?, ?)`).bind(utilisateur, CLES_CACHE.connexionGoogle, CLES_CACHE.oauthGoogle),
    ...instructionsOublierAgenda(env.DB, utilisateur),
  ]);
  const f = deps.fetchGoogle ?? ((u, i) => fetch(u, i));
  let revoque = false;
  for (const j of jetons) if (!revoque) revoque = await revoquer(f, j);
  if (!revoque) console.warn(`Déconnexion Google (${utilisateur}) : révocation non confirmée par Google.`);
  return { revoque };
}

// ── État des connecteurs ──────────────────────────────────────────────────────

export interface EtatConnecteur {
  id: 'google_agenda' | 'todoist' | 'xiaomi' | 'hevy';
  /** « page » : connecté depuis la web app ; « serveur » : par secret Worker ; null : non configuré. */
  origine: 'page' | 'serveur' | null;
  /** Peut être connecté (ou déconnecté) depuis la page. */
  connectable: boolean;
  connecte_le: string | null;
  derniere_synchro: string | null;
  erreur: string | null;
}

/** GET /v1/connecteurs : état de chaque connecteur de l'utilisateur, sans aucune valeur secrète. */
export async function etatConnecteurs(env: Liaisons, utilisateur: string): Promise<{ connecteurs: EtatConnecteur[] }> {
  const [connexion, agenda, todoist, xiaomi, hevy] = await Promise.all([
    lireConnexionGoogle(env.DB, utilisateur),
    etatSynchroAgenda(env.DB, utilisateur),
    lireCache<EtatSynchroTodoist>(env.DB, utilisateur, CLES_CACHE.synchroTodoist),
    etatSynchro(env.DB, utilisateur),
    etatSynchroHevy(env.DB, utilisateur),
  ]);
  const google = await reglagesGooglePour(env, utilisateur, connexion);
  // Connexion gardée mais illisible (clé ou client changés) : à refaire depuis la page.
  const illisible = connexion !== null && google?.origine !== 'page';
  const serveur = (actif: boolean, etat: { derniere_synchro: string | null; erreur: string | null } | null) => ({
    origine: actif ? ('serveur' as const) : null,
    connectable: false,
    connecte_le: null,
    derniere_synchro: actif ? (etat?.derniere_synchro ?? null) : null,
    erreur: actif ? (etat?.erreur ?? null) : null,
  });
  const td = todoist?.valeur;
  return {
    connecteurs: [
      {
        id: 'google_agenda',
        origine: google?.origine ?? null,
        connectable: clientGoogleWeb(env) !== null && !!env.CLE_CHIFFREMENT?.trim(),
        connecte_le: google?.origine === 'page' ? connexion!.connecte_le : null,
        derniere_synchro: google ? (agenda?.derniere_synchro ?? null) : null,
        erreur: illisible ? 'connexion_illisible' : google ? (agenda?.erreur ?? null) : null,
      },
      { id: 'todoist', ...serveur(jetonTodoist(env, utilisateur) !== null, td ? { derniere_synchro: td.reussie_le ?? null, erreur: td.erreur ?? null } : null) },
      { id: 'xiaomi', ...serveur(reglagesXiaomi(env)?.utilisateur === utilisateur, xiaomi) },
      { id: 'hevy', ...serveur(reglagesHevy(env)?.utilisateur === utilisateur, hevy) },
    ],
  };
}
