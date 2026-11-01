import { describe, expect, it } from 'vitest';

import type { ReponseStatut } from '@/api/contrat';
import { bilan, choixCoucher, commenceMaintenant, detteARattraper, heureSuggeree, heuresProposees, indexChoix, objectifDuSoir, propositionPossible, texteBilan, texteGain, texteSemaine } from './dette';
import { heureLocale } from './temps';

const FUSEAU = 'America/Cayenne';

function statut(coucher: string, ouverture: string, extra: Partial<ReponseStatut> = {}): ReponseStatut {
  return {
    phase: 'soiree',
    dette_semaine: { debut: '2026-10-26', fin: '2026-11-01', dette_min: 150, rattrape_min: 0, reste_min: 150, nuits_restantes: 1, nuits_mesurees: 6, nuits_total: 6 },
    journee: {
      date: '2026-11-01',
      fuseau: FUSEAU,
      coucherApplique: coucher,
      coucherPrevu: coucher,
      ouverture,
      leverSuivant: '2026-11-02T09:00:00Z',
      decisionDeNuitPrise: false,
    },
    ...extra,
  } as ReponseStatut;
}

const heures = (s: ReponseStatut, maintenant: string) => heuresProposees(s, Date.parse(maintenant)).map((t) => heureLocale(t, FUSEAU));

describe('heures proposées', () => {
  it('du coucher appliqué au quart d’heure suivant maintenant', () => {
    // Coucher 22:37 (01:37Z), maintenant 21:52 (00:52Z) à Cayenne.
    expect(heures(statut('2026-11-02T01:37:00Z', '2026-11-01T23:00:00Z'), '2026-11-02T00:52:10Z')).toEqual(['22:37', '22:30', '22:15', '22:00']);
  });

  it('pile sur un quart d’heure : maintenant compte', () => {
    expect(heures(statut('2026-11-02T01:30:00Z', '2026-11-01T23:00:00Z'), '2026-11-02T01:00:00Z')).toEqual(['22:30', '22:15', '22:00']);
  });

  it('coucher après minuit : les heures de 00:00 à 11:59 sont celles du lendemain', () => {
    expect(heures(statut('2026-11-02T03:30:00Z', '2026-11-01T23:00:00Z'), '2026-11-02T02:40:00Z')).toEqual(['00:30', '00:15', '00:00', '23:45']);
  });

  it('moins d’un quart d’heure à gagner : pas de proposition', () => {
    const s = statut('2026-11-02T01:30:00Z', '2026-11-01T23:00:00Z');
    expect(propositionPossible(s, Date.parse('2026-11-02T01:10:00Z'))).toBe(true);
    expect(propositionPossible(s, Date.parse('2026-11-02T01:16:00Z'))).toBe(false);
  });

  it('coucher déjà avancé : pas de proposition', () => {
    const s = statut('2026-11-02T01:30:00Z', '2026-11-01T23:00:00Z');
    s.journee.coucherPrevu = '2026-11-02T02:00:00Z';
    expect(propositionPossible(s, Date.parse('2026-11-02T00:00:00Z'))).toBe(false);
  });
});

describe('objectif du soir', () => {
  it('reste ÷ nuits restantes, au quart d’heure supérieur, entre 15 min et 1 h', () => {
    expect(objectifDuSoir(180, 4)).toBe(45);
    expect(objectifDuSoir(181, 4)).toBe(60); // 45,25 → 60
    expect(objectifDuSoir(100, 4)).toBe(30); // 25 → 30
    expect(objectifDuSoir(600, 3)).toBe(60); // plafond 1 h
    expect(objectifDuSoir(6, 7)).toBe(15); // au moins 15 min
    expect(objectifDuSoir(50, 1)).toBe(60); // une seule nuit : tout, sous le plafond
    expect(objectifDuSoir(40, 1)).toBe(45);
  });

  it('dette proposée au-delà de 5 min seulement', () => {
    const s = statut('2026-11-02T01:30:00Z', '2026-11-01T23:00:00Z');
    expect(detteARattraper(s)).toEqual({ resteMin: 150, nuits: 1 });
    expect(detteARattraper({ ...s, dette_semaine: { ...s.dette_semaine!, reste_min: 5 } })).toBeNull();
    expect(detteARattraper({ ...s, dette_semaine: undefined })).toBeNull();
    expect(propositionPossible({ ...s, dette_semaine: undefined }, Date.parse('2026-11-02T00:00:00Z'))).toBe(false);
  });

  it('heure suggérée : la plus tardive qui atteint l’objectif, sinon la plus tôt', () => {
    const s = statut('2026-11-02T01:37:00Z', '2026-11-01T23:00:00Z');
    const liste = heuresProposees(s, Date.parse('2026-11-02T00:52:10Z')); // 22:37, 22:30, 22:15, 22:00
    expect(heureLocale(heureSuggeree(liste, 15)!, FUSEAU)).toBe('22:15'); // 22:22 visé
    expect(heureLocale(heureSuggeree(liste, 30)!, FUSEAU)).toBe('22:00');
    expect(heureLocale(heureSuggeree(liste, 60)!, FUSEAU)).toBe('22:00'); // hors d'atteinte
    expect(heureSuggeree([], 30)).toBeUndefined();
  });

  it('sous-titre : nuits au pluriel, « cette dernière nuit » le dimanche', () => {
    expect(texteSemaine(180, 4)).toBe('Cette semaine : 3 h à rattraper, sur 4 nuits');
    expect(texteSemaine(90, 1)).toBe('Cette semaine : 1 h 30 à rattraper, sur cette dernière nuit');
  });
});

describe('bilan', () => {
  it('gain jamais négatif ; progression vers l’objectif du soir plafonnée à 100 %', () => {
    expect(bilan(1000 * 60_000, 970 * 60_000, 45)).toEqual({ gainMin: 30, progression: (30 / 45) * 100 });
    expect(bilan(1000 * 60_000, 900 * 60_000, 45)).toEqual({ gainMin: 100, progression: 100 });
    expect(bilan(1000 * 60_000, 1010 * 60_000, 45)).toEqual({ gainMin: 0, progression: 0 });
    expect(texteBilan(30, 45)).toBe('+30 min · objectif du soir 45 min');
    expect(texteBilan(45, 45)).toBe('+45 min · objectif du soir atteint');
    expect(texteBilan(0, 45)).toBe('Glisse à gauche pour dormir plus.');
  });
});

describe('crans de « Je vais dormir »', () => {
  const lisibles = (s: ReponseStatut, maintenant: string) =>
    choixCoucher(s, Date.parse(maintenant)).map((c) => (c === 'maintenant' ? c : heureLocale(c, FUSEAU)));

  it('du coucher appliqué à maintenant ; le quart d’heure à moins de 2 min se confond avec maintenant', () => {
    const s = statut('2026-11-02T01:30:00Z', '2026-11-01T23:00:00Z');
    expect(lisibles(s, '2026-11-02T00:52:10Z')).toEqual(['22:30', '22:15', '22:00', 'maintenant']);
    expect(lisibles(s, '2026-11-02T00:58:30Z')).toEqual(['22:30', '22:15', 'maintenant']); // 22:00 dans 1 min 30
    expect(lisibles(s, '2026-11-02T01:00:00Z')).toEqual(['22:30', '22:15', 'maintenant']);
  });

  it('coucher dans moins d’un quart d’heure : lui et maintenant ; dans moins de 2 min ou passé : maintenant ou rien', () => {
    const s = statut('2026-11-02T01:30:00Z', '2026-11-01T23:00:00Z');
    expect(lisibles(s, '2026-11-02T01:20:00Z')).toEqual(['22:30', 'maintenant']);
    expect(lisibles(s, '2026-11-02T01:29:00Z')).toEqual(['maintenant']);
    expect(lisibles(s, '2026-11-02T01:30:00Z')).toEqual([]);
  });

  it('le choix gardé suit l’horloge : une heure dépassée devient maintenant', () => {
    const s = statut('2026-11-02T01:30:00Z', '2026-11-01T23:00:00Z');
    const choix = choixCoucher(s, Date.parse('2026-11-02T00:52:10Z'));
    expect(indexChoix(choix, 'maintenant')).toBe(3);
    expect(indexChoix(choix, Date.parse('2026-11-02T01:15:00Z'))).toBe(1);
    expect(indexChoix(choix, Date.parse('2026-11-02T00:45:00Z'))).toBe(3);
    expect(commenceMaintenant('maintenant', 0)).toBe(true);
    expect(commenceMaintenant(Date.parse('2026-11-02T01:00:00Z'), Date.parse('2026-11-02T00:58:30Z'))).toBe(true);
    expect(commenceMaintenant(Date.parse('2026-11-02T01:00:00Z'), Date.parse('2026-11-02T00:57:59Z'))).toBe(false);
  });

  it('sans dette : le gain seul', () => {
    expect(texteGain(90)).toBe('+1 h 30 de sommeil cette nuit');
    expect(texteGain(0)).toBe('Glisse à gauche pour te coucher plus tôt.');
  });
});
