// Service worker. L'extension ne bloque pas le réseau : le client PC bloque par le fichier hosts.
// Elle garde le planning de l'appareil (GET /v1/planning, rafraîchi toutes les minutes) et décide
// localement, avec la règle du client PC (regles.ts), si le site ouvert est bloqué : si oui, elle
// remplace l'onglet par sa page. Indispensable pour les sites servis par leur propre service
// worker (YouTube) : la page s'affiche depuis le cache sans aucune erreur de navigation.
// Repli, sans planning frais : sur une erreur de navigation qui ressemble au blocage hosts, on
// demande à l'API (GET /v1/blocage) si ce domaine est bloqué.
import { type MessageRafraichir, type Reglages, type ReponseRafraichir, appeler, demanderBlocage, lireReglages, versErreurApi } from './commun.js';
import { AGE_MAX_MS, type PlanningRecu, decider, finDuBlocage, prochainePose, questionsDues, resume, segmentEnVigueur, validerPlanning } from './regles.js';

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
    void gererQuestions();
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
  if (a.name === ALARME_QUESTION) void gererQuestions();
});

async function demarrer(): Promise<void> {
  if (!(await chrome.alarms.get(ALARME))) await chrome.alarms.create(ALARME, { periodInMinutes: 1 });
  const p = await planningGarde();
  if (!p || Date.now() - p.recuLe > FRAICHEUR_REVEIL_MS) await rafraichirSiPossible();
  else await gererQuestions();
}
void demarrer();

// Nouveaux réglages : l'ancien planning (autre appareil, autre jeton) ne vaut plus rien.
chrome.storage.onChanged.addListener((changes, zone) => {
  if (zone !== 'local' || !('jeton' in changes || 'api' in changes || 'appareil' in changes)) return;
  enMemoire = null;
  void chrome.storage.session.remove(CLE_PLANNING).then(rafraichirSiPossible);
});

// ─── Questions de session ───────────────────────────────────────────────────────────────────
// Le client PC pose la question dans un dialogue système ; l'extension la pose aussi, dans une
// petite fenêtre, pour les sessions normales (pas celles à plafond propre, comme Claude Code). Une
// réponse donnée ailleurs change la question du planning : la fenêtre se ferme d'elle-même.

const ALARME_QUESTION = 'question';
/** question_id → fenêtre ouverte ; et questions déjà montrées (fermer la fenêtre ne la rouvre pas). */
const CLE_FENETRES = 'fenetresQuestions';
const CLE_VUES = 'questionsVues';
const LARGEUR_FENETRE = 440;
const HAUTEUR_FENETRE = 300;

let fileQuestions: Promise<void> = Promise.resolve();

/** Sérialisé : un rafraîchissement et l'alarme simultanés n'ouvrent pas deux fenêtres. */
function gererQuestions(): Promise<void> {
  fileQuestions = fileQuestions.then(gererQuestionsMaintenant).catch((e: unknown) => console.warn('Focus : questions :', e));
  return fileQuestions;
}

async function ouvrirFenetreQuestion(sessionId: string, questionId: string): Promise<number | undefined> {
  const page = new URL(chrome.runtime.getURL('question.html'));
  page.searchParams.set('session', sessionId);
  page.searchParams.set('question', questionId);
  let position: { left?: number; top?: number } = {};
  try {
    const w = await chrome.windows.getLastFocused();
    if (w.left !== undefined && w.top !== undefined && w.width && w.height) {
      position = { left: Math.round(w.left + (w.width - LARGEUR_FENETRE) / 2), top: Math.round(w.top + (w.height - HAUTEUR_FENETRE) / 3) };
    }
  } catch {
    // Aucune fenêtre : Chrome place la fenêtre lui-même.
  }
  const fenetre = await chrome.windows.create({ url: page.href, type: 'popup', focused: true, width: LARGEUR_FENETRE, height: HAUTEUR_FENETRE, ...position });
  return fenetre?.id;
}

async function gererQuestionsMaintenant(): Promise<void> {
  const lu = await chrome.storage.session.get([CLE_FENETRES, CLE_VUES]);
  const fenetres = { ...((lu[CLE_FENETRES] as Record<string, number> | undefined) ?? {}) };
  let vues = (lu[CLE_VUES] as string[] | undefined) ?? [];
  const recu = await planningGarde();
  const maintenant = Date.now();
  const frais = recu !== null && maintenant - recu.recuLe <= AGE_MAX_MS;
  const t = recu ? maintenant + recu.decalageMs : maintenant;
  const dues = frais ? questionsDues(recu.planning, t) : [];
  const idsDus = new Set(dues.map((d) => d.question.id));

  // Question réglée ailleurs (client PC, web app), expirée, ou planning trop vieux : on ferme.
  for (const [questionId, fenetreId] of Object.entries(fenetres)) {
    if (idsDus.has(questionId)) continue;
    delete fenetres[questionId];
    await chrome.windows.remove(fenetreId).catch(() => {});
  }
  for (const d of dues) {
    if (fenetres[d.question.id] !== undefined || vues.includes(d.question.id)) continue;
    const id = await ouvrirFenetreQuestion(d.sessionId, d.question.id);
    if (id !== undefined) fenetres[d.question.id] = id;
    vues = [...vues, d.question.id];
  }
  // Seules les questions encore présentes dans le planning restent en mémoire.
  const presentes = new Set(recu?.planning.sessions.flatMap((s) => (s.question ? [s.question.id] : [])) ?? []);
  await chrome.storage.session.set({ [CLE_FENETRES]: fenetres, [CLE_VUES]: vues.filter((v) => presentes.has(v)) });

  // Réveil à la prochaine question (le planning se relit aussi chaque minute).
  const prochaine = frais ? prochainePose(recu.planning, t) : null;
  if (prochaine === null) await chrome.alarms.clear(ALARME_QUESTION);
  else await chrome.alarms.create(ALARME_QUESTION, { when: prochaine - recu!.decalageMs });
}

chrome.windows.onRemoved.addListener((fenetreId) => {
  // Dans la même file que gererQuestions : pas d'écritures croisées dans storage.session.
  fileQuestions = fileQuestions.then(async () => {
    const lu = await chrome.storage.session.get(CLE_FENETRES);
    const fenetres = (lu[CLE_FENETRES] as Record<string, number> | undefined) ?? {};
    const restantes = Object.fromEntries(Object.entries(fenetres).filter(([, id]) => id !== fenetreId));
    if (Object.keys(restantes).length !== Object.keys(fenetres).length) await chrome.storage.session.set({ [CLE_FENETRES]: restantes });
  });
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
