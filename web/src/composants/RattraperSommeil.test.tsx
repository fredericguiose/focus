import { fireEvent, screen, within } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiFocus, ReponseStatut } from '@/api/contrat';
import { creerApiSimulee } from '@/api/simule';
import { RattraperSommeil } from '@/composants/actions/RattraperSommeil';
import { oublierPropositions } from '@/lib/dette';
import { avancer, rendreAvecFocus, vider } from '@/test/rendu';

// Mardi 3 novembre à Paris : ouverture 19:50, coucher 21:30, lever mercredi 05:30.
// Dette réelle simulée : 347 min sur six nuits mesurées − 1 h 45 de siestes = 4 h 02.
const JOURNEE = '2026-11-03T14:00:00Z';
const SOIREE = '2026-11-03T19:00:00Z'; // 20:00
const NUIT = '2026-11-03T21:00:00Z';

function api(modifier?: (s: ReponseStatut) => ReponseStatut): ApiFocus {
  const a = creerApiSimulee({ fuseau: 'Europe/Paris' });
  if (modifier) {
    const statut = a.statut;
    a.statut = async () => modifier(await statut());
  }
  return a;
}

async function rendre(instant: string, a: ApiFocus = api()) {
  vi.setSystemTime(new Date(instant));
  const enregistrer = vi.spyOn(a, 'enregistrerException');
  const rendu = await rendreAvecFocus(<RattraperSommeil />, a);
  return { enregistrer, rendu, api: a };
}

const fenetre = () => screen.queryByRole('dialog');
const curseur = () => within(fenetre()!).getByRole('slider');
const bouton = (nom: string | RegExp) => within(fenetre()!).getByRole<HTMLButtonElement>('button', { name: nom });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  oublierPropositions();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('apparition', () => {
  it('soirée avec une dette mesurée : la proposition s’ouvre, curseur sur le coucher prévu', async () => {
    await rendre(SOIREE);
    expect(fenetre()).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Tu as 4 h 02 de sommeil à rattraper' })).toBeTruthy();
    expect(within(fenetre()!).getByText('21:30')).toBeTruthy();
    expect(within(fenetre()!).getByText('Lever demain inchangé :').textContent).toContain('05:30');
    expect(bouton('Je me couche à 21:30').disabled).toBe(true);
    expect(curseur().getAttribute('aria-valuemax')).toBe('6'); // 21:30 → 20:00, par quarts d'heure
  });

  it('pas en journée, ni la nuit', async () => {
    const journee = await rendre(JOURNEE);
    expect(fenetre()).toBeNull();
    journee.rendu.unmount();
    await rendre(NUIT);
    expect(fenetre()).toBeNull();
  });

  it('pas sans dette mesurée, ni sous la tolérance de la carte Sommeil', async () => {
    const sans = await rendre(SOIREE, api((s) => ({ ...s, dette_cumulee_reelle_min: null })));
    expect(fenetre()).toBeNull();
    sans.rendu.unmount();
    await rendre(SOIREE, api((s) => ({ ...s, dette_cumulee_reelle_min: 5 })));
    expect(fenetre()).toBeNull();
  });

  it('pas si le coucher a déjà été avancé ce soir, ni après une décision de nuit', async () => {
    vi.setSystemTime(new Date(SOIREE));
    const a = api();
    await a.enregistrerException({ demande: { type: 'coucher', nuit: '2026-11-03', heure: '21:00' } });
    const avance = await rendre(SOIREE, a);
    expect(fenetre()).toBeNull();
    avance.rendu.unmount();
    await rendre(SOIREE, api((s) => ({ ...s, journee: { ...s.journee, decisionDeNuitPrise: true } })));
    expect(fenetre()).toBeNull();
  });

  it('s’ouvre quand la soirée s’ouvre, tableau de bord déjà affiché', async () => {
    await rendre('2026-11-03T18:45:00Z'); // 19:45
    expect(fenetre()).toBeNull();
    await avancer(20_000); // relecture du statut à 19:45:20 : toujours avant 19:50
    expect(fenetre()).toBeNull();
    await avancer(5 * 60_000);
    expect(fenetre()).not.toBeNull();
  });
});

describe('une fois par soir', () => {
  it('refermée par « Plus tard », elle ne revient pas ce soir-là', async () => {
    const premier = await rendre(SOIREE);
    fireEvent.click(bouton('Plus tard'));
    await vider();
    expect(fenetre()).toBeNull();
    await avancer(20_000);
    expect(fenetre()).toBeNull();
    premier.rendu.unmount();
    oublierPropositions(); // nouvelle session : seul le stockage s'en souvient
    await rendre(SOIREE);
    expect(fenetre()).toBeNull();
    expect(localStorage.getItem('focus.dette.proposee.2026-11-03')).not.toBeNull();
  });

  it('refermée par la croix : idem', async () => {
    const premier = await rendre(SOIREE);
    fireEvent.click(bouton('Fermer'));
    await vider();
    expect(fenetre()).toBeNull();
    premier.rendu.unmount();
    await rendre(SOIREE);
    expect(fenetre()).toBeNull();
  });

  it('stockage indisponible : la mémoire de la session empêche la boucle', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqué');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqué');
    });
    const premier = await rendre(SOIREE);
    expect(fenetre()).not.toBeNull();
    fireEvent.click(bouton('Plus tard'));
    await vider();
    premier.rendu.unmount();
    await rendre(SOIREE);
    expect(fenetre()).toBeNull();
  });

  it('la nuit suivante, elle revient', async () => {
    localStorage.setItem('focus.dette.proposee.2026-11-02', '1');
    await rendre(SOIREE);
    expect(fenetre()).not.toBeNull();
    expect(localStorage.getItem('focus.dette.proposee.2026-11-02')).toBeNull();
  });
});

describe('curseur', () => {
  it('la barre et le texte suivent le curseur, au clavier', async () => {
    await rendre(SOIREE);
    const barre = within(fenetre()!).getByRole('progressbar');
    expect(barre.getAttribute('aria-valuenow')).toBe('100');
    expect(within(fenetre()!).getByText('Glisse à gauche pour dormir plus.')).toBeTruthy();

    for (let i = 0; i < 4; i++) fireEvent.keyDown(curseur(), { key: 'ArrowLeft' });
    await vider();
    expect(within(fenetre()!).getByText('20:30')).toBeTruthy();
    expect(within(fenetre()!).getByText('+1 h de sommeil · reste 3 h 02')).toBeTruthy();
    expect(Number(barre.getAttribute('aria-valuenow'))).toBeCloseTo((182 / 242) * 100, 5);
    expect(barre.getAttribute('aria-valuetext')).toBe('reste 3 h 02');
    expect(curseur().getAttribute('aria-valuetext')).toBe('20:30, +1 h de sommeil · reste 3 h 02');
    expect(bouton('Je me couche à 20:30').disabled).toBe(false);

    fireEvent.keyDown(curseur(), { key: 'ArrowRight' });
    await vider();
    expect(within(fenetre()!).getByText('+45 min de sommeil · reste 3 h 17')).toBeTruthy();

    fireEvent.keyDown(curseur(), { key: 'End' });
    await vider();
    expect(within(fenetre()!).getByText('20:00')).toBeTruthy();
  });

  it('gain au-delà de la dette : « dette remboursée », jamais de reste négatif', async () => {
    await rendre(SOIREE, api((s) => ({ ...s, dette_cumulee_reelle_min: 40 })));
    expect(screen.getByRole('heading', { name: 'Tu as 40 min de sommeil à rattraper' })).toBeTruthy();
    for (let i = 0; i < 4; i++) fireEvent.keyDown(curseur(), { key: 'ArrowLeft' });
    await vider();
    expect(within(fenetre()!).getByText('+1 h de sommeil · dette remboursée')).toBeTruthy();
    expect(within(fenetre()!).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });
});

describe('boutons', () => {
  it('« Je me couche à » envoie un coucher plus tôt, ferme et rafraîchit', async () => {
    const { enregistrer, api: a } = await rendre(SOIREE);
    const statut = vi.spyOn(a, 'statut');
    const succes = vi.spyOn(toast, 'success');
    for (let i = 0; i < 6; i++) fireEvent.keyDown(curseur(), { key: 'ArrowLeft' });
    await vider();
    fireEvent.click(bouton('Je me couche à 20:00'));
    await vider();
    expect(enregistrer).toHaveBeenCalledWith({ demande: { type: 'coucher', nuit: '2026-11-03', heure: '20:00' } });
    expect(statut).toHaveBeenCalled();
    expect(fenetre()).toBeNull();
    expect(succes).toHaveBeenCalledWith('Coucher avancé à 20:00', expect.anything());
    // Le coucher appliqué a reculé : la proposition ne revient pas, même sans mémoire.
    oublierPropositions();
    localStorage.clear();
    await avancer(20_000);
    expect(fenetre()).toBeNull();
    expect((await a.statut()).journee.coucherApplique).toBe('2026-11-03T19:00:00Z');
  });

  it('« Me coucher maintenant » fait le même appel que « Je vais dormir »', async () => {
    const { enregistrer } = await rendre(SOIREE);
    const succes = vi.spyOn(toast, 'success');
    fireEvent.click(bouton('Me coucher maintenant'));
    await vider();
    expect(enregistrer).toHaveBeenCalledWith({ demande: { type: 'avancer_coucher', nuit: '2026-11-03', a: '2026-11-03T19:00:00Z' } });
    expect(fenetre()).toBeNull();
    expect(succes).toHaveBeenCalledWith('Bonne nuit', expect.anything());
  });

  it('refus de l’API : message affiché, la fenêtre reste ouverte', async () => {
    const { api: a } = await rendre(SOIREE);
    vi.spyOn(a, 'enregistrerException').mockRejectedValueOnce(new Error('panne'));
    fireEvent.keyDown(curseur(), { key: 'ArrowLeft' });
    await vider();
    fireEvent.click(bouton('Je me couche à 21:15'));
    await vider();
    expect(fenetre()).not.toBeNull();
    expect(within(fenetre()!).getByRole('alert')).toBeTruthy();
  });
});
