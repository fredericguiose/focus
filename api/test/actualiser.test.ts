// POST /v1/actualiser : synchro Todoist forcée (code du cron), au plus une toutes les 15 s, cache
// des calculs effacé, statut frais.
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tache } from '../../core/src/types';
import { creerApp } from '../src/app';
import { CLES_STATUT } from '../src/cles-statut';
import type { Dependances } from '../src/env';
import type { ClientTodoist, ResultatFaits } from '../src/todoist';
import { Horloge, MARDI, client, creerJeton, installerConfig, tache } from './aides';

describe('POST /v1/actualiser', () => {
  const horloge = Horloge.a(MARDI.matin);
  let taches: Tache[];
  let appels = 0;
  let panne = false;
  const todoist: ClientTodoist = {
    async recupererFaits(): Promise<ResultatFaits> {
      appels++;
      if (panne) throw new Error('Todoist indisponible');
      return { idUtilisateur: '1001', taches, reports: [], suiviDeadlines: {} };
    },
    async etiquettesExistantes() {
      return ['planning', 'recap'];
    },
  };
  // Cache des calculs actif, comme dans le Worker.
  const deps: Dependances = { ...client(horloge, {}, () => todoist).deps, cacheCalculs: true };
  const app = creerApp(deps);
  const avecTodoist = { ...env, TODOIST_TOKEN: 'jeton-factice', TODOIST_UTILISATEUR: 'alice' };
  const appeler = async (methode: string, chemin: string, jeton: string, liaisons: typeof env = avecTodoist) => {
    const r = await app.request(chemin, { method: methode, headers: { Authorization: `Bearer ${jeton}` } }, liaisons);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { statut: r.status, corps: (await r.json()) as any, entetes: r.headers };
  };
  let web: string;

  beforeEach(async () => {
    horloge.regler(MARDI.matin);
    taches = [tache({ id: '1', etiquettes: ['planning'] })];
    appels = 0;
    panne = false;
    await installerConfig();
    web = await creerJeton('interface', 'web');
  });
  afterEach(() => vi.restoreAllMocks());

  it('synchronise Todoist tout de suite et renvoie le statut recalculé, champ pour champ', async () => {
    const r = await appeler('POST', '/v1/actualiser', web);
    expect(r.statut).toBe(200);
    expect(appels).toBe(1);
    expect(Object.keys(r.corps).sort()).toEqual([...CLES_STATUT].sort());
    expect(r.entetes.get('Cache-Control')).toBe('no-store');
    expect(r.corps.todoist.dernier_changement).toBe(MARDI.matin);
    const cache = await env.DB.prepare(`SELECT maj_le FROM cache_todoist WHERE utilisateur = 'alice' AND cle = 'taches'`).first<{ maj_le: string }>();
    expect(cache?.maj_le).toBe(MARDI.matin);
  });

  it('le statut gardé 60 s est effacé : une tâche cochée dans Todoist se voit aussitôt', async () => {
    await appeler('POST', '/v1/actualiser', web);
    const avant = await appeler('GET', '/v1/statut', web);
    const pc = (s: typeof avant) => s.corps.appareils.find((a: { nom: string }) => a.nom === 'pc_linux');
    expect(pc(avant).mode).toBe('MORNING_LOCK');
    // Planning fait dans Todoist ; 20 s plus tard, GET /v1/statut sert encore le résultat gardé.
    taches = [tache({ id: '1', etiquettes: ['planning'], terminee: true, termineeLe: '2026-11-03T10:00:10Z' })];
    horloge.avancer(20);
    expect(pc(await appeler('GET', '/v1/statut', web)).mode).toBe('MORNING_LOCK');
    const apres = await appeler('POST', '/v1/actualiser', web);
    expect(apres.statut).toBe(200);
    expect(appels).toBe(2);
    expect(pc(apres).mode).not.toBe('MORNING_LOCK');
    expect(pc(await appeler('GET', '/v1/statut', web)).mode).toBe(pc(apres).mode);
  });

  it('anti-abus : au plus une synchro forcée toutes les 15 s ; entre deux, le statut seulement', async () => {
    await appeler('POST', '/v1/actualiser', web);
    horloge.avancer(10);
    const r = await appeler('POST', '/v1/actualiser', web);
    expect(r.statut).toBe(200);
    expect(r.corps.heure_serveur).toBe('2026-11-03T10:00:10Z');
    expect(appels).toBe(1);
    horloge.avancer(5);
    await appeler('POST', '/v1/actualiser', web);
    expect(appels).toBe(2);
  });

  it('la synchro forcée compte pour la cadence du cron', async () => {
    await appeler('POST', '/v1/actualiser', web);
    const etat = await env.DB.prepare(`SELECT valeur FROM cache_todoist WHERE utilisateur = 'alice' AND cle = 'synchro_todoist'`).first<{ valeur: string }>();
    expect(JSON.parse(etat!.valeur)).toEqual({ tentee_le: MARDI.matin, reussie_le: MARDI.matin, erreur: null });
  });

  it('sans Todoist pour cet utilisateur : statut frais, aucun appel', async () => {
    const r = await appeler('POST', '/v1/actualiser', web, env);
    expect(r.statut).toBe(200);
    expect(appels).toBe(0);
    expect(r.corps.config_version).toBe('c0ffee1');
  });

  it('Todoist en panne : 502 todoist_indisponible', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    panne = true;
    const r = await appeler('POST', '/v1/actualiser', web);
    expect(r.statut).toBe(502);
    expect(r.corps.erreur).toBe('todoist_indisponible');
  });

  it('GET n’existe pas : 404', async () => {
    expect((await appeler('GET', '/v1/actualiser', web)).statut).toBe(404);
  });
});
