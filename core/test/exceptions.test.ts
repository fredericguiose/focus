import { describe, expect, it } from 'vitest';
import { lireConfig } from '../src/config';
import { PHRASE_DECISION_DE_NUIT, prixException } from '../src/exceptions';
import { journee, journeeCourante } from '../src/journee';
import { lireInstant } from '../src/temps';
import type { Exception } from '../src/types';
import { contexte, EXEMPLE, exception, remplacer } from './aides';

// Nuit du lundi 02/11 : ouverture 20:30 (19:30Z), coucher 22:30 (21:30Z), lever mardi 06:30 (05:30Z).
const NUIT = '2026-11-02';
const AVANT_OUVERTURE = '2026-11-02T14:00:00Z';
const APRES_OUVERTURE = '2026-11-02T20:00:00Z';
const RAISON = 'Exposé de groupe à rendre demain matin, la partie commune arrive ce soir.';
const FRICTION = { raison: RAISON, phrase: PHRASE_DECISION_DE_NUIT };
const MOTIF = { raison: RAISON };
const coucher = (heure: string, nuit = NUIT) => ({ type: 'coucher' as const, nuit, heure });

describe('exceptions — resserrer', () => {
  it('toujours permis, sans friction, même après l\'ouverture', () => {
    const p = prixException(contexte(APRES_OUVERTURE), coucher('21:30'));
    expect(p).toEqual({
      admissible: true,
      friction: 'aucune',
      resserre: true,
      coucherAvant: '2026-11-02T21:30:00Z',
      coucherApres: '2026-11-02T20:30:00Z',
      leverAvant: '2026-11-03T05:30:00Z',
      leverApres: '2026-11-03T05:30:00Z',
      detteAvantMin: 0,
      detteApresMin: -60,
    });
    expect(prixException(contexte('2026-11-02T22:00:00Z'), coucher('22:00')).admissible).toBe(true);
    expect(prixException(contexte(AVANT_OUVERTURE), coucher('21:30'))).toMatchObject({ admissible: true, friction: 'aucune' });
  });

  it('ajouter un engagement plus tôt avance le lever et le coucher', () => {
    const p = prixException(contexte(APRES_OUVERTURE), { type: 'ajoute', date: '2026-11-03', libelle: 'dentiste', heure: '05:30', preparationMin: 30 });
    expect(p.admissible).toBe(true);
    expect(p.resserre).toBe(true);
    expect(p.leverApres).toBe('2026-11-03T04:00:00Z'); // 05:00
    expect(p.coucherApres).toBe('2026-11-02T20:00:00Z'); // 21:00
  });
});

describe('exceptions — desserrer avant l\'ouverture', () => {
  it('sans raison : refusé, avec le nombre de caractères fournis', () => {
    const sans = prixException(contexte(AVANT_OUVERTURE), coucher('23:30'));
    expect(sans).toMatchObject({ admissible: false, friction: 'raison', frictionManquante: true, resserre: false });
    expect(sans.motifRefus).toBe("raison d'au moins 50 caractères exigée (0 fournis)");
    const courte = prixException(contexte(AVANT_OUVERTURE), coucher('23:30'), { raison: `  ${'x'.repeat(49)}  ` });
    expect(courte.motifRefus).toBe("raison d'au moins 50 caractères exigée (49 fournis)");
  });

  it('avec une raison, sans phrase et sans limite par nuit, si le sommeil reste ≥ 7 h', () => {
    const p = prixException(contexte(AVANT_OUVERTURE), coucher('23:30'), MOTIF);
    expect(p.admissible).toBe(true);
    expect(p.friction).toBe('raison');
    expect(p.resserre).toBe(false);
    expect(p.coucherApres).toBe('2026-11-02T22:30:00Z');
    expect(p.detteApresMin).toBe(60);
  });

  it('sans limite par nuit : une exception déjà enregistrée ne bloque pas la suivante', () => {
    const deja = exception(coucher('23:00'), '2026-11-02T13:00:00Z', false);
    const p = prixException(contexte(AVANT_OUVERTURE, { exceptions: [deja] }), coucher('23:30'), MOTIF);
    expect(p).toMatchObject({ admissible: true, friction: 'raison' });
  });

  it('refusé sous 7 h, même avec une raison', () => {
    const p = prixException(contexte(AVANT_OUVERTURE), coucher('23:45'), MOTIF);
    expect(p.admissible).toBe(false);
    expect(p.friction).toBe('raison');
    expect(p.frictionManquante).toBeUndefined();
    expect(p.motifRefus).toBe('sommeil prévu 6h45, sous le minimum de 7h00');
  });
});

describe('exceptions — décision de nuit (après l\'ouverture)', () => {
  it('exige une raison d\'au moins 50 caractères et la phrase exacte', () => {
    const sans = prixException(contexte(APRES_OUVERTURE), coucher('23:30'));
    expect(sans.admissible).toBe(false);
    expect(sans.friction).toBe('raison_phrase');
    expect(sans.frictionManquante).toBe(true);
    expect(sans.motifRefus).toMatch(/raison d'au moins 50 caractères/);

    const courte = prixException(contexte(APRES_OUVERTURE), coucher('23:30'), { raison: 'x'.repeat(49), phrase: PHRASE_DECISION_DE_NUIT });
    expect(courte.admissible).toBe(false);

    const phrase = prixException(contexte(APRES_OUVERTURE), coucher('23:30'), { raison: RAISON, phrase: 'je ne peux pas decaler' });
    expect(phrase.admissible).toBe(false);
    expect(phrase.motifRefus).toMatch(/JE NE PEUX PAS DECALER/);

    const ok = prixException(contexte(APRES_OUVERTURE), coucher('23:30'), FRICTION);
    expect(ok.admissible).toBe(true);
    expect(ok.friction).toBe('raison_phrase');
  });

  it('plancher de 6 h', () => {
    expect(prixException(contexte(APRES_OUVERTURE), coucher('00:30'), FRICTION).admissible).toBe(true);
    const p = prixException(contexte(APRES_OUVERTURE), coucher('00:45'), FRICTION);
    expect(p.admissible).toBe(false);
    expect(p.motifRefus).toBe('sommeil prévu 5h45, sous le plancher de nuit de 6h00');
  });

  it('une seule fois par nuit', () => {
    const deja = exception(coucher('23:00'), '2026-11-02T19:45:00Z', true);
    const p = prixException(contexte(APRES_OUVERTURE, { exceptions: [deja] }), coucher('23:30'), FRICTION);
    expect(p.admissible).toBe(false);
    expect(p.motifRefus).toBe('décision de nuit déjà prise pour la nuit du 2 nov. (une seule par nuit)');
    expect(p.coucherAvant).toBe('2026-11-02T22:00:00Z'); // la première exception s'applique déjà
    // Une décision prise une autre nuit ne compte pas.
    const autreNuit = exception(coucher('23:00', '2026-11-01'), '2026-11-01T20:00:00Z', true);
    expect(prixException(contexte(APRES_OUVERTURE, { exceptions: [autreNuit] }), coucher('23:30'), FRICTION).admissible).toBe(true);
  });

  it('la nuit passée, plus rien à changer', () => {
    const p = prixException(contexte('2026-11-03T06:00:00Z'), coucher('23:30'), FRICTION);
    expect(p.admissible).toBe(false);
    expect(p.motifRefus).toBe('la nuit du 2 nov. est passée');
    expect(prixException(contexte('2026-11-03T06:00:00Z'), coucher('21:00')).motifRefus).toBe('la nuit du 2 nov. est passée');
  });

  it('demande mal formée : refus motivé, ou erreur si elle n\'a pas de nuit', () => {
    expect(prixException(contexte(AVANT_OUVERTURE), coucher('25:00')).motifRefus).toBe('heure invalide : attendu "HH:MM"');
    expect(() => prixException(contexte(AVANT_OUVERTURE), coucher('23:00', '2026-11-31'))).toThrow('date invalide « 2026-11-31 »');
  });
});

describe('exceptions — engagements', () => {
  it('retirer le sport du mercredi : desserrer, lever et coucher reculent ensemble', () => {
    const retire = { type: 'retire' as const, date: '2026-11-04', engagement: 'sport' };
    expect(prixException(contexte('2026-11-03T14:00:00Z'), retire)).toMatchObject({ admissible: false, friction: 'raison' });
    const p = prixException(contexte('2026-11-03T14:00:00Z'), retire, MOTIF);
    expect(p).toMatchObject({
      admissible: true,
      friction: 'raison',
      resserre: false,
      leverAvant: '2026-11-04T04:30:00Z',
      leverApres: '2026-11-04T05:30:00Z',
      coucherAvant: '2026-11-03T20:30:00Z',
      coucherApres: '2026-11-03T21:30:00Z',
      detteApresMin: 0,
    });
  });

  it('engagement absent ce jour-là, ou nuit passée', () => {
    expect(prixException(contexte(AVANT_OUVERTURE), { type: 'retire', date: '2026-11-03', engagement: 'sport' }).motifRefus).toBe(
      "pas d'engagement « Sport » le 3 nov.",
    );
    const tard = prixException(contexte('2026-11-04T05:00:00Z'), { type: 'retire', date: '2026-11-04', engagement: 'sport' });
    expect(tard.motifRefus).toBe('la nuit du 3 nov. est passée');
  });

  it('donner une heure à un engagement sans heure : resserrer, libre, réveil fixé', () => {
    // Congés : sport « heure: libre » le lundi 21/12 (Paris, UTC+1), plafond 08:00 ramené à 07:30
    // (à moins de 7 jours du lever de 05:30 du vendredi 18/12).
    const ctx = contexte('2026-12-20T10:00:00Z');
    const p = prixException(ctx, { type: 'decale', date: '2026-12-21', engagement: 'sport', heure: '07:00' });
    // Préparation de la config (30 min) : réveil 06:30.
    expect(p).toMatchObject({ admissible: true, friction: 'aucune', resserre: true, leverAvant: '2026-12-21T06:30:00Z', leverApres: '2026-12-21T05:30:00Z' });
    const prep = prixException(ctx, { type: 'decale', date: '2026-12-21', engagement: 'sport', heure: '07:00', preparationMin: 10 });
    expect(prep.leverApres).toBe('2026-12-21T05:50:00Z');
    // Plus tard que le lever calculé : le lever ne bouge pas, toujours libre.
    expect(prixException(ctx, { type: 'decale', date: '2026-12-21', engagement: 'sport', heure: '09:00' })).toMatchObject({
      admissible: true, friction: 'aucune', leverApres: '2026-12-21T06:30:00Z',
    });
    expect(prixException(ctx, { type: 'decale', date: '2026-12-21', engagement: 'sport', heure: '07:00', preparationMin: -5 }).motifRefus).toBe(
      'préparation invalide : attendu un nombre entier de minutes, de 0 à 240',
    );
  });

  it('engagement facultatif : le retirer ou le repousser est libre, avant comme après l\'ouverture', () => {
    const config = lireConfig(remplacer(EXEMPLE, 'preparation: 30, verification', 'preparation: 30, obligatoire: false, verification'));
    const retire = { type: 'retire' as const, date: '2026-11-04', engagement: 'sport' };
    expect(prixException({ ...contexte('2026-11-03T14:00:00Z'), config }, retire)).toMatchObject({
      admissible: true, friction: 'aucune', resserre: false, leverApres: '2026-11-04T05:30:00Z',
    });
    const nuit = { ...contexte('2026-11-03T20:00:00Z'), config };
    expect(prixException(nuit, retire)).toMatchObject({ admissible: true, friction: 'aucune' });
    expect(prixException(nuit, { type: 'decale', date: '2026-11-04', engagement: 'sport', heure: '06:40' })).toMatchObject({ admissible: true, friction: 'aucune' });
    // Une décision de nuit déjà prise ne bloque pas un facultatif.
    const prise = exception(coucher('23:00', '2026-11-03'), '2026-11-03T19:00:00Z', true);
    expect(prixException({ ...nuit, exceptions: [prise] }, retire)).toMatchObject({ admissible: true, friction: 'aucune' });
    // Une routine peut le rendre facultatif, et une exception ajoute aussi.
    const routine = lireConfig(remplacer(EXEMPLE, 'engagements: { sport: { heure: libre, obligatoire: false } }', 'engagements: { sport: { obligatoire: true } }'));
    expect(prixException({ ...contexte('2026-12-20T10:00:00Z'), config: routine }, { type: 'retire', date: '2026-12-21', engagement: 'sport' }).friction).toBe('raison');
    expect(prixException(contexte('2026-12-20T10:00:00Z'), { type: 'retire', date: '2026-12-21', engagement: 'sport' }).friction).toBe('aucune');
    const conf = exception({ type: 'ajoute', date: '2026-11-03', libelle: 'Conférence', heure: '05:30', obligatoire: false }, '2026-11-02T10:00:00Z');
    const ctx = { ...contexte(AVANT_OUVERTURE), exceptions: [conf] };
    expect(prixException(ctx, { type: 'retire', date: '2026-11-03', engagement: 'Conférence' })).toMatchObject({ admissible: true, friction: 'aucune' });
  });

  it('engagement obligatoire : le retirer demande une raison', () => {
    const p = prixException(contexte(AVANT_OUVERTURE), { type: 'retire', date: '2026-11-03', engagement: 'travail' });
    expect(p).toMatchObject({ admissible: false, friction: 'raison', frictionManquante: true });
  });

  it('décaler : plus tard = desserrer, plus tôt = resserrer', () => {
    const tard = prixException(contexte(AVANT_OUVERTURE), { type: 'decale', date: '2026-11-03', engagement: 'travail', heure: '06:50' }, MOTIF);
    expect(tard).toMatchObject({ admissible: true, friction: 'raison', resserre: false, leverApres: '2026-11-03T05:50:00Z', coucherApres: '2026-11-02T21:50:00Z' });
    // Le lever ne dépasse jamais le réveil libre (07:00).
    const tresTard = prixException(contexte(AVANT_OUVERTURE), { type: 'decale', date: '2026-11-03', engagement: 'travail', heure: '07:30' }, MOTIF);
    expect(tresTard.leverApres).toBe('2026-11-03T06:00:00Z');
    const tot = prixException(contexte(APRES_OUVERTURE), { type: 'decale', date: '2026-11-04', engagement: 'sport', heure: '05:30' });
    expect(tot).toMatchObject({ admissible: true, friction: 'aucune', resserre: true, leverApres: '2026-11-04T04:00:00Z' }); // réveil 05:00
  });
});

describe('exceptions — décaler un engagement la nuit (04/11)', () => {
  // Bug du 03/11 : décaler le cours à 9h45 vers 20h29 avait consommé la décision de nuit, et
  // l'effet avait été rogné (régularité) sans que rien ne le dise.
  const decale = (heure: string) => ({ type: 'decale' as const, date: '2026-11-03', engagement: 'travail', heure });

  it('après l\'ouverture : une raison suffit, la décision de nuit reste disponible', () => {
    const p = prixException(contexte(APRES_OUVERTURE), decale('06:50'), MOTIF);
    expect(p).toMatchObject({ admissible: true, friction: 'raison', resserre: false });
    expect(p.nuitDecision).toBeUndefined();
    const prise = exception(decale('06:50'), '2026-11-02T20:00:00Z');
    const coucherPlusTard = prixException({ ...contexte('2026-11-02T20:10:00Z'), exceptions: [prise] }, coucher('23:30'));
    expect(coucherPlusTard).toMatchObject({ friction: 'raison_phrase' });
    expect(coucherPlusTard.motifRefus ?? '').not.toMatch(/déjà prise/);
  });

  it('le lever rogné par le reveil_libre est signalé', () => {
    const p = prixException(contexte(APRES_OUVERTURE), decale('09:00'), MOTIF);
    expect(p.leverApres).toBe('2026-11-03T06:00:00Z'); // 07:00
    expect(p.leverPlafonne).toEqual({ voulu: '2026-11-03T08:00:00Z', cause: 'reveil_libre' });
  });

  it('le lever rogné par la régularité est signalé', () => {
    const config = lireConfig(remplacer(EXEMPLE, '  ecart_lever_max: "2h"\n', '  ecart_lever_max: "1h"\n'));
    const p = prixException({ ...contexte(APRES_OUVERTURE), config }, decale('09:00'), MOTIF);
    expect(p.leverPlafonne?.cause).toBe('regularite');
    expect(lireInstant(p.leverApres)).toBeLessThan(lireInstant('2026-11-03T06:00:00Z'));
  });

  it('rien de rogné : pas de signalement', () => {
    expect(prixException(contexte(APRES_OUVERTURE), decale('06:50'), MOTIF).leverPlafonne).toBeUndefined();
  });
});

describe('exceptions — avancer le coucher', () => {
  // Nuit du vendredi 06/11 : coucher 23:00 (22:00Z), samedi sans engagement, lever 07:00 (06:00Z).
  const VENDREDI = '2026-11-06';
  const avancer = (a: string, nuit = VENDREDI) => ({ type: 'avancer_coucher' as const, nuit, a });

  it('sans engagement le lendemain : le lever ne bouge pas, la nuit s\'allonge (lever fixe, 01/11)', () => {
    const p = prixException(contexte('2026-11-06T20:00:00Z'), avancer('2026-11-06T20:00:00Z'));
    expect(p).toEqual({
      admissible: true,
      friction: 'aucune',
      resserre: true,
      coucherAvant: '2026-11-06T22:00:00Z',
      coucherApres: '2026-11-06T20:00:00Z',
      leverAvant: '2026-11-07T06:00:00Z',
      leverApres: '2026-11-07T06:00:00Z', // 07:00, inchangé
      detteAvantMin: 0,
      detteApresMin: -120,
    });
  });

  it('très tôt : le lever reste le lever calculé', () => {
    const p = prixException(contexte('2026-11-06T18:30:00Z'), avancer('2026-11-06T18:30:00Z'));
    expect(p.leverApres).toBe('2026-11-07T06:00:00Z');
    expect(p.detteApresMin).toBe(-210);
  });

  it('borné par reveil_libre', () => {
    const tardive = exception(coucher('23:59', VENDREDI), '2026-11-06T12:00:00Z');
    const p = prixException(contexte('2026-11-06T22:30:00Z', { exceptions: [tardive] }), avancer('2026-11-06T22:30:00Z'));
    expect(p.resserre).toBe(true);
    expect(p.leverApres).toBe('2026-11-07T06:00:00Z'); // 07:00, pas 07:30
  });

  it('avec un engagement le lendemain, le lever ne bouge pas', () => {
    const p = prixException(contexte('2026-11-08T19:00:00Z'), avancer('2026-11-08T19:00:00Z', '2026-11-08'));
    expect(p.leverApres).toBe('2026-11-09T04:30:00Z');
    expect(p.coucherApres).toBe('2026-11-08T19:00:00Z');
    expect(p.detteApresMin).toBe(-90);
  });

  it('une fois enregistrée, la journée du lendemain commence toujours au lever calculé', () => {
    const faite = exception(avancer('2026-11-06T20:00:00Z'), '2026-11-06T20:00:00Z');
    expect(journeeCourante(contexte('2026-11-07T04:00:00Z', { exceptions: [faite] })).date).toBe('2026-11-06');
    expect(journeeCourante(contexte('2026-11-07T04:00:00Z')).date).toBe('2026-11-06');
  });
});

describe('exceptions — « je vais dormir » après le coucher', () => {
  // Nuit du lundi 02/11 : coucher appliqué 22:30 (21:30Z).
  const dormir = (a: string) => ({ type: 'avancer_coucher' as const, nuit: NUIT, a });

  it('à 23:49 : refusé, jamais traité comme un desserrage', () => {
    const p = prixException(contexte('2026-11-02T22:49:00Z'), dormir('2026-11-02T22:49:00Z'), FRICTION);
    expect(p).toMatchObject({
      admissible: false,
      motifRefus: 'la nuit a déjà commencé à 22:30',
      friction: 'aucune',
      resserre: false,
      coucherAvant: '2026-11-02T21:30:00Z',
      coucherApres: '2026-11-02T21:30:00Z',
    });
  });

  it('pile au coucher : refusé ; une minute avant : admis sans friction', () => {
    expect(prixException(contexte('2026-11-02T21:30:00Z'), dormir('2026-11-02T21:30:00Z')).motifRefus)
      .toBe('la nuit a déjà commencé à 22:30');
    expect(prixException(contexte('2026-11-02T21:29:00Z'), dormir('2026-11-02T21:29:00Z')))
      .toMatchObject({ admissible: true, friction: 'aucune', resserre: true, coucherApres: '2026-11-02T21:29:00Z' });
  });

  it('se compare au coucher appliqué, pas au coucher prévu', () => {
    const tard = exception(coucher('23:30'), '2026-11-02T14:00:00Z');
    const p = prixException(contexte('2026-11-02T22:00:00Z', { exceptions: [tard] }), dormir('2026-11-02T22:00:00Z'));
    expect(p).toMatchObject({ admissible: true, resserre: true });
    const tot = exception(coucher('21:00'), '2026-11-02T14:00:00Z');
    const q = prixException(contexte('2026-11-02T20:30:00Z', { exceptions: [tot] }), dormir('2026-11-02T20:30:00Z'));
    expect(q.motifRefus).toBe('la nuit a déjà commencé à 21:00');
  });
});

// ─── Revue du 01/11 : resserrer / desserrer se juge sur l'effet ──────────────────────────────

describe('exceptions — un engagement ne finit jamais la nuit en cours (revue 01/11)', () => {
  // Lundi 23:00 Paris : NIGHT_LOCK depuis 22:30, lever mardi 06:30.
  const NUIT_EN_COURS = '2026-11-02T22:00:00Z';

  it('« 00:00 + 600 min » (réveil la veille à 14:00) est refusé : sous le lever plancher', () => {
    const d = { type: 'ajoute' as const, date: '2026-11-03', libelle: 'leurre', heure: '00:00', preparationMin: 600, obligatoire: false };
    const p = prixException(contexte(NUIT_EN_COURS), d);
    expect(p.admissible).toBe(false);
    expect(p.resserre).toBe(false);
    expect(p.motifRefus).toMatch(/préparation invalide/);
    const p2 = prixException(contexte(NUIT_EN_COURS), { ...d, preparationMin: 240 });
    expect(p2).toMatchObject({ admissible: false, motifRefus: 'réveil à 20:00 (la veille), avant le lever plancher de 04:30' });
    expect(prixException(contexte(NUIT_EN_COURS), { ...d, heure: undefined, preparationMin: undefined, reveil: '01:00' }).admissible).toBe(false);
  });

  it('un réveil ≥ plancher mais déjà passé est refusé', () => {
    // Mardi 04:40 Paris : réveil 04:35 → le lever de mardi serait passé.
    const p = prixException(contexte('2026-11-03T03:40:00Z'), { type: 'ajoute', date: '2026-11-03', libelle: 'x', heure: '05:00', preparationMin: 25 });
    expect(p).toMatchObject({ admissible: false, resserre: false });
    expect(p.motifRefus).toMatch(/déjà passé/);
  });

  it('avancer la fin de la nuit en cours est une décision de nuit, pas un resserrement', () => {
    // Mardi 03:00 Paris : réveil 04:30 au lieu de 06:30.
    const d = { type: 'ajoute' as const, date: '2026-11-03', libelle: 'train', heure: '05:00', preparationMin: 30 };
    const sans = prixException(contexte('2026-11-03T02:00:00Z'), d);
    expect(sans).toMatchObject({ admissible: false, resserre: false, friction: 'raison_phrase', frictionManquante: true });
    const avec = prixException(contexte('2026-11-03T02:00:00Z'), d, FRICTION);
    expect(avec).toMatchObject({ admissible: true, friction: 'raison_phrase', nuitDecision: NUIT });
  });

  it('décaler plus tôt : mêmes règles (plancher)', () => {
    const p = prixException(contexte(AVANT_OUVERTURE), { type: 'decale', date: '2026-11-03', engagement: 'travail', heure: '04:00' });
    expect(p).toMatchObject({ admissible: false, motifRefus: 'réveil à 04:00, avant le lever plancher de 04:30' });
  });

  it('ajouter un engagement le soir, avant le coucher, reste un resserrement libre', () => {
    const p = prixException(contexte(APRES_OUVERTURE), { type: 'ajoute', date: '2026-11-03', libelle: 'dentiste', heure: '05:30', preparationMin: 30 });
    expect(p).toMatchObject({ admissible: true, friction: 'aucune', resserre: true });
  });
});

describe('exceptions — une exception d\'un autre jour qui desserre ce soir (revue 01/11)', () => {
  // Plancher abaissé pour que l'examen de jeudi (05:00 − 60 min = 04:00) soit admis.
  const cfg = lireConfig(remplacer(EXEMPLE, 'lever_plancher: "04:30"', 'lever_plancher: "03:30"'));
  const examen = { type: 'ajoute' as const, date: '2026-11-05', libelle: 'examen', heure: '05:00', preparationMin: 60 };
  const retire = { type: 'retire' as const, date: '2026-11-05', engagement: 'examen' };
  const ctx = (maintenant: string, autres: Exception[] = []) =>
    contexte(maintenant, { config: cfg, exceptions: [exception(examen, '2026-11-01T08:00:00Z', false), ...autres] });

  it('l\'examen de jeudi avance le coucher de ce soir (régularité) ; le retirer le recule', () => {
    const avec = journee(ctx('2026-11-02T20:15:00Z'), NUIT);
    const sans = journee(contexte('2026-11-02T20:15:00Z', { config: cfg }), NUIT);
    expect(lireInstant(avec.coucherApplique)).toBeLessThan(lireInstant(sans.coucherApplique));
  });

  it('après l\'ouverture de ce soir : retirer l\'engagement ne coûte qu\'une raison, pas la décision de nuit (04/11)', () => {
    const sans = prixException(ctx('2026-11-02T20:15:00Z'), retire);
    expect(sans).toMatchObject({ admissible: false, friction: 'raison', frictionManquante: true, resserre: false });
    const ok = prixException(ctx('2026-11-02T20:15:00Z'), retire, MOTIF);
    expect(ok).toMatchObject({ admissible: true, friction: 'raison' });
    expect(ok.nuitDecision).toBeUndefined();
  });

  it('la décision consommée vaut pour ce soir : une seconde est refusée', () => {
    const prise: Exception = { ...exception(retire, '2026-11-02T20:16:00Z', true), nuitDecision: NUIT };
    const c = ctx('2026-11-02T20:20:00Z', [prise]);
    expect(journee(c, NUIT).decisionDeNuitPrise).toBe(true);
    const p = prixException(c, coucher('23:45'), FRICTION);
    expect(p).toMatchObject({ admissible: false, friction: 'raison_phrase' });
    expect(p.motifRefus).toMatch(/déjà prise pour la nuit du/);
  });

  it('avant l\'ouverture : une raison suffit', () => {
    expect(prixException(ctx(AVANT_OUVERTURE), retire, MOTIF)).toMatchObject({ admissible: true, friction: 'raison' });
  });
});
