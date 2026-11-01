// Réglages (chrome.storage.local) et client de l'API, partagés par le service worker et les pages.

export interface Reglages {
  /** Origine de l'API, sans barre finale, ex. "https://api-focus.fredericguiose.com". */
  api: string;
  jeton: string;
  appareil: string;
}

export interface ReponseBlocage {
  appareil: string;
  cible: string;
  app: { id: string; nom: string } | null;
  bloque: boolean;
  mode: string;
  raison: string;
  sessions: 'autorisees' | 'interdites';
  session: { id: string } | null;
}

export interface TacheSession {
  id: string;
  nom: string;
  priorite: 'p1' | 'p2' | 'p3' | 'p4';
  eligible_le: string;
}

/** Corps de toute erreur de l'API : `{ erreur, message, ...details }`. */
export class ErreurApi extends Error {
  constructor(
    readonly erreur: string,
    message: string,
    readonly statutHttp: number | null = null,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const CLES = ['api', 'jeton', 'appareil'] as const;

export async function lireReglages(): Promise<Reglages | null> {
  const lu = await chrome.storage.local.get([...CLES]);
  const api = typeof lu.api === 'string' ? lu.api : '';
  const jeton = typeof lu.jeton === 'string' ? lu.jeton : '';
  const appareil = typeof lu.appareil === 'string' ? lu.appareil : '';
  return api && jeton && appareil ? { api, jeton, appareil } : null;
}

export async function ecrireReglages(r: Reglages): Promise<void> {
  await chrome.storage.local.set({ ...r });
}

/** Normalise l'adresse saisie en origine ; refuse le HTTP en clair hors de la machine locale. */
export function origineApi(saisie: string): string {
  let url: URL;
  try {
    url = new URL(saisie.trim());
  } catch {
    throw new ErreurApi('url_invalide', "Adresse de l'API invalide.");
  }
  const locale = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && locale)) {
    throw new ErreurApi('url_invalide', 'HTTPS obligatoire (HTTP accepté seulement pour localhost).');
  }
  return url.origin;
}

export async function appeler<T>(r: Reglages, methode: 'GET' | 'POST', chemin: string, corps?: unknown): Promise<T> {
  const entetes: Record<string, string> = { Authorization: `Bearer ${r.jeton}` };
  if (corps !== undefined) entetes['Content-Type'] = 'application/json';
  let reponse: Response;
  try {
    reponse = await fetch(r.api + chemin, {
      method: methode,
      headers: entetes,
      body: corps === undefined ? undefined : JSON.stringify(corps),
      cache: 'no-store',
    });
  } catch {
    throw new ErreurApi('reseau', "API injoignable. Vérifiez la connexion et l'autorisation d'accès à l'API (options).");
  }
  const texte = await reponse.text();
  let donnees: unknown = null;
  try {
    donnees = texte ? JSON.parse(texte) : null;
  } catch {
    donnees = null;
  }
  if (!reponse.ok) {
    const d = (typeof donnees === 'object' && donnees !== null ? donnees : {}) as Record<string, unknown>;
    if (typeof d.erreur === 'string' && typeof d.message === 'string') {
      throw new ErreurApi(d.erreur, d.message, reponse.status, d);
    }
    throw new ErreurApi(`http_${reponse.status}`, `Erreur HTTP ${reponse.status}.`, reponse.status);
  }
  return donnees as T;
}

export function demanderBlocage(r: Reglages, domaine: string): Promise<ReponseBlocage> {
  const q = new URLSearchParams({ appareil: r.appareil, domaine });
  return appeler<ReponseBlocage>(r, 'GET', `/v1/blocage?${q}`);
}

export function versErreurApi(e: unknown): ErreurApi {
  if (e instanceof ErreurApi) return e;
  return new ErreurApi('inattendue', e instanceof Error ? e.message : String(e));
}
