-- ===================================================================
--  Migration 007 — Nom anglais des matières (bilingue FR / EN)
--
--  À exécuter UNE SEULE FOIS sur une base déjà créée, après 001 à 006.
--  phpMyAdmin → onglet SQL. Ne réimportez PAS schema.sql.
--
--  Chaque matière porte désormais deux noms :
--    - `nom`    : le nom FRANÇAIS (langue principale de l'application) ;
--    - `nom_en` : le nom ANGLAIS (intitulé officiel du cursus).
--  Les deux sont affichés partout où une matière apparaît.
-- ===================================================================

ALTER TABLE matieres
  ADD COLUMN nom_en VARCHAR(120) DEFAULT NULL AFTER nom;
