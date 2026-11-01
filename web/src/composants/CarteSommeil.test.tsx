import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { creerApiSimulee } from '@/api/simule';
import type { ReponseStatut } from '@/api/contrat';
import { CarteSommeil, ecartEnMots } from '@/composants/statut/CarteSommeil';

const MARDI_15H = Date.parse('2026-11-03T14:00:00Z');
const statut = () => creerApiSimulee({ maintenant: () => MARDI_15H, fuseau: 'Europe/Paris', phase: 'journee' }).statut();

describe('carte « Sommeil »', () => {
  it('écart à l’objectif en mots, sans signe', () => {
    expect(ecartEnMots(-29).texte).toBe("29 min de moins que l'objectif");
    expect(ecartEnMots(15).texte).toBe("15 min de plus que l'objectif");
    expect(ecartEnMots(-3).texte).toBe('objectif atteint');
    expect(ecartEnMots(-107, ' au total').texte).toBe('1 h 47 de moins au total');
  });

  it('mode simulé : temps dormi cette nuit, écart, phases, 7 dernières nuits', async () => {
    const s = await statut();
    const { container } = render(<CarteSommeil statut={s} />);
    expect(screen.getByText('Sommeil')).toBeTruthy();
    expect(screen.getByText('objectif 8 h')).toBeTruthy();
    expect(screen.getByText('Cette nuit')).toBeTruthy();
    // Dernière nuit fictive : 262 + 92 + 104 = 458 min dormies.
    expect(screen.getByText('7 h 38')).toBeTruthy();
    expect(screen.getByText("22 min de moins que l'objectif")).toBeTruthy();
    expect(screen.getByText('Profond')).toBeTruthy();
    expect(screen.getByText('1 h 32')).toBeTruthy();
    expect(screen.getByText('7 dernières nuits')).toBeTruthy();
    // 450 + 385 + 465 + 355 + 420 + 458 = 2533 min pour 6 × 480 = 2880.
    expect(screen.getByText(/^5 h 47 de moins au total/)).toBeTruthy();
    expect(screen.getByText('(6 nuits mesurées)')).toBeTruthy();
    expect(screen.queryByText(/incompl/)).toBeNull();
    expect(screen.getByText(/pas de mesure$/, { selector: 'li' })).toBeTruthy();
    const texte = container.textContent ?? '';
    expect(texte).not.toMatch(/dette|prévu|[+−]\d/i);
  });

  it('phases dans l’ordre léger, REM, profond, éveil', async () => {
    render(<CarteSommeil statut={await statut()} />);
    const noms = screen.getByLabelText('Phases de sommeil').querySelectorAll('li > span:nth-child(2)');
    expect([...noms].map((n) => n.textContent)).toEqual(['Léger', 'REM', 'Profond', 'Éveil']);
  });

  it('dernière nuit mesurée plus ancienne : « Nuit du … » ; objectif de la config', async () => {
    const s = await statut();
    const nuits = s.nuits!.map((n, i) => (i === s.nuits!.length - 1 ? { ...n, endormi_min: null, phases: null } : n));
    render(<CarteSommeil statut={{ ...s, nuits, objectif_sommeil_min: 420 }} />);
    expect(screen.getByText(/^Nuit du \S+ \d+ \S+/)).toBeTruthy();
    expect(screen.getByText('objectif 7 h')).toBeTruthy();
    expect(screen.getByText('objectif atteint')).toBeTruthy();
  });

  it('sans mesure : le dit, sans graphique ni dette prévue', async () => {
    const s = await statut();
    const sansMesure: ReponseStatut = {
      ...s,
      nuits: s.nuits!.map((n) => ({ nuit: n.nuit, dette_min: n.dette_min, endormi_min: null, phases: null })),
      sommeil_mesure: { derniere_synchro: null, erreur: 'jeton_xiaomi_expire' },
    };
    render(<CarteSommeil statut={sansMesure} />);
    expect(screen.getByText(/Pas encore de nuit mesurée/)).toBeTruthy();
    expect(screen.queryByText('7 dernières nuits')).toBeNull();
    expect(screen.queryByText('Profond')).toBeNull();
    expect(screen.getByText(/compte Xiaomi a expiré/)).toBeTruthy();
  });
});
