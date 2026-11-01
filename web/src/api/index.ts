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

/** Mode simulé seulement : `?scenario=dette` ouvre la soirée avec la proposition de rattraper le sommeil. */
function scenarioDemande(): 'dette' | undefined {
  return new URLSearchParams(window.location.search).get('scenario') === 'dette' ? 'dette' : undefined;
}

/** Mode simulé seulement : `?etiquettes_manquantes=planning,recap` affiche l'alerte des étiquettes Todoist. */
function etiquettesManquantesDemandees(): string[] | undefined {
  const valeur = new URLSearchParams(window.location.search).get('etiquettes_manquantes');
  return valeur ? valeur.split(',').filter(Boolean) : undefined;
}

export function creerApi(jeton: string): ApiFocus {
  return API_SIMULEE
    ? creerApiSimulee({ phase: phaseDemandee(), scenario: scenarioDemande(), etiquettesManquantes: etiquettesManquantesDemandees() })
    : creerApiHttp(jeton);
}
