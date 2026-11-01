import { describe, expect, it } from 'vitest';
import { lireConfig } from '../src/config';
import {
  juger,
  planningRestant,
  prioritairesRestantes,
  recapRestant,
  retardsRestants,
  tachesFiltrees,
} from '../src/conditions';
import { journee } from '../src/journee';
import type { Condition } from '../src/types';
import { configExemple as config, contexte, EXEMPLE, faits, remplacer, tache } from './aides';

const D = '2026-11-02';
const ids = (taches: { id: string }[]) => taches.map((t) => t.id);

describe('planning_fait', () => {
  it('tâche « planning » non terminée échue au plus tard aujourd\'hui', () => {
    const duJour = tache({ etiquettes: ['planning'], echeance: D });
    const hier = tache({ etiquettes: ['planning'], echeance: '2026-11-01' });
    const demain = tache({ etiquettes: ['planning'], echeance: '2026-11-03' });
    const faite = tache({ etiquettes: ['planning'], echeance: D, terminee: true });
    const autre = tache({ etiquettes: ['maison'], echeance: D });
    const restant = planningRestant(config, faits({ taches: [duJour, hier, demain, faite, autre] }), D);
    expect(ids(restant)).toEqual([duJour.id, hier.id]);
    expect(planningRestant(config, faits({ taches: [demain, faite, autre] }), D)).toEqual([]);
  });
});

describe('recap_fait (tolérance 1 jour)', () => {
  it('le récap d\'hier peut attendre un jour, pas davantage', () => {
    const duJour = tache({ etiquettes: ['recap'], echeance: D });
    const hier = tache({ etiquettes: ['recap'], echeance: '2026-11-01' });
    const avantHier = tache({ etiquettes: ['recap'], echeance: '2026-10-31' });
    expect(recapRestant(config, faits({ taches: [duJour] }), D)).toEqual([]);
    expect(ids(recapRestant(config, faits({ taches: [duJour, hier, avantHier] }), D))).toEqual([hier.id, avantHier.id]);
  });

  it('tolérance 0 : le récap du jour compte', () => {
    const sansTolerance = lireConfig(remplacer(EXEMPLE, 'recap_tolerance_jours: 1', 'recap_tolerance_jours: 0'));
    const duJour = tache({ etiquettes: ['recap'], echeance: D });
    expect(ids(recapRestant(sansTolerance, faits({ taches: [duJour] }), D))).toEqual([duJour.id]);
  });
});

describe('prioritaires_faites', () => {
  it('P1 et P2 du jour, hors exclusions et hors tâches non assignées', () => {
    const p1 = tache({ priorite: 'p1', echeance: D });
    const p2 = tache({ priorite: 'p2', echeance: D });
    const p3 = tache({ priorite: 'p3', echeance: D });
    const exclue = tache({ priorite: 'p1', echeance: D, etiquettes: ['planning'] });
    const nonAssignee = tache({ priorite: 'p1', echeance: D, assigneeAMoi: false });
    const enRetard = tache({ priorite: 'p1', echeance: '2026-11-01' });
    const faite = tache({ priorite: 'p1', echeance: D, terminee: true });
    const restant = prioritairesRestantes(config, faits({ taches: [p1, p2, p3, exclue, nonAssignee, enRetard, faite] }), D);
    expect(ids(restant)).toEqual([p1.id, p2.id]);
    expect(prioritairesRestantes(config, faits({ taches: [p3, exclue, nonAssignee, enRetard, faite] }), D)).toEqual([]);
  });
});

describe('aucun_retard (photo des retards)', () => {
  it('toutes les tâches de la photo du jour doivent être terminées', () => {
    const a = tache({ echeance: '2026-10-30', terminee: true });
    const b = tache({ echeance: '2026-10-31' });
    const photosRetards = { [D]: [a.id, b.id, 'disparue'] };
    expect(retardsRestants(faits({ taches: [a, b], photosRetards }), D)).toEqual([b.id]);
    expect(retardsRestants(faits({ taches: [a, { ...b, terminee: true }], photosRetards }), D)).toEqual([]);
    // Une tâche en retard apparue après la photo ne compte pas ; pas de photo = rien à solder.
    expect(retardsRestants(faits({ taches: [b], photosRetards: { [D]: [a.id] } }), D)).toEqual([]);
    expect(retardsRestants(faits({ taches: [b] }), D)).toEqual([]);
  });
});

describe('nombre_de_taches et combinaisons', () => {
  const p1Jour = tache({ priorite: 'p1', echeance: D, etiquettes: ['maths'] });
  const p3Retard = tache({ priorite: 'p3', echeance: '2026-10-30' });
  const p4Jour = tache({ priorite: 'p4', echeance: D });
  const lesFaits = faits({ taches: [p1Jour, p3Retard, p4Jour] });

  it('filtre jour, priorités, étiquettes', () => {
    expect(ids(tachesFiltrees(lesFaits, D, { jour: 'aujourd_hui' }))).toEqual([p1Jour.id, p4Jour.id]);
    expect(ids(tachesFiltrees(lesFaits, D, { jour: 'retard' }))).toEqual([p3Retard.id]);
    expect(ids(tachesFiltrees(lesFaits, D, { jour: 'les_deux', priorites: ['p1', 'p3'] }))).toEqual([p1Jour.id, p3Retard.id]);
    expect(ids(tachesFiltrees(lesFaits, D, { jour: 'les_deux', etiquettesIncluses: ['maths'] }))).toEqual([p1Jour.id]);
    expect(ids(tachesFiltrees(lesFaits, D, { jour: 'les_deux', etiquettesExclues: ['maths'] }))).toEqual([p3Retard.id, p4Jour.id]);
  });

  it('juger : nombre_de_taches, un_parmi, pas, heure avant', () => {
    const ctx = contexte('2026-11-02T12:00:00Z', { faits: lesFaits });
    const env = { config, faits: lesFaits, journee: journee(ctx, D), instant: Date.parse('2026-11-02T12:00:00Z'), parametres: {} };
    const auPlus = (n: number): Condition => ({ nombreDeTaches: { filtre: { jour: 'les_deux' }, auPlus: n } });
    expect(juger(auPlus(3), env).vrai).toBe(true);
    expect(juger(auPlus(2), env)).toEqual({ vrai: false, pourquoi: '3 tâche(s) pour 2 au plus' });
    expect(juger({ unParmi: [auPlus(0), 'toujours'] }, env).vrai).toBe(true);
    expect(juger({ pas: 'toujours' }, env).vrai).toBe(false);
    expect(juger({ heure: { avant: '14:00' } }, env)).toEqual({ vrai: true, pourquoi: 'jusqu\'à 14:00' });
    expect(juger({ heure: { avant: '13:00' } }, env)).toEqual({ vrai: false, pourquoi: 'après 13:00' });
    // "02:00" est la nuit qui suit le lever, pas la nuit d'avant.
    expect(juger({ heure: { apres: '02:00' } }, env)).toEqual({ vrai: false, pourquoi: 'avant 02:00' });
    expect(juger({ heure: { apres: '$lever + 30min' } }, env).vrai).toBe(true);
  });
});
