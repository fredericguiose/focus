// Outils communs aux tests. Horaires fictifs : uniquement config/exemple.yaml.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lireConfig } from '../src/config';
import type { Config, Contexte, Exception, FaitsTodoist, Report, Tache } from '../src/types';

export const EXEMPLE = readFileSync(fileURLToPath(new URL('../../config/exemple.yaml', import.meta.url)), 'utf8');

/** Remplace un passage qui doit exister une seule fois (sinon le test serait faux en silence). */
export function remplacer(yaml: string, ancien: string, nouveau: string): string {
  const morceaux = yaml.split(ancien);
  if (morceaux.length !== 2) throw new Error(`« ${ancien} » apparaît ${morceaux.length - 1} fois dans le YAML`);
  return morceaux.join(nouveau);
}

export const configExemple: Config = lireConfig(EXEMPLE);

export function faits(partiel: Partial<FaitsTodoist> = {}): FaitsTodoist {
  return { recupereLe: '2026-11-02T00:00:00Z', taches: [], reports: [], photosRetards: {}, ...partiel };
}

export function contexte(maintenant: string, partiel: Partial<Omit<Contexte, 'maintenant'>> = {}): Contexte {
  return { config: configExemple, faits: faits(), exceptions: [], ...partiel, maintenant };
}

let compteur = 0;

export function tache(partiel: Partial<Tache> = {}): Tache {
  compteur += 1;
  return {
    id: `t${compteur}`,
    contenu: `tâche ${compteur}`,
    priorite: 'p1',
    etiquettes: [],
    echeance: null,
    deadline: null,
    terminee: false,
    termineeLe: null,
    creeeLe: '2026-10-01T08:00:00Z',
    assigneeAMoi: true,
    ...partiel,
  };
}

export function report(partiel: Partial<Report> = {}): Report {
  return {
    tacheId: 'r1',
    priorite: 'p1',
    le: '2026-11-02T10:00:00Z',
    de: '2026-11-02',
    vers: '2026-11-03',
    deadline: null,
    deadlinePoseeLe: null,
    reportsPrecedents: 0,
    documente: false,
    ...partiel,
  };
}

export function exception(demande: Exception['demande'], creeeLe: string, pendantNuit = false): Exception {
  compteur += 1;
  return { id: `e${compteur}`, demande, creeeLe, pendantNuit };
}

/** Faits où rien ne retient : planning fait, rien de prioritaire, aucun récap en retard. */
export const faitsLibres = faits();
