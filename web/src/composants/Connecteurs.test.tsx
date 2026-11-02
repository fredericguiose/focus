import { fireEvent, screen, within } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiFocus, EtatConnecteur } from '@/api/contrat';
import { creerApiHttp } from '@/api/http';
import { creerApiSimulee } from '@/api/simule';
import { EcranConnecteurs } from '@/ecrans/Connecteurs';
import { rendreAvecFocus, vider } from '@/test/rendu';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-03T14:00:00Z'));
});
afterEach(() => {
  window.history.replaceState(null, '', '/');
});

const carte = (titre: string) => screen.getByText(titre).closest<HTMLElement>('[data-slot="card"]')!;

describe('écran Connecteurs', () => {
  it('une carte par connecteur ; serveur : état et synchro, sans bouton ; Google : connecter puis déconnecter', async () => {
    await rendreAvecFocus(<EcranConnecteurs />, creerApiSimulee({ fuseau: 'Europe/Paris' }));
    await vider();
    const todoist = within(carte('Todoist'));
    expect(todoist.getByText('Connecté · dernière synchro il y a 3 min')).toBeTruthy();
    expect(todoist.getByText('Configuré sur le serveur.')).toBeTruthy();
    expect(todoist.queryByRole('button')).toBeNull();
    expect(within(carte('Hevy')).getByText('Erreur')).toBeTruthy();

    const google = () => within(carte('Google Agenda'));
    expect(google().getByText('Non connecté')).toBeTruthy();
    fireEvent.click(google().getByRole('button', { name: 'Connecter' }));
    await vider();
    expect(google().getByText('Connecté')).toBeTruthy();
    fireEvent.click(google().getByRole('button', { name: 'Déconnecter' }));
    await vider();
    expect(google().getByText('Non connecté')).toBeTruthy();
  });

  it('retour de Google en erreur : message lisible, paramètres retirés de l’URL', async () => {
    const erreur = vi.spyOn(toast, 'error');
    window.history.replaceState(null, '', '/?google=erreur&raison=portee_refusee#connecteurs');
    await rendreAvecFocus(<EcranConnecteurs />, creerApiSimulee({ fuseau: 'Europe/Paris' }));
    await vider();
    expect(erreur).toHaveBeenCalledWith('Connexion Google impossible', { description: 'L’accès à l’agenda n’a pas été coché.' });
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#connecteurs');
  });
});

describe('client HTTP des connecteurs', () => {
  it('routes et méthodes', async () => {
    const appels: string[] = [];
    const etat: EtatConnecteur[] = [];
    const recuperer = (async (url: string, init: RequestInit) => {
      appels.push(`${init.method} ${url}`);
      return new Response(JSON.stringify(url.endsWith('/connecteurs') ? { connecteurs: etat } : { url: 'https://accounts.google.com/x', revoque: true }));
    }) as typeof fetch;
    const api: ApiFocus = creerApiHttp(null, '', recuperer);
    await api.connecteurs();
    expect((await api.connecterGoogle()).url).toBe('https://accounts.google.com/x');
    expect((await api.deconnecterGoogle()).revoque).toBe(true);
    expect(appels).toEqual(['GET /v1/connecteurs', 'POST /v1/connecteurs/google/connecter', 'POST /v1/connecteurs/google/deconnecter']);
  });
});
