import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { executerTachesPlanifiees } from '../src/planifie';
import { nuitsALire } from '../src/planning';
import { chiffrer, dechiffrer } from '../src/chiffrement';
import { journeeDeLaSieste, nuitDeLaSession, rattacherAuxNuits, separerSiestes, type SommeilMesure } from '../src/sommeil';
import { type ClientXiaomi, ErreurXiaomi, type IdentifiantsXiaomi, type SessionSommeil } from '../src/xiaomi';
import { Horloge, MARDI, client, configExemple, creerJeton, installerConfig } from './aides';

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

/** Faux client : `refuses` sont les passTokens que le compte n'accepte plus ; `tourne` celui qu'il renvoie. */
function fauxXiaomi(sessions: () => SessionSommeil[]) {
  const appels = { n: 0, plages: [] as [string, string][], jetons: [] as string[] };
  const o = { erreur: null as Error | null, refuses: new Set<string>(), tourne: null as string | null };
  const fabrique = (ids: IdentifiantsXiaomi): ClientXiaomi => {
    appels.jetons.push(ids.passToken);
    let recu: string | null = null;
    return {
      passTokenRecu: () => recu,
      async sessionsSommeil(debut, fin) {
        appels.n++;
        appels.plages.push([debut.toISOString(), fin.toISOString()]);
        if (o.refuses.has(ids.passToken)) throw new ErreurXiaomi('jeton_xiaomi_expire', 'passToken refusé');
        if (o.erreur) throw o.erreur;
        recu = o.tourne;
        return sessions();
      },
    };
  };
  return { fabrique, appels, o, enPanne: (e: Error | null) => (o.erreur = e) };
}

const SECRETS = { XIAOMI_USER_ID: '42', XIAOMI_PASS_TOKEN: 'jeton-factice', XIAOMI_REGION: 'de', XIAOMI_UTILISATEUR: 'alice' };
/** Déjà rattrapé : seule la lecture des 3 derniers jours a lieu. */
const RATTRAPE = { XIAOMI_DEPUIS: '2026-11-01' };
const CLE = { CLE_CHIFFREMENT: 'cle-de-test' };

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
    expect(nuits.get('2026-11-01')).toEqual({ endormi_min: 420, phases: { legere: 210, profonde: 105, rem: 105, eveil: 20 }, incomplete: false });
    expect(nuits.has('2026-11-02')).toBe(false);
  });
});

describe('siestes : classement nuit / sieste (§4.6)', () => {
  // Journée de veille du lundi 02/11 (Paris) : lever 06:30, coucher appliqué 22:30.
  const LUNDI = { date: '2026-11-02', fuseau: PARIS, lever: '2026-11-02T05:30:00Z', coucher: '2026-11-02T21:30:00Z' };
  const MARDI_V = { date: '2026-11-03', fuseau: PARIS, lever: '2026-11-03T05:30:00Z', coucher: '2026-11-03T20:30:00Z' };
  const s = (debut: string, fin: string, endormi_min: number, sieste = false): SommeilMesure => ({ debut, fin, endormi_min, sieste, phases: null });

  it('session de fin d\'après-midi sans indicateur Xiaomi : sieste de la journée', () => {
    expect(journeeDeLaSieste(s('2026-11-02T16:00:00Z', '2026-11-02T17:07:00Z', 62), [LUNDI, MARDI_V], PARIS)).toBe('2026-11-02');
  });

  it('nuit (commencée avant le coucher ou finie après le lever) : pas une sieste', () => {
    expect(journeeDeLaSieste(s('2026-11-02T21:00:00Z', '2026-11-03T05:00:00Z', 450), [LUNDI, MARDI_V], PARIS)).toBeNull();
    expect(journeeDeLaSieste(s('2026-11-02T23:00:00Z', '2026-11-03T06:00:00Z', 400), [LUNDI, MARDI_V], PARIS)).toBeNull();
    // Commencée avant le lever : reste dans la nuit, même finie après.
    expect(journeeDeLaSieste(s('2026-11-02T04:00:00Z', '2026-11-02T06:30:00Z', 140), [LUNDI, MARDI_V], PARIS)).toBeNull();
  });

  it('marquée sieste par Xiaomi : sieste, même hors de la journée de veille', () => {
    expect(journeeDeLaSieste(s('2026-11-02T21:00:00Z', '2026-11-02T22:00:00Z', 50, true), [LUNDI, MARDI_V], PARIS)).toBe('2026-11-02');
    expect(journeeDeLaSieste(s('2026-10-20T13:00:00Z', '2026-10-20T13:30:00Z', 25, true), [LUNDI], PARIS)).toBe('2026-10-20');
  });

  it('sépare siestes et nuits ; la nuit garde son seul sommeil', () => {
    const { nuits, siestes } = separerSiestes(
      [
        s('2026-11-02T13:00:00Z', '2026-11-02T13:40:00Z', 40),
        s('2026-11-02T16:00:00Z', '2026-11-02T17:07:00Z', 62),
        s('2026-11-02T21:30:00Z', '2026-11-03T05:00:00Z', 440),
      ],
      [LUNDI, MARDI_V],
      PARIS,
    );
    expect(nuits.map((n) => n.endormi_min)).toEqual([440]);
    expect(siestes.get('2026-11-02')).toEqual([
      { debut: '2026-11-02T13:00:00Z', fin: '2026-11-02T13:40:00Z', minutes: 40 },
      { debut: '2026-11-02T16:00:00Z', fin: '2026-11-02T17:07:00Z', minutes: 62 },
    ]);
  });
});

describe('synchronisation du sommeil (§4.4)', () => {
  const horloge = Horloge.a(MARDI.matin);
  let sessions: SessionSommeil[];
  let faux: ReturnType<typeof fauxXiaomi>;
  const lancer = (secrets: Record<string, string> = { ...SECRETS, ...RATTRAPE }) => {
    const { deps } = client(horloge);
    return executerTachesPlanifiees({ ...env, ...secrets }, { ...deps, xiaomi: faux.fabrique });
  };

  beforeEach(async () => {
    horloge.regler(MARDI.matin);
    sessions = [session({ id: 'a_1', debut: '2026-11-02T21:30:00Z', fin: '2026-11-03T05:00:00Z' })];
    faux = fauxXiaomi(() => sessions);
    await installerConfig();
  });

  it('sans secrets ou sans utilisateur rattaché : sautée', async () => {
    await lancer({});
    await lancer({ ...SECRETS, XIAOMI_PASS_TOKEN: ' ' });
    await lancer({ ...SECRETS, XIAOMI_UTILISATEUR: '' });
    expect(faux.appels.n).toBe(0);
  });

  it('seul l\'utilisateur rattaché au compte Xiaomi est synchronisé', async () => {
    await installerConfig({ ...configExemple(), utilisateur: 'bob' }, 'b0b');
    await lancer({ ...SECRETS, ...RATTRAPE, XIAOMI_UTILISATEUR: 'bob' });
    expect(faux.appels.n).toBe(1);
    const parUtilisateur = await env.DB.prepare(`SELECT DISTINCT utilisateur FROM mesures`).all<{ utilisateur: string }>();
    expect(parUtilisateur.results).toEqual([{ utilisateur: 'bob' }]);
  });

  it('premier passage : rattrapage de 60 jours par morceaux de 10, étalé sur deux passages, puis 3 jours par heure', async () => {
    await lancer(SECRETS);
    expect(faux.appels.plages).toEqual([
      ['2026-10-31T10:00:00.000Z', '2026-11-03T11:00:00.000Z'],
      ['2026-10-21T10:00:00.000Z', '2026-10-31T22:00:00.000Z'],
      ['2026-10-11T10:00:00.000Z', '2026-10-21T22:00:00.000Z'],
      ['2026-10-01T10:00:00.000Z', '2026-10-11T22:00:00.000Z'],
    ]);
    horloge.avancer(60);
    await lancer(SECRETS);
    expect(faux.appels.plages.slice(4)).toEqual([
      ['2026-09-21T10:00:00.000Z', '2026-10-01T22:00:00.000Z'],
      ['2026-09-11T10:00:00.000Z', '2026-09-21T22:00:00.000Z'],
      ['2026-09-04T10:00:00.000Z', '2026-09-11T22:00:00.000Z'],
    ]);
    horloge.avancer(60);
    await lancer(SECRETS);
    expect(faux.appels.n).toBe(7);
    horloge.avancer(3600);
    await lancer(SECRETS);
    expect(faux.appels.plages.slice(7)).toEqual([['2026-10-31T11:02:00.000Z', '2026-11-03T12:02:00.000Z']]);
  });

  it('état d\'avant le rattrapage (synchro récente) : le rattrapage part sans attendre l\'heure', async () => {
    const avant = { tentee_le: '2026-11-03T09:50:00Z', reussie_le: '2026-11-03T09:50:00Z', erreur: null, sessions: 1 };
    await env.DB.prepare(`INSERT INTO cache_todoist (utilisateur, cle, valeur, maj_le) VALUES ('alice', 'synchro_xiaomi', ?, ?)`)
      .bind(JSON.stringify(avant), avant.tentee_le)
      .run();
    await lancer(SECRETS);
    expect(faux.appels.n).toBe(4);
  });

  it('rattrapage depuis XIAOMI_DEPUIS', async () => {
    await lancer({ ...SECRETS, XIAOMI_DEPUIS: '2026-10-15' });
    expect(faux.appels.plages.at(-1)).toEqual(['2026-10-15T00:00:00.000Z', '2026-10-21T22:00:00.000Z']);
    expect(faux.appels.n).toBe(3);
  });

  it('panne pendant le rattrapage : repris là où il s\'était arrêté, une heure plus tard', async () => {
    await lancer(SECRETS);
    faux.enPanne(new ErreurXiaomi('xiaomi_indisponible', 'HTTP 502'));
    horloge.avancer(60);
    await expect(lancer(SECRETS)).rejects.toThrow(AggregateError);
    expect(faux.appels.n).toBe(5);
    faux.enPanne(null);
    horloge.avancer(60);
    await lancer(SECRETS);
    expect(faux.appels.n).toBe(5);
    horloge.avancer(3600);
    await lancer(SECRETS);
    expect(faux.appels.plages.slice(5).map(([d]) => d)).toEqual(['2026-10-31T11:02:00.000Z', '2026-09-21T10:00:00.000Z', '2026-09-11T10:00:00.000Z', '2026-09-04T10:00:00.000Z']);
  });

  it('nuits récentes manquantes (synchro arrêtée plus de 3 jours) : rattrapage depuis la dernière lecture', async () => {
    await lancer();
    faux.appels.plages = [];
    horloge.avancer(6 * 86_400);
    await lancer();
    expect(faux.appels.plages).toEqual([
      ['2026-11-06T10:00:00.000Z', '2026-11-09T11:00:00.000Z'],
      ['2026-11-02T10:00:00.000Z', '2026-11-06T22:00:00.000Z'],
    ]);
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

  const garde = () =>
    env.DB.prepare(`SELECT valeur FROM cache_todoist WHERE utilisateur = 'alice' AND cle = 'jeton_xiaomi'`).first<{ valeur: string }>();

  it('passToken tournant : le plus récent est gardé chiffré et sert au passage suivant', async () => {
    faux.o.tourne = 'jeton-2';
    await lancer({ ...SECRETS, ...RATTRAPE, ...CLE });
    expect(faux.appels.jetons).toEqual(['jeton-factice']);
    const ligne = await garde();
    expect(ligne?.valeur).toBeTruthy();
    expect(ligne!.valeur).not.toContain('jeton-2');
    faux.o.tourne = 'jeton-3';
    horloge.avancer(3600);
    await lancer({ ...SECRETS, ...RATTRAPE, ...CLE });
    expect(faux.appels.jetons).toEqual(['jeton-factice', 'jeton-2']);
    expect((await garde())!.valeur).not.toContain('jeton-3');
  });

  it('jeton gardé refusé : repli sur le secret, puis le nouveau jeton remplace l\'ancien', async () => {
    faux.o.tourne = 'jeton-2';
    await lancer({ ...SECRETS, ...RATTRAPE, ...CLE });
    faux.o.refuses.add('jeton-2');
    faux.o.tourne = 'jeton-3';
    horloge.avancer(3600);
    await lancer({ ...SECRETS, ...RATTRAPE, ...CLE });
    expect(faux.appels.jetons).toEqual(['jeton-factice', 'jeton-2', 'jeton-factice']);
    expect((await lignes()).results).toHaveLength(1);
    horloge.avancer(3600);
    await lancer({ ...SECRETS, ...RATTRAPE, ...CLE });
    expect(faux.appels.jetons.at(-1)).toBe('jeton-3');
  });

  it('jeton renvoyé identique : gardé une fois, pas réécrit à chaque passage', async () => {
    faux.o.tourne = 'jeton-factice';
    await lancer({ ...SECRETS, ...RATTRAPE, ...CLE });
    const premier = (await garde())!.valeur;
    horloge.avancer(3600);
    await lancer({ ...SECRETS, ...RATTRAPE, ...CLE });
    expect((await garde())!.valeur).toBe(premier);
    expect(premier).not.toContain('jeton-factice');
  });

  it('sans CLE_CHIFFREMENT : rien n\'est gardé, le secret sert toujours', async () => {
    faux.o.tourne = 'jeton-2';
    await lancer();
    horloge.avancer(3600);
    await lancer();
    expect(await garde()).toBeNull();
    expect(faux.appels.jetons).toEqual(['jeton-factice', 'jeton-factice']);
  });
});

describe('chiffrement (AES-GCM)', () => {
  it('aller-retour ; mauvaise clé ou mauvais contexte : null', async () => {
    const c = await chiffrer('cle', 'secret', 'ctx');
    expect(JSON.stringify(c)).not.toContain('secret');
    expect(await dechiffrer('cle', c, 'ctx')).toBe('secret');
    expect(await dechiffrer('autre', c, 'ctx')).toBeNull();
    expect(await dechiffrer('cle', c, 'autre')).toBeNull();
    const d = await chiffrer('cle', 'secret', 'ctx');
    expect(d.iv).not.toBe(c.iv);
  });
});

describe('GET /v1/statut : dette réelle (§4.6)', () => {
  const horloge = Horloge.a(MARDI.matin);
  const api = client(horloge);

  beforeEach(async () => {
    horloge.regler(MARDI.matin);
    await installerConfig();
  });

  const poser = (cle: string, debut: string, fin: string, endormi: number, sieste = false, incomplete = false) =>
    env.DB.prepare(
      `INSERT INTO mesures (utilisateur, type, source, cle, debut, fin, valeur, details, recu_le) VALUES ('alice', 'sommeil', 'xiaomi', ?, ?, ?, ?, ?, ?)`,
    )
      .bind(cle, debut, fin, endormi, JSON.stringify({ eveille_min: 10, phases: { legere: endormi - 150, profonde: 80, rem: 70, eveil: 10 }, score: 75, sieste, incomplete }), MARDI.matin)
      .run();

  it('sans mesure : dette réelle nulle, dette prévue inchangée', async () => {
    const r = await api.get('/v1/statut', await creerJeton('interface', 'web'));
    expect(r.corps.nuits).toHaveLength(7);
    for (const n of r.corps.nuits) expect(n).toMatchObject({ dette_reelle_min: null, phases: null });
    expect(r.corps.dette_cumulee_reelle_min).toBeUndefined();
    expect(r.corps.dette_semaine).toEqual({
      debut: '2026-11-02', fin: '2026-11-08', dette_min: 0, rattrape_min: 0, reste_min: 0, nuits_restantes: 5, nuits_mesurees: 0, nuits_total: 2,
    });
    expect(r.corps.bilans_semaines.map((b: { debut: string }) => b.debut)).toEqual(['2026-10-26', '2026-10-19', '2026-10-12', '2026-10-05']);
    expect(r.corps.bilans_semaines[0]).toEqual({
      debut: '2026-10-26', fin: '2026-11-01', dette_min: 0, rattrape_min: 0, non_rattrape_min: 0, nuits_mesurees: 0, nuits_total: 7,
    });
    expect(r.corps.dette_cumulee_min).toBe(0);
    expect(r.corps.sommeil_mesure).toBeNull();
  });

  it('dette réelle = cible − endormi par nuit, siestes exclues ; cumul sur les nuits mesurées', async () => {
    await poser('n2', '2026-11-02T21:00:00Z', '2026-11-03T05:00:00Z', 420); // nuit du 02/11 : 7 h → +60
    await poser('s2', '2026-11-02T13:00:00Z', '2026-11-02T14:00:00Z', 55, true); // sieste
    await poser('n1a', '2026-11-01T22:00:00Z', '2026-11-02T02:00:00Z', 230); // nuit du 01/11 en deux morceaux
    await poser('n1b', '2026-11-02T02:30:00Z', '2026-11-02T06:00:00Z', 200); // 430 min → +50
    await poser('n0', '2026-10-31T20:30:00Z', '2026-11-01T05:30:00Z', 510, false, true); // nuit du 31/10 : −30, incomplète
    const r = await api.get('/v1/statut', await creerJeton('interface', 'web'));
    const par = Object.fromEntries(r.corps.nuits.map((n: { nuit: string }) => [n.nuit, n]));
    expect(par['2026-11-02']).toMatchObject({ dette_reelle_min: 60, endormi_min: 420, phases: { legere: 270, profonde: 80, rem: 70, eveil: 10 } });
    expect(par['2026-11-01']).toMatchObject({ dette_reelle_min: 50, phases: { legere: 130, profonde: 160, rem: 140, eveil: 20 } });
    expect(par['2026-10-31']).toMatchObject({ dette_reelle_min: -30, endormi_min: 510, incomplete: true });
    expect(par['2026-11-02']).toMatchObject({ incomplete: false });
    expect(r.corps.objectif_sommeil_min).toBe(480);
    expect(par['2026-10-30']).toMatchObject({ dette_reelle_min: null, phases: null, dette_min: 0 });
    expect(par['2026-11-02']).toMatchObject({ siestes_min: 55, siestes: [{ debut: '2026-11-02T13:00:00Z', fin: '2026-11-02T14:00:00Z', minutes: 55 }] });
    expect(par['2026-11-01']).toMatchObject({ siestes_min: 0, siestes: [] });
    expect(r.corps.siestes_total_min).toBe(55);
    // Semaine du lundi 02/11 : nuits du dimanche 01/11 (50 manquées) et du 02/11 (60), la sieste du
    // lundi 02/11 (55) qui rattrape la nuit du dimanche.
    expect(r.corps.dette_semaine).toMatchObject({ debut: '2026-11-02', dette_min: 110, rattrape_min: 55, reste_min: 55, nuits_mesurees: 2, nuits_total: 2 });
    // Semaine close du 26/10 (nuits du 25/10 au 31/10) : le 31/10, 30 de plus.
    expect(r.corps.bilans_semaines[0]).toEqual({
      debut: '2026-10-26', fin: '2026-11-01', dette_min: 0, rattrape_min: 30, non_rattrape_min: 0, nuits_mesurees: 1, nuits_total: 7,
    });
    expect(r.corps.dette_cumulee_min).toBe(0);
  });

  it('sieste sans indicateur Xiaomi (fin d\'après-midi) : comptée à part de la nuit, et dans le total', async () => {
    await poser('n2', '2026-11-02T21:00:00Z', '2026-11-03T05:00:00Z', 420);
    await poser('s2', '2026-11-02T16:00:00Z', '2026-11-02T17:07:00Z', 62); // 17:00–18:07 à Paris, sieste: false
    const r = await api.get('/v1/statut', await creerJeton('interface', 'web'));
    const n2 = r.corps.nuits.find((n: { nuit: string }) => n.nuit === '2026-11-02');
    expect(n2).toMatchObject({ endormi_min: 420, dette_reelle_min: 60, siestes_min: 62 });
    expect(r.corps.siestes_total_min).toBe(62);
    // La sieste du lundi rattrape la nuit de dimanche à lundi : semaine en cours.
    expect(r.corps.dette_semaine).toMatchObject({ dette_min: 60, rattrape_min: 62, reste_min: 0 });
    expect(r.corps.bilans_semaines[0]).toMatchObject({ rattrape_min: 0 });
    expect(r.corps.siestes_du_jour).toEqual([]);
    expect(r.corps.sieste_tardive).toBeNull();
  });

  it('sieste du jour : comptée aujourd\'hui ; tardive si elle finit moins de 4 h avant le coucher', async () => {
    // Mardi 03/11, coucher appliqué 21:30 (20:30Z).
    horloge.regler('2026-11-03T18:00:00Z');
    await poser('t1', '2026-11-03T12:00:00Z', '2026-11-03T12:30:00Z', 25); // finit 8 h avant
    let r = await api.get('/v1/statut', await creerJeton('interface', 'web'));
    expect(r.corps.siestes_du_jour_min).toBe(25);
    expect(r.corps.siestes_total_min).toBe(25);
    expect(r.corps.sieste_tardive).toBeNull();
    await poser('t2', '2026-11-03T16:00:00Z', '2026-11-03T17:05:00Z', 60); // finit 3 h 25 avant
    r = await api.get('/v1/statut', await creerJeton('interface', 'web'));
    expect(r.corps.siestes_du_jour_min).toBe(85);
    expect(r.corps.sieste_tardive).toEqual({ fin: '2026-11-03T17:05:00Z', coucher: MARDI.coucher });
    horloge.regler('2026-11-03T21:00:00Z'); // la nuit a commencé : plus d'avertissement
    r = await api.get('/v1/statut', await creerJeton('interface', 'web'));
    expect(r.corps.sieste_tardive).toBeNull();
  });
});

describe('dette de sommeil hebdomadaire (CDC §4, 01/11)', () => {
  it('nuits à lire : la semaine en cours et les 4 semaines closes', () => {
    expect(nuitsALire('2026-11-02')).toBe(29); // lundi : jusqu'au dimanche soir 04/10
    expect(nuitsALire('2026-11-07')).toBe(34); // samedi
    expect(nuitsALire('2026-11-08')).toBe(28); // dimanche : la semaine en cours est déjà la suivante
  });

  describe('GET /v1/statut', () => {
    const horloge = Horloge.a(MARDI.matin);
    const api = client(horloge);

    beforeEach(async () => {
      horloge.regler(MARDI.matin);
      await installerConfig();
    });

    const poser = (cle: string, debut: string, fin: string, endormi: number, sieste = false) =>
      env.DB.prepare(
        `INSERT INTO mesures (utilisateur, type, source, cle, debut, fin, valeur, details, recu_le) VALUES ('alice', 'sommeil', 'xiaomi', ?, ?, ?, ?, ?, ?)`,
      )
        .bind(cle, debut, fin, endormi, JSON.stringify({ eveille_min: 10, phases: null, score: 75, sieste, incomplete: false }), MARDI.matin)
        .run();

    it('les bilans lisent le sommeil quatre semaines en arrière ; la sieste du jour compte pour la semaine en cours', async () => {
      await poser('vieille', '2026-10-05T21:00:00Z', '2026-10-06T04:00:00Z', 400); // nuit du lun. 05/10 : 80 manquées
      await poser('n2', '2026-11-02T21:00:00Z', '2026-11-03T05:00:00Z', 420); // nuit du lun. 02/11 : 60 manquées
      await poser('s3', '2026-11-03T12:00:00Z', '2026-11-03T12:40:00Z', 40, true); // sieste de mardi, ce jour
      const r = await api.get('/v1/statut', await creerJeton('interface', 'web'));
      expect(r.corps.dette_semaine).toEqual({
        debut: '2026-11-02', fin: '2026-11-08', dette_min: 60, rattrape_min: 40, reste_min: 20, nuits_restantes: 5, nuits_mesurees: 1, nuits_total: 2,
      });
      expect(r.corps.bilans_semaines.at(-1)).toEqual({
        debut: '2026-10-05', fin: '2026-10-11', dette_min: 80, rattrape_min: 0, non_rattrape_min: 80, nuits_mesurees: 1, nuits_total: 7,
      });
      expect(r.corps.nuits).toHaveLength(7);
      expect(r.corps.nuits[0].nuit).toBe('2026-10-27');
    });
  });
});

describe('levers mesurés et journal des levers (§3.1)', () => {
  const horloge = Horloge.a(MARDI.matin);
  const api = client(horloge);

  beforeEach(async () => {
    horloge.regler(MARDI.matin);
    await installerConfig();
  });

  const poser = (cle: string, debut: string, fin: string, endormi: number, sieste = false, incomplete = false) =>
    env.DB.prepare(
      `INSERT INTO mesures (utilisateur, type, source, cle, debut, fin, valeur, details, recu_le) VALUES ('alice', 'sommeil', 'xiaomi', ?, ?, ?, ?, ?, ?)`,
    )
      .bind(cle, debut, fin, endormi, JSON.stringify({ eveille_min: 10, phases: null, score: 75, sieste, incomplete }), MARDI.matin)
      .run();

  it('lever mesuré = fin de la nuit principale (siestes et nuits incomplètes exclues) ; prévu, écart, amplitude', async () => {
    await poser('n2', '2026-11-02T21:00:00Z', '2026-11-03T05:00:00Z', 420); // levé mar. 06:00 (prévu 06:30)
    await poser('n1a', '2026-11-01T22:00:00Z', '2026-11-02T02:00:00Z', 230); // nuit du 01/11 en deux morceaux
    await poser('n1b', '2026-11-02T02:30:00Z', '2026-11-02T06:00:00Z', 200); // levé lun. 07:00 (prévu 05:30)
    await poser('s1', '2026-11-02T10:00:00Z', '2026-11-02T11:00:00Z', 55); // sieste non marquée, lun. 11:00
    await poser('n0', '2026-10-31T20:30:00Z', '2026-11-01T05:30:00Z', 510, false, true); // incomplète : pas de lever
    const r = await api.get('/v1/statut', await creerJeton('interface', 'web'));
    expect(r.corps.journee.lever).toBe('2026-11-03T05:00:00Z');
    const par = Object.fromEntries(r.corps.levers.jours.map((j: { date: string }) => [j.date, j]));
    expect(r.corps.levers.jours.map((j: { date: string }) => j.date)).toEqual([
      '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03',
    ]);
    expect(par['2026-11-03']).toEqual({ date: '2026-11-03', prevu: '2026-11-03T05:30:00Z', prevu_fige: false, mesure: '2026-11-03T05:00:00Z', ecart_min: -30 });
    expect(par['2026-11-02']).toEqual({ date: '2026-11-02', prevu: '2026-11-02T04:30:00Z', prevu_fige: false, mesure: '2026-11-02T06:00:00Z', ecart_min: 90 });
    expect(par['2026-11-01']).toMatchObject({ mesure: null, ecart_min: null });
    expect(r.corps.levers.amplitude).toEqual({ plus_tot: '2026-11-03T05:00:00Z', plus_tard: '2026-11-02T06:00:00Z', ecart_min: 60, mesures: 2 });
    expect(r.corps.levers.limite_min).toBe(120);
  });

  it('le prévu figé la veille au soir (photo de la nuit) l’emporte sur le recalcul', async () => {
    await poser('n1', '2026-11-01T21:00:00Z', '2026-11-02T06:00:00Z', 500);
    await env.DB.prepare(
      `INSERT INTO nuits (utilisateur, nuit, routine, lever, coucher_prevu, coucher_applique, decision_de_nuit, photo_le, version_config)
       VALUES ('alice', '2026-11-01', 'semaine', '2026-11-02T04:45:00Z', '2026-11-01T20:45:00Z', '2026-11-01T20:45:00Z', 0, '2026-11-01T20:45:00Z', 'c0ffee1')`,
    ).run();
    const r = await api.get('/v1/statut', await creerJeton('interface', 'web'));
    const lundi = r.corps.levers.jours.find((j: { date: string }) => j.date === '2026-11-02');
    expect(lundi).toEqual({ date: '2026-11-02', prevu: '2026-11-02T04:45:00Z', prevu_fige: true, mesure: '2026-11-02T06:00:00Z', ecart_min: 75 });
    expect(r.corps.levers.amplitude).toBeNull();
  });

  it('sans mesure : journal sans mesure, lever prévu', async () => {
    const r = await api.get('/v1/statut', await creerJeton('interface', 'web'));
    expect(r.corps.journee.lever).toBe(MARDI.lever);
    for (const j of r.corps.levers.jours) expect(j).toMatchObject({ mesure: null, ecart_min: null, prevu_fige: false });
    expect(r.corps.levers.amplitude).toBeNull();
  });
});
