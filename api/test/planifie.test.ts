import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Tache } from '../../core/src/types';
import { executerTachesPlanifiees, usagesDesEtiquettes } from '../src/planifie';
import type { ClientTodoist, ResultatFaits } from '../src/todoist';
import { Horloge, MARDI, client, configExemple, creerJeton, installerConfig, tache } from './aides';

function fauxClient(taches: () => Tache[], etiquettes = ['planning', 'recap']) {
  const appels = { faits: 0, etiquettes: 0 };
  let panne = false;
  const c: ClientTodoist = {
    async recupererFaits(): Promise<ResultatFaits> {
      appels.faits++;
      if (panne) throw new Error('Todoist indisponible');
      return { idUtilisateur: '1001', taches: taches(), reports: [], suiviDeadlines: {} };
    },
    async etiquettesExistantes() {
      appels.etiquettes++;
      return etiquettes;
    },
  };
  return { c, appels, enPanne: (v: boolean) => (panne = v) };
}

const lire = (cle: string) =>
  env.DB.prepare(`SELECT valeur, maj_le FROM cache_todoist WHERE utilisateur = 'alice' AND cle = ?`).bind(cle).first<{ valeur: string; maj_le: string }>();

describe('tâche planifiée (§4.4)', () => {
  const horloge = Horloge.a(MARDI.matin);
  let taches: Tache[];
  let faux: ReturnType<typeof fauxClient>;
  const lancer = () => {
    const { deps } = client(horloge, {}, () => faux.c);
    return executerTachesPlanifiees({ ...env, TODOIST_TOKEN: 'jeton-factice', TODOIST_UTILISATEUR: 'alice' }, deps);
  };

  beforeEach(async () => {
    horloge.regler(MARDI.matin);
    taches = [tache({ id: '1' })];
    faux = fauxClient(() => taches);
    await installerConfig();
  });

  it('réécrit le cache Todoist seulement quand les faits changent', async () => {
    await lancer();
    expect((await lire('taches'))?.maj_le).toBe(MARDI.matin);
    // Cadence Todoist : 2 min (config `synchro.todoist`) ; la minute d'entre deux n'appelle pas Todoist.
    horloge.avancer(60);
    await lancer();
    expect(faux.appels.faits).toBe(1);
    horloge.avancer(60);
    await lancer();
    expect((await lire('taches'))?.maj_le).toBe(MARDI.matin);
    taches = [tache({ id: '1', terminee: true, termineeLe: '2026-11-03T10:03:30Z' })];
    horloge.avancer(120);
    await lancer();
    expect((await lire('taches'))?.maj_le).toBe('2026-11-03T10:04:00Z');
    expect(faux.appels.faits).toBe(3);
  });

  it('photo des retards à 00:00 locale, une seule fois par jour', async () => {
    taches = [
      tache({ id: '1', echeance: '2026-11-03', priorite: 'p4' }),
      tache({ id: '2', echeance: '2026-11-04' }),
      tache({ id: '3', echeance: '2026-11-02', etiquettes: ['recap'] }),
      tache({ id: '4', echeance: '2026-11-02', terminee: true }),
      tache({ id: '5', echeance: '2026-11-01', assigneeAMoi: false }),
    ];
    horloge.regler('2026-11-03T23:00:00Z'); // 00:00 à Paris, le 4
    await lancer();
    const photo = await env.DB.prepare(`SELECT date, fuseau, prise_le FROM photos_retards`).all();
    expect(photo.results).toEqual([{ date: '2026-11-04', fuseau: 'Europe/Paris', prise_le: '2026-11-03T23:00:00Z' }]);
    const retards = await env.DB.prepare(`SELECT tache_id FROM retards WHERE date = '2026-11-04'`).all();
    expect(retards.results).toEqual([{ tache_id: '1' }]);

    taches.push(tache({ id: '6', echeance: '2026-11-03' }));
    horloge.avancer(60);
    await lancer();
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM retards`).first<{ n: number }>())?.n).toBe(1);
  });

  it('pas de photo des retards sur un cache périmé (Todoist en panne)', async () => {
    faux.enPanne(true);
    horloge.regler('2026-11-03T23:00:00Z');
    await expect(lancer()).rejects.toThrow();
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM photos_retards`).first<{ n: number }>())?.n).toBe(0);
  });

  it('photo de la nuit au coucher appliqué', async () => {
    horloge.regler('2026-11-03T20:29:00Z');
    await lancer();
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM nuits`).first<{ n: number }>())?.n).toBe(0);
    horloge.regler('2026-11-03T20:30:00Z');
    await lancer();
    await lancer();
    const nuits = await env.DB.prepare(`SELECT * FROM nuits`).all();
    expect(nuits.results).toEqual([
      {
        utilisateur: 'alice',
        nuit: '2026-11-03',
        routine: 'semaine',
        lever: '2026-11-04T04:30:00Z',
        coucher_prevu: MARDI.coucher,
        coucher_applique: MARDI.coucher,
        decision_de_nuit: 0,
        photo_le: '2026-11-03T20:30:00Z',
        version_config: 'c0ffee1',
      },
    ]);
  });

  it('vérifie les étiquettes une fois par jour et note les manquantes', async () => {
    faux = fauxClient(() => taches, ['planning']);
    await lancer();
    horloge.avancer(60);
    await lancer();
    expect(faux.appels.etiquettes).toBe(1);
    expect(JSON.parse((await lire('etiquettes'))!.valeur)).toMatchObject({ date: '2026-11-03', manquantes: ['recap'] });
    const web = await creerJeton('interface', 'web');
    const statut = await client(horloge).get('/v1/statut', web);
    expect(statut.corps.todoist.etiquettes_manquantes).toEqual(['recap']);
    // Le rôle de chaque étiquette manquante, pour que l'interface dise ce que l'absence casse.
    expect(statut.corps.todoist.etiquettes_manquantes_detail).toEqual([{ etiquette: 'recap', usages: ['recap', 'exclusion'], modes: [] }]);
  });

  it('étiquettes : revérifiées dans l’heure tant qu’il en manque, et dès que la config en cite d’autres', async () => {
    faux = fauxClient(() => taches, ['planning']);
    await lancer();
    expect(faux.appels.etiquettes).toBe(1);
    // Étiquette créée dans Todoist : l'alerte s'efface à la vérification suivante, une heure après.
    faux = fauxClient(() => taches, ['planning', 'recap']);
    horloge.avancer(30 * 60);
    await lancer();
    expect(faux.appels.etiquettes).toBe(0);
    horloge.avancer(31 * 60);
    await lancer();
    expect(faux.appels.etiquettes).toBe(1);
    expect(JSON.parse((await lire('etiquettes'))!.valeur)).toMatchObject({ manquantes: [] });
    // Plus rien ne manque : pas de nouvelle vérification le même jour…
    horloge.avancer(2 * 3600);
    await lancer();
    expect(faux.appels.etiquettes).toBe(1);
    // … sauf si la config cite une nouvelle étiquette.
    const config = configExemple();
    await env.DB.prepare(`DELETE FROM config_versions`).run();
    await installerConfig({ ...config, todoist: { ...config.todoist, etiquettesExclues: [...config.todoist.etiquettesExclues, 'perso'] } }, 'c0ffee2');
    horloge.avancer(60);
    await lancer();
    expect(faux.appels.etiquettes).toBe(2);
    expect(JSON.parse((await lire('etiquettes'))!.valeur)).toMatchObject({ manquantes: ['perso'] });
    const statut = await client(horloge).get('/v1/statut', await creerJeton('interface', 'web'));
    expect(statut.corps.todoist.etiquettes_manquantes_detail).toEqual([{ etiquette: 'perso', usages: ['exclusion'], modes: [] }]);
  });

  it('ferme les sessions échues même sans requête de client', async () => {
    await lancer();
    const web = await creerJeton('interface', 'web');
    const s = (await client(horloge).post('/v1/sessions', web, { appareil: 'pc_linux', tache_id: '1', apps: ['chatgpt'] })).corps.session;
    horloge.regler(s.question.expire_a);
    await lancer();
    const ligne = await env.DB.prepare(`SELECT motif_fin FROM sessions WHERE id = ?`).bind(s.id).first();
    expect(ligne).toEqual({ motif_fin: 'sans_reponse' });
  });

  it('le jeton Todoist ne sert qu\'à son propriétaire (TODOIST_UTILISATEUR) ; sans lui, aucun appel (revue 01/11)', async () => {
    const { deps } = client(horloge, {}, () => faux.c);
    await executerTachesPlanifiees({ ...env, TODOIST_TOKEN: 'jeton-factice' }, deps);
    await executerTachesPlanifiees({ ...env, TODOIST_TOKEN: 'jeton-factice', TODOIST_UTILISATEUR: 'bob' }, deps);
    expect(faux.appels).toEqual({ faits: 0, etiquettes: 0 });
    // Deux utilisateurs : seul le propriétaire du compte reçoit les faits de ce compte.
    await installerConfig({ ...configExemple(), utilisateur: 'bob' }, 'b0b');
    await executerTachesPlanifiees({ ...env, TODOIST_TOKEN: 'jeton-factice', TODOIST_UTILISATEUR: 'alice' }, deps);
    expect(faux.appels.faits).toBe(1);
    const proprietaires = await env.DB.prepare(`SELECT DISTINCT utilisateur FROM cache_todoist WHERE cle = 'taches'`).all();
    expect(proprietaires.results).toEqual([{ utilisateur: 'alice' }]);
  });

  it("sans jeton Todoist : ni appel, ni photo des retards, mais la nuit est photographiée", async () => {
    const { deps } = client(horloge, {}, () => faux.c);
    horloge.regler('2026-11-03T23:00:00Z');
    await executerTachesPlanifiees(env, deps);
    expect(faux.appels.faits).toBe(0);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM nuits`).first<{ n: number }>())?.n).toBe(1);
  });
});

describe('rôles des étiquettes citées par la config', () => {
  it('planning, récap, exclusion globale, filtre de condition (avec ses modes)', () => {
    const config = configExemple();
    const [nom, mode] = Object.entries(config.modes)[0]!;
    const avecFiltre = {
      ...config,
      modes: {
        ...config.modes,
        [nom]: { ...mode, quand: { tous: [mode.quand, { nombreDeTaches: { filtre: { jour: 'aujourd_hui' as const, etiquettesIncluses: ['deep'], etiquettesExclues: ['recap'] }, auPlus: 0 } }] } },
      },
    };
    const u = usagesDesEtiquettes(avecFiltre);
    expect(u.planning).toEqual({ usages: ['planning', 'exclusion'], modes: [] });
    expect(u.recap).toEqual({ usages: ['recap', 'condition', 'exclusion'], modes: [nom] });
    expect(u.deep).toEqual({ usages: ['condition'], modes: [nom] });
  });
});
