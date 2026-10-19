-- ===================================================================
--  Migration 002 — Fiches d'heures + départements
--
--  À exécuter UNE SEULE FOIS sur une base déjà créée, après la
--  migration 001. phpMyAdmin → onglet SQL. Ne réimportez PAS schema.sql.
-- ===================================================================

-- 1) Fiches d'heures transmises par le secrétariat à un enseignant (§7).
--    Instantané figé : heures par niveau + total, copiés à l'envoi.
CREATE TABLE IF NOT EXISTS fiches_heures (
  id             CHAR(36)     NOT NULL,
  teacher_id     CHAR(36)     NOT NULL,
  periode        VARCHAR(120) NOT NULL,
  total_heures   DECIMAL(7,2) NOT NULL,
  par_niveau     LONGTEXT     NOT NULL,
  etablissement  VARCHAR(120) NOT NULL DEFAULT '',
  sent_by        CHAR(36)     NOT NULL,
  sent_by_label  VARCHAR(160) NOT NULL DEFAULT '',
  sent_at        DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_fiches_teacher (teacher_id, sent_at),
  CONSTRAINT fk_fiches_teacher FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1 bis) Avis destinés à un enseignant (pop-up : heures ajoutées, fiche…).
CREATE TABLE IF NOT EXISTS avis_enseignant (
  id         CHAR(36)     NOT NULL,
  teacher_id CHAR(36)     NOT NULL,
  type       VARCHAR(40)  NOT NULL,
  titre      VARCHAR(160) NOT NULL,
  corps      VARCHAR(300) NOT NULL,
  at         DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_avis_teacher (teacher_id, at),
  CONSTRAINT fk_avis_teacher FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) Départements (regroupent plusieurs filières).
CREATE TABLE IF NOT EXISTS departements (
  id           CHAR(36)     NOT NULL,
  nom          VARCHAR(120) NOT NULL,
  chef_user_id CHAR(36)            DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_departements_nom (nom),
  KEY idx_departements_chef (chef_user_id),
  CONSTRAINT fk_departements_chef FOREIGN KEY (chef_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) Rattachement des filières à un département.
ALTER TABLE filieres
  ADD COLUMN departement_id CHAR(36) DEFAULT NULL AFTER nom;

ALTER TABLE filieres
  ADD CONSTRAINT fk_filieres_departement
  FOREIGN KEY (departement_id) REFERENCES departements (id) ON DELETE SET NULL;

-- 4) Rattachement direct des enseignants à un département.
ALTER TABLE teachers
  ADD COLUMN departement_id CHAR(36) DEFAULT NULL AFTER user_id;

ALTER TABLE teachers
  ADD CONSTRAINT fk_teachers_departement
  FOREIGN KEY (departement_id) REFERENCES departements (id) ON DELETE SET NULL;

-- 5) Les trois départements de l'établissement (identifiants fixes).
INSERT IGNORE INTO departements (id, nom) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'Technologique'),
  ('d0000000-0000-4000-8000-000000000002', 'Gestion'),
  ('d0000000-0000-4000-8000-000000000003', 'Santé');
