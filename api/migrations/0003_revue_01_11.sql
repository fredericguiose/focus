-- Revue du 01/11 (docs/conception.md §4.2, §4.5, §4.7).

-- 1. Décision de nuit : une seule par nuit, garantie par la base (deux requêtes simultanées
-- passaient toutes les deux la lecture « déjà prise ? »). `jour` ne convient pas : c'est la date
-- de l'engagement pour ajoute / retire / decale, et une exception d'un autre jour peut desserrer
-- la nuit en cours. `nuit_decision` = la nuit que la décision consomme (remplie si pendant_nuit = 1).
ALTER TABLE exceptions ADD COLUMN nuit_decision TEXT;
-- Lignes existantes : la nuit de l'exception (la veille de la date pour un engagement). En cas de
-- doublon déjà en base (course d'avant l'index), seule la première de la nuit est remplie.
UPDATE exceptions SET nuit_decision =
  CASE WHEN type IN ('coucher', 'avancer_coucher') THEN jour ELSE date(jour, '-1 day') END
WHERE pendant_nuit = 1 AND annulee_le IS NULL AND NOT EXISTS (
  SELECT 1 FROM exceptions e
  WHERE e.utilisateur = exceptions.utilisateur AND e.pendant_nuit = 1 AND e.annulee_le IS NULL
    AND (CASE WHEN e.type IN ('coucher', 'avancer_coucher') THEN e.jour ELSE date(e.jour, '-1 day') END)
      = (CASE WHEN exceptions.type IN ('coucher', 'avancer_coucher') THEN exceptions.jour ELSE date(exceptions.jour, '-1 day') END)
    AND (e.cree_le < exceptions.cree_le OR (e.cree_le = exceptions.cree_le AND e.rowid < exceptions.rowid))
);
CREATE UNIQUE INDEX exceptions_une_decision_par_nuit ON exceptions (utilisateur, nuit_decision)
  WHERE pendant_nuit = 1 AND annulee_le IS NULL AND nuit_decision IS NOT NULL;

-- 2. Sessions : deux nouveaux motifs de fin. `mode_interdit` : le mode de l'appareil interdit les
-- sessions (nuit, matin verrouillé) ; `plafond_atteint` : plafond quotidien atteint. SQLite ne
-- modifie pas une contrainte CHECK : la table est reconstruite (questions la référence, d'où le
-- report des clés étrangères à la fin de la migration).
PRAGMA defer_foreign_keys = true;
CREATE TABLE sessions_nouvelle (
  id             TEXT PRIMARY KEY,
  utilisateur    TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('travail', 'recherche_rapide')),
  tache_id       TEXT,
  tache_nom      TEXT,
  appareil       TEXT NOT NULL,
  apps           TEXT NOT NULL,
  ouverte_le     TEXT NOT NULL,
  fermee_le      TEXT,
  motif_fin      TEXT CHECK (motif_fin IN ('fermee', 'arretee', 'sans_reponse', 'tache_terminee', 'mode_interdit', 'plafond_atteint')),
  version_config TEXT NOT NULL,
  CHECK ((fermee_le IS NULL) = (motif_fin IS NULL))
);
INSERT INTO sessions_nouvelle SELECT id, utilisateur, type, tache_id, tache_nom, appareil, apps, ouverte_le, fermee_le, motif_fin, version_config FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_nouvelle RENAME TO sessions;
CREATE INDEX sessions_ouverture ON sessions (utilisateur, ouverte_le);
CREATE INDEX sessions_tache ON sessions (utilisateur, tache_id);
CREATE UNIQUE INDEX sessions_une_ouverte ON sessions (utilisateur, appareil) WHERE fermee_le IS NULL;

-- 3. Résultats calculés gardés 60 s (statut par utilisateur, planning par appareil) : le plan
-- gratuit de Workers donne 10 ms de CPU par appel. Toute écriture qui change l'état efface les
-- lignes de l'utilisateur ; `expire_le` borne le reste.
CREATE TABLE cache_calculs (
  utilisateur TEXT NOT NULL,
  cle         TEXT NOT NULL,          -- « statut » ou « planning:<appareil> »
  valeur      TEXT NOT NULL,          -- JSON de la réponse, sans heure_serveur
  calcule_le  TEXT NOT NULL,
  expire_le   TEXT NOT NULL,
  PRIMARY KEY (utilisateur, cle)
);

-- 4. Verrous à échéance (synchro Xiaomi : deux crons simultanés feraient tourner le passToken
-- en même temps, et l'un des deux garderait un jeton déjà périmé).
CREATE TABLE verrous (
  nom        TEXT PRIMARY KEY,
  detenteur  TEXT NOT NULL,
  expire_le  TEXT NOT NULL
);
