import { ErreurApi, demanderBlocage, ecrireReglages, lireReglages, origineApi, versErreurApi } from './commun.js';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const formulaire = element<HTMLFormElement>('formulaire');
const champApi = element<HTMLInputElement>('api');
const champJeton = element<HTMLInputElement>('jeton');
const champAppareil = element<HTMLInputElement>('appareil');
const bouton = element<HTMLButtonElement>('enregistrer');
const zoneErreur = element<HTMLParagraphElement>('erreur');
const zoneSucces = element<HTMLParagraphElement>('succes');

function afficherErreur(e: ErreurApi | null) {
  zoneErreur.hidden = e === null;
  zoneErreur.replaceChildren();
  if (!e) return;
  const code = document.createElement('code');
  code.textContent = e.erreur;
  zoneErreur.append(e.message, code);
}

async function enregistrer() {
  afficherErreur(null);
  zoneSucces.hidden = true;
  bouton.disabled = true;
  try {
    const api = origineApi(champApi.value);
    // Appelé en premier : la demande d'autorisation exige le geste de l'utilisateur.
    // Motif sans port : Chrome l'applique à tous les ports de l'hôte.
    const { protocol, hostname } = new URL(api);
    const accorde = await chrome.permissions.request({ origins: [`${protocol}//${hostname}/*`] });
    if (!accorde) throw new ErreurApi('acces_refuse', `Accès à ${api} refusé : l'extension ne pourra pas interroger l'API.`);
    const reglages = { api, jeton: champJeton.value.trim(), appareil: champAppareil.value.trim() };
    // Vérifie à la fois le jeton et le nom de l'appareil (404 « appareil_inconnu » sinon).
    await demanderBlocage(reglages, 'verification.invalid');
    await ecrireReglages(reglages);
    champApi.value = api;
    zoneSucces.textContent = 'Réglages enregistrés et vérifiés auprès de l’API.';
    zoneSucces.hidden = false;
  } catch (e) {
    afficherErreur(versErreurApi(e));
  } finally {
    bouton.disabled = false;
  }
}

formulaire.addEventListener('submit', (e) => {
  e.preventDefault();
  void enregistrer();
});

void lireReglages().then((r) => {
  if (!r) return;
  champApi.value = r.api;
  champJeton.value = r.jeton;
  champAppareil.value = r.appareil;
});
