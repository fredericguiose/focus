import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { creerApiSimulee } from '@/api/simule';
import { CarteActions } from '@/composants/actions/CarteActions';
import { DELAI_APERCU_MS } from '@/hooks/useApercuPrix';
import { useStatut } from '@/hooks/useFocus';
import { PHRASE_NUIT } from '@/lib/decisionNuit';
import { avancer, rendreAvecFocus, vider } from '@/test/rendu';

// Mardi 3 novembre à Paris : ouverture 19:50 (18:50Z), coucher 21:30 (20:30Z).
// Demain : sport et travail (obligatoires), révisions (sans heure, facultatives).
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

  it('« Je vais dormir » : la fenêtre s’ouvre sur maintenant, « Commencer la nuit » → avancer_coucher', async () => {
    const { enregistrer } = await rendre(SOIREE);
    fireEvent.click(bouton(/Je vais dormir/)!);
    await vider();
    const fenetre = screen.getByRole('dialog');
    expect(within(fenetre).getByRole('heading', { name: 'Je vais dormir' })).toBeTruthy();
    // 20:00 à Paris : de maintenant (gauche) au coucher 21:30 (droite).
    const curseur = within(fenetre).getByRole('slider');
    expect(curseur.getAttribute('aria-valuenow')).toBe(curseur.getAttribute('aria-valuemax'));
    expect(within(fenetre).getByText('20:00')).toBeTruthy();
    expect(within(fenetre).getByText('prévu 21:30')).toBeTruthy();
    expect(within(fenetre).getByText('Lever demain inchangé :').textContent).toContain('05:30');
    expect(within(fenetre).getByText('La nuit commence maintenant : le PC se verrouille dans moins d’une minute.')).toBeTruthy();
    expect(within(fenetre).getByRole('button', { name: 'Annuler' })).toBeTruthy();
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Commencer la nuit' }));
    await avancer(50);
    expect(enregistrer).toHaveBeenCalledWith({ demande: { type: 'avancer_coucher', nuit: '2026-11-03', a: '2026-11-03T19:00:00Z' } });
    expect(bouton(/Je vais dormir/)).toBeNull();
  });

  it('« Je vais dormir » : heure plus tôt que le coucher → exception `coucher`, lever inchangé', async () => {
    const { enregistrer } = await rendre(SOIREE);
    fireEvent.click(bouton(/Je vais dormir/)!);
    await vider();
    const fenetre = screen.getByRole('dialog');
    const curseur = within(fenetre).getByRole('slider');
    // Depuis maintenant (20:00) : 20:15, 20:30, 20:45.
    for (let i = 0; i < 3; i++) fireEvent.keyDown(curseur, { key: 'ArrowRight' });
    await vider();
    expect(within(fenetre).getByText('20:45')).toBeTruthy();
    expect(within(fenetre).getByText('Cette heure devient ton coucher : le PC se verrouille à ce moment-là.')).toBeTruthy();
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Je me couche à 20:45' }));
    await avancer(50);
    expect(enregistrer).toHaveBeenCalledWith({ demande: { type: 'coucher', nuit: '2026-11-03', heure: '20:45' } });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('20:45', { selector: 'span' })).toBeTruthy(); // carte : coucher à 20:45
  });

  it('« Je vais dormir » : au coucher prévu, rien à envoyer ; « Annuler » ferme sans appel', async () => {
    const { enregistrer } = await rendre(SOIREE);
    fireEvent.click(bouton(/Je vais dormir/)!);
    await vider();
    const fenetre = screen.getByRole('dialog');
    fireEvent.keyDown(within(fenetre).getByRole('slider'), { key: 'Home' });
    await vider();
    expect(within(fenetre).getByRole<HTMLButtonElement>('button', { name: 'Je me couche à 21:30' }).disabled).toBe(true);
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Annuler' }));
    await vider();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(enregistrer).not.toHaveBeenCalled();
  });
});

describe('« Décaler le coucher » avant l’ouverture : raison seule', () => {
  it('retirer : tous les engagements de demain, prix en direct ; obligatoire, une raison ; facultatif, libre', async () => {
    const { prix } = await rendre(JOURNEE);
    const fenetre = await ouvrirDecaler();
    fireEvent.click(within(fenetre).getByRole('button', { name: /Retirer un engagement de demain/ }));
    await vider();
    expect(within(fenetre).getByLabelText(/Travail/)).toBeTruthy();
    expect(within(fenetre).getByLabelText(/Révisions/).closest('label')?.textContent).toContain('facultatif');
    fireEvent.click(within(fenetre).getByLabelText(/Sport/));
    await avancer(DELAI_APERCU_MS);
    expect(prix).toHaveBeenCalledWith({ demande: { type: 'retire', date: '2026-11-04', engagement: 'sport' } });
    const apercu = within(fenetre).getByRole('region', { name: 'Prix du changement' });
    expect(within(apercu).getByText('Lever')).toBeTruthy();
    expect(within(fenetre).getByLabelText(/^Raison/)).toBeTruthy();
    expect(within(fenetre).queryByLabelText(/^Recopiez/)).toBeNull();

    fireEvent.click(within(fenetre).getByLabelText(/Révisions/));
    await avancer(DELAI_APERCU_MS);
    expect(within(fenetre).getByText('Sans justification')).toBeTruthy();
    expect(within(fenetre).queryByLabelText(/^Raison/)).toBeNull();
    expect(within(fenetre).getByRole<HTMLButtonElement>('button', { name: 'Valider' }).disabled).toBe(false);
  });

  it('soirée : retirer un engagement facultatif reste libre, sans décision de nuit', async () => {
    const { enregistrer } = await rendre(SOIREE);
    const fenetre = await ouvrirDecaler();
    fireEvent.click(within(fenetre).getByRole('button', { name: /Retirer un engagement de demain/ }));
    await vider();
    fireEvent.click(within(fenetre).getByLabelText(/Révisions/));
    await avancer(DELAI_APERCU_MS);
    expect(within(fenetre).queryByLabelText(/^Recopiez/)).toBeNull();
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Valider' }));
    await avancer(100);
    expect(enregistrer).toHaveBeenCalledWith({ demande: { type: 'retire', date: '2026-11-04', engagement: 'revisions' }, friction: undefined });
  });

  it('décaler un engagement sans heure : « Donner une heure », libre', async () => {
    const { prix } = await rendre(JOURNEE);
    const fenetre = await ouvrirDecaler();
    fireEvent.click(within(fenetre).getByRole('button', { name: /Décaler un engagement de demain/ }));
    await vider();
    expect(within(fenetre).getByLabelText(/Révisions/).closest('label')?.textContent).toContain('sans heure');
    fireEvent.click(within(fenetre).getByLabelText(/Révisions/));
    saisir('Donner une heure', '05:00');
    await avancer(DELAI_APERCU_MS);
    expect(prix).toHaveBeenLastCalledWith({ demande: { type: 'decale', date: '2026-11-04', engagement: 'revisions', heure: '05:00' } });
    expect(within(fenetre).getByText('Sans justification')).toBeTruthy();
  });

  it('choisir l’heure de coucher : champ raison sans phrase, « À justifier » en neutre puis enregistrement avec la raison', async () => {
    const { enregistrer } = await rendre(JOURNEE);
    const fenetre = await ouvrirDecaler();
    expect(within(fenetre).getByText(/une raison d'au moins 50 caractères est demandée/)).toBeTruthy();
    fireEvent.click(within(fenetre).getByRole('button', { name: /Choisir l'heure de coucher/ }));
    await vider();
    saisir('Heure de coucher', '22:00');
    await avancer(DELAI_APERCU_MS);

    const apercu = within(fenetre).getByRole('region', { name: 'Prix du changement' });
    expect(within(apercu).getByText('Raison exigée')).toBeTruthy();
    expect(within(apercu).getByText('À justifier')).toBeTruthy();
    expect(within(apercu).queryByText('Refusé')).toBeNull();
    expect(within(apercu).queryByText('Sans justification')).toBeNull();
    expect(within(apercu).getByText("Pour valider, écrivez ci-dessous une raison d'au moins 50 caractères.")).toBeTruthy();
    expect(within(fenetre).queryByText(/une fois par nuit/)).toBeNull();
    expect(within(fenetre).queryByLabelText(/^Recopiez/)).toBeNull();

    const valider = () => within(fenetre).getByRole<HTMLButtonElement>('button', { name: 'Valider' });
    expect(valider().disabled).toBe(true);
    saisir(/^Raison/, 'r'.repeat(49));
    expect(within(fenetre).getByText('49 / 50 caractères')).toBeTruthy();
    expect(valider().disabled).toBe(true);
    saisir(/^Raison/, ` ${'r'.repeat(50)} `);
    expect(within(apercu).getByText('Accepté')).toBeTruthy();
    expect(valider().disabled).toBe(false);

    fireEvent.click(valider());
    await avancer(100);
    expect(enregistrer).toHaveBeenCalledWith({
      demande: { type: 'coucher', nuit: '2026-11-03', heure: '22:00' },
      friction: { raison: 'r'.repeat(50) },
    });
  });

  it('décaler un engagement plus tard : raison exigée ; plus tôt : libre', async () => {
    await rendre(JOURNEE);
    const fenetre = await ouvrirDecaler();
    fireEvent.click(within(fenetre).getByRole('button', { name: /Décaler un engagement de demain/ }));
    await vider();
    fireEvent.click(within(fenetre).getByLabelText(/Sport/));
    saisir("Nouvelle heure de l'engagement", '06:30');
    await avancer(DELAI_APERCU_MS);
    expect(within(fenetre).getByText('Raison exigée')).toBeTruthy();
    expect(within(fenetre).getByLabelText(/^Raison/)).toBeTruthy();

    saisir("Nouvelle heure de l'engagement", '05:30');
    await avancer(DELAI_APERCU_MS);
    expect(within(fenetre).getByText('Sans justification')).toBeTruthy();
    expect(within(fenetre).queryByLabelText(/^Raison/)).toBeNull();
    expect(within(fenetre).getByRole<HTMLButtonElement>('button', { name: 'Valider' }).disabled).toBe(false);
  });

  it('sommeil sous le minimum : refus en rouge, sans champ raison', async () => {
    await rendre(JOURNEE);
    const fenetre = await ouvrirDecaler();
    fireEvent.click(within(fenetre).getByRole('button', { name: /Choisir l'heure de coucher/ }));
    await vider();
    saisir('Heure de coucher', '23:00');
    await avancer(DELAI_APERCU_MS);
    expect(within(fenetre).getByText('Refusé')).toBeTruthy();
    expect(within(fenetre).getByText(/sous le minimum/)).toBeTruthy();
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
    expect(within(fenetre).getByText('Facultatif : y renoncer ne demandera pas de raison.')).toBeTruthy();
    fireEvent.click(within(fenetre).getByRole('switch', { name: 'Facultatif' }));
    await avancer(DELAI_APERCU_MS);
    expect(prix).toHaveBeenLastCalledWith({
      demande: { type: 'ajoute', date: '2026-11-04', libelle: 'Dentiste', heure: '05:00', preparationMin: 45, obligatoire: false },
    });
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Valider' }));
    await avancer(100);
    expect(enregistrer).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Dentiste/)).toBeTruthy();
  });
});
