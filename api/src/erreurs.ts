import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Erreur renvoyée au client sous la forme `{ erreur, message, ...details }`. */
export class ErreurApi extends Error {
  constructor(
    readonly statut: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function repondreErreur(c: Context, e: ErreurApi): Response {
  return c.json({ erreur: e.code, message: e.message, ...e.details }, e.statut);
}

export const requeteInvalide = (message: string, details?: Record<string, unknown>) =>
  new ErreurApi(400, 'requete_invalide', message, details);

export const configAbsente = () =>
  new ErreurApi(503, 'config_absente', "Aucune configuration valide n'a encore été reçue.");
