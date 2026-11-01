import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { creerApiSimulee } from '@/api/simule';
import type { ReponseStatut } from '@/api/contrat';
import { CarteDette } from '@/composants/statut/CarteDette';

const MARDI_15H = Date.parse('2026-11-03T14:00:00Z');
const statut = () => creerApiSimulee({ maintenant: () => MARDI_15H, fuseau: 'Europe/Paris', phase: 'journee' }).statut();

describe('carte « Dette de sommeil »', () => {
  it('mode simulé : dette mesurée d’abord, prévue en second, phases de la dernière nuit', async () => {
    const s = await statut();
    render(<CarteDette statut={s} />);
    // Dernière nuit fictive : 262 + 92 + 104 = 458 min endormi → +22 min.
    expect(screen.getByText('+22 min')).toBeTruthy();
    expect(screen.getByText(/mesurée la nuit du/)).toBeTruthy();
    expect(screen.getByText(/^Pas de mesure de la montre : \S+ \d+ \S+$/)).toBeTruthy();
    expect(screen.getByText('Dette mesurée des 7 dernières nuits')).toBeTruthy();
    expect(screen.getByText('Profond')).toBeTruthy();
    expect(screen.getByText('1 h 32')).toBeTruthy();
    expect(screen.getByText(/Cumul mesuré \(6 nuits\)/)).toBeTruthy();
  });

  it('sans mesure : dette prévue, comme avant', async () => {
    const s = await statut();
    const sansMesure: ReponseStatut = {
      ...s,
      nuits: s.nuits!.map((n) => ({ nuit: n.nuit, dette_min: n.dette_min, dette_reelle_min: null, phases: null })),
      dette_cumulee_reelle_min: null,
      sommeil_mesure: { derniere_synchro: null, erreur: 'jeton_xiaomi_expire' },
    };
    render(<CarteDette statut={sansMesure} />);
    expect(screen.getByText('prévue cette nuit')).toBeTruthy();
    expect(screen.getByText('Dette prévue des 7 dernières nuits')).toBeTruthy();
    expect(screen.queryByText('Profond')).toBeNull();
    expect(screen.getByText(/compte Xiaomi a expiré/)).toBeTruthy();
    expect(screen.getByText(/Cumul sur 7 nuits/)).toBeTruthy();
  });
});
