// Fenêtre de question de session, ouverte par le service worker à `posee_a` (sessions normales
// seulement). Même comportement que la web app : « J'arrête » tout de suite, « Je continue » après
// `attente_s`. Elle se ferme si la question disparaît du planning (réponse donnée ailleurs).
import { ErreurApi, appeler, lireReglages, rafraichirPlanning, versErreurApi } from './commun.js';
import { type PlanningRecu, type QuestionPlanning, etatQuestion } from './regles.js';

const CLE_PLANNING = 'planning';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const titre = element<HTMLHeadingElement>('titre');
const echeance = element<HTMLParagraphElement>('echeance');
const zoneErreur = element<HTMLDivElement>('erreur');
const boutonArrete = element<HTMLButtonElement>('arrete');
const boutonContinue = element<HTMLButtonElement>('continue');

const params = new URLSearchParams(location.search);
const sessionId = params.get('session') ?? '';
const questionId = params.get('question') ?? '';

let question: QuestionPlanning | null = null;
let decalageMs = 0;
let envoi = false;

function afficherErreur(e: ErreurApi | null) {
  zoneErreur.hidden = e === null;
  zoneErreur.textContent = e?.message ?? '';
}

function formaterSecondes(s: number): string {
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m} min` : `${m} min ${r} s`;
}

/** Relit le planning gardé par le service worker ; false si la question n'y attend plus. */
async function lirePlanning(): Promise<boolean> {
  const lu = await chrome.storage.session.get(CLE_PLANNING);
  const recu = lu[CLE_PLANNING] as PlanningRecu | undefined;
  const s = recu?.planning.sessions.find((x) => x.id === sessionId);
  if (!recu || !s || s.question?.id !== questionId) return false;
  question = s.question;
  decalageMs = recu.decalageMs;
  titre.textContent = s.tache ? `Toujours sur « ${s.tache.nom} » ?` : 'Toujours en session ?';
  document.title = `${titre.textContent} — Focus`;
  return true;
}

function tic() {
  if (!question) return;
  const e = etatQuestion(question, Date.now() + decalageMs);
  if (e.expiree) {
    echeance.textContent = 'Question expirée : la session est fermée.';
    boutonContinue.disabled = true;
    boutonArrete.disabled = true;
    return;
  }
  echeance.textContent = `Sans réponse, la session se ferme dans ${formaterSecondes(e.avantExpirationS)}.`;
  boutonContinue.disabled = !e.peutContinuer || envoi;
  boutonContinue.textContent = e.peutContinuer ? 'Je continue' : `Je continue (${e.avantContinuerS} s)`;
}

async function repondre(reponse: 'continue' | 'arrete') {
  const reglages = await lireReglages();
  if (!reglages) {
    afficherErreur(new ErreurApi('non_configuree', "Extension non configurée : voir ses options."));
    return;
  }
  envoi = true;
  boutonArrete.disabled = true;
  afficherErreur(null);
  tic();
  try {
    await appeler(reglages, 'POST', `/v1/sessions/${encodeURIComponent(sessionId)}/reponse`, { question_id: questionId, reponse });
    // Le planning relu, la question n'y est plus : le service worker n'en rouvre pas.
    await rafraichirPlanning();
    window.close();
  } catch (e) {
    afficherErreur(versErreurApi(e));
    envoi = false;
    boutonArrete.disabled = false;
    tic();
  }
}

boutonArrete.addEventListener('click', () => void repondre('arrete'));
boutonContinue.addEventListener('click', () => void repondre('continue'));

// Réponse donnée ailleurs (client PC, web app) : la question quitte le planning, on ferme.
chrome.storage.onChanged.addListener((changes, zone) => {
  if (zone !== 'session' || !(CLE_PLANNING in changes) || envoi) return;
  void lirePlanning().then((encore) => {
    if (!encore) window.close();
  });
});

void lirePlanning().then((encore) => {
  if (!encore) {
    window.close();
    return;
  }
  tic();
  setInterval(tic, 250);
});
