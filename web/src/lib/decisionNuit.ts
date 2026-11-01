// Friction d'un desserrage (conception §3.4) : raison seule avant l'ouverture, raison et phrase
// pour la décision de nuit. L'API reste juge ; l'interface désactive
// seulement le bouton tant que la demande serait refusée à coup sûr.

export const PHRASE_NUIT = 'JE NE PEUX PAS DECALER';
export const RAISON_MIN = 50;

/**
 * Longueur comptée sans les espaces de bord et en caractères réels (pas en unités UTF-16) :
 * c'est le compte le plus bas possible, donc le bouton ne s'active jamais pour une raison que
 * l'API, quelle que soit sa façon de compter, jugerait trop courte.
 */
export function longueurRaison(raison: string): number {
  return [...raison.trim()].length;
}

export interface ValidationFriction {
  longueur: number;
  raisonOk: boolean;
  phraseOk: boolean;
  valide: boolean;
}

export function validerFriction(raison: string, phrase: string, avecPhrase = true): ValidationFriction {
  const longueur = longueurRaison(raison);
  const raisonOk = longueur >= RAISON_MIN;
  const phraseOk = !avecPhrase || phrase === PHRASE_NUIT;
  return { longueur, raisonOk, phraseOk, valide: raisonOk && phraseOk };
}
