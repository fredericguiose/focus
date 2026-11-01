import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { creerApiSimulee } from '@/api/simule';
import type { CoucherDeLaNuit, LeverDuJour, RegulariteCouchers, RegulariteLevers } from '@/api/contrat';
import { CarteRegularite, detailCoucher, detailLever, resumeCouchers, resumeLevers } from '@/composants/statut/CarteRegularite';

const MARDI_15H = Date.parse('2026-11-03T14:00:00Z');
const statut = () => creerApiSimulee({ maintenant: () => MARDI_15H, fuseau: 'Europe/Paris', phase: 'journee' }).statut();

const jour = (partiel: Partial<LeverDuJour>): LeverDuJour => ({
  date: '2026-11-02',
  prevu: '2026-11-02T04:30:00Z',
  prevu_fige: true,
  mesure: '2026-11-02T04:32:00Z',
  ecart_min: 2,
  ...partiel,
});

const nuit = (partiel: Partial<CoucherDeLaNuit>): CoucherDeLaNuit => ({
  nuit: '2026-11-01',
  prevu: '2026-11-01T22:00:00Z',
  prevu_fige: true,
  mesure: '2026-11-02T01:12:00Z',
  ecart_min: 192,
  ...partiel,
});

describe('carte « Régularité » : couchers', () => {
  it('résumé : plage autour de minuit, écart et repère, sans phrase de dépassement', () => {
    const couchers: RegulariteCouchers = {
      nuits: [],
      amplitude: { plus_tot: '2026-11-03T22:10:00Z', plus_tard: '2026-11-02T01:12:00Z', ecart_min: 182, mesures: 4 },
      limite_min: 120,
    };
    expect(resumeCouchers(couchers, 'UTC')).toMatchObject({ texte: 'de 22:10 à 01:12 · écart 3 h 02 (repère 2 h)', classe: 'text-avertissement' });
    const sous = { ...couchers, amplitude: { ...couchers.amplitude!, plus_tard: '2026-11-02T23:10:00Z', ecart_min: 60 } };
    expect(resumeCouchers(sous, 'UTC')).toMatchObject({ texte: 'de 22:10 à 23:10 · écart 1 h (repère 2 h)', classe: 'text-foreground' });
    const exclues = { ...couchers, nuits: [nuit({ ignore: 'decalage_horaire' }), nuit({ nuit: '2026-11-02', ignore: 'decalage_horaire' })], amplitude: null };
    expect(resumeCouchers(exclues, 'UTC').texte).toBe('pas encore assez de mesures · 2 nuits exclues');
  });

  it('par nuit : endormi plus tard ou plus tôt que prévu, en mots', () => {
    expect(detailCoucher(nuit({}), 'UTC')).toBe('3 h 12 plus tard que prévu (22:00)');
    expect(detailCoucher(nuit({ mesure: '2026-11-01T21:40:00Z', ecart_min: -20 }), 'UTC')).toBe('20 min plus tôt que prévu (22:00)');
    expect(detailCoucher(nuit({ mesure: '2026-11-01T22:03:00Z', ecart_min: 3 }), 'UTC')).toBe('comme prévu');
    expect(detailCoucher(nuit({ mesure: null, ecart_min: null }), 'UTC')).toBe('prévu 22:00, pas de mesure');
    expect(detailCoucher(nuit({ ignore: 'decalage_horaire' }), 'UTC')).toBe('décalage horaire, non compté');
  });

  it('mode simulé : onglet Couchers d’abord, 7 nuits ; Levers sur un clic', async () => {
    const s = await statut();
    const { container } = render(<CarteRegularite statut={s} />);
    expect(screen.getByText('Régularité')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Couchers' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Endormissements sur 7 nuits :', { exact: false })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    const texte = container.textContent ?? '';
    // Dimanche : 21:30 prévu, endormi 00:55 ; écart compté depuis midi (2 h 15, pas 21 h 45).
    expect(texte).toContain('de 22:40 à 00:55 · écart 2 h 15 (repère 2 h)');
    expect(texte).toContain('3 h 25 plus tard que prévu (21:30)');
    expect(texte.match(/repère/g)).toHaveLength(1);
    expect(texte).not.toMatch(/limite|null|undefined/);
    // Radix active un onglet au clic principal (mousedown).
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Levers' }), { button: 0 });
    expect(screen.getByText('Levers sur 7 jours :', { exact: false })).toBeTruthy();
    expect(screen.getByText("aujourd'hui")).toBeTruthy();
  });

  it('API sans journal des couchers : les levers seuls, sans onglets', async () => {
    const s = await statut();
    render(<CarteRegularite statut={{ ...s, couchers: undefined }} />);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByText('Levers sur 7 jours :', { exact: false })).toBeTruthy();
  });
});

describe('carte « Régularité » : levers', () => {
  it('résumé : plage, écart et limite ; au-dessus de la limite ; sans assez de mesures', () => {
    const levers: RegulariteLevers = {
      jours: [],
      amplitude: { plus_tot: '2026-11-02T04:32:00Z', plus_tard: '2026-11-04T06:10:00Z', ecart_min: 98, mesures: 3 },
      limite_min: 120,
    };
    expect(resumeLevers(levers, 'UTC').texte).toBe('de 04:32 à 06:10 · écart 1 h 38 (limite 2 h)');
    const trop = { ...levers, amplitude: { ...levers.amplitude!, plus_tard: '2026-11-04T06:52:00Z', ecart_min: 140 } };
    expect(resumeLevers(trop, 'UTC')).toMatchObject({ texte: 'de 04:32 à 06:52 · écart 2 h 20, au-dessus de la limite de 2 h', classe: 'text-avertissement' });
    expect(resumeLevers({ ...levers, amplitude: null }, 'UTC').texte).toBe('pas encore assez de mesures');
  });

  it('par jour : en mots, sans signe ni heure répétée', () => {
    expect(detailLever(jour({}), 'UTC', false)).toBe('comme prévu');
    expect(detailLever(jour({ mesure: '2026-11-02T04:50:00Z', ecart_min: 20 }), 'UTC', false)).toBe('20 min plus tard que prévu (04:30)');
    expect(detailLever(jour({ mesure: '2026-11-02T03:22:00Z', ecart_min: -68 }), 'UTC', false)).toBe('1 h 08 plus tôt que prévu (04:30)');
    expect(detailLever(jour({ mesure: null, ecart_min: null }), 'UTC', false)).toBe('prévu 04:30, pas de mesure');
    expect(detailLever(jour({ mesure: null, ecart_min: null }), 'UTC', true)).toBe('prévu 04:30, pas encore mesuré');
  });

  it('décalage horaire : la ligne le dit, le résumé compte les jours exclus', () => {
    const ignore = 'decalage_horaire' as const;
    expect(detailLever(jour({ mesure: '2026-11-02T09:00:00Z', ecart_min: 270, ignore }), 'UTC', false)).toBe('décalage horaire, non compté');
    const levers: RegulariteLevers = {
      jours: [jour({ ignore }), jour({ date: '2026-11-03', ignore }), jour({ date: '2026-11-04' }), jour({ date: '2026-11-05', mesure: null, ecart_min: null })],
      amplitude: null,
      limite_min: 120,
    };
    expect(resumeLevers(levers, 'UTC').texte).toBe('pas encore assez de mesures · 2 jours exclus');
    const un = { ...levers, jours: levers.jours.slice(1), amplitude: { plus_tot: '2026-11-04T04:32:00Z', plus_tard: '2026-11-05T05:02:00Z', ecart_min: 30, mesures: 2 } };
    expect(resumeLevers(un, 'UTC').morceaux).toEqual(['de 04:32 à 05:02', 'écart 30 min (limite 2 h)', '1 jour exclu']);
  });

  it('mode simulé : une ligne de résumé et les 7 jours', async () => {
    const s = await statut();
    const { container } = render(<CarteRegularite statut={{ ...s, couchers: undefined }} />);
    expect(screen.getByText('Levers sur 7 jours :', { exact: false })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByText("aujourd'hui")).toBeTruthy();
    const texte = container.textContent ?? '';
    expect(texte).toMatch(/de \d\d:\d\d à \d\d:\d\d · écart \d+ h( \d\d)? \(limite 2 h\)/);
    // La limite n'est dite qu'une fois.
    expect(texte.match(/limite/g)).toHaveLength(1);
    expect(texte).not.toMatch(/[+−]\d|amplitude|null|undefined/);
  });

  it('API plus ancienne, sans aucun journal : rien', async () => {
    const s = await statut();
    const { container } = render(<CarteRegularite statut={{ ...s, levers: undefined, couchers: undefined }} />);
    expect(container.textContent).toBe('');
  });
});
