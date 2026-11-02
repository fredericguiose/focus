// POST /v1/actualiser (bouton « actualiser » de la web app) : synchro Todoist forcée, avec le code
// du cron (src/planifie.ts), puis statut recalculé.
import { instructionMarquerAgenda, reglagesGoogle } from './agenda';
import { instructionsInvalider, invaliderCache, prendreVerrou } from './cache';
import { CLES_CACHE, chargerContexte, ecrireCache } from './contexte';
import type { Dependances, JetonAuthentifie, Liaisons } from './env';
import { ErreurApi } from './erreurs';
import { jetonTodoist, rafraichirTodoist } from './planifie';
import { statut } from './planning';
import { versInstant } from './temps';

/** Anti-abus de POST /v1/actualiser : au plus une synchro Todoist forcée par utilisateur dans cet intervalle. */
export const INTERVALLE_SYNCHRO_FORCEE_S = 15;

/**
 * Bouton « actualiser » de la web app (POST /v1/actualiser) : synchro Todoist immédiate de
 * l'utilisateur, avec le code du cron (`rafraichirTodoist`), puis cache des calculs effacé (statut
 * et plannings) et statut recalculé. Au plus une synchro forcée toutes les 15 s (verrou à
 * échéance, jamais rendu) : au-delà, ou sans Todoist pour cet utilisateur, le cache est seulement
 * effacé. La synchro compte pour la cadence du cron, qui ne la refait pas aussitôt. Si l'agenda
 * Google est configuré pour l'utilisateur, il est signalé « à resynchroniser » (prochain passage).
 */
export async function actualiser(env: Liaisons, deps: Dependances, jeton: JetonAuthentifie) {
  const utilisateur = jeton.utilisateur;
  const maintenant = deps.maintenant();
  const jetonTd = jetonTodoist(env, utilisateur);
  if (jetonTd && (await prendreVerrou(env.DB, `synchro_forcee:${utilisateur}`, maintenant, INTERVALLE_SYNCHRO_FORCEE_S))) {
    const charge = await chargerContexte(env.DB, utilisateur, maintenant);
    await ecrireCache(env.DB, utilisateur, CLES_CACHE.synchroTodoist, { tentee_le: versInstant(maintenant) }, maintenant);
    try {
      await rafraichirTodoist(env.DB, deps, jetonTd, utilisateur, charge, maintenant);
    } catch (e) {
      console.error(`Actualisation (${utilisateur}) : synchro Todoist en échec :`, e);
      await invaliderCache(env.DB, utilisateur);
      throw new ErreurApi(502, 'todoist_indisponible', 'Todoist ne répond pas : tâches non synchronisées.');
    }
  }
  // Le bloc « Dormir » de Google Agenda est revu au prochain passage de la tâche planifiée.
  const agenda = reglagesGoogle(env)?.utilisateur === utilisateur ? [instructionMarquerAgenda(env.DB, utilisateur, versInstant(maintenant))] : [];
  await env.DB.batch([...instructionsInvalider(env.DB, utilisateur), ...agenda]);
  return statut(deps, env.DB, jeton);
}
