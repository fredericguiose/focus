import { beforeEach, describe, expect, it } from 'vitest';
import type { Segment } from '../../core/src/types';
import { Horloge, MARDI, client, creerJeton, installerConfig, poserTaches, tache } from './aides';

describe('GET /v1/planning (format §4.3)', () => {
  const horloge = Horloge.a(MARDI.matin);
  let jeton: string;

  beforeEach(async () => {
    horloge.regler(MARDI.matin);
    await installerConfig();
    jeton = await creerJeton('appareil', 'pc_linux');
  });

  it('renvoie le planning complet, calculé par le moteur injecté', async () => {
    const segments: Segment[] = [
      {
        debut: MARDI.matin,
        fin: '2026-11-03T20:30:00Z',
        mode: 'WORK',
        sessions: 'autorisees',
        actions: { bloquer_domaines: ['youtube.com'], verrouiller_session: false, fermer_comptes_hors_travail: true },
      },
      {
        debut: '2026-11-03T20:30:00Z',
        fin: '2026-11-04T22:00:00Z',
        mode: 'NIGHT_LOCK',
        sessions: 'interdites',
        actions: { bloquer_domaines: [], verrouiller_session: true, fermer_comptes_hors_travail: false },
      },
    ];
    let horizon: number | undefined;
    const api = client(horloge, {
      planifier: (_c, appareil, h) => {
        expect(appareil).toBe('pc_linux');
        horizon = h;
        return segments;
      },
    });
    const r = await api.get('/v1/planning', jeton);
    expect(r.statut).toBe(200);
    expect(r.entetes.get('Cache-Control')).toBe('no-store');
    expect(horizon).toBe(36);
    expect(r.corps).toEqual({
      version: 1,
      appareil: 'pc_linux',
      heure_serveur: MARDI.matin,
      config_version: 'c0ffee1',
      valable_jusqua: '2026-11-04T22:00:00Z',
      comptes_de_travail: ['alice'],
      segments,
      sessions: [],
      raison: expect.any(String),
    });
  });

  it('avec le vrai moteur : segments contigus, de maintenant à valable_jusqua', async () => {
    await poserTaches([tache({ id: '1' })]);
    const r = await client(horloge).get('/v1/planning', jeton);
    const segs = r.corps.segments as Segment[];
    expect(segs[0]!.debut).toBe(MARDI.matin);
    expect(segs[0]!.mode).toBe('WORK');
    expect(segs.at(-1)!.fin).toBe(r.corps.valable_jusqua);
    for (let i = 1; i < segs.length; i++) expect(segs[i]!.debut).toBe(segs[i - 1]!.fin);
    expect(segs.find((s) => s.mode === 'NIGHT_LOCK')?.debut).toBe(MARDI.coucher);
    expect(r.corps.raison).toMatch(/^WORK/);
  });

  it("404 si l'appareil du jeton n'est pas dans la config", async () => {
    const autre = await creerJeton('appareil', 'pc_inconnu', 'pc_linux');
    const r = await client(horloge).get('/v1/planning', autre);
    expect(r.statut).toBe(404);
    expect(r.corps.erreur).toBe('appareil_inconnu');
  });

  it('503 sans config active', async () => {
    const { env } = await import('cloudflare:workers');
    await env.DB.prepare('DELETE FROM config_versions').run();
    expect((await client(horloge).get('/v1/planning', jeton)).statut).toBe(503);
  });
});

describe('statut et tâches', () => {
  const horloge = Horloge.a(MARDI.matin);
  beforeEach(async () => {
    horloge.regler(MARDI.matin);
    await installerConfig();
  });

  it('GET /v1/statut : journée, mode par appareil, dernier ping, plafond', async () => {
    const pc = await creerJeton('appareil', 'pc_linux');
    const web = await creerJeton('interface', 'web');
    const api = client(horloge);
    await api.get('/v1/planning', pc);
    const r = await api.get('/v1/statut', web);
    expect(r.statut).toBe(200);
    expect(r.corps.journee).toMatchObject({
      date: '2026-11-03',
      lever: MARDI.lever,
      ouverture: MARDI.ouverture,
      coucher_applique: MARDI.coucher,
    });
    const parNom = Object.fromEntries((r.corps.appareils as { nom: string }[]).map((a) => [a.nom, a]));
    expect(parNom.pc_linux).toMatchObject({ mode: 'WORK', sessions: 'autorisees', dernier_ping: MARDI.matin });
    expect(parNom.iphone).toMatchObject({ dernier_ping: null, actions: { bloquer_apps: expect.any(Array) } });
    expect(r.corps.sessions_du_jour).toEqual({ cumul_min: 0, plafond_min: 180 });
  });

  it("GET /v1/taches : tâches du jour à moi, avec eligible_le = création + 15 min", async () => {
    await poserTaches([
      tache({ id: '1', priorite: 'p2', contenu: 'B' }),
      tache({ id: '2', priorite: 'p1', contenu: 'A', creeeLe: '2026-11-03T09:50:00Z' }),
      tache({ id: '3', terminee: true }),
      tache({ id: '4', assigneeAMoi: false }),
      tache({ id: '5', echeance: '2026-11-05' }),
      tache({ id: '6', echeance: '2026-11-01', priorite: 'p4' }),
    ]);
    const web = await creerJeton('interface', 'web');
    const r = await client(horloge).get('/v1/taches', web);
    expect(r.corps.journee).toBe('2026-11-03');
    expect(r.corps.taches.map((t: { id: string }) => t.id)).toEqual(['2', '1', '6']);
    expect(r.corps.taches[0]).toMatchObject({ eligible_le: '2026-11-03T10:05:00Z', eligible: false });
    expect(r.corps.taches[1]).toMatchObject({ eligible: true });
  });
});
