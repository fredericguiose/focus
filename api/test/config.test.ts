import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { Horloge, MARDI, client, creerJeton, exempleYaml } from './aides';

describe('POST /v1/config', () => {
  const api = client(Horloge.a(MARDI.matin));
  let jeton: string;
  let lecteur: string;

  beforeEach(async () => {
    jeton = await creerJeton('config', 'actions');
    lecteur = await creerJeton('interface', 'web');
  });

  it("404 tant qu'aucune config valide n'est reçue", async () => {
    expect((await api.get('/v1/config/version', lecteur)).statut).toBe(404);
  });

  it('enregistre une config valide et la rend active', async () => {
    const r = await api.post('/v1/config', jeton, { yaml: exempleYaml, commit: 'aaa1111' });
    expect(r.statut).toBe(201);
    expect(r.corps).toEqual({ version: 'aaa1111', valide: true, recue_le: MARDI.matin });
    expect((await api.get('/v1/config/version', lecteur)).corps.version).toBe('aaa1111');
  });

  it('refuse une config invalide en entier ; la précédente reste active', async () => {
    await api.post('/v1/config', jeton, { yaml: exempleYaml, commit: 'aaa1111' });
    const casse = exempleYaml.replace('cible: "8h"', 'cible: "huit heures"');
    const r = await api.post('/v1/config', jeton, { yaml: casse, commit: 'bbb2222' });
    expect(r.statut).toBe(422);
    expect(r.corps.erreur).toBe('config_invalide');
    expect(r.corps.erreurs.length).toBeGreaterThan(0);
    expect(r.corps.version_active).toBe('aaa1111');
    expect((await api.get('/v1/config/version', lecteur)).corps.version).toBe('aaa1111');
    const journal = await env.DB.prepare(`SELECT commit_id, valide FROM config_versions ORDER BY id`).all();
    expect(journal.results).toEqual([
      { commit_id: 'aaa1111', valide: 1 },
      { commit_id: 'bbb2222', valide: 0 },
    ]);
  });

  it('refuse un YAML illisible', async () => {
    const r = await api.post('/v1/config', jeton, { yaml: 'modes: [', commit: 'ccc3333' });
    expect(r.statut).toBe(422);
    expect(r.corps.version_active).toBeNull();
  });

  it("refuse la config d'un autre utilisateur que celui du jeton", async () => {
    const r = await api.post('/v1/config', jeton, { yaml: exempleYaml.replace('utilisateur: alice', 'utilisateur: bob'), commit: 'd' });
    expect(r.statut).toBe(422);
    expect(r.corps.erreurs[0]).toContain('bob');
  });

  it('400 si yaml ou commit manquent, ou si le corps est illisible', async () => {
    expect((await api.post('/v1/config', jeton, { commit: 'x' })).corps.erreur).toBe('requete_invalide');
    expect((await api.post('/v1/config', jeton, { yaml: exempleYaml })).statut).toBe(400);
    expect((await api.post('/v1/config', jeton, [1])).statut).toBe(400);
  });
});
