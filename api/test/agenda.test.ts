// Bloc « Dormir » dans Google Agenda (CDC 02/11, docs/conception.md §4.4) : client (fetch simulé)
// et synchro (client simulé) : création, écriture seulement si l'heure change, nuit passée jamais
// touchée, jeton révoqué → état d'erreur, sans config → désactivée, cadence, signal et verrou.
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moteur } from '../../core/src/index';
import type { Moteur } from '../../core/src/types';
import { type EtatAgenda, nuitsVoulues, reglagesGoogle, synchroniserAgenda } from '../src/agenda';
import { chargerContexte, lireCache } from '../src/contexte';
import type { Liaisons } from '../src/env';
import { type ClientAgenda, ErreurAgenda, type IdentifiantsGoogle, type NuitAgenda, URL_EVENEMENTS, URL_JETON_GOOGLE, creerClientAgenda, idEvenementNuit } from '../src/google-agenda';
import { executerTachesPlanifiees } from '../src/planifie';
import { Horloge, MARDI, client, creerJeton, installerConfig } from './aides';

const IDS: IdentifiantsGoogle = { clientId: 'client-id', clientSecret: 'secret-du-client', refreshToken: 'refresh-initial' };
const SECRETS = {
  GOOGLE_CLIENT_ID: IDS.clientId,
  GOOGLE_CLIENT_SECRET: IDS.clientSecret,
  GOOGLE_REFRESH_TOKEN: IDS.refreshToken,
  GOOGLE_UTILISATEUR: 'alice',
  CLE_CHIFFREMENT: 'cle-de-test-0123456789',
};

const json = (statut: number, corps: unknown) => new Response(JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json' } });

describe('client Google Agenda (fetch simulé)', () => {
  const nuit: NuitAgenda = { nuit: '2026-11-03', debut: '2026-11-03T20:30:00Z', fin: '2026-11-04T05:30:00Z', fuseau: 'Europe/Paris' };

  function faux(reponses: ((url: string, init: RequestInit) => Response)[]) {
    const appels: { url: string; init: RequestInit }[] = [];
    const fetch = async (url: string, init: RequestInit) => {
      appels.push({ url, init });
      const r = reponses.shift();
      if (!r) throw new Error(`appel inattendu : ${init.method} ${url}`);
      return r(url, init);
    };
    return { appels, fetch };
  }

  it('id déterministe base32hex, corps complet (titre, fuseau, sans rappel, opaque, propriétés privées)', async () => {
    expect(idEvenementNuit('2026-11-03')).toBe('focussommeil20261103');
    expect(idEvenementNuit('2026-11-03')).toMatch(/^[a-v0-9]{5,1024}$/);
    const f = faux([() => json(200, { access_token: 'acces-1', expires_in: 3599 }), () => json(200, { id: 'focussommeil20261103' })]);
    await creerClientAgenda({ ...IDS, fetch: f.fetch }).ecrireNuit(nuit);
    expect(f.appels[0]!.url).toBe(URL_JETON_GOOGLE);
    const formulaire = new URLSearchParams(String(f.appels[0]!.init.body));
    expect(Object.fromEntries(formulaire)).toEqual({
      grant_type: 'refresh_token', refresh_token: 'refresh-initial', client_id: 'client-id', client_secret: 'secret-du-client',
    });
    expect(f.appels[1]!.url).toBe(`${URL_EVENEMENTS}/focussommeil20261103`);
    expect(f.appels[1]!.init.method).toBe('PUT');
    expect((f.appels[1]!.init.headers as Record<string, string>).Authorization).toBe('Bearer acces-1');
    expect(JSON.parse(String(f.appels[1]!.init.body))).toEqual({
      id: 'focussommeil20261103',
      status: 'confirmed',
      summary: 'Dormir',
      description: 'Tenu à jour par Focus',
      start: { dateTime: nuit.debut, timeZone: 'Europe/Paris' },
      end: { dateTime: nuit.fin, timeZone: 'Europe/Paris' },
      transparency: 'opaque',
      reminders: { useDefault: false, overrides: [] },
      extendedProperties: { private: { focus: 'sommeil', focusNuit: '2026-11-03' } },
    });
  });

  it('événement absent (404 au PUT) : créé par POST avec le même id ; un seul jeton pour deux nuits', async () => {
    const f = faux([
      () => json(200, { access_token: 'a' }),
      () => json(404, { error: { errors: [{ reason: 'notFound' }], code: 404 } }),
      () => json(200, {}),
      () => json(200, {}),
    ]);
    const c = creerClientAgenda({ ...IDS, fetch: f.fetch });
    await c.ecrireNuit(nuit);
    await c.ecrireNuit({ ...nuit, nuit: '2026-11-04' });
    expect(f.appels.map((a) => `${a.init.method} ${a.url.replace(URL_EVENEMENTS, '')}`)).toEqual([
      `POST ${URL_JETON_GOOGLE}`,
      'PUT /focussommeil20261103',
      'POST ',
      'PUT /focussommeil20261104',
    ]);
    expect(JSON.parse(String(f.appels[2]!.init.body)).id).toBe('focussommeil20261103');
  });

  it('suppression : 404 ou 410 (déjà supprimé) ne sont pas des erreurs', async () => {
    const f = faux([() => json(200, { access_token: 'a' }), () => new Response(null, { status: 410 })]);
    await creerClientAgenda({ ...IDS, fetch: f.fetch }).supprimerNuit('2026-11-05');
    expect(f.appels[1]!.init.method).toBe('DELETE');
    expect(f.appels[1]!.url).toBe(`${URL_EVENEMENTS}/focussommeil20261105`);
  });

  it('erreurs : invalid_grant, 401, quota, 403, client refusé, réseau ; jamais de secret dans le message', async () => {
    const cas: [Response[], string][] = [
      [[json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })], 'jeton_google_revoque'],
      [[json(401, { error: 'invalid_client' })], 'client_google_refuse'],
      [[json(200, { access_token: 'a' }), json(401, { error: { errors: [{ reason: 'authError' }] } })], 'jeton_google_revoque'],
      [[json(200, { access_token: 'a' }), json(403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } })], 'google_quota'],
      [[json(200, { access_token: 'a' }), json(429, {})], 'google_quota'],
      [[json(200, { access_token: 'a' }), json(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } })], 'google_acces_refuse'],
      [[json(200, { access_token: 'a' }), json(503, {})], 'google_indisponible'],
      [[json(200, {})], 'google_reponse_invalide'],
    ];
    for (const [reponses, code] of cas) {
      const f = faux(reponses.map((r) => () => r));
      const e = await creerClientAgenda({ ...IDS, fetch: f.fetch }).ecrireNuit(nuit).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ErreurAgenda);
      expect((e as ErreurAgenda).code).toBe(code);
      expect((e as ErreurAgenda).message).not.toMatch(/secret-du-client|refresh-initial|acces-1/);
    }
    const panne = creerClientAgenda({ ...IDS, fetch: async () => { throw new TypeError('réseau'); } });
    await expect(panne.ecrireNuit(nuit)).rejects.toMatchObject({ code: 'google_indisponible' });
  });

  it('nouveau refresh token renvoyé par Google : exposé (pour être gardé chiffré)', async () => {
    const f = faux([() => json(200, { access_token: 'a', refresh_token: 'refresh-neuf' }), () => json(200, {})]);
    const c = creerClientAgenda({ ...IDS, fetch: f.fetch });
    expect(c.refreshTokenRecu!()).toBeNull();
    await c.ecrireNuit(nuit);
    expect(c.refreshTokenRecu!()).toBe('refresh-neuf');
  });
});

/** Client simulé : journal des appels, panne réglable par refresh token. */
function fauxAgenda() {
  const appels: string[] = [];
  const ecrits: NuitAgenda[] = [];
  const refuses = new Set<string>();
  let recu: string | null = null;
  const jetonsUtilises: string[] = [];
  const fabrique = (ids: IdentifiantsGoogle): ClientAgenda => {
    const verifier = () => {
      jetonsUtilises.push(ids.refreshToken);
      if (refuses.has(ids.refreshToken)) throw new ErreurAgenda('jeton_google_revoque', 'jeton : invalid_grant');
    };
    return {
      async ecrireNuit(n) {
        verifier();
        appels.push(`ecrire ${n.nuit}`);
        ecrits.push(n);
      },
      async supprimerNuit(nuit) {
        verifier();
        appels.push(`supprimer ${nuit}`);
      },
      refreshTokenRecu: () => recu,
    };
  };
  return { appels, ecrits, refuses, jetonsUtilises, fabrique, recevoir: (j: string | null) => (recu = j) };
}

/** Moteur dont le coucher appliqué d'une nuit est décalé (simule une exception). */
function moteurDecale(decalages: Record<string, number>): Moteur {
  const decaler = <J extends { date: string; coucherApplique: string }>(j: J): J => {
    const m = decalages[j.date];
    return m ? { ...j, coucherApplique: new Date(Date.parse(j.coucherApplique) + m * 60_000).toISOString().replace('.000Z', 'Z') } : j;
  };
  return { ...moteur, journee: (c, d) => decaler(moteur.journee(c, d)), journeeCourante: (c) => decaler(moteur.journeeCourante(c)) };
}

const etat = async () => (await lireCache<EtatAgenda>(env.DB, 'alice', 'synchro_agenda'))?.valeur;

describe('synchro du bloc « Dormir »', () => {
  const reglages = reglagesGoogle({ DB: env.DB, ...SECRETS })!;
  let faux: ReturnType<typeof fauxAgenda>;
  const passer = async (instant: string, m: Moteur = moteur) => {
    const t = new Date(instant);
    const { contexte } = await chargerContexte(env.DB, 'alice', t);
    return synchroniserAgenda(env.DB, faux.fabrique, reglages, m, contexte, t);
  };

  beforeEach(async () => {
    faux = fauxAgenda();
    await installerConfig();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('sans les 4 variables : désactivée', () => {
    expect(reglagesGoogle({ DB: env.DB })).toBeNull();
    for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_UTILISATEUR'] as const) {
      expect(reglagesGoogle({ DB: env.DB, ...SECRETS, [k]: ' ' })).toBeNull();
    }
    expect(reglagesGoogle({ DB: env.DB, ...SECRETS, CLE_CHIFFREMENT: undefined })?.cle).toBeNull();
  });

  it('fenêtre : nuit de ce soir et la suivante, du coucher appliqué au lever prévu, fuseau de la routine', async () => {
    const t = new Date(MARDI.matin);
    const { contexte } = await chargerContexte(env.DB, 'alice', t);
    const nuits = nuitsVoulues(moteur, contexte, t);
    expect(nuits.map((n) => n.nuit)).toEqual(['2026-11-03', '2026-11-04']);
    expect(nuits[0]).toEqual({ nuit: '2026-11-03', debut: MARDI.coucher, fin: moteur.journee(contexte, '2026-11-04').lever, fuseau: 'Europe/Paris' });
  });

  it('crée les deux nuits, puis n’écrit plus tant que l’heure ne change pas ; seule la nuit changée est réécrite', async () => {
    const e1 = await passer(MARDI.matin);
    expect(faux.appels).toEqual(['ecrire 2026-11-03', 'ecrire 2026-11-04']);
    expect(e1).toMatchObject({ erreur: null, reussie_le: MARDI.matin });
    expect(Object.keys(e1!.nuits)).toEqual(['2026-11-03', '2026-11-04']);
    await passer('2026-11-03T10:15:00Z');
    expect(faux.appels).toHaveLength(2);
    await passer('2026-11-03T10:30:00Z', moteurDecale({ '2026-11-03': 30 }));
    expect(faux.appels).toEqual(['ecrire 2026-11-03', 'ecrire 2026-11-04', 'ecrire 2026-11-03']);
    expect(faux.ecrits.at(-1)!.debut).toBe('2026-11-03T21:00:00Z');
    expect((await etat())!.nuits['2026-11-03']!.debut).toBe('2026-11-03T21:00:00Z');
  });

  it('nuit passée (lever atteint) : jamais réécrite ni supprimée, retirée de l’état ; la nouvelle nuit entre', async () => {
    await passer(MARDI.matin);
    faux.appels.length = 0;
    // Mercredi midi : la nuit du 03 est finie ; même si son coucher « changeait », rien n'est écrit pour elle.
    await passer('2026-11-04T11:00:00Z', moteurDecale({ '2026-11-03': 45 }));
    expect(faux.appels).toEqual(['ecrire 2026-11-05']);
    expect(Object.keys((await etat())!.nuits)).toEqual(['2026-11-04', '2026-11-05']);
  });

  it('nuit future sortie de la fenêtre (horloge reculée) : supprimée chez Google', async () => {
    await passer('2026-11-04T11:00:00Z');
    faux.appels.length = 0;
    await passer(MARDI.matin);
    expect(faux.appels).toEqual(['ecrire 2026-11-03', 'supprimer 2026-11-05']);
    expect(Object.keys((await etat())!.nuits).sort()).toEqual(['2026-11-03', '2026-11-04']);
  });

  it('jeton révoqué : état d’erreur (statut), rien de noté comme écrit ; réessai une fois réparé', async () => {
    faux.refuses.add('refresh-initial');
    await expect(passer(MARDI.matin)).rejects.toMatchObject({ code: 'jeton_google_revoque' });
    expect(await etat()).toMatchObject({ erreur: 'jeton_google_revoque', reussie_le: null, nuits: {} });
    const web = await creerJeton('interface', 'web');
    const s = await client(Horloge.a(MARDI.matin)).get('/v1/statut', web);
    expect(s.corps.agenda).toEqual({ derniere_synchro: null, erreur: 'jeton_google_revoque' });
    faux.refuses.clear();
    await passer('2026-11-03T10:15:00Z');
    expect(await etat()).toMatchObject({ erreur: null, reussie_le: '2026-11-03T10:15:00Z' });
  });

  it('refresh token renvoyé : gardé chiffré et utilisé en priorité ; refusé, oublié et repli sur le secret', async () => {
    faux.recevoir('refresh-neuf');
    await passer(MARDI.matin);
    const garde = await env.DB.prepare(`SELECT valeur FROM cache_todoist WHERE cle = 'jeton_google'`).first<{ valeur: string }>();
    expect(garde!.valeur).not.toContain('refresh-neuf');
    faux.recevoir(null);
    faux.jetonsUtilises.length = 0;
    await passer('2026-11-03T10:30:00Z', moteurDecale({ '2026-11-03': 10 }));
    expect(faux.jetonsUtilises).toEqual(['refresh-neuf']);
    faux.refuses.add('refresh-neuf');
    faux.jetonsUtilises.length = 0;
    await passer('2026-11-03T10:45:00Z', moteurDecale({ '2026-11-03': 20 }));
    expect(faux.jetonsUtilises).toEqual(['refresh-neuf', 'refresh-initial']);
    expect(await env.DB.prepare(`SELECT 1 FROM cache_todoist WHERE cle = 'jeton_google'`).first()).toBeNull();
    expect((await etat())!.erreur).toBeNull();
  });

  it('verrou : un second passage simultané ne fait rien', async () => {
    let liberer: () => void = () => {};
    const attente = new Promise<void>((ok) => (liberer = ok));
    let ecritures = 0;
    const lent = (): ClientAgenda => ({
      async ecrireNuit() {
        ecritures++;
        await attente;
      },
      async supprimerNuit() {},
    });
    const t = new Date(MARDI.matin);
    const { contexte } = await chargerContexte(env.DB, 'alice', t);
    const premier = synchroniserAgenda(env.DB, lent, reglages, moteur, contexte, t);
    await new Promise((ok) => setTimeout(ok, 20));
    expect(await synchroniserAgenda(env.DB, lent, reglages, moteur, contexte, t)).toBeNull();
    liberer();
    expect(await premier).not.toBeNull();
    expect(ecritures).toBe(2);
  });
});

describe('agenda dans la tâche planifiée', () => {
  const horloge = Horloge.a(MARDI.matin);
  let faux: ReturnType<typeof fauxAgenda>;
  const lancer = (variables: Partial<Liaisons> = SECRETS) =>
    executerTachesPlanifiees({ ...env, ...variables }, { ...client(horloge).deps, agenda: faux.fabrique });

  beforeEach(async () => {
    horloge.regler(MARDI.matin);
    faux = fauxAgenda();
    await installerConfig();
  });

  it('sans les secrets, ou pour un autre utilisateur : aucun appel', async () => {
    await lancer({});
    await lancer({ ...SECRETS, GOOGLE_UTILISATEUR: 'bob' });
    expect(faux.jetonsUtilises).toEqual([]);
    expect(await etat()).toBeUndefined();
  });

  it('cadence 15 min par défaut ; un changement signalé (exception) passe à la minute suivante', async () => {
    const passages: number[] = [];
    let avant = (await etat())?.tentee_le;
    const minute = async (m: number) => {
      await lancer();
      const e = await etat();
      if (e?.tentee_le !== avant) passages.push(m);
      avant = e?.tentee_le;
      horloge.avancer(60);
    };
    for (let m = 0; m < 31; m++) await minute(m);
    expect(passages).toEqual([0, 15, 30]);
    expect(faux.appels).toEqual(['ecrire 2026-11-03', 'ecrire 2026-11-04']);

    // Exception à 10:31:30 : coucher de ce soir à 22:00 locales.
    const web = await creerJeton('interface', 'web');
    horloge.avancer(30);
    const r = await client(horloge).post('/v1/exceptions', web, {
      type: 'coucher', nuit: '2026-11-03', heure: '22:00', raison: 'Une raison suffisamment longue pour dépasser les cinquante caractères.',
    });
    expect(r.statut).toBe(201);
    horloge.avancer(30);
    await lancer();
    expect(faux.appels.at(-1)).toBe('ecrire 2026-11-03');
    expect(faux.ecrits.at(-1)!.debut).toBe('2026-11-03T21:00:00Z');
    // Signal traité : effacé ; la minute suivante ne repasse pas.
    expect(await env.DB.prepare(`SELECT 1 FROM cache_todoist WHERE cle = 'agenda_a_refaire'`).first()).toBeNull();
    const t = (await etat())!.tentee_le;
    horloge.avancer(60);
    await lancer();
    expect((await etat())!.tentee_le).toBe(t);
  });

  it('cadence réglable dans le YAML (synchro.google_agenda)', async () => {
    const r = moteur.validerConfig(`${(await import('./aides')).exempleYaml}\nsynchro: { google_agenda: "5min" }\n`);
    if (!r.ok) throw new Error(r.erreurs.join('\n'));
    await env.DB.prepare(`DELETE FROM config_versions`).run();
    await installerConfig(r.config);
    const passages: string[] = [];
    for (let m = 0; m < 11; m++) {
      await lancer();
      const e = await etat();
      if (e && !passages.includes(e.tentee_le)) passages.push(e.tentee_le);
      horloge.avancer(60);
    }
    expect(passages).toEqual(['2026-11-03T10:00:00Z', '2026-11-03T10:05:00Z', '2026-11-03T10:10:00Z']);
  });

  it('erreur : notée, journalisée, relancée à la cadence (pas à chaque minute)', async () => {
    const erreurs = vi.spyOn(console, 'error').mockImplementation(() => {});
    faux.refuses.add('refresh-initial');
    for (let m = 0; m < 16; m++) {
      await lancer().catch(() => {});
      horloge.avancer(60);
    }
    expect(faux.jetonsUtilises).toEqual(['refresh-initial', 'refresh-initial']);
    expect((await etat())!.erreur).toBe('jeton_google_revoque');
    expect(erreurs.mock.calls.flat().join(' ')).not.toMatch(/secret-du-client/);
    vi.restoreAllMocks();
  });
});
