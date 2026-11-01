import { fireEvent, screen, within } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiFocus, DetteSemaine, ReponseStatut } from '@/api/contrat';
import { creerApiSimulee } from '@/api/simule';
import { RattraperSommeil } from '@/composants/actions/RattraperSommeil';
import { oublierPropositions } from '@/lib/dette';
import { avancer, rendreAvecFocus, vider } from '@/test/rendu';

// Mardi 3 novembre à Paris : ouverture 19:50, coucher 21:30, lever mercredi 05:30.
// Semaine posée par les tests : 3 h à rattraper sur 6 nuits → objectif du soir 30 min.
const JOURNEE = '2026-11-03T14:00:00Z';
const SOIREE = '2026-11-03T19:00:00Z'; // 20:00
const NUIT = '2026-11-03T21:00:00Z';

const SEMAINE: DetteSemaine = {
  debut: '2026-11-02', fin: '2026-11-08', dette_min: 200, rattrape_min: 20, reste_min: 180, nuits_restantes: 6, nuits_mesurees: 1, nuits_total: 1,
};

/** La dette de la semaine est posée par le test (le mode simulé n'en a presque pas un mardi). */
function api(modifier?: (s: ReponseStatut) => ReponseStatut, semaine: Partial<DetteSemaine> | null = {}): ApiFocus {
  const a = creerApiSimulee({ fuseau: 'Europe/Paris' });
  const statut = a.statut;
  a.statut = async () => {
    const s = await statut();
    const avecSemaine = { ...s, dette_semaine: semaine === null ? undefined : { ...SEMAINE, ...semaine } };
    return modifier ? modifier(avecSemaine) : avecSemaine;
  };
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
  it('soirée avec une dette cette semaine : objectif du soir, curseur sur l’heure suggérée', async () => {
    await rendre(SOIREE);
    expect(fenetre()).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Ce soir : 30 min de sommeil en plus' })).toBeTruthy();
    expect(within(fenetre()!).getByText('Cette semaine : 3 h à rattraper, sur 6 nuits')).toBeTruthy();
    // Coucher 21:30 − 30 min.
    expect(within(fenetre()!).getByText('21:00')).toBeTruthy();
    expect(within(fenetre()!).getByText('Lever demain inchangé :').textContent).toContain('05:30');
    expect(bouton('Je me couche à 21:00').disabled).toBe(false);
    expect(curseur().getAttribute('aria-valuemax')).toBe('6'); // 21:30 → 20:00, par quarts d'heure
    expect(curseur().getAttribute('aria-valuenow')).toBe('2');
    expect(fenetre()!.textContent).not.toMatch(/rembours/i);
  });

  it('objectif plafonné à 1 h, arrondi au quart d’heure supérieur, au moins 15 min', async () => {
    const plafond = await rendre(SOIREE, api(undefined, { reste_min: 300, nuits_restantes: 2 }));
    expect(screen.getByRole('heading', { name: 'Ce soir : 1 h de sommeil en plus' })).toBeTruthy();
    expect(within(fenetre()!).getByText('20:30')).toBeTruthy();
    plafond.rendu.unmount();
    localStorage.clear();
    oublierPropositions();
    // 100 min sur 4 nuits = 25 → 30 min.
    const arrondi = await rendre(SOIREE, api(undefined, { reste_min: 100, nuits_restantes: 4 }));
    expect(screen.getByRole('heading', { name: 'Ce soir : 30 min de sommeil en plus' })).toBeTruthy();
    expect(within(fenetre()!).getByText('Cette semaine : 1 h 40 à rattraper, sur 4 nuits')).toBeTruthy();
    arrondi.rendu.unmount();
    localStorage.clear();
    oublierPropositions();
    // 20 min sur 6 nuits : 15 min au moins.
    await rendre(SOIREE, api(undefined, { reste_min: 20, nuits_restantes: 6 }));
    expect(screen.getByRole('heading', { name: 'Ce soir : 15 min de sommeil en plus' })).toBeTruthy();
    expect(within(fenetre()!).getByText('21:15')).toBeTruthy();
  });

  it('dimanche : « sur cette dernière nuit » ; objectif hors d’atteinte : la plus tôt possible', async () => {
    // 20:50 : il ne reste que 21:30, 21:15 et 21:00 ; l'objectif (1 h) voudrait 20:30.
    await rendre('2026-11-03T19:50:00Z', api(undefined, { reste_min: 90, nuits_restantes: 1 }));
    expect(screen.getByRole('heading', { name: 'Ce soir : 1 h de sommeil en plus' })).toBeTruthy();
    expect(within(fenetre()!).getByText('Cette semaine : 1 h 30 à rattraper, sur cette dernière nuit')).toBeTruthy();
    expect(within(fenetre()!).getByText('21:00')).toBeTruthy();
    expect(within(fenetre()!).getByText('+30 min · objectif du soir 1 h')).toBeTruthy();
  });

  it('pas en journée, ni la nuit', async () => {
    const journee = await rendre(JOURNEE);
    expect(fenetre()).toBeNull();
    journee.rendu.unmount();
    await rendre(NUIT);
    expect(fenetre()).toBeNull();
  });

  it('pas sans dette de la semaine, ni sous la tolérance de la carte Sommeil', async () => {
    const sans = await rendre(SOIREE, api(undefined, null));
    expect(fenetre()).toBeNull();
    sans.rendu.unmount();
    const tolerance = await rendre(SOIREE, api(undefined, { reste_min: 5 }));
    expect(fenetre()).toBeNull();
    tolerance.rendu.unmount();
    await rendre(SOIREE, api(undefined, { reste_min: 6 }));
    expect(fenetre()).not.toBeNull();
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

  it('dimanche soir : la nouvelle semaine est encore vide, pas de proposition', async () => {
    // Dimanche 1er novembre, soirée : la semaine du 26/10 vient de se clore (dette non rattrapée),
    // la nuit de ce soir ouvre celle du 02/11, sans dette.
    const a = creerApiSimulee({ fuseau: 'Europe/Paris', phase: 'soiree', maintenant: () => Date.parse('2026-11-01T14:00:00Z') });
    const s = await a.statut();
    expect(s.phase).toBe('soiree');
    expect(s.dette_semaine).toMatchObject({ debut: '2026-11-02', reste_min: 0, nuits_restantes: 7 });
    expect(s.bilans_semaines![0]!.non_rattrape_min).toBeGreaterThan(5);
    const vide = await rendre(new Date(Date.now()).toISOString(), a);
    expect(fenetre()).toBeNull();
    vide.rendu.unmount();
    // Témoin : même soirée, avec une dette dans la semaine, la proposition s'ouvre.
    const b = creerApiSimulee({ fuseau: 'Europe/Paris', phase: 'soiree', maintenant: () => Date.parse('2026-11-01T14:00:00Z') });
    const statut = b.statut;
    b.statut = async () => {
      const x = await statut();
      return { ...x, dette_semaine: { ...x.dette_semaine!, dette_min: 60, reste_min: 60 } };
    };
    await rendre(new Date(Date.now()).toISOString(), b);
    expect(fenetre()).not.toBeNull();
    expect(within(fenetre()!).getByText('Cette semaine : 1 h à rattraper, sur 7 nuits')).toBeTruthy();
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
  it('la barre suit l’objectif du soir, dans les deux sens, au clavier', async () => {
    await rendre(SOIREE);
    const barre = within(fenetre()!).getByRole('progressbar');
    expect(barre.getAttribute('aria-valuenow')).toBe('100');
    expect(within(fenetre()!).getByText('+30 min · objectif du soir atteint')).toBeTruthy();

    fireEvent.keyDown(curseur(), { key: 'ArrowRight' });
    await vider();
    expect(within(fenetre()!).getByText('21:15')).toBeTruthy();
    expect(within(fenetre()!).getByText('+15 min · objectif du soir 30 min')).toBeTruthy();
    expect(barre.getAttribute('aria-valuenow')).toBe('50');
    expect(barre.getAttribute('aria-valuetext')).toBe('+15 min · objectif du soir 30 min');
    expect(curseur().getAttribute('aria-valuetext')).toBe('21:15, +15 min · objectif du soir 30 min');

    fireEvent.keyDown(curseur(), { key: 'ArrowRight' });
    await vider();
    expect(within(fenetre()!).getByText('Glisse à gauche pour dormir plus.')).toBeTruthy();
    expect(barre.getAttribute('aria-valuenow')).toBe('0');
    expect(bouton('Je me couche à 21:30').disabled).toBe(true);

    for (let i = 0; i < 4; i++) fireEvent.keyDown(curseur(), { key: 'ArrowLeft' });
    await vider();
    expect(within(fenetre()!).getByText('20:30')).toBeTruthy();
    expect(within(fenetre()!).getByText('+1 h · objectif du soir atteint')).toBeTruthy();
    // Au-delà de l'objectif : la barre reste pleine.
    expect(barre.getAttribute('aria-valuenow')).toBe('100');

    fireEvent.keyDown(curseur(), { key: 'End' });
    await vider();
    expect(within(fenetre()!).getByText('20:00')).toBeTruthy();
    expect(fenetre()!.textContent).not.toMatch(/rembours/i);
  });
});

describe('boutons', () => {
  it('« Je me couche à » envoie un coucher plus tôt, ferme et rafraîchit', async () => {
    const { enregistrer, api: a } = await rendre(SOIREE);
    const statut = vi.spyOn(a, 'statut');
    const succes = vi.spyOn(toast, 'success');
    for (let i = 0; i < 3; i++) fireEvent.keyDown(curseur(), { key: 'ArrowLeft' }); // 21:00 → 20:15
    await vider();
    fireEvent.click(bouton('Je me couche à 20:15'));
    await vider();
    expect(enregistrer).toHaveBeenCalledWith({ demande: { type: 'coucher', nuit: '2026-11-03', heure: '20:15' } });
    expect(statut).toHaveBeenCalled();
    expect(fenetre()).toBeNull();
    expect(succes).toHaveBeenCalledWith('Coucher avancé à 20:15', expect.anything());
    // Le coucher appliqué a reculé : la proposition ne revient pas, même sans mémoire.
    oublierPropositions();
    localStorage.clear();
    await avancer(20_000);
    expect(fenetre()).toBeNull();
    expect((await a.statut()).journee.coucherApplique).toBe('2026-11-03T19:15:00Z');
  });

  it('curseur tout à gauche : « Commencer la nuit », le même appel que le bouton « Je vais dormir »', async () => {
    const { enregistrer } = await rendre(SOIREE);
    const succes = vi.spyOn(toast, 'success');
    expect(bouton('Plus tard')).toBeTruthy();
    expect(within(fenetre()!).queryByRole('button', { name: 'Annuler' })).toBeNull();
    fireEvent.keyDown(curseur(), { key: 'End' });
    await vider();
    expect(within(fenetre()!).getByText('maintenant', { selector: 'span.uppercase' })).toBeTruthy();
    fireEvent.click(bouton('Commencer la nuit'));
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
    fireEvent.click(bouton('Je me couche à 20:45'));
    await vider();
    expect(fenetre()).not.toBeNull();
    expect(within(fenetre()!).getByRole('alert')).toBeTruthy();
  });
});
