import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { creerApiSimulee } from '@/api/simule';
import { CarteActions } from '@/composants/actions/CarteActions';
import { DELAI_APERCU_MS } from '@/hooks/useApercuPrix';
import { useStatut } from '@/hooks/useFocus';
import { PHRASE_NUIT } from '@/lib/decisionNuit';
import { avancer, rendreAvecFocus, vider } from '@/test/rendu';

// Mardi 3 novembre à Paris : ouverture 19:50 (18:50Z), coucher 21:30 (20:30Z).
// Demain : sport (annulable, décalable) et travail (ni l'un ni l'autre).
const JOURNEE = '2026-11-03T14:00:00Z';
const SOIREE = '2026-11-03T19:00:00Z';
const NUIT = '2026-11-03T21:00:00Z';

function Actions() {
  return <CarteActions statut={useStatut()} />;
}

async function rendre(instant: string) {
  vi.setSystemTime(new Date(instant));
  const api = creerApiSimulee({ fuseau: 'Europe/Paris' });
  const prix = vi.spyOn(api, 'prixException');
  const enregistrer = vi.spyOn(api, 'enregistrerException');
  await rendreAvecFocus(<Actions />, api);
  return { prix, enregistrer };
}

const bouton = (nom: string | RegExp) => screen.queryByRole<HTMLButtonElement>('button', { name: nom });
const saisir = (libelle: string | RegExp, valeur: string) => fireEvent.change(screen.getByLabelText(libelle), { target: { value: valeur } });

async function ouvrirDecaler() {
  fireEvent.click(bouton(/Décaler le coucher/)!);
  await vider();
  return screen.getByRole('dialog');
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe('actions selon la phase donnée par l’API', () => {
  it('journée : « Je vais dormir » et « Décaler le coucher » libre', async () => {
    await rendre(JOURNEE);
    expect(bouton(/Je vais dormir/)).not.toBeNull();
    expect(bouton(/Décaler le coucher/)?.disabled).toBe(false);
    expect(screen.queryByText(/décision de nuit/)).toBeNull();
  });

  it('soirée : les deux boutons, « Décaler » en décision de nuit', async () => {
    await rendre(SOIREE);
    expect(bouton(/Je vais dormir/)).not.toBeNull();
    expect(bouton(/Décaler le coucher/)?.textContent).toContain('décision de nuit');
  });

  it('nuit : « Je vais dormir » disparaît ; « Décaler » va droit à la décision de nuit', async () => {
    const { enregistrer } = await rendre(NUIT);
    expect(bouton(/Je vais dormir/)).toBeNull();
    const fenetre = await ouvrirDecaler();
    expect(within(fenetre).getByText('Décision de nuit : une fois par nuit')).toBeTruthy();
    expect(within(fenetre).queryByText('Retirer un engagement de demain')).toBeNull();

    const valider = () => within(fenetre).getByRole<HTMLButtonElement>('button', { name: 'Prendre la décision de nuit' });
    saisir('Heure de coucher', '22:30');
    await avancer(DELAI_APERCU_MS);
    expect(valider().disabled).toBe(true);
    saisir(/^Raison/, 'r'.repeat(49));
    saisir(/^Recopiez/, PHRASE_NUIT);
    expect(within(fenetre).getByText('49 / 50 caractères')).toBeTruthy();
    expect(valider().disabled).toBe(true);
    saisir(/^Raison/, 'r'.repeat(50));
    expect(valider().disabled).toBe(false);

    fireEvent.click(valider());
    await avancer(100);
    expect(enregistrer).toHaveBeenCalledWith({
      demande: { type: 'coucher', nuit: '2026-11-03', heure: '22:30' },
      friction: { raison: 'r'.repeat(50), phrase: PHRASE_NUIT },
    });
    // Décision prise : l'API rend « Décaler » indisponible, avec son motif.
    expect(bouton(/Décaler le coucher/)?.disabled).toBe(true);
    expect(screen.getByText(/une seule par nuit/)).toBeTruthy();
  });

  it('« Je vais dormir » : confirmation simple puis avancer_coucher maintenant', async () => {
    const { enregistrer } = await rendre(SOIREE);
    fireEvent.click(bouton(/Je vais dormir/)!);
    await vider();
    const fenetre = screen.getByRole('dialog');
    expect(within(fenetre).getByText("Le PC se verrouille dans moins d'une minute.")).toBeTruthy();
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Commencer la nuit' }));
    await avancer(50);
    expect(enregistrer).toHaveBeenCalledWith({ demande: { type: 'avancer_coucher', nuit: '2026-11-03', a: '2026-11-03T19:00:00Z' } });
    expect(bouton(/Je vais dormir/)).toBeNull();
  });
});

describe('« Décaler le coucher » en mode libre', () => {
  it('retirer : ne propose que les engagements annulables, avec le prix en direct', async () => {
    const { prix } = await rendre(JOURNEE);
    const fenetre = await ouvrirDecaler();
    fireEvent.click(within(fenetre).getByRole('button', { name: /Retirer un engagement de demain/ }));
    await vider();
    expect(within(fenetre).getByLabelText(/Sport/)).toBeTruthy();
    expect(within(fenetre).queryByLabelText(/Travail/)).toBeNull();
    // Un seul engagement possible : il est déjà choisi, le prix part tout seul.
    await avancer(DELAI_APERCU_MS);
    expect(prix).toHaveBeenCalledWith({ demande: { type: 'retire', date: '2026-11-04', engagement: 'sport' } });
    const apercu = within(fenetre).getByRole('region', { name: 'Prix du changement' });
    expect(within(apercu).getByText('Lever')).toBeTruthy();
    expect(within(fenetre).queryByLabelText(/^Raison/)).toBeNull();
  });

  it('ajouter : libellé, heure, préparation en boutons, « Réveil à » calculé ; demain par défaut', async () => {
    const { prix, enregistrer } = await rendre(JOURNEE);
    const fenetre = await ouvrirDecaler();
    fireEvent.click(within(fenetre).getByRole('button', { name: /Ajouter un engagement demain/ }));
    await vider();
    expect(within(fenetre).getByText(/Demain,/)).toBeTruthy();
    expect(within(fenetre).queryByRole('tab')).toBeNull();

    saisir('Libellé', 'Dentiste');
    saisir("Heure de l'engagement", '05:00');
    fireEvent.click(within(fenetre).getByRole('radio', { name: '45 minutes' }));
    expect(within(fenetre).getByText('04:15')).toBeTruthy();

    await avancer(DELAI_APERCU_MS);
    expect(prix).toHaveBeenLastCalledWith({
      demande: { type: 'ajoute', date: '2026-11-04', libelle: 'Dentiste', heure: '05:00', preparationMin: 45 },
    });
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Valider' }));
    await avancer(100);
    expect(enregistrer).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Dentiste/)).toBeTruthy();
  });
});
