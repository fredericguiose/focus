-- 02/11/2026 : plafond propre à certaines apps (Claude Code, 3 h), séparé du plafond commun.
-- `compteur` : app dont le plafond s'applique à la session, NULL = plafond commun.
-- `compteur_depuis` : instant où la session est passée sur ce compteur (ouverture, ou ajout de
-- l'app en cours de session). Avant cet instant, le temps compte sur le plafond commun.
ALTER TABLE sessions ADD COLUMN compteur TEXT;
ALTER TABLE sessions ADD COLUMN compteur_depuis TEXT;
