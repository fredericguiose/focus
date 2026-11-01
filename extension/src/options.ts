import { infoMode } from './affichage.js';
import { ErreurApi, HOTE_PROD, type ReponseRafraichir, ecrireReglages, lireReglages, origineApi, rafraichirPlanning, versErreurApi } from './commun.js';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const formulaire = element<HTMLFormElement>('formulaire');
const champApi = element<HTMLInputElement>('api');
const champJeton = element<HTMLInputElement>('jeton');
const champAppareil = element<HTMLInputElement>('appareil');
const bouton = element<HTMLButtonElement>('enregistrer');
const zoneErreur = element<HTMLDivElement>('erreur');
const zoneSucces = element<HTMLDivElement>('succes');
const etat = element<HTMLDivElement>('etat');

function message(zone: HTMLElement, texte: string | null, code?: string) {
  zone.hidden = texte === null;
  zone.replaceChildren();
  if (texte === null) return;
  const corps = document.createElement('div');
  corps.className = 'corps';
  const t = document.createElement('span');
  t.textContent = texte;
  corps.append(t);
  if (code) {
    const c = document.createElement('code');
    c.textContent = code;
    corps.append(c);
  }
  zone.append(corps);
}

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/** Bandeau d'état : ce que le service worker a obtenu de l'API, pas ce que la page suppose. */
function afficherEtat(r: ReponseRafraichir | null) {
  const titreEtat = element('etat-titre');
  const detailEtat = element('etat-detail');
  if (!r) {
    etat.dataset.etat = 'inconnu';
    titreEtat.textContent = 'Non configurée';
    detailEtat.textContent = 'Renseignez les trois champs ci-dessous.';
  } else if (r.ok) {
    etat.dataset.etat = 'ok';
    titreEtat.textContent = `Connectée — ${r.appareil}`;
    const mode = r.mode ? infoMode(r.mode).libelle : 'aucun mode';
    detailEtat.textContent = `${mode} · ${r.domaines === 0 ? 'aucun site bloqué' : `${pluriel(r.domaines, 'site')} ${r.domaines > 1 ? 'bloqués' : 'bloqué'}`}`;
  } else {
    etat.dataset.etat = 'erreur';
    titreEtat.textContent = 'Planning inaccessible';
    detailEtat.textContent = r.message;
  }
}

async function enregistrer() {
  message(zoneErreur, null);
  message(zoneSucces, null);
  bouton.disabled = true;
  bouton.textContent = 'Vérification…';
  try {
    const api = origineApi(champApi.value);
    const { protocol, hostname } = new URL(api);
    if (hostname !== HOTE_PROD) {
      // Hôte local : autorisation à la demande (optional_host_permissions). Appelé avant tout
      // autre `await` : la demande exige le geste de l'utilisateur. Motif sans port : Chrome
      // l'applique à tous les ports de l'hôte.
      const accorde = await chrome.permissions.request({ origins: [`${protocol}//${hostname}/*`] });
      if (!accorde) throw new ErreurApi('acces_refuse', `Accès à ${api} refusé : l'extension ne pourra pas joindre l'API.`);
    }
    await ecrireReglages({ api, jeton: champJeton.value.trim(), appareil: champAppareil.value.trim() });
    champApi.value = api;
    // Le vrai chemin : le service worker relit le planning avec les réglages enregistrés.
    const r = await rafraichirPlanning();
    afficherEtat(r);
    if (!r.ok) throw new ErreurApi(r.erreur, r.message);
    message(zoneSucces, `Réglages enregistrés. Planning reçu : ${element('etat-detail').textContent}.`);
  } catch (e) {
    const err = versErreurApi(e);
    message(zoneErreur, err.message, err.erreur);
  } finally {
    bouton.disabled = false;
    bouton.textContent = 'Enregistrer et vérifier';
  }
}

formulaire.addEventListener('submit', (e) => {
  e.preventDefault();
  void enregistrer();
});

void lireReglages().then(async (r) => {
  if (!r) {
    champApi.value = `https://${HOTE_PROD}`;
    afficherEtat(null);
    return;
  }
  champApi.value = r.api;
  champJeton.value = r.jeton;
  champAppareil.value = r.appareil;
  afficherEtat(await rafraichirPlanning());
});
