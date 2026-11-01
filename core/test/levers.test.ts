import { describe, expect, it } from 'vitest';
import { lireConfig } from '../src/config';
import { prixException } from '../src/exceptions';
import { journee, journeeCourante, lever, leverPrevu, mesureIgnoree } from '../src/journee';
import { journalDesCouchers, journalDesLevers } from '../src/levers';
import type { Contexte, Exception } from '../src/types';
import { ecartDeFuseauxMin, instantLocal } from '../src/temps';
import { contexte, EXEMPLE, exception, remplacer } from './aides';

// Config fictive (fuseau UTC : heure locale = heure UTC) reprenant le cas du cahier des charges :
//   sport 05:00, préparation 30 min → réveil 04:30 (lun, mar, jeu, ven) ; travail réveil 06:00
//   (lun → ven) ; semaine plafond 07:00 ; congés plafond 08:00 (sport sans heure) ;
//   fin de congés plafond 06:30 ; endormissement 30 min ; écart maximal 2 h.
function configLevers(extraSommeil = '  endormissement: "30min"\n', ecart: string | null = '2h') {
  let yaml = remplacer(EXEMPLE, '  lever_plancher: "04:30"', `  lever_plancher: "04:30"\n${extraSommeil}`);
  yaml = remplacer(yaml, '  ecart_lever_max: "2h"\n', ecart === null ? '' : `  ecart_lever_max: "${ecart}"\n`);
  yaml = remplacer(yaml, 'sport: { heure: "06:00", preparation: 30', 'sport: { heure: "05:00", preparation: 30');
  yaml = remplacer(yaml, 'travail: { reveil: "06:30" }', 'travail: { reveil: "06:00" }');
  const debut = yaml.indexOf('routines:');
  const fin = yaml.indexOf('todoist:');
  const modes = 'modes: [NIGHT_LOCK, MORNING_LOCK, EVENING_FREE, WORK]';
  const routines = `routines:
  semaine:
    fuseau: UTC
    ${modes}
    jours:
      lun: { engagements: [sport, travail] }
      mar: { engagements: [sport, travail] }
      mer: { engagements: [travail] }
      jeu: { engagements: [sport, travail] }
      ven: { engagements: [sport, travail] }
  conges:
    fuseau: UTC
    reveil_libre: "08:00"
    ${modes}
    engagements: { sport: { heure: libre } }
    jours:
      lun: { engagements: [sport] }
      mar: { engagements: [sport] }
      jeu: { engagements: [sport] }
      ven: { engagements: [sport] }
  fin_conges:
    fuseau: UTC
    reveil_libre: "06:30"
    ${modes}
    engagements: { sport: { heure: libre } }
    jours:
      lun: { engagements: [sport] }
      mar: { engagements: [sport] }
      jeu: { engagements: [sport] }
      ven: { engagements: [sport] }

routine_par_defaut: semaine
calendrier:
  - { routine: conges, du: "2026-12-19", au: "2026-12-31" }
  - { routine: fin_conges, du: "2027-01-01", au: "2027-01-03" }

`;
  return lireConfig(yaml.slice(0, debut) + routines + yaml.slice(fin));
}

const config = configLevers();
const ctx = (maintenant = '2026-11-01T12:00:00Z', partiel: Partial<Contexte> = {}): Contexte => contexte(maintenant, { config, ...partiel });
const heureDuLever = (c: Contexte, date: string) => new Date(lever(c, date)).toISOString().slice(11, 16);

describe('lever calculé — semaine type', () => {
  const attendu: [string, string][] = [
    ['2026-11-02', '04:30'], // lun : sport
    ['2026-11-03', '04:30'], // mar : sport
    ['2026-11-04', '06:00'], // mer : travail seulement
    ['2026-11-05', '04:30'], // jeu
    ['2026-11-06', '04:30'], // ven
    ['2026-11-07', '06:30'], // sam : plafond 07:00, mais à moins de 7 jours d'un 04:30
    ['2026-11-08', '06:30'], // dim : idem
  ];
  for (const [date, heure] of attendu) {
    it(`${date} : ${heure}`, () => expect(heureDuLever(ctx(), date)).toBe(heure));
  }

  it('un engagement tardif ne recule pas le lever (sam. 09:00, préparation 30 min → 06:30)', () => {
    const exceptions = [exception({ type: 'ajoute', date: '2026-11-07', libelle: 'Rendez-vous', heure: '09:00', preparationMin: 30 }, '2026-11-01T10:00:00Z')];
    expect(heureDuLever(ctx(undefined, { exceptions }), '2026-11-07')).toBe('06:30');
  });

  it('un engagement tôt gagne toujours, même sous le plancher, et abaisse ses voisins', () => {
    const exceptions = [exception({ type: 'ajoute', date: '2026-11-07', libelle: 'Avion', reveil: '02:00' }, '2026-11-01T10:00:00Z')];
    const c = ctx(undefined, { exceptions });
    expect(heureDuLever(c, '2026-11-07')).toBe('02:00');
    // Dimanche sans engagement : 04:00 (02:00 + 2 h), sous le plancher de 04:30 → l'engagement gagne.
    expect(heureDuLever(c, '2026-11-08')).toBe('04:00');
    // Mercredi 11 (travail 06:00) : 04:00 aussi, 4 jours après.
    expect(heureDuLever(c, '2026-11-11')).toBe('04:00');
    // Samedi 14 : hors de la fenêtre du 7, mais à 6 jours du dimanche 8 (04:00) → 06:00.
    expect(heureDuLever(c, '2026-11-14')).toBe('06:00');
    // Samedi 21 : de nouveau à 2 h des 04:30 de la semaine.
    expect(heureDuLever(c, '2026-11-21')).toBe('06:30');
  });

  it('retirer le sport recalcule le lever du jour selon la même règle', () => {
    const exceptions = [exception({ type: 'retire', date: '2026-11-06', engagement: 'sport' }, '2026-11-01T10:00:00Z')];
    expect(heureDuLever(ctx(undefined, { exceptions }), '2026-11-06')).toBe('06:00');
  });
});

describe('lever calculé — vacances de Noël', () => {
  const plage = (du: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${du}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

  it('19 → 24/12 : 06:30 (à moins de 7 jours du 04:30 du ven. 18/12)', () => {
    for (const d of plage('2026-12-19', 6)) expect([d, heureDuLever(ctx(), d)]).toEqual([d, '06:30']);
  });
  it('25 → 28/12 : 08:00, le plafond des congés', () => {
    for (const d of plage('2026-12-25', 4)) expect([d, heureDuLever(ctx(), d)]).toEqual([d, '08:00']);
  });
  it('29/12 → 03/01 : 06:30 (à moins de 7 jours de la reprise, lun. 04/01 à 04:30)', () => {
    for (const d of plage('2026-12-29', 6)) expect([d, heureDuLever(ctx(), d)]).toEqual([d, '06:30']);
    expect(heureDuLever(ctx(), '2027-01-04')).toBe('04:30');
  });
});

describe('coucher et endormissement', () => {
  it('coucher = lever du lendemain − cible − endormissement ; dette prévue nulle', () => {
    // Nuit du dim. 08/11 : lever lun. 04:30 → coucher 20:00. Nuit du mar. 03/11 : lever mer. 06:00 → 21:30.
    expect(journee(ctx(), '2026-11-08')).toMatchObject({ coucherPrevu: '2026-11-08T20:00:00Z', detteNuitMin: 0 });
    expect(journee(ctx(), '2026-11-03')).toMatchObject({ coucherApplique: '2026-11-03T21:30:00Z', ouverture: '2026-11-03T19:30:00Z' });
  });

  it('le minimum (7 h) est du sommeil, compté depuis l’endormissement : coucher au plus tard 21:00 avant un 04:30', () => {
    const c = ctx('2026-11-02T10:00:00Z');
    const limite = prixException(c, { type: 'coucher', nuit: '2026-11-02', heure: '21:00' });
    expect(limite).toMatchObject({ admissible: false, frictionManquante: true, detteApresMin: 60 });
    const trop = prixException(c, { type: 'coucher', nuit: '2026-11-02', heure: '21:01' });
    expect(trop.motifRefus).toBe('sommeil prévu 6h59, sous le minimum de 7h00');
  });

  it('sans endormissement en config : défaut 0', () => {
    const sans = configLevers('', null);
    expect(sans.sommeil).toMatchObject({ endormissementMin: 0, ecartLeverMaxMin: 120 });
    expect(journee(contexte('2026-11-01T12:00:00Z', { config: sans }), '2026-11-08').coucherPrevu).toBe('2026-11-08T20:30:00Z');
  });

  it('ecart_lever_max : réglable, et nul refusé', () => {
    const large = configLevers(undefined, '3h');
    expect(heureDuLever(contexte('2026-11-01T12:00:00Z', { config: large }), '2026-11-07')).toBe('07:00');
    expect(() => configLevers(undefined, '0min')).toThrow(/écart maximal entre deux levers doit être positif/);
  });
});

describe('levers mesurés', () => {
  const mesures = { '2026-12-27': '2026-12-27T05:00:00Z' };

  it('un jour mesuré a pour lever sa mesure ; son prévu reste le plan', () => {
    const c = ctx('2026-12-27T12:00:00Z', { leversMesures: mesures });
    expect(heureDuLever(c, '2026-12-27')).toBe('05:00');
    expect(new Date(leverPrevu(c, '2026-12-27')).toISOString()).toBe('2026-12-27T08:00:00.000Z');
    // La nuit du 26 garde son coucher prévu (sur le plan) : 08:00 − 8 h 30.
    expect(journee(c, '2026-12-26')).toMatchObject({ coucherPrevu: '2026-12-26T23:30:00Z', detteNuitMin: 0 });
  });

  it('la mesure borne les jours suivants (≤ mesure + 2 h), jamais les précédents', () => {
    const c = ctx('2026-12-27T12:00:00Z', { leversMesures: mesures });
    expect(heureDuLever(c, '2026-12-28')).toBe('07:00');
    expect(heureDuLever(c, '2027-01-02')).toBe('06:30'); // plafond de fin de congés, plus bas
    expect(heureDuLever(c, '2026-12-26')).toBe('08:00');
  });

  it('un lever mesuré tardif ne recule rien', () => {
    const c = ctx('2026-11-07T12:00:00Z', { leversMesures: { '2026-11-06': '2026-11-06T07:45:00Z' } });
    expect(heureDuLever(c, '2026-11-06')).toBe('07:45');
    expect(heureDuLever(c, '2026-11-07')).toBe('06:30');
  });

  it('une mesure très tôt ne fait pas descendre un jour libre sous le plancher', () => {
    const c = ctx('2026-12-27T12:00:00Z', { leversMesures: { '2026-12-27': '2026-12-27T01:30:00Z' } });
    expect(heureDuLever(c, '2026-12-28')).toBe('04:30');
  });

  it('la journée courante change au lever mesuré', () => {
    const c = ctx('2026-12-27T05:10:00Z', { leversMesures: mesures });
    expect(journeeCourante(c).date).toBe('2026-12-27');
    expect(journeeCourante(ctx('2026-12-27T05:10:00Z')).date).toBe('2026-12-26');
  });
});

describe('journal des levers', () => {
  it('prévu (figé ou recalculé), mesuré, écart ; amplitude sur 7 jours', () => {
    const leversMesures = {
      '2026-11-02': '2026-11-02T04:32:00Z',
      '2026-11-04': '2026-11-04T06:10:00Z',
      '2026-11-06': '2026-11-06T04:40:00Z',
    };
    const c = ctx('2026-11-08T12:00:00Z', { leversMesures });
    const j = journalDesLevers(c, '2026-11-08', { '2026-11-04': '2026-11-04T05:50:00Z' });
    expect(j.jours.map((x) => x.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
    expect(j.jours[0]).toEqual({ date: '2026-11-02', fuseau: 'UTC', prevu: '2026-11-02T04:30:00Z', prevuFige: false, mesure: '2026-11-02T04:32:00Z', ecartMin: 2 });
    expect(j.jours[1]).toMatchObject({ mesure: null, ecartMin: null });
    expect(j.jours[2]).toEqual({ date: '2026-11-04', fuseau: 'UTC', prevu: '2026-11-04T05:50:00Z', prevuFige: true, mesure: '2026-11-04T06:10:00Z', ecartMin: 20 });
    expect(j.amplitude).toEqual({ plusTot: '2026-11-02T04:32:00Z', plusTard: '2026-11-04T06:10:00Z', ecartMin: 98, mesures: 3 });
    expect(j.limiteMin).toBe(120);
  });

  it('moins de deux mesures : pas d’amplitude', () => {
    expect(journalDesLevers(ctx(), '2026-11-08').amplitude).toBeNull();
  });
});

describe('journal des couchers (affichage seul)', () => {
  // Nuits du dim. 01/11 au sam. 07/11 (jusqua dim. 08/11). Couchers prévus : lever du lendemain − 8 h 30.
  const endormissements = {
    '2026-11-01': '2026-11-01T23:30:00Z', // prévu 20:00 (lever lun. 04:30)
    '2026-11-03': '2026-11-04T00:30:00Z', // prévu 21:30 (lever mer. 06:00), figé à 21:00
    '2026-11-04': '2026-11-04T20:10:00Z', // prévu 20:00
  };
  const figes = { '2026-11-03': '2026-11-03T21:00:00Z' };

  it('prévu (figé ou recalculé), endormi, écart ; nuits d’avant jusqua', () => {
    const c = ctx('2026-11-08T12:00:00Z');
    const j = journalDesCouchers(c, '2026-11-08', endormissements, figes);
    expect(j.nuits.map((x) => x.nuit)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
    expect(j.nuits[0]).toEqual({ nuit: '2026-11-01', fuseau: 'UTC', prevu: '2026-11-01T20:00:00Z', prevuFige: false, mesure: '2026-11-01T23:30:00Z', ecartMin: 210 });
    expect(j.nuits[1]).toMatchObject({ prevu: '2026-11-02T20:00:00Z', mesure: null, ecartMin: null });
    expect(j.nuits[2]).toEqual({ nuit: '2026-11-03', fuseau: 'UTC', prevu: '2026-11-03T21:00:00Z', prevuFige: true, mesure: '2026-11-04T00:30:00Z', ecartMin: 210 });
    expect(j.nuits[3]).toMatchObject({ ecartMin: 10 });
    // Le prévu recalculé est le coucher prévu du moteur, inchangé.
    for (const x of j.nuits.filter((n) => !n.prevuFige)) expect(x.prevu).toBe(journee(c, x.nuit).coucherPrevu);
    expect(j.limiteMin).toBe(120);
  });

  it('amplitude autour de minuit : 23:30 et 00:30 font 1 h, pas 23 h', () => {
    const j = journalDesCouchers(ctx('2026-11-08T12:00:00Z'), '2026-11-08', {
      '2026-11-01': '2026-11-01T23:30:00Z',
      '2026-11-03': '2026-11-04T00:30:00Z',
    });
    expect(j.amplitude).toEqual({ plusTot: '2026-11-01T23:30:00Z', plusTard: '2026-11-04T00:30:00Z', ecartMin: 60, mesures: 2 });
  });

  it('amplitude sur les 7 nuits : du plus tôt (20:10) au plus tard (00:30 le lendemain)', () => {
    const j = journalDesCouchers(ctx('2026-11-08T12:00:00Z'), '2026-11-08', endormissements, figes);
    expect(j.amplitude).toEqual({ plusTot: '2026-11-04T20:10:00Z', plusTard: '2026-11-04T00:30:00Z', ecartMin: 260, mesures: 3 });
  });

  it('une mesure hors des 7 nuits est ignorée ; moins de deux mesures : pas d’amplitude', () => {
    const j = journalDesCouchers(ctx('2026-11-08T12:00:00Z'), '2026-11-08', { '2026-10-31': '2026-10-31T23:00:00Z', '2026-11-07': '2026-11-07T22:00:00Z' });
    expect(j.nuits.filter((n) => n.mesure !== null)).toHaveLength(1);
    expect(j.amplitude).toBeNull();
  });
});

describe('performances', () => {
  it('une année de journées se calcule vite (série calculée une fois par bloc)', () => {
    const c = ctx();
    const debut = performance.now();
    for (let i = 0; i < 365; i++) journee(c, new Date(Date.parse('2026-11-01T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10));
    expect(performance.now() - debut).toBeLessThan(3000);
  });

  it('les exceptions sont prises en compte (pas de cache périmé)', () => {
    const exceptions: Exception[] = [];
    expect(heureDuLever(ctx(undefined, { exceptions }), '2026-11-06')).toBe('04:30');
    const autres = [exception({ type: 'retire', date: '2026-11-06', engagement: 'sport' }, '2026-11-01T10:00:00Z')];
    expect(heureDuLever(ctx(undefined, { exceptions: autres }), '2026-11-06')).toBe('06:00');
  });
});

describe('config normalisée plus ancienne (gardée en base, sans les réglages du 01/11)', () => {
  it('défauts : endormissement 0, écart maximal 2 h', () => {
    const { endormissementMin: _e, ecartLeverMaxMin: _x, ...sommeil } = config.sommeil;
    const ancienne = { ...config, sommeil } as typeof config;
    const c = contexte('2026-11-01T12:00:00Z', { config: ancienne });
    expect(heureDuLever(c, '2026-11-07')).toBe('06:30');
    expect(journee(c, '2026-11-08')).toMatchObject({ coucherPrevu: '2026-11-08T20:30:00Z', detteNuitMin: 0 });
    expect(journalDesLevers(c, '2026-11-08').limiteMin).toBe(120);
  });
});

describe('décalage horaire : mesures ignorées après un séjour dans un autre fuseau', () => {
  // Config fictive : routine par défaut en America/Cayenne, séjour en Europe/Paris du 09 au 30/10,
  // aucun engagement, plafond 08:00 partout (lever prévu 08:00 local sans mesure).
  const CAYENNE = 'America/Cayenne';
  const PARIS = 'Europe/Paris';
  const yaml = (() => {
    const debut = EXEMPLE.indexOf('routines:');
    const fin = EXEMPLE.indexOf('todoist:');
    const routine = (fuseau: string) => `    fuseau: ${fuseau}\n    reveil_libre: "08:00"\n    modes: [NIGHT_LOCK, MORNING_LOCK, EVENING_FREE]\n    jours: {}\n`;
    const routines = `routines:\n  maison:\n${routine(CAYENNE)}  sejour:\n${routine(PARIS)}\nroutine_par_defaut: maison\ncalendrier:\n  - { routine: sejour, du: "2026-10-09", au: "2026-10-30" }\n\n`;
    return EXEMPLE.slice(0, debut) + routines + EXEMPLE.slice(fin);
  })();
  const cfg = lireConfig(yaml);
  const jours = (du: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${du}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
  const a5h = (date: string, fuseau: string) => new Date(instantLocal(date, 5 * 60, fuseau)).toISOString().replace('.000Z', 'Z');
  const heure = (c: Contexte, date: string, fuseau: string, calcul = leverPrevu) =>
    new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, hour: '2-digit', minute: '2-digit' }).format(calcul(c, date));

  it('écart horaire calculé avec Intl, heure d’été comprise', () => {
    expect(ecartDeFuseauxMin('2026-10-20', PARIS, CAYENNE)).toBe(300);
    expect(ecartDeFuseauxMin('2026-10-30', PARIS, CAYENNE)).toBe(240);
    expect(ecartDeFuseauxMin('2026-10-30', CAYENNE, CAYENNE)).toBe(0);
  });

  it('vu de Cayenne : 09 → 30/10 (autre fuseau) et 31/10 → 03/11 (4 jours) ignorés ; 08/10 et dès le 04/11 utilisés', () => {
    expect(mesureIgnoree(cfg, '2026-10-08', CAYENNE)).toBeNull();
    for (const d of jours('2026-10-09', 26)) expect([d, mesureIgnoree(cfg, d, CAYENNE)]).toEqual([d, 'decalage_horaire']);
    for (const d of jours('2026-11-04', 30)) expect([d, mesureIgnoree(cfg, d, CAYENNE)]).toEqual([d, null]);
  });

  it('vu de Paris (pendant le séjour) : les 5 premiers jours après l’arrivée sont ignorés', () => {
    for (const d of jours('2026-10-09', 5)) expect([d, mesureIgnoree(cfg, d, PARIS)]).toEqual([d, 'decalage_horaire']);
    expect(mesureIgnoree(cfg, '2026-10-14', PARIS)).toBeNull();
    expect(mesureIgnoree(cfg, '2026-10-08', PARIS)).toBe('decalage_horaire');
  });

  it('une mesure ignorée ne borne pas les levers suivants ; une mesure utilisée, si', () => {
    const leversMesures = Object.fromEntries(
      [...jours('2026-10-08', 23).map((d) => [d, a5h(d, d < '2026-10-09' || d > '2026-10-30' ? CAYENNE : PARIS)]), ['2026-11-01', a5h('2026-11-01', CAYENNE)], ['2026-11-04', a5h('2026-11-04', CAYENNE)]],
    );
    const c = contexte('2026-11-05T12:00:00Z', { config: cfg, leversMesures });
    // Prévu du 12/10 (Paris) : mesures du 08/10 (Cayenne) au 11/10 ignorées → plafond.
    expect(heure(c, '2026-10-12', PARIS)).toBe('08:00');
    // Prévu du 20/10 (Paris) : les mesures du 14 au 19/10 comptent → 05:00 + 2 h.
    expect(heure(c, '2026-10-20', PARIS)).toBe('07:00');
    // Prévus des 02 et 03/11 (Cayenne) : mesures du séjour et du 01/11 ignorées → plafond.
    expect(heure(c, '2026-11-02', CAYENNE)).toBe('08:00');
    expect(heure(c, '2026-11-03', CAYENNE)).toBe('08:00');
    // Prévu du 05/11 : la mesure du 04/11 compte.
    expect(heure(c, '2026-11-05', CAYENNE)).toBe('07:00');
    // Un jour ignoré garde sa mesure pour lever.
    expect(heure(c, '2026-11-01', CAYENNE, lever)).toBe('05:00');
  });

  it('journal : la mesure reste affichée, marquée, hors de l’amplitude', () => {
    const leversMesures = Object.fromEntries(jours('2026-10-29', 7).map((d, i) => [d, a5h(d, d <= '2026-10-30' ? PARIS : CAYENNE).replace('05:', `0${5 + (i % 2)}:`)]));
    leversMesures['2026-11-04'] = a5h('2026-11-04', CAYENNE);
    leversMesures['2026-11-05'] = new Date(instantLocal('2026-11-05', 6 * 60 + 10, CAYENNE)).toISOString().replace('.000Z', 'Z');
    const c = contexte('2026-11-05T12:00:00Z', { config: cfg, leversMesures });
    const j = journalDesLevers(c, '2026-11-05');
    expect(j.jours.map((x) => [x.date, x.ignore ?? null])).toEqual([
      ['2026-10-30', 'decalage_horaire'],
      ['2026-10-31', 'decalage_horaire'],
      ['2026-11-01', 'decalage_horaire'],
      ['2026-11-02', 'decalage_horaire'],
      ['2026-11-03', 'decalage_horaire'],
      ['2026-11-04', null],
      ['2026-11-05', null],
    ]);
    expect(j.jours[0]!.mesure).not.toBeNull();
    expect(j.amplitude).toMatchObject({ ecartMin: 70, mesures: 2 });
  });

  it('journal des couchers : même règle, appliquée au soir de la nuit', () => {
    const a23h = (nuit: string, fuseau: string) => new Date(instantLocal(nuit, 23 * 60, fuseau)).toISOString().replace('.000Z', 'Z');
    const endormissements = Object.fromEntries(jours('2026-10-29', 7).map((d) => [d, a23h(d, d <= '2026-10-30' ? PARIS : CAYENNE)]));
    const c = contexte('2026-11-05T12:00:00Z', { config: cfg });
    const j = journalDesCouchers(c, '2026-11-05', endormissements);
    expect(j.nuits.map((x) => [x.nuit, x.ignore ?? null])).toEqual([
      ['2026-10-29', 'decalage_horaire'],
      ['2026-10-30', 'decalage_horaire'],
      ['2026-10-31', 'decalage_horaire'],
      ['2026-11-01', 'decalage_horaire'],
      ['2026-11-02', 'decalage_horaire'],
      ['2026-11-03', 'decalage_horaire'],
      ['2026-11-04', null],
    ]);
    expect(j.nuits[0]!.mesure).not.toBeNull();
    expect(j.amplitude).toBeNull();
  });

  it('chaque jour et chaque nuit portent le fuseau de leur routine (à lire dans ce fuseau)', () => {
    const c = contexte('2026-11-02T12:00:00Z', { config: cfg });
    // Levers du 27/10 au 02/11 : séjour jusqu'au 30/10 inclus.
    expect(journalDesLevers(c, '2026-11-02').jours.map((x) => [x.date, x.fuseau])).toEqual([
      ['2026-10-27', PARIS],
      ['2026-10-28', PARIS],
      ['2026-10-29', PARIS],
      ['2026-10-30', PARIS],
      ['2026-10-31', CAYENNE],
      ['2026-11-01', CAYENNE],
      ['2026-11-02', CAYENNE],
    ]);
    // Nuits du 26/10 au 01/11 : celle du 30/10 (soir à Paris) est en heure de Paris.
    expect(journalDesCouchers(c, '2026-11-02', {}).nuits.map((x) => [x.nuit, x.fuseau])).toEqual([
      ['2026-10-26', PARIS],
      ['2026-10-27', PARIS],
      ['2026-10-28', PARIS],
      ['2026-10-29', PARIS],
      ['2026-10-30', PARIS],
      ['2026-10-31', CAYENNE],
      ['2026-11-01', CAYENNE],
    ]);
  });
});
