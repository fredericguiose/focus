// Point d'entrée du moteur : un objet conforme à `Moteur`, plus les fonctions nommées.

import type { Config, Moteur } from './types';
import { validerConfig } from './config';
import { etat } from './etat';
import { expliquer, sortie } from './explication';
import { prixException } from './exceptions';
import { engagementsPrevus, journee, journeeCourante } from './journee';
import { planifier } from './planning';
import { verifierEngagements } from './verification';

/** Secondes d'attente du n-ième « continue » (n à partir de 0) ; la dernière valeur se répète. */
export function attenteContinue(config: Config, n: number): number {
  const attentes = config.sessions.attentesS;
  const rang = Math.min(Math.max(0, Math.floor(n)), attentes.length - 1);
  return attentes[rang] ?? 0;
}

export const moteur: Moteur = {
  validerConfig,
  journee,
  journeeCourante,
  engagementsPrevus,
  etat,
  planifier,
  expliquer,
  sortie,
  prixException,
  verifierEngagements,
  attenteContinue,
};

export { validerConfig, lireConfig } from './config';
export { journee, journeeCourante, routineDuJour, nuitDe, engagementsPrevus } from './journee';
export { etat, actionsDuMode } from './etat';
export { planifier } from './planning';
export { expliquer, sortie, NOMS_DES_MODES } from './explication';
export { prixException, PHRASE_DECISION_DE_NUIT, RAISON_MIN_CARACTERES } from './exceptions';
export { prixDuReport } from './report';
export {
  planningRestant,
  recapRestant,
  prioritairesRestantes,
  retardsRestants,
  tachesFiltrees,
} from './conditions';
export { verifierEngagements } from './verification';
export { TYPES_DE_MESURE } from './types';
export type * from './types';
