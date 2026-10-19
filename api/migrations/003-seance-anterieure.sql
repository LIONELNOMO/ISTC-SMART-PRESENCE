-- ===================================================================
--  Migration 003 — Séance antérieure (saisie a posteriori)
--
--  À exécuter UNE SEULE FOIS sur une base déjà créée, après 001 et 002.
--  phpMyAdmin → onglet SQL. Ne réimportez PAS schema.sql.
--
--  Permet au secrétariat d'enregistrer un cours passé non pointé (coupure,
--  absence…). Ces séances comptent les heures de l'enseignant mais jamais
--  les présences des étudiants (§13.5).
-- ===================================================================

ALTER TABLE sessions
  ADD COLUMN saisie_anterieure TINYINT(1) NOT NULL DEFAULT 0 AFTER notifiee,
  ADD COLUMN saisie_motif      VARCHAR(300) DEFAULT NULL     AFTER saisie_anterieure;
