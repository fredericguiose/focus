// localStorage peut être absent ou lever une exception (navigation privée, site bloqué) :
// l'interface doit continuer à fonctionner, au prix de redemander le jeton.

const CLE_JETON = 'focus.jeton';

export function lireJeton(): string | null {
  try {
    return localStorage.getItem(CLE_JETON);
  } catch {
    return null;
  }
}

export function ecrireJeton(jeton: string): void {
  try {
    localStorage.setItem(CLE_JETON, jeton);
  } catch {
    /* jeton gardé en mémoire seulement */
  }
}

export function effacerJeton(): void {
  try {
    localStorage.removeItem(CLE_JETON);
  } catch {
    /* rien à effacer */
  }
}
