import type { CorpsErreur } from './contrat';

/** Erreur montrée telle quelle : `message` vient de l'API, en français. */
export class ErreurFocus extends Error {
  readonly erreur: string;
  readonly statutHttp: number | null;

  constructor(erreur: string, message: string, statutHttp: number | null = null) {
    super(message);
    this.name = 'ErreurFocus';
    this.erreur = erreur;
    this.statutHttp = statutHttp;
  }
}

export function estCorpsErreur(valeur: unknown): valeur is CorpsErreur {
  if (typeof valeur !== 'object' || valeur === null) return false;
  const v = valeur as Record<string, unknown>;
  return typeof v.erreur === 'string' && typeof v.message === 'string';
}

export function versErreurFocus(e: unknown): ErreurFocus {
  if (e instanceof ErreurFocus) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new ErreurFocus('inattendue', message);
}
