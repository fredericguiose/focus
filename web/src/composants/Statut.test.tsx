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
    expect(screen.getByText('Journée verrouillée')).toBeTruthy();
    expect(screen.getByText('Se termine dès que le planning du jour est fait')).toBeTruthy();
    expect(screen.queryByTestId('compte-a-rebours')).toBeNull();
    const sortie = screen.getByTestId('sortie-incertaine');
    expect(within(sortie).getByText('Planning à faire')).toBeTruthy();
    expect(within(sortie).getByText('au plus tard 21:30')).toBeTruthy();
    expect(within(sortie).queryByText(/restant$/)).toBeNull();
    // Les autres appareils sont dans le tableau, pas ici.
    expect(screen.queryByText(/iPhone/)).toBeNull();
  });

  it('tâches P1/P2 : les 3 plus importantes en liens Todoist, sans numéro, puis « + N autres » ; le récap garde sa ligne', async () => {
    const s = await creerApiSimulee({
      maintenant: () => MARDI_15H,
      fuseau: 'Europe/Paris',
      phase: 'soiree',
      faits: { prioritairesRestantes: 5, recapFait: false },
    }).statut();
    render(<CarteMode statut={s} maintenant={Date.parse(s.heure_serveur)} />);
    const sortie = screen.getByTestId('sortie-incertaine');
    const liens = within(screen.getByTestId('taches-bloquantes')).getAllByRole('link');
    expect(liens).toHaveLength(3);
    const attendues = s.taches_bloquantes!.prioritaires!.taches;
    liens.forEach((a, i) => {
      expect(a.getAttribute('href')).toBe(`https://app.todoist.com/app/task/${attendues[i]!.id}`);
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
      expect(a.getAttribute('title')).toBe(attendues[i]!.titre);
    });
    // P1 avant P2, en retard d'abord ; aucun numéro devant les titres.
    expect(liens.map((a) => a.querySelector('.whitespace-nowrap')?.textContent)).toEqual(['P1 · en retard', "P1 · aujourd'hui", 'P2 · en retard']);
    expect(liens.some((a) => /^\s*(\d|[①②③])/.test(a.textContent ?? ''))).toBe(false);
    expect(within(sortie).getByText('+ 2 autres')).toBeTruthy();
    // Le compte n'est plus répété ici ; le récap reste une ligne courte.
    expect(within(sortie).queryByText('Tâches P1/P2 à faire')).toBeNull();
    expect(within(sortie).queryByText(/tâches restantes/)).toBeNull();
    expect(within(sortie).getByText('Récap à faire')).toBeTruthy();
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
  it('journée : Journée verrouillée dit le fait positif, « Se lève quand c’est fait », ✗ à faire', async () => {
    const { s, t } = await statut('journee');
    render(<ParcoursJournee statut={s} maintenant={t} />);
    const actuelle = screen.getByRole('listitem', { current: 'step' });
    expect(within(actuelle).getByText('Journée verrouillée')).toBeTruthy();
    expect(within(actuelle).getByText("Se lève quand c'est fait :")).toBeTruthy();
    expect(within(actuelle).getByText('Planning du jour')).toBeTruthy();
    expect(within(actuelle).getByText(/à faire/, { selector: '.sr-only' })).toBeTruthy();
    expect(screen.queryByText(/pas encore fait/)).toBeNull();
  });

  it('soirée : « en cours » sur Travail, faits de la soirée sans doublon d’heure, détail du retard', async () => {
    const { s, t } = await statut('soiree');
    render(<ParcoursJournee statut={s} maintenant={t} />);
    const actuelle = screen.getByRole('listitem', { current: 'step' });
    expect(within(actuelle).getByText('Travail')).toBeTruthy();
    expect(within(actuelle).getByText('en cours')).toBeTruthy();
    expect(screen.getByText('2 tâches restantes dont 1 en retard')).toBeTruthy();
    // Une seule mention de l'heure ; le report en détail.
    expect(screen.getByText('Ouverture à 19:50')).toBeTruthy();
    expect(screen.getByText('+20 min de report')).toBeTruthy();
    expect(screen.queryByText(/au plus tôt/)).toBeNull();
    expect(screen.queryByText(/Pas encore/)).toBeNull();
    expect(screen.getByText(/Coucher 21:30/)).toBeTruthy();
  });
});
