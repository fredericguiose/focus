import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { creerApiSimulee } from '@/api/simule';
import type { ReponseStatut } from '@/api/contrat';
import { alerteAgenda, colonnesDeLaSemaine, tendanceEnMots, CarteSommeil, detailNuit, ecartEnMots, ecartNuitEnMots, nuitEnMots, rattrapee } from '@/composants/statut/CarteSommeil';

const MARDI_15H = Date.parse('2026-11-03T14:00:00Z');
const statut = () => creerApiSimulee({ maintenant: () => MARDI_15H, fuseau: 'Europe/Paris', phase: 'journee' }).statut();

describe('carte « Sommeil »', () => {
  it('écart à l’objectif en mots, sans signe', () => {
    expect(ecartEnMots(-29).texte).toBe("29 min de moins que l'objectif");
    expect(ecartEnMots(15).texte).toBe("15 min de plus que l'objectif");
    expect(ecartEnMots(-3).texte).toBe('objectif atteint');
    expect(ecartEnMots(-107, ' au total').texte).toBe('1 h 47 de moins au total');
  });

  it('mode simulé : temps dormi cette nuit, écart, phases, semaine, graphique de la semaine, tendance', async () => {
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
    // Semaine du lundi 02/11 : nuits de dimanche à lundi (1 h) et de lundi à mardi (22 min), la sieste de mardi (45 min).
    expect(screen.getByText('Cette semaine')).toBeTruthy();
    expect(screen.getByText('Cette semaine : 1 h 22 manquée, 45 min rattrapées (nuits plus longues et siestes), 37 min à rattraper.')).toBeTruthy();
    // Graphique : la même semaine, lun. → dim. ; mardi, deux nuits finies (mesurées), cinq à venir.
    const graphique = screen.getByLabelText('Semaine du 2 nov.');
    expect(graphique.textContent).not.toMatch(/mesurées/);
    const lignes = [...graphique.querySelectorAll('li')].map((li) => li.textContent);
    expect(lignes).toEqual([
      'nuit du dim. 1er au lun. 2 nov. : 7 h dormies',
      'nuit du lun. 2 au mar. 3 nov. : 7 h 38 de nuit + 45 min de sieste',
      'nuit du mar. 3 au mer. 4 nov. : à venir',
      'nuit du mer. 4 au jeu. 5 nov. : à venir',
      'nuit du jeu. 5 au ven. 6 nov. : à venir',
      'nuit du ven. 6 au sam. 7 nov. : à venir',
      'nuit du sam. 7 au dim. 8 nov. : à venir',
    ]);
    // Nuits à venir : pas « pas de mesure ».
    expect(screen.queryByText('pas de barre : pas de mesure')).toBeNull();
    expect(screen.queryByText(/incompl/)).toBeNull();
    // Plus de tableau des semaines passées : une ligne de tendance face à la semaine dernière.
    expect(screen.queryByLabelText('Semaines passées')).toBeNull();
    expect(screen.getByText(/de manque en (plus|moins) par nuit que la semaine dernière|comme la semaine dernière/)).toBeTruthy();
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
    const { container } = render(<CarteSommeil statut={{ ...s, dette_semaine: { ...base, dette_min: 0, rattrape_min: 0, reste_min: 0, nuits_mesurees: 0 }, bilans_semaines: [] }} />);
    expect(section()).toBeNull();
    expect(container.textContent).not.toMatch(/Semaine du/);
  });

  describe('dimanche : la semaine en cours n’a encore aucune nuit, la semaine close la remplace', () => {
    // Dimanche 01/11 : la semaine du 02/11 commence avec la nuit de ce soir.
    const vide = { debut: '2026-11-02', fin: '2026-11-08', dette_min: 0, rattrape_min: 0, reste_min: 0, nuits_restantes: 7, nuits_mesurees: 0, nuits_total: 0 };
    const close = { debut: '2026-10-26', fin: '2026-11-01', dette_min: 313, rattrape_min: 120, non_rattrape_min: 193, nuits_mesurees: 6, nuits_total: 7 };
    const avant = { debut: '2026-10-19', fin: '2026-10-25', dette_min: 140, rattrape_min: 0, non_rattrape_min: 140, nuits_mesurees: 7, nuits_total: 7 };

    it('mêmes cases : manquées moins rattrapées = non rattrapées ; titre daté « close » ; n/total mesurées', async () => {
      const s = await statut();
      render(<CarteSommeil statut={{ ...s, dette_semaine: vide, bilans_semaines: [close, avant] }} />);
      expect(screen.queryByLabelText('Cette semaine')).toBeNull();
      const section = screen.getByLabelText('Semaine du 26 oct. · close');
      expect(section.textContent).toContain('Semaine du 26 oct. · close');
      expect(section.textContent).toContain('6/7 mesurées');
      expect(section.textContent).toContain('5 h 13 manquées');
      expect(section.textContent).toContain('2 h rattrapées');
      expect(section.textContent).toContain('3 h 13non rattrapées');
      expect(section.textContent).not.toContain('à rattraper');
      expect(screen.getByText('Semaine du 26 oct. · close : 5 h 13 manquées, 2 h rattrapées (nuits plus longues et siestes), 3 h 13 non rattrapées.')).toBeTruthy();
      // Tendance : la semaine close (193/6 ≈ 32 min par nuit) face à celle d'avant (20 min par nuit).
      expect(screen.getByText(/12 min de manque en plus par nuit que la semaine d'avant/)).toBeTruthy();
    });

    it('tout rattrapé ou objectif atteint, en vert ; sans semaine d’avant : pas de tendance', async () => {
      const s = await statut();
      const r = render(<CarteSommeil statut={{ ...s, dette_semaine: vide, bilans_semaines: [{ ...close, rattrape_min: 320, non_rattrape_min: 0 }] }} />);
      expect(screen.getByLabelText('Semaine du 26 oct. · close').textContent).toContain('tout rattrapé');
      expect(screen.queryByText(/par nuit que|comme la semaine/)).toBeNull();
      r.unmount();
      render(<CarteSommeil statut={{ ...s, dette_semaine: vide, bilans_semaines: [{ ...close, dette_min: 0, rattrape_min: 0, non_rattrape_min: 0, nuits_total: 6 }] }} />);
      const section = screen.getByLabelText('Semaine du 26 oct. · close');
      expect(section.textContent).toContain('objectif atteint');
      expect(section.textContent).not.toContain('mesurées');
    });

    it('dès qu’une nuit de la nouvelle semaine est mesurée : retour à « Cette semaine », comparée à la semaine close', async () => {
      const s = await statut();
      const lundi = { ...vide, dette_min: 30, reste_min: 30, nuits_restantes: 6, nuits_mesurees: 1, nuits_total: 1 };
      render(<CarteSommeil statut={{ ...s, dette_semaine: lundi, bilans_semaines: [close, avant] }} />);
      expect(screen.queryByLabelText(/· close/)).toBeNull();
      expect(screen.getByLabelText('Cette semaine').textContent).toContain('30 min à rattraper');
      expect(screen.getByText('comme la semaine dernière')).toBeTruthy();
    });

    it('semaine close sans aucune mesure : rien', async () => {
      const s = await statut();
      const { container } = render(<CarteSommeil statut={{ ...s, dette_semaine: vide, bilans_semaines: [{ ...close, nuits_mesurees: 0 }] }} />);
      expect(container.textContent).not.toMatch(/Semaine du|Cette semaine/);
    });
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

  it('Google Agenda en erreur : une ligne discrète ; synchro réussie ou absente : rien', async () => {
    const s = await statut();
    const { unmount } = render(<CarteSommeil statut={{ ...s, agenda: { derniere_synchro: null, erreur: 'jeton_google_revoque' } }} />);
    expect(screen.getByText(/connexion à Google Agenda a expiré/)).toBeTruthy();
    unmount();
    for (const agenda of [undefined, null, { derniere_synchro: '2026-11-03T13:55:00Z', erreur: null }]) {
      const r = render(<CarteSommeil statut={{ ...s, agenda }} />);
      expect(screen.queryByText(/Google Agenda/)).toBeNull();
      r.unmount();
    }
    expect(alerteAgenda('google_quota')).toBe("Google Agenda n'a pas répondu : le bloc « Dormir » n'est peut-être pas à jour.");
    expect(alerteAgenda('google_acces_refuse')).toMatch(/refuse l'accès/);
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
    // La sieste d'aujourd'hui (mardi) rattrape la nuit de lundi à mardi.
    expect(screen.getByText(/^nuit du lun\. 2 au mar\. 3 nov\. : 7 h 38 de nuit \+ 45 min de sieste$/, { selector: 'li' })).toBeTruthy();
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

  /** jsdom ne mesure rien : on donne une taille au conteneur du graphique, le temps du rendu. */
  async function rendreGraphique(s: ReponseStatut) {
    const espion = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 128, width: 600, height: 128, toJSON: () => ({}) });
    const { container } = render(<CarteSommeil statut={s} />);
    await new Promise((r) => setTimeout(r, 0));
    const rect = (e: Element) => ({ x: Number(e.getAttribute('x')), y: Number(e.getAttribute('y')), h: Number(e.getAttribute('height')) });
    const barres = (selecteur: string) => [...container.querySelectorAll(`.recharts-bar-rectangle path${selecteur}`)].map(rect).sort((p, q) => p.x - q.x);
    const res = {
      nuits: barres('[fill="var(--sommeil-nuit)"]'),
      siestes: barres('[fill="var(--sommeil-sieste)"]'),
      avenir: barres('[fill="transparent"]'),
      etiquettes: [...container.querySelectorAll('text')].filter((t) => /^\S+\.$/.test(t.textContent ?? '')).map((t) => [t.textContent, t.getAttribute('opacity')]),
    };
    espion.mockRestore();
    return res;
  }

  it('graphique : la sieste du lundi se pose sur la nuit de dimanche à lundi (colonne « lun. »)', async () => {
    const s = await statut();
    // Mardi 03/11, sans la sieste du jour : une sieste lundi 02/11 (journée de la nuit du 02/11).
    const avecSieste = <T extends { nuit: string }>(n: T) => (n.nuit === '2026-11-02' ? { ...n, siestes_min: 30 } : { ...n, siestes_min: 0, siestes: [] });
    const g = await rendreGraphique({ ...s, nuits: s.nuits!.map(avecSieste), nuits_semaine: s.nuits_semaine!.map(avecSieste), siestes_du_jour: [], siestes_du_jour_min: 0 });
    expect(g.nuits).toHaveLength(2);
    expect(g.siestes).toHaveLength(1);
    // Posée sur le sommet de la première barre : la nuit de dimanche à lundi.
    expect(Math.abs(g.siestes[0]!.x - g.nuits[0]!.x)).toBeLessThan(0.5);
    expect(g.siestes[0]!.y + g.siestes[0]!.h).toBeCloseTo(g.nuits[0]!.y, 0);
    expect(screen.getByText(/^nuit du dim\. 1er au lun\. 2 nov\. : 7 h de nuit \+ 30 min de sieste$/, { selector: 'li' })).toBeTruthy();
  });

  it('graphique : nuits à venir en pointillés, à la hauteur de l’objectif, étiquettes atténuées', async () => {
    const g = await rendreGraphique(await statut());
    expect(g.etiquettes.map(([t]) => t)).toEqual(['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']);
    expect(g.etiquettes.map(([, o]) => o)).toEqual(['1', '1', '0.45', '0.45', '0.45', '0.45', '0.45']);
    expect(g.avenir).toHaveLength(5);
    // Au-delà des deux nuits finies.
    for (const a of g.avenir) expect(a.x).toBeGreaterThan(g.nuits[1]!.x);
  });
});

describe('graphique de la semaine (lun. → dim., comme la dette hebdomadaire)', () => {
  it('nuit en mots : du soir au matin, mois une fois, « 1er »', () => {
    expect(nuitEnMots('2026-11-01')).toBe('nuit du dim. 1er au lun. 2 nov.');
    expect(nuitEnMots('2026-10-31')).toBe('nuit du sam. 31 oct. au dim. 1er nov.');
    expect(nuitEnMots('2026-11-07')).toBe('nuit du sam. 7 au dim. 8 nov.');
  });

  it('un mercredi : la semaine en cours, trois nuits finies, quatre à venir', async () => {
    const s = await creerApiSimulee({ maintenant: () => Date.parse('2026-11-04T14:00:00Z'), fuseau: 'Europe/Paris', phase: 'journee' }).statut();
    const cols = colonnesDeLaSemaine('2026-11-02', s.nuits_semaine!, '2026-11-04', 0);
    expect(cols.map((c) => [c.jour, c.nuit, c.avenir])).toEqual([
      ['lun.', '2026-11-01', false],
      ['mar.', '2026-11-02', false],
      ['mer.', '2026-11-03', false],
      ['jeu.', '2026-11-04', true],
      ['ven.', '2026-11-05', true],
      ['sam.', '2026-11-06', true],
      ['dim.', '2026-11-07', true],
    ]);
    render(<CarteSommeil statut={s} />);
    expect(screen.getByLabelText('Cette semaine')).toBeTruthy();
    expect(screen.getByLabelText('Semaine du 2 nov.').querySelectorAll('li')).toHaveLength(7);
  });

  it('le dimanche : la semaine qui vient de se clore, ses 7 nuits finies ; non mesurée : pas de barre', async () => {
    const s = await creerApiSimulee({ maintenant: () => Date.parse('2026-11-01T14:00:00Z'), fuseau: 'Europe/Paris', phase: 'journee' }).statut();
    render(<CarteSommeil statut={s} />);
    expect(screen.getByLabelText(/^Semaine du 26 oct\. · close$/)).toBeTruthy();
    const graphique = screen.getByLabelText('Semaine du 26 oct.');
    const lignes = [...graphique.querySelectorAll('li')].map((li) => li.textContent ?? '');
    expect(lignes[0]).toMatch(/^nuit du dim\. 25 au lun\. 26 oct\. : /);
    expect(lignes[6]).toMatch(/^nuit du sam\. 31 oct\. au dim\. 1er nov\. : /);
    expect(lignes.some((l) => l.endsWith('à venir'))).toBe(false);
    // La nuit fictive sans mesure (25/10, de dimanche à lundi) : « pas de mesure », et la légende le dit.
    expect(lignes[0]).toBe('nuit du dim. 25 au lun. 26 oct. : pas de mesure');
    expect(graphique.textContent).toContain('6/7 mesurées');
    expect(graphique.textContent).toContain('pas de barre : pas de mesure');
  });

  it('API sans `nuits_semaine` : les 7 dernières nuits remplissent les colonnes', async () => {
    const s = await statut();
    const { nuits_semaine: _, ...ancienne } = s;
    render(<CarteSommeil statut={ancienne} />);
    expect(screen.getByLabelText('Semaine du 2 nov.').querySelectorAll('li')[1]!.textContent).toBe('nuit du lun. 2 au mar. 3 nov. : 7 h 38 de nuit + 45 min de sieste');
  });
});

describe('tendance face à la semaine dernière', () => {
  const sem = (dette: number, rattrape: number, nuits: number) => ({ debut: '2026-11-02', fin: '2026-11-08', dette_min: dette, rattrape_min: rattrape, reste_min: Math.max(0, dette - rattrape), nuits_restantes: 3, nuits_mesurees: nuits, nuits_total: nuits });
  const bilan = (dette: number, rattrape: number, nuits: number) => ({ debut: '2026-10-26', fin: '2026-11-01', dette_min: dette, rattrape_min: rattrape, non_rattrape_min: Math.max(0, dette - rattrape), nuits_mesurees: nuits, nuits_total: 7 });
  it('compare par nuit mesurée, pas en total (une semaine incomplète ne paraît pas meilleure)', () => {
    // Cette semaine : 2 nuits, 60 min de manque net → 30/nuit ; la dernière : 7 nuits, 140 min → 20/nuit.
    expect(tendanceEnMots(sem(80, 20, 2), bilan(160, 20, 7))).toMatchObject({ texte: '10 min de manque en plus par nuit que la semaine dernière', sens: 1 });
    expect(tendanceEnMots(sem(20, 0, 2), bilan(210, 0, 7))).toMatchObject({ texte: '20 min de manque en moins par nuit que la semaine dernière', sens: -1 });
    expect(tendanceEnMots(sem(42, 0, 2), bilan(140, 0, 7))).toMatchObject({ texte: 'comme la semaine dernière', sens: 0 });
  });
  it('sans nuit mesurée d’un côté : pas de comparaison', () => {
    expect(tendanceEnMots(sem(80, 0, 2), bilan(0, 0, 0))).toBeNull();
  });
});
