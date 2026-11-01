import { describe, expect, it } from 'vitest';
import {
  BASE_TODOIST,
  type EvenementTodoist,
  SANS_DATE,
  type TacheTodoist,
  creerClientTodoist,
  prioriteDepuisTodoist,
} from '../src/todoist';

const MOI = '1001';
const AUTRE = '2002';
const FUSEAU = 'Europe/Paris';
const MAINTENANT = new Date('2026-11-03T10:00:00Z');

function brute(p: Partial<TacheTodoist> & { id: string }): TacheTodoist & { postponed_count: number } {
  return {
    content: `Tâche ${p.id}`,
    priority: 4,
    labels: [],
    due: { date: '2026-11-03' },
    deadline: null,
    responsible_uid: null,
    checked: false,
    added_at: '2026-11-01T08:00:00.000000Z',
    completed_at: null,
    // Jamais lu : sa valeur ne doit rien changer.
    postponed_count: 42,
    ...p,
  };
}

function report(id: string, de: string, vers: string | null, le: string, initiateur = MOI): EvenementTodoist {
  return {
    object_type: 'item',
    object_id: id,
    event_type: 'updated',
    event_date: le,
    parent_item_id: null,
    initiator_id: initiateur,
    extra_data: { last_due_date: de, due_date: vers, content: `Tâche ${id}` },
  };
}

function commentaire(tache: string, contenu: string, le: string): EvenementTodoist {
  return { object_type: 'note', object_id: `n${tache}`, event_type: 'added', event_date: le, parent_item_id: tache, initiator_id: MOI, extra_data: { content: contenu } };
}

/** Faux Todoist : répond selon le chemin, pagine avec next_cursor, note chaque appel. */
function fauxTodoist(donnees: {
  actives: TacheTodoist[][];
  terminees?: TacheTodoist[];
  evenements?: EvenementTodoist[];
  parIds?: TacheTodoist[];
  labels?: { name: string }[];
  partagees?: string[];
}) {
  const appels: URL[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const u = new URL(url);
    appels.push(u);
    expect(url.startsWith(BASE_TODOIST)).toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jeton-factice');
    const chemin = u.pathname.replace('/api/v1/', '');
    const page = Number(u.searchParams.get('cursor') ?? 0);
    const json = (corps: unknown) => new Response(JSON.stringify(corps), { headers: { 'Content-Type': 'application/json' } });
    switch (chemin) {
      case 'user':
        return json({ id: MOI });
      case 'tasks/filter':
        return json({ results: donnees.actives[page] ?? [], next_cursor: page + 1 < donnees.actives.length ? String(page + 1) : null });
      case 'tasks/completed/by_completion_date':
        return json({ items: donnees.terminees ?? [], next_cursor: null });
      case 'activities':
        return json({ results: donnees.evenements ?? [], next_cursor: null });
      case 'tasks': {
        const ids = (u.searchParams.get('ids') ?? '').split(',');
        return json({ results: (donnees.parIds ?? []).filter((t) => ids.includes(t.id)), next_cursor: null });
      }
      case 'labels':
        return json({ results: donnees.labels ?? [], next_cursor: null });
      case 'labels/shared':
        return json({ results: donnees.partagees ?? [], next_cursor: null });
      default:
        return new Response('{}', { status: 410 });
    }
  };
  return { appels, client: creerClientTodoist({ jeton: 'jeton-factice', fetch }) };
}

const PARAMS = { maintenant: MAINTENANT, fuseau: FUSEAU, commentaireMin: 15, etiquettesExclues: ['planning', 'recap'], suiviDeadlines: {} };

describe('adaptateur Todoist v1', () => {
  it('priorités : 4 = p1 … 1 = p4', () => {
    expect([4, 3, 2, 1].map(prioriteDepuisTodoist)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('lit .results page par page via next_cursor, et .items pour les terminées', async () => {
    const { client, appels } = fauxTodoist({
      actives: [[brute({ id: '1' })], [brute({ id: '2', priority: 1, labels: ['maths'] })]],
      terminees: [brute({ id: '3', checked: true, completed_at: '2026-11-03T09:00:00.000000Z' })],
    });
    const faits = await client.recupererFaits(PARAMS);
    expect(faits.idUtilisateur).toBe(MOI);
    expect(faits.taches.map((t) => [t.id, t.priorite, t.terminee])).toEqual([
      ['3', 'p1', true],
      ['1', 'p1', false],
      ['2', 'p4', false],
    ]);
    expect(faits.taches.find((t) => t.id === '3')?.termineeLe).toBe('2026-11-03T09:00:00Z');
    expect(appels.filter((u) => u.pathname.endsWith('tasks/filter')).map((u) => u.searchParams.get('cursor'))).toEqual([null, '1']);
    expect(appels.every((u) => !u.pathname.includes('rest/v2'))).toBe(true);
  });

  it('tâches assignées à quelqu’un d’autre : marquées, et leurs reports ignorés', async () => {
    const { client } = fauxTodoist({
      actives: [[brute({ id: '1', responsible_uid: AUTRE }), brute({ id: '2', responsible_uid: MOI })]],
      evenements: [report('1', '2026-11-03', '2026-11-05', '2026-11-03T08:00:00Z')],
      parIds: [],
    });
    const faits = await client.recupererFaits({ ...PARAMS, idUtilisateur: MOI });
    expect(faits.taches.map((t) => [t.id, t.assigneeAMoi])).toEqual([
      ['1', false],
      ['2', true],
    ]);
    expect(faits.reports).toEqual([]);
  });

  it('reports via /activities (last_due_date → due_date) ; postponed_count jamais lu', async () => {
    const { client, appels } = fauxTodoist({
      actives: [[brute({ id: '5', due: { date: '2026-11-03' } })]],
      evenements: [
        report('1', '2026-11-03', '2026-11-04', '2026-11-03T08:00:00Z'),
        // Doublon du même geste : un seul report.
        report('1', '2026-11-03', '2026-11-04', '2026-11-03T08:00:01Z'),
        // Rapprocher une date n'est pas un report.
        report('5', '2026-11-06', '2026-11-03', '2026-11-03T08:10:00Z'),
        // Geste fait par quelqu'un d'autre.
        report('6', '2026-11-03', '2026-11-04', '2026-11-03T08:20:00Z', AUTRE),
        // Date retirée : report vers « sans date ».
        report('7', '2026-11-02', null, '2026-11-03T08:30:00Z'),
        // Étiquette exclue.
        report('8', '2026-11-03', '2026-11-04', '2026-11-03T08:40:00Z'),
        // Documenté : commentaire ≥ 15 caractères dans les 3 jours avant.
        commentaire('9', 'Bloqué : attente du prof', '2026-11-02T18:00:00Z'),
        report('9', '2026-11-03', '2026-11-05T14:00:00Z', '2026-11-03T08:50:00Z'),
        // Commentaire trop court.
        commentaire('10', 'trop court', '2026-11-03T07:00:00Z'),
        report('10', '2026-11-03', '2026-11-04', '2026-11-03T09:00:00Z'),
      ],
      parIds: [
        brute({ id: '1', priority: 3, due: { date: '2026-11-04' }, deadline: { date: '2026-11-20' } }),
        brute({ id: '6' }),
        brute({ id: '7', due: null }),
        brute({ id: '8', labels: ['recap'] }),
        brute({ id: '9', due: { date: '2026-11-05' } }),
        brute({ id: '10', due: { date: '2026-11-04' } }),
      ],
    });
    const faits = await client.recupererFaits(PARAMS);
    const activites = appels.find((u) => u.pathname.endsWith('/activities'))!;
    expect(JSON.parse(activites.searchParams.get('object_event_types')!)).toEqual(['item:updated', 'note:added']);
    expect(faits.reports).toEqual([
      {
        tacheId: '1',
        priorite: 'p2',
        le: '2026-11-03T08:00:00Z',
        de: '2026-11-03',
        vers: '2026-11-04',
        deadline: '2026-11-20',
        deadlinePoseeLe: null,
        reportsPrecedents: 0,
        documente: false,
      },
      expect.objectContaining({ tacheId: '7', vers: SANS_DATE }),
      expect.objectContaining({ tacheId: '9', vers: '2026-11-05', documente: true }),
      expect.objectContaining({ tacheId: '10', documente: false }),
    ]);
  });

  it("date d'une deadline : seulement si on l'a vue apparaître", async () => {
    const avant = { '1': { date: null, poseeLe: null } };
    const { client } = fauxTodoist({ actives: [[brute({ id: '1', deadline: { date: '2026-11-20' } })]] });
    const faits = await client.recupererFaits({ ...PARAMS, idUtilisateur: MOI, suiviDeadlines: avant });
    expect(faits.suiviDeadlines['1']).toEqual({ date: '2026-11-20', poseeLe: '2026-11-03T10:00:00Z' });
    const premier = await fauxTodoist({ actives: [[brute({ id: '1', deadline: { date: '2026-11-20' } })]] }).client.recupererFaits({
      ...PARAMS,
      idUtilisateur: MOI,
    });
    expect(premier.suiviDeadlines['1']).toEqual({ date: '2026-11-20', poseeLe: null });
  });

  it('échec franc sur une erreur HTTP (le cache précédent reste)', async () => {
    const client = creerClientTodoist({ jeton: 'x', fetch: async () => new Response('', { status: 410 }) });
    await expect(client.recupererFaits(PARAMS)).rejects.toThrow('410');
  });

  it('étiquettes existantes : personnelles et partagées', async () => {
    const { client } = fauxTodoist({ actives: [], labels: [{ name: 'planning' }, { name: 'maths' }], partagees: ['recap', 'maths'] });
    expect(await client.etiquettesExistantes()).toEqual(['maths', 'planning', 'recap']);
  });
});
