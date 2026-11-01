// Cloudflare Access, vérifié aussi par le Worker (défense en profondeur, docs/mise-en-ligne.md).
// Deux hôtes en production :
//   - HOTE_WEB (web app + API) : toute requête, fichiers statiques compris, porte un JWT Access
//     valide (signature RS256, aud, iss, exp/nbf, e-mail autorisé). L'e-mail vérifié donne
//     l'utilisateur Focus (ACCES_UTILISATEURS) : sur /v1/*, sans en-tête Authorization, la requête
//     vaut jeton « interface » de cet utilisateur (src/auth.ts). Un Bearer envoyé quand même doit
//     appartenir au même utilisateur.
//   - HOTE_API (clients : PC, extension, iPhone, GitHub Actions) : pas d'Access ; seulement /v1/*,
//     sans les routes réservées au jeton d'interface ni le jeton d'interface lui-même.
// Tout autre hôte (dont l'adresse workers.dev) est refusé. En local (FOCUS_ENVIRONNEMENT=local),
// rien de tout cela : un seul hôte sert tout ; sans Authorization, /v1/* vaut interface de
// FOCUS_UTILISATEUR_LOCAL si cette variable est posée (scripts/local.mjs), sinon le jeton est exigé.
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Dependances, EnvApp, Liaisons } from './env';
import { ErreurApi } from './erreurs';

export type Hote = 'local' | 'web' | 'api';

/** Clés publiques gardées au plus 1 h ; un `kid` inconnu force un rechargement, au plus 1 par minute. */
const DUREE_CLES_MS = 60 * 60 * 1000;
const RECHARGEMENT_MIN_MS = 60 * 1000;
/** Tolérance d'horloge sur exp et nbf. */
const TOLERANCE_S = 60;

const FORMAT_UTILISATEUR = /^[A-Za-z0-9_.-]{1,100}$/;

export interface ReglagesAcces {
  equipe: string;
  aud: string;
  /** E-mails acceptés par le vérificateur : ACCES_EMAILS s'il est posé, sinon ceux d'ACCES_UTILISATEURS. */
  emails: Set<string>;
  /** E-mail (minuscules) → utilisateur Focus. */
  utilisateurs: Map<string, string>;
}

/** « a@x.fr=alice, b@y.fr=bob » ; une entrée mal formée invalide tout (fail closed). */
function lireUtilisateurs(brut: string | undefined): Map<string, string> | null {
  const table = new Map<string, string>();
  for (const entree of (brut ?? '').split(/[\s,;]+/).filter(Boolean)) {
    const i = entree.lastIndexOf('=');
    const email = entree.slice(0, i).trim().toLowerCase();
    const utilisateur = entree.slice(i + 1).trim();
    if (i <= 0 || !email.includes('@') || !FORMAT_UTILISATEUR.test(utilisateur)) return null;
    table.set(email, utilisateur);
  }
  return table.size > 0 ? table : null;
}

/** Réglages complets, ou la liste des variables manquantes. */
export function lireReglagesAcces(env: Liaisons): ReglagesAcces | { manquantes: string[] } {
  const equipe = (env.ACCES_EQUIPE ?? '').trim().replace(/\/+$/, '');
  const aud = (env.ACCES_AUD ?? '').trim();
  const utilisateurs = lireUtilisateurs(env.ACCES_UTILISATEURS);
  // ACCES_EMAILS, facultatif, restreint encore la liste (compatibilité avec la première mise en ligne).
  const listeEmails = (env.ACCES_EMAILS ?? '')
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const manquantes: string[] = [];
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(equipe)) manquantes.push('ACCES_EQUIPE');
  if (!aud || aud === 'A-REMPLIR') manquantes.push('ACCES_AUD');
  if (!utilisateurs) manquantes.push('ACCES_UTILISATEURS');
  if (manquantes.length > 0 || !utilisateurs) return { manquantes };
  const emails = new Set(listeEmails.length > 0 ? listeEmails : utilisateurs.keys());
  return { equipe: equipe.toLowerCase(), aud, emails, utilisateurs };
}

/** Utilisateur local de la web app (FOCUS_UTILISATEUR_LOCAL), s'il est posé et bien formé. */
function utilisateurLocal(env: Liaisons): string | undefined {
  const u = (env.FOCUS_UTILISATEUR_LOCAL ?? '').trim();
  return FORMAT_UTILISATEUR.test(u) ? u : undefined;
}

function base64urlVersOctets(texte: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(texte)) throw new Error('base64url invalide');
  const b64 = texte.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (texte.length % 4)) % 4);
  const binaire = atob(b64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return octets;
}

function lireJson(partie: string): Record<string, unknown> {
  const valeur: unknown = JSON.parse(new TextDecoder().decode(base64urlVersOctets(partie)));
  if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) throw new Error('objet attendu');
  return valeur as Record<string, unknown>;
}

const ALGO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

interface JeuDeCles {
  cles: Map<string, CryptoKey>;
  chargeLe: number;
}

/**
 * Vérificateur des JWT Access avec cache des clés publiques (une instance par app, donc par isolat).
 * `recuperer` et `maintenant` sont injectés : les tests simulent les certificats et l'horloge.
 */
export function creerVerificateurAcces(recuperer: (url: string) => Promise<Response>, maintenant: () => Date) {
  const jeux = new Map<string, JeuDeCles>();
  const enCours = new Map<string, Promise<JeuDeCles>>();

  async function charger(equipe: string): Promise<JeuDeCles> {
    const reponse = await recuperer(`${equipe}/cdn-cgi/access/certs`);
    if (!reponse.ok) throw new Error(`certificats Access : HTTP ${reponse.status}`);
    const corps = (await reponse.json()) as { keys?: unknown };
    if (!Array.isArray(corps.keys)) throw new Error('certificats Access : champ « keys » absent');
    const cles = new Map<string, CryptoKey>();
    for (const k of corps.keys as Record<string, unknown>[]) {
      if (k?.kty !== 'RSA' || typeof k.kid !== 'string' || typeof k.n !== 'string' || typeof k.e !== 'string') continue;
      if (k.alg !== undefined && k.alg !== 'RS256') continue;
      const jwk: JsonWebKey = { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true };
      cles.set(k.kid, await crypto.subtle.importKey('jwk', jwk, ALGO, false, ['verify']));
    }
    if (cles.size === 0) throw new Error('certificats Access : aucune clé RS256');
    const jeu = { cles, chargeLe: maintenant().getTime() };
    jeux.set(equipe, jeu);
    return jeu;
  }

  /** Une seule requête de certificats à la fois par équipe. */
  function recharger(equipe: string): Promise<JeuDeCles> {
    let p = enCours.get(equipe);
    if (!p) {
      p = charger(equipe).finally(() => enCours.delete(equipe));
      enCours.set(equipe, p);
    }
    return p;
  }

  async function cle(equipe: string, kid: string): Promise<CryptoKey | undefined> {
    const t = maintenant().getTime();
    let jeu = jeux.get(equipe);
    if (!jeu || t - jeu.chargeLe > DUREE_CLES_MS) jeu = await recharger(equipe);
    const trouvee = jeu.cles.get(kid);
    if (trouvee || t - jeu.chargeLe < RECHARGEMENT_MIN_MS) return trouvee;
    // Rotation des clés : un kid inconnu recharge la liste (au plus une fois par minute).
    return (await recharger(equipe)).cles.get(kid);
  }

  /** E-mail du porteur si le JWT est valide ; sinon ErreurApi 403 (ou 503 si les clés sont injoignables). */
  return async function verifier(jwt: string, r: ReglagesAcces): Promise<string> {
    const refus = (raison: string) => {
      console.warn(`Access : JWT refusé (${raison}).`);
      return new ErreurApi(403, 'acces_refuse', 'Accès refusé : connexion Cloudflare Access absente ou invalide.');
    };
    const parties = jwt.split('.');
    if (parties.length !== 3) throw refus('format');
    const [h, p, s] = parties as [string, string, string];
    let entete: Record<string, unknown>;
    let charge: Record<string, unknown>;
    let signature: Uint8Array<ArrayBuffer>;
    try {
      entete = lireJson(h);
      charge = lireJson(p);
      signature = base64urlVersOctets(s);
    } catch {
      throw refus('illisible');
    }
    if (entete.alg !== 'RS256' || typeof entete.kid !== 'string') throw refus('algorithme');

    let cleKid: CryptoKey | undefined;
    try {
      cleKid = await cle(r.equipe, entete.kid);
    } catch (e) {
      console.error('Access : certificats injoignables :', e instanceof Error ? e.message : e);
      throw new ErreurApi(503, 'acces_indisponible', "Vérification de l'accès momentanément impossible.");
    }
    if (!cleKid) throw refus('clé inconnue');
    const valide = await crypto.subtle.verify(ALGO, cleKid, signature, new TextEncoder().encode(`${h}.${p}`));
    if (!valide) throw refus('signature');

    const iss = typeof charge.iss === 'string' ? charge.iss.replace(/\/+$/, '').toLowerCase() : '';
    if (iss !== r.equipe) throw refus('iss');
    const aud = Array.isArray(charge.aud) ? charge.aud : [charge.aud];
    if (!aud.includes(r.aud)) throw refus('aud');
    const t = maintenant().getTime() / 1000;
    if (typeof charge.exp !== 'number' || charge.exp + TOLERANCE_S < t) throw refus('expiré');
    if (charge.nbf !== undefined && (typeof charge.nbf !== 'number' || charge.nbf - TOLERANCE_S > t)) throw refus('nbf');
    const email = typeof charge.email === 'string' ? charge.email.trim().toLowerCase() : '';
    if (!email || !r.emails.has(email)) throw refus('e-mail non autorisé');
    return email;
  };
}

/** Hôte de la requête : local, web, api ; sinon refus (hôte inconnu, workers.dev compris). */
export function gardeAcces(deps: Dependances): MiddlewareHandler<EnvApp> {
  const verifier = creerVerificateurAcces(deps.recupererCertsAcces ?? ((url) => fetch(url)), deps.maintenant);
  return async (c, suite) => {
    if (c.env.FOCUS_ENVIRONNEMENT === 'local') {
      c.set('hote', 'local');
      const local = utilisateurLocal(c.env);
      if (local) c.set('utilisateurImplicite', local);
      return suite();
    }
    const nom = new URL(c.req.url).hostname.toLowerCase();
    const web = (c.env.HOTE_WEB ?? '').trim().toLowerCase();
    const api = (c.env.HOTE_API ?? '').trim().toLowerCase();

    if (web && nom === web) {
      const reglages = lireReglagesAcces(c.env);
      if ('manquantes' in reglages) {
        console.error(`Access : variable(s) manquante(s) ou invalide(s) : ${reglages.manquantes.join(', ')}. Hôte web fermé.`);
        throw new ErreurApi(403, 'acces_non_configure', "Accès fermé : Cloudflare Access n'est pas configuré sur le serveur.");
      }
      const jwt = c.req.header('Cf-Access-Jwt-Assertion') ?? getCookie(c, 'CF_Authorization');
      if (!jwt) {
        console.warn('Access : requête sans JWT sur l’hôte web.');
        throw new ErreurApi(403, 'acces_refuse', 'Accès refusé : connexion Cloudflare Access absente ou invalide.');
      }
      const email = await verifier(jwt, reglages);
      const utilisateur = reglages.utilisateurs.get(email);
      if (!utilisateur) {
        console.warn('Access : e-mail autorisé sans utilisateur Focus (ACCES_UTILISATEURS).');
        throw new ErreurApi(403, 'utilisateur_inconnu', 'Accès refusé : aucun utilisateur Focus pour ce compte.');
      }
      c.set('hote', 'web');
      c.set('utilisateurImplicite', utilisateur);
      return suite();
    }

    if (api && nom === api) {
      // Pas de web app ici : seule l'API répond.
      const chemin = new URL(c.req.url).pathname;
      if (!chemin.startsWith('/v1/')) throw new ErreurApi(404, 'introuvable', "Point d'entrée inconnu.");
      c.set('hote', 'api');
      return suite();
    }

    if (!web || !api) console.error('Access : HOTE_WEB ou HOTE_API manquant ; tout hôte est refusé.');
    else console.warn(`Access : hôte inconnu « ${nom} » refusé.`);
    throw new ErreurApi(403, 'hote_inconnu', 'Hôte non servi.');
  };
}

/** Route réservée au jeton d'interface : elle n'existe pas sur l'hôte de l'API. */
export const horsHoteApi: MiddlewareHandler<EnvApp> = async (c, suite) => {
  if (c.get('hote') === 'api') throw new ErreurApi(404, 'introuvable', "Point d'entrée inconnu.");
  await suite();
};
