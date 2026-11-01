// Réception de la config (GitHub Actions). Une version invalide est gardée au journal mais
// ne devient jamais active : l'API lit toujours la dernière version valide.
import { chargerConfigActive } from './contexte';
import type { Dependances, JetonAuthentifie } from './env';
import { ErreurApi } from './erreurs';
import { versInstant } from './temps';
import { type Corps, texte } from './validation';

/** Une config fait quelques kilo-octets ; au-delà, c'est une erreur d'envoi. */
const TAILLE_MAX_YAML = 512_000;

export async function recevoirConfig(deps: Dependances, db: D1Database, jeton: JetonAuthentifie, corps: Corps) {
  const yaml = texte(corps, 'yaml', TAILLE_MAX_YAML);
  const commit = texte(corps, 'commit', 100);
  const recueLe = versInstant(deps.maintenant());
  const resultat = deps.moteur.validerConfig(yaml);
  const erreurs = resultat.ok
    ? resultat.config.utilisateur === jeton.utilisateur
      ? []
      : [`utilisateur : « ${resultat.config.utilisateur} » ne correspond pas au jeton (« ${jeton.utilisateur} »).`]
    : resultat.erreurs;

  const inserer = db.prepare(
    `INSERT INTO config_versions (utilisateur, commit_id, yaml, json_normalise, recu_le, valide, erreurs)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  if (!resultat.ok || erreurs.length > 0) {
    await inserer.bind(jeton.utilisateur, commit, yaml, null, recueLe, 0, JSON.stringify(erreurs)).run();
    const active = await chargerConfigActive(db, jeton.utilisateur);
    throw new ErreurApi(422, 'config_invalide', 'Config refusée : la version précédente reste active.', {
      erreurs,
      version_active: active?.version ?? null,
    });
  }
  await inserer.bind(jeton.utilisateur, commit, yaml, JSON.stringify(resultat.config), recueLe, 1, null).run();
  return { version: commit, valide: true, recue_le: recueLe };
}

export async function versionActive(db: D1Database, jeton: JetonAuthentifie) {
  const active = await chargerConfigActive(db, jeton.utilisateur);
  if (!active) throw new ErreurApi(404, 'config_absente', "Aucune configuration valide n'a encore été reçue.");
  return { version: active.version, recue_le: active.recueLe };
}
