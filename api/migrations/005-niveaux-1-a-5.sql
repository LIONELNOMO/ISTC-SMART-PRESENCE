-- ===================================================================
--  Migration 005 — Niveaux limités de 1 à 5
--
--  À exécuter sur une base déjà créée, après 001 à 004.
--  phpMyAdmin → onglet SQL.
-- ===================================================================

ALTER TABLE classes DROP CONSTRAINT ck_classes_niveau;
ALTER TABLE classes ADD CONSTRAINT ck_classes_niveau CHECK (niveau BETWEEN 1 AND 5);
