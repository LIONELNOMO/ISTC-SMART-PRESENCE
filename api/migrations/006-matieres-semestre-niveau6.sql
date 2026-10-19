-- ===================================================================
--  Migration 006 — Semestre des matières + niveau jusqu'à 6 (Masters)
--
--  À exécuter UNE SEULE FOIS sur une base déjà créée, après 001 à 005.
--  phpMyAdmin → onglet SQL. Ne réimportez PAS schema.sql.
--
--  1) Les filières de Master (M.Tech) ont une 2e année : le niveau peut
--     aller jusqu'à 6 (M1 = 5, M2 = 6).
--  2) Chaque matière porte un semestre (1 ou 2) : en exploitation, seul
--     le semestre courant de l'établissement est affiché.
-- ===================================================================

-- 1) Niveau de 1 à 6.
ALTER TABLE classes DROP CONSTRAINT ck_classes_niveau;
ALTER TABLE classes ADD CONSTRAINT ck_classes_niveau CHECK (niveau BETWEEN 1 AND 6);

-- 2) Semestre de la matière.
ALTER TABLE matieres
  ADD COLUMN semestre TINYINT NOT NULL DEFAULT 1 AFTER classe_id;
ALTER TABLE matieres
  ADD CONSTRAINT ck_matieres_semestre CHECK (semestre IN (1, 2));
