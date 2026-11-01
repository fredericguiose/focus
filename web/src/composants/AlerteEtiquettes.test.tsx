import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { creerApiSimulee } from '@/api/simule';
import { AlerteEtiquettes, consequence } from '@/composants/statut/AlerteEtiquettes';

const MARDI_15H = Date.parse('2026-11-03T14:00:00Z');
const statut = (etiquettesManquantes?: string[]) =>
  creerApiSimulee({ maintenant: () => MARDI_15H, fuseau: 'Europe/Paris', phase: 'journee', etiquettesManquantes }).statut();

describe('alerte des étiquettes Todoist introuvables', () => {
  it('rien quand toutes les étiquettes existent, ou avec une API plus ancienne', async () => {
    const s = await statut();
    expect(s.todoist?.etiquettes_manquantes).toEqual([]);
    const { container, rerender } = render(<AlerteEtiquettes statut={s} />);
    expect(container.textContent).toBe('');
    rerender(<AlerteEtiquettes statut={{ ...s, todoist: undefined }} />);
    expect(container.textContent).toBe('');
  });

  it('une étiquette : son nom et ce que son absence casse', async () => {
    render(<AlerteEtiquettes statut={await statut(['planning'])} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Étiquette Todoist introuvable : @planning')).toBeTruthy();
    expect(screen.getByText('Le planning du matin comptera toujours comme fait.')).toBeTruthy();
    expect(screen.getByText(/^Créez-la dans Todoist/)).toBeTruthy();
  });

  it('plusieurs : une ligne par étiquette', async () => {
    render(<AlerteEtiquettes statut={await statut(['planning', 'recap'])} />);
    expect(screen.getByText('Étiquettes Todoist introuvables : @planning, @recap')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('@recap : Le récap comptera toujours comme fait.');
    expect(screen.getByText(/^Créez-les dans Todoist/)).toBeTruthy();
  });

  it('message selon le rôle le plus important ; noms des modes repris du parcours', async () => {
    expect(consequence(['recap', 'exclusion'], [])).toBe('Le récap comptera toujours comme fait.');
    expect(consequence(['condition'], ['Travail'])).toBe('Les conditions qui la filtrent (mode Travail) ne trouveront jamais de tâche.');
    expect(consequence(['exclusion'], [])).toBe("Elle n'exclut aucune tâche.");
    expect(consequence([], [])).toBe('Les règles qui la citent ne fonctionnent pas comme prévu.');
    const s = await statut();
    const etape = s.appareils[0]!.parcours![0]!;
    render(
      <AlerteEtiquettes
        statut={{
          ...s,
          todoist: {
            dernier_changement: null,
            etiquettes_verifiees_le: null,
            etiquettes_manquantes: ['deep'],
            etiquettes_manquantes_detail: [{ etiquette: 'deep', usages: ['condition'], modes: [etape.mode] }],
          },
        }}
      />,
    );
    expect(screen.getByText(`Les conditions qui la filtrent (mode ${etape.nom}) ne trouveront jamais de tâche.`)).toBeTruthy();
  });
});
