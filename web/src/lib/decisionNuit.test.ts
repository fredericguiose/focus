import { describe, expect, it } from 'vitest';

import { PHRASE_NUIT, longueurRaison, validerFriction } from './decisionNuit';

const raison50 = 'x'.repeat(50);

describe('validerFriction', () => {
  it('exige au moins 50 caractères et la phrase exacte', () => {
    expect(validerFriction(raison50, PHRASE_NUIT)).toEqual({ longueur: 50, raisonOk: true, phraseOk: true, valide: true });
    expect(validerFriction('x'.repeat(49), PHRASE_NUIT).valide).toBe(false);
    expect(validerFriction(raison50, '').valide).toBe(false);
  });

  it('ne compte pas les espaces de bord', () => {
    expect(longueurRaison(`   ${'x'.repeat(49)}   `)).toBe(49);
  });

  it('compte un émoji comme un seul caractère (compte le plus strict)', () => {
    expect(longueurRaison('😴'.repeat(50))).toBe(50);
    expect(longueurRaison('😴'.repeat(25))).toBe(25);
  });

  it('refuse toute phrase qui n’est pas exactement la phrase attendue', () => {
    for (const phrase of ['je ne peux pas decaler', 'JE NE PEUX PAS DÉCALER', `${PHRASE_NUIT} `, ` ${PHRASE_NUIT}`, 'JE NE PEUX PAS  DECALER']) {
      expect(validerFriction(raison50, phrase).phraseOk).toBe(false);
    }
  });
});
