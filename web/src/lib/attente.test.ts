import { describe, expect, it } from 'vitest';

import type { Question, TacheSession } from '@/api/contrat';
import { etatQuestion, tacheEligible } from './attente';

const question: Question = {
  id: 'q_1',
  posee_a: '2026-11-03T14:00:00Z',
  attente_s: 5,
  expire_a: '2026-11-03T14:01:05Z',
};
const a = (iso: string) => Date.parse(iso);

describe('etatQuestion', () => {
  it('bloque « continue » pendant attente_s et arrondit le reste au supérieur', () => {
    expect(etatQuestion(question, a('2026-11-03T14:00:00Z'))).toEqual({
      avantContinuerS: 5,
      avantExpirationS: 65,
      peutContinuer: false,
      expiree: false,
    });
    const presque = etatQuestion(question, a('2026-11-03T14:00:04.200Z'));
    expect(presque.avantContinuerS).toBe(1);
    expect(presque.peutContinuer).toBe(false);
  });

  it('autorise « continue » exactement à posee_a + attente_s', () => {
    const etat = etatQuestion(question, a('2026-11-03T14:00:05Z'));
    expect(etat.peutContinuer).toBe(true);
    expect(etat.avantContinuerS).toBe(0);
  });

  it('sans attente, « continue » est immédiat', () => {
    expect(etatQuestion({ ...question, attente_s: 0 }, a('2026-11-03T14:00:00Z')).peutContinuer).toBe(true);
  });

  it('après expire_a, la question est expirée et « continue » impossible', () => {
    const etat = etatQuestion(question, a('2026-11-03T14:01:05Z'));
    expect(etat.expiree).toBe(true);
    expect(etat.peutContinuer).toBe(false);
    expect(etat.avantExpirationS).toBe(0);
  });
});

describe('tacheEligible', () => {
  const tache: TacheSession = { id: 't', nom: 'T', priorite: 'p1', eligible_le: '2026-11-03T14:15:00Z' };
  it('compare eligible_le à l’heure du serveur, borne incluse', () => {
    expect(tacheEligible(tache, a('2026-11-03T14:14:59Z'))).toBe(false);
    expect(tacheEligible(tache, a('2026-11-03T14:15:00Z'))).toBe(true);
  });
});
