import { describe, expect, it } from 'vitest';
import { engagementsPrevus, journee, journeeCourante } from '../src/journee';
import { contexte, exception } from './aides';

// Routine « semaine » de l'exemple (Europe/Paris), calculée à la main :
// sport 06:00 − 30 min = réveil 05:30 ; travail réveil 06:30 ; réveil libre 07:00 ; cible 8 h.
//   lun sport+travail → 05:30   mar travail → 06:30   mer sport+travail → 05:30   jeu travail → 06:30
//   ven sport+travail → 05:30   sam rien → 07:00      dim rien → 07:00
// Coucher(D) = lever(D+1) − 8 h. Ouverture = coucher − 2 h, sauf ven 18:00, sam et dim 14:00.
// Novembre 2026 : heure d'hiver, UTC+1.

const ctx = contexte('2026-11-02T12:00:00Z');

describe('journée — une semaine de la routine semaine', () => {
  const attendu = [
    // date,        lever local, lever UTC,              coucher local, coucher UTC,           ouverture UTC
    ['2026-11-02', '05:30', '2026-11-02T04:30:00Z', '22:30', '2026-11-02T21:30:00Z', '2026-11-02T19:30:00Z'],
    ['2026-11-03', '06:30', '2026-11-03T05:30:00Z', '21:30', '2026-11-03T20:30:00Z', '2026-11-03T18:30:00Z'],
    ['2026-11-04', '05:30', '2026-11-04T04:30:00Z', '22:30', '2026-11-04T21:30:00Z', '2026-11-04T19:30:00Z'],
    ['2026-11-05', '06:30', '2026-11-05T05:30:00Z', '21:30', '2026-11-05T20:30:00Z', '2026-11-05T18:30:00Z'],
    ['2026-11-06', '05:30', '2026-11-06T04:30:00Z', '23:00', '2026-11-06T22:00:00Z', '2026-11-06T17:00:00Z'],
    ['2026-11-07', '07:00', '2026-11-07T06:00:00Z', '23:00', '2026-11-07T22:00:00Z', '2026-11-07T13:00:00Z'],
    ['2026-11-08', '07:00', '2026-11-08T06:00:00Z', '21:30', '2026-11-08T20:30:00Z', '2026-11-08T13:00:00Z'],
  ] as const;

  for (const [date, leverLocal, lever, coucherLocal, coucher, ouverture] of attendu) {
    it(`${date} : lever ${leverLocal}, coucher ${coucherLocal}`, () => {
      const j = journee(ctx, date);
      expect(j.routine).toBe('semaine');
      expect(j.lever).toBe(lever);
      expect(j.coucherPrevu).toBe(coucher);
      expect(j.coucherApplique).toBe(coucher);
      expect(j.ouverture).toBe(ouverture);
      expect(j.detteNuitMin).toBe(0);
      expect(j.decisionDeNuitPrise).toBe(false);
    });
  }

  it('le lever suivant est le lever du lendemain', () => {
    expect(journee(ctx, '2026-11-02').leverSuivant).toBe('2026-11-03T05:30:00Z');
    expect(journee(ctx, '2026-11-08').leverSuivant).toBe('2026-11-09T04:30:00Z');
  });

  it('engagements du jour', () => {
    expect(journee(ctx, '2026-11-02').engagements).toEqual(['sport', 'travail']);
    expect(journee(ctx, '2026-11-07').engagements).toEqual([]);
  });
});

describe('journée courante', () => {
  const courante = (t: string) => journeeCourante(contexte(t)).date;

  it('aux frontières du lever (mardi 06:30 = 05:30Z)', () => {
    expect(courante('2026-11-03T05:29:59Z')).toBe('2026-11-02');
    expect(courante('2026-11-03T05:30:00Z')).toBe('2026-11-03');
  });

  it('une nuit appartient au jour du soir', () => {
    expect(courante('2026-11-02T22:59:00Z')).toBe('2026-11-02'); // lundi 23:59
    expect(courante('2026-11-03T01:00:00Z')).toBe('2026-11-02'); // mardi 02:00
    expect(courante('2026-11-08T05:59:00Z')).toBe('2026-11-07'); // dimanche 06:59
    expect(courante('2026-11-08T06:00:00Z')).toBe('2026-11-08');
  });
});

describe('changement d\'heure en Europe/Paris', () => {
  it('fin mars : la nuit du samedi est plus courte d\'une heure sur l\'horloge', () => {
    // Dimanche 29/03 lever 07:00 CEST = 05:00Z ; coucher samedi = 21:00Z = 22:00 CET.
    const samedi = journee(ctx, '2026-03-28');
    expect(samedi.lever).toBe('2026-03-28T06:00:00Z');
    expect(samedi.leverSuivant).toBe('2026-03-29T05:00:00Z');
    expect(samedi.coucherApplique).toBe('2026-03-28T21:00:00Z');
    expect(samedi.detteNuitMin).toBe(0);
    // Dimanche : ouverture 14:00 CEST = 12:00Z ; coucher = lundi 05:30 CEST (03:30Z) − 8 h.
    const dimanche = journee(ctx, '2026-03-29');
    expect(dimanche.ouverture).toBe('2026-03-29T12:00:00Z');
    expect(dimanche.coucherApplique).toBe('2026-03-29T19:30:00Z');
    expect(journee(ctx, '2026-03-27').coucherApplique).toBe('2026-03-27T22:00:00Z');
  });

  it('fin octobre : la nuit du samedi dure une heure de plus sur l\'horloge', () => {
    // Dimanche 25/10 lever 07:00 CET = 06:00Z ; coucher samedi = 22:00Z = 00:00 CEST.
    const samedi = journee(ctx, '2026-10-24');
    expect(samedi.lever).toBe('2026-10-24T05:00:00Z');
    expect(samedi.leverSuivant).toBe('2026-10-25T06:00:00Z');
    expect(samedi.coucherApplique).toBe('2026-10-24T22:00:00Z');
    const dimanche = journee(ctx, '2026-10-25');
    expect(dimanche.ouverture).toBe('2026-10-25T13:00:00Z');
    expect(dimanche.coucherApplique).toBe('2026-10-25T20:30:00Z');
    expect(journee(ctx, '2026-10-23').coucherApplique).toBe('2026-10-23T21:00:00Z');
  });

  it('journée courante pendant l\'heure répétée', () => {
    expect(journeeCourante(contexte('2026-10-25T00:30:00Z')).date).toBe('2026-10-24'); // 02:30 CEST
    expect(journeeCourante(contexte('2026-10-25T01:30:00Z')).date).toBe('2026-10-24'); // 02:30 CET
  });
});

describe('calendrier', () => {
  it('routine du calendrier vs routine par défaut', () => {
    expect(journee(ctx, '2026-12-18').routine).toBe('semaine');
    expect(journee(ctx, '2026-12-19').routine).toBe('conges');
    expect(journee(ctx, '2027-01-03').routine).toBe('conges');
    expect(journee(ctx, '2027-01-04').routine).toBe('semaine');
  });

  it('le coucher se cale sur le lever du lendemain, routine du lendemain', () => {
    // Ven 18/12 (semaine) ; sam 19/12 (congés) lever 08:00 = 07:00Z → coucher vendredi 00:00.
    expect(journee(ctx, '2026-12-18').coucherApplique).toBe('2026-12-18T23:00:00Z');
    // Dim 03/01 (congés) ; lun 04/01 (semaine) lever 05:30 = 04:30Z → coucher 21:30.
    expect(journee(ctx, '2027-01-03').coucherApplique).toBe('2027-01-03T20:30:00Z');
  });

  it('reveil_libre surchargé et sport « heure: libre » en congés', () => {
    const lundi = journee(ctx, '2026-12-21');
    expect(lundi.engagements).toEqual(['sport']);
    expect(lundi.lever).toBe('2026-12-21T07:00:00Z'); // 08:00, le sport ne donne pas de réveil
    expect(lundi.ouverture).toBe('2026-12-21T15:00:00Z'); // paramètre de la routine : 16:00
  });
});

describe('engagementsPrevus', () => {
  it('routine du lundi : instants UTC, nom avec majuscule', () => {
    expect(engagementsPrevus(ctx, '2026-11-02')).toEqual([
      { id: 'sport', nom: 'Sport', reveil: '2026-11-02T04:30:00Z', heure: '2026-11-02T05:00:00Z', annulable: true, decalable: true, origine: 'routine' },
      { id: 'travail', nom: 'Travail', reveil: '2026-11-02T05:30:00Z', heure: null, annulable: true, decalable: true, origine: 'routine' },
    ]);
  });

  it('exceptions appliquées : ajout (libellé), retrait, décalage', () => {
    const exceptions = [
      exception({ type: 'retire', date: '2026-11-02', engagement: 'travail' }, '2026-11-01T10:00:00Z'),
      exception({ type: 'decale', date: '2026-11-02', engagement: 'sport', heure: '06:30' }, '2026-11-01T10:01:00Z'),
      exception({ type: 'ajoute', date: '2026-11-02', libelle: 'Dentiste', heure: '08:00', preparationMin: 45 }, '2026-11-01T10:02:00Z'),
    ];
    expect(engagementsPrevus({ ...ctx, exceptions }, '2026-11-02')).toEqual([
      { id: 'sport', nom: 'Sport', reveil: '2026-11-02T05:00:00Z', heure: '2026-11-02T05:30:00Z', annulable: true, decalable: true, origine: 'routine' },
      { id: 'Dentiste', nom: 'Dentiste', reveil: '2026-11-02T06:15:00Z', heure: '2026-11-02T07:00:00Z', annulable: true, decalable: true, origine: 'exception' },
    ]);
  });

  it('jour sans engagement : liste vide', () => {
    expect(engagementsPrevus(ctx, '2026-11-07')).toEqual([]);
  });
});
