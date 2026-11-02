import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { creerApiSimulee } from '@/api/simule';
import type { CoucherDeLaNuit, LeverDuJour, RegulariteCouchers, RegulariteLevers } from '@/api/contrat';
import {
  axeDesHeures,
  bandeDeRegularite,
  CarteRegularite,
  colonnesCouchers,
  colonnesLevers,
  detailCoucher,
  detailLever,
  resumeCouchers,
  resumeLevers,
} from '@/composants/statut/CarteRegularite';

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

/** Texte visible de la carte (sans les parties réservées aux lecteurs d'écran). */
function texteVisible(racine: HTMLElement): string {
  const copie = racine.cloneNode(true) as HTMLElement;
  for (const el of copie.querySelectorAll('.sr-only')) el.remove();
  return copie.textContent ?? '';
}

describe('carte « Régularité » : résumé chiffré', () => {
  it('couchers : l’écart mis en avant, orange au-dessus du repère, vert dessous', () => {
    const couchers: RegulariteCouchers = {
      nuits: [],
      amplitude: { plus_tot: '2026-11-03T22:10:00Z', plus_tard: '2026-11-02T01:12:00Z', ecart_min: 182, mesures: 4 },
      limite_min: 120,
    };
    expect(resumeCouchers(couchers, 'UTC')).toEqual({
      ecart: '3 h 02',
      legende: "d'écart sur 4 nuits · repère 2 h",
      classe: 'text-avertissement',
      phrase: 'Écart de 3 h 02 sur 4 nuits, de 22:10 à 01:12, au-dessus du repère de 2 h.',
    });
    const sous = { ...couchers, amplitude: { ...couchers.amplitude!, plus_tard: '2026-11-02T23:10:00Z', ecart_min: 60 } };
    expect(resumeCouchers(sous, 'UTC')).toMatchObject({ ecart: '1 h', classe: 'text-succes', phrase: 'Écart de 1 h sur 4 nuits, de 22:10 à 23:10, repère 2 h.' });
  });

  it('pas assez de mesures : une phrase courte, « Voyage : N nuits non comptées » s’il y a des exclusions', () => {
    const ignore = 'decalage_horaire' as const;
    const exclues: RegulariteCouchers = { nuits: [nuit({ ignore }), nuit({ nuit: '2026-11-02', ignore }), nuit({ nuit: '2026-11-03', mesure: null, ecart_min: null })], amplitude: null, limite_min: 120 };
    expect(resumeCouchers(exclues, 'UTC')).toMatchObject({ ecart: null, legende: 'Pas encore assez de mesures', classe: 'text-muted-foreground' });
    expect(resumeCouchers({ ...exclues, nuits: [] }, 'UTC').legende).toBe('Pas encore assez de mesures');
    const levers: RegulariteLevers = { jours: [jour({ ignore })], amplitude: null, limite_min: 120 };
    expect(resumeLevers(levers, 'UTC').legende).toBe('Pas encore assez de mesures');
  });

  it('levers : « limite », et les jours exclus en fin de légende', () => {
    const levers: RegulariteLevers = {
      jours: [jour({ date: '2026-11-01', ignore: 'decalage_horaire' })],
      amplitude: { plus_tot: '2026-11-02T04:32:00Z', plus_tard: '2026-11-04T06:52:00Z', ecart_min: 140, mesures: 3 },
      limite_min: 120,
    };
    expect(resumeLevers(levers, 'UTC')).toMatchObject({
      ecart: '2 h 20',
      legende: "d'écart sur 3 jours · limite 2 h",
      classe: 'text-avertissement',
      phrase: 'Écart de 2 h 20 sur 3 jours, de 04:32 à 06:52, au-dessus de la limite de 2 h.',
    });
  });
});

describe('carte « Régularité » : colonnes du graphique', () => {
  it('couchers : minutes depuis midi (00:55 après 22:40, pas avant), bande de 2 h centrée sur le milieu des mesures comptées', () => {
    const couchers: RegulariteCouchers = {
      nuits: [
        nuit({ nuit: '2026-10-30', prevu: '2026-10-30T22:00:00Z', mesure: '2026-10-30T22:40:00Z', ecart_min: 40 }),
        nuit({ nuit: '2026-10-31', prevu: '2026-10-31T22:00:00Z', mesure: '2026-11-01T00:55:00Z', ecart_min: 175 }),
        nuit({ nuit: '2026-11-01', prevu: '2026-11-01T22:00:00Z', mesure: null, ecart_min: null }),
      ],
      amplitude: { plus_tot: '2026-10-30T22:40:00Z', plus_tard: '2026-11-01T00:55:00Z', ecart_min: 135, mesures: 2 },
      limite_min: 120,
    };
    const { colonnes, bande } = colonnesCouchers(couchers, 'UTC');
    expect(colonnes.map((c) => [c.jour, c.prevuY, c.mesureY])).toEqual([
      ['ven. 30', 600, 640],
      ['sam. 31', 600, 775],
      ['dim. 1', 600, null],
    ]);
    expect(colonnes[2]!.titre).toBe('nuit du dim. 1er au lun. 2 nov.');
    // Milieu de 640 et 775 = 707,5 : bande de 647,5 à 767,5. Écart 2 h 15 > 2 h : les deux extrêmes en sortent.
    expect(bande).toEqual({ bas: 647.5, haut: 767.5 });
    expect(colonnes.map((c) => c.horsBande)).toEqual([true, true, false]);
    // Axe arrondi à l'heure, graduations horaires : 22:00 à 01:00.
    expect(axeDesHeures(colonnes, bande)).toEqual({ domaine: [540, 840], graduations: [540, 600, 660, 720, 780, 840] });
  });

  it('écart sous le repère : toutes les mesures comptées tiennent dans la bande', () => {
    const couchers: RegulariteCouchers = {
      nuits: [
        nuit({ nuit: '2026-10-30', mesure: '2026-10-30T22:40:00Z', ecart_min: 40 }),
        nuit({ nuit: '2026-10-31', mesure: '2026-10-31T23:30:00Z', ecart_min: 90 }),
      ],
      amplitude: { plus_tot: '2026-10-30T22:40:00Z', plus_tard: '2026-10-31T23:30:00Z', ecart_min: 50, mesures: 2 },
      limite_min: 120,
    };
    const { colonnes } = colonnesCouchers(couchers, 'UTC');
    expect(colonnes.every((c) => !c.horsBande)).toBe(true);
  });

  it('nuits exclues (décalage horaire) : hors de la bande, jamais orange ; sans assez de mesures comptées, pas de bande', () => {
    const ignore = 'decalage_horaire' as const;
    const nuits = [nuit({ nuit: '2026-10-30', mesure: '2026-10-31T03:00:00Z', ignore }), nuit({ nuit: '2026-10-31', mesure: '2026-10-31T22:30:00Z', ecart_min: 30 })];
    const { colonnes, bande } = colonnesCouchers({ nuits, amplitude: null, limite_min: 120 }, 'UTC');
    expect(bande).toBeNull();
    expect(colonnes.map((c) => [c.ignoree, c.horsBande])).toEqual([[true, false], [false, false]]);
    expect(bandeDeRegularite(colonnes, 120)).toBeNull();
  });

  it('levers : minutes depuis minuit, « auj. » pour le jour en cours, pas encore mesuré', () => {
    const levers: RegulariteLevers = {
      jours: [jour({ date: '2026-11-01', prevu: '2026-11-01T05:30:00Z', mesure: '2026-11-01T05:50:00Z', ecart_min: 20 }), jour({ prevu: '2026-11-02T05:30:00Z', mesure: null, ecart_min: null })],
      amplitude: null,
      limite_min: 120,
    };
    const { colonnes } = colonnesLevers(levers, 'UTC', '2026-11-02');
    expect(colonnes.map((c) => [c.jour, c.prevuY, c.mesureY, c.attendu])).toEqual([
      ['dim. 1', 330, 350, false],
      ['auj.', 330, null, true],
    ]);
    expect(colonnes[1]!.detail).toBe('prévu 05:30, pas encore mesuré');
  });
});

describe('carte « Régularité » : détails (infobulle et lecteurs d’écran)', () => {
  it('par nuit : plus tard ou plus tôt que prévu, en mots', () => {
    expect(detailCoucher(nuit({}), 'UTC')).toBe('3 h 12 plus tard que prévu (22:00)');
    expect(detailCoucher(nuit({ mesure: '2026-11-01T21:40:00Z', ecart_min: -20 }), 'UTC')).toBe('20 min plus tôt que prévu (22:00)');
    expect(detailCoucher(nuit({ mesure: '2026-11-01T22:03:00Z', ecart_min: 3 }), 'UTC')).toBe('comme prévu');
    expect(detailCoucher(nuit({ mesure: null, ecart_min: null }), 'UTC')).toBe('prévu 22:00, pas de mesure');
    expect(detailCoucher(nuit({ ignore: 'decalage_horaire' }), 'UTC')).toBe('décalage horaire, non compté');
    expect(detailLever(jour({ mesure: '2026-11-02T03:22:00Z', ecart_min: -68 }), 'UTC', false)).toBe('1 h 08 plus tôt que prévu (04:30)');
    expect(detailLever(jour({ mesure: null, ecart_min: null }), 'UTC', true)).toBe('prévu 04:30, pas encore mesuré');
  });
});

describe('carte « Régularité » : rendu', () => {
  it('mode simulé : onglet Couchers d’abord, résumé chiffré une fois, plus aucune liste de phrases visible', async () => {
    const s = await statut();
    const { container } = render(<CarteRegularite statut={s} />);
    expect(screen.getByText('Régularité')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Couchers' }).getAttribute('aria-selected')).toBe('true');
    const visible = texteVisible(container);
    expect(visible).toMatch(/^\s*Régularité.*\d+ h( \d\d)?d'écart sur \d nuits · repère 2 h/);
    expect(visible.match(/repère/g)).toHaveLength(1);
    expect(visible).not.toMatch(/plus tard que prévu|pas de mesure|heure de|null|undefined/);
    // Lecteurs d'écran : la phrase du résumé et une ligne par nuit.
    expect(screen.getByRole('list', { name: 'Endormissement de chaque nuit' }).querySelectorAll('li')).toHaveLength(7);
    expect(container.querySelector('.sr-only')?.textContent).toMatch(/^Écart de .* sur \d nuits, de \d\d:\d\d à \d\d:\d\d/);
    // Radix active un onglet au clic principal (mousedown).
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Levers' }), { button: 0 });
    expect(screen.getByRole('list', { name: 'Lever de chaque jour' }).querySelectorAll('li')).toHaveLength(7);
    expect(texteVisible(container)).toMatch(/d'écart sur \d jours · limite 2 h/);
  });

  it('API sans journal des couchers : les levers seuls, sans onglets ; sans aucun journal : rien', async () => {
    const s = await statut();
    const { container, unmount } = render(<CarteRegularite statut={{ ...s, couchers: undefined }} />);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(texteVisible(container)).toContain('limite 2 h');
    unmount();
    const vide = render(<CarteRegularite statut={{ ...s, levers: undefined, couchers: undefined }} />);
    expect(vide.container.textContent).toBe('');
  });

  it('voyage : une seule phrase courte, le lieu dit une fois dans la légende, chaque heure dans le fuseau du lieu', async () => {
    const s = await statut();
    const PARIS = 'Europe/Paris';
    const CAYENNE = 'America/Cayenne';
    const ignore = 'decalage_horaire' as const;
    // Nuits à Paris (endormi 23:14 heure de Paris = 22:14Z), non comptées au retour à Cayenne.
    const nuits = ['2026-10-26', '2026-10-27', '2026-10-28'].map((n) =>
      nuit({ nuit: n, fuseau: PARIS, prevu: `${n}T21:30:00Z`, mesure: `${n}T22:14:00Z`, ecart_min: 44, ignore }),
    );
    const aCayenne = nuit({ nuit: '2026-11-01', fuseau: CAYENNE, prevu: '2026-11-02T01:30:00Z', mesure: '2026-11-02T01:40:00Z', ecart_min: 10 });
    const journee = { ...s.journee, fuseau: CAYENNE };
    const { container } = render(
      <CarteRegularite statut={{ ...s, journee, levers: undefined, couchers: { nuits: [...nuits, aCayenne], amplitude: null, limite_min: 120 } }} />,
    );
    const visible = texteVisible(container);
    expect(visible).toContain('Pas encore assez de mesures');
    expect(visible).not.toMatch(/voyage/i);
    expect(visible).not.toContain('décalage horaire');
    // Plus aucune mention du voyage ni du lieu à l'écran (02/11) : seulement dans l'infobulle et le texte lu.
    expect(visible).not.toMatch(/Paris/);
    const lignes = [...screen.getByRole('list', { name: 'Endormissement de chaque nuit' }).querySelectorAll('li')].map((l) => l.textContent);
    expect(lignes[0]).toContain('endormi à 23:14 (heure de Paris)');
    expect(lignes[0]).not.toContain('19:14');
    expect(lignes[3]).toContain('endormi à 22:40, 10 min plus tard que prévu (22:30)');
    // Colonnes : heures lues dans le fuseau du lieu (23:14 à Paris = 674 min depuis midi).
    const { colonnes } = colonnesCouchers({ nuits: [...nuits, aCayenne], amplitude: null, limite_min: 120 }, CAYENNE);
    expect(colonnes.map((c) => c.mesureY)).toEqual([674, 674, 674, 640]);
  });
});
