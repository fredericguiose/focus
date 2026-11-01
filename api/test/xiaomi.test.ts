import { describe, expect, it } from 'vitest';
import {
  CHEMIN_DONNEES,
  ErreurXiaomi,
  URL_CONNEXION,
  creerClientXiaomi,
  depuisBase64,
  hoteSante,
  nonceSigne,
  normaliserSommeil,
  rc4,
  signature,
  versBase64,
} from '../src/xiaomi';

const hex = (o: Uint8Array) => [...o].map((b) => b.toString(16).padStart(2, '0')).join('');
const SSECURITY = new Uint8Array(16).fill(7);
const LIEU = 'https://sts.hlth.io.mi.com/healthapp/sts?d=1';

const brut = (p: Record<string, unknown>, sid = 'bande', time = 1_793_000_000) => ({ sid, time, value: JSON.stringify(p) });
const NUIT = {
  bedtime: 1_792_965_600, // 2026-10-25T22:00:00Z
  wake_up_time: 1_792_994_400, // 2026-10-26T06:00:00Z
  duration: 480,
  awake_duration: 20,
  sleep_deep_duration: 90,
  sleep_light_duration: 270,
  sleep_rem_duration: 100,
  sleep_awake_duration: 20,
  sleep_score: 81,
  awake_count: 2,
  avg_hr: 58,
  min_hr: 49,
  max_hr: 77,
  avg_spo2: 0,
  is_uncomplete: false,
  has_stage: true,
  has_rem: 1,
  timezone: 4,
  sleep_algorithm_version: 3,
  // Désordonnée, avec une tranche vide et un code inconnu.
  items: [
    { start_time: 1_792_966_800, end_time: 1_792_968_600, state: 2 },
    { start_time: 1_792_965_600, end_time: 1_792_966_800, state: 3 },
    { start_time: 1_792_968_600, end_time: 1_792_968_600, state: 4 },
    { start_time: 1_792_968_600, end_time: 1_792_969_200, state: 9 },
  ],
};

/** Faux cloud Xiaomi : vérifie le chiffrement et la signature comme le ferait le serveur. */
function fauxCloud(o: { passToken?: string; pages?: unknown[][]; codeDonnees?: number; statutDonnees?: number } = {}) {
  const journal: { url: string; cookie: string | null; charges: Record<string, unknown>[] } = { url: '', cookie: null, charges: [] };
  const pages = o.pages ?? [[brut(NUIT)]];
  const f = async (url: string, init: RequestInit): Promise<Response> => {
    const entetes = new Headers(init.headers);
    if (url === URL_CONNEXION) {
      // Comme le vrai compte : sans User-Agent, passToken refusé (70016).
      const valide =
        entetes.get('Cookie') === `userId=42; passToken=${o.passToken ?? 'bon'}` && (o.passToken ?? 'bon') === 'bon' && !!entetes.get('User-Agent');
      const corps = valide
        ? { code: 0, userId: 42, passToken: 'bon', ssecurity: versBase64(SSECURITY), location: LIEU }
        : { code: 70016, desc: 'login', location: 'https://account.xiaomi.com/pass/serviceLogin' };
      return new Response(`&&&START&&&${JSON.stringify(corps)}`);
    }
    if (url === LIEU) {
      const h = new Headers();
      h.append('Set-Cookie', 'serviceToken=st; Path=/; HttpOnly');
      h.append('Set-Cookie', 'cUserId=cu; Path=/');
      return new Response('ok', { headers: h });
    }
    journal.url = url;
    journal.cookie = entetes.get('Cookie');
    if (o.statutDonnees) return new Response('', { status: o.statutDonnees });
    const form = new URLSearchParams(String(init.body));
    const signe = await nonceSigne(SSECURITY, depuisBase64(form.get('_nonce')!));
    const chemin = new URL(url).pathname;
    const enClair = (k: string) => new TextDecoder().decode(rc4(signe, depuisBase64(form.get(k)!)));
    if (form.get('signature') !== (await signature(chemin, { data: form.get('data')!, rc4_hash__: form.get('rc4_hash__')! }, signe))) {
      return new Response('', { status: 400 });
    }
    const data = enClair('data');
    if (enClair('rc4_hash__') !== (await signature(chemin, { data }, signe))) return new Response('', { status: 400 });
    const charge = JSON.parse(data) as Record<string, unknown>;
    journal.charges.push(charge);
    const n = journal.charges.length;
    const reponse =
      o.codeDonnees !== undefined
        ? { code: o.codeDonnees, message: 'session expired' }
        : { code: 0, result: { data_list: pages[n - 1] ?? [], has_more: n < pages.length, next_key: n < pages.length ? `p${n}` : '' } };
    return new Response(versBase64(rc4(signe, new TextEncoder().encode(JSON.stringify(reponse)))));
  };
  return { f, journal };
}

const client = (faux: ReturnType<typeof fauxCloud>, passToken = 'bon') =>
  creerClientXiaomi({ userId: '42', passToken, region: 'de', fetch: faux.f, maintenant: () => Date.parse('2026-11-01T12:00:00Z') });

const DEBUT = new Date('2026-10-29T12:00:00Z');
const FIN = new Date('2026-11-01T13:00:00Z');

describe('client Xiaomi', () => {
  it('RC4 : vecteur de référence (sans abandon) et symétrie avec abandon', () => {
    expect(hex(rc4(new TextEncoder().encode('Key'), new TextEncoder().encode('Plaintext'), 0))).toBe('bbf316e8d940af0ad3');
    const cle = new Uint8Array([1, 2, 3]);
    const clair = new TextEncoder().encode('{"a":1}');
    expect(rc4(cle, rc4(cle, clair))).toEqual(clair);
  });

  it('hôte par région', () => {
    expect(hoteSante('de')).toBe('https://de.hlth.io.mi.com');
    expect(hoteSante('')).toBe('https://hlth.io.mi.com');
    expect(hoteSante('cn')).toBe('https://hlth.io.mi.com');
    expect(() => hoteSante('de.evil.com/')).toThrow(ErreurXiaomi);
  });

  it('se connecte, signe, chiffre et lit les sessions de la plage', async () => {
    const faux = fauxCloud();
    const sessions = await client(faux).sessionsSommeil(DEBUT, FIN);
    expect(faux.journal.url).toBe(`https://de.hlth.io.mi.com${CHEMIN_DONNEES}`);
    expect(faux.journal.cookie).toBe('serviceToken=st; cUserId=cu');
    expect(faux.journal.charges[0]).toEqual({ start_time: DEBUT.getTime() / 1000, end_time: FIN.getTime() / 1000, key: 'sleep' });
    expect(sessions).toEqual([
      {
        id: 'bande_1793000000',
        debut: '2026-10-25T22:00:00Z',
        fin: '2026-10-26T06:00:00Z',
        endormi_min: 460,
        eveille_min: 20,
        phases: { legere: 270, profonde: 90, rem: 100, eveil: 20 },
        score: 81,
        sieste: false,
        supprimee: false,
        complements: {
          chronologie: [
            { debut: '2026-10-25T22:00:00Z', fin: '2026-10-25T22:20:00Z', etat: 3, phase: 'legere' },
            { debut: '2026-10-25T22:20:00Z', fin: '2026-10-25T22:50:00Z', etat: 2, phase: 'profonde' },
            { debut: '2026-10-25T22:50:00Z', fin: '2026-10-25T23:00:00Z', etat: 9, phase: null },
          ],
          reveils: 2,
          frequence_cardiaque: { moyenne: 58, min: 49, max: 77 },
          spo2: null,
          qualite_respiration: null,
          incomplete: false,
          avec_phases: true,
          avec_rem: true,
          fuseau_xiaomi: 4,
          version_algorithme: 3,
        },
      },
    ]);
  });

  it('suit la pagination', async () => {
    const faux = fauxCloud({ pages: [[brut(NUIT, 'a')], [brut(NUIT, 'b')], [brut(NUIT, 'c')]] });
    const sessions = await client(faux).sessionsSommeil(DEBUT, FIN);
    expect(sessions.map((s) => s.id.split('_')[0])).toEqual(['a', 'b', 'c']);
    expect(faux.journal.charges.map((c) => c.next_key)).toEqual([undefined, 'p1', 'p2']);
  });

  it('passToken refusé → jeton_xiaomi_expire, sans le jeton dans le message', async () => {
    const e = await client(fauxCloud({ passToken: 'perime' }), 'perime').sessionsSommeil(DEBUT, FIN).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErreurXiaomi);
    expect((e as ErreurXiaomi).code).toBe('jeton_xiaomi_expire');
    expect((e as Error).message).not.toContain('perime');
  });

  it('session de service refusée → jeton_xiaomi_expire ; panne → xiaomi_indisponible', async () => {
    const auth = await client(fauxCloud({ codeDonnees: 401 })).sessionsSommeil(DEBUT, FIN).catch((x: unknown) => x);
    expect((auth as ErreurXiaomi).code).toBe('jeton_xiaomi_expire');
    const http = await client(fauxCloud({ statutDonnees: 403 })).sessionsSommeil(DEBUT, FIN).catch((x: unknown) => x);
    expect((http as ErreurXiaomi).code).toBe('jeton_xiaomi_expire');
    const panne = await client(fauxCloud({ statutDonnees: 502 })).sessionsSommeil(DEBUT, FIN).catch((x: unknown) => x);
    expect((panne as ErreurXiaomi).code).toBe('xiaomi_indisponible');
    const reseau = creerClientXiaomi({ userId: '42', passToken: 'bon', fetch: () => Promise.reject(new Error('dns')) });
    expect(((await reseau.sessionsSommeil(DEBUT, FIN).catch((x: unknown) => x)) as ErreurXiaomi).code).toBe('xiaomi_indisponible');
  });
});

describe('normalisation d\'une session', () => {
  it('sans phases : endormi = durée − éveil, score nul ignoré', () => {
    const s = normaliserSommeil(brut({ bedtime: 1_793_000_000, wake_up_time: 1_793_001_800, duration: 30, awake_duration: 5, score: 0, is_nap: true }));
    expect(s).toMatchObject({ endormi_min: 25, eveille_min: 5, phases: null, score: null, sieste: true });
  });

  it('sans bornes ou valeur illisible : ignorée ; supprimée : marquée', () => {
    expect(normaliserSommeil(brut({ duration: 30 }))).toBeNull();
    expect(normaliserSommeil({ sid: 'x', time: 1, value: '{pas du json' })).toBeNull();
    expect(normaliserSommeil({ ...brut(NUIT), deleted: true })?.supprimee).toBe(true);
  });
});
