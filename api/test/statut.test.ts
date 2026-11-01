import { beforeEach, describe, expect, it } from 'vitest';
import { appareilPrincipal } from '../src/planning';
import { Horloge, MARDI, client, configExemple, creerJeton, installerConfig, poserTaches, tache } from './aides';

const RAISON = 'Une raison suffisamment longue pour dépasser les cinquante caractères.';
const PHRASE = 'JE NE PEUX PAS DECALER';

// Mardi 03/11 (Europe/Paris, UTC+1) : ouverture 19:30 (18:30Z), coucher 21:30 (20:30Z).
// Mercredi 04/11 : sport 06:00 (réveil 05:30), travail réveil 06:30.
describe('GET /v1/statut : phase, actions, engagements de demain, nuits', () => {
  const horloge = Horloge.a(MARDI.matin);
  const api = client(horloge);
  let web: string;

  beforeEach(async () => {
    horloge.regler(MARDI.matin);
    await installerConfig();
    web = await creerJeton('interface', 'web');
  });

  it('journée : je_vais_dormir disponible, décalage sur raison', async () => {
    const r = await api.get('/v1/statut', web);
    expect(r.corps.phase).toBe('journee');
    expect(r.corps.actions).toEqual({
      je_vais_dormir: { disponible: true, motif: null },
      decaler_coucher: { mode: 'raison', motif: null },
    });
  });

  it('soirée : décision de nuit, puis indisponible une fois prise', async () => {
    horloge.regler('2026-11-03T19:00:00Z');
    const r = await api.get('/v1/statut', web);
    expect(r.corps.phase).toBe('soiree');
    expect(r.corps.actions.je_vais_dormir).toEqual({ disponible: true, motif: null });
    expect(r.corps.actions.decaler_coucher).toEqual({
      mode: 'decision_de_nuit',
      motif: 'soirée ouverte depuis 19:30',
    });
    const decision = await api.post('/v1/exceptions', web, { type: 'coucher', nuit: '2026-11-03', heure: '22:00', raison: RAISON, phrase: PHRASE });
    expect(decision.statut).toBe(201);
    const apres = await api.get('/v1/statut', web);
    expect(apres.corps.actions.decaler_coucher).toEqual({
      mode: 'indisponible',
      motif: 'décision de nuit déjà prise pour la nuit du 3 nov. (une seule par nuit)',
    });
  });

  it('nuit : je_vais_dormir indisponible, et la demande est refusée sans exiger de décision de nuit', async () => {
    horloge.regler('2026-11-03T21:49:00Z'); // 22:49, coucher 21:30
    const r = await api.get('/v1/statut', web);
    expect(r.corps.phase).toBe('nuit');
    expect(r.corps.actions.je_vais_dormir).toEqual({ disponible: false, motif: 'la nuit a déjà commencé à 21:30' });
    expect(r.corps.actions.decaler_coucher.mode).toBe('decision_de_nuit');
    const dormir = await api.post('/v1/exceptions', web, { type: 'avancer_coucher' });
    expect(dormir.statut).toBe(422);
    expect(dormir.corps).toMatchObject({
      erreur: 'exception_refusee',
      message: 'la nuit a déjà commencé à 21:30',
      prix: { admissible: false, friction: 'aucune', coucher_apres: MARDI.coucher },
    });
  });

  it('appareils : session possible ou motif (§4.5)', async () => {
    const possibilites = async () =>
      Object.fromEntries(
        (await api.get('/v1/statut', web)).corps.appareils.map((a: { nom: string; session_possible: boolean; session_motif: string | null }) => [
          a.nom,
          [a.session_possible, a.session_motif],
        ]),
      );
    expect(await possibilites()).toEqual({
      pc_linux: [true, null],
      pc_windows: [false, 'aucun compte de travail sur ce PC'],
      iphone: [true, null],
    });
    horloge.regler('2026-11-03T21:00:00Z');
    expect(await possibilites()).toEqual({
      pc_linux: [false, "Nuit jusqu'à 05:30"],
      pc_windows: [false, 'aucun compte de travail sur ce PC'],
      iphone: [false, "Nuit jusqu'à 05:30"],
    });
  });

  it('engagements de demain : routine et exceptions appliquées', async () => {
    expect((await api.get('/v1/statut', web)).corps.engagements_demain).toEqual([
      { id: 'sport', nom: 'Sport', reveil: '2026-11-04T04:30:00Z', heure: '2026-11-04T05:00:00Z', obligatoire: true, sans_heure: false, origine: 'routine' },
      { id: 'travail', nom: 'Travail', reveil: '2026-11-04T05:30:00Z', heure: null, obligatoire: true, sans_heure: false, origine: 'routine' },
    ]);
    await api.post('/v1/exceptions', web, { type: 'retire', date: '2026-11-04', engagement: 'travail', raison: RAISON });
    await api.post('/v1/exceptions', web, { type: 'ajoute', date: '2026-11-04', libelle: 'Dentiste', heure: '08:00', preparation_min: 45, obligatoire: false });
    expect((await api.get('/v1/statut', web)).corps.engagements_demain).toEqual([
      { id: 'sport', nom: 'Sport', reveil: '2026-11-04T04:30:00Z', heure: '2026-11-04T05:00:00Z', obligatoire: true, sans_heure: false, origine: 'routine' },
      { id: 'Dentiste', nom: 'Dentiste', reveil: '2026-11-04T06:15:00Z', heure: '2026-11-04T07:00:00Z', obligatoire: false, sans_heure: false, origine: 'exception' },
    ]);
  });

  it('nuits : les 7 dernières nuits terminées, avec les exceptions enregistrées ; dette cumulée', async () => {
    // Dimanche 01/11, avant l'ouverture (14:00) : coucher 22:00 au lieu de 21:30 → 30 min de dette.
    horloge.regler('2026-11-01T10:00:00Z');
    expect((await api.post('/v1/exceptions', web, { type: 'coucher', nuit: '2026-11-01', heure: '22:00', raison: RAISON })).statut).toBe(201);
    horloge.regler(MARDI.matin);
    const r = await api.get('/v1/statut', web);
    expect(r.corps.nuits.map((n: { nuit: string }) => n.nuit)).toEqual([
      '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02',
    ]);
    expect(r.corps.nuits.find((n: { nuit: string }) => n.nuit === '2026-11-01').dette_min).toBe(30);
    expect(r.corps.dette_cumulee_min).toBe(r.corps.nuits.reduce((s: number, n: { dette_min: number }) => s + n.dette_min, 0));
    expect(r.corps.dette_cumulee_min).toBe(30);
  });

  it('appareils : jusqua = fin du segment en cours', async () => {
    const pc = await creerJeton('appareil', 'pc_linux');
    const planning = await api.get('/v1/planning', pc);
    const r = await api.get('/v1/statut', web);
    const pcLinux = r.corps.appareils.find((a: { nom: string }) => a.nom === 'pc_linux');
    expect(pcLinux.jusqua).toBe(planning.corps.segments[0].fin);
    expect(pcLinux.jusqua).toBe(MARDI.ouverture);
    for (const a of r.corps.appareils) expect(Date.parse(a.jusqua)).toBeGreaterThan(Date.parse(MARDI.matin));
  });

  it('exemple complet', async () => {
    horloge.regler('2026-11-03T19:00:00Z');
    const r = await api.get('/v1/statut', web);
    expect(r.corps).toMatchObject({
      phase: 'soiree',
      nuits: expect.any(Array),
      dette_cumulee_min: 0,
      engagements_demain: [{ id: 'sport' }, { id: 'travail' }],
    });
    expect(r.corps.appareils.map((a: { jusqua: string }) => a.jusqua)).toEqual([MARDI.coucher, MARDI.coucher, MARDI.coucher]);
  });

  it('parcours et sortie : MORNING_LOCK à 18:00, planning pas fait ; appareil principal', async () => {
    await poserTaches([tache({ id: 'plan', etiquettes: ['planning'], priorite: 'p4' })]);
    horloge.regler('2026-11-03T17:00:00Z');
    const r = await api.get('/v1/statut', web);
    expect(r.corps.appareil_principal).toBe('pc_linux');
    const pc = r.corps.appareils.find((a: { nom: string }) => a.nom === 'pc_linux');
    expect(pc.mode).toBe('MORNING_LOCK');
    expect(pc.session_motif).toBe('Matin verrouillé : planning du matin à faire');
    expect(pc.sortie).toEqual({ texte: 'dès que le planning du matin est fait', certaine: false, au_plus_tard: MARDI.coucher });
    expect(pc.parcours[1]).toEqual({
      mode: 'MORNING_LOCK',
      nom: 'Matin verrouillé',
      applicable: true,
      actif: true,
      logique: 'pas',
      // Le fait positif et son état réel ; `niee` porte la négation du mode.
      conditions: [{ type: 'planning', libelle: 'Planning du matin', vraie: false, detail: 'à faire', a: null, niee: true }],
    });
    expect(pc.parcours.map((m: { mode: string }) => m.mode)).toEqual(['NIGHT_LOCK', 'MORNING_LOCK', 'EVENING_FREE', 'WORK']);
    const iphone = r.corps.appareils.find((a: { nom: string }) => a.nom === 'iphone');
    expect(iphone.mode).toBe('WORK');
    expect(iphone.parcours[1]).toMatchObject({ mode: 'MORNING_LOCK', applicable: false, actif: false });
    expect(iphone.sortie).toEqual({ texte: 'à 19:30', certaine: true, au_plus_tard: MARDI.ouverture });
  });

  it('sortie : nuit, certaine au lever', async () => {
    horloge.regler('2026-11-03T21:00:00Z');
    const pc = (await api.get('/v1/statut', web)).corps.appareils[0];
    expect(pc.mode).toBe('NIGHT_LOCK');
    expect(pc.sortie).toEqual({ texte: 'au lever, 05:30', certaine: true, au_plus_tard: '2026-11-04T04:30:00Z' });
  });

  it('appareil principal : premier appareil si aucun PC n\'a de compte de travail', () => {
    const config = configExemple();
    config.appareils.pc_linux!.comptesDeTravail = [];
    expect(appareilPrincipal(config)).toBe('pc_linux');
    config.appareils.pc_windows!.comptesDeTravail = ['alice'];
    expect(appareilPrincipal(config)).toBe('pc_windows');
  });
});
