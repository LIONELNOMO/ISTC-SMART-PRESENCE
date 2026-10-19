SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE users (
  id             CHAR(36)     NOT NULL,
  login          VARCHAR(64)  NOT NULL,
  -- login_key : le login normalisé (minuscules). L'unicité porte sur lui,
  -- pour qu'on ne puisse pas créer « INF1001 » et « inf1001 ».
  login_key      VARCHAR(64)  NOT NULL,
  nom            VARCHAR(80)  NOT NULL DEFAULT '',
  prenom         VARCHAR(80)  NOT NULL DEFAULT '',
  telephone      VARCHAR(20)           DEFAULT NULL,
  -- §13.2 : Argon2id, produit par password_hash(). Jamais de mot de passe en clair.
  password_hash  VARCHAR(255) NOT NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 1,
  actif          TINYINT(1)   NOT NULL DEFAULT 1,
  teacher_id     CHAR(36)              DEFAULT NULL,
  student_id     CHAR(36)              DEFAULT NULL,
  filiere_id     CHAR(36)              DEFAULT NULL,
  password_changed_at DATETIME         DEFAULT NULL,
  created_at     DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_login_key (login_key),
  KEY idx_users_teacher (teacher_id),
  KEY idx_users_student (student_id),
  KEY idx_users_filiere (filiere_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les rôles sont dans leur propre table plutôt qu'en colonne : c'est ce qui
-- permet d'interdire un cumul par une contrainte, et non par du code.
CREATE TABLE user_roles (
  user_id CHAR(36)    NOT NULL,
  role    ENUM('etudiant','enseignant','secretaire','chef','administration') NOT NULL,
  PRIMARY KEY (user_id, role),
  CONSTRAINT fk_roles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  Référentiel (§3)
-- ---------------------------------------------------------------------

-- Département : regroupe plusieurs filières (Technologique, Santé, Gestion).
-- Le chef de département voit toutes les filières de son département.
CREATE TABLE departements (
  id           CHAR(36)     NOT NULL,
  nom          VARCHAR(120) NOT NULL,
  chef_user_id CHAR(36)            DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_departements_nom (nom),
  KEY idx_departements_chef (chef_user_id),
  CONSTRAINT fk_departements_chef FOREIGN KEY (chef_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les trois départements de l'établissement (identifiants fixes).
INSERT INTO departements (id, nom) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'Technologique'),
  ('d0000000-0000-4000-8000-000000000002', 'Gestion'),
  ('d0000000-0000-4000-8000-000000000003', 'Santé');

CREATE TABLE filieres (
  id             CHAR(36)    NOT NULL,
  nom            VARCHAR(120) NOT NULL,
  -- Département de rattachement. NULL le temps de la migration des données
  -- existantes ; renseigné pour toute filière créée ensuite.
  departement_id CHAR(36)             DEFAULT NULL,
  -- §4 : la filière propose-t-elle une SECTION ANGLOPHONE (mêmes cours, noms
  -- en anglais, groupe d'étudiants distinct). Si 0, le choix n'apparaît pas.
  section_anglophone TINYINT(1)   NOT NULL DEFAULT 0,
  chef_user_id   CHAR(36)             DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_filieres_nom (nom),
  KEY idx_filieres_chef (chef_user_id),
  KEY idx_filieres_departement (departement_id),
  CONSTRAINT fk_filieres_chef FOREIGN KEY (chef_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_filieres_departement FOREIGN KEY (departement_id) REFERENCES departements (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE classes (
  id         CHAR(36)     NOT NULL,
  filiere_id CHAR(36)     NOT NULL,
  niveau     TINYINT      NOT NULL,
  nom        VARCHAR(160) NOT NULL,
  PRIMARY KEY (id),
  -- Une filière n'a qu'une classe par niveau.
  UNIQUE KEY uq_classes_filiere_niveau (filiere_id, niveau),
  CONSTRAINT fk_classes_filiere FOREIGN KEY (filiere_id) REFERENCES filieres (id),
  CONSTRAINT ck_classes_niveau CHECK (niveau BETWEEN 1 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE students (
  id           CHAR(36)    NOT NULL,
  matricule    VARCHAR(32) NOT NULL,
  nom          VARCHAR(80) NOT NULL,
  prenom       VARCHAR(80) NOT NULL,
  classe_id    CHAR(36)    NOT NULL,
  -- §4 : groupe linguistique de l'étudiant au sein de sa classe. La section
  -- anglophone suit les mêmes cours, affichés sous leur nom anglais.
  section      ENUM('francophone','anglophone') NOT NULL DEFAULT 'francophone',
  -- §13.10 : visible par l'administration et le chef de département seulement.
  parent_phone VARCHAR(20) NOT NULL,
  user_id      CHAR(36)             DEFAULT NULL,
  actif        TINYINT(1)  NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  -- §13.7 « Import qui écrase » : un matricule en double est impossible.
  UNIQUE KEY uq_students_matricule (matricule),
  KEY idx_students_classe (classe_id),
  CONSTRAINT fk_students_classe FOREIGN KEY (classe_id) REFERENCES classes (id),
  CONSTRAINT fk_students_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE teachers (
  id             CHAR(36)    NOT NULL,
  nom            VARCHAR(80) NOT NULL,
  prenom         VARCHAR(80) NOT NULL,
  telephone      VARCHAR(20) NOT NULL,
  user_id        CHAR(36)             DEFAULT NULL,
  -- Département d'appartenance de l'enseignant. NULL tant qu'il n'est pas
  -- classé par l'administration.
  departement_id CHAR(36)             DEFAULT NULL,
  actif          TINYINT(1)  NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY idx_teachers_departement (departement_id),
  CONSTRAINT fk_teachers_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_teachers_departement FOREIGN KEY (departement_id) REFERENCES departements (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE matieres (
  id        CHAR(36)     NOT NULL,
  -- Nom français (langue principale de l'application).
  nom       VARCHAR(120) NOT NULL,
  -- Nom anglais (intitulé officiel du cursus). NULL tant qu'il n'est pas saisi.
  nom_en    VARCHAR(120)          DEFAULT NULL,
  -- §3 : une matière appartient à une seule classe.
  classe_id CHAR(36)     NOT NULL,
  -- Semestre de la matière (1 ou 2). En exploitation, seul le semestre
  -- courant de l'établissement est affiché ; l'autre est masqué.
  semestre  TINYINT      NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY idx_matieres_classe (classe_id),
  CONSTRAINT fk_matieres_classe FOREIGN KEY (classe_id) REFERENCES classes (id),
  CONSTRAINT ck_matieres_semestre CHECK (semestre IN (1, 2))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE affectations (
  id         CHAR(36) NOT NULL,
  teacher_id CHAR(36) NOT NULL,
  matiere_id CHAR(36) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_affectation (teacher_id, matiere_id),
  CONSTRAINT fk_affect_teacher FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE CASCADE,
  CONSTRAINT fk_affect_matiere FOREIGN KEY (matiere_id) REFERENCES matieres (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  Taux horaires (§7)
--
--  §13.4 « Taux modifié rétroactivement » : un taux n'est jamais modifié.
--  On en crée un nouveau avec sa date d'effet, et le coût des séances passées
--  est calculé au taux en vigueur à leur date.
-- ---------------------------------------------------------------------

CREATE TABLE rates (
  id          CHAR(36) NOT NULL,
  scope       ENUM('enseignant_matiere','enseignant_niveau','niveau') NOT NULL,
  teacher_id  CHAR(36)          DEFAULT NULL,
  matiere_id  CHAR(36)          DEFAULT NULL,
  niveau      TINYINT           DEFAULT NULL,
  montant     INT      NOT NULL,
  date_effet  DATE     NOT NULL,
  created_at  DATETIME NOT NULL,
  created_by  CHAR(36)          DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_rates_resolution (scope, date_effet),
  KEY idx_rates_teacher (teacher_id),
  CONSTRAINT fk_rates_teacher FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE CASCADE,
  CONSTRAINT fk_rates_matiere FOREIGN KEY (matiere_id) REFERENCES matieres (id) ON DELETE CASCADE,
  CONSTRAINT ck_rates_montant CHECK (montant >= 0),
  -- La portée impose les colonnes renseignées : un taux « niveau » ne peut pas
  -- porter un enseignant en douce (§13.3 « Affectation de masse »).
  CONSTRAINT ck_rates_coherence CHECK (
    (scope = 'enseignant_matiere' AND teacher_id IS NOT NULL AND matiere_id IS NOT NULL AND niveau IS NULL)
    OR (scope = 'enseignant_niveau' AND teacher_id IS NOT NULL AND matiere_id IS NULL AND niveau IS NOT NULL)
    OR (scope = 'niveau' AND teacher_id IS NULL AND matiere_id IS NULL AND niveau IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  Séances (§4)
--
--  Toutes les heures sont stockées en UTC (§13.4 « Durées impossibles »).
--  `status` est calculé par le serveur, jamais écrit par un client (§13.3).
-- ---------------------------------------------------------------------

CREATE TABLE sessions (
  id                   CHAR(36)  NOT NULL,
  teacher_id           CHAR(36)  NOT NULL,
  matiere_id           CHAR(36)  NOT NULL,
  classe_id            CHAR(36)  NOT NULL,
  -- §4 : groupe linguistique visé par la séance. Fixe les étudiants concernés
  -- (seuls ceux de cette section de la classe) et la langue d'affichage de la
  -- matière (nom anglais pour la section anglophone).
  section              ENUM('francophone','anglophone') NOT NULL DEFAULT 'francophone',
  niveau               TINYINT   NOT NULL,
  day                  DATE      NOT NULL,

  arrival_at           DATETIME  NOT NULL,
  arrival_received_at  DATETIME  NOT NULL,
  arrival_by           CHAR(36)           DEFAULT NULL,
  arrival_via          ENUM('secretariat','scan') NOT NULL DEFAULT 'secretariat',

  -- Heure de fin prévue du cours, saisie par le secrétariat à l'arrivée.
  -- Les heures payées ne vont jamais au-delà : un départ postérieur crée un
  -- dépassement non payé (§4). Un départ antérieur est payé tel quel.
  -- NULL possible pour un pointage par scan (l'enseignant n'en saisit pas) :
  -- dans ce cas, pas de plafond, les heures sont payées au temps réel.
  planned_end_at       DATETIME           DEFAULT NULL,

  departure_at         DATETIME           DEFAULT NULL,
  departure_received_at DATETIME          DEFAULT NULL,
  departure_by         CHAR(36)           DEFAULT NULL,
  departure_via        ENUM('secretariat','scan','saisie_manuelle') DEFAULT NULL,
  -- Départ saisi après coup : motif obligatoire, conservé (§4).
  departure_motif      VARCHAR(300)       DEFAULT NULL,
  departure_manual_by  CHAR(36)           DEFAULT NULL,
  departure_manual_at  DATETIME           DEFAULT NULL,

  -- §13.4 : le code de séance et le jeton de scan sont des secrets. Ils ne
  -- sortent jamais vers un autre compte que celui de l'enseignant concerné.
  code                 CHAR(6)   NOT NULL,
  code_attempts        TINYINT   NOT NULL DEFAULT 0,
  scan_token           VARCHAR(64) NOT NULL,

  roll_opened_at       DATETIME           DEFAULT NULL,
  roll_closed_at       DATETIME           DEFAULT NULL,
  roll_validated_at    DATETIME           DEFAULT NULL,
  roll_received_at     DATETIME           DEFAULT NULL,
  roll_code_ok         TINYINT(1) NOT NULL DEFAULT 0,
  roll_compte_physique SMALLINT           DEFAULT NULL,
  roll_by              CHAR(36)           DEFAULT NULL,
  roll_last_edit_at    DATETIME           DEFAULT NULL,

  notifiee             TINYINT(1) NOT NULL DEFAULT 0,
  -- Séance saisie a posteriori par le secrétariat (coupure, absence…).
  -- Compte les heures de l'enseignant, mais jamais les présences étudiantes.
  saisie_anterieure    TINYINT(1) NOT NULL DEFAULT 0,
  saisie_motif         VARCHAR(300)       DEFAULT NULL,
  -- Appel fait par l'enseignant sans code (secrétaire absente). La séance
  -- compte, mais reste identifiable (§4, §13.4).
  declare_enseignant   TINYINT(1) NOT NULL DEFAULT 0,
  status               ENUM('en_cours','terminee','incomplete') NOT NULL DEFAULT 'en_cours',
  -- Fiche de paie qui couvre cette séance. NULL tant qu'elle n'est portée par
  -- aucune fiche : une séance = au plus une fiche (pas de double paiement).
  fiche_id             CHAR(36)           DEFAULT NULL,
  created_at           DATETIME  NOT NULL,

  PRIMARY KEY (id),
  KEY idx_sessions_teacher_day (teacher_id, day),
  KEY idx_sessions_classe (classe_id),
  KEY idx_sessions_day_status (day, status),
  KEY idx_sessions_fiche (fiche_id),
  CONSTRAINT fk_sessions_teacher FOREIGN KEY (teacher_id) REFERENCES teachers (id),
  CONSTRAINT fk_sessions_matiere FOREIGN KEY (matiere_id) REFERENCES matieres (id),
  CONSTRAINT fk_sessions_classe FOREIGN KEY (classe_id) REFERENCES classes (id),
  -- Le départ est toujours postérieur à l'arrivée.
  CONSTRAINT ck_sessions_ordre CHECK (departure_at IS NULL OR departure_at > arrival_at),
  -- La fin prévue, si renseignée, est postérieure à l'arrivée.
  CONSTRAINT ck_sessions_fin_prevue CHECK (planned_end_at IS NULL OR planned_end_at > arrival_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Liste cochée par l'enseignant. §9 règle 3 : elle l'emporte sur les scans.
CREATE TABLE session_presents (
  session_id CHAR(36) NOT NULL,
  student_id CHAR(36) NOT NULL,
  PRIMARY KEY (session_id, student_id),
  CONSTRAINT fk_presents_session FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
  CONSTRAINT fk_presents_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  Présences scannées (§5)
--
--  §13.4 « Double scan » : la clef primaire (session, étudiant) rend le
--  doublon impossible au niveau de la base, pas seulement du code.
-- ---------------------------------------------------------------------

CREATE TABLE attendance (
  session_id  CHAR(36) NOT NULL,
  student_id  CHAR(36) NOT NULL,
  id          CHAR(36) NOT NULL,
  status      ENUM('present','attente_seance','refuse') NOT NULL,
  source      ENUM('scan','liste') NOT NULL DEFAULT 'scan',
  at          DATETIME NOT NULL,
  received_at DATETIME NOT NULL,
  -- §13.4 « Scan pour un camarade » : deux comptes, un seul appareil.
  device_id   VARCHAR(40)       DEFAULT NULL,
  -- Jeton présenté quand la séance n'était pas encore connue (§9).
  token_presente VARCHAR(64)    DEFAULT NULL,
  raison      VARCHAR(40)       DEFAULT NULL,
  PRIMARY KEY (session_id, student_id),
  KEY idx_attendance_student (student_id),
  KEY idx_attendance_status (status),
  CONSTRAINT fk_attendance_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  Justifications (§6)
-- ---------------------------------------------------------------------

CREATE TABLE justifications (
  id              CHAR(36)     NOT NULL,
  session_id      CHAR(36)     NOT NULL,
  student_id      CHAR(36)     NOT NULL,
  filiere_id      CHAR(36)              DEFAULT NULL,
  motif           VARCHAR(500) NOT NULL,
  -- Le justificatif est rangé hors du dossier public ; on ne garde ici que son
  -- nom de fichier généré (§13.7 « Justificatif accessible à tous »).
  piece_nom       VARCHAR(120)          DEFAULT NULL,
  piece_type      VARCHAR(40)           DEFAULT NULL,
  piece_taille    INT                   DEFAULT NULL,
  state           ENUM('en_attente','acceptee','refusee') NOT NULL DEFAULT 'en_attente',
  directe         TINYINT(1)   NOT NULL DEFAULT 0,
  commentaire     VARCHAR(300)          DEFAULT NULL,
  created_at      DATETIME     NOT NULL,
  decided_at      DATETIME              DEFAULT NULL,
  decided_by      CHAR(36)              DEFAULT NULL,
  PRIMARY KEY (id),
  -- Une seule demande par absence.
  UNIQUE KEY uq_justif_session_student (session_id, student_id),
  KEY idx_justif_filiere_state (filiere_id, state),
  CONSTRAINT fk_justif_session FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
  CONSTRAINT fk_justif_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  Notifications et contacts parents
-- ---------------------------------------------------------------------

CREATE TABLE notifications (
  id         CHAR(36)     NOT NULL,
  classe_id  CHAR(36)     NOT NULL,
  session_id CHAR(36)              DEFAULT NULL,
  at         DATETIME     NOT NULL,
  -- §13.9 « Contenu sensible » : matière et nom de l'enseignant, rien de plus.
  titre      VARCHAR(160) NOT NULL,
  corps      VARCHAR(240) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_notif_classe_at (classe_id, at),
  CONSTRAINT fk_notif_classe FOREIGN KEY (classe_id) REFERENCES classes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fiche d'heures transmise par le secrétariat (GRH) à un enseignant.
-- C'est un INSTANTANÉ figé : les heures par niveau et le total sont copiés au
-- moment de l'envoi et ne changent plus, même si de nouvelles séances arrivent
-- ensuite. L'enseignant voit exactement ce qui lui a été transmis (§7).
-- Aucun montant : la fiche ne porte que des heures (§13.10).
CREATE TABLE fiches_heures (
  id             CHAR(36)     NOT NULL,
  teacher_id     CHAR(36)     NOT NULL,
  -- Libellé lisible de la période (ex. « 13/01/2026 → 12/02/2026 »).
  periode        VARCHAR(120) NOT NULL,
  -- Bornes exactes de la période de paie, saisies par le secrétariat.
  debut          DATE                  DEFAULT NULL,
  fin            DATE                  DEFAULT NULL,
  -- Cycle de vie : 'en_attente' (créée par le secrétariat) → 'payee' (validée
  -- et payée par l'administration). 'archivee' = ancienne fiche d'heures.
  statut         VARCHAR(16)  NOT NULL DEFAULT 'en_attente',
  total_heures   DECIMAL(7,2) NOT NULL,
  -- Montant BRUT figé au paiement (heures arrondies × taux). NULL tant que non
  -- payée. §13.10 : jamais renvoyé au secrétariat.
  montant        INT                   DEFAULT NULL,
  -- Impôt (§7) : taux saisi par l'administration, montant retenu, et net à
  -- payer. net = montant (brut) − impot. Figés au paiement.
  taux_impot     DECIMAL(5,2) NOT NULL DEFAULT 0,
  impot          INT                   DEFAULT NULL,
  net            INT                   DEFAULT NULL,
  -- JSON : [{ "niveau": 1, "heures": 10.5, "seances": 3 }, ...]
  par_niveau     LONGTEXT     NOT NULL,
  -- JSON détaillé par matière : [{ "niveau", "matiere", "matiereEn", "heures",
  -- "seances", "montant" }, ...]. Le cœur de la fiche de paie précise (§7).
  par_matiere    LONGTEXT              DEFAULT NULL,
  etablissement  VARCHAR(120) NOT NULL DEFAULT '',
  sent_by        CHAR(36)     NOT NULL,
  sent_by_label  VARCHAR(160) NOT NULL DEFAULT '',
  sent_at        DATETIME     NOT NULL,
  paid_at        DATETIME              DEFAULT NULL,
  paid_by        CHAR(36)              DEFAULT NULL,
  paid_by_label  VARCHAR(160) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_fiches_teacher (teacher_id, sent_at),
  KEY idx_fiches_statut (statut),
  CONSTRAINT fk_fiches_teacher FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Appel fait par l'enseignant sans secrétaire : il coche les présents, mais
-- ses heures ne sont pas encore pointées. En attente que le secrétariat le
-- pointe (lui attribue une arrivée et un départ). Une fois pointé, session_id
-- référence la séance créée (§4).
CREATE TABLE releves_declares (
  id              CHAR(36)  NOT NULL,
  teacher_id      CHAR(36)  NOT NULL,
  matiere_id      CHAR(36)  NOT NULL,
  classe_id       CHAR(36)  NOT NULL,
  -- §4 : groupe linguistique visé par l'appel déclaré (reporté sur la séance).
  section         ENUM('francophone','anglophone') NOT NULL DEFAULT 'francophone',
  niveau          TINYINT   NOT NULL,
  day             DATE      NOT NULL,
  -- JSON : identifiants des étudiants présents, cochés par l'enseignant.
  presents        LONGTEXT  NOT NULL,
  compte_physique SMALLINT           DEFAULT NULL,
  declared_at     DATETIME  NOT NULL,
  -- NULL tant que le secrétariat n'a pas pointé les heures de l'enseignant.
  session_id      CHAR(36)           DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_declares_teacher (teacher_id, day),
  KEY idx_declares_pending (session_id),
  CONSTRAINT fk_declares_teacher FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE CASCADE,
  CONSTRAINT fk_declares_matiere FOREIGN KEY (matiere_id) REFERENCES matieres (id) ON DELETE CASCADE,
  CONSTRAINT fk_declares_classe FOREIGN KEY (classe_id) REFERENCES classes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Avis destinés à un enseignant : heures ajoutées a posteriori, fiche
-- transmise… Affichés sous forme de pop-up à l'ouverture de son espace (§7).
-- Aucun montant (§13.10).
CREATE TABLE avis_enseignant (
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

CREATE TABLE parent_contacts (
  id         CHAR(36)     NOT NULL,
  student_id CHAR(36)     NOT NULL,
  at         DATETIME     NOT NULL,
  by_user_id CHAR(36)              DEFAULT NULL,
  by_label   VARCHAR(120)          DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_contacts_student_at (student_id, at),
  CONSTRAINT fk_contacts_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  Partage d'enseignants entre départements (§13.3)
--
--  Un enseignant appartient à un département. Un chef d'un AUTRE département
--  qui veut l'affecter dans ses filières doit obtenir l'autorisation du chef
--  du département propriétaire. L'autorisation vaut pour tout le département
--  demandeur, jusqu'à révocation.
-- ---------------------------------------------------------------------

CREATE TABLE autorisations_enseignant (
  id             CHAR(36)    NOT NULL,
  -- L'enseignant partagé (rattaché à son département propriétaire).
  teacher_id     CHAR(36)    NOT NULL,
  -- Le département DEMANDEUR (celui qui veut utiliser l'enseignant).
  departement_id CHAR(36)    NOT NULL,
  -- en_attente | accordee | refusee | revoquee
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

-- ---------------------------------------------------------------------
--  Historique (§11, §13.12)
--
--  §13.12 « Historique modifiable » : le compte applicatif reçoit SELECT et
--  INSERT sur cette table, jamais UPDATE ni DELETE (voir api/README.md).
--  Les deux déclencheurs ci-dessous sont une seconde barrière, au cas où les
--  privilèges seraient mal posés.
-- ---------------------------------------------------------------------

CREATE TABLE audit (
  id           CHAR(36)     NOT NULL,
  at           DATETIME     NOT NULL,
  entity       VARCHAR(40)  NOT NULL,
  entity_id    VARCHAR(64)           DEFAULT NULL,
  action       VARCHAR(60)  NOT NULL,
  author_id    CHAR(36)              DEFAULT NULL,
  author_label VARCHAR(120)          DEFAULT NULL,
  field        VARCHAR(60)           DEFAULT NULL,
  before_value TEXT                  DEFAULT NULL,
  after_value  TEXT                  DEFAULT NULL,
  note         VARCHAR(300)          DEFAULT NULL,
  flagged      TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_audit_at (at),
  KEY idx_audit_entity (entity, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER //
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Historique en ajout seul : modification interdite.';
END//
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Historique en ajout seul : suppression interdite.';
END//
DELIMITER ;

CREATE TABLE anomalies (
  id         CHAR(36)     NOT NULL,
  at         DATETIME     NOT NULL,
  kind       VARCHAR(40)  NOT NULL,
  titre      VARCHAR(160) NOT NULL,
  detail     VARCHAR(400)          DEFAULT NULL,
  subject_id CHAR(36)              DEFAULT NULL,
  session_id CHAR(36)              DEFAULT NULL,
  severity   ENUM('info','attention','grave') NOT NULL DEFAULT 'info',
  vue        TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_anomalies_at (at),
  KEY idx_anomalies_kind (kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  Plomberie de sécurité
-- ---------------------------------------------------------------------

-- §13.2 : une ligne par session ouverte. La révocation est une suppression.
CREATE TABLE auth_sessions (
  token            CHAR(64)  NOT NULL,
  user_id          CHAR(36)  NOT NULL,
  device_id        VARCHAR(40) NOT NULL,
  created_at       DATETIME  NOT NULL,
  expires_at       DATETIME  NOT NULL,
  -- §13.2 « Session hors ligne sur téléphone perdu » : au-delà, reconnexion.
  offline_deadline DATETIME  NOT NULL,
  PRIMARY KEY (token),
  KEY idx_auth_user (user_id),
  KEY idx_auth_expires (expires_at),
  CONSTRAINT fk_auth_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- §13.5 « Rejeu de synchronisation » : l'unicité porte sur le COUPLE
-- utilisateur + identifiant d'action, pas sur l'identifiant seul — sinon un
-- client pourrait bloquer la synchronisation d'un autre.
CREATE TABLE processed_ops (
  user_id CHAR(36) NOT NULL,
  op_id   CHAR(36) NOT NULL,
  type    VARCHAR(60) NOT NULL,
  at      DATETIME NOT NULL,
  result  TEXT     NOT NULL,
  PRIMARY KEY (user_id, op_id),
  KEY idx_processed_at (at),
  CONSTRAINT fk_processed_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- §13.4 « Rejeu d'un pointage » : un nonce ne sert qu'une fois.
CREATE TABLE used_tokens (
  station_id VARCHAR(40) NOT NULL,
  nonce      VARCHAR(64) NOT NULL,
  at         DATETIME    NOT NULL,
  user_id    CHAR(36)             DEFAULT NULL,
  PRIMARY KEY (station_id, nonce),
  KEY idx_used_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- §13.2 « Force brute » et §13.4 « Code de séance deviné ».
CREATE TABLE attempts (
  `key`        VARCHAR(100) NOT NULL,
  count        SMALLINT     NOT NULL DEFAULT 0,
  window_start DATETIME     NOT NULL,
  locked_until DATETIME              DEFAULT NULL,
  strikes      SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Poste de pointage du secrétariat et sa clef de signature (§13.4).
CREATE TABLE stations (
  id                CHAR(40)     NOT NULL,
  label             VARCHAR(120) NOT NULL,
  -- Clef HMAC. Elle ne sort du serveur que vers le poste du secrétariat.
  secret            VARCHAR(64)  NOT NULL,
  secretary_user_id CHAR(36)     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_stations_secretary (secretary_user_id),
  CONSTRAINT fk_stations_user FOREIGN KEY (secretary_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE settings (
  `key`  VARCHAR(60) NOT NULL,
  value  TEXT        NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

