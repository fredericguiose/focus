-- Schéma initial de Focus v2.0 (D1 / SQLite).
-- Principes : une colonne `utilisateur` dans chaque table ; heures en texte ISO 8601 UTC
-- ("2026-11-03T09:30:00Z") ; dates locales en "YYYY-MM-DD" ; journal en ajout seul (une
-- annulation ou une fin est une colonne remplie plus tard, jamais une suppression) ; rien de ce
-- qui se calcule n'est stocké (plafond de sessions, dette, compteur de « continue »).

-- Un jeton. Pour un jeton `appareil`, `nom` est l'identifiant de l'appareil dans la config.
CREATE TABLE appareils (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  utilisateur   TEXT NOT NULL,
  nom           TEXT NOT NULL,
  type_appareil TEXT CHECK (type_appareil IN ('pc_linux', 'pc_windows', 'iphone')),
  type_jeton    TEXT NOT NULL CHECK (type_jeton IN ('appareil', 'interface', 'config')),
  empreinte     TEXT NOT NULL UNIQUE,  -- SHA-256 du jeton, en hexadécimal ; le jeton n'est jamais stocké
  cree_le       TEXT NOT NULL,
  vu_le         TEXT,
  revoque_le    TEXT,
  CHECK ((type_jeton = 'appareil') = (type_appareil IS NOT NULL))
);
CREATE INDEX appareils_utilisateur ON appareils (utilisateur, type_jeton, nom);

-- Une version reçue de la config. L'API lit la dernière version valide.
CREATE TABLE config_versions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  utilisateur    TEXT NOT NULL,
  commit_id      TEXT NOT NULL,
  yaml           TEXT NOT NULL,
  json_normalise TEXT,                -- config validée et normalisée ; NULL si invalide
  recu_le        TEXT NOT NULL,
  valide         INTEGER NOT NULL CHECK (valide IN (0, 1)),
  erreurs        TEXT,                -- JSON : liste des erreurs si invalide
  CHECK ((valide = 1) = (json_normalise IS NOT NULL))
);
CREATE INDEX config_versions_active ON config_versions (utilisateur, valide, id);

-- Une exception. `jour` = la nuit (coucher, avancer_coucher) ou la date de l'engagement
-- (ajoute, retire, decale). `details` porte la demande complète : un nouveau type
-- d'exception ne demande aucune migration.
CREATE TABLE exceptions (
  id             TEXT PRIMARY KEY,
  utilisateur    TEXT NOT NULL,
  jour           TEXT NOT NULL,
  type           TEXT NOT NULL,
  raison         TEXT,
  pendant_nuit   INTEGER NOT NULL DEFAULT 0 CHECK (pendant_nuit IN (0, 1)),
  appareil       TEXT,
  details        TEXT NOT NULL,
  version_config TEXT NOT NULL,
  cree_le        TEXT NOT NULL,
  annulee_le     TEXT
);
CREATE INDEX exceptions_jour ON exceptions (utilisateur, jour);

-- Une activation manuelle de routine (prévue, sans point d'entrée en v2.0).
CREATE TABLE activations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  utilisateur TEXT NOT NULL,
  routine     TEXT NOT NULL,
  effet_le    TEXT NOT NULL,
  raison      TEXT,
  appareil    TEXT,
  cree_le     TEXT NOT NULL,
  annulee_le  TEXT
);
CREATE INDEX activations_effet ON activations (utilisateur, effet_le);

-- Un accès temporaire. Un seul type de table pour toutes les sortes d'accès.
CREATE TABLE sessions (
  id             TEXT PRIMARY KEY,
  utilisateur    TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('travail', 'recherche_rapide')),
  tache_id       TEXT,
  tache_nom      TEXT,
  appareil       TEXT NOT NULL,
  apps           TEXT NOT NULL,       -- JSON : identifiants d'apps du catalogue
  ouverte_le     TEXT NOT NULL,
  fermee_le      TEXT,
  motif_fin      TEXT CHECK (motif_fin IN ('fermee', 'arretee', 'sans_reponse', 'tache_terminee')),
  version_config TEXT NOT NULL,
  CHECK ((fermee_le IS NULL) = (motif_fin IS NULL))
);
CREATE INDEX sessions_ouverture ON sessions (utilisateur, ouverte_le);
CREATE INDEX sessions_tache ON sessions (utilisateur, tache_id);
-- Une seule session ouverte par appareil : on y ajoute des apps, on n'en ouvre pas une seconde.
CREATE UNIQUE INDEX sessions_une_ouverte ON sessions (utilisateur, appareil) WHERE fermee_le IS NULL;

-- Une question de session (« Toujours sur … ? »). `attente_s` et `expire_a` figent la règle
-- appliquée au moment où la question a été créée.
CREATE TABLE questions (
  id          TEXT PRIMARY KEY,
  utilisateur TEXT NOT NULL,
  session_id  TEXT NOT NULL REFERENCES sessions (id),
  posee_a     TEXT NOT NULL,
  attente_s   INTEGER NOT NULL,
  expire_a    TEXT NOT NULL,
  repondue_le TEXT,
  reponse     TEXT CHECK (reponse IN ('continue', 'arrete', 'aucune'))
);
CREATE INDEX questions_session ON questions (utilisateur, session_id, posee_a);

-- Une app ouverte (téléphone) ou un domaine demandé (PC).
CREATE TABLE acces (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  utilisateur    TEXT NOT NULL,
  appareil       TEXT NOT NULL,
  heure_appareil TEXT NOT NULL,
  recu_le        TEXT NOT NULL,
  cible          TEXT NOT NULL,       -- identifiant de bundle ou domaine
  nom            TEXT,
  decision       TEXT NOT NULL CHECK (decision IN ('passe', 'bloque'))
);
-- Plusieurs automatisations peuvent envoyer le même accès : les doublons sont ignorés.
CREATE UNIQUE INDEX acces_unique ON acces (utilisateur, appareil, heure_appareil, cible);

-- Une cible (app ou domaine) vue sans être dans le catalogue au moment de l'accès.
CREATE TABLE apps_vues (
  utilisateur  TEXT NOT NULL,
  cible        TEXT NOT NULL,
  nom          TEXT,
  appareil     TEXT NOT NULL,
  premiere_vue TEXT NOT NULL,
  PRIMARY KEY (utilisateur, cible)
);

-- Une nuit, photographiée au coucher appliqué (historique).
CREATE TABLE nuits (
  utilisateur      TEXT NOT NULL,
  nuit             TEXT NOT NULL,     -- date locale du soir
  routine          TEXT NOT NULL,
  lever            TEXT NOT NULL,     -- lever du lendemain
  coucher_prevu    TEXT NOT NULL,
  coucher_applique TEXT NOT NULL,
  decision_de_nuit INTEGER NOT NULL CHECK (decision_de_nuit IN (0, 1)),
  photo_le         TEXT NOT NULL,
  version_config   TEXT NOT NULL,
  PRIMARY KEY (utilisateur, nuit)
);

-- Un verrou posé par un appareil.
CREATE TABLE accuses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  utilisateur TEXT NOT NULL,
  appareil    TEXT NOT NULL,
  nuit        TEXT NOT NULL,
  action      TEXT NOT NULL,
  pose_le     TEXT NOT NULL,
  recu_le     TEXT NOT NULL
);
CREATE INDEX accuses_nuit ON accuses (utilisateur, nuit);

-- Une reconnexion pendant un segment verrouillé.
CREATE TABLE reconnexions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  utilisateur TEXT NOT NULL,
  appareil    TEXT NOT NULL,
  debut       TEXT NOT NULL,
  duree_s     INTEGER,
  recu_le     TEXT NOT NULL
);
CREATE UNIQUE INDEX reconnexions_unique ON reconnexions (utilisateur, appareil, debut);

-- Une mesure venue de l'extérieur (sommeil, séance…) : un nouveau type = aucune table.
CREATE TABLE mesures (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  utilisateur TEXT NOT NULL,
  type        TEXT NOT NULL,
  debut       TEXT NOT NULL,
  fin         TEXT,
  valeur      REAL,
  source      TEXT NOT NULL,
  recu_le     TEXT NOT NULL
);
CREATE UNIQUE INDEX mesures_unique ON mesures (utilisateur, type, source, debut);

-- La photo des retards de 00:00. Une ligne par photo prise, même vide : sans elle, on ne
-- distinguerait pas « aucun retard à minuit » de « photo jamais prise ».
CREATE TABLE photos_retards (
  utilisateur TEXT NOT NULL,
  date        TEXT NOT NULL,
  fuseau      TEXT NOT NULL,
  prise_le    TEXT NOT NULL,
  PRIMARY KEY (utilisateur, date)
);

-- Une tâche de la photo des retards.
CREATE TABLE retards (
  utilisateur TEXT NOT NULL,
  date        TEXT NOT NULL,
  tache_id    TEXT NOT NULL,
  tache_nom   TEXT NOT NULL,
  PRIMARY KEY (utilisateur, date, tache_id)
);

-- Les faits Todoist en cache, réécrits seulement quand ils changent.
CREATE TABLE cache_todoist (
  utilisateur TEXT NOT NULL,
  cle         TEXT NOT NULL,
  valeur      TEXT NOT NULL,          -- JSON
  maj_le      TEXT NOT NULL,
  PRIMARY KEY (utilisateur, cle)
);

-- Une notification envoyée (prévue, sans émetteur en v2.0).
CREATE TABLE notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  utilisateur TEXT NOT NULL,
  type        TEXT NOT NULL,
  appareil    TEXT,
  envoyee_le  TEXT NOT NULL,
  contenu     TEXT NOT NULL
);
CREATE INDEX notifications_envoi ON notifications (utilisateur, envoyee_le);
