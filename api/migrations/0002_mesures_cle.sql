-- Mesures venues d'une source qui a ses propres identifiants (sessions de sommeil Xiaomi) :
-- `cle` = identifiant chez la source, clé d'idempotence ; `details` = JSON propre au type
-- (pour le sommeil : éveil, phases, score, sieste). `valeur` reste le nombre principal
-- (minutes endormi pour le sommeil).
ALTER TABLE mesures ADD COLUMN cle TEXT;
ALTER TABLE mesures ADD COLUMN details TEXT;
CREATE UNIQUE INDEX mesures_cle ON mesures (utilisateur, type, source, cle);
-- Une mesure à clé est identifiée par sa clé seulement : son début peut changer chez la source.
DROP INDEX mesures_unique;
CREATE UNIQUE INDEX mesures_unique ON mesures (utilisateur, type, source, debut) WHERE cle IS NULL;
