import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { Horloge, MARDI, client, creerJeton, installerConfig } from './aides';

const RAISON = 'Une raison suffisamment longue pour dépasser les cinquante caractères.';
const PHRASE = 'JE NE PEUX PAS DECALER';
const nombre = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM exceptions').first<{ n: number }>())!.n;

describe('exceptions (§3.4)', () => {
  const horloge = Horloge.a(MARDI.matin);
  const api = client(horloge);
  let web: string;

  beforeEach(async () => {
    horloge.regler(MARDI.matin);
    await installerConfig();
    web = await creerJeton('interface', 'web');
  });

  it("l'aperçu calcule le prix sans rien enregistrer", async () => {
    const r = await api.post('/v1/exceptions/prix', web, { type: 'coucher', nuit: '2026-11-03', heure: '22:00', raison: RAISON });
    expect(r.statut).toBe(200);
    expect(r.corps.prix).toMatchObject({
      admissible: true,
      friction: 'raison',
      resserre: false,
      coucher_avant: MARDI.coucher,
      coucher_apres: '2026-11-03T21:00:00Z',
    });
    expect(await nombre()).toBe(0);
  });

  it("avant l'ouverture, desserrer sans raison suffisante est refusé (422), sans écrire", async () => {
    const demande = { type: 'coucher', nuit: '2026-11-03', heure: '22:00' };
    const sans = await api.post('/v1/exceptions', web, demande);
    expect(sans.statut).toBe(422);
    expect(sans.corps).toMatchObject({
      erreur: 'exception_refusee',
      message: "raison d'au moins 50 caractères exigée (0 fournis)",
      prix: { admissible: false, friction: 'raison', friction_manquante: true },
    });
    const courte = await api.post('/v1/exceptions', web, { ...demande, raison: 'trop court' });
    expect(courte.corps.message).toBe("raison d'au moins 50 caractères exigée (10 fournis)");
    expect(await nombre()).toBe(0);
  });

  it("l'enregistrement applique les mêmes règles et écrit la raison ; la journée en tient compte", async () => {
    const r = await api.post('/v1/exceptions', web, { type: 'coucher', nuit: '2026-11-03', heure: '22:00', raison: RAISON });
    expect(r.statut).toBe(201);
    expect(r.corps.id).toMatch(/^e_/);
    expect(r.corps.prix).toMatchObject({ friction: 'raison', friction_manquante: false });
    expect(await env.DB.prepare('SELECT pendant_nuit, raison FROM exceptions').first()).toEqual({ pendant_nuit: 0, raison: RAISON });
    // Sans limite par nuit : une seconde exception avant l'ouverture passe aussi.
    expect((await api.post('/v1/exceptions', web, { type: 'coucher', nuit: '2026-11-03', heure: '22:10', raison: RAISON })).statut).toBe(201);
    expect(await nombre()).toBe(2);
    const statut = await api.get('/v1/statut', web);
    expect(statut.corps.journee.coucher_applique).toBe('2026-11-03T21:10:00Z');
  });

  it('refuse (422) ce que le moteur juge inadmissible, sans écrire', async () => {
    const demande = { type: 'coucher', nuit: '2026-11-03', heure: '23:30', raison: RAISON };
    const apercu = await api.post('/v1/exceptions/prix', web, demande);
    expect(apercu.corps.prix.admissible).toBe(false);
    const r = await api.post('/v1/exceptions', web, demande);
    expect(r.statut).toBe(422);
    expect(r.corps).toMatchObject({ erreur: 'exception_refusee', prix: { admissible: false } });
    expect(await nombre()).toBe(0);
  });

  it("après l'ouverture : friction exigée, décision de nuit enregistrée une fois", async () => {
    horloge.regler('2026-11-03T19:00:00Z');
    const demande = { type: 'coucher', nuit: '2026-11-03', heure: '22:00' };
    const sans = await api.post('/v1/exceptions', web, demande);
    expect(sans.statut).toBe(422);
    expect(sans.corps.prix.friction).toBe('raison_phrase');
    const avec = await api.post('/v1/exceptions', web, { ...demande, raison: RAISON, phrase: PHRASE });
    expect(avec.statut).toBe(201);
    const ligne = await env.DB.prepare('SELECT pendant_nuit, raison, jour FROM exceptions').first();
    expect(ligne).toEqual({ pendant_nuit: 1, raison: RAISON, jour: '2026-11-03' });
    const encore = await api.post('/v1/exceptions', web, { ...demande, heure: '22:15', raison: RAISON, phrase: PHRASE });
    expect(encore.statut).toBe(422);
  });

  it('resserrer est toujours permis, même la nuit ; « je vais dormir » prend l’heure du serveur', async () => {
    horloge.regler('2026-11-03T19:10:00Z');
    const r = await api.post('/v1/exceptions', web, { type: 'avancer_coucher', a: '2030-01-01T00:00:00Z' });
    expect(r.statut).toBe(201);
    expect(r.corps.demande).toEqual({ type: 'avancer_coucher', nuit: '2026-11-03', a: '2026-11-03T19:10:00Z' });
    expect(r.corps.prix).toMatchObject({ resserre: true, friction: 'aucune' });
  });

  it('valide la forme de la demande (400)', async () => {
    expect((await api.post('/v1/exceptions/prix', web, { type: 'inconnu' })).statut).toBe(400);
    expect((await api.post('/v1/exceptions/prix', web, { type: 'coucher', nuit: '03/11/2026', heure: '22:00' })).statut).toBe(400);
    expect((await api.post('/v1/exceptions/prix', web, { type: 'ajoute', date: '2026-11-04', libelle: 'x' })).statut).toBe(400);
    expect((await api.post('/v1/exceptions/prix', web, { type: 'ajoute', date: '2026-11-04', libelle: 'x', heure: '08:00', obligatoire: 'non' })).statut).toBe(400);
    expect((await api.post('/v1/exceptions/prix', web, { type: 'decale', date: '2026-11-04', engagement: 'sport', heure: '07:00', preparation_min: -1 })).statut).toBe(400);
  });

  it('ajout facultatif : le retirer ensuite est libre', async () => {
    await api.post('/v1/exceptions', web, { type: 'ajoute', date: '2026-11-04', libelle: 'Dentiste', heure: '08:00', obligatoire: false });
    const r = await api.post('/v1/exceptions/prix', web, { type: 'retire', date: '2026-11-04', engagement: 'Dentiste' });
    expect(r.corps.demande).toEqual({ type: 'retire', date: '2026-11-04', engagement: 'Dentiste' });
    expect(r.corps.prix).toMatchObject({ admissible: true, friction: 'aucune' });
  });

  it('décaler avec une préparation : renvoyée en preparation_min', async () => {
    const r = await api.post('/v1/exceptions/prix', web, { type: 'decale', date: '2026-11-04', engagement: 'sport', heure: '05:30', preparation_min: 10 });
    expect(r.corps.demande).toEqual({ type: 'decale', date: '2026-11-04', engagement: 'sport', heure: '05:30', preparation_min: 10 });
    expect(r.corps.prix).toMatchObject({ admissible: true, resserre: true, friction: 'aucune' });
  });

  it('retirer un engagement : le lever du lendemain recule', async () => {
    const r = await api.post('/v1/exceptions/prix', web, { type: 'retire', date: '2026-11-04', engagement: 'sport', raison: RAISON });
    expect(r.corps.prix).toMatchObject({ admissible: true, friction: 'raison', lever_avant: '2026-11-04T04:30:00Z', lever_apres: '2026-11-04T05:30:00Z' });
  });
});
