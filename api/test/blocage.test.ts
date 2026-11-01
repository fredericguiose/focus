import { beforeEach, describe, expect, it } from 'vitest';
import { Horloge, MARDI, client, creerJeton, installerConfig, poserTaches, tache } from './aides';

describe('GET /v1/blocage (extension)', () => {
  const horloge = Horloge.a(MARDI.matin);
  let web: string;

  beforeEach(async () => {
    horloge.regler(MARDI.matin);
    await installerConfig();
    await poserTaches([tache({ id: '1' })]);
    web = await creerJeton('interface', 'extension');
  });

  it('domaine bloqué par le mode en vigueur', async () => {
    const r = await client(horloge).get('/v1/blocage?appareil=pc_linux&domaine=youtube.com', web);
    expect(r.statut).toBe(200);
    expect(r.corps).toMatchObject({
      bloque: true,
      app: { id: 'youtube', nom: 'YouTube' },
      mode: 'WORK',
      raison: expect.stringMatching(/^WORK/),
      sessions: 'autorisees',
    });
  });

  it('sous-domaine rattaché à son app ; domaine hors catalogue non bloqué', async () => {
    const api = client(horloge);
    expect((await api.get('/v1/blocage?appareil=pc_linux&domaine=Music.YouTube.com', web)).corps).toMatchObject({
      bloque: true,
      app: { id: 'youtube' },
    });
    expect((await api.get('/v1/blocage?appareil=pc_linux&domaine=exemple.org', web)).corps).toMatchObject({ bloque: false, app: null });
    expect((await api.get('/v1/blocage?appareil=pc_linux&domaine=mail.google.com', web)).corps.bloque).toBe(false);
  });

  it('une session ouverte sur l’app lève le blocage ; un mode verrouillé, jamais', async () => {
    const api = client(horloge);
    const ouverte = await api.post('/v1/sessions', web, { appareil: 'pc_linux', tache_id: '1', apps: ['chatgpt'] });
    expect(ouverte.statut).toBe(201);
    const r = await api.get('/v1/blocage?appareil=pc_linux&domaine=chatgpt.com', web);
    expect(r.corps).toMatchObject({ bloque: false, session: { id: ouverte.corps.session.id } });

    const verrouille = client(horloge, {
      etat: (c, a) => {
        const e = api.deps.moteur.etat(c, a);
        return { ...e, mode: 'NIGHT_LOCK', sessions: 'interdites', actions: { ...e.actions, verrouiller_session: true } };
      },
    });
    const nuit = await verrouille.get('/v1/blocage?appareil=pc_linux&domaine=chatgpt.com', web);
    expect(nuit.corps).toMatchObject({ bloque: true, mode: 'NIGHT_LOCK', sessions: 'interdites' });
  });

  it('400 sans appareil ou sans domaine, 404 pour un appareil inconnu', async () => {
    const api = client(horloge);
    expect((await api.get('/v1/blocage?domaine=x.com', web)).statut).toBe(400);
    expect((await api.get('/v1/blocage?appareil=pc_linux', web)).statut).toBe(400);
    expect((await api.get('/v1/blocage?appareil=tablette&domaine=x.com', web)).statut).toBe(404);
  });

  it("un jeton appareil ne lit que son propre appareil", async () => {
    const pc = await creerJeton('appareil', 'pc_linux');
    const api = client(horloge);
    expect((await api.get('/v1/blocage?domaine=x.com', pc)).corps.bloque).toBe(true);
    expect((await api.get('/v1/blocage?appareil=pc_windows&domaine=x.com', pc)).statut).toBe(403);
  });
});
