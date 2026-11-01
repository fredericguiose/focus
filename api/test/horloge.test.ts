import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moteur } from '../../core/src/index';
import { creerApp } from '../src/app';
import { HorlogeLocale, lireReglage, type VariablesHorloge } from '../src/horloge';
import { MARDI, creerJeton, installerConfig, todoistInterdit } from './aides';
import { env } from 'cloudflare:workers';

const REELLE = Date.parse(MARDI.matin);
const reelle = () => new Date(REELLE);

describe('lireReglage', () => {
  it('décalages et instants', () => {
    expect(lireReglage('+3h')).toEqual({ decalageMs: 3 * 3_600_000 });
    expect(lireReglage('-90min')).toEqual({ decalageMs: -90 * 60_000 });
    expect(lireReglage('+1h30')).toEqual({ decalageMs: 90 * 60_000 });
    expect(lireReglage('2026-11-03T21:00:00Z')).toEqual({ fixe: Date.parse('2026-11-03T21:00:00Z') });
    for (const faux of ['3h', '+', 'demain', '2026-11-03', '+3j']) expect(lireReglage(faux)).toBeUndefined();
  });
});

describe('HorlogeLocale', () => {
  afterEach(() => vi.restoreAllMocks());

  it('hors local : horloge réelle, variable ignorée avec un avertissement (une fois)', () => {
    const averti = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const FOCUS_ENVIRONNEMENT of [undefined, 'production', 'LOCAL']) {
      const h = new HorlogeLocale(() => ({ FOCUS_ENVIRONNEMENT, FOCUS_HORLOGE: '+3h' }), reelle);
      expect(h.maintenant().toISOString()).toBe(new Date(REELLE).toISOString());
      h.maintenant();
    }
    expect(averti).toHaveBeenCalledTimes(3);
    expect(averti.mock.calls[0]![0]).toMatch(/FOCUS_HORLOGE ignorée/);
  });

  it('en local : décalage, instant figé, réglage à chaud prioritaire, null = heure réelle', () => {
    const variables: VariablesHorloge = { FOCUS_ENVIRONNEMENT: 'local', FOCUS_HORLOGE: '+3h' };
    const h = new HorlogeLocale(() => variables, reelle);
    expect(h.maintenant().getTime()).toBe(REELLE + 3 * 3_600_000);
    variables.FOCUS_HORLOGE = '2026-11-03T21:49:00Z';
    expect(h.maintenant().toISOString()).toBe('2026-11-03T21:49:00.000Z');
    expect(h.regler('-90min')).toEqual({ reglage: '-90min', heure_serveur: '2026-11-03T08:30:00Z' });
    expect(h.regler(null)).toEqual({ reglage: null, heure_serveur: MARDI.matin });
    expect(() => h.regler('demain')).toThrow(/horloge/);
  });

  it('un réglage à chaud ne survit pas à un passage hors local', () => {
    const variables: VariablesHorloge = { FOCUS_ENVIRONNEMENT: 'local' };
    const h = new HorlogeLocale(() => variables, reelle);
    h.regler('+3h');
    variables.FOCUS_ENVIRONNEMENT = 'production';
    expect(h.maintenant().getTime()).toBe(REELLE);
  });
});

describe('POST /v1/dev/horloge', () => {
  let web: string;
  beforeEach(async () => {
    await installerConfig();
    web = await creerJeton('interface', 'web');
  });

  function appAvec(variables: VariablesHorloge) {
    const horloge = new HorlogeLocale(() => variables, reelle);
    const app = creerApp({ moteur, maintenant: horloge.maintenant, horloge, todoist: todoistInterdit });
    const appeler = async (methode: string, chemin: string, corps?: unknown) => {
      const r = await app.request(
        chemin,
        {
          method: methode,
          headers: { Authorization: `Bearer ${web}`, 'Content-Type': 'application/json' },
          ...(corps !== undefined ? { body: JSON.stringify(corps) } : {}),
        },
        env,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { statut: r.status, corps: (await r.json()) as any };
    };
    return appeler;
  }

  it('404 hors environnement local, même avec un jeton valide ; horloge réelle', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const FOCUS_ENVIRONNEMENT of [undefined, 'production']) {
      const appeler = appAvec({ FOCUS_ENVIRONNEMENT, FOCUS_HORLOGE: '+3h' });
      const r = await appeler('POST', '/v1/dev/horloge', { horloge: '+3h' });
      expect(r.statut).toBe(404);
      expect(r.corps.erreur).toBe('introuvable');
      expect((await appeler('GET', '/v1/statut')).corps.heure_serveur).toBe(MARDI.matin);
    }
    vi.restoreAllMocks();
  });

  it('en local : FOCUS_HORLOGE, puis réglage à chaud ; le statut suit', async () => {
    const appeler = appAvec({ FOCUS_ENVIRONNEMENT: 'local', FOCUS_HORLOGE: '+3h' });
    expect((await appeler('GET', '/v1/statut')).corps.heure_serveur).toBe('2026-11-03T13:00:00Z');
    const r = await appeler('POST', '/v1/dev/horloge', { horloge: '2026-11-03T21:49:00Z' });
    expect(r).toEqual({ statut: 200, corps: { environnement: 'local', reglage: '2026-11-03T21:49:00Z', heure_serveur: '2026-11-03T21:49:00Z' } });
    const statut = await appeler('GET', '/v1/statut');
    expect(statut.corps).toMatchObject({ heure_serveur: '2026-11-03T21:49:00Z', phase: 'nuit' });
    expect((await appeler('POST', '/v1/dev/horloge', { horloge: null })).corps.heure_serveur).toBe(MARDI.matin);
    expect((await appeler('POST', '/v1/dev/horloge', { horloge: 'demain' })).statut).toBe(400);
    expect((await appeler('POST', '/v1/dev/horloge', {})).statut).toBe(400);
  });
});
