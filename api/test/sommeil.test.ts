import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { executerTachesPlanifiees } from '../src/planifie';
import { nuitDeLaSession, rattacherAuxNuits, type SommeilMesure } from '../src/sommeil';
import { type ClientXiaomi, ErreurXiaomi, type SessionSommeil } from '../src/xiaomi';
import { Horloge, MARDI, client, creerJeton, installerConfig } from './aides';

const PARIS = 'Europe/Paris';

const COMPLEMENTS: SessionSommeil['complements'] = {
  chronologie: [{ debut: '2026-11-02T21:30:00Z', fin: '2026-11-02T22:00:00Z', etat: 3, phase: 'legere' }],
  reveils: 2,
  frequence_cardiaque: { moyenne: 58, min: 49, max: 77 },
  spo2: { moyenne: 96, min: 91, max: 99 },
  qualite_respiration: null,
  incomplete: false,
  avec_phases: true,
  avec_rem: true,
  fuseau_xiaomi: 4,
  version_algorithme: 3,
};

function session(p: Partial<SessionSommeil> & { id: string; debut: string; fin: string }): SessionSommeil {
  return {
    endormi_min: 420,
    eveille_min: 15,
    phases: { legere: 240, profonde: 90, rem: 90, eveil: 15 },
    score: 80,
    sieste: false,
    supprimee: false,
    complements: COMPLEMENTS,
    ...p,
  };
}

function fauxXiaomi(sessions: () => SessionSommeil[]) {
  const appels = { n: 0, plages: [] as [string, string][] };
  let erreur: Error | null = null;
  const c: ClientXiaomi = {
    async sessionsSommeil(debut, fin) {
      appels.n++;
      appels.plages.push([debut.toISOString(), fin.toISOString()]);
      if (erreur) throw erreur;
      return sessions();
    },
  };
  return { c, appels, enPanne: (e: Error | null) => (erreur = e) };
}

const SECRETS = { XIAOMI_USER_ID: '42', XIAOMI_PASS_TOKEN: 'jeton-factice', XIAOMI_REGION: 'de' };

const lignes = () =>
  env.DB.prepare(`SELECT cle, debut, fin, valeur, details, recu_le FROM mesures WHERE type = 'sommeil' AND source = 'xiaomi' ORDER BY debut`).all<{
    cle: string;
    debut: string;
    fin: string;
    valeur: number;
    details: string;
    recu_le: string;
  }>();

describe('rattachement d\'une session à sa nuit', () => {
  it('une nuit appartient au jour du soir', () => {
    expect(nuitDeLaSession({ debut: '2026-11-02T22:30:00Z', fin: '2026-11-03T05:30:00Z' }, PARIS)).toBe('2026-11-02');
    expect(nuitDeLaSession({ debut: '2026-11-03T00:30:00Z', fin: '2026-11-03T09:00:00Z' }, PARIS)).toBe('2026-11-02');
    expect(nuitDeLaSession({ debut: '2026-11-02T19:00:00Z', fin: '2026-11-03T03:00:00Z' }, PARIS)).toBe('2026-11-02');
  });

  it('additionne les sessions de la nuit, sans les siestes', () => {
    const s = (debut: string, fin: string, endormi_min: number, sieste = false): SommeilMesure => ({
      debut,
      fin,
      endormi_min,
      sieste,
      phases: { legere: endormi_min / 2, profonde: endormi_min / 4, rem: endormi_min / 4, eveil: 10 },
    });
    const nuits = rattacherAuxNuits(
      [
        s('2026-11-01T21:00:00Z', '2026-11-02T01:00:00Z', 200),
        s('2026-11-02T01:30:00Z', '2026-11-02T05:30:00Z', 220),
        s('2026-11-02T13:00:00Z', '2026-11-02T13:40:00Z', 40, true),
      ],
      [
        { nuit: '2026-11-01', fuseau: PARIS },
        { nuit: '2026-11-02', fuseau: PARIS },
      ],
    );
    expect(nuits.get('2026-11-01')).toEqual({ endormi_min: 420, phases: { legere: 210, profonde: 105, rem: 105, eveil: 20 } });
    expect(nuits.has('2026-11-02')).toBe(false);
  });
});

describe('synchronisation du sommeil (§4.4)', () => {
  const horloge = Horloge.a(MARDI.matin);
  let sessions: SessionSommeil[];
  let faux: ReturnType<typeof fauxXiaomi>;
  const lancer = (secrets: Record<string, string> = SECRETS) => {
    const { deps } = client(horloge);
    return executerTachesPlanifiees({ ...env, ...secrets }, { ...deps, xiaomi: () => faux.c });
  };

  beforeEach(async () => {
    horloge.regler(MARDI.matin);
    sessions = [session({ id: 'a_1', debut: '2026-11-02T21:30:00Z', fin: '2026-11-03T05:00:00Z' })];
    faux = fauxXiaomi(() => sessions);
    await installerConfig();
  });

  it('sans secrets : sautée', async () => {
    await lancer({});
    await lancer({ XIAOMI_USER_ID: '42', XIAOMI_PASS_TOKEN: ' ' });
    expect(faux.appels.n).toBe(0);
  });

  it('lit les 3 derniers jours, une fois par heure', async () => {
    await lancer();
    expect(faux.appels.plages[0]).toEqual(['2026-10-31T10:00:00.000Z', '2026-11-03T11:00:00.000Z']);
    horloge.avancer(59 * 60);
    await lancer();
    expect(faux.appels.n).toBe(1);
    horloge.avancer(60);
    await lancer();
    expect(faux.appels.n).toBe(2);
  });

  it('idempotente : clé = identifiant Xiaomi ; mise à jour seulement si la session change ; suppression', async () => {
    await lancer();
    const [premiere] = (await lignes()).results;
    expect(premiere).toMatchObject({ cle: 'a_1', debut: '2026-11-02T21:30:00Z', valeur: 420, recu_le: MARDI.matin });
    expect(JSON.parse(premiere!.details)).toEqual({
      eveille_min: 15,
      phases: { legere: 240, profonde: 90, rem: 90, eveil: 15 },
      score: 80,
      sieste: false,
      ...COMPLEMENTS,
    });

    horloge.avancer(3600);
    await lancer();
    expect((await lignes()).results).toEqual([premiere]);

    // Xiaomi recalcule la session : début et minutes changent, même clé.
    sessions = [session({ id: 'a_1', debut: '2026-11-02T21:00:00Z', fin: '2026-11-03T05:00:00Z', endormi_min: 450 })];
    horloge.avancer(3600);
    await lancer();
    expect((await lignes()).results).toMatchObject([{ cle: 'a_1', debut: '2026-11-02T21:00:00Z', valeur: 450, recu_le: '2026-11-03T12:00:00Z' }]);

    sessions = [{ ...sessions[0]!, supprimee: true }];
    horloge.avancer(3600);
    await lancer();
    expect((await lignes()).results).toEqual([]);
  });

  it('jeton expiré : erreur notée et relancée, rien d\'écrit, jeton absent du statut', async () => {
    faux.enPanne(new ErreurXiaomi('jeton_xiaomi_expire', 'passToken refusé'));
    await expect(lancer()).rejects.toThrow(AggregateError);
    expect((await lignes()).results).toEqual([]);
    const web = await creerJeton('interface', 'web');
    const r = await client(horloge).get('/v1/statut', web);
    expect(r.corps.sommeil_mesure).toEqual({ derniere_synchro: null, erreur: 'jeton_xiaomi_expire' });
    expect(JSON.stringify(r.corps)).not.toContain('jeton-factice');
  });
});

describe('GET /v1/statut : dette réelle (§4.6)', () => {
  const horloge = Horloge.a(MARDI.matin);
  const api = client(horloge);

  beforeEach(async () => installerConfig());

  const poser = (cle: string, debut: string, fin: string, endormi: number, sieste = false) =>
    env.DB.prepare(
      `INSERT INTO mesures (utilisateur, type, source, cle, debut, fin, valeur, details, recu_le) VALUES ('alice', 'sommeil', 'xiaomi', ?, ?, ?, ?, ?, ?)`,
    )
      .bind(cle, debut, fin, endormi, JSON.stringify({ eveille_min: 10, phases: { legere: endormi - 150, profonde: 80, rem: 70, eveil: 10 }, score: 75, sieste }), MARDI.matin)
      .run();

  it('sans mesure : dette réelle nulle, dette prévue inchangée', async () => {
    const r = await api.get('/v1/statut', await creerJeton('interface', 'web'));
    expect(r.corps.nuits).toHaveLength(7);
    for (const n of r.corps.nuits) expect(n).toMatchObject({ dette_reelle_min: null, phases: null });
    expect(r.corps.dette_cumulee_reelle_min).toBeNull();
    expect(r.corps.dette_cumulee_min).toBe(0);
    expect(r.corps.sommeil_mesure).toBeNull();
  });

  it('dette réelle = cible − endormi par nuit, siestes exclues ; cumul sur les nuits mesurées', async () => {
    await poser('n2', '2026-11-02T21:00:00Z', '2026-11-03T05:00:00Z', 420); // nuit du 02/11 : 7 h → +60
    await poser('s2', '2026-11-02T13:00:00Z', '2026-11-02T14:00:00Z', 55, true); // sieste
    await poser('n1a', '2026-11-01T22:00:00Z', '2026-11-02T02:00:00Z', 230); // nuit du 01/11 en deux morceaux
    await poser('n1b', '2026-11-02T02:30:00Z', '2026-11-02T06:00:00Z', 200); // 430 min → +50
    await poser('n0', '2026-10-31T20:30:00Z', '2026-11-01T05:30:00Z', 510); // nuit du 31/10 : −30
    const r = await api.get('/v1/statut', await creerJeton('interface', 'web'));
    const par = Object.fromEntries(r.corps.nuits.map((n: { nuit: string }) => [n.nuit, n]));
    expect(par['2026-11-02']).toMatchObject({ dette_reelle_min: 60, endormi_min: 420, phases: { legere: 270, profonde: 80, rem: 70, eveil: 10 } });
    expect(par['2026-11-01']).toMatchObject({ dette_reelle_min: 50, phases: { legere: 130, profonde: 160, rem: 140, eveil: 20 } });
    expect(par['2026-10-31']).toMatchObject({ dette_reelle_min: -30 });
    expect(par['2026-10-30']).toMatchObject({ dette_reelle_min: null, phases: null, dette_min: 0 });
    expect(r.corps.dette_cumulee_reelle_min).toBe(80);
    expect(r.corps.dette_cumulee_min).toBe(0);
  });
});
