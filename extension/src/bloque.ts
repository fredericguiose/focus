import {
  ErreurApi,
  type Reglages,
  type ReponseBlocage,
  type TacheSession,
  appeler,
  demanderBlocage,
  lireReglages,
  versErreurApi,
} from './commun.js';

const ATTENTE_OUVERTURE_S = 10;

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const titre = element<HTMLHeadingElement>('titre');
const zoneErreur = element<HTMLParagraphElement>('erreur');
const detail = element<HTMLElement>('detail');
const sectionSession = element<HTMLElement>('session');
const aideSession = element<HTMLParagraphElement>('session-aide');
const listeTaches = element<HTMLDivElement>('taches');
const boutonOuvrir = element<HTMLButtonElement>('ouvrir');
const boutonAnnuler = element<HTMLButtonElement>('annuler');
const compte = element<HTMLSpanElement>('compte');
const zoneAjout = element<HTMLDivElement>('ajout');
const boutonAjouter = element<HTMLButtonElement>('ajouter');
const zoneSucces = element<HTMLParagraphElement>('succes');

/** Seules les adresses web sont rouvertes : jamais un `javascript:` venu de l'URL de la page. */
function urlDOrigine(): URL | null {
  const brute = new URLSearchParams(location.search).get('url');
  if (!brute) return null;
  try {
    const url = new URL(brute);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function afficherErreur(e: ErreurApi | null) {
  zoneErreur.hidden = e === null;
  zoneErreur.replaceChildren();
  if (!e) return;
  const code = document.createElement('code');
  code.textContent = e.erreur;
  zoneErreur.append(e.message, code);
}

function remplir(id: string, texte: string) {
  element(id).textContent = texte;
}

const heure = (instant: string) => new Date(instant).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function afficherTaches(taches: TacheSession[], choisir: (id: string) => void) {
  listeTaches.replaceChildren();
  if (taches.length === 0) {
    const vide = document.createElement('p');
    vide.className = 'discret';
    vide.textContent = 'Aucune tâche du jour.';
    listeTaches.append(vide);
    return;
  }
  const maintenant = Date.now();
  for (const t of taches) {
    const eligible = Date.parse(t.eligible_le) <= maintenant;
    const ligne = document.createElement('label');
    if (!eligible) ligne.className = 'inactive';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'tache';
    radio.value = t.id;
    radio.disabled = !eligible;
    radio.addEventListener('change', () => choisir(t.id));
    const nom = document.createElement('span');
    nom.className = 'nom';
    nom.textContent = t.nom;
    const info = document.createElement('span');
    info.className = 'info';
    info.textContent = eligible ? t.priorite.toUpperCase() : `éligible à ${heure(t.eligible_le)}`;
    ligne.append(radio, nom, info);
    listeTaches.append(ligne);
  }
}

async function preparerSession(reglages: Reglages, blocage: ReponseBlocage, app: { id: string; nom: string }) {
  sectionSession.hidden = false;
  aideSession.textContent = `Débloque ${app.nom} sur ${reglages.appareil} pour une tâche du jour. Une question viendra vérifier que la tâche avance.`;
  boutonAjouter.textContent = `Ajouter ${app.nom} à la session ouverte`;

  let tacheId: string | null = null;
  let minuterie: number | null = null;
  let sessionOuverte: string | null = blocage.session?.id ?? null;

  const { taches } = await appeler<{ taches: TacheSession[] }>(reglages, 'GET', '/v1/taches');
  afficherTaches(taches, (id) => {
    tacheId = id;
    boutonOuvrir.disabled = false;
  });

  function reussite(message: string) {
    zoneSucces.textContent = message;
    zoneSucces.hidden = false;
    boutonOuvrir.disabled = true;
    zoneAjout.hidden = true;
    listeTaches.querySelectorAll('input').forEach((i) => (i.disabled = true));
  }

  function arreterCompte() {
    if (minuterie !== null) clearInterval(minuterie);
    minuterie = null;
    compte.textContent = '';
    boutonAnnuler.hidden = true;
    boutonOuvrir.hidden = false;
  }

  async function envoyer() {
    if (!tacheId) return;
    boutonOuvrir.disabled = true;
    try {
      await appeler(reglages, 'POST', '/v1/sessions', { appareil: reglages.appareil, tache_id: tacheId, apps: [app.id] });
      reussite("Session ouverte. Le PC l'applique à son prochain planning (une minute au plus), puis « Réessayer la page ».");
    } catch (e) {
      const erreur = versErreurApi(e);
      afficherErreur(erreur);
      boutonOuvrir.disabled = false;
      if (erreur.erreur === 'session_deja_ouverte' && typeof erreur.details.session_id === 'string') {
        sessionOuverte = erreur.details.session_id;
        zoneAjout.hidden = false;
      }
    }
  }

  boutonOuvrir.addEventListener('click', () => {
    afficherErreur(null);
    const echeance = Date.now() + ATTENTE_OUVERTURE_S * 1000;
    boutonOuvrir.hidden = true;
    boutonAnnuler.hidden = false;
    const tic = () => {
      const restant = Math.max(0, Math.ceil((echeance - Date.now()) / 1000));
      compte.textContent = `Envoi dans ${restant} s…`;
      if (restant === 0) {
        arreterCompte();
        void envoyer();
      }
    };
    tic();
    minuterie = setInterval(tic, 200);
  });
  boutonAnnuler.addEventListener('click', arreterCompte);

  // Ajouter une app à une session déjà ouverte est gratuit (§4.2) : pas d'attente.
  boutonAjouter.addEventListener('click', async () => {
    if (!sessionOuverte) return;
    boutonAjouter.disabled = true;
    afficherErreur(null);
    try {
      await appeler(reglages, 'POST', `/v1/sessions/${encodeURIComponent(sessionOuverte)}/apps`, { app: app.id });
      reussite(`${app.nom} ajouté à la session ouverte. Le PC l'applique à son prochain planning (une minute au plus).`);
    } catch (e) {
      afficherErreur(versErreurApi(e));
    } finally {
      boutonAjouter.disabled = false;
    }
  });
}

async function demarrer() {
  const url = urlDOrigine();
  element<HTMLButtonElement>('reessayer').addEventListener('click', () => {
    if (url) location.href = url.href;
  });
  const reglages = await lireReglages();
  if (!reglages) {
    titre.textContent = 'Extension non configurée';
    afficherErreur(new ErreurApi('non_configuree', "Renseignez l'adresse de l'API, le jeton et l'appareil dans les options de l'extension."));
    return;
  }
  if (!url) {
    titre.textContent = 'Adresse manquante';
    return;
  }
  const domaine = url.hostname.toLowerCase();
  remplir('domaine', domaine);
  try {
    const blocage = await demanderBlocage(reglages, domaine);
    detail.hidden = false;
    remplir('app', blocage.app?.nom ?? 'hors catalogue');
    remplir('mode', blocage.mode);
    remplir('raison', blocage.raison);
    if (!blocage.bloque) {
      titre.textContent = "Ce site n'est pas bloqué par Focus";
      return;
    }
    titre.textContent = `${domaine} est bloqué`;
    document.title = `${domaine} bloqué — Focus`;
    if (blocage.sessions === 'autorisees' && blocage.app) {
      await preparerSession(reglages, blocage, blocage.app);
    }
  } catch (e) {
    titre.textContent = 'Réponse de Focus impossible';
    afficherErreur(versErreurApi(e));
  }
}

void demarrer();
