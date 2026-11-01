import type { ApiFocus, AppBloquee, StatutAppareil } from './contrat';
import { ErreurFocus, estCorpsErreur } from './erreur';
import {
  type PrixFil,
  type StatutFil,
  type TachesFil,
  corpsExceptionVersFil,
  prixDepuisFil,
  statutDepuisFil,
  tachesDepuisFil,
} from './fil';

interface BlocageFil {
  app: { id: string; nom: string } | null;
}

const REQUETES_PARALLELES = 4;

type Methode = 'GET' | 'POST';

/** Client réel. `base` vide = même origine que la web app (le Worker sert les deux). */
export function creerApiHttp(jeton: string, base = '', recuperer: typeof fetch = fetch): ApiFocus {
  async function requete<T>(methode: Methode, chemin: string, corps?: unknown): Promise<T> {
    const entetes: Record<string, string> = { Authorization: `Bearer ${jeton}` };
    if (corps !== undefined) entetes['Content-Type'] = 'application/json';

    let reponse: Response;
    try {
      reponse = await recuperer(base + chemin, {
        method: methode,
        headers: entetes,
        body: corps === undefined ? undefined : JSON.stringify(corps),
      });
    } catch {
      throw new ErreurFocus('reseau', 'API injoignable. Vérifiez la connexion.');
    }

    const texte = await reponse.text();
    let donnees: unknown = null;
    if (texte) {
      try {
        donnees = JSON.parse(texte);
      } catch {
        donnees = null;
      }
    }

    if (!reponse.ok) {
      if (estCorpsErreur(donnees)) throw new ErreurFocus(donnees.erreur, donnees.message, reponse.status);
      throw new ErreurFocus(`http_${reponse.status}`, `Erreur HTTP ${reponse.status}.`, reponse.status);
    }
    return donnees as T;
  }

  const id = encodeURIComponent;

  /**
   * /v1/statut ne donne que les domaines (ou identifiants iPhone) bloqués ; l'app de chacun se
   * retrouve par /v1/blocage. Les cibles d'une app déjà trouvée sont quand même interrogées :
   * l'API ne dit pas quels autres domaines elle couvre.
   */
  async function appsBloquees(appareil: StatutAppareil): Promise<AppBloquee[]> {
    if (appareil.apps_bloquees) return appareil.apps_bloquees;
    const actions = appareil.actions;
    if (!actions) return [];
    const iphone = 'bloquer_apps' in actions;
    const cibles = iphone ? actions.bloquer_apps : actions.bloquer_domaines;
    const parId = new Map<string, AppBloquee>();
    let suivante = 0;
    async function travailleur() {
      while (suivante < cibles.length) {
        const cible = cibles[suivante++]!;
        const parametre = iphone ? 'bundle' : 'domaine';
        const r = await requete<BlocageFil>(
          'GET',
          `/v1/blocage?appareil=${id(appareil.appareil)}&${parametre}=${id(cible)}`,
        );
        if (!r.app) continue;
        const app = parId.get(r.app.id) ?? { id: r.app.id, nom: r.app.nom, domaines: [] };
        if (!iphone) app.domaines.push(cible);
        parId.set(app.id, app);
      }
    }
    await Promise.all(Array.from({ length: Math.min(REQUETES_PARALLELES, cibles.length) }, travailleur));
    return [...parId.values()].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }

  return {
    statut: async () => statutDepuisFil(await requete<StatutFil>('GET', '/v1/statut')),
    taches: async () => tachesDepuisFil(await requete<TachesFil>('GET', '/v1/taches')),
    appsBloquees,
    ouvrirSession: async (corps) => {
      await requete('POST', '/v1/sessions', corps);
    },
    ajouterApp: async (sessionId, app) => {
      await requete('POST', `/v1/sessions/${id(sessionId)}/apps`, { app });
    },
    repondre: async (sessionId, corps) => {
      await requete('POST', `/v1/sessions/${id(sessionId)}/reponse`, corps);
    },
    fermerSession: async (sessionId) => {
      await requete('POST', `/v1/sessions/${id(sessionId)}/fermer`);
    },
    prixException: async (corps) =>
      prixDepuisFil((await requete<{ prix: PrixFil }>('POST', '/v1/exceptions/prix', corpsExceptionVersFil(corps))).prix),
    enregistrerException: async (corps) => {
      await requete('POST', '/v1/exceptions', corpsExceptionVersFil(corps));
    },
  };
}
