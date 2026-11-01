import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { creerApiSimulee } from '@/api/simule';
import type { ReponseStatut } from '@/api/contrat';
import { CarteSommeil, detailNuit, ecartEnMots, ecartNuitEnMots, rattrapee } from '@/composants/statut/CarteSommeil';

const MARDI_15H = Date.parse('2026-11-03T14:00:00Z');
const statut = () => creerApiSimulee({ maintenant: () => MARDI_15H, fuseau: 'Europe/Paris', phase: 'journee' }).statut();

describe('carte « Sommeil »', () => {
  it('écart à l’objectif en mots, sans signe', () => {
    expect(ecartEnMots(-29).texte).toBe("29 min de moins que l'objectif");
    expect(ecartEnMots(15).texte).toBe("15 min de plus que l'objectif");
    expect(ecartEnMots(-3).texte).toBe('objectif atteint');
    expect(ecartEnMots(-107, ' au total').texte).toBe('1 h 47 de moins au total');
  });

  it('mode simulé : temps dormi cette nuit, écart, phases, semaine, 7 dernières nuits, semaines passées', async () => {
    const s = await statut();
    const { container } = render(<CarteSommeil statut={s} />);
    expect(screen.getByText('Sommeil')).toBeTruthy();
    expect(screen.getByText('objectif 8 h')).toBeTruthy();
    expect(screen.getByText('Cette nuit')).toBeTruthy();
    // Dernière nuit fictive : 262 + 92 + 104 = 458 min dormies.
    expect(screen.getByText('7 h 38')).toBeTruthy();
    // Sieste fictive d'aujourd'hui (45 min, finie à 13:50) : couvre l'écart de la nuit.
    expect(screen.getByText("22 min de moins que l'objectif, rattrapées en sieste")).toBeTruthy();
    expect(screen.getByText('Profond')).toBeTruthy();
    expect(screen.getByText('1 h 32')).toBeTruthy();
    // Semaine du lundi 02/11 : la nuit de lundi (22 min manquées), la sieste de mardi (45 min).
    expect(screen.getByText('Cette semaine')).toBeTruthy();
    expect(screen.getByText('Cette semaine : 22 min manquées, 45 min rattrapées (nuits plus longues et siestes), tout rattrapé.')).toBeTruthy();
    expect(screen.getByText('tout rattrapé', { selector: 'section[aria-label="Cette semaine"] span' })).toBeTruthy();
    expect(screen.getByText('7 dernières nuits')).toBeTruthy();
    expect(screen.getByText('6/7 mesurées')).toBeTruthy();
    expect(screen.queryByText(/incompl/)).toBeNull();
    expect(screen.getByText(/pas de mesure$/, { selector: 'li' })).toBeTruthy();
    // Semaines closes, la plus récente d'abord.
    const passees = screen.getByLabelText('Semaines passées');
    // Pour les lecteurs d'écran, une phrase par semaine ; à l'écran, un petit tableau.
    const phrases = [...passees.querySelectorAll('li > .sr-only')].map((l) => l.textContent);
    expect(phrases).toEqual([
      'Semaine du 26 oct. : 6 h 05 de dette, 5 h 05 non rattrapées (6/7 nuits mesurées).',
      'Semaine du 19 oct. : 3 h 50 de dette, 2 h 55 non rattrapées (6/7 nuits mesurées).',
      'Semaine du 12 oct. : 3 h 40 de dette, 2 h non rattrapées.',
      'Semaine du 5 oct. : 1 h 30 de dette, tout rattrapé.',
    ]);
    const cases = [...passees.querySelectorAll('li:not(:first-child)')].map((l) => [...l.children].slice(1).map((c) => c.textContent?.trim()));
    expect(cases).toEqual([
      ['Sem. du 26 oct.', '6 h 05', '5 h 05', '6/7'],
      ['Sem. du 19 oct.', '3 h 50', '2 h 55', '6/7'],
      ['Sem. du 12 oct.', '3 h 40', '2 h', ''],
      ['Sem. du 5 oct.', '1 h 30', 'tout rattrapé', ''],
    ]);
    expect(passees.textContent).toContain('non rattrapé');
    const texte = container.textContent ?? '';
    expect(texte).not.toMatch(/prévu|rembours|[+−]\d/i);
  });

  it('semaine en cours : manquées moins rattrapées = à rattraper ; n/total mesurées', async () => {
    const s = await statut();
    const semaine = { debut: '2026-11-02', fin: '2026-11-08', dette_min: 313, rattrape_min: 120, reste_min: 193, nuits_restantes: 3, nuits_mesurees: 3, nuits_total: 4 };
    const { container } = render(<CarteSommeil statut={{ ...s, dette_semaine: semaine }} />);
    const section = screen.getByLabelText('Cette semaine');
    expect(section.textContent).toContain('3/4 mesurées');
    expect(section.textContent).toContain('5 h 13 manquées');
    expect(section.textContent).toContain('moins');
    expect(section.textContent).toContain('2 h rattrapées');
    expect(section.textContent).toContain('3 h 13 à rattraper');
    expect(container.textContent).not.toMatch(/[+−]\d/);
  });

  it('semaine sans rattrapage : « à rattraper » seul ; sans dette : « objectif atteint » ; sans mesure : rien', async () => {
    const s = await statut();
    const base = { debut: '2026-11-02', fin: '2026-11-08', nuits_restantes: 5, nuits_mesurees: 2, nuits_total: 2 };
    const r = render(<CarteSommeil statut={{ ...s, dette_semaine: { ...base, dette_min: 65, rattrape_min: 0, reste_min: 65 } }} />);
    const section = () => screen.queryByLabelText('Cette semaine');
    expect(section()!.textContent).toBe('Cette semaineCette semaine : 1 h 05 manquée, 1 h 05 à rattraper.1 h 05à rattraper');
    r.unmount();
    const r2 = render(<CarteSommeil statut={{ ...s, dette_semaine: { ...base, dette_min: 0, rattrape_min: 30, reste_min: 0 } }} />);
    expect(section()!.textContent).toContain('objectif atteint');
    expect(section()!.textContent).not.toContain('moins');
    r2.unmount();
    render(<CarteSommeil statut={{ ...s, dette_semaine: { ...base, dette_min: 0, rattrape_min: 0, reste_min: 0, nuits_mesurees: 0 } }} />);
    expect(section()).toBeNull();
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

  it('écart de la nuit avec la sieste du lendemain : « dont », plafonné à l’écart', () => {
    expect(ecartNuitEnMots(-29, 20).texte).toBe("29 min de moins que l'objectif, dont 20 min rattrapées en sieste");
    expect(ecartNuitEnMots(-29, 29).texte).toBe("29 min de moins que l'objectif, rattrapées en sieste");
    expect(ecartNuitEnMots(-29, 65).texte).toBe("29 min de moins que l'objectif, rattrapées en sieste");
    expect(ecartNuitEnMots(-29, 0).texte).toBe("29 min de moins que l'objectif");
    expect(ecartNuitEnMots(15, 40).texte).toBe("15 min de plus que l'objectif");
    expect(ecartNuitEnMots(-125, 60).texte).toBe("2 h 05 de moins que l'objectif, dont 1 h rattrapée en sieste");
    expect([rattrapee(1), rattrapee(29), rattrapee(65), rattrapee(130)]).toEqual(['rattrapée', 'rattrapées', 'rattrapée', 'rattrapées']);
  });

  it('dernière nuit plus ancienne : la sieste de la journée suivante compte sous son chiffre', async () => {
    const s = await statut();
    // Avant-dernière nuit : 420 min (−60) ; la journée suivante est celle de la dernière nuit.
    const nuits = s.nuits!.map((n, i, t) =>
      i === t.length - 1 ? { ...n, endormi_min: null, phases: null, siestes_min: 25, siestes: [] } : { ...n, siestes_min: 0, siestes: [] },
    );
    render(<CarteSommeil statut={{ ...s, nuits, siestes_total_min: 25 }} />);
    expect(screen.getByText("1 h de moins que l'objectif, dont 25 min rattrapées en sieste")).toBeTruthy();
  });

  it('siestes : à part des nuits dans le texte et l’infobulle', async () => {
    expect(detailNuit(432, 65)).toBe('7 h 12 de nuit + 1 h 05 de sieste');
    expect(detailNuit(432, 0)).toBe('7 h 12 dormies');
    expect(detailNuit(null, 40)).toBe('nuit non mesurée + 40 min de sieste');
    const s = await statut();
    render(<CarteSommeil statut={s} />);
    expect(screen.getByText('sieste')).toBeTruthy();
    expect(screen.getByText(/de nuit \+ 1 h de sieste$/, { selector: 'li' })).toBeTruthy();
    // « Cette nuit » reste la nuit seule.
    expect(screen.getByText('7 h 38')).toBeTruthy();
    expect(screen.getByText("22 min de moins que l'objectif, rattrapées en sieste")).toBeTruthy();
    // Avant la fin de la sieste du jour : la nuit seule, sans « rattrapées ».
    const matin = await creerApiSimulee({ maintenant: () => Date.parse('2026-11-03T09:00:00Z'), fuseau: 'Europe/Paris' }).statut();
    expect(matin.siestes_du_jour).toEqual([]);
    expect(matin.siestes_total_min).toBe(60);
    expect(screen.queryByText(/Sieste tardive/)).toBeNull();
  });

  it('sans sieste : ni « dont … », ni légende « sieste »', async () => {
    const s = await statut();
    const nuits = s.nuits!.map((n) => ({ ...n, siestes_min: 0, siestes: [] }));
    render(<CarteSommeil statut={{ ...s, nuits, siestes_total_min: 0, siestes_du_jour: [], siestes_du_jour_min: 0 }} />);
    expect(screen.queryByText(/dont/)).toBeNull();
    expect(screen.queryByText('sieste')).toBeNull();
  });

  it('sieste du jour : sous « Cette nuit » ; sieste tardive', async () => {
    const s = await statut();
    const sieste = { debut: '2026-11-03T13:00:00Z', fin: '2026-11-03T14:05:00Z', minutes: 65 };
    render(
      <CarteSommeil
        statut={{
          ...s,
          siestes_du_jour: [sieste],
          siestes_du_jour_min: 65,
          siestes_total_min: 125,
          sieste_tardive: { fin: sieste.fin, coucher: '2026-11-03T17:30:00Z' },
        }}
      />,
    );
    // Cette nuit : 22 min de moins, la sieste d'aujourd'hui (1 h 05) couvre tout l'écart ; le chiffre reste la nuit seule.
    expect(screen.getByText('7 h 38')).toBeTruthy();
    expect(screen.getByText("22 min de moins que l'objectif, rattrapées en sieste")).toBeTruthy();
    expect(screen.queryByText(/aujourd'hui/)).toBeNull();
    expect(screen.getByText(/Sieste tardive : vous endormir à 18:30 pourrait être plus difficile\./)).toBeTruthy();
  });

  it('graphique : la sieste est un segment vert empilé sur la nuit d’avant', async () => {
    // jsdom ne mesure rien : on donne une taille au conteneur du graphique.
    const espion = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 128, width: 600, height: 128, toJSON: () => ({}) });
    const s = await statut();
    // Sans la sieste d'aujourd'hui : il ne reste qu'une sieste passée.
    const { container } = render(<CarteSommeil statut={{ ...s, siestes_du_jour: [], siestes_du_jour_min: 0 }} />);
    await new Promise((r) => setTimeout(r, 0));
    const rect = (e: Element) => ({ x: Number(e.getAttribute('x')), y: Number(e.getAttribute('y')), h: Number(e.getAttribute('height')) });
    const nuits = [...container.querySelectorAll('.recharts-bar-rectangle path[fill="var(--sommeil-nuit)"]')].map(rect);
    const siestes = [...container.querySelectorAll('.recharts-bar-rectangle path[fill="var(--sommeil-sieste)"]')].map(rect);
    espion.mockRestore();
    expect(nuits).toHaveLength(6);
    expect(siestes).toHaveLength(1);
    // Posée sur le sommet d'une barre de nuit (la nuit d'avant la sieste).
    const nuit = nuits.find((n) => Math.abs(n.x - siestes[0]!.x) < 0.5)!;
    expect(nuit).toBeTruthy();
    expect(siestes[0]!.y + siestes[0]!.h).toBeCloseTo(nuit.y, 0);
  });
});
