import { describe, expect, it } from 'vitest';

import { demandeAjout, reveilDe } from './engagement';

describe('ajouter un engagement', () => {
  it('calcule le réveil = heure − préparation, y compris avant minuit', () => {
    expect(reveilDe('08:00', 45)).toEqual({ reveil: '07:15', veille: false });
    expect(reveilDe('00:30', 60)).toEqual({ reveil: '23:30', veille: true });
    expect(reveilDe('8:0', 30)).toBeNull();
  });

  it('ne construit la demande qu’avec un libellé et une heure valides', () => {
    expect(demandeAjout({ date: '2026-11-04', libelle: '  ', heure: '08:00', preparationMin: 30 })).toBeNull();
    expect(demandeAjout({ date: '2026-11-04', libelle: 'Dentiste', heure: '', preparationMin: 30 })).toBeNull();
    expect(demandeAjout({ date: '2026-11-04', libelle: ' Dentiste ', heure: '08:00', preparationMin: 45 })).toEqual({
      type: 'ajoute',
      date: '2026-11-04',
      libelle: 'Dentiste',
      heure: '08:00',
      preparationMin: 45,
    });
  });
});
