import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { creerApiSimulee } from '@/api/simule';
import { EcranSessions } from '@/ecrans/Sessions';
import { avancer, rendreAvecFocus, vider } from '@/test/rendu';

// Mardi 15:00 à Paris : mode WORK, une session de démonstration attend une réponse (attente 5 s,
// posée il y a 1 s).
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-03T14:00:00Z'));
});

const bouton = (nom: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name: nom });

describe('question de session', () => {
  it('« Je continue » attend attente_s ; « J’arrête » est immédiat', async () => {
    await rendreAvecFocus(<EcranSessions />, creerApiSimulee({ fuseau: 'Europe/Paris' }));

    expect(bouton(/Je continue/).disabled).toBe(true);
    expect(bouton(/Je continue/).textContent).toBe('Je continue (4 s)');
    expect(bouton("J'arrête").disabled).toBe(false);

    await avancer(3_000);
    expect(bouton(/Je continue/).textContent).toBe('Je continue (1 s)');
    expect(bouton(/Je continue/).disabled).toBe(true);

    await avancer(1_000);
    expect(bouton(/Je continue/).disabled).toBe(false);

    fireEvent.click(bouton(/Je continue/));
    await vider();
    expect(screen.queryByRole('button', { name: /Je continue/ })).toBeNull();
  });

  it('« J’arrête » ferme la session sans attendre', async () => {
    await rendreAvecFocus(<EcranSessions />, creerApiSimulee({ fuseau: 'Europe/Paris' }));
    fireEvent.click(bouton("J'arrête"));
    await vider();
    expect(screen.getByText('Aucune session ouverte.')).toBeTruthy();
  });
});

describe('ouverture de session', () => {
  async function preparer() {
    const api = creerApiSimulee({ fuseau: 'Europe/Paris' });
    const ouvrir = vi.spyOn(api, 'ouvrirSession');
    await rendreAvecFocus(<EcranSessions />, api);
    return { ouvrir };
  }

  it('grise les tâches non éligibles avec leur heure d’éligibilité', async () => {
    await preparer();
    const recente = screen.getByRole<HTMLInputElement>('radio', { name: /Relire le chapitre 4/ });
    expect(recente.disabled).toBe(true);
    expect(screen.getByText('éligible à 15:10')).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Exercices de probabilités/ }).disabled).toBe(false);
  });

  it('n’envoie qu’après 10 s', async () => {
    const { ouvrir } = await preparer();
    expect(bouton('Ouvrir la session').disabled).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: /Exercices de probabilités/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'YouTube' }));
    fireEvent.click(bouton('Ouvrir la session'));
    expect(screen.getByText('Envoi dans 10 s…')).toBeTruthy();

    await avancer(9_000);
    expect(screen.getByText('Envoi dans 1 s…')).toBeTruthy();
    expect(ouvrir).not.toHaveBeenCalled();

    await avancer(1_000);
    expect(ouvrir).toHaveBeenCalledTimes(1);
    expect(ouvrir).toHaveBeenCalledWith({ appareil: 'pc_linux', tache_id: 't1', apps: ['youtube'] });
    expect(screen.getByRole('status').textContent).toContain('Session ouverte');
  });

  it('« Annuler » pendant l’attente n’envoie rien', async () => {
    const { ouvrir } = await preparer();
    fireEvent.click(screen.getByRole('radio', { name: /Exercices de probabilités/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'YouTube' }));
    fireEvent.click(bouton('Ouvrir la session'));
    await avancer(5_000);
    fireEvent.click(bouton('Annuler'));
    await avancer(10_000);
    expect(ouvrir).not.toHaveBeenCalled();
    expect(bouton('Ouvrir la session').disabled).toBe(false);
  });
});
