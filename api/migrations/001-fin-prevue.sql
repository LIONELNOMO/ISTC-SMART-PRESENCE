-- ===================================================================
--  Migration 001 — Heure de fin prévue des séances
--
--  À exécuter UNE SEULE FOIS sur une base déjà créée (locale ou en
--  ligne), dans phpMyAdmin → onglet SQL. Ne réimportez PAS schema.sql :
--  il effacerait vos données.
--
--  Ajoute la colonne planned_end_at : l'heure de fin prévue saisie par
--  le secrétariat, plafond des heures payées (§4).
-- ===================================================================

-- 1) Ajouter la colonne (nullable : un pointage par scan n'a pas de fin
--    prévue, et les séances déjà en base n'en ont pas non plus).
ALTER TABLE sessions
  ADD COLUMN planned_end_at DATETIME NULL AFTER arrival_via;

-- 2) La fin prévue, si renseignée, est postérieure à l'arrivée.
ALTER TABLE sessions
  ADD CONSTRAINT ck_sessions_fin_prevue
  CHECK (planned_end_at IS NULL OR planned_end_at > arrival_at);
