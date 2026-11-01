import type { ApiFocus } from './contrat';
import { ErreurFocus } from './erreur';
import { creerApi } from './index';

/**
 * L'API demande-t-elle un jeton ? Une lecture du statut sans jeton : seul un 401 `jeton_absent`
 * ramène à la saisie du jeton. Toute autre réponse (succès, réseau, 403, 5xx) : mode sans jeton,
 * l'erreur s'affiche dans la coquille et la lecture périodique réessaie.
 */
export async function modeAuthentification(api: ApiFocus = creerApi(null)): Promise<'sans_jeton' | 'jeton'> {
  try {
    await api.statut();
    return 'sans_jeton';
  } catch (e) {
    return e instanceof ErreurFocus && e.statutHttp === 401 && e.erreur === 'jeton_absent' ? 'jeton' : 'sans_jeton';
  }
}
