import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { creerApiSimulee } from '@/api/simule';
import { EcranDecisionNuit } from '@/ecrans/DecisionNuit';
import { DELAI_APERCU_MS } from '@/hooks/useApercuPrix';
import { PHRASE_NUIT } from '@/lib/decisionNuit';
import { avancer, rendreAvecFocus } from '@/test/rendu';

// Mardi 20:00 à Paris : la soirée a ouvert à 19:50, le coucher est à 21:30.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-03T19:00:00Z'));
});

const valider = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Prendre la décision de nuit' });
const saisir = (libelle: string | RegExp, valeur: string) => fireEvent.change(screen.getByLabelText(libelle), { target: { value: valeur } });

describe('décision de nuit', () => {
  it('garde le bouton désactivé tant que raison et phrase ne sont pas remplies', async () => {
    await rendreAvecFocus(<EcranDecisionNuit />, creerApiSimulee({ fuseau: 'Europe/Paris' }));
    expect(screen.getByText('Une fois par nuit.')).toBeTruthy();
    expect(screen.getAllByText('Disponible').length).toBeGreaterThan(0);

    saisir('Nouvelle heure', '22:30');
    await avancer(DELAI_APERCU_MS);
    expect(screen.getByText('Raison + phrase exigées')).toBeTruthy();
    expect(valider().disabled).toBe(true);

    saisir(/^Raison/, 'r'.repeat(49));
    expect(screen.getByText('49 / 50 caractères')).toBeTruthy();
    saisir(/^Recopiez/, PHRASE_NUIT);
    expect(valider().disabled).toBe(true);

    saisir(/^Raison/, 'r'.repeat(50));
    saisir(/^Recopiez/, 'JE NE PEUX PAS DECALE');
    expect(valider().disabled).toBe(true);

    saisir(/^Recopiez/, PHRASE_NUIT);
    expect(valider().disabled).toBe(false);

    fireEvent.click(valider());
    await avancer(100);
    expect(screen.getAllByText('Déjà prise ce soir').length).toBeGreaterThan(0);
    // Sonner affiche le toast au tic suivant.
    await avancer(50);
    expect(screen.getByText('Exception enregistrée')).toBeTruthy();
    expect(valider().disabled).toBe(true);
  });
});
