import type { Question, TacheSession } from '@/api/contrat';

/** Attente imposée par l'interface avant d'envoyer une ouverture de session. */
export const ATTENTE_OUVERTURE_S = 10;

export interface EtatQuestion {
  /** Secondes avant que « Je continue » soit accepté par l'API (0 = maintenant). */
  avantContinuerS: number;
  /** Secondes avant l'expiration : sans réponse, la session se ferme. */
  avantExpirationS: number;
  peutContinuer: boolean;
  expiree: boolean;
}

/**
 * `maintenantMs` doit être l'heure du serveur (horloge locale + décalage) : l'API refuse un
 * « continue » arrivé avant `posee_a + attente_s`, d'après sa propre horloge.
 */
export function etatQuestion(question: Question, maintenantMs: number): EtatQuestion {
  const continuerDes = Date.parse(question.posee_a) + question.attente_s * 1000;
  const expireA = Date.parse(question.expire_a);
  const expiree = maintenantMs >= expireA;
  return {
    avantContinuerS: Math.max(0, Math.ceil((continuerDes - maintenantMs) / 1000)),
    avantExpirationS: Math.max(0, Math.ceil((expireA - maintenantMs) / 1000)),
    peutContinuer: !expiree && maintenantMs >= continuerDes,
    expiree,
  };
}

/**
 * L'API renvoie la question suivante dès sa création, avec un `posee_a` futur : elle n'attend
 * une réponse qu'à partir de `posee_a`. Avant, c'est seulement l'heure de la prochaine question.
 */
export function questionPosee(question: Question, maintenantMs: number): boolean {
  return Date.parse(question.posee_a) <= maintenantMs;
}

export function tacheEligible(tache: TacheSession, maintenantMs: number): boolean {
  return Date.parse(tache.eligible_le) <= maintenantMs;
}
