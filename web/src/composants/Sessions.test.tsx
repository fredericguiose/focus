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
  it('s’ouvre d’elle-même ; « Je continue » attend attente_s ; « J’arrête » est immédiat', async () => {
    await rendreAvecFocus(<EcranSessions />, creerApiSimulee({ fuseau: 'Europe/Paris' }));
    expect(screen.getByRole('dialog', { name: 'Toujours sur « Exercices de probabilités » ?' })).toBeTruthy();

    expect(bouton(/Je continue/).disabled).toBe(true);
    expect(bouton(/Je continue/).textContent).toBe('Je continue (4 s)');
    expect(bouton("J'arrête").disabled).toBe(false);
    expect(screen.getByRole('progressbar', { name: 'Attente avant de continuer' })).toBeTruthy();

    await avancer(3_000);
    expect(bouton(/Je continue/).textContent).toBe('Je continue (1 s)');
    expect(bouton(/Je continue/).disabled).toBe(true);

    await avancer(1_000);
    expect(bouton(/Je continue/).disabled).toBe(false);

    fireEvent.click(bouton(/Je continue/));
    await vider();
    expect(screen.queryByRole('button', { name: /Je continue/ })).toBeNull();
    expect(screen.getByText(/Prochaine question dans/)).toBeTruthy();
    // La question suivante est déjà dans le statut (posee_a futur) : pas de dialogue avant posee_a.
    expect(screen.queryByRole('dialog')).toBeNull();

    // Intervalle simulé de 30 s. Seconde par seconde : un rafraîchissement du statut lancé au milieu
    // d'une longue avance ne se résoudrait qu'à la fin, avec une heure serveur périmée.
    for (let i = 0; i < 31; i++) await avancer(1_000);
    expect(screen.getByRole('dialog', { name: 'Toujours sur « Exercices de probabilités » ?' })).toBeTruthy();
  });

  it('« J’arrête » ferme la session sans attendre', async () => {
    await rendreAvecFocus(<EcranSessions />, creerApiSimulee({ fuseau: 'Europe/Paris' }));
    fireEvent.click(bouton("J'arrête"));
    await vider();
    expect(screen.getByText('Aucune session ouverte.')).toBeTruthy();
  });

  it('se referme sans répondre et se rouvre par « Répondre »', async () => {
    await rendreAvecFocus(<EcranSessions />, creerApiSimulee({ fuseau: 'Europe/Paris' }));
    fireEvent.click(bouton('Fermer'));
    await vider();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(bouton('Répondre'));
    await vider();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('ouverture de session', () => {
  async function preparer() {
    const api = creerApiSimulee({ fuseau: 'Europe/Paris' });
    const ouvrir = vi.spyOn(api, 'ouvrirSession');
    await rendreAvecFocus(<EcranSessions />, api);
    // La question de la session de démonstration s'ouvre d'elle-même : on la laisse de côté.
    fireEvent.click(bouton('Fermer'));
    await vider();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ouvrir une session' })[0]!);
    await vider();
    return { ouvrir };
  }

  const choisir = () => {
    fireEvent.click(screen.getByRole('radio', { name: /Exercices de probabilités/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tout le groupe Divertissement' }));
  };

  it('grise les tâches non éligibles avec leur heure d’éligibilité', async () => {
    await preparer();
    const recente = screen.getByRole<HTMLButtonElement>('radio', { name: /Relire le chapitre 4/ });
    expect(recente.disabled).toBe(true);
    expect(screen.getByText('dès 15:10')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('radio', { name: /Exercices de probabilités/ }).disabled).toBe(false);
  });

  it('n’envoie qu’après un compte à rebours de 10 s', async () => {
    const { ouvrir } = await preparer();
    expect(bouton('Ouvrir la session').disabled).toBe(true);

    choisir();
    fireEvent.click(bouton('Ouvrir la session'));
    expect(screen.getByText('Envoi dans 10 s…')).toBeTruthy();
    const barre = () => screen.getByRole('progressbar', { name: 'Compte à rebours' });
    expect(barre().getAttribute('aria-valuenow')).toBe('0');

    await avancer(4_000);
    expect(screen.getByText('Envoi dans 6 s…')).toBeTruthy();
    expect(barre().getAttribute('aria-valuenow')).toBe('40');

    await avancer(5_000);
    expect(screen.getByText('Envoi dans 1 s…')).toBeTruthy();
    expect(ouvrir).not.toHaveBeenCalled();

    await avancer(1_000);
    expect(ouvrir).toHaveBeenCalledTimes(1);
    expect(ouvrir).toHaveBeenCalledWith({ appareil: 'pc_linux', tache_id: 't1', apps: ['youtube', 'x'] });
    await avancer(50);
    expect(screen.getByText('Session ouverte')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('montre tous les appareils ; celui où une session est impossible est désactivé, avec son motif', async () => {
    await preparer();
    const radio = (nom: RegExp) => screen.getByRole<HTMLButtonElement>('radio', { name: nom });
    expect(radio(/^PC Linux/).disabled).toBe(false);
    expect(radio(/^iPhone/).disabled).toBe(false);
    expect(radio(/^PC Windows/).disabled).toBe(true);
    expect(screen.getByText('Aucun compte de travail sur ce PC')).toBeTruthy();
  });

  it('apps par groupe : « tout le groupe », ou une app à la fois en dépliant le groupe ; les apps hors groupe seules', async () => {
    await preparer();
    const tout = screen.getByRole('checkbox', { name: 'Tout le groupe IA conversationnelle' });
    expect(tout.getAttribute('data-state')).toBe('unchecked');
    expect(screen.queryByRole('checkbox', { name: 'Gemini' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /Choisir/ })[1]!);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Gemini' }));
    expect(tout.getAttribute('data-state')).toBe('indeterminate');
    expect(screen.getByText(/1 sur 3/)).toBeTruthy();
    fireEvent.click(tout);
    expect(tout.getAttribute('data-state')).toBe('checked');
    // Gmail n'est pas bloqué en Travail : il n'est pas proposé.
    expect(screen.queryByRole('checkbox', { name: 'Gmail' })).toBeNull();
  });

  it('« Annuler » pendant l’attente n’envoie rien', async () => {
    const { ouvrir } = await preparer();
    choisir();
    fireEvent.click(bouton('Ouvrir la session'));
    await avancer(5_000);
    fireEvent.click(bouton('Annuler'));
    await avancer(10_000);
    expect(ouvrir).not.toHaveBeenCalled();
    expect(bouton('Ouvrir la session').disabled).toBe(false);
  });
});

describe('sessions la nuit', () => {
  it('explique pourquoi et jusqu’à quand, au lieu d’un bouton grisé muet', async () => {
    vi.setSystemTime(new Date('2026-11-03T21:00:00Z'));
    await rendreAvecFocus(<EcranSessions />, creerApiSimulee({ fuseau: 'Europe/Paris' }));
    // Lever du mercredi 05:30 à Paris : fin du mode NIGHT_LOCK donnée par l'API (`jusqua`).
    expect(screen.getByText("Sessions interdites pendant la nuit, jusqu'à mer. 05:30")).toBeTruthy();
    // Le motif de la nuit est dans le titre : seul le PC Windows a un motif à part.
    expect(screen.getByText('PC Windows : aucun compte de travail sur ce PC')).toBeTruthy();
    expect(screen.queryByText(/PC Linux :/)).toBeNull();
    expect(screen.getAllByRole<HTMLButtonElement>('button', { name: /Ouvrir une session/ }).every((b) => b.disabled)).toBe(true);
  });
});

describe('soirée libre', () => {
  it('aucun appareil possible : bouton grisé et motif de chaque appareil', async () => {
    vi.setSystemTime(new Date('2026-11-03T20:15:00Z'));
    await rendreAvecFocus(<EcranSessions />, creerApiSimulee({ fuseau: 'Europe/Paris' }));
    expect(screen.getByText('Aucune session possible en ce moment')).toBeTruthy();
    expect(screen.getByText("PC Linux : rien n'est bloqué en ce moment")).toBeTruthy();
    expect(screen.getByText('PC Windows : aucun compte de travail sur ce PC')).toBeTruthy();
    expect(screen.getAllByRole<HTMLButtonElement>('button', { name: /Ouvrir une session/, hidden: true }).every((b) => b.disabled)).toBe(true);
  });
});
