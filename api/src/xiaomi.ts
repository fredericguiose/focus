// Lecture du sommeil dans le cloud Xiaomi (Mi Fitness), en lecture seule.
//
// Provenance : implémentation écrite pour Focus d'après le protocole décrit par deux sources
// sous licence MIT, sans recopie de code :
//   - github.com/shkyyy18/mi_fitness_data_bridge, révision 5012a84a6b4311d1913224bf5005b43ea2a016f8
//     (03/08/2026 01:38 UTC, LICENSE MIT ; parent direct du commit 364a370d du 03/08/2026
//     16:11 UTC qui passe le dépôt en AGPL-3.0-only) :
//     connexion par userId + passToken (sid miothealth), RC4 avec un flux neuf par valeur,
//     signature, pagination de get_fitness_data_by_time, champs d'une session de sommeil ;
//   - github.com/LilZeeCN/mi-health-exporter, révision 1dc9274a90ccc83f02cbb3706aae2a4d55c8e90a
//     (LICENSE MIT) : RC4-drop1024, nonce, champs sleep_*_duration des phases.
// Aucun code de la version AGPL (à partir de 364a370d) n'est repris.

export type CodeErreurXiaomi = 'jeton_xiaomi_expire' | 'xiaomi_indisponible' | 'xiaomi_reponse_invalide';

/** Le message ne contient jamais de jeton ni de corps de réponse (la connexion renvoie des secrets). */
export class ErreurXiaomi extends Error {
  constructor(
    readonly code: CodeErreurXiaomi,
    message: string,
  ) {
    super(`${code} : ${message}`);
    this.name = 'ErreurXiaomi';
  }
}

export interface IdentifiantsXiaomi {
  userId: string;
  passToken: string;
  region?: string;
}

export interface PhasesSommeil {
  legere: number;
  profonde: number;
  rem: number;
  eveil: number;
}

/**
 * Codes `state` de la chronologie : 2 profond, 3 léger, 4 REM, 5 éveil. Déduits de la réponse
 * elle-même (somme des tranches de chaque code = champ sleep_*_duration correspondant, 3 nuits
 * réelles sur 3, 01/11/2026). Un autre code garde son numéro, sans phase.
 */
export const PHASE_DE_L_ETAT: Record<number, keyof PhasesSommeil> = { 2: 'profonde', 3: 'legere', 4: 'rem', 5: 'eveil' };

export interface TrancheSommeil {
  debut: string;
  fin: string;
  etat: number;
  phase: keyof PhasesSommeil | null;
}

export interface Extremes {
  moyenne: number;
  min: number | null;
  max: number | null;
}

/** Ce que la montre mesure en plus des minutes par phase ; null quand la réponse ne le donne pas. */
export interface ComplementsSommeil {
  chronologie: TrancheSommeil[];
  reveils: number | null;
  frequence_cardiaque: Extremes | null;
  spo2: Extremes | null;
  qualite_respiration: number | null;
  incomplete: boolean | null;
  avec_phases: boolean | null;
  avec_rem: boolean | null;
  /** Champ `timezone` de Xiaomi, tel quel. */
  fuseau_xiaomi: number | null;
  version_algorithme: number | null;
}

export interface SessionSommeil {
  /** Identifiant stable de la session côté Xiaomi : clé d'idempotence. */
  id: string;
  debut: string;
  fin: string;
  endormi_min: number;
  eveille_min: number;
  phases: PhasesSommeil | null;
  score: number | null;
  sieste: boolean;
  /** Session effacée côté Xiaomi. */
  supprimee: boolean;
  complements: ComplementsSommeil;
}

export interface ClientXiaomi {
  sessionsSommeil(debut: Date, fin: Date): Promise<SessionSommeil[]>;
  /** passToken renvoyé par la dernière connexion (Xiaomi peut le faire tourner) ; null s'il n'y en a pas. */
  passTokenRecu?(): string | null;
}

export interface OptionsXiaomi extends IdentifiantsXiaomi {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** Heure réelle pour le nonce (le serveur la vérifie) ; injectée par les tests. */
  maintenant?: () => number;
  aleatoire?: (n: number) => Uint8Array;
}

export const URL_CONNEXION = 'https://account.xiaomi.com/pass/serviceLogin?_json=true&sid=miothealth';
export const CHEMIN_DONNEES = '/app/v1/data/get_fitness_data_by_time';
const PREFIXE_CONNEXION = '&&&START&&&';
/** Sans User-Agent (fetch des Workers), le compte refuse le passToken (code 70016). */
const AGENT = 'focus-sommeil/1.0';
const PAGES_MAX = 20;
const DELAI_MS = 15_000;

export function hoteSante(region = ''): string {
  const r = region.trim().toLowerCase();
  if (r !== '' && !/^[a-z0-9]{2,4}$/.test(r)) throw new ErreurXiaomi('xiaomi_reponse_invalide', 'région Xiaomi illisible');
  return r === '' || r === 'cn' ? 'https://hlth.io.mi.com' : `https://${r}.hlth.io.mi.com`;
}

// ── Chiffrement ───────────────────────────────────────────────────────────────

/** RC4 ; `abandon` octets du flux sont jetés avant usage (1024 pour Xiaomi). */
export function rc4(cle: Uint8Array, donnees: Uint8Array, abandon = 1024): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i]! + cle[i % cle.length]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  let i = 0;
  let j = 0;
  const octet = () => {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
    return s[(s[i]! + s[j]!) & 0xff]!;
  };
  for (let n = 0; n < abandon; n++) octet();
  const sortie = new Uint8Array(donnees.length);
  for (let n = 0; n < donnees.length; n++) sortie[n] = donnees[n]! ^ octet();
  return sortie;
}

export function versBase64(o: Uint8Array): string {
  let s = '';
  for (const b of o) s += String.fromCharCode(b);
  return btoa(s);
}

export function depuisBase64(t: string): Uint8Array {
  const s = atob(t.trim());
  const o = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i);
  return o;
}

const utf8 = (t: string) => new TextEncoder().encode(t);

async function empreinte(algo: 'SHA-1' | 'SHA-256', o: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(algo, o));
}

/** 8 octets aléatoires + minutes écoulées depuis l'époque (entier 32 bits gros-boutiste). */
export function nonce(aleatoire: Uint8Array, maintenantMs: number): Uint8Array {
  const n = new Uint8Array(12);
  n.set(aleatoire.subarray(0, 8));
  new DataView(n.buffer).setUint32(8, Math.floor(maintenantMs / 60_000));
  return n;
}

export async function nonceSigne(ssecurity: Uint8Array, n: Uint8Array): Promise<Uint8Array> {
  const tout = new Uint8Array(ssecurity.length + n.length);
  tout.set(ssecurity);
  tout.set(n, ssecurity.length);
  return empreinte('SHA-256', tout);
}

/** SHA-1 de « POST&chemin&data=…[&rc4_hash__=…]&nonceSigné(base64) », en base64. */
export async function signature(chemin: string, valeurs: { data: string; rc4_hash__?: string }, signe: Uint8Array): Promise<string> {
  let base = `POST&${chemin}&data=${valeurs.data}`;
  if (valeurs.rc4_hash__ !== undefined) base += `&rc4_hash__=${valeurs.rc4_hash__}`;
  base += `&${versBase64(signe)}`;
  return versBase64(await empreinte('SHA-1', utf8(base)));
}

// ── Normalisation ─────────────────────────────────────────────────────────────

export interface EnregistrementXiaomi {
  sid?: string | number;
  time?: number;
  value?: string | Record<string, unknown>;
  deleted?: boolean;
}

const entier = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null;
};

const instant = (s: number) => new Date(s * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

const booleen = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : v === 0 || v === 1 ? v === 1 : null);

/** Une mesure à 0 n'a pas été prise (pouls, SpO2). */
const positif = (v: unknown) => {
  const n = entier(v);
  return n !== null && n > 0 ? n : null;
};

function extremes(v: Record<string, unknown>, cle: string): Extremes | null {
  const moyenne = positif(v[`avg_${cle}`]);
  return moyenne === null ? null : { moyenne, min: positif(v[`min_${cle}`]), max: positif(v[`max_${cle}`]) };
}

function chronologie(items: unknown): TrancheSommeil[] {
  if (!Array.isArray(items)) return [];
  const tranches: TrancheSommeil[] = [];
  for (const it of items as Record<string, unknown>[]) {
    const debut = entier(it?.start_time);
    const fin = entier(it?.end_time);
    const etat = entier(it?.state);
    if (debut === null || fin === null || etat === null || fin <= debut) continue;
    tranches.push({ debut: instant(debut), fin: instant(fin), etat, phase: PHASE_DE_L_ETAT[etat] ?? null });
  }
  return tranches.sort((a, b) => a.debut.localeCompare(b.debut));
}

function complements(v: Record<string, unknown>): ComplementsSommeil {
  return {
    chronologie: chronologie(v.items),
    reveils: entier(v.awake_count),
    frequence_cardiaque: extremes(v, 'hr'),
    spo2: extremes(v, 'spo2'),
    qualite_respiration: entier(v.breath_quality),
    incomplete: booleen(v.is_uncomplete),
    avec_phases: booleen(v.has_stage),
    avec_rem: booleen(v.has_rem),
    fuseau_xiaomi: entier(v.timezone),
    version_algorithme: entier(v.sleep_algorithm_version),
  };
}

/** Une session de sommeil telle que Focus la garde ; null si elle n'a pas de bornes. */
export function normaliserSommeil(e: EnregistrementXiaomi): SessionSommeil | null {
  let v: Record<string, unknown>;
  try {
    v = typeof e.value === 'string' ? (JSON.parse(e.value) as Record<string, unknown>) : (e.value ?? {});
  } catch {
    return null;
  }
  const debut = entier(v.bedtime) ?? entier(v.device_bedtime) ?? entier(v.bed_timestamp);
  const fin = entier(v.wake_up_time) ?? entier(v.device_wake_up_time) ?? entier(v.out_bed_timestamp) ?? entier(e.time);
  if (debut === null || fin === null || fin <= debut) return null;

  const profonde = entier(v.sleep_deep_duration);
  const legere = entier(v.sleep_light_duration);
  const rem = entier(v.sleep_rem_duration);
  const eveilPhase = entier(v.sleep_awake_duration) ?? entier(v.awake_duration);
  const avecPhases = profonde !== null || legere !== null || rem !== null;
  const phases = avecPhases ? { legere: legere ?? 0, profonde: profonde ?? 0, rem: rem ?? 0, eveil: eveilPhase ?? 0 } : null;

  const duree = entier(v.duration) ?? Math.floor((fin - debut) / 60);
  const eveille = Math.max(0, entier(v.awake_duration) ?? eveilPhase ?? 0);
  const sommePhases = phases ? phases.legere + phases.profonde + phases.rem : 0;
  const endormi = sommePhases > 0 ? sommePhases : Math.max(0, duree - eveille);
  const score = entier(v.sleep_score) ?? entier(v.score);

  return {
    id: `${e.sid ?? 'sommeil'}_${e.time ?? fin}`,
    debut: instant(debut),
    fin: instant(fin),
    endormi_min: endormi,
    eveille_min: phases ? phases.eveil : eveille,
    phases,
    score: score !== null && score > 0 ? score : null,
    sieste: v.is_nap === true || v.is_nap === 1,
    supprimee: e.deleted === true,
    complements: complements(v),
  };
}

// ── Client ────────────────────────────────────────────────────────────────────

interface Session {
  ssecurity: Uint8Array;
  cookies: string;
}

/** Valeur d'un cookie dans les en-têtes Set-Cookie, ou null. */
function cookieRecu(r: Response, nom: string): string | null {
  for (const c of r.headers.getSetCookie()) {
    const paire = c.split(';', 1)[0]!;
    const i = paire.indexOf('=');
    if (i > 0 && paire.slice(0, i).trim() === nom) {
      const v = paire.slice(i + 1).trim();
      return v === '' || v === 'EXPIRED' ? null : v;
    }
  }
  return null;
}

const estErreurAuth = (code: unknown, message: string) =>
  code === 401 || code === 403 || code === -6 || code === -10001 || /expired|unauthori|not logged|login required|invalid pass ?token/i.test(message);

export function creerClientXiaomi(o: OptionsXiaomi): ClientXiaomi {
  const f = o.fetch ?? ((u, i) => fetch(u, i));
  const maintenant = o.maintenant ?? Date.now;
  const aleatoire = o.aleatoire ?? ((n) => crypto.getRandomValues(new Uint8Array(n)));
  const base = hoteSante(o.region);
  let session: Promise<Session> | null = null;
  let jetonRecu: string | null = null;

  async function appel(url: string, init: RequestInit): Promise<Response> {
    try {
      const headers = new Headers(init.headers);
      headers.set('User-Agent', AGENT);
      return await f(url, { ...init, headers, redirect: 'manual', signal: AbortSignal.timeout(DELAI_MS) });
    } catch {
      throw new ErreurXiaomi('xiaomi_indisponible', `pas de réponse de ${new URL(url).host}`);
    }
  }

  async function connecter(): Promise<Session> {
    const r = await appel(URL_CONNEXION, { headers: { Cookie: `userId=${o.userId}; passToken=${o.passToken}` } });
    if (r.status === 401 || r.status === 403) throw new ErreurXiaomi('jeton_xiaomi_expire', `connexion refusée (HTTP ${r.status})`);
    if (!r.ok) throw new ErreurXiaomi('xiaomi_indisponible', `connexion : HTTP ${r.status}`);
    const texte = await r.text();
    if (!texte.startsWith(PREFIXE_CONNEXION)) throw new ErreurXiaomi('xiaomi_reponse_invalide', 'réponse de connexion inattendue');
    let corps: { code?: unknown; ssecurity?: unknown; location?: unknown; passToken?: unknown };
    try {
      corps = JSON.parse(texte.slice(PREFIXE_CONNEXION.length));
    } catch {
      throw new ErreurXiaomi('xiaomi_reponse_invalide', 'réponse de connexion illisible');
    }
    // Jeton refusé : le compte renvoie la page de connexion, sans ssecurity.
    if (typeof corps.ssecurity !== 'string' || typeof corps.location !== 'string' || (corps.code !== undefined && corps.code !== 0)) {
      throw new ErreurXiaomi('jeton_xiaomi_expire', `passToken refusé (code ${String(corps.code)}), à renouveler`);
    }
    const lieu = new URL(corps.location);
    if (lieu.protocol !== 'https:' || !/(^|\.)(mi|xiaomi)\.com$/.test(lieu.hostname)) {
      throw new ErreurXiaomi('xiaomi_reponse_invalide', 'redirection de connexion hors des domaines Xiaomi');
    }
    const nouveau = typeof corps.passToken === 'string' && corps.passToken !== '' ? corps.passToken : cookieRecu(r, 'passToken');
    const rs = await appel(lieu.toString(), {});
    if (rs.status >= 400) throw new ErreurXiaomi('xiaomi_indisponible', `jeton de service : HTTP ${rs.status}`);
    const cookies = rs.headers
      .getSetCookie()
      .map((c) => c.split(';', 1)[0]!.trim())
      .filter((c) => c.includes('='));
    if (!cookies.some((c) => c.startsWith('serviceToken='))) throw new ErreurXiaomi('jeton_xiaomi_expire', 'pas de jeton de service');
    if (nouveau) jetonRecu = nouveau;
    return { ssecurity: depuisBase64(corps.ssecurity), cookies: cookies.join('; ') };
  }

  async function demander(s: Session, chemin: string, charge: unknown): Promise<Record<string, unknown>> {
    const n = nonce(aleatoire(8), maintenant());
    const signe = await nonceSigne(s.ssecurity, n);
    const data = JSON.stringify(charge);
    const rc4Hash = await signature(chemin, { data }, signe);
    const chiffrer = (t: string) => versBase64(rc4(signe, utf8(t)));
    const chiffre = { data: chiffrer(data), rc4_hash__: chiffrer(rc4Hash) };
    const formulaire = new URLSearchParams({
      ...chiffre,
      signature: await signature(chemin, chiffre, signe),
      _nonce: versBase64(n),
    });
    const r = await appel(base + chemin, {
      method: 'POST',
      headers: { Cookie: s.cookies, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formulaire.toString(),
    });
    if (r.status === 401 || r.status === 403) throw new ErreurXiaomi('jeton_xiaomi_expire', `données refusées (HTTP ${r.status})`);
    if (!r.ok) throw new ErreurXiaomi('xiaomi_indisponible', `données : HTTP ${r.status}`);
    let corps: { code?: unknown; message?: unknown; result?: unknown };
    try {
      corps = JSON.parse(new TextDecoder().decode(rc4(signe, depuisBase64(await r.text()))));
    } catch {
      throw new ErreurXiaomi('xiaomi_reponse_invalide', 'réponse chiffrée illisible');
    }
    if (corps.code !== 0) {
      const message = typeof corps.message === 'string' ? corps.message.slice(0, 120) : 'erreur inconnue';
      throw new ErreurXiaomi(estErreurAuth(corps.code, message) ? 'jeton_xiaomi_expire' : 'xiaomi_indisponible', `code ${String(corps.code)} (${message})`);
    }
    return (corps.result ?? {}) as Record<string, unknown>;
  }

  return {
    passTokenRecu: () => jetonRecu,
    async sessionsSommeil(debut, fin) {
      // Une connexion par client : les plages lues au même passage la partagent.
      session ??= connecter().catch((e: unknown) => {
        session = null;
        throw e;
      });
      const s = await session;
      const enregistrements: EnregistrementXiaomi[] = [];
      const vus = new Set<string>();
      let suivante: string | undefined;
      for (let page = 1; ; page++) {
        if (page > PAGES_MAX) throw new ErreurXiaomi('xiaomi_reponse_invalide', 'pagination sans fin');
        const r = await demander(s, CHEMIN_DONNEES, {
          start_time: Math.floor(debut.getTime() / 1000),
          end_time: Math.floor(fin.getTime() / 1000),
          key: 'sleep',
          ...(suivante ? { next_key: suivante } : {}),
        });
        if (Array.isArray(r.data_list)) enregistrements.push(...(r.data_list as EnregistrementXiaomi[]));
        if (!r.has_more || !r.next_key) break;
        suivante = String(r.next_key);
        if (vus.has(suivante)) throw new ErreurXiaomi('xiaomi_reponse_invalide', 'curseur de pagination répété');
        vus.add(suivante);
      }
      return enregistrements.map(normaliserSommeil).filter((x): x is SessionSommeil => x !== null);
    },
  };
}
