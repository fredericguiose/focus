// Planning d'un appareil (docs/conception.md §3.6) : segments de mode constant, faits Todoist
// supposés inchangés. Entre deux points de rupture, aucune condition ne peut basculer.

import type { ActionsIphone, ActionsPc, Contexte, Journee, Segment } from './types';
import { instantsDeBascule } from './conditions';
import { etatA, modesCandidats, verifierAppareil } from './etat';
import { journee as journeeDu, journeeCourante } from './journee';
import { ajouterJours, ecrireInstant, lireInstant } from './temps';

const HEURE = 3_600_000;

function journeesCouvrant(contexte: Contexte, fin: number): Journee[] {
  const journees = [journeeCourante(contexte)];
  while (lireInstant(journees.at(-1)!.leverSuivant) < fin) {
    journees.push(journeeDu(contexte, ajouterJours(journees.at(-1)!.date, 1)));
  }
  return journees;
}

function pointsDeRupture(contexte: Contexte, journee: Journee, appareil: string): number[] {
  const points = [journee.lever, journee.leverSuivant, journee.coucherApplique, journee.ouverture].map(lireInstant);
  for (const c of modesCandidats(contexte.config, journee, appareil)) {
    const env = { config: contexte.config, faits: contexte.faits, journee, instant: 0, parametres: c.parametres };
    for (const condition of c.conditions) points.push(...instantsDeBascule(condition, env));
  }
  return points;
}

function memesActions(a: ActionsPc | ActionsIphone, b: ActionsPc | ActionsIphone): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function planifier(contexte: Contexte, appareil: string, horizonH = 36): Segment[] {
  verifierAppareil(contexte.config, appareil);
  if (!(horizonH > 0)) throw new Error(`horizon invalide : ${horizonH} h (attendu un nombre positif)`);
  const debut = lireInstant(contexte.maintenant);
  const fin = debut + horizonH * HEURE;
  const journees = journeesCouvrant(contexte, fin);

  const points = new Set([debut]);
  for (const j of journees) {
    for (const p of pointsDeRupture(contexte, j, appareil)) if (p > debut && p < fin) points.add(p);
  }
  const tries = [...points].sort((a, b) => a - b);

  const segments: Segment[] = [];
  tries.forEach((p, i) => {
    const finSegment = ecrireInstant(tries[i + 1] ?? fin);
    const journee = journees.find((j) => lireInstant(j.lever) <= p && p < lireInstant(j.leverSuivant))!;
    const e = etatA(contexte, appareil, journee, p);
    const dernier = segments.at(-1);
    if (dernier && dernier.mode === e.mode && dernier.sessions === e.sessions && memesActions(dernier.actions, e.actions)) {
      dernier.fin = finSegment;
    } else {
      segments.push({ debut: ecrireInstant(p), fin: finSegment, mode: e.mode, sessions: e.sessions, actions: e.actions });
    }
  });
  return segments;
}
