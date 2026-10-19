-- ===================================================================
--  Migration 011 — Section anglophone (§3, §4)
--
--  À exécuter UNE SEULE FOIS sur une base déjà créée, après 001 à 010.
--  phpMyAdmin → onglet SQL. Ne réimportez PAS schema.sql.
--
--  Certaines filières (Gestion, Informatique, Santé…) ont une SECTION
--  ANGLOPHONE : les mêmes cours que la section francophone, mais un groupe
--  d'étudiants distinct, et les matières affichées sous leur nom ANGLAIS
--  (`matieres.nom_en`).
--
--  Le montage ne duplique NI les classes NI les matières :
--    - `students.section`  : à quel groupe appartient l'étudiant ;
--    - `sessions.section`  : pour quel groupe la séance a lieu (fixe la langue
--                            affichée et les étudiants concernés) ;
--    - `filieres.section_anglophone` : la filière propose-t-elle le groupe
--                            anglophone (sinon le choix n'apparaît nulle part).
--
--  Tout l'existant devient « francophone » par défaut : rien ne change pour
--  les données déjà saisies.
-- ===================================================================

ALTER TABLE students
  ADD COLUMN section ENUM('francophone','anglophone') NOT NULL DEFAULT 'francophone' AFTER classe_id;

ALTER TABLE sessions
  ADD COLUMN section ENUM('francophone','anglophone') NOT NULL DEFAULT 'francophone' AFTER classe_id;

ALTER TABLE filieres
  ADD COLUMN section_anglophone TINYINT(1) NOT NULL DEFAULT 0 AFTER departement_id;

ALTER TABLE releves_declares
  ADD COLUMN section ENUM('francophone','anglophone') NOT NULL DEFAULT 'francophone' AFTER classe_id;
