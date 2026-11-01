import { fireEvent, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarProvider } from '@/components/ui/sidebar';
import { creerApiSimulee } from '@/api/simule';
import { ErreurFocus } from '@/api/erreur';
import { EnTete } from '@/composants/coquille/EnTete';
import { rendreAvecFocus, vider } from '@/test/rendu';

const bouton = () => screen.getByRole('button', { name: 'Actualiser' });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-03T14:00:00Z'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function rendre() {
  const api = creerApiSimulee({ fuseau: 'Europe/Paris' });
  const actualiser = vi.spyOn(api, 'actualiser');
  const statut = vi.spyOn(api, 'statut');
  await rendreAvecFocus(
    <SidebarProvider>
      <EnTete ecran="statut" />
    </SidebarProvider>,
    api,
  );
  statut.mockClear();
  return { api, actualiser, statut };
}

describe('bouton « Actualiser »', () => {
  it('force la synchro (POST /v1/actualiser), tourne pendant le chargement', async () => {
    const { actualiser, statut } = await rendre();
    let finir: () => void = () => {};
    actualiser.mockImplementationOnce(async () => {
      await new Promise<void>((r) => (finir = r));
      return creerApiSimulee({ fuseau: 'Europe/Paris' }).statut();
    });
    fireEvent.click(bouton());
    await vider();
    expect(actualiser).toHaveBeenCalledTimes(1);
    expect(bouton().getAttribute('aria-busy')).toBe('true');
    expect(bouton().querySelector('svg')?.getAttribute('class')).toContain('animate-spin');
    // Un second clic pendant le chargement ne relance rien.
    fireEvent.click(bouton());
    await vider();
    expect(actualiser).toHaveBeenCalledTimes(1);
    finir();
    await vider();
    expect(bouton().getAttribute('aria-busy')).toBe('false');
    expect(bouton().querySelector('svg')?.getAttribute('class')).not.toContain('animate-spin');
    expect(statut).not.toHaveBeenCalled();
  });

  it('erreur : toast court, et le statut est relu quand même', async () => {
    const { actualiser, statut } = await rendre();
    const erreur = vi.spyOn(toast, 'error');
    actualiser.mockRejectedValueOnce(new ErreurFocus('todoist_indisponible', 'Todoist ne répond pas : tâches non synchronisées.', 502));
    fireEvent.click(bouton());
    await vider();
    expect(erreur).toHaveBeenCalledWith('Actualisation impossible', {
      description: 'Todoist ne répond pas : tâches non synchronisées.',
      duration: 4000,
    });
    expect(statut).toHaveBeenCalled();
    expect(bouton().getAttribute('aria-busy')).toBe('false');
  });
});
