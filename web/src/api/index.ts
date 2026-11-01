import type { ApiFocus, Phase } from './contrat';
import { creerApiHttp } from './http';
import { creerApiSimulee } from './simule';

export const API_SIMULEE = import.meta.env.VITE_API_SIMULEE === '1';

const PHASES: Phase[] = ['journee', 'soiree', 'nuit'];

/** Mode simulé seulement : `?phase=nuit` place l'horloge fictive dans cette phase. */
function phaseDemandee(): Phase | undefined {
  const valeur = new URLSearchParams(window.location.search).get('phase');
  return PHASES.find((p) => p === valeur);
}

export function creerApi(jeton: string): ApiFocus {
  return API_SIMULEE ? creerApiSimulee({ phase: phaseDemandee() }) : creerApiHttp(jeton);
}
