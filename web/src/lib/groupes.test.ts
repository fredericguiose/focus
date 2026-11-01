import { describe, expect, it } from 'vitest';

import type { AppBloquee } from '@/api/contrat';
import { etatCondition } from './etats';
import { basculerGroupe, etatGroupe, regrouperApps } from './groupes';

const app = (id: string): AppBloquee => ({ id, nom: id.toUpperCase(), domaines: [] });
const APPS = ['chatgpt', 'gemini', 'youtube', 'gmail'].map(app);
const GROUPES = [
  { id: 'ia', nom: 'IA conversationnelle', apps: ['chatgpt', 'gemini', 'claude_ai'] },
  { id: 'divertissement', nom: 'Divertissement', apps: ['youtube'] },
  { id: 'vide', nom: 'Vide', apps: ['safari'] },
];

describe('choix des apps par groupe', () => {
  it('groupes réduits aux apps bloquées ici ; les apps hors groupe restent seules', () => {
    const r = regrouperApps(APPS, GROUPES);
    expect(r.groupes.map((g) => [g.id, g.apps.map((a) => a.id)])).toEqual([
      ['ia', ['chatgpt', 'gemini']],
      ['divertissement', ['youtube']],
    ]);
    expect(r.seules.map((a) => a.id)).toEqual(['gmail']);
    // API plus ancienne, sans groupes : toutes les apps seules.
    expect(regrouperApps(APPS, undefined).seules).toHaveLength(4);
  });

  it('case « tout le groupe » : vide, partielle, pleine ; la cocher complète, la décocher retire', () => {
    const ia = regrouperApps(APPS, GROUPES).groupes[0]!;
    expect(etatGroupe(ia, [])).toBe(false);
    expect(etatGroupe(ia, ['gemini'])).toBe('indeterminate');
    expect(basculerGroupe(ia, ['gemini', 'gmail'])).toEqual(['gemini', 'gmail', 'chatgpt']);
    expect(etatGroupe(ia, ['chatgpt', 'gemini'])).toBe(true);
    expect(basculerGroupe(ia, ['chatgpt', 'gemini', 'gmail'])).toEqual(['gmail']);
  });
});

describe('règle de couleurs', () => {
  it('fait = vert, tâche pas faite = à faire, heure pas atteinte = attente', () => {
    expect(etatCondition({ type: 'planning', vraie: true })).toBe('fait');
    expect(etatCondition({ type: 'prioritaires', vraie: false })).toBe('a_faire');
    expect(etatCondition({ type: 'heure', vraie: false })).toBe('attente');
  });
});
