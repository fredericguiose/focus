import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';

import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ApiFocus } from '@/api/contrat';
import { FournisseurFocus, useFocus } from '@/hooks/useFocus';

function SiStatut({ children }: { children: ReactNode }) {
  return useFocus().statut ? children : null;
}

/** Rend un écran sous le contexte Focus et attend la première lecture du statut. */
export async function rendreAvecFocus(ui: ReactNode, api: ApiFocus) {
  const rendu = render(
    <TooltipProvider>
      <FournisseurFocus api={api} changerJeton={() => {}}>
        <SiStatut>{ui}</SiStatut>
      </FournisseurFocus>
      <Toaster />
    </TooltipProvider>,
  );
  await vider();
  return rendu;
}

/** Laisse les promesses en cours se résoudre (réponses de l'API simulée). */
export async function vider() {
  await act(async () => {});
  await act(async () => {});
}

export async function avancer(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await vider();
}
