// Page affichée à la place d'un site bloqué : quelle app, quel mode, jusqu'à quand, pourquoi, puis
// les actions (ouvrir une session si le mode l'autorise, réessayer).
import { echeanceLisible, infoMode, initiale, raisonDetaillee } from './affichage.js';
import {
  ErreurApi,
  type Reglages,
  type ReponseBlocage,
  type ReponseRafraichir,
  type TacheSession,
  appeler,
  demanderBlocage,
  lireReglages,
  rafraichirPlanning,
  versErreurApi,
} from './commun.js';

const ATTENTE_OUVERTURE_S = 10;

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const titre = element<HTMLHeadingElement>('titre');
const sousTitre = element<HTMLParagraphElement>('sous-titre');
const pastilleMode = element<HTMLSpanElement>('mode');
const zonePourquoi = element<HTMLDivElement>('pourquoi');
const zoneErreur = element<HTMLDivElement>('erreur');
const zoneInfo = element<HTMLDivElement>('info');
const boutonReessayer = element<HTMLButtonElement>('reessayer');
const sectionSession = element<HTMLElement>('session');
const aideSession = element<HTMLParagraphElement>('session-aide');
const listeTaches = element<HTMLDivElement>('taches');
const boutonOuvrir = element<HTMLButtonElement>('ouvrir');
const boutonAnnuler = element<HTMLButtonElement>('annuler');
const compte = element<HTMLSpanElement>('compte');
const zoneAjout = element<HTMLDivElement>('ajout');
const boutonAjouter = element<HTMLButtonElement>('ajouter');
const zoneSucces = element<HTMLDivElement>('succes');

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

const afficherErreur = (e: ErreurApi | null) => message(zoneErreur, e ? e.message : null, e?.erreur);

// ─── Logo de l'app ──────────────────────────────────────────────────────────────────────────

/**
 * Icône du site depuis le cache de Chrome (API `_favicon`, permission `favicon`) : aucune requête
 * réseau, aucun service tiers. Chrome renvoie un globe générique quand il n'a rien : on le
 * reconnaît en le comparant à l'icône d'une adresse qui ne peut pas être en cache.
 */
async function afficherLogo(url: URL, nom: string) {
  const lettre = element<HTMLSpanElement>('lettre');
  lettre.textContent = initiale(nom);
  const favicon = (page: string) => {
    const u = new URL(chrome.runtime.getURL('/_favicon/'));
    u.searchParams.set('pageUrl', page);
    u.searchParams.set('size', '64');
    return u.href;
  };
  const octets = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());
  try {
    const generique = await octets(favicon('https://focus-sans-icone.invalid/'));
    for (const page of [url.href, `${url.origin}/`]) {
      const lien = favicon(page);
      const icone = await octets(lien);
      if (icone.length === 0 || (icone.length === generique.length && icone.every((o, i) => o === generique[i]))) continue;
      const img = element<HTMLImageElement>('logo');
      img.src = lien;
      img.hidden = false;
      lettre.hidden = true;
      return;
    }
  } catch {
    // Pas d'icône : l'initiale reste.
  }
}

// ─── Mode, échéance, raison ─────────────────────────────────────────────────────────────────

function afficherMode(mode: string | null, jusqua: string | null) {
  if (!mode) {
    pastilleMode.hidden = true;
    return;
  }
  const info = infoMode(mode);
  pastilleMode.dataset.famille = info.famille;
  pastilleMode.replaceChildren(info.libelle);
  if (jusqua) {
    const fin = document.createElement('span');
    fin.className = 'jusqua';
    fin.textContent = `jusqu'à ${echeanceLisible(new Date(jusqua), new Date())}`;
    pastilleMode.append(fin);
  }
  pastilleMode.hidden = false;
}

function afficherRaison(raison: string | null) {
  const { objectif, manques } = raisonDetaillee(raison ?? '');
  zonePourquoi.hidden = manques.length === 0;
  element('pourquoi-titre').textContent = objectif ? `Pour passer en ${objectif}` : 'Pourquoi';
  const liste = element<HTMLUListElement>('manques');
  liste.classList.toggle('seul', manques.length === 1 && !objectif);
  liste.replaceChildren(
    ...manques.map((m) => {
      const li = document.createElement('li');
      li.textContent = m;
      return li;
    }),
  );
}

// ─── Session ────────────────────────────────────────────────────────────────────────────────

function afficherTaches(taches: TacheSession[], choisir: (id: string) => void) {
  listeTaches.replaceChildren();
  if (taches.length === 0) {
    const vide = document.createElement('p');
    vide.className = 'discret vide';
    vide.textContent = 'Aucune tâche du jour : pas de session possible.';
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
    info.textContent = eligible ? t.priorite.toUpperCase() : `dès ${echeanceLisible(new Date(t.eligible_le), new Date())}`;
    ligne.append(radio, nom, info);
    listeTaches.append(ligne);
  }
}

async function preparerSession(reglages: Reglages, blocage: ReponseBlocage, app: { id: string; nom: string }, domaine: string) {
  sectionSession.hidden = false;
  aideSession.textContent = `Débloque ${app.nom} le temps d'une tâche du jour. Une question viendra vérifier qu'elle avance.`;
  boutonAjouter.textContent = `Ajouter ${app.nom} à la session ouverte`;

  let tacheId: string | null = null;
  let minuterie: number | null = null;
  let sessionOuverte: string | null = blocage.session?.id ?? null;

  const { taches } = await appeler<{ taches: TacheSession[] }>(reglages, 'GET', '/v1/taches');
  afficherTaches(taches, (id) => {
    tacheId = id;
    boutonOuvrir.disabled = false;
  });

  async function reussite(texte: string) {
    boutonOuvrir.disabled = true;
    zoneAjout.hidden = true;
    listeTaches.querySelectorAll('input').forEach((i) => (i.disabled = true));
    // Relire le planning tout de suite : l'extension cesse de rediriger sans attendre la minute.
    const r = await rafraichirPlanning(domaine);
    const debloque = r.ok && r.bloque === false;
    message(zoneSucces, `${texte} ${debloque ? `${app.nom} est débloqué` : `${app.nom} sera débloqué`} : le PC l'applique dans la minute, puis « Réessayer ».`);
    boutonReessayer.classList.add('primaire');
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
      await reussite('Session ouverte.');
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
    minuterie = window.setInterval(tic, 200);
  });
  boutonAnnuler.addEventListener('click', arreterCompte);

  // Ajouter une app à une session déjà ouverte est gratuit (§4.2) : pas d'attente.
  boutonAjouter.addEventListener('click', async () => {
    if (!sessionOuverte) return;
    boutonAjouter.disabled = true;
    afficherErreur(null);
    try {
      await appeler(reglages, 'POST', `/v1/sessions/${encodeURIComponent(sessionOuverte)}/apps`, { app: app.id });
      await reussite(`${app.nom} ajouté à la session ouverte.`);
    } catch (e) {
      afficherErreur(versErreurApi(e));
    } finally {
      boutonAjouter.disabled = false;
    }
  });
}

// ─── Réessayer ──────────────────────────────────────────────────────────────────────────────

function brancherReessayer(url: URL | null, domaine: string) {
  boutonReessayer.addEventListener('click', async () => {
    if (!url) return;
    boutonReessayer.disabled = true;
    boutonReessayer.textContent = 'Vérification…';
    const r = await rafraichirPlanning(domaine);
    // Planning illisible : on retente la page ; la détection par erreur reprend la main si besoin.
    if (!r.ok || r.bloque !== true) {
      location.href = url.href;
      return;
    }
    afficherMode(r.mode, r.modeJusqua);
    message(zoneInfo, r.jusqua ? `Toujours bloqué, jusqu'à ${echeanceLisible(new Date(r.jusqua), new Date())}.` : 'Toujours bloqué.');
    boutonReessayer.disabled = false;
    boutonReessayer.textContent = 'Réessayer';
  });
}

// ─── Démarrage ──────────────────────────────────────────────────────────────────────────────

async function demarrer() {
  const url = urlDOrigine();
  const domaine = url?.hostname.toLowerCase() ?? '';
  brancherReessayer(url, domaine);
  if (!url) {
    titre.textContent = 'Adresse manquante';
    boutonReessayer.hidden = true;
    return;
  }
  const nomProvisoire = domaine.replace(/^www\./, '');
  titre.textContent = nomProvisoire;
  sousTitre.textContent = 'Vérification…';
  void afficherLogo(url, nomProvisoire);

  const reglages = await lireReglages();
  if (!reglages) {
    sousTitre.textContent = 'Extension non configurée';
    afficherErreur(new ErreurApi('non_configuree', "Renseignez l'adresse de l'API, le jeton et l'appareil dans les options de l'extension."));
    return;
  }

  const [planning, blocage] = await Promise.all([
    rafraichirPlanning(domaine),
    demanderBlocage(reglages, domaine).catch((e: unknown) => versErreurApi(e)),
  ]);
  const detail = blocage instanceof ErreurApi ? null : blocage;
  const plan: Extract<ReponseRafraichir, { ok: true }> | null = planning.ok ? planning : null;

  const nom = detail?.app?.nom ?? nomProvisoire;
  titre.textContent = nom;
  document.title = `${nom} bloqué — Focus`;
  if (detail?.app) void afficherLogo(url, nom);

  const bloque = plan?.bloque ?? detail?.bloque ?? null;
  if (bloque === false) {
    sousTitre.textContent = "n'est pas bloqué en ce moment.";
    afficherMode(plan?.mode ?? detail?.mode ?? null, null);
    boutonReessayer.textContent = 'Ouvrir la page';
    boutonReessayer.classList.add('primaire');
    return;
  }
  sousTitre.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = domaine;
  const fin = plan?.jusqua ? ` jusqu'à ${echeanceLisible(new Date(plan.jusqua), new Date())}` : '';
  sousTitre.append(strong, ` est bloqué par Focus${fin}.`);
  afficherMode(plan?.mode ?? detail?.mode ?? null, plan?.modeJusqua ?? null);
  afficherRaison(plan?.raison ?? detail?.raison ?? null);

  if (!plan && !detail) {
    afficherErreur(blocage instanceof ErreurApi ? blocage : new ErreurApi(planning.ok ? 'inattendue' : planning.erreur, planning.ok ? '' : planning.message));
    return;
  }
  const sessions = plan?.sessions ?? detail?.sessions ?? null;
  if (sessions === 'interdites') {
    element('sessions-interdites').hidden = false;
  } else if (detail?.app && sessions === 'autorisees') {
    try {
      await preparerSession(reglages, detail, detail.app, domaine);
    } catch (e) {
      afficherErreur(versErreurApi(e));
    }
  }
}

void demarrer();
