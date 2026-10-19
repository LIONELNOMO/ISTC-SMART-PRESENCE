-- ===================================================================
--  Migration 008 — Fiche de paie par période + paiement
--
--  À exécuter UNE SEULE FOIS sur une base déjà créée, après 001 à 007.
--  phpMyAdmin → onglet SQL. Ne réimportez PAS schema.sql.
--
--  La fiche de paie porte désormais sur une PÉRIODE (début → fin) saisie par
--  le secrétariat. Les heures sont calculées depuis les séances de la période
--  qui ne sont pas déjà portées par une fiche. L'administration applique le
--  taux puis marque « payé » : le montant est figé et les heures sont soldées.
-- ===================================================================

-- 1) Rattachement d'une séance à sa fiche de paie (réservation / solde).
ALTER TABLE sessions
  ADD COLUMN fiche_id CHAR(36) DEFAULT NULL AFTER status;
ALTER TABLE sessions
  ADD KEY idx_sessions_fiche (fiche_id);

-- 2) Période, statut, montant et paiement sur la fiche.
ALTER TABLE fiches_heures
  ADD COLUMN debut         DATE         DEFAULT NULL AFTER periode,
  ADD COLUMN fin           DATE         DEFAULT NULL AFTER debut,
  ADD COLUMN statut        VARCHAR(16)  NOT NULL DEFAULT 'en_attente' AFTER fin,
  ADD COLUMN montant       INT          DEFAULT NULL AFTER total_heures,
  ADD COLUMN par_matiere   LONGTEXT     DEFAULT NULL AFTER par_niveau,
  ADD COLUMN paid_at       DATETIME     DEFAULT NULL,
  ADD COLUMN paid_by       CHAR(36)     DEFAULT NULL,
  ADD COLUMN paid_by_label VARCHAR(160) NOT NULL DEFAULT '';
ALTER TABLE fiches_heures
  ADD KEY idx_fiches_statut (statut);

-- 3) Les anciennes fiches « Depuis le début » (sans dates) sont archivées :
--    elles ne doivent pas apparaître comme fiches de paie en attente.
UPDATE fiches_heures SET statut = 'archivee' WHERE debut IS NULL;
