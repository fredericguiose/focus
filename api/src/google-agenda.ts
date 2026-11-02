// Client Google Agenda minimal (fetch seul, sans SDK) : un événement « Dormir » par nuit dans le
// calendrier `primary` (CDC, décision du 02/11 ; docs/conception.md §4.4).
//
// Doc de référence :
//   - jeton : https://developers.google.com/identity/protocols/oauth2/native-app (échange du
//     refresh token sur https://oauth2.googleapis.com/token, grant_type=refresh_token) ;
//   - événements : https://developers.google.com/workspace/calendar/api/v3/reference/events
//     (id choisi par le client : caractères base32hex, a-v et 0-9, 5 à 1024 caractères, unique
//     par calendrier) ;
//   - erreurs : https://developers.google.com/workspace/calendar/api/guides/errors (401 authError,
//     403/429 rateLimitExceeded, userRateLimitExceeded, quotaExceeded, 409 duplicate).
//
// Identification de l'événement d'une nuit : id déterministe dérivé de la date de la nuit
// (`focussommeil20261103`), plutôt qu'une recherche par `privateExtendedProperty`. Plus robuste :
// une écriture est idempotente (une création répétée ne peut pas faire de doublon, même si
// l'écriture en base échoue après l'appel), et aucune requête de recherche n'est nécessaire. Les
// propriétés privées `focus = "sommeil"` et `focusNuit = <nuit>` sont posées quand même (repérage
// à la main, nettoyage). Écriture : PUT (remplacement complet, `status: confirmed`, ce qui
// restaure aussi un événement supprimé à la main), puis POST avec l'id si l'événement n'existe pas.

export type CodeErreurAgenda =
  | 'jeton_google_revoque'
  | 'client_google_refuse'
  | 'google_acces_refuse'
  | 'google_quota'
  | 'google_indisponible'
  | 'google_reponse_invalide';

/** Le message ne contient jamais de jeton, de secret ni de corps de réponse. */
export class ErreurAgenda extends Error {
  constructor(
    readonly code: CodeErreurAgenda,
    message: string,
  ) {
    super(`${code} : ${message}`);
    this.name = 'ErreurAgenda';
  }
}

export interface IdentifiantsGoogle {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** Bloc « Dormir » d'une nuit : instants UTC, fuseau de la routine (affichage). */
export interface NuitAgenda {
  /** Date de la nuit (jour du soir), AAAA-MM-JJ. */
  nuit: string;
  debut: string;
  fin: string;
  fuseau: string;
}

export interface ClientAgenda {
  /** Crée ou remplace l'événement de la nuit. */
  ecrireNuit(n: NuitAgenda): Promise<void>;
  /** Supprime l'événement de la nuit ; déjà absent : rien. */
  supprimerNuit(nuit: string): Promise<void>;
  /** Refresh token renvoyé par Google lors de l'échange (rare), sinon null. */
  refreshTokenRecu?(): string | null;
}

export interface OptionsAgenda extends IdentifiantsGoogle {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

export const URL_JETON_GOOGLE = 'https://oauth2.googleapis.com/token';
export const URL_EVENEMENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const DELAI_MS = 15_000;

/** Seul gris de la palette d'événements (colorId 8, #e1e1e1, vérifié via /colors le 02/11). Bouleau (#cabdbf) n'existe que pour les agendas (id 20), pas pour un événement. */
export const COULEUR_NUIT = '8';
/** Version du titre et de la couleur : la monter fait réécrire les nuits déjà écrites. */
export const FORMAT_NUIT = 4;

/** Heure locale du lever, format « 06h30 », dans le fuseau de la routine. */
export function heureLever(instant: string, fuseau: string): string {
  const p = new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(instant));
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${v('hour')}h${v('minute')}`;
}

/** Titre de l'événement : « 🛌 Dormir c'est important lever 06h30 ». */
export function titreNuit(n: Pick<NuitAgenda, 'fin' | 'fuseau'>): string {
  return `🛌 Dormir c'est important lever ${heureLever(n.fin, n.fuseau)}`;
}
export const DESCRIPTION_NUIT = 'Tenu à jour par Focus';

/** Id déterministe de l'événement d'une nuit (base32hex : a-v, 0-9). */
export function idEvenementNuit(nuit: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nuit)) throw new Error(`nuit invalide « ${nuit} »`);
  return `focussommeil${nuit.replaceAll('-', '')}`;
}

/** Corps complet de l'événement (PUT et POST). */
export function corpsEvenement(n: NuitAgenda) {
  return {
    id: idEvenementNuit(n.nuit),
    status: 'confirmed',
    summary: titreNuit(n),
    colorId: COULEUR_NUIT,
    description: DESCRIPTION_NUIT,
    start: { dateTime: n.debut, timeZone: n.fuseau },
    end: { dateTime: n.fin, timeZone: n.fuseau },
    transparency: 'opaque',
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: { private: { focus: 'sommeil', focusNuit: n.nuit } },
  };
}

const RAISONS_QUOTA = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded']);

/** Raisons d'une erreur de l'API (`error.errors[].reason`) ; jamais le message entier. */
async function raisons(r: Response): Promise<string[]> {
  try {
    const corps = (await r.json()) as { error?: { errors?: { reason?: unknown }[] } };
    return (corps.error?.errors ?? []).map((e) => (typeof e.reason === 'string' ? e.reason : '')).filter(Boolean);
  } catch {
    return [];
  }
}

/** Corps d'une réponse dont on n'a pas besoin : libéré (le Worker garde sinon la connexion). */
async function liberer(r: Response): Promise<void> {
  try {
    await r.body?.cancel();
  } catch {
    // Déjà lu ou fermé.
  }
}

async function erreurApi(r: Response, action: string): Promise<ErreurAgenda> {
  const liste = await raisons(r);
  if (r.status === 401) return new ErreurAgenda('jeton_google_revoque', `${action} : HTTP 401`);
  if (r.status === 429 || (r.status === 403 && liste.some((x) => RAISONS_QUOTA.has(x)))) {
    return new ErreurAgenda('google_quota', `${action} : HTTP ${r.status} (${liste.join(', ') || 'quota'})`);
  }
  if (r.status === 403) return new ErreurAgenda('google_acces_refuse', `${action} : HTTP 403 (${liste.join(', ') || 'refus'})`);
  if (r.status >= 500) return new ErreurAgenda('google_indisponible', `${action} : HTTP ${r.status}`);
  return new ErreurAgenda('google_reponse_invalide', `${action} : HTTP ${r.status} (${liste.join(', ') || 'réponse inattendue'})`);
}

export function creerClientAgenda(o: OptionsAgenda): ClientAgenda {
  const f = o.fetch ?? ((u, i) => fetch(u, i));
  let acces: Promise<string> | null = null;
  let refreshRecu: string | null = null;

  async function appeler(url: string, init: RequestInit, action: string): Promise<Response> {
    try {
      return await f(url, { ...init, signal: AbortSignal.timeout(DELAI_MS) });
    } catch {
      throw new ErreurAgenda('google_indisponible', `${action} : pas de réponse de Google`);
    }
  }

  /** Jeton d'accès, demandé une fois par client (donc une fois par passage), seulement s'il sert. */
  async function obtenirAcces(): Promise<string> {
    const r = await appeler(
      URL_JETON_GOOGLE,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: o.refreshToken,
          client_id: o.clientId,
          client_secret: o.clientSecret,
        }).toString(),
      },
      'jeton',
    );
    let corps: Record<string, unknown> = {};
    try {
      corps = (await r.json()) as Record<string, unknown>;
    } catch {
      // Corps illisible : traité selon le code HTTP.
    }
    if (!r.ok) {
      const code = typeof corps.error === 'string' ? corps.error : '';
      // invalid_grant : refresh token révoqué, expiré (7 jours en mode Test) ou inconnu.
      if (code === 'invalid_grant') throw new ErreurAgenda('jeton_google_revoque', 'jeton : invalid_grant');
      if (code === 'invalid_client' || code === 'unauthorized_client') throw new ErreurAgenda('client_google_refuse', `jeton : ${code}`);
      if (r.status === 429) throw new ErreurAgenda('google_quota', 'jeton : HTTP 429');
      if (r.status >= 500) throw new ErreurAgenda('google_indisponible', `jeton : HTTP ${r.status}`);
      throw new ErreurAgenda('google_reponse_invalide', `jeton : HTTP ${r.status}${code ? ` (${code})` : ''}`);
    }
    if (typeof corps.access_token !== 'string' || corps.access_token === '') {
      throw new ErreurAgenda('google_reponse_invalide', 'jeton : access_token absent');
    }
    if (typeof corps.refresh_token === 'string' && corps.refresh_token !== '' && corps.refresh_token !== o.refreshToken) {
      refreshRecu = corps.refresh_token;
    }
    return corps.access_token;
  }

  function jeton(): Promise<string> {
    acces ??= obtenirAcces().catch((e: unknown) => {
      acces = null;
      throw e;
    });
    return acces;
  }

  async function entetes(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await jeton()}`, 'Content-Type': 'application/json', Accept: 'application/json' };
  }

  return {
    async ecrireNuit(n) {
      const id = idEvenementNuit(n.nuit);
      const corps = JSON.stringify(corpsEvenement(n));
      const maj = await appeler(`${URL_EVENEMENTS}/${id}`, { method: 'PUT', headers: await entetes(), body: corps }, 'mise à jour');
      if (maj.ok) return liberer(maj);
      if (maj.status !== 404) throw await erreurApi(maj, 'mise à jour');
      await liberer(maj);
      const creation = await appeler(URL_EVENEMENTS, { method: 'POST', headers: await entetes(), body: corps }, 'création');
      if (!creation.ok) throw await erreurApi(creation, 'création');
      await liberer(creation);
    },
    async supprimerNuit(nuit) {
      const r = await appeler(`${URL_EVENEMENTS}/${idEvenementNuit(nuit)}`, { method: 'DELETE', headers: await entetes() }, 'suppression');
      // 404 : jamais créé ; 410 : déjà supprimé.
      if (r.ok || r.status === 404 || r.status === 410) return liberer(r);
      throw await erreurApi(r, 'suppression');
    },
    refreshTokenRecu: () => refreshRecu,
  };
}
