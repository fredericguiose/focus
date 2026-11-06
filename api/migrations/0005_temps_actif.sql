-- 04/11/2026 : temps actif d'une app déclaré par le client PC (hooks de Claude Code), compté sur
-- son plafond propre sans session à ouvrir. Une ligne = une conversation Claude Code
-- (`conversation`) entre un message (`debut`) et la fin de la réponse (`fin`, NULL tant qu'elle
-- tourne). `vu_le` : dernier signe de vie (message, outil, fin). Compté jusqu'à
-- min(fin, vu_le) + marge. `compte` = 0 : hors mode qui bloque l'app (nuit, soirée libre) ;
-- `exempte` = 1 : dossier de travail exempté (devoirs).
CREATE TABLE activites (
  id TEXT PRIMARY KEY,
  utilisateur TEXT NOT NULL,
  appareil TEXT NOT NULL,
  app TEXT NOT NULL,
  conversation TEXT NOT NULL,
  dossier TEXT NOT NULL,
  exempte INTEGER NOT NULL DEFAULT 0,
  compte INTEGER NOT NULL DEFAULT 1,
  debut TEXT NOT NULL,
  vu_le TEXT NOT NULL,
  fin TEXT
);
CREATE INDEX activites_utilisateur_debut ON activites (utilisateur, debut);
CREATE INDEX activites_ouvertes ON activites (utilisateur, conversation) WHERE fin IS NULL;
