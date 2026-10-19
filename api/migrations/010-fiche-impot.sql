-- ===================================================================
--  Migration 010 — Impôt sur la fiche de paie (§7)
--
--  À exécuter UNE SEULE FOIS sur une base déjà créée, après 001 à 009.
--  phpMyAdmin → onglet SQL. Ne réimportez PAS schema.sql.
--
--  L'administration saisit un taux d'impôt (%) sur la fiche avant de payer.
--  Au paiement, on fige : brut (montant), impôt et net (brut − impôt).
--  Rappel : les heures payées sont le TOTAL de la fiche arrondi à l'heure
--  inférieure (les minutes ne comptent pas) — c'est déjà pris en compte dans
--  le montant brut.
-- ===================================================================

ALTER TABLE fiches_heures
  ADD COLUMN taux_impot DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER montant,
  ADD COLUMN impot      INT DEFAULT NULL AFTER taux_impot,
  ADD COLUMN net        INT DEFAULT NULL AFTER impot;
