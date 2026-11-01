import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { creerApiSimulee } from '@/api/simule';
import { EcranDecisionNuit } from '@/ecrans/DecisionNuit';
import { PHRASE_NUIT } from '@/lib/decisionNuit';
import { rendreAvecFocus, vider } from '@/test/rendu';

// Mardi 20:00 à Paris : la soirée a ouvert à 19:50, le coucher est à 21:30.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-03T19:00:00Z'));
});

const valider = () => screen.getByRole<HTMLButtonElement>('button', { name: "Valider l'exception" });
const saisir = (libelle: string | RegExp, valeur: string) => fireEvent.change(screen.getByLabelText(libelle), { target: { value: valeur } });

describe('décision de nuit', () => {
  it('garde « Valider » désactivé tant que raison et phrase ne sont pas remplies', async () => {
    await rendreAvecFocus(<EcranDecisionNuit />, creerApiSimulee({ fuseau: 'Europe/Paris' }));
    expect(screen.getByText('Une fois par nuit.')).toBeTruthy();

    saisir('Nouvelle heure de coucher', '22:30');
    fireEvent.click(screen.getByRole('button', { name: 'Voir le prix' }));
    await vider();
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
    await vider();
    expect(screen.getByRole('status').textContent).toBe('Exception enregistrée.');
    expect(screen.getByText('Déjà prise cette nuit')).toBeTruthy();
    expect(valider().disabled).toBe(true);
  });
});
