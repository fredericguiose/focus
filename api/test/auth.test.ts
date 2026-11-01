import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { Horloge, MARDI, client, creerJeton, installerConfig } from './aides';

describe('authentification', () => {
  const horloge = Horloge.a(MARDI.matin);
  const api = client(horloge);
  let jetons: { pc: string; web: string; config: string };

  beforeEach(async () => {
    horloge.regler(MARDI.matin);
    await installerConfig();
    jetons = {
      pc: await creerJeton('appareil', 'pc_linux'),
      web: await creerJeton('interface', 'web'),
      config: await creerJeton('config', 'actions'),
    };
  });

  it('401 sans en-tête, avec WWW-Authenticate', async () => {
    const r = await api.get('/v1/config/version');
    expect(r.statut).toBe(401);
    expect(r.corps.erreur).toBe('jeton_absent');
    expect(r.entetes.get('WWW-Authenticate')).toContain('Bearer');
  });

  it('401 pour un jeton inconnu ou révoqué', async () => {
    expect((await api.get('/v1/config/version', 'inconnu')).corps.erreur).toBe('jeton_invalide');
    await env.DB.prepare(`UPDATE appareils SET revoque_le = '2026-11-02T00:00:00Z' WHERE nom = 'web'`).run();
    const r = await api.get('/v1/config/version', jetons.web);
    expect(r.statut).toBe(401);
  });

  it.each([
    ['GET', '/v1/planning', 'web'],
    ['GET', '/v1/planning', 'config'],
    ['POST', '/v1/accuses', 'web'],
    ['POST', '/v1/evenements', 'config'],
    ['GET', '/v1/statut', 'pc'],
    ['POST', '/v1/actualiser', 'pc'],
    ['POST', '/v1/actualiser', 'config'],
    ['GET', '/v1/taches', 'config'],
    ['POST', '/v1/sessions', 'config'],
    ['POST', '/v1/exceptions/prix', 'pc'],
    ['POST', '/v1/exceptions', 'pc'],
    ['POST', '/v1/config', 'web'],
    ['POST', '/v1/config', 'pc'],
    ['GET', '/v1/blocage?appareil=pc_linux&domaine=x.com', 'config'],
  ] as const)('403 : %s %s avec un jeton %s', async (methode, chemin, qui) => {
    const r = methode === 'GET' ? await api.get(chemin, jetons[qui]) : await api.post(chemin, jetons[qui], {});
    expect(r.statut).toBe(403);
    expect(r.corps.erreur).toBe('jeton_non_autorise');
  });

  it('/v1/config/version accepte les trois types de jeton', async () => {
    for (const j of Object.values(jetons)) {
      const r = await api.get('/v1/config/version', j);
      expect(r.statut).toBe(200);
      expect(r.corps.version).toBe('c0ffee1');
    }
  });

  it('met à jour vu_le, au plus toutes les 5 min', async () => {
    await api.get('/v1/planning', jetons.pc);
    const vu = () => env.DB.prepare(`SELECT vu_le FROM appareils WHERE nom = 'pc_linux'`).first<{ vu_le: string }>();
    expect((await vu())?.vu_le).toBe(MARDI.matin);
    horloge.avancer(60);
    await api.get('/v1/planning', jetons.pc);
    expect((await vu())?.vu_le).toBe(MARDI.matin);
    horloge.avancer(300);
    await api.get('/v1/planning', jetons.pc);
    expect((await vu())?.vu_le).toBe('2026-11-03T10:06:00Z');
  });

  it('404 en JSON pour une route /v1 inconnue', async () => {
    const r = await api.get('/v1/rien', jetons.web);
    expect(r.statut).toBe(404);
    expect(r.corps).toEqual({ erreur: 'introuvable', message: expect.any(String) });
  });
});
