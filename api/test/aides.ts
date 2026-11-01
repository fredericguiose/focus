// Outils communs : jetons, config d'exemple, faits Todoist, horloge réglable, app à requêter.
import { env } from 'cloudflare:workers';
import { moteur } from '../../core/src/index';
import type { Config, Moteur, Tache } from '../../core/src/types';
import exempleYaml from '../../config/exemple.yaml?raw';
import { creerApp } from '../src/app';
import { empreinte } from '../src/auth';
import type { Dependances, TypeJeton } from '../src/env';
import type { ClientTodoist } from '../src/todoist';

export { exempleYaml };

/** Mardi 3 novembre 2026, Europe/Paris (UTC+1) : lever 06:30, ouverture 19:30, coucher 21:30 locales. */
export const MARDI = {
  lever: '2026-11-03T05:30:00Z',
  matin: '2026-11-03T10:00:00Z',
  ouverture: '2026-11-03T18:30:00Z',
  coucher: '2026-11-03T20:30:00Z',
};

export function configExemple(): Config {
  const r = moteur.validerConfig(exempleYaml);
  if (!r.ok) throw new Error(`exemple.yaml invalide : ${r.erreurs.join(' ; ')}`);
  return r.config;
}

export async function installerConfig(config: Config = configExemple(), commit = 'c0ffee1'): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO config_versions (utilisateur, commit_id, yaml, json_normalise, recu_le, valide) VALUES (?, ?, ?, ?, ?, 1)`,
  )
    .bind(config.utilisateur, commit, exempleYaml, JSON.stringify(config), '2026-11-01T00:00:00Z')
    .run();
}

let compteur = 0;
export async function creerJeton(
  type: TypeJeton,
  nom: string,
  typeAppareil: 'pc_linux' | 'pc_windows' | 'iphone' | null = null,
  utilisateur = 'alice',
): Promise<string> {
  const jeton = `test_${type}_${nom}_${++compteur}`;
  await env.DB.prepare(
    `INSERT INTO appareils (utilisateur, nom, type_appareil, type_jeton, empreinte, cree_le) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(utilisateur, nom, type === 'appareil' ? typeAppareil ?? nom : null, type, await empreinte(jeton), '2026-11-01T00:00:00Z')
    .run();
  return jeton;
}

export function tache(p: Partial<Tache> & { id: string }): Tache {
  return {
    contenu: `Tâche ${p.id}`,
    priorite: 'p1',
    etiquettes: [],
    echeance: '2026-11-03',
    deadline: null,
    terminee: false,
    termineeLe: null,
    creeeLe: '2026-11-01T08:00:00Z',
    assigneeAMoi: true,
    ...p,
  };
}

export async function poserTaches(taches: Tache[], majLe = '2026-11-03T00:00:00Z'): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO cache_todoist (utilisateur, cle, valeur, maj_le) VALUES ('alice', 'taches', ?, ?)
     ON CONFLICT (utilisateur, cle) DO UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le`,
  )
    .bind(JSON.stringify(taches), majLe)
    .run();
}

export class Horloge {
  constructor(public t: number) {}
  static a(instant: string) {
    return new Horloge(Date.parse(instant));
  }
  regler(instant: string) {
    this.t = Date.parse(instant);
  }
  avancer(secondes: number) {
    this.t += secondes * 1000;
  }
  maintenant = () => new Date(this.t);
}

export const todoistInterdit = (): ClientTodoist => {
  throw new Error('Todoist ne doit pas être appelé dans ce test.');
};

export function client(horloge: Horloge, surcharges: Partial<Moteur> = {}, todoist: Dependances['todoist'] = todoistInterdit) {
  const deps: Dependances = { moteur: { ...moteur, ...surcharges }, maintenant: horloge.maintenant, todoist };
  const app = creerApp(deps);
  const appeler = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const headers: Record<string, string> = {};
    if (jeton) headers.Authorization = `Bearer ${jeton}`;
    if (corps !== undefined) headers['Content-Type'] = 'application/json';
    const reponse = await app.request(
      chemin,
      { method: methode, headers, ...(corps !== undefined ? { body: JSON.stringify(corps) } : {}) },
      env,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { statut: reponse.status, corps: (await reponse.json()) as any, entetes: reponse.headers };
  };
  return {
    deps,
    get: (chemin: string, jeton?: string) => appeler('GET', chemin, jeton),
    post: (chemin: string, jeton?: string, corps: unknown = {}) => appeler('POST', chemin, jeton, corps),
  };
}
