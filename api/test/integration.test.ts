// Parcours complet avec le vrai moteur (core/) et config/exemple.yaml, via le Worker lui-même.
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { moteur } from '../../core/src/index';
import type { Segment, Tache } from '../../core/src/types';
import worker, { creerWorker } from '../src/index';
import type { ClientTodoist } from '../src/todoist';
import { Horloge, creerJeton, exempleYaml, tache } from './aides';

describe('intégration : vrai moteur + exemple.yaml', () => {
  it('le Worker exporté par défaut branche le vrai moteur', async () => {
    const r = await worker.fetch!(new Request('https://focus.test/v1/config/version'), env, createExecutionContext());
    expect(r.status).toBe(401);
    const config = await creerJeton('config', 'actions');
    const ok = await worker.fetch!(
      new Request('https://focus.test/v1/config', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml: exempleYaml, commit: 'reel01' }),
      }),
      env,
      createExecutionContext(),
    );
    expect(ok.status).toBe(201);
  });

  it('dimanche : config, cron, planning, session, exception, accusé, événements', async () => {
    // Dimanche 8 novembre 2026, 11:00 à Paris.
    const horloge = Horloge.a('2026-11-08T10:00:00Z');
    let taches: Tache[] = [
      tache({ id: 'p', etiquettes: ['planning'], echeance: '2026-11-08' }),
      tache({ id: 'd', contenu: 'Exercice de physique', echeance: '2026-11-08', priorite: 'p3' }),
      tache({ id: 'r', echeance: '2026-11-07', priorite: 'p3' }),
    ];
    const todoist: ClientTodoist = {
      recupererFaits: async () => ({ idUtilisateur: '1', taches, reports: [], suiviDeadlines: {} }),
      etiquettesExistantes: async () => ['planning', 'recap'],
    };
    const w = creerWorker({ moteur, maintenant: horloge.maintenant, todoist: () => todoist });
    const envTodoist = { ...env, TODOIST_TOKEN: 'jeton-factice', TODOIST_UTILISATEUR: 'alice' };
    const appeler = async (methode: string, chemin: string, jeton: string, corps?: unknown) => {
      const r = await w.fetch!(
        new Request(`https://focus.test${chemin}`, {
          method: methode,
          headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
          ...(corps ? { body: JSON.stringify(corps) } : {}),
        }),
        envTodoist,
        createExecutionContext(),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { statut: r.status, corps: (await r.json()) as any };
    };
    const cron = async () => {
      const ctx = createExecutionContext();
      await w.scheduled!({ cron: '* * * * *', scheduledTime: horloge.t, noRetry() {} } as ScheduledController, envTodoist, ctx);
      await waitOnExecutionContext(ctx);
    };

    const jConfig = await creerJeton('config', 'actions');
    const pc = await creerJeton('appareil', 'pc_linux');
    const web = await creerJeton('interface', 'web');
    expect((await appeler('POST', '/v1/config', jConfig, { yaml: exempleYaml, commit: 'abc1234' })).statut).toBe(201);

    // Photo des retards du dimanche, prise à minuit local.
    horloge.regler('2026-11-07T23:00:00Z');
    await cron();
    horloge.regler('2026-11-08T10:00:00Z');
    await cron();

    // Planning pas fait : MORNING_LOCK sur le PC, rien sur l'iPhone (mode réservé aux PC).
    let planning = await appeler('GET', '/v1/planning', pc);
    expect(planning.statut).toBe(200);
    expect(planning.corps.segments[0]).toMatchObject({ mode: 'MORNING_LOCK', sessions: 'interdites' });
    expect((await appeler('POST', '/v1/sessions', web, { appareil: 'pc_linux', tache_id: 'd', apps: ['chatgpt'] })).corps.erreur).toBe(
      'session_impossible',
    );
    const statut = await appeler('GET', '/v1/statut', web);
    const iphone = statut.corps.appareils.find((a: { nom: string }) => a.nom === 'iphone');
    expect(iphone.mode).toBe('WORK');

    // Planning fait dans Todoist : au passage Todoist suivant (cadence 2 min), WORK — le planning
    // gardé 60 s est effacé par la synchro qui change les faits.
    taches = taches.map((t) => (t.id === 'p' ? { ...t, terminee: true, termineeLe: '2026-11-08T10:00:30Z' } : t));
    horloge.avancer(60);
    await cron();
    expect((await appeler('GET', '/v1/planning', pc)).corps.segments[0].mode).toBe('MORNING_LOCK');
    horloge.avancer(60);
    await cron();
    planning = await appeler('GET', '/v1/planning', pc);
    const segments = planning.corps.segments as Segment[];
    expect(segments[0]!.mode).toBe('WORK');
    // Dimanche : EVENING_FREE exige aussi aucun_retard ; la tâche « r » en retard l'empêche.
    // Lundi n'a pas cette condition : la soirée libre y revient.
    expect(segments.map((s) => [s.debut, s.mode])).toEqual([
      ['2026-11-08T10:02:00Z', 'WORK'],
      ['2026-11-08T20:30:00Z', 'NIGHT_LOCK'],
      ['2026-11-09T04:30:00Z', 'WORK'],
      ['2026-11-09T19:30:00Z', 'EVENING_FREE'],
      ['2026-11-09T21:30:00Z', 'NIGHT_LOCK'],
    ]);

    const ouverte = await appeler('POST', '/v1/sessions', web, { appareil: 'pc_linux', tache_id: 'd', apps: ['chatgpt'] });
    expect(ouverte.statut).toBe(201);
    planning = await appeler('GET', '/v1/planning', pc);
    expect(planning.corps.sessions[0]).toMatchObject({ tache: { id: 'd', nom: 'Exercice de physique' }, domaines: ['chat.openai.com', 'chatgpt.com'] });
    const blocage = await appeler('GET', '/v1/blocage?appareil=pc_linux&domaine=chatgpt.com', web);
    expect(blocage.corps).toMatchObject({ bloque: false, mode: 'WORK', sessions: 'autorisees' });

    const prix = await appeler('POST', '/v1/exceptions/prix', web, { type: 'coucher', nuit: '2026-11-08', heure: '22:00' });
    expect(prix.corps.prix).toMatchObject({ admissible: false, friction: 'raison' });

    const accuse = await appeler('POST', '/v1/accuses', pc, { action: 'verrouiller_session', pose_le: '2026-11-08T20:31:00Z' });
    expect(accuse).toEqual({ statut: 201, corps: { enregistre: true, nuit: '2026-11-08' } });
    // Revue du 01/11 : un accusé daté n'importe quand (an 1970, an 9999) faisait calculer une journée arbitraire.
    for (const pose_le of ['1970-01-01T00:00:00Z', '9999-01-01T00:00:00Z', '2026-11-05T09:59:00Z']) {
      const faux = await appeler('POST', '/v1/accuses', pc, { action: 'verrouiller_session', pose_le });
      expect(faux.statut).toBe(400);
      expect(faux.corps.champ).toBe('pose_le');
    }
    const lot = await appeler('POST', '/v1/evenements', pc, {
      evenements: [
        { type: 'reconnexion', debut: '2026-11-08T21:00:00Z', duree_s: 30 },
        { type: 'acces', heure_appareil: '2026-11-08T10:05:00Z', cible: 'YouTube.com', decision: 'bloque' },
        { type: 'acces', heure_appareil: '2026-11-08T10:05:00Z', cible: 'youtube.com', decision: 'bloque' },
        { type: 'acces', heure_appareil: '2026-11-08T10:06:00Z', cible: 'inconnu.example', decision: 'passe' },
        { type: 'autre' },
      ],
    });
    expect(lot.corps).toEqual({
      recus: 5,
      enregistres: { reconnexion: 1, acces: 2 },
      doublons_ignores: 1,
      rejetes: [{ index: 4, raison: expect.any(String) }],
    });

    // Le retard de la photo terminé : la soirée libre de dimanche s'ouvre à 14:00 locale.
    taches = taches.map((t) => (t.id === 'r' ? { ...t, terminee: true, termineeLe: '2026-11-08T10:02:30Z' } : t));
    horloge.avancer(120);
    await cron();
    planning = await appeler('GET', '/v1/planning', pc);
    expect(planning.corps.segments[1]).toMatchObject({ debut: '2026-11-08T13:00:00Z', mode: 'EVENING_FREE' });

    const vues = await env.DB.prepare(`SELECT cible FROM apps_vues`).all();
    expect(vues.results).toEqual([{ cible: 'inconnu.example' }]);
  });
});
