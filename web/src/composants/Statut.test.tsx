import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { creerApiSimulee } from '@/api/simule';
import type { ReponseStatut } from '@/api/contrat';
import { CarteMode } from '@/composants/statut/CarteMode';
import { ParcoursJournee } from '@/composants/statut/ParcoursJournee';

// Mardi 3 novembre 2026 à Paris : ouverture 19:50, coucher 21:30, lever du mercredi 05:30.
const MARDI_15H = Date.parse('2026-11-03T14:00:00Z');

async function statut(phase: 'journee' | 'soiree' | 'nuit'): Promise<{ s: ReponseStatut; t: number }> {
  const s = await creerApiSimulee({ maintenant: () => MARDI_15H, fuseau: 'Europe/Paris', phase }).statut();
  return { s, t: Date.parse(s.heure_serveur) };
}

describe('carte du mode actuel', () => {
  it('sortie non certaine : pas de compte à rebours, ce qui manque et « au plus tard »', async () => {
    const { s, t } = await statut('journee');
    render(<CarteMode statut={s} maintenant={t} />);
    expect(screen.getByText('Matin verrouillé')).toBeTruthy();
    expect(screen.getByText('Dès que le planning du jour est fait')).toBeTruthy();
    expect(screen.queryByTestId('compte-a-rebours')).toBeNull();
    const sortie = screen.getByTestId('sortie-incertaine');
    expect(within(sortie).getByText('Planning à faire')).toBeTruthy();
    expect(within(sortie).getByText('au plus tard 21:30')).toBeTruthy();
    expect(within(sortie).queryByText(/restant$/)).toBeNull();
    // Les autres appareils sont dans le tableau, pas ici.
    expect(screen.queryByText(/iPhone/)).toBeNull();
  });

  it('sortie certaine (nuit) : compte à rebours jusqu’au lever', async () => {
    const { s, t } = await statut('nuit');
    render(<CarteMode statut={s} maintenant={t} />);
    const rebours = screen.getByTestId('compte-a-rebours');
    expect(within(rebours).getByText(/Jusqu'à .*05:30/)).toBeTruthy();
    expect(screen.queryByTestId('sortie-incertaine')).toBeNull();
  });
});

describe('parcours de la journée (rendu)', () => {
  it('soirée : « tu es ici » sur Travail, conditions de la soirée avec le détail', async () => {
    const { s, t } = await statut('soiree');
    render(<ParcoursJournee statut={s} maintenant={t} />);
    const actuelle = screen.getByRole('listitem', { current: 'step' });
    expect(within(actuelle).getByText('Travail')).toBeTruthy();
    expect(within(actuelle).getByText('tu es ici')).toBeTruthy();
    expect(screen.getByText('2 restantes')).toBeTruthy();
    expect(screen.getByText(/au plus tôt 19:50/)).toBeTruthy();
    expect(screen.getByText(/Coucher 21:30/)).toBeTruthy();
  });
});
