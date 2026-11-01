import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { Horloge, MARDI, client, creerJeton, installerConfig, poserTaches, tache } from './aides';

const OUVERTURE = { appareil: 'pc_linux', tache_id: '1', apps: ['chatgpt'] };

describe('sessions (§4.5)', () => {
  const horloge = Horloge.a(MARDI.matin);
  const api = client(horloge);
  let web: string;
  let pc: string;

  beforeEach(async () => {
    horloge.regler(MARDI.matin);
    await installerConfig();
    await poserTaches([
      tache({ id: '1', contenu: 'DM de maths' }),
      tache({ id: '2', creeeLe: '2026-11-03T09:50:00Z' }),
      tache({ id: '3', terminee: true, termineeLe: '2026-11-03T09:00:00Z' }),
    ]);
    web = await creerJeton('interface', 'web');
    pc = await creerJeton('appareil', 'pc_linux');
  });

  async function ouvrir() {
    const r = await api.post('/v1/sessions', web, OUVERTURE);
    expect(r.statut).toBe(201);
    return r.corps.session;
  }

  const repondre = (s: { id: string }, questionId: string, reponse: string) =>
    api.post(`/v1/sessions/${s.id}/reponse`, web, { question_id: questionId, reponse });

  it('ouvre une session : première question à + 25 min (PC), attente 0, expire 60 s après', async () => {
    const s = await ouvrir();
    expect(s).toMatchObject({
      tache: { id: '1', nom: 'DM de maths' },
      apps: ['chatgpt'],
      domaines: ['chat.openai.com', 'chatgpt.com'],
      ouverte_le: MARDI.matin,
      question: { posee_a: '2026-11-03T10:25:00Z', attente_s: 0, expire_a: '2026-11-03T10:26:00Z' },
    });
    const planning = await api.get('/v1/planning', pc);
    expect(planning.corps.sessions).toHaveLength(1);
    expect(planning.corps.sessions[0].id).toBe(s.id);
  });

  it('intervalle iPhone : 10 min', async () => {
    const r = await api.post('/v1/sessions', web, { ...OUVERTURE, appareil: 'iphone' });
    expect(r.corps.session).toMatchObject({ question: { posee_a: '2026-11-03T10:10:00Z' }, identifiants_iphone: ['com.openai.chat'] });
  });

  it('refuse quand le mode en vigueur interdit les sessions', async () => {
    horloge.regler('2026-11-03T21:00:00Z');
    const r = await api.post('/v1/sessions', web, OUVERTURE);
    expect(r.statut).toBe(409);
    expect(r.corps).toMatchObject({ erreur: 'sessions_interdites', mode: 'NIGHT_LOCK' });
  });

  it('refuse une tâche terminée, trop récente ou inconnue', async () => {
    expect((await api.post('/v1/sessions', web, { ...OUVERTURE, tache_id: '3' })).corps.erreur).toBe('tache_terminee');
    const recente = await api.post('/v1/sessions', web, { ...OUVERTURE, tache_id: '2' });
    expect(recente.corps).toMatchObject({ erreur: 'tache_trop_recente', eligible_le: '2026-11-03T10:05:00Z' });
    expect((await api.post('/v1/sessions', web, { ...OUVERTURE, tache_id: '99' })).statut).toBe(404);
    horloge.regler('2026-11-03T10:05:00Z');
    expect((await api.post('/v1/sessions', web, { ...OUVERTURE, tache_id: '2' })).statut).toBe(201);
  });

  it('refuse au-delà du plafond quotidien de 3 h (toutes sessions de la journée)', async () => {
    const ins = env.DB.prepare(
      `INSERT INTO sessions (id, utilisateur, type, tache_id, appareil, apps, ouverte_le, fermee_le, motif_fin, version_config)
       VALUES (?, 'alice', 'travail', '1', ?, '[]', ?, ?, 'fermee', 'c0ffee1')`,
    );
    await env.DB.batch([
      ins.bind('s_a', 'pc_linux', '2026-11-03T05:40:00Z', '2026-11-03T07:40:00Z'),
      ins.bind('s_b', 'iphone', '2026-11-03T08:00:00Z', '2026-11-03T08:59:00Z'),
      // Veille : ne compte pas.
      ins.bind('s_c', 'pc_linux', '2026-11-02T10:00:00Z', '2026-11-02T13:00:00Z'),
    ]);
    expect((await api.post('/v1/sessions', web, OUVERTURE)).statut).toBe(201);
    horloge.avancer(60);
    const r = await api.post('/v1/sessions', web, { ...OUVERTURE, appareil: 'iphone' });
    expect(r.statut).toBe(409);
    expect(r.corps).toMatchObject({ erreur: 'plafond_atteint', cumul_min: 180, plafond_min: 180 });
  });

  it('une seule session ouverte par appareil ; ajouter une app est gratuit', async () => {
    const s = await ouvrir();
    expect((await api.post('/v1/sessions', web, OUVERTURE)).corps.erreur).toBe('session_deja_ouverte');
    const r = await api.post(`/v1/sessions/${s.id}/apps`, web, { app: 'gemini' });
    expect(r.corps.session.apps).toEqual(['chatgpt', 'gemini']);
    expect(r.corps.session.question.id).toBe(s.question.id);
    expect((await api.post(`/v1/sessions/${s.id}/apps`, web, { app: 'inconnue' })).statut).toBe(422);
  });

  it('attente progressive : 0, 3, 5, 10, 15, 20, 20 s ; « continue » trop tôt refusé', async () => {
    let s = await ouvrir();
    const attentes: number[] = [];
    for (let n = 0; n < 7; n++) {
      const q = s.question;
      attentes.push(q.attente_s);
      expect(Date.parse(q.expire_a) - Date.parse(q.posee_a)).toBe((60 + q.attente_s) * 1000);
      horloge.regler(q.posee_a);
      if (q.attente_s > 0) {
        const tot = await repondre(s, q.id, 'continue');
        expect(tot.statut).toBe(409);
        expect(tot.corps.erreur).toBe('continue_trop_tot');
        horloge.avancer(q.attente_s);
      }
      const r = await repondre(s, q.id, 'continue');
      expect(r.statut).toBe(200);
      s = r.corps.session;
      expect(Date.parse(s.question.posee_a) - horloge.t).toBe(25 * 60_000);
    }
    expect(attentes).toEqual([0, 3, 5, 10, 15, 20, 20]);
  });

  it("le rang des « continue » suit la tâche sur toute la journée, d'une session à l'autre", async () => {
    let s = await ouvrir();
    horloge.regler(s.question.posee_a);
    s = (await repondre(s, s.question.id, 'continue')).corps.session;
    await api.post(`/v1/sessions/${s.id}/fermer`, web);
    const r = await api.post('/v1/sessions', web, OUVERTURE);
    expect(r.corps.session.question.attente_s).toBe(3);
  });

  it('« continue » avant que la question soit posée : refusé', async () => {
    const s = await ouvrir();
    const r = await repondre(s, s.question.id, 'continue');
    expect(r.corps.erreur).toBe('question_pas_encore_posee');
  });

  it("pas de réponse avant expire_a : session fermée, motif sans_reponse", async () => {
    const s = await ouvrir();
    horloge.regler(s.question.expire_a);
    const planning = await api.get('/v1/planning', pc);
    expect(planning.corps.sessions).toEqual([]);
    const r = await repondre(s, s.question.id, 'continue');
    expect(r.corps.erreur).toBe('question_expiree');
    const ligne = await env.DB.prepare(`SELECT fermee_le, motif_fin FROM sessions WHERE id = ?`).bind(s.id).first();
    expect(ligne).toEqual({ fermee_le: s.question.expire_a, motif_fin: 'sans_reponse' });
    const q = await env.DB.prepare(`SELECT reponse FROM questions WHERE id = ?`).bind(s.question.id).first();
    expect(q).toEqual({ reponse: 'aucune' });
  });

  it('« arrête » ferme tout de suite', async () => {
    const s = await ouvrir();
    horloge.avancer(120);
    const r = await repondre(s, s.question.id, 'arrete');
    expect(r.corps.session).toMatchObject({ fermee_le: '2026-11-03T10:02:00Z', motif_fin: 'arretee', question: null });
  });

  it('tâche terminée dans Todoist : session fermée', async () => {
    const s = await ouvrir();
    horloge.avancer(600);
    await poserTaches([tache({ id: '1', terminee: true, termineeLe: '2026-11-03T10:07:00Z' })]);
    expect((await api.get('/v1/planning', pc)).corps.sessions).toEqual([]);
    const ligne = await env.DB.prepare(`SELECT fermee_le, motif_fin FROM sessions WHERE id = ?`).bind(s.id).first();
    expect(ligne).toEqual({ fermee_le: '2026-11-03T10:07:00Z', motif_fin: 'tache_terminee' });
  });

  it('question périmée, réponse invalide', async () => {
    const s = await ouvrir();
    expect((await repondre(s, 'q_autre', 'continue')).corps.erreur).toBe('question_perimee');
    expect((await repondre(s, s.question.id, 'peut-etre')).statut).toBe(400);
  });

  it('un jeton appareil ne touche que ses sessions', async () => {
    const iphone = await creerJeton('appareil', 'iphone');
    expect((await api.post('/v1/sessions', iphone, OUVERTURE)).statut).toBe(403);
    const s = await ouvrir();
    expect((await api.post(`/v1/sessions/${s.id}/fermer`, iphone)).statut).toBe(403);
    const r = await api.post(`/v1/sessions/${s.id}/fermer`, pc);
    expect(r.corps.session.motif_fin).toBe('fermee');
  });
});
