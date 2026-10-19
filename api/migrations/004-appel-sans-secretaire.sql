-- ===================================================================
--  Migration 004 — Appel sans secrétaire
--
--  À exécuter UNE SEULE FOIS sur une base déjà créée, après 001 à 003.
--  phpMyAdmin → onglet SQL. Ne réimportez PAS schema.sql.
--
--  Permet à l'enseignant de faire l'appel sans secrétaire ni code : il coche
--  les présents, et le secrétariat pointe ses heures ensuite (§4).
-- ===================================================================

-- 1) Marque sur la séance : appel validé sans code, par l'enseignant.
ALTER TABLE sessions
  ADD COLUMN declare_enseignant TINYINT(1) NOT NULL DEFAULT 0 AFTER saisie_motif;

-- 2) Appels déclarés en attente de pointage des heures.
CREATE TABLE IF NOT EXISTS releves_declares (
  id              CHAR(36)  NOT NULL,
  teacher_id      CHAR(36)  NOT NULL,
  matiere_id      CHAR(36)  NOT NULL,
  classe_id       CHAR(36)  NOT NULL,
  niveau          TINYINT   NOT NULL,
  day             DATE      NOT NULL,
  presents        LONGTEXT  NOT NULL,
  compte_physique SMALLINT           DEFAULT NULL,
  declared_at     DATETIME  NOT NULL,
  session_id      CHAR(36)           DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_declares_teacher (teacher_id, day),
  KEY idx_declares_pending (session_id),
  CONSTRAINT fk_declares_teacher FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE CASCADE,
  CONSTRAINT fk_declares_matiere FOREIGN KEY (matiere_id) REFERENCES matieres (id) ON DELETE CASCADE,
  CONSTRAINT fk_declares_classe FOREIGN KEY (classe_id) REFERENCES classes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
