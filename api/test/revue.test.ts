// Revue du 01/11 : cache de 60 s (statut, planning), une seule source lourde par invocation du
// cron, verrou de la synchro Xiaomi, rattrapage Hevy en plusieurs passes.
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Tache } from '../../core/src/types';
import { creerApp } from '../src/app';
import type { Dependances } from '../src/env';
import { type ClientHevy, PAGES_PAR_PASSAGE_HEVY, type SeanceHevy, synchroniserSeances } from '../src/hevy';
import { executerTachesPlanifiees } from '../src/planifie';
import { reglagesXiaomi, synchroniserSommeil } from '../src/sommeil';
import type { ClientTodoist } from '../src/todoist';
import type { ClientXiaomi } from '../src/xiaomi';
import { Horloge, client, creerJeton, installerConfig, poserTaches, tache } from './aides';

const RAISON = 'Une raison suffisamment longue pour dépasser les cinquante caractères.';

describe('cache de 60 s du statut et du planning', () => {
  const horloge = Horloge.a('2026-11-03T10:00:00Z');
  let calculs = 0;
  const base = client(horloge, {
    // Compte les calculs complets : le planning appelle `planifier` pour son appareil.
    planifier: (...a) => {
      calculs++;
      return client(horloge).deps.moteur.planifier(...a);
    },
  }).deps;
  const deps: Dependances = { ...base, cacheCalculs: true };
  const app = creerApp(deps);
  const appeler = async (methode: string, chemin: string, jeton: string, corps?: unknown) => {
    const r = await app.request(
      chemin,
      { method: methode, headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' }, ...(corps ? { body: JSON.stringify(corps) } : {}) },
      env,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { statut: r.status, corps: (await r.json()) as any };
  };
  let pc: string;
  let web: string;

  beforeEach(async () => {
    horloge.regler('2026-11-03T10:00:00Z');
    calculs = 0;
    await installerConfig();
    pc = await creerJeton('appareil', 'pc_linux', 'pc_linux');
    web = await creerJeton('interface', 'web');
  });

  it('planning : recalculé au plus une fois par minute ; heure_serveur toujours exacte', async () => {
    const a = await appeler('GET', '/v1/planning', pc);
    expect(calculs).toBe(1);
    horloge.avancer(30);
    const b = await appeler('GET', '/v1/planning', pc);
    expect(calculs).toBe(1);
    expect(b.corps.heure_serveur).toBe('2026-11-03T10:00:30Z');
    expect({ ...b.corps, heure_serveur: null }).toEqual({ ...a.corps, heure_serveur: null });
    horloge.avancer(30);
    await appeler('GET', '/v1/planning', pc);
    expect(calculs).toBe(2);
  });

  it('jamais gardé au-delà de la prochaine bascule (fin du premier segment)', async () => {
    horloge.regler('2026-11-03T20:29:40Z'); // coucher à 20:30
    expect((await appeler('GET', '/v1/planning', pc)).corps.segments[0].mode).not.toBe('NIGHT_LOCK');
    horloge.regler('2026-11-03T20:30:00Z');
    expect((await appeler('GET', '/v1/planning', pc)).corps.segments[0].mode).toBe('NIGHT_LOCK');
  });

  it('une écriture (exception) efface le cache de l\'utilisateur : statut et planning recalculés', async () => {
    const avant = await appeler('GET', '/v1/statut', web);
    await appeler('GET', '/v1/planning', pc);
    const n = calculs;
    const r = await appeler('POST', '/v1/exceptions', web, { type: 'coucher', nuit: '2026-11-03', heure: '22:00', raison: RAISON });
    expect(r.statut).toBe(201);
    const apres = await appeler('GET', '/v1/statut', web);
    expect(apres.corps.journee.coucher_applique).not.toBe(avant.corps.journee.coucher_applique);
    expect(apres.corps.journee.coucher_applique).toBe('2026-11-03T21:00:00Z');
    await appeler('GET', '/v1/planning', pc);
    expect(calculs).toBeGreaterThan(n);
  });

  it('un résultat calculé pendant une écriture n\'est pas gardé (génération)', async () => {
    const { lireCalcul, ecrireCalcul, invaliderCache } = await import('../src/cache');
    const t = new Date('2026-11-03T10:00:00Z');
    const lu = await lireCalcul(env.DB, 'alice', 'statut', t);
    await invaliderCache(env.DB, 'alice'); // écriture concurrente
    await ecrireCalcul(env.DB, 'alice', 'statut', lu.generation, { perime: true }, t);
    expect((await lireCalcul(env.DB, 'alice', 'statut', t)).valeur).toBeNull();
  });
});

describe('tâche planifiée : une seule source lourde par invocation, à sa cadence', () => {
  const horloge = Horloge.a('2026-11-03T10:00:00Z');
  let appels: string[];
  const todoist = (): ClientTodoist => ({
    async recupererFaits() {
      appels.push('todoist');
      return { idUtilisateur: '1', taches: [tache({ id: '1' }) as Tache], reports: [], suiviDeadlines: {} };
    },
    async etiquettesExistantes() {
      return ['planning', 'recap'];
    },
  });
  const xiaomi = (): ClientXiaomi => ({
    passTokenRecu: () => null,
    async sessionsSommeil() {
      appels.push('xiaomi');
      return [];
    },
  });
  const hevy = (): ClientHevy => ({
    async seances() {
      appels.push('hevy');
      return [];
    },
  });
  const secrets = {
    TODOIST_TOKEN: 't', TODOIST_UTILISATEUR: 'alice',
    XIAOMI_USER_ID: '42', XIAOMI_PASS_TOKEN: 'p', XIAOMI_UTILISATEUR: 'alice', XIAOMI_DEPUIS: '2026-11-01',
    HEVY_API_KEY: 'h', HEVY_UTILISATEUR: 'alice',
  };

  beforeEach(async () => {
    horloge.regler('2026-11-03T10:00:00Z');
    appels = [];
    await installerConfig();
  });

  it('sur 2 h : jamais deux sources dans la même minute ; Todoist ~2 min, Xiaomi ~15 min, Hevy ~1 h', async () => {
    const deps = { ...client(horloge, {}, todoist).deps, xiaomi, hevy };
    const parMinute: string[][] = [];
    for (let m = 0; m < 120; m++) {
      const avant = appels.length;
      await executerTachesPlanifiees({ ...env, ...secrets }, deps);
      parMinute.push([...new Set(appels.slice(avant))]);
      horloge.avancer(60);
    }
    expect(parMinute.every((sources) => sources.length <= 1)).toBe(true);
    const compte = (s: string) => parMinute.filter((x) => x.includes(s)).length;
    expect(compte('todoist')).toBeGreaterThanOrEqual(55);
    expect(compte('todoist')).toBeLessThanOrEqual(60);
    expect(compte('xiaomi')).toBe(8);
    expect(compte('hevy')).toBe(2);
  });
});

describe('synchro Xiaomi : verrou contre deux passages simultanés', () => {
  it('deux crons en même temps : un seul lit Xiaomi (et fait tourner le passToken)', async () => {
    await installerConfig();
    let lectures = 0;
    let liberer: () => void = () => {};
    const attente = new Promise<void>((ok) => (liberer = ok));
    const fabrique = (): ClientXiaomi => ({
      passTokenRecu: () => null,
      async sessionsSommeil() {
        lectures++;
        await attente;
        return [];
      },
    });
    const reglages = reglagesXiaomi({ DB: env.DB, XIAOMI_USER_ID: '42', XIAOMI_PASS_TOKEN: 'p', XIAOMI_UTILISATEUR: 'alice', XIAOMI_DEPUIS: '2026-11-01' })!;
    const t = new Date('2026-11-03T10:00:00Z');
    const premier = synchroniserSommeil(env.DB, fabrique, reglages, t, true);
    await new Promise((ok) => setTimeout(ok, 20));
    const second = await synchroniserSommeil(env.DB, fabrique, reglages, t, true);
    expect(second).toBeNull();
    liberer();
    expect(await premier).not.toBeNull();
    expect(lectures).toBe(1);
    // Verrou rendu : le passage suivant lit.
    await synchroniserSommeil(env.DB, fabrique, reglages, new Date('2026-11-03T10:01:00Z'), true);
    expect(lectures).toBe(2);
  });
});

describe('synchro Hevy : rattrapage en plusieurs passes', () => {
  it('au plus 10 pages par passage, reprise à la page suivante, rien d\'effacé avant la fin', async () => {
    await installerConfig();
    const toutes: SeanceHevy[] = Array.from({ length: 250 }, (_, i) => ({
      id: `w${i}`,
      debut: new Date(Date.parse('2026-11-03T08:00:00Z') - i * 7 * 3_600_000).toISOString().replace('.000Z', 'Z'),
      fin: new Date(Date.parse('2026-11-03T09:00:00Z') - i * 7 * 3_600_000).toISOString().replace('.000Z', 'Z'),
      titre: '',
    }));
    const pages: number[] = [];
    const fabrique = (): ClientHevy => ({
      seances: async () => {
        throw new Error('lecture complète interdite ici');
      },
      async seancesParPages(depuis, premiere, max) {
        const res: SeanceHevy[] = [];
        for (let n = premiere; n < premiere + max; n++) {
          pages.push(n);
          const page = toutes.slice((n - 1) * 10, n * 10);
          res.push(...page.filter((s) => Date.parse(s.debut) >= depuis.getTime()));
          if (page.length === 0 || page.some((s) => Date.parse(s.debut) < depuis.getTime())) return { seances: res, complet: true, suivante: n + 1 };
        }
        return { seances: res, complet: false, suivante: premiere + max };
      },
    });
    const reglages = { cle: 'h', utilisateur: 'alice' };
    let t = Date.parse('2026-11-03T10:00:00Z');
    const e1 = await synchroniserSeances(env.DB, fabrique, reglages, new Date(t));
    expect(pages).toHaveLength(PAGES_PAR_PASSAGE_HEVY);
    expect(e1).toMatchObject({ reussie_le: null, rattrapage: { page: 11 } });
    t += 60_000;
    const e2 = await synchroniserSeances(env.DB, fabrique, reglages, new Date(t));
    expect(pages.slice(10)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(e2).toMatchObject({ reussie_le: null, rattrapage: { page: 21 } });
    t += 60_000;
    const e3 = await synchroniserSeances(env.DB, fabrique, reglages, new Date(t));
    expect(pages.slice(20)).toEqual([21]);
    expect(e3).toMatchObject({ reussie_le: '2026-11-03T10:02:00Z', rattrapage: null });
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM mesures WHERE type = 'seance'`).first<{ n: number }>();
    expect(n!.n).toBe(toutes.filter((s) => s.debut >= '2026-09-04T10:00:00Z').length);
  });
});

describe('fermeture par le cron d\'une session dont le mode interdit les sessions', () => {
  it('la nuit commence : le cron la ferme au coucher, sans requête de client', async () => {
    const horloge = Horloge.a('2026-11-03T19:00:00Z');
    await installerConfig();
    await poserTaches([tache({ id: 't1' })]);
    const tel = await creerJeton('appareil', 'iphone', 'iphone');
    const api = client(horloge);
    const o = await api.post('/v1/sessions', tel, { tache_id: 't1', apps: ['youtube'] });
    expect(o.statut).toBe(201);
    await env.DB.prepare(`UPDATE questions SET expire_a = '2026-11-04T00:00:00Z'`).run(); // question qui n'expire pas d'ici là
    horloge.regler('2026-11-03T20:31:00Z');
    await executerTachesPlanifiees(env, api.deps);
    const ligne = await env.DB.prepare('SELECT fermee_le, motif_fin FROM sessions').first();
    expect(ligne).toEqual({ fermee_le: '2026-11-03T20:30:00Z', motif_fin: 'mode_interdit' });
  });
});
