// Accusés de pose et lots d'événements envoyés par les appareils.
import { chargerConfigActive, chargerContexte } from './contexte';
import type { Dependances, JetonAuthentifie } from './env';
import { requeteInvalide } from './erreurs';
import { estInstant, versInstant } from './temps';
import { type Corps, instant, texte } from './validation';

/** Un accusé de pose date d'il y a peu (envoi différé hors ligne) : au-delà, l'heure est fausse. */
const ECART_ACCUSE_MAX_MS = 2 * 86_400_000;

/** Le téléphone envoie sa journée d'ouvertures en un lot (~300) ; la marge couvre plusieurs jours hors ligne. */
const LOT_MAX = 2000;

export async function enregistrerAccuse(deps: Dependances, db: D1Database, jeton: JetonAuthentifie, corps: Corps) {
  const action = texte(corps, 'action', 100);
  const poseLe = instant(corps, 'pose_le');
  const maintenant = deps.maintenant();
  if (Math.abs(Date.parse(poseLe) - maintenant.getTime()) > ECART_ACCUSE_MAX_MS) {
    throw requeteInvalide('Champ « pose_le » : à plus de 2 jours de l\'heure du serveur.', { champ: 'pose_le' });
  }
  const { contexte } = await chargerContexte(db, jeton.utilisateur, maintenant);
  const nuit = deps.moteur.journeeCourante({ ...contexte, maintenant: versInstant(new Date(Date.parse(poseLe))) }).date;
  await db
    .prepare(`INSERT INTO accuses (utilisateur, appareil, nuit, action, pose_le, recu_le) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(jeton.utilisateur, jeton.nom, nuit, action, versInstant(new Date(Date.parse(poseLe))), versInstant(maintenant))
    .run();
  return { enregistre: true, nuit };
}

interface Reconnexion {
  debut: string;
  duree_s: number | null;
}

interface Acces {
  heure_appareil: string;
  cible: string;
  nom: string | null;
  decision: 'passe' | 'bloque';
}

type Lu = { type: 'reconnexion'; valeur: Reconnexion } | { type: 'acces'; valeur: Acces } | { erreur: string };

function lireEvenement(e: unknown): Lu {
  if (typeof e !== 'object' || e === null) return { erreur: 'objet attendu' };
  const o = e as Record<string, unknown>;
  if (o.type === 'reconnexion') {
    if (!estInstant(o.debut)) return { erreur: 'debut : instant ISO 8601 attendu' };
    const duree = o.duree_s;
    if (duree !== undefined && duree !== null && (typeof duree !== 'number' || !Number.isInteger(duree) || duree < 0)) {
      return { erreur: 'duree_s : entier positif attendu' };
    }
    return { type: 'reconnexion', valeur: { debut: versInstant(new Date(Date.parse(o.debut))), duree_s: (duree as number | undefined) ?? null } };
  }
  if (o.type === 'acces') {
    if (!estInstant(o.heure_appareil)) return { erreur: 'heure_appareil : instant ISO 8601 attendu' };
    if (typeof o.cible !== 'string' || o.cible === '' || o.cible.length > 255) return { erreur: 'cible : texte attendu' };
    if (o.nom !== undefined && o.nom !== null && (typeof o.nom !== 'string' || o.nom.length > 255)) return { erreur: 'nom : texte attendu' };
    if (o.decision !== 'passe' && o.decision !== 'bloque') return { erreur: 'decision : « passe » ou « bloque » attendu' };
    return {
      type: 'acces',
      valeur: {
        heure_appareil: versInstant(new Date(Date.parse(o.heure_appareil))),
        cible: o.cible.toLowerCase(),
        nom: (o.nom as string | undefined) ?? null,
        decision: o.decision,
      },
    };
  }
  return { erreur: 'type : « reconnexion » ou « acces » attendu' };
}

export async function enregistrerEvenements(deps: Dependances, db: D1Database, jeton: JetonAuthentifie, corps: Corps) {
  const liste = corps.evenements;
  if (!Array.isArray(liste)) throw requeteInvalide('Champ « evenements » : liste attendue.', { champ: 'evenements' });
  if (liste.length > LOT_MAX) throw requeteInvalide(`Lot trop gros (${LOT_MAX} événements au plus).`);

  const reconnexions: Reconnexion[] = [];
  const acces: Acces[] = [];
  const rejetes: { index: number; raison: string }[] = [];
  liste.forEach((e, index) => {
    const lu = lireEvenement(e);
    if ('erreur' in lu) rejetes.push({ index, raison: lu.erreur });
    else if (lu.type === 'reconnexion') reconnexions.push(lu.valeur);
    else acces.push(lu.valeur);
  });

  const recuLe = versInstant(deps.maintenant());
  const u = jeton.utilisateur;
  const appareil = jeton.nom;
  const config = (await chargerConfigActive(db, u))?.config;
  const connues = new Set(
    config ? Object.values(config.apps).flatMap((a) => [...a.domaines, ...(a.iphone ? [a.iphone.toLowerCase()] : [])]) : [],
  );
  const inconnues = config ? acces.filter((a) => !connues.has(a.cible)) : [];

  // Une seule requête par type, quelle que soit la taille du lot : D1 limite les paramètres
  // (100) et les requêtes (50) par appel.
  const instructions: D1PreparedStatement[] = [];
  if (reconnexions.length > 0) {
    instructions.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO reconnexions (utilisateur, appareil, debut, duree_s, recu_le)
           SELECT ?, ?, json_extract(value, '$.debut'), json_extract(value, '$.duree_s'), ? FROM json_each(?)`,
        )
        .bind(u, appareil, recuLe, JSON.stringify(reconnexions)),
    );
  }
  if (acces.length > 0) {
    instructions.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO acces (utilisateur, appareil, heure_appareil, recu_le, cible, nom, decision)
           SELECT ?, ?, json_extract(value, '$.heure_appareil'), ?, json_extract(value, '$.cible'),
                  json_extract(value, '$.nom'), json_extract(value, '$.decision') FROM json_each(?)`,
        )
        .bind(u, appareil, recuLe, JSON.stringify(acces)),
    );
  }
  if (inconnues.length > 0) {
    instructions.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO apps_vues (utilisateur, cible, nom, appareil, premiere_vue)
           SELECT ?, json_extract(value, '$.cible'), json_extract(value, '$.nom'), ?, json_extract(value, '$.heure_appareil')
           FROM json_each(?)`,
        )
        .bind(u, appareil, JSON.stringify(inconnues)),
    );
  }
  const resultats = instructions.length > 0 ? await db.batch(instructions) : [];
  const ecrits = (i: number) => resultats[i]?.meta.changes ?? 0;
  const nbReconnexions = reconnexions.length > 0 ? ecrits(0) : 0;
  const nbAcces = acces.length > 0 ? ecrits(reconnexions.length > 0 ? 1 : 0) : 0;
  return {
    recus: liste.length,
    enregistres: { reconnexion: nbReconnexions, acces: nbAcces },
    doublons_ignores: reconnexions.length + acces.length - nbReconnexions - nbAcces,
    rejetes,
  };
}
