<?php
declare(strict_types=1);

/**
 * Formes attendues par chaque opération — la liste blanche du serveur.
 *
 * Transcription de `OP_SCHEMAS` et `REFERENTIEL_SHAPES` de
 * `src/server/schema.js`. Rien d'autre que ces champs ne passe : une clef en
 * trop fait échouer la requête (§13.3 « Affectation de masse »).
 *
 * Le champ `role` n'apparaît dans aucune forme hors `admin.*` : un compte ne
 * peut donc pas s'attribuer un rôle (§13.3 « Élévation de rôle »).
 */
final class Formes
{
    /** Opérations d'écriture : rôles autorisés, forme du contenu, réseau requis. */
    public static function operations(): array
    {
        return [
            /* --- secrétariat (§4) --- */
            'secretariat.arrivee' => [
                'roles' => ['secretaire'],
                'reseau' => false,
                'forme' => [
                    'teacherId' => ['type' => 'uuid', 'required' => true],
                    'matiereId' => ['type' => 'uuid', 'required' => true],
                    // Heure de fin prévue (HH:MM), au-delà de laquelle rien
                    // n'est payé. Rattachée au jour de la séance à l'écriture.
                    'finPrevue' => ['type' => 'time', 'required' => true],
                    // Niveau de la séance (1 à 8). Pré-rempli par l'interface
                    // depuis la classe de la matière, mais modifiable par le
                    // secrétariat : c'est lui qui détermine la paye (§7).
                    'niveau'    => ['type' => 'int', 'required' => true, 'min' => 1, 'max' => 6],
                    // §4 : groupe visé (francophone par défaut, anglophone si la
                    // filière en propose une).
                    'section'   => ['type' => 'enum', 'required' => false, 'values' => ['francophone', 'anglophone']],
                ],
            ],
            'secretariat.depart' => [
                'roles' => ['secretaire'],
                'reseau' => false,
                'forme' => ['sessionId' => ['type' => 'uuid', 'required' => true]],
            ],
            'secretariat.depart_manuel' => [
                'roles' => ['secretaire'],
                'reseau' => false,
                'forme' => [
                    'sessionId' => ['type' => 'uuid', 'required' => true],
                    'heure'     => ['type' => 'time', 'required' => true],
                    // §4 : motif obligatoire pour un départ saisi après coup.
                    'motif'     => ['type' => 'text', 'required' => true, 'min' => 4, 'max' => 300],
                ],
            ],
            // Correction de la matière d'une séance encore en cours. La
            // secrétaire comme l'enseignant peuvent la changer tant que le
            // relevé n'est pas validé (§4).
            'secretariat.changer_matiere' => [
                'roles' => ['secretaire'],
                'reseau' => false,
                'forme' => [
                    'sessionId' => ['type' => 'uuid', 'required' => true],
                    'matiereId' => ['type' => 'uuid', 'required' => true],
                ],
            ],
            // Transmet à l'enseignant un INSTANTANÉ figé de ses heures par
            // niveau (§7). Demande le réseau : l'instantané est calculé et
            // figé côté serveur, et l'enseignant doit être notifié.
            // Création d'une fiche de paie sur une période (§7). Le secrétariat
            // choisit l'enseignant et les bornes ; les heures sont calculées et
            // les séances de la période sont réservées (une séance = une fiche).
            'secretariat.creer_fiche' => [
                'roles' => ['secretaire'],
                'reseau' => true,
                'forme' => [
                    'teacherId' => ['type' => 'uuid', 'required' => true],
                    'debut'     => ['type' => 'date', 'required' => true],
                    'fin'       => ['type' => 'date', 'required' => true],
                ],
            ],
            // Annulation d'une fiche encore en attente : ses séances redeviennent
            // disponibles pour une autre fiche.
            'secretariat.annuler_fiche' => [
                'roles' => ['secretaire'],
                'reseau' => true,
                'forme' => [
                    'ficheId' => ['type' => 'uuid', 'required' => true],
                ],
            ],
            // Séance saisie a posteriori (coupure, secrétaire absente…). Compte
            // les heures de l'enseignant pour un jour passé ; jamais les
            // présences des étudiants. Antidatage encadré : §13.5.
            'secretariat.seance_anterieure' => [
                'roles' => ['secretaire'],
                'reseau' => false,
                'forme' => [
                    'teacherId'    => ['type' => 'uuid', 'required' => true],
                    'matiereId'    => ['type' => 'uuid', 'required' => true],
                    'niveau'       => ['type' => 'int', 'required' => true, 'min' => 1, 'max' => 6],
                    'jour'         => ['type' => 'date', 'required' => true],
                    'heureArrivee' => ['type' => 'time', 'required' => true],
                    'heureDepart'  => ['type' => 'time', 'required' => true],
                    'motif'        => ['type' => 'text', 'required' => false, 'max' => 300],
                    'section'      => ['type' => 'enum', 'required' => false, 'values' => ['francophone', 'anglophone']],
                ],
            ],

            /* --- pointage par scan, côté enseignant (§4) --- */
            'pointage.scan' => [
                'roles' => ['enseignant'],
                // Exige le réseau : la fenêtre de 60 s ne se vérifie que contre
                // l'heure du serveur (§13.4 « Photo du code QR de pointage »).
                'reseau' => true,
                'forme' => [
                    'qr'        => ['type' => 'qr', 'required' => true],
                    'matiereId' => ['type' => 'uuid', 'required' => false],
                    // Fin prévue : requise seulement à l'arrivée (premier scan),
                    // pas au départ. Le handler le vérifie.
                    'finPrevue' => ['type' => 'time', 'required' => false],
                    'section'   => ['type' => 'enum', 'required' => false, 'values' => ['francophone', 'anglophone']],
                ],
            ],

            /* --- relevé de présences (§5) --- */
            'releve.ouvrir' => [
                'roles' => ['enseignant'],
                'reseau' => false,
                'forme' => ['sessionId' => ['type' => 'uuid', 'required' => true]],
            ],
            // L'enseignant corrige la matière de SA séance en cours.
            'releve.changer_matiere' => [
                'roles' => ['enseignant'],
                'reseau' => false,
                'forme' => [
                    'sessionId' => ['type' => 'uuid', 'required' => true],
                    'matiereId' => ['type' => 'uuid', 'required' => true],
                ],
            ],
            // Appel fait par l'enseignant sans secrétaire : il coche les
            // présents, sans code ni heures. En attente de pointage (§4).
            'releve.declarer' => [
                'roles' => ['enseignant'],
                'reseau' => false,
                'forme' => [
                    'matiereId'      => ['type' => 'uuid', 'required' => true],
                    'niveau'         => ['type' => 'int', 'required' => true, 'min' => 1, 'max' => 6],
                    'section'        => ['type' => 'enum', 'required' => false, 'values' => ['francophone', 'anglophone']],
                    'presents'       => ['type' => 'uuids', 'required' => false, 'max' => 500],
                    'comptePhysique' => ['type' => 'int', 'required' => false, 'min' => 0, 'max' => 500],
                ],
            ],
            // Le secrétariat pointe les heures d'un appel déclaré : il lui
            // attribue une arrivée et un départ, ce qui crée la séance.
            'secretariat.pointer_declare' => [
                'roles' => ['secretaire'],
                'reseau' => false,
                'forme' => [
                    'declareId'    => ['type' => 'uuid', 'required' => true],
                    'heureArrivee' => ['type' => 'time', 'required' => true],
                    'heureDepart'  => ['type' => 'time', 'required' => true],
                ],
            ],

            // Chacun modifie son propre profil : prénom, nom, téléphone.
            // Demande le réseau (met à jour un identifiant éventuel).
            'compte.profil' => [
                'roles' => ['etudiant', 'enseignant', 'secretaire', 'chef', 'administration'],
                'reseau' => true,
                'forme' => [
                    'prenom'    => ['type' => 'text', 'required' => true, 'min' => 1, 'max' => 50],
                    'nom'       => ['type' => 'text', 'required' => true, 'min' => 1, 'max' => 50],
                    'telephone' => ['type' => 'phone', 'required' => false],
                ],
            ],
            'releve.fermer' => [
                'roles' => ['enseignant'],
                'reseau' => false,
                'forme' => ['sessionId' => ['type' => 'uuid', 'required' => true]],
            ],
            'releve.valider' => [
                'roles' => ['enseignant'],
                'reseau' => false,
                'forme' => [
                    'sessionId'      => ['type' => 'uuid', 'required' => false],
                    'matiereId'      => ['type' => 'uuid', 'required' => true],
                    'code'           => ['type' => 'code', 'required' => true],
                    'presents'       => ['type' => 'uuids', 'required' => false, 'max' => 500],
                    'comptePhysique' => ['type' => 'int', 'required' => false, 'min' => 0, 'max' => 500],
                ],
            ],
            'releve.corriger' => [
                'roles' => ['enseignant', 'chef'],
                'reseau' => false,
                'forme' => [
                    'sessionId' => ['type' => 'uuid', 'required' => true],
                    'presents'  => ['type' => 'uuids', 'required' => false, 'max' => 500],
                    'motif'     => ['type' => 'text', 'required' => false, 'max' => 300],
                ],
            ],

            /* --- étudiant (§5, §6) --- */
            'presence.scan' => [
                'roles' => ['etudiant'],
                'reseau' => false,
                'forme' => [
                    'qr'       => ['type' => 'qr', 'required' => true],
                    // §13.4 « Scan pour un camarade » : deux comptes, un appareil.
                    'deviceId' => ['type' => 'text', 'required' => true, 'max' => 40],
                ],
            ],
            'justification.demander' => [
                'roles' => ['etudiant'],
                'reseau' => true,
                'forme' => [
                    'sessionId' => ['type' => 'uuid', 'required' => true],
                    'motif'     => ['type' => 'text', 'required' => true, 'min' => 4, 'max' => 500],
                    'piece'     => [
                        'type' => 'object', 'required' => false, 'label' => 'justificatif',
                        'shape' => [
                            'id'   => ['type' => 'uuid', 'required' => true],
                            'name' => ['type' => 'text', 'required' => true, 'max' => 80],
                            'type' => [
                                'type' => 'enum', 'required' => true,
                                'values' => ['image/jpeg', 'image/png', 'application/pdf'],
                            ],
                            'size' => ['type' => 'int', 'required' => true, 'min' => 1, 'max' => 5242880],
                            'dataUrl' => ['type' => 'text', 'required' => true, 'max' => 7000000],
                            'exifStripped' => ['type' => 'bool', 'required' => false, 'default' => false],
                        ],
                    ],
                ],
            ],

            /* --- chef de département (§6) --- */
            'justification.decider' => [
                'roles' => ['chef'],
                'reseau' => true,
                'forme' => [
                    'justificationId' => ['type' => 'uuid', 'required' => true],
                    'decision'        => ['type' => 'enum', 'required' => true, 'values' => ['acceptee', 'refusee']],
                    'commentaire'     => ['type' => 'text', 'required' => false, 'max' => 300],
                ],
            ],
            'justification.directe' => [
                'roles' => ['chef'],
                'reseau' => true,
                'forme' => [
                    'sessionId'   => ['type' => 'uuid', 'required' => true],
                    'studentId'   => ['type' => 'uuid', 'required' => true],
                    'commentaire' => ['type' => 'text', 'required' => false, 'max' => 300],
                ],
            ],
            // Le chef affecte (ou retire) un enseignant à une matière de SA
            // filière. Une matière n'a qu'un enseignant : l'affectation
            // remplace la précédente. teacherId absent => on retire.
            'departement.affecter' => [
                'roles' => ['chef', 'administration'],
                'reseau' => true,
                'forme' => [
                    'matiereId' => ['type' => 'uuid', 'required' => true],
                    'teacherId' => ['type' => 'uuid', 'required' => false],
                ],
            ],
            // Le chef crée une matière dans une de SES filières, à un niveau.
            'departement.creer_matiere' => [
                'roles' => ['chef'],
                'reseau' => true,
                'forme' => [
                    'filiereId' => ['type' => 'uuid', 'required' => true],
                    'niveau'    => ['type' => 'int', 'required' => true, 'min' => 1, 'max' => 6],
                    'nom'       => ['type' => 'text', 'required' => true, 'min' => 2, 'max' => 120],
                    'nomEn'     => ['type' => 'text', 'required' => false, 'max' => 120],
                    'semestre'  => ['type' => 'int', 'required' => false, 'min' => 1, 'max' => 2],
                ],
            ],
            // Un chef demande à utiliser un enseignant d'un AUTRE département.
            'departement.demander_acces' => [
                'roles' => ['chef'],
                'reseau' => true,
                'forme' => [
                    'teacherId' => ['type' => 'uuid', 'required' => true],
                ],
            ],
            // Le chef propriétaire de l'enseignant accorde ou refuse la demande.
            'departement.decider_acces' => [
                'roles' => ['chef'],
                'reseau' => true,
                'forme' => [
                    'autorisationId' => ['type' => 'uuid', 'required' => true],
                    'decision'       => ['type' => 'enum', 'required' => true, 'values' => ['accordee', 'refusee']],
                ],
            ],
            // Le chef propriétaire révoque un accès déjà accordé.
            'departement.revoquer_acces' => [
                'roles' => ['chef'],
                'reseau' => true,
                'forme' => [
                    'autorisationId' => ['type' => 'uuid', 'required' => true],
                ],
            ],

            /* --- alerte aux parents (§8) --- */
            'parent.contacter' => [
                'roles' => ['chef', 'administration'],
                'reseau' => true,
                // §13.9 : seul l'identifiant de l'étudiant circule. Le numéro
                // est lu en base par le serveur.
                'forme' => ['studentId' => ['type' => 'uuid', 'required' => true]],
            ],

            /* --- administration (§3, §7) --- */
            // Paiement d'une fiche par l'administration (§7). Fige le montant
            // (taux × heures) et solde les séances de la période.
            'admin.payer_fiche' => [
                'roles' => ['administration'],
                'reseau' => true,
                'forme' => [
                    'ficheId'   => ['type' => 'uuid', 'required' => true],
                    // Taux d'impôt (%), saisi par l'administration. Absent => 0.
                    'tauxImpot' => ['type' => 'number', 'required' => false, 'min' => 0, 'max' => 100],
                ],
            ],
            'admin.referentiel' => [
                'roles' => ['administration'],
                'reseau' => true,
                'forme' => [
                    'entite' => [
                        'type' => 'enum', 'required' => true,
                        'values' => ['filiere', 'classe', 'matiere', 'enseignant', 'secretaire', 'affectation', 'etudiant'],
                    ],
                    'id'      => ['type' => 'uuid', 'required' => false],
                    // Validé contre REFERENTIEL ci-dessous, selon `entite`.
                    'valeurs' => ['type' => 'raw', 'required' => true],
                ],
            ],
            // Taux horaire simple : un taux par niveau, pour tous (§7).
            'admin.taux' => [
                'roles' => ['administration'],
                'reseau' => true,
                'forme' => [
                    'niveau'    => ['type' => 'int', 'required' => true, 'min' => 1, 'max' => 6],
                    'montant'   => ['type' => 'int', 'required' => true, 'min' => 0, 'max' => 10000000],
                    // §13.4 : date d'effet obligatoire.
                    'dateEffet' => ['type' => 'date', 'required' => true],
                ],
            ],
            'admin.parametres' => [
                'roles' => ['administration'],
                'reseau' => true,
                'forme' => [
                    'etablissement'      => ['type' => 'text', 'required' => false, 'max' => 120],
                    'monnaie'            => ['type' => 'text', 'required' => false, 'max' => 12],
                    'seuilAlerteHeures'  => ['type' => 'number', 'required' => false, 'min' => 0, 'max' => 1000],
                    'seuilAlertePeriode' => ['type' => 'enum', 'required' => false, 'values' => ['mois', 'semestre']],
                    'delaiReleveJours'   => ['type' => 'int', 'required' => false, 'min' => 1, 'max' => 60],
                    'delaiCorrectionHeures' => ['type' => 'int', 'required' => false, 'min' => 1, 'max' => 720],
                    'dureeSessionHorsLigneJours' => ['type' => 'int', 'required' => false, 'min' => 1, 'max' => 30],
                    'modeleMessage'      => ['type' => 'text', 'required' => false, 'max' => 1000],
                ],
            ],
            'admin.semestres' => [
                'roles' => ['administration'],
                'reseau' => true,
                'forme' => [
                    'semestres' => [
                        'type' => 'object', 'required' => true, 'label' => 'semestres',
                        'shape' => [
                            's1Debut' => ['type' => 'date', 'required' => true],
                            's1Fin'   => ['type' => 'date', 'required' => true],
                            's2Debut' => ['type' => 'date', 'required' => true],
                            's2Fin'   => ['type' => 'date', 'required' => true],
                        ],
                    ],
                ],
            ],
            'admin.compte' => [
                'roles' => ['administration'],
                'reseau' => true,
                'forme' => [
                    'userId'        => ['type' => 'uuid', 'required' => true],
                    'actif'         => ['type' => 'bool', 'required' => false],
                    'reinitialiser' => ['type' => 'bool', 'required' => false],
                ],
            ],
            'admin.import_etudiants' => [
                'roles' => ['administration'],
                'reseau' => true,
                'forme' => [
                    'lignes' => ['type' => 'rawList', 'required' => true, 'max' => 5000],
                ],
            ],
        ];
    }

    /** Champs acceptés par entité du référentiel — §13.3. */
    public static function referentiel(): array
    {
        return [
            'filiere' => [
                'nom'           => ['type' => 'text', 'required' => true, 'min' => 2, 'max' => 80],
                'chefUserId'    => ['type' => 'uuid', 'required' => false],
                'departementId' => ['type' => 'uuid', 'required' => false],
                // §4 : la filière propose-t-elle une section anglophone ?
                'sectionAnglophone' => ['type' => 'bool', 'required' => false],
            ],
            'classe' => [
                'filiereId' => ['type' => 'uuid', 'required' => true],
                'niveau'    => ['type' => 'int', 'required' => true, 'min' => 1, 'max' => 6],
            ],
            'matiere' => [
                // Nom français (langue principale).
                'nom'      => ['type' => 'text', 'required' => true, 'min' => 2, 'max' => 120],
                // Nom anglais (intitulé officiel du cursus). Absent => inchangé.
                'nomEn'    => ['type' => 'text', 'required' => false, 'max' => 120],
                'classeId' => ['type' => 'uuid', 'required' => true],
                // Semestre (1 ou 2). Absent => 1 à la création, inchangé en édition.
                'semestre' => ['type' => 'int', 'required' => false, 'min' => 1, 'max' => 2],
            ],
            'enseignant' => [
                'nom'           => ['type' => 'text', 'required' => true, 'min' => 2, 'max' => 60],
                'prenom'        => ['type' => 'text', 'required' => true, 'min' => 1, 'max' => 60],
                'telephone'     => ['type' => 'phone', 'required' => true],
                'departementId' => ['type' => 'uuid', 'required' => false],
            ],
            'secretaire' => [
                'nom'       => ['type' => 'text', 'required' => true, 'min' => 2, 'max' => 60],
                'prenom'    => ['type' => 'text', 'required' => true, 'min' => 1, 'max' => 60],
                'telephone' => ['type' => 'phone', 'required' => true],
            ],
            'affectation' => [
                'teacherId' => ['type' => 'uuid', 'required' => true],
                'matiereId' => ['type' => 'uuid', 'required' => true],
            ],
            'etudiant' => [
                'matricule'   => ['type' => 'matricule', 'required' => true],
                'nom'         => ['type' => 'text', 'required' => true, 'min' => 2, 'max' => 60],
                'prenom'      => ['type' => 'text', 'required' => true, 'min' => 1, 'max' => 60],
                'classeId'    => ['type' => 'uuid', 'required' => true],
                // §4 : groupe linguistique de l'étudiant.
                'section'     => ['type' => 'enum', 'required' => false, 'values' => ['francophone', 'anglophone']],
                // §13.9 : modifiable par l'administration seulement.
                'parentPhone' => ['type' => 'phone', 'required' => false],
            ],
        ];
    }

    /**
     * Une ligne d'import d'étudiants.
     *
     * Le numéro du parent est facultatif : les listes de l'établissement sont
     * incomplètes, et refuser ces lignes empêcherait les étudiants concernés
     * de se connecter. Ils sont créés, et l'écran « Étudiants en alerte »
     * porte la conséquence — sans numéro, aucune alerte n'est possible.
     */
    public static function ligneImport(): array
    {
        return [
            'matricule' => ['type' => 'matricule', 'required' => true],
            'nom'       => ['type' => 'text', 'required' => true, 'min' => 2, 'max' => 60],
            'prenom'    => ['type' => 'text', 'required' => true, 'min' => 1, 'max' => 60],
            'filiere'   => ['type' => 'text', 'required' => true, 'min' => 2, 'max' => 80],
            'niveau'    => ['type' => 'text', 'required' => true, 'max' => 20],
            // §4 : « anglophone » / « francophone » (vide = francophone).
            'section'   => ['type' => 'text', 'required' => false, 'max' => 20],
            'parent'    => ['type' => 'phone', 'required' => false],
        ];
    }

    /** Connexion. Aucun champ `role` : il ne s'attribue pas (§13.3). */
    public static function connexion(): array
    {
        return [
            'identifiant' => ['type' => 'text', 'required' => true, 'min' => 3, 'max' => 40],
            'motDePasse'  => ['type' => 'text', 'required' => true, 'min' => 1, 'max' => 128],
            'deviceId'    => ['type' => 'text', 'required' => true, 'max' => 40],
        ];
    }

    /** §13.2 : le mot de passe actuel est exigé pour en changer. */
    public static function changementMotDePasse(): array
    {
        return [
            'actuel'  => ['type' => 'text', 'required' => true, 'min' => 1, 'max' => 128],
            'nouveau' => ['type' => 'text', 'required' => true, 'min' => 8, 'max' => 128],
        ];
    }
}
