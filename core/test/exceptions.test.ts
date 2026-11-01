import { describe, expect, it } from 'vitest';
import { lireConfig } from '../src/config';
import { PHRASE_DECISION_DE_NUIT, prixException } from '../src/exceptions';
import { journeeCourante } from '../src/journee';
import { contexte, EXEMPLE, exception, remplacer } from './aides';

// Nuit du lundi 02/11 : ouverture 20:30 (19:30Z), coucher 22:30 (21:30Z), lever mardi 06:30 (05:30Z).
const NUIT = '2026-11-02';
const AVANT_OUVERTURE = '2026-11-02T14:00:00Z';
const APRES_OUVERTURE = '2026-11-02T20:00:00Z';
const RAISON = 'Exposé de groupe à rendre demain matin, la partie commune arrive ce soir.';
const FRICTION = { raison: RAISON, phrase: PHRASE_DECISION_DE_NUIT };
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
  it('sans friction si le sommeil reste ≥ 7 h', () => {
    const p = prixException(contexte(AVANT_OUVERTURE), coucher('23:30'));
    expect(p.admissible).toBe(true);
    expect(p.friction).toBe('aucune');
    expect(p.resserre).toBe(false);
    expect(p.coucherApres).toBe('2026-11-02T22:30:00Z');
    expect(p.detteApresMin).toBe(60);
  });

  it('refusé sous 7 h', () => {
    const p = prixException(contexte(AVANT_OUVERTURE), coucher('23:45'));
    expect(p.admissible).toBe(false);
    expect(p.motifRefus).toBe('sommeil prévu 6h45, sous le minimum de 7h00');
  });
});

describe('exceptions — décision de nuit (après l\'ouverture)', () => {
  it('exige une raison d\'au moins 50 caractères et la phrase exacte', () => {
    const sans = prixException(contexte(APRES_OUVERTURE), coucher('23:30'));
    expect(sans.admissible).toBe(false);
    expect(sans.friction).toBe('raison_phrase');
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
    expect(p.motifRefus).toBe('décision de nuit déjà prise pour la nuit du 2026-11-02 (une seule par nuit)');
    expect(p.coucherAvant).toBe('2026-11-02T22:00:00Z'); // la première exception s'applique déjà
    // Une décision prise une autre nuit ne compte pas.
    const autreNuit = exception(coucher('23:00', '2026-11-01'), '2026-11-01T20:00:00Z', true);
    expect(prixException(contexte(APRES_OUVERTURE, { exceptions: [autreNuit] }), coucher('23:30'), FRICTION).admissible).toBe(true);
  });

  it('la nuit passée, plus rien à changer', () => {
    const p = prixException(contexte('2026-11-03T06:00:00Z'), coucher('23:30'), FRICTION);
    expect(p.admissible).toBe(false);
    expect(p.motifRefus).toBe('la nuit du 2026-11-02 est passée');
    expect(prixException(contexte('2026-11-03T06:00:00Z'), coucher('21:00')).motifRefus).toBe('la nuit du 2026-11-02 est passée');
  });

  it('demande mal formée : refus motivé, ou erreur si elle n\'a pas de nuit', () => {
    expect(prixException(contexte(AVANT_OUVERTURE), coucher('25:00')).motifRefus).toBe('heure invalide : attendu "HH:MM"');
    expect(() => prixException(contexte(AVANT_OUVERTURE), coucher('23:00', '2026-11-31'))).toThrow('date invalide « 2026-11-31 »');
  });
});

describe('exceptions — engagements', () => {
  it('retire refusé si non annulable', () => {
    const config = lireConfig(remplacer(EXEMPLE, 'travail: { reveil: "06:30", annulable: true', 'travail: { reveil: "06:30", annulable: false'));
    const p = prixException({ ...contexte(AVANT_OUVERTURE), config }, { type: 'retire', date: '2026-11-03', engagement: 'travail' });
    expect(p.admissible).toBe(false);
    expect(p.motifRefus).toBe('engagement « travail » non annulable');
  });

  it('retirer le sport du mercredi : desserrer, lever et coucher reculent ensemble', () => {
    const p = prixException(contexte('2026-11-03T14:00:00Z'), { type: 'retire', date: '2026-11-04', engagement: 'sport' });
    expect(p).toMatchObject({
      admissible: true,
      friction: 'aucune',
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
      'engagement « sport » absent le 2026-11-03',
    );
    const tard = prixException(contexte('2026-11-04T05:00:00Z'), { type: 'retire', date: '2026-11-04', engagement: 'sport' });
    expect(tard.motifRefus).toBe('la nuit du 2026-11-03 est passée');
  });

  it('decale refusé si non décalable, ou si l\'engagement est sans heure', () => {
    const config = lireConfig(remplacer(EXEMPLE, 'preparation: 30, annulable: true, decalable: true', 'preparation: 30, annulable: true, decalable: false'));
    const p = prixException({ ...contexte(AVANT_OUVERTURE), config }, { type: 'decale', date: '2026-11-04', engagement: 'sport', heure: '06:30' });
    expect(p.admissible).toBe(false);
    expect(p.motifRefus).toBe('engagement « sport » non décalable');
    expect(p.coucherApres).toBe(p.coucherAvant);
    // Congés : sport « heure: libre » le lundi 21/12.
    const libre = prixException(contexte('2026-12-20T10:00:00Z'), { type: 'decale', date: '2026-12-21', engagement: 'sport', heure: '09:00' });
    expect(libre.motifRefus).toBe('engagement « sport » sans heure : rien à décaler');
  });

  it('décaler : plus tard = desserrer, plus tôt = resserrer', () => {
    const tard = prixException(contexte(AVANT_OUVERTURE), { type: 'decale', date: '2026-11-03', engagement: 'travail', heure: '06:50' });
    expect(tard).toMatchObject({ admissible: true, resserre: false, leverApres: '2026-11-03T05:50:00Z', coucherApres: '2026-11-02T21:50:00Z' });
    // Le lever ne dépasse jamais le réveil libre (07:00).
    const tresTard = prixException(contexte(AVANT_OUVERTURE), { type: 'decale', date: '2026-11-03', engagement: 'travail', heure: '07:30' });
    expect(tresTard.leverApres).toBe('2026-11-03T06:00:00Z');
    const tot = prixException(contexte(APRES_OUVERTURE), { type: 'decale', date: '2026-11-04', engagement: 'sport', heure: '05:30' });
    expect(tot).toMatchObject({ admissible: true, resserre: true, leverApres: '2026-11-04T04:00:00Z' }); // réveil 05:00
  });
});

describe('exceptions — avancer le coucher', () => {
  // Nuit du vendredi 06/11 : coucher 23:00 (22:00Z), samedi sans engagement, lever 07:00 (06:00Z).
  const VENDREDI = '2026-11-06';
  const avancer = (a: string, nuit = VENDREDI) => ({ type: 'avancer_coucher' as const, nuit, a });

  it('sans engagement le lendemain : lever = coucher + 8 h', () => {
    const p = prixException(contexte('2026-11-06T20:00:00Z'), avancer('2026-11-06T20:00:00Z'));
    expect(p).toEqual({
      admissible: true,
      friction: 'aucune',
      resserre: true,
      coucherAvant: '2026-11-06T22:00:00Z',
      coucherApres: '2026-11-06T20:00:00Z',
      leverAvant: '2026-11-07T06:00:00Z',
      leverApres: '2026-11-07T04:00:00Z', // 05:00
      detteAvantMin: 0,
      detteApresMin: 0,
    });
  });

  it('borné par lever_plancher', () => {
    const p = prixException(contexte('2026-11-06T18:30:00Z'), avancer('2026-11-06T18:30:00Z'));
    expect(p.leverApres).toBe('2026-11-07T03:30:00Z'); // 04:30, pas 03:30
    expect(p.detteApresMin).toBe(-60);
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

  it('une fois enregistrée, la journée du lendemain commence plus tôt', () => {
    const faite = exception(avancer('2026-11-06T20:00:00Z'), '2026-11-06T20:00:00Z');
    expect(journeeCourante(contexte('2026-11-07T04:00:00Z', { exceptions: [faite] })).date).toBe('2026-11-07');
    expect(journeeCourante(contexte('2026-11-07T04:00:00Z')).date).toBe('2026-11-06');
  });
});
