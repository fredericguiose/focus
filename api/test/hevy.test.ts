import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { type ClientHevy, creerClientHevy, debutDeLecture, ErreurHevy, type SeanceHevy } from '../src/hevy';
import { executerTachesPlanifiees } from '../src/planifie';
import { Horloge, client, configExemple, creerJeton, installerConfig } from './aides';

const CLE = 'cle-factice';
const workout = (id: string, start: string, minutes = 60) => ({
  id,
  title: `Séance ${id}`,
  start_time: start,
  end_time: new Date(Date.parse(start) + minutes * 60_000).toISOString(),
  exercises: [],
});

/** Faux serveur Hevy : `workouts` du plus récent au plus ancien, 10 par page. */
function fauxServeur(workouts: ReturnType<typeof workout>[], statut = 200) {
  const appels: { url: string; cle: string | null }[] = [];
  const f = async (url: string, init: RequestInit) => {
    appels.push({ url, cle: new Headers(init.headers).get('api-key') });
    if (statut !== 200) return new Response('{}', { status: statut });
    const page = Number(new URL(url).searchParams.get('page'));
    const page_count = Math.max(1, Math.ceil(workouts.length / 10));
    if (page > page_count) return new Response('{}', { status: 404 });
    return Response.json({ page, page_count, workouts: workouts.slice((page - 1) * 10, page * 10) });
  };
  return { f, appels };
}

describe('client Hevy', () => {
  const recentes = Array.from({ length: 25 }, (_, i) => workout(`w${i}`, new Date(Date.parse('2026-11-03T08:00:00Z') - i * 86_400_000).toISOString()));

  it('clé en en-tête, pagination jusqu\'à la première page qui sort de la période', async () => {
    const s = fauxServeur(recentes);
    const seances = await creerClientHevy({ cle: CLE, fetch: s.f }).seances(new Date('2026-10-20T00:00:00Z'));
    expect(seances).toHaveLength(15);
    expect(seances[0]).toEqual({ id: 'w0', debut: '2026-11-03T08:00:00Z', fin: '2026-11-03T09:00:00Z', titre: 'Séance w0' });
    expect(s.appels.map((a) => new URL(a.url).search)).toEqual(['?page=1&pageSize=10', '?page=2&pageSize=10']);
    expect(s.appels.every((a) => a.cle === CLE)).toBe(true);
  });

  it('dernière page atteinte, compte vide', async () => {
    expect(await creerClientHevy({ cle: CLE, fetch: fauxServeur(recentes).f }).seances(new Date('2020-01-01T00:00:00Z'))).toHaveLength(25);
    expect(await creerClientHevy({ cle: CLE, fetch: fauxServeur([]).f }).seances(new Date('2020-01-01T00:00:00Z'))).toEqual([]);
  });

  it('clé refusée, panne, réponse illisible : erreur codée, sans la clé', async () => {
    const erreur = (statut: number) => creerClientHevy({ cle: CLE, fetch: fauxServeur([], statut).f }).seances(new Date(0)).catch((e) => e);
    const refus = await erreur(401);
    expect(refus).toBeInstanceOf(ErreurHevy);
    expect(refus.code).toBe('cle_hevy_refusee');
    expect(String(refus.message)).not.toContain(CLE);
    expect((await erreur(500)).code).toBe('hevy_indisponible');
    const illisible = await creerClientHevy({ cle: CLE, fetch: async () => Response.json({ workouts: [{ id: 'x' }] }) }).seances(new Date(0)).catch((e) => e);
    expect(illisible.code).toBe('hevy_reponse_invalide');
  });
});

describe('période relue', () => {
  const t = new Date('2026-11-03T10:00:00Z');
  it('premier passage : 60 jours ; ensuite 7 jours, ou depuis la dernière réussite moins un jour', () => {
    expect(debutDeLecture(undefined, t).toISOString()).toBe('2026-09-04T10:00:00.000Z');
    const etat = (reussie_le: string | null) => ({ tentee_le: '2026-11-03T09:00:00Z', reussie_le, erreur: null, seances: 0 });
    expect(debutDeLecture(etat('2026-11-03T09:00:00Z'), t).toISOString()).toBe('2026-10-27T10:00:00.000Z');
    expect(debutDeLecture(etat('2026-10-20T09:00:00Z'), t).toISOString()).toBe('2026-10-19T09:00:00.000Z');
    expect(debutDeLecture(etat('2026-01-01T00:00:00Z'), t).toISOString()).toBe('2026-09-04T10:00:00.000Z');
  });
});

describe('synchro des séances (tâche planifiée)', () => {
  const horloge = Horloge.a('2026-11-03T10:00:00Z');
  const deps = client(horloge).deps;
  let seances: SeanceHevy[] = [];
  let lectures: Date[] = [];
  let panne: Error | null = null;
  const fabrique = (): ClientHevy => ({
    async seances(depuis) {
      lectures.push(depuis);
      if (panne) throw panne;
      return seances.filter((s) => Date.parse(s.debut) >= depuis.getTime());
    },
  });
  const lancer = (secrets: Record<string, string> = { HEVY_API_KEY: CLE, HEVY_UTILISATEUR: 'alice' }) =>
    executerTachesPlanifiees({ ...env, ...secrets }, { ...deps, hevy: fabrique });
  const lignes = () =>
    env.DB.prepare(`SELECT cle, debut, fin, valeur, details FROM mesures WHERE type = 'seance' AND source = 'hevy' ORDER BY debut`).all<{
      cle: string;
      debut: string;
      fin: string;
      valeur: number;
      details: string;
    }>();

  beforeEach(async () => {
    horloge.regler('2026-11-03T10:00:00Z');
    seances = [
      { id: 'a', debut: '2026-11-02T05:00:00Z', fin: '2026-11-02T06:15:00Z', titre: 'Jambes' },
      { id: 'b', debut: '2026-10-01T05:00:00Z', fin: '2026-10-01T06:00:00Z', titre: 'Dos' },
    ];
    lectures = [];
    panne = null;
    await installerConfig();
  });

  it('sans clé ou pour un autre utilisateur : sautée', async () => {
    await lancer({});
    await lancer({ HEVY_API_KEY: CLE, HEVY_UTILISATEUR: 'bob' });
    expect(lectures).toHaveLength(0);
  });

  it('premier passage sur 60 jours, puis une fois par heure sur 7 jours ; idempotent', async () => {
    await lancer();
    expect(lectures[0]!.toISOString()).toBe('2026-09-04T10:00:00.000Z');
    expect((await lignes()).results).toEqual([
      { cle: 'b', debut: '2026-10-01T05:00:00Z', fin: '2026-10-01T06:00:00Z', valeur: 60, details: '{"titre":"Dos"}' },
      { cle: 'a', debut: '2026-11-02T05:00:00Z', fin: '2026-11-02T06:15:00Z', valeur: 75, details: '{"titre":"Jambes"}' },
    ]);
    horloge.avancer(1800);
    await lancer();
    expect(lectures).toHaveLength(1);
    horloge.avancer(1800);
    await lancer();
    expect(lectures[1]!.toISOString()).toBe('2026-10-27T11:00:00.000Z');
    expect((await lignes()).results).toHaveLength(2);
  });

  it('séance modifiée mise à jour, séance supprimée de la période effacée', async () => {
    await lancer();
    seances = [{ id: 'a', debut: '2026-11-02T05:00:00Z', fin: '2026-11-02T06:30:00Z', titre: 'Jambes' }, seances[1]!];
    horloge.avancer(3600);
    await lancer();
    expect((await lignes()).results.map((l) => [l.cle, l.valeur])).toEqual([['b', 60], ['a', 90]]);
    seances = [seances[1]!];
    horloge.avancer(3600);
    await lancer();
    expect((await lignes()).results.map((l) => l.cle)).toEqual(['b']);
  });

  it('clé refusée : erreur notée dans le statut, relancée l\'heure suivante', async () => {
    panne = new ErreurHevy('cle_hevy_refusee', 'clé refusée');
    await expect(lancer()).rejects.toThrow();
    const web = await creerJeton('interface', 'web');
    const r = await client(horloge).get('/v1/statut', web);
    expect(r.corps.seances_mesurees).toEqual({ derniere_synchro: null, erreur: 'cle_hevy_refusee' });
  });
});

// Exemple (Europe/Paris) : sport lun/mer/ven, vérifié par une séance.
describe('GET /v1/statut : engagements vérifiés', () => {
  it('7 derniers jours, aujourd\'hui et la fin de la semaine ; sautés de la semaine', async () => {
    const horloge = Horloge.a('2026-11-06T15:00:00Z'); // vendredi 16:00
    await installerConfig(configExemple());
    await env.DB.prepare(
      `INSERT INTO mesures (utilisateur, type, source, cle, debut, fin, valeur, recu_le) VALUES
       ('alice', 'seance', 'hevy', 'a', '2026-11-02T05:10:00Z', '2026-11-02T06:10:00Z', 60, '2026-11-02T07:00:00Z'),
       ('alice', 'seance', 'hevy', 'b', '2026-10-30T05:10:00Z', '2026-10-30T06:10:00Z', 60, '2026-10-30T07:00:00Z')`,
    ).run();
    const web = await creerJeton('interface', 'web');
    const r = await client(horloge).get('/v1/statut', web);
    expect(r.corps.aujourdhui).toBe('2026-11-06');
    expect(r.corps.engagements_verifies).toEqual([
      { date: '2026-10-30', engagement: 'sport', nom: 'Sport', statut: 'fait' },
      { date: '2026-11-02', engagement: 'sport', nom: 'Sport', statut: 'fait' },
      { date: '2026-11-04', engagement: 'sport', nom: 'Sport', statut: 'saute_non_declare' },
      { date: '2026-11-06', engagement: 'sport', nom: 'Sport', statut: 'a_faire' },
    ]);
    expect(r.corps.sautes_semaine).toBe(1);
    expect(r.corps.seances_mesurees).toBeNull();
  });

  it('engagement facultatif non fait : « facultatif_non_fait », hors des sautés', async () => {
    const horloge = Horloge.a('2026-11-06T15:00:00Z');
    const config = configExemple();
    config.engagements.sport = { ...config.engagements.sport!, obligatoire: false };
    await installerConfig(config);
    const web = await creerJeton('interface', 'web');
    const r = await client(horloge).get('/v1/statut', web);
    expect(r.corps.engagements_verifies.filter((e: { date: string }) => e.date >= '2026-11-02')).toEqual([
      { date: '2026-11-02', engagement: 'sport', nom: 'Sport', statut: 'facultatif_non_fait' },
      { date: '2026-11-04', engagement: 'sport', nom: 'Sport', statut: 'facultatif_non_fait' },
      { date: '2026-11-06', engagement: 'sport', nom: 'Sport', statut: 'a_faire' },
    ]);
    expect(r.corps.sautes_semaine).toBe(0);
  });
});
