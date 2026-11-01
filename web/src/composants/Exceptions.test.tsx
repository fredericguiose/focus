import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { creerApiSimulee } from '@/api/simule';
import { EcranExceptions } from '@/ecrans/Exceptions';
import { DELAI_APERCU_MS } from '@/hooks/useApercuPrix';
import { avancer, rendreAvecFocus, vider } from '@/test/rendu';

// Mardi 15:00 à Paris : avant l'ouverture de la soirée, desserrer est sans friction.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-03T14:00:00Z'));
});

async function ouvrir(type: string) {
  const api = creerApiSimulee({ fuseau: 'Europe/Paris' });
  const prix = vi.spyOn(api, 'prixException');
  const enregistrer = vi.spyOn(api, 'enregistrerException');
  await rendreAvecFocus(<EcranExceptions />, api);
  fireEvent.click(screen.getByRole('button', { name: new RegExp(type) }));
  await vider();
  return { prix, enregistrer, fenetre: screen.getByRole('dialog') };
}

describe('aperçu du prix en direct', () => {
  it('se calcule pendant la saisie, sans bouton, une fois la frappe arrêtée', async () => {
    const { prix, fenetre } = await ouvrir('Décaler le coucher');
    expect(within(fenetre).queryByRole('button', { name: /prix/i })).toBeNull();
    expect(within(fenetre).getByText(/dès que la saisie est complète/)).toBeTruthy();

    fireEvent.change(within(fenetre).getByLabelText('Nouvelle heure'), { target: { value: '22:0' } });
    fireEvent.change(within(fenetre).getByLabelText('Nouvelle heure'), { target: { value: '22:00' } });
    await avancer(DELAI_APERCU_MS - 50);
    expect(prix).not.toHaveBeenCalled();

    await avancer(50);
    expect(prix).toHaveBeenCalledTimes(1);
    expect(prix).toHaveBeenCalledWith({ demande: { type: 'coucher', nuit: '2026-11-03', heure: '22:00' } });
    const apercu = within(fenetre).getByRole('region', { name: "Prix de l'exception" });
    expect(within(apercu).getByText('Sans friction')).toBeTruthy();
    expect(within(apercu).getByText('Coucher')).toBeTruthy();
    expect(within(fenetre).getByRole<HTMLButtonElement>('button', { name: "Valider l'exception" }).disabled).toBe(false);

    fireEvent.change(within(fenetre).getByLabelText('Nouvelle heure'), { target: { value: '22:15' } });
    await avancer(DELAI_APERCU_MS);
    expect(prix).toHaveBeenCalledTimes(2);
  });

  it('« Je vais dormir » : le prix ne se recalcule pas à chaque seconde', async () => {
    const { prix, enregistrer, fenetre } = await ouvrir('Je vais dormir');
    await avancer(DELAI_APERCU_MS);
    expect(prix).toHaveBeenCalledTimes(1);
    await avancer(5_000);
    expect(prix).toHaveBeenCalledTimes(1);

    fireEvent.click(within(fenetre).getByRole('button', { name: "Valider l'exception" }));
    await avancer(50);
    expect(enregistrer).toHaveBeenCalledTimes(1);
    await avancer(50);
    expect(screen.getByText('Exception enregistrée')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
