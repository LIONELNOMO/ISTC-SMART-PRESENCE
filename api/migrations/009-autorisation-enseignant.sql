-- ===================================================================
--  Migration 009 — Partage d'enseignants entre départements (§13.3)
--
--  À exécuter UNE SEULE FOIS sur une base déjà créée, après 001 à 008.
--  phpMyAdmin → onglet SQL. Ne réimportez PAS schema.sql.
--
--  Un chef peut affecter un enseignant d'un AUTRE département uniquement
--  après autorisation du chef du département propriétaire. L'autorisation
--  vaut pour tout le département demandeur, jusqu'à révocation.
-- ===================================================================

CREATE TABLE autorisations_enseignant (
  id             CHAR(36)    NOT NULL,
  teacher_id     CHAR(36)    NOT NULL,
  departement_id CHAR(36)    NOT NULL,
  statut         VARCHAR(16) NOT NULL DEFAULT 'en_attente',
  demande_par    CHAR(36)    NOT NULL,
  demande_at     DATETIME    NOT NULL,
  decide_par     CHAR(36)             DEFAULT NULL,
  decide_at      DATETIME             DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_autorisation (teacher_id, departement_id),
  KEY idx_autorisation_dep (departement_id),
  KEY idx_autorisation_statut (statut),
  CONSTRAINT fk_autor_teacher FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE CASCADE,
  CONSTRAINT fk_autor_dep FOREIGN KEY (departement_id) REFERENCES departements (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
