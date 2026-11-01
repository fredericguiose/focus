import type { MiddlewareHandler } from 'hono';
import type { Dependances, EnvApp, JetonAuthentifie, TypeJeton } from './env';
import { ErreurApi } from './erreurs';
import { versInstant } from './temps';

/** `vu_le` n'est réécrit qu'au plus toutes les 5 min : le dernier ping n'a pas besoin d'être plus fin. */
const PAS_DU_PING_MS = 5 * 60 * 1000;

export async function empreinte(jeton: string): Promise<string> {
  const octets = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jeton)));
  return Array.from(octets, (o) => o.toString(16).padStart(2, '0')).join('');
}

interface LigneJeton {
  id: number;
  utilisateur: string;
  nom: string;
  type_jeton: TypeJeton;
  type_appareil: JetonAuthentifie['typeAppareil'];
}

const NOMS: Record<TypeJeton, string> = { appareil: 'appareil', interface: 'interface', config: 'config' };

/** Nom de l'interface sans jeton (identité Access ou utilisateur local) ; aucune ligne en base. */
export const NOM_INTERFACE_IMPLICITE = 'appli_web';

/**
 * Sans en-tête Authorization, sur l'hôte web (e-mail Access vérifié) ou en local avec
 * FOCUS_UTILISATEUR_LOCAL : la requête vaut jeton « interface » de cet utilisateur. Pas de ligne
 * dans `appareils`, donc pas de `vu_le` (le statut ne lit que celui des appareils).
 * Avec un en-tête : vérification du jeton comme avant ; sur l'hôte web, il doit appartenir au même
 * utilisateur que l'e-mail Access, sinon 403 (un Bearer ne change jamais l'identité).
 */

export function exigerJeton(deps: Dependances, ...autorises: TypeJeton[]): MiddlewareHandler<EnvApp> {
  return async (c, suite) => {
    const entete = c.req.header('Authorization') ?? '';
    const implicite = c.get('utilisateurImplicite');
    if (entete.trim() === '' && implicite && autorises.includes('interface')) {
      c.set('jeton', { id: 0, utilisateur: implicite, nom: NOM_INTERFACE_IMPLICITE, typeJeton: 'interface', typeAppareil: null });
      return suite();
    }
    const trouve = /^Bearer\s+(\S+)\s*$/i.exec(entete);
    if (!trouve) {
      c.header('WWW-Authenticate', 'Bearer realm="focus"');
      throw new ErreurApi(401, 'jeton_absent', 'En-tête « Authorization: Bearer <jeton> » manquant.');
    }
    const ligne = await c.env.DB.prepare(
      `SELECT id, utilisateur, nom, type_jeton, type_appareil FROM appareils
       WHERE empreinte = ? AND revoque_le IS NULL`,
    )
      .bind(await empreinte(trouve[1]!))
      .first<LigneJeton>();
    if (!ligne) {
      c.header('WWW-Authenticate', 'Bearer realm="focus", error="invalid_token"');
      throw new ErreurApi(401, 'jeton_invalide', 'Jeton inconnu ou révoqué.');
    }
    if (!autorises.includes(ligne.type_jeton)) {
      throw new ErreurApi(
        403,
        'jeton_non_autorise',
        `Un jeton « ${NOMS[ligne.type_jeton]} » n'a pas accès à ce point d'entrée (attendu : ${autorises.join(' ou ')}).`,
      );
    }
    if (ligne.type_jeton === 'interface' && c.get('hote') === 'api') {
      throw new ErreurApi(
        403,
        'jeton_non_autorise',
        "Le jeton « interface » ne s'utilise que sur l'hôte de la web app (derrière Cloudflare Access).",
      );
    }
    if (c.get('hote') === 'web' && ligne.utilisateur !== implicite) {
      throw new ErreurApi(403, 'jeton_non_autorise', "Ce jeton n'appartient pas à l'utilisateur connecté par Cloudflare Access.");
    }
    const maintenant = deps.maintenant();
    await c.env.DB.prepare(`UPDATE appareils SET vu_le = ? WHERE id = ? AND (vu_le IS NULL OR vu_le < ?)`)
      .bind(versInstant(maintenant), ligne.id, versInstant(maintenant.getTime() - PAS_DU_PING_MS))
      .run();
    c.set('jeton', {
      id: ligne.id,
      utilisateur: ligne.utilisateur,
      nom: ligne.nom,
      typeJeton: ligne.type_jeton,
      typeAppareil: ligne.type_appareil,
    });
    await suite();
  };
}

export const TOUS: TypeJeton[] = ['appareil', 'interface', 'config'];
