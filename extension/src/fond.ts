// Service worker. L'extension ne bloque pas le réseau : le client PC bloque par le fichier hosts.
// Elle garde le planning de l'appareil (GET /v1/planning, rafraîchi toutes les minutes) et décide
// localement, avec la règle du client PC (regles.ts), si le site ouvert est bloqué : si oui, elle
// remplace l'onglet par sa page. Indispensable pour les sites servis par leur propre service
// worker (YouTube) : la page s'affiche depuis le cache sans aucune erreur de navigation.
// Repli, sans planning frais : sur une erreur de navigation qui ressemble au blocage hosts, on
// demande à l'API (GET /v1/blocage) si ce domaine est bloqué.
import { type MessageRafraichir, type Reglages, type ReponseRafraichir, appeler, demanderBlocage, lireReglages, versErreurApi } from './commun.js';
import { type PlanningRecu, decider, finDuBlocage, resume, segmentEnVigueur, validerPlanning } from './regles.js';

const ERREURS_DE_BLOCAGE = new Set([
  'net::ERR_CONNECTION_REFUSED',
  'net::ERR_NAME_NOT_RESOLVED',
  'net::ERR_ADDRESS_INVALID',
  'net::ERR_CONNECTION_RESET',
]);

const ALARME = 'planning';
const CLE_PLANNING = 'planning';
/** Au réveil du service worker, inutile de relire un planning reçu il y a moins de 30 s. */
const FRAICHEUR_REVEIL_MS = 30_000;
const DELAI_CONFIRMATION_MS = 3_000;

// ─── Planning ───────────────────────────────────────────────────────────────────────────────

let enMemoire: PlanningRecu | null = null;
let enCours: { cle: string; promesse: Promise<PlanningRecu> } | null = null;

async function planningGarde(): Promise<PlanningRecu | null> {
  if (enMemoire) return enMemoire;
  const lu = await chrome.storage.session.get(CLE_PLANNING);
  enMemoire = (lu[CLE_PLANNING] as PlanningRecu | undefined) ?? null;
  return enMemoire;
}

async function telecharger(r: Reglages): Promise<PlanningRecu> {
  const planning = validerPlanning(await appeler<unknown>(r, 'GET', '/v1/planning'));
  if (planning.appareil !== r.appareil) {
    throw new Error(`Le jeton est celui de l'appareil « ${planning.appareil} », pas de « ${r.appareil} ».`);
  }
  const recuLe = Date.now();
  const recu: PlanningRecu = { planning, recuLe, decalageMs: Date.parse(planning.heure_serveur) - recuLe };
  // Réglages changés pendant la requête : ce planning ne vaut que pour l'appelant, pas pour la garde.
  const actuels = await lireReglages();
  if (actuels && cleReglages(actuels) === cleReglages(r)) {
    enMemoire = recu;
    await chrome.storage.session.set({ [CLE_PLANNING]: recu });
  }
  return recu;
}

const cleReglages = (r: Reglages) => JSON.stringify([r.api, r.jeton, r.appareil]);

/** Relit le planning ; les appels simultanés avec les mêmes réglages partagent la même requête. */
function rafraichir(r: Reglages): Promise<PlanningRecu> {
  const cle = cleReglages(r);
  if (enCours?.cle === cle) return enCours.promesse;
  const promesse = telecharger(r).finally(() => {
    if (enCours?.promesse === promesse) enCours = null;
  });
  enCours = { cle, promesse };
  return promesse;
}

async function rafraichirSiPossible(): Promise<void> {
  const r = await lireReglages();
  if (!r) return;
  try {
    await rafraichir(r);
  } catch (e) {
    // Le planning gardé vieillit ; au-delà de 10 min ou de valable_jusqua il ne décide plus rien.
    console.warn('Focus : planning non rafraîchi :', versErreurApi(e).message);
  }
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARME) void rafraichirSiPossible();
});

async function demarrer(): Promise<void> {
  if (!(await chrome.alarms.get(ALARME))) await chrome.alarms.create(ALARME, { periodInMinutes: 1 });
  const p = await planningGarde();
  if (!p || Date.now() - p.recuLe > FRAICHEUR_REVEIL_MS) await rafraichirSiPossible();
}
void demarrer();

// Nouveaux réglages : l'ancien planning (autre appareil, autre jeton) ne vaut plus rien.
chrome.storage.onChanged.addListener((changes, zone) => {
  if (zone !== 'local' || !('jeton' in changes || 'api' in changes || 'appareil' in changes)) return;
  enMemoire = null;
  void chrome.storage.session.remove(CLE_PLANNING).then(rafraichirSiPossible);
});

// ─── Décision sur navigation ────────────────────────────────────────────────────────────────

const hoteDe = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

/** Dernière redirection par onglet : onBeforeNavigate et onCommitted ne redirigent qu'une fois. */
const redirections = new Map<number, { url: string; t: number }>();

async function afficherBlocage(ongletId: number, url: string): Promise<void> {
  const derniere = redirections.get(ongletId);
  if (derniere && derniere.url === url && Date.now() - derniere.t < 2000) return;
  redirections.set(ongletId, { url, t: Date.now() });
  const page = new URL(chrome.runtime.getURL('bloque.html'));
  page.searchParams.set('url', url);
  try {
    await chrome.tabs.update(ongletId, { url: page.href });
  } catch {
    // Onglet fermé entre-temps.
  }
}

/** true : bloqué d'après le planning ; false : pas bloqué ; null : pas de planning frais. */
async function bloqueSelonPlanning(r: Reglages, hote: string): Promise<boolean | null> {
  const hoteApi = hoteDe(r.api);
  const d = decider(await planningGarde(), hote, Date.now(), hoteApi);
  if (!d.utilisable) return null;
  if (!d.bloque || !d.confirmer) return d.bloque;
  // Devenu bloqué depuis la réception : le client PC a peut-être déjà un planning plus récent.
  try {
    const recu = await Promise.race([
      rafraichir(r),
      new Promise<never>((_, refuser) => setTimeout(() => refuser(new Error('délai')), DELAI_CONFIRMATION_MS)),
    ]);
    const d2 = decider(recu, hote, Date.now(), hoteApi);
    return d2.utilisable ? d2.bloque : null;
  } catch {
    return d.bloque;
  }
}

async function surNavigation(ongletId: number, url: string): Promise<void> {
  const r = await lireReglages();
  if (!r) return;
  const hote = hoteDe(url);
  if (hote && (await bloqueSelonPlanning(r, hote))) await afficherBlocage(ongletId, url);
}

type DetailsNavigation = { tabId: number; frameId: number; url: string; documentLifecycle?: string };

/** Cadre principal d'un vrai onglet (pas un prérendu). */
const principal = (d: DetailsNavigation) => d.frameId === 0 && d.tabId >= 0 && d.documentLifecycle !== 'prerender';

const FILTRE_WEB = { url: [{ schemes: ['http', 'https'] }] };

// onBeforeNavigate : avant même la requête ; onCommitted : la page s'affiche (cache de service
// worker compris) ; onHistoryStateUpdated : navigation interne d'un site SPA, utile quand le
// blocage commence alors que la page est déjà ouverte.
const surCadre = (d: DetailsNavigation) => {
  if (principal(d)) void surNavigation(d.tabId, d.url);
};
chrome.webNavigation.onBeforeNavigate.addListener(surCadre, FILTRE_WEB);
chrome.webNavigation.onCommitted.addListener(surCadre, FILTRE_WEB);
chrome.webNavigation.onHistoryStateUpdated.addListener(surCadre, FILTRE_WEB);

chrome.tabs.onRemoved.addListener((id) => redirections.delete(id));

// ─── Repli : erreur de navigation ───────────────────────────────────────────────────────────

chrome.webNavigation.onErrorOccurred.addListener((d) => {
  if (!principal(d) || !ERREURS_DE_BLOCAGE.has(d.error)) return;
  void surErreur(d.tabId, d.url);
}, FILTRE_WEB);

async function surErreur(ongletId: number, url: string): Promise<void> {
  const r = await lireReglages();
  if (!r) return;
  const hote = hoteDe(url);
  if (!hote || hote === hoteDe(r.api)) return;
  const selonPlanning = await bloqueSelonPlanning(r, hote);
  if (selonPlanning !== null) {
    if (selonPlanning) await afficherBlocage(ongletId, url);
    return;
  }
  // Pas de planning frais : seul cas où un domaine visité part vers l'API.
  try {
    if ((await demanderBlocage(r, hote)).bloque) await afficherBlocage(ongletId, url);
  } catch {
    // API injoignable ou refus : la page d'erreur de Chrome reste affichée.
  }
}

// ─── Messages des pages de l'extension ──────────────────────────────────────────────────────

async function repondreRafraichir(m: MessageRafraichir): Promise<ReponseRafraichir> {
  const r = await lireReglages();
  if (!r) return { ok: false, erreur: 'non_configuree', message: "Réglages incomplets : adresse de l'API, jeton et appareil." };
  try {
    const recu = await rafraichir(r);
    const maintenant = Date.now();
    const { mode, domaines } = resume(recu, maintenant);
    const seg = segmentEnVigueur(recu.planning, maintenant + recu.decalageMs);
    let bloque: boolean | null = null;
    let jusqua: string | null = null;
    if (m.domaine) {
      const d = decider(recu, m.domaine, maintenant, hoteDe(r.api));
      bloque = d.utilisable ? d.bloque : null;
      const fin = bloque ? finDuBlocage(recu.planning, m.domaine, maintenant + recu.decalageMs) : null;
      jusqua = fin === null ? null : new Date(fin - recu.decalageMs).toISOString();
    }
    return {
      ok: true,
      appareil: recu.planning.appareil,
      mode,
      domaines,
      bloque,
      jusqua,
      modeJusqua: seg ? new Date(Date.parse(seg.fin) - recu.decalageMs).toISOString() : null,
      sessions: seg?.sessions ?? null,
      raison: recu.planning.raison,
    };
  } catch (e) {
    const err = versErreurApi(e);
    return { ok: false, erreur: err.erreur, message: err.message };
  }
}

chrome.runtime.onMessage.addListener((m: unknown, expediteur, repondre) => {
  if (expediteur.id !== chrome.runtime.id) return false;
  const message = m as Partial<MessageRafraichir> | null;
  if (message?.type !== 'rafraichir') return false;
  void repondreRafraichir(message as MessageRafraichir).then(repondre);
  return true;
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install' && !(await lireReglages())) await chrome.runtime.openOptionsPage();
});
