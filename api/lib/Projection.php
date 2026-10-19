<?php
declare(strict_types=1);

/**
 * Ce que chaque rôle reçoit, champ par champ.
 *
 *  §13.8 « Données de trop dans les réponses » — le serveur ne renvoie que les
 *         champs utiles au rôle. Rien n'est « masqué à l'écran ».
 *  §13.3 « Fuite des taux et des montants »    — les montants ne sont joints
 *         que pour l'administration.
 *  §13.10 « Numéros des parents exposés »      — jamais dans une projection
 *         enseignant, secrétaire ou étudiant.
 *  §13.10 « Liste de classe exposée »          — un étudiant ne reçoit que ses
 *         propres données.
 *  §13.5 « Données sensibles sur l'appareil »  — cette classe décide de ce qui
 *         est écrit dans IndexedDB, donc de ce qu'un téléphone perdu révèle.
 */
final class Projection
{
    /** Projection complète pour le porteur du jeton. */
    public static function pour(Contexte $ctx): array
    {
        $refs = Rapports::referentiel();
        $parametres = $refs['parametres'];

        $sortie = [
            'moi'        => self::identite($ctx),
            'parametres' => self::parametresPublics($parametres),
            'recuA'      => Outils::versIso(Outils::maintenant()),
        ];

        // Chaque bloc n'est calculé que si le rôle est présent : un enseignant
        // ne déclenche même pas le calcul des montants.
        if ($ctx->aLeRole('etudiant')) {
            $sortie['etudiant'] = self::etudiant($ctx, $refs);
        }
        if ($ctx->aLeRole('enseignant')) {
            $sortie['enseignant'] = self::enseignant($ctx, $refs);
        }
        if ($ctx->aLeRole('secretaire')) {
            $sortie['secretariat'] = self::secretariat($ctx, $refs);
        }
        if ($ctx->aLeRole('chef')) {
            $sortie['departement'] = self::departement($ctx, $refs);
        }
        if ($ctx->aLeRole('administration')) {
            $sortie['administration'] = self::administration($ctx, $refs);
        }

        return $sortie;
    }

    /** Identité, sans condensé de mot de passe ni champ interne. */
    private static function identite(Contexte $ctx): array
    {
        return [
            'id'                  => $ctx->userId,
            'nom'                 => $ctx->user['nom'] ?? '',
            'prenom'              => $ctx->user['prenom'] ?? '',
            'telephone'           => $ctx->user['telephone'] ?? '',
            'label'               => $ctx->label,
            'login'               => $ctx->user['login'],
            'roles'               => $ctx->roles,
            'mustChangePassword'  => $ctx->doitChangerMotDePasse,
        ];
    }

    /** Réglages visibles par tous les rôles connectés : rien de sensible. */
    private static function parametresPublics(array $p): array
    {
        return [
            'etablissement'         => $p['etablissement'],
            'delaiReleveJours'      => (int) $p['delaiReleveJours'],
            'delaiCorrectionHeures' => (int) $p['delaiCorrectionHeures'],
            'semestres'             => Parametres::semestres($p),
        ];
    }

    /* ----------------------------------------------------------------- *
     *  Étudiant
     * ----------------------------------------------------------------- */

    private static function etudiant(Contexte $ctx, array $refs): ?array
    {
        if ($ctx->studentId === null) {
            return null;
        }
        $etudiant = $refs['index']['student'][$ctx->studentId] ?? null;
        if ($etudiant === null) {
            return null;
        }
        $classe = $refs['index']['classe'][$etudiant['classe_id']] ?? null;

        $totaux  = Rapports::totauxAbsences($ctx->studentId, null, $refs);
        $donnees = Rapports::absencesEtudiant($ctx->studentId, $refs);

        $notifications = Db::tout(
            'SELECT * FROM notifications WHERE classe_id = ? ORDER BY at DESC LIMIT 30',
            [$etudiant['classe_id']]
        );

        // La séance ouverte de sa classe, pour savoir s'il peut scanner.
        $ouverte = Db::un(
            'SELECT id, matiere_id FROM sessions
             WHERE classe_id = ? AND roll_opened_at IS NOT NULL AND roll_closed_at IS NULL
             ORDER BY roll_opened_at DESC LIMIT 1',
            [$etudiant['classe_id']]
        );

        return [
            // Ses propres données, et rien de sa classe (§13.10).
            'profil' => [
                'matricule' => $etudiant['matricule'],
                'nom'       => $etudiant['prenom'] . ' ' . $etudiant['nom'],
                'classe'    => Rapports::libelleClasse($classe, $refs),
                'section'      => $etudiant['section'] ?? 'francophone',
                'sectionLabel' => Rapports::libelleSection($etudiant['section'] ?? 'francophone'),
                // Pas de parentPhone : l'étudiant ne le voit pas.
            ],
            'totaux' => [
                'semestre'      => $totaux['semestre'],
                'periodeLabel'  => $totaux['periodeLabel'],
                'nonJustifiees' => $totaux['nonJustifiees'],
                'justifiees'    => $totaux['justifiees'],
                'enAttente'     => $totaux['enAttente'],
                'parMatiere'    => $totaux['parMatiere'],
            ],
            'absences' => array_map(fn($a) => [
                'sessionId'     => $a['sessionId'],
                'arrivalAt'     => $a['arrivalAt'],
                'matiere'       => $a['matiere'],
                'heures'        => $a['heures'],
                'etat'          => $a['etat'],
                'justification' => $a['justification'],
            ], $totaux['absences']),
            'seances' => array_map(fn($s) => [
                'sessionId'    => $s['sessionId'],
                'arrivalAt'    => $s['arrivalAt'],
                'matiere'      => $s['matiere'],
                'statutSeance' => $s['statutSeance'],
                'presence'     => $s['presence'],
                'heures'       => $s['heures'],
            ], $donnees['seances']),
            'notifications' => array_map(fn($n) => [
                'id'        => $n['id'],
                'at'        => Outils::versIso($n['at']),
                'titre'     => $n['titre'],
                'corps'     => $n['corps'],
                'sessionId' => $n['session_id'],
            ], $notifications),
            'seanceOuverte' => $ouverte === null
                ? null
                : ['id' => $ouverte['id'], 'matiereId' => $ouverte['matiere_id']],
        ];
    }

    /* ----------------------------------------------------------------- *
     *  Enseignant — jamais de taux, de montant ni de numéro de parent
     * ----------------------------------------------------------------- */

    private static function enseignant(Contexte $ctx, array $refs): ?array
    {
        if ($ctx->teacherId === null) {
            return null;
        }

        $matieres = [];
        foreach ($refs['affectations'] as $a) {
            if ($a['teacher_id'] !== $ctx->teacherId) {
                continue;
            }
            $m = $refs['index']['matiere'][$a['matiere_id']] ?? null;
            if ($m === null) {
                continue;
            }
            $classe = $refs['index']['classe'][$m['classe_id']] ?? null;
            $matieres[] = [
                'id'       => $m['id'],
                'nom'      => $m['nom'],
                'nomEn'    => $m['nom_en'] ?? null,
                'classeId' => $m['classe_id'],
                'classe'   => Rapports::libelleClasse($classe, $refs),
                'niveau'   => $classe === null ? null : (int) $classe['niveau'],
            ];
        }

        // Listes d'étudiants de SES classes, pour cocher le relevé hors ligne
        // (§9). Matricule et nom seulement : pas de numéro de parent (§13.10).
        $classeIds = array_values(array_unique(array_column($matieres, 'classeId')));
        $listes = [];
        foreach ($classeIds as $classeId) {
            $eleves = array_values(array_filter(
                $refs['students'],
                fn($s) => $s['classe_id'] === $classeId && (int) $s['actif'] === 1
            ));
            usort($eleves, fn($a, $b) => strcmp($a['nom'] . $a['prenom'], $b['nom'] . $b['prenom']));

            $listes[] = [
                'classeId'  => $classeId,
                'classe'    => Rapports::libelleClasse($refs['index']['classe'][$classeId] ?? null, $refs),
                // §4 : chaque étudiant porte sa section ; l'enseignant ne coche
                // que le groupe de la séance ouverte.
                'etudiants' => array_map(fn($s) => [
                    'id'        => $s['id'],
                    'matricule' => $s['matricule'],
                    'nom'       => $s['prenom'] . ' ' . $s['nom'],
                    'section'   => $s['section'] ?? 'francophone',
                ], $eleves),
            ];
        }

        $heures = Rapports::heuresEnseignant($ctx->teacherId, $refs);
        $jours  = (int) $refs['parametres']['delaiReleveJours'];
        $limite = gmdate('Y-m-d H:i:s', time() - $jours * 86400);

        // Séance ouverte : l'enseignant reçoit le code de séance et le jeton de
        // scan, car ce sont SES secrets de séance.
        $ouverte = Db::un(
            'SELECT * FROM sessions WHERE teacher_id = ? AND departure_at IS NULL LIMIT 1',
            [$ctx->teacherId]
        );

        $aRelever = Db::tout(
            'SELECT * FROM sessions
             WHERE teacher_id = ? AND roll_code_ok = 0 AND arrival_at > ?
             ORDER BY arrival_at DESC',
            [$ctx->teacherId, $limite]
        );

        $scansParSeance = [];
        foreach (array_slice($heures['seances'], 0, 60) as $l) {
            $scansParSeance[$l['id']] = array_column(
                Db::tout(
                    "SELECT student_id FROM attendance WHERE session_id = ? AND status = 'present'",
                    [$l['id']]
                ),
                'student_id'
            );
        }

        $presentsCoches = function (string $sessionId): array {
            return array_column(
                Db::tout('SELECT student_id FROM session_presents WHERE session_id = ?', [$sessionId]),
                'student_id'
            );
        };

        // Fiches de paie déjà PAYÉES — l'historique de paiement de l'enseignant.
        $fichesPayees = Db::tout(
            "SELECT * FROM fiches_heures WHERE teacher_id = ? AND statut = 'payee'"
            . " ORDER BY COALESCE(paid_at, sent_at) DESC LIMIT 100",
            [$ctx->teacherId]
        );
        $idsPayees = array_column($fichesPayees, 'id');
        // Heures terminées pas encore payées (hors fiches déjà payées).
        $heuresNonPayees = 0.0;
        foreach (Db::tout(
            "SELECT * FROM sessions WHERE teacher_id = ? AND status = 'terminee'",
            [$ctx->teacherId]
        ) as $sNP) {
            if ($sNP['fiche_id'] !== null && in_array($sNP['fiche_id'], $idsPayees, true)) {
                continue;
            }
            $heuresNonPayees += Regles::heuresPayees($sNP);
        }

        return [
            'matieres' => $matieres,
            'listes'   => $listes,
            'seanceEnCours' => $ouverte === null ? null : array_merge(
                Rapports::decorer($ouverte, $refs),
                [
                    'code'           => $ouverte['code'],
                    'scanToken'      => $ouverte['scan_token'],
                    'presentsCoches' => $presentsCoches($ouverte['id']),
                ]
            ),
            'seancesARelever' => array_map(
                fn($s) => array_merge(
                    Rapports::decorer($s, $refs),
                    [
                        'presentsCoches' => $presentsCoches($s['id']),
                        'codeOk'         => (int) $s['roll_code_ok'] === 1,
                    ]
                ),
                $aRelever
            ),
            'scansParSeance' => $scansParSeance,
            'heures' => [
                // Aucun montant ici. Volontairement.
                'seances'           => $heures['seances'],
                'totalHeures'       => $heures['totalHeures'],
                'totalEcartNonPaye' => $heures['totalEcartNonPaye'],
                'parMatiere'        => $heures['parMatiere'],
                'parJour'           => $heures['parJour'],
                'parMois'           => $heures['parMois'],
                'parSemestre'       => $heures['parSemestre'],
                'incompletes'       => $heures['incompletes'],
            ],
            // Historique de paiement : les fiches de paie déjà réglées (§7).
            // L'enseignant voit ici son montant — c'est le sien (§13.10).
            'fiches' => array_map(fn($f) => [
                'id'            => $f['id'],
                'periode'       => $f['periode'],
                'debut'         => $f['debut'],
                'fin'           => $f['fin'],
                'totalHeures'   => (float) $f['total_heures'],
                'heuresPayees'  => (int) floor((float) $f['total_heures']),
                'montant'       => $f['montant'] === null ? null : (int) $f['montant'],
                'tauxImpot'     => (float) $f['taux_impot'],
                'impot'         => $f['impot'] === null ? null : (int) $f['impot'],
                'net'           => $f['net'] === null ? null : (int) $f['net'],
                'parNiveau'     => json_decode($f['par_niveau'], true) ?: [],
                'parMatiere'    => json_decode((string) ($f['par_matiere'] ?? ''), true) ?: [],
                'etablissement' => $f['etablissement'],
                'payeePar'      => $f['paid_by_label'],
                'payeeLe'       => Outils::versIso($f['paid_at']),
            ], $fichesPayees),
            'heuresNonPayees' => round($heuresNonPayees, 2),
            // Avis affichés en pop-up à l'ouverture de l'espace enseignant.
            'avis' => array_map(fn($a) => [
                'id'    => $a['id'],
                'type'  => $a['type'],
                'titre' => $a['titre'],
                'corps' => $a['corps'],
                'at'    => Outils::versIso($a['at']),
            ], Db::tout(
                'SELECT * FROM avis_enseignant WHERE teacher_id = ? ORDER BY at DESC LIMIT 20',
                [$ctx->teacherId]
            )),
            // Appels déclarés par l'enseignant (sans secrétaire), pour qu'il
            // voie lesquels restent en attente de pointage.
            'relevesDeclares' => array_map(function ($d) use ($refs) {
                $m = $refs['index']['matiere'][$d['matiere_id']] ?? null;
                $section = $d['section'] ?? 'francophone';
                return [
                    'id'       => $d['id'],
                    'matiere'  => Rapports::nomMatiere($m, $section),
                    'matiereEn' => $m['nom_en'] ?? null,
                    'section'  => $section,
                    'sectionLabel' => Rapports::libelleSection($section),
                    'niveau'   => (int) $d['niveau'],
                    'day'      => $d['day'],
                    'presents' => count(json_decode($d['presents'], true) ?: []),
                    'pointe'   => $d['session_id'] !== null,
                ];
            }, Db::tout(
                'SELECT * FROM releves_declares WHERE teacher_id = ? ORDER BY day DESC LIMIT 30',
                [$ctx->teacherId]
            )),
        ];
    }

    /* ----------------------------------------------------------------- *
     *  Secrétariat — pas de montant, pas de numéro de parent
     * ----------------------------------------------------------------- */

    private static function secretariat(Contexte $ctx, array $refs): array
    {
        $station = Db::un('SELECT * FROM stations WHERE secretary_user_id = ?', [$ctx->userId]);

        $enseignants = [];
        foreach ($refs['teachers'] as $t) {
            if ((int) $t['actif'] !== 1) {
                continue;
            }
            $sesMatieres = [];
            foreach ($refs['affectations'] as $a) {
                if ($a['teacher_id'] !== $t['id']) {
                    continue;
                }
                $m = $refs['index']['matiere'][$a['matiere_id']] ?? null;
                if ($m === null) {
                    continue;
                }
                $classeM = $refs['index']['classe'][$m['classe_id']] ?? null;
                $filiereM = $classeM !== null ? ($refs['index']['filiere'][$classeM['filiere_id']] ?? null) : null;
                $sesMatieres[] = [
                    'id'     => $m['id'],
                    'nom'    => $m['nom'],
                    'nomEn'  => $m['nom_en'] ?? null,
                    'classe' => Rapports::libelleClasse($classeM, $refs),
                    // Niveau de la classe, pour pré-remplir le choix au pointage.
                    'niveau' => $classeM !== null ? (int) $classeM['niveau'] : null,
                    // §4 : la filière propose-t-elle une section anglophone ?
                    'sectionAnglophone' => (int) ($filiereM['section_anglophone'] ?? 0) === 1,
                ];
            }
            $dep = Rapports::departementDeTeacher($t, $refs);
            $enseignants[] = [
                'id'            => $t['id'],
                'nom'           => $t['prenom'] . ' ' . $t['nom'],
                'telephone'     => $t['telephone'],
                'matieres'      => $sesMatieres,
                'departementId' => $dep['id'] ?? null,
                'departement'   => $dep['nom'] ?? null,
            ];
        }
        usort($enseignants, fn($a, $b) => strcmp($a['nom'], $b['nom']));

        // Toutes les matières, avec leur département : au pointage, le secrétariat
        // cherche parmi les matières du département de l'enseignant (§4).
        $matieresPointage = [];
        foreach ($refs['matieres'] as $m) {
            $classe = $refs['index']['classe'][$m['classe_id']] ?? null;
            if ($classe === null) {
                continue;
            }
            $filiere = $refs['index']['filiere'][$classe['filiere_id']] ?? null;
            $matieresPointage[] = [
                'id'            => $m['id'],
                'nom'           => $m['nom'],
                'nomEn'         => $m['nom_en'] ?? null,
                'niveau'        => (int) $classe['niveau'],
                'classe'        => Rapports::libelleClasse($classe, $refs),
                'departementId' => $filiere['departement_id'] ?? null,
                // §4 : la filière propose-t-elle une section anglophone ?
                'sectionAnglophone' => (int) ($filiere['section_anglophone'] ?? 0) === 1,
            ];
        }
        usort($matieresPointage, fn($a, $b) => [$a['niveau'], $a['nom']] <=> [$b['niveau'], $b['nom']]);

        $jour = gmdate('Y-m-d');
        $decorer = function (array $lignes) use ($refs): array {
            return array_map(
                // La secrétaire remet le code de séance : elle doit le voir (§4).
                fn($s) => array_merge(Rapports::decorer($s, $refs), ['code' => $s['code']]),
                $lignes
            );
        };

        return [
            'station' => $station === null ? null : [
                'id'     => $station['id'],
                'label'  => $station['label'],
                // Clef de signature du QR de pointage : délivrée au poste du
                // secrétariat, et à lui seul (§13.4).
                'secret' => $station['secret'],
            ],
            'enseignants'   => $enseignants,
            'matieresPointage' => $matieresPointage,
            'seancesDuJour' => $decorer(
                Db::tout('SELECT * FROM sessions WHERE day = ? ORDER BY arrival_at DESC', [$jour])
            ),
            'incompletesAnterieures' => $decorer(
                Db::tout(
                    "SELECT * FROM sessions WHERE day <> ? AND status = 'incomplete'
                     ORDER BY arrival_at DESC LIMIT 40",
                    [$jour]
                )
            ),
            // Appels déclarés par les enseignants (sans secrétaire) et pas
            // encore pointés : la secrétaire doit leur attribuer des heures.
            'declaresEnAttente' => array_map(function ($d) use ($refs) {
                $m = $refs['index']['matiere'][$d['matiere_id']] ?? null;
                $t = $refs['index']['teacher'][$d['teacher_id']] ?? null;
                return [
                    'id'        => $d['id'],
                    'teacherId' => $d['teacher_id'],
                    'enseignant' => $t ? $t['prenom'] . ' ' . $t['nom'] : '—',
                    'matiere'   => $m['nom'] ?? '—',
                    'matiereEn' => $m['nom_en'] ?? null,
                    'niveau'    => (int) $d['niveau'],
                    'day'       => $d['day'],
                    'presents'  => count(json_decode($d['presents'], true) ?: []),
                    'declareLe' => Outils::versIso($d['declared_at']),
                ];
            }, Db::tout(
                'SELECT * FROM releves_declares WHERE session_id IS NULL ORDER BY day DESC LIMIT 100'
            )),
            // Fiches de paie créées (en attente / payées). Sans montant (§13.10).
            'fiches' => array_map(function ($f) use ($refs) {
                $t = $refs['index']['teacher'][$f['teacher_id']] ?? null;
                return [
                    'id'          => $f['id'],
                    'teacherId'   => $f['teacher_id'],
                    'enseignant'  => $t ? $t['prenom'] . ' ' . $t['nom'] : '—',
                    'periode'     => $f['periode'],
                    'debut'       => $f['debut'],
                    'fin'         => $f['fin'],
                    'statut'      => $f['statut'],
                    'totalHeures' => (float) $f['total_heures'],
                    'heuresPayees' => (int) floor((float) $f['total_heures']),
                    'creeeLe'     => Outils::versIso($f['sent_at']),
                ];
            }, Db::tout(
                "SELECT * FROM fiches_heures WHERE statut IN ('en_attente','payee')"
                . " ORDER BY sent_at DESC LIMIT 50"
            )),
            // Nom de l'établissement, pour l'en-tête de la fiche PDF (§7).
            'parametres' => ['etablissement' => $refs['parametres']['etablissement'] ?? null],
        ];
    }

    /* ----------------------------------------------------------------- *
     *  Chef de département — sa filière, sans aucun montant (§14)
     * ----------------------------------------------------------------- */

    private static function departement(Contexte $ctx, array $refs): array
    {
        $filiereIds = Garde::filieresDuChef($ctx);
        if (count($filiereIds) === 0) {
            return [
                'filieres' => [], 'enseignants' => [], 'enseignantsAutres' => [],
                'demandesRecues' => [], 'pretsAccordes' => [], 'departement' => null, 'semestreCourant' => null,
                'justifications' => [], 'presences' => [], 'alertes' => null,
            ];
        }

        // §3 : le semestre courant se déduit des dates saisies par
        // l'administration. Null tant que les dates ne sont pas réglées : on
        // n'en masque alors aucun.
        $semestres = Parametres::semestres($refs['parametres']);
        $sem = Parametres::semestreDe(date('Y-m-d'), $semestres);
        $semestreCourant = $sem === null ? null : ($sem['id'] === 's2' ? 2 : 1);

        // Enseignant affecté à chaque matière (une matière = un enseignant).
        $enseignantParMatiere = [];
        foreach ($refs['affectations'] as $a) {
            $enseignantParMatiere[$a['matiere_id']] = $a['teacher_id'];
        }

        // Classes groupées par filière du chef.
        $classesParFiliere = [];
        foreach ($refs['classes'] as $c) {
            if (in_array($c['filiere_id'], $filiereIds, true)) {
                $classesParFiliere[$c['filiere_id']][] = $c;
            }
        }
        // Matières groupées par classe.
        $matieresParClasse = [];
        foreach ($refs['matieres'] as $m) {
            $matieresParClasse[$m['classe_id']][] = $m;
        }

        $filieres = [];
        $deptIds  = [];
        foreach ($filiereIds as $fid) {
            $f = $refs['index']['filiere'][$fid] ?? null;
            if ($f === null) {
                continue;
            }
            if (!empty($f['departement_id'])) {
                $deptIds[$f['departement_id']] = true;
            }

            $classes = $classesParFiliere[$fid] ?? [];
            usort($classes, fn($a, $b) => (int) $a['niveau'] <=> (int) $b['niveau']);

            $classesOut = [];
            foreach ($classes as $c) {
                $matieres = [];
                foreach ($matieresParClasse[$c['id']] ?? [] as $m) {
                    $semM = (int) ($m['semestre'] ?? 1);
                    // Hors semestre courant : la matière est masquée (§3).
                    if ($semestreCourant !== null && $semM !== $semestreCourant) {
                        continue;
                    }
                    $tid = $enseignantParMatiere[$m['id']] ?? null;
                    $t   = $tid === null ? null : ($refs['index']['teacher'][$tid] ?? null);
                    $matieres[] = [
                        'id'         => $m['id'],
                        'nom'        => $m['nom'],
                        'nomEn'      => $m['nom_en'] ?? null,
                        'semestre'   => $semM,
                        'teacherId'  => $tid,
                        'enseignant' => $t === null ? null : trim($t['prenom'] . ' ' . $t['nom']),
                    ];
                }
                usort($matieres, fn($a, $b) => strcmp($a['nom'], $b['nom']));
                $classesOut[] = [
                    'id'       => $c['id'],
                    'niveau'   => (int) $c['niveau'],
                    'nom'      => $c['nom'],
                    'matieres' => $matieres,
                ];
            }

            $filieres[] = [
                'id' => $fid,
                'nom' => $f['nom'],
                'sectionAnglophone' => (int) ($f['section_anglophone'] ?? 0) === 1,
                'classes' => $classesOut,
            ];
        }

        // Département que ce chef dirige + autorisations de partage (§13.3).
        $monDep = Garde::departementDuChef($ctx);
        $autorPourMonDep = []; // teacher_id => ligne (demandes faites PAR mon dép.)
        if ($monDep !== null) {
            foreach (Db::tout(
                'SELECT * FROM autorisations_enseignant WHERE departement_id = ?',
                [$monDep]
            ) as $a) {
                $autorPourMonDep[$a['teacher_id']] = $a;
            }
        }
        $idsAutorises = [];
        foreach ($autorPourMonDep as $tid => $a) {
            if ($a['statut'] === 'accordee') {
                $idsAutorises[$tid] = true;
            }
        }
        $nomDep = fn($id) => $id === null ? null : ($refs['index']['departement'][$id]['nom'] ?? null);

        // Enseignants affectables : ceux de son département + ceux autorisés.
        $enseignants = [];
        foreach ($refs['teachers'] as $t) {
            if ((int) ($t['actif'] ?? 1) !== 1) {
                continue;
            }
            $dansSonDep = !empty($t['departement_id']) && isset($deptIds[$t['departement_id']]);
            $autorise   = isset($idsAutorises[$t['id']]);
            if (!$dansSonDep && !$autorise) {
                continue;
            }
            $enseignants[] = [
                'id'          => $t['id'],
                'nom'         => trim($t['prenom'] . ' ' . $t['nom']),
                'departement' => $nomDep($t['departement_id'] ?? null),
                'externe'     => !$dansSonDep,
            ];
        }
        usort($enseignants, fn($a, $b) => strcmp($a['nom'], $b['nom']));

        // Enseignants des AUTRES départements, pour demander l'accès.
        $enseignantsAutres = [];
        foreach ($refs['teachers'] as $t) {
            if ((int) ($t['actif'] ?? 1) !== 1) {
                continue;
            }
            if (empty($t['departement_id']) || isset($deptIds[$t['departement_id']])) {
                continue;
            }
            $a = $autorPourMonDep[$t['id']] ?? null;
            $enseignantsAutres[] = [
                'id'             => $t['id'],
                'nom'            => trim($t['prenom'] . ' ' . $t['nom']),
                'departement'    => $nomDep($t['departement_id']),
                'statut'         => $a['statut'] ?? 'aucune',
                'autorisationId' => $a['id'] ?? null,
            ];
        }
        usort($enseignantsAutres, fn($a, $b) => [$a['departement'], $a['nom']] <=> [$b['departement'], $b['nom']]);

        // Demandes d'accès reçues : enseignants de MON département demandés par
        // d'autres chefs, en attente de ma décision.
        $demandesRecues = [];
        if ($monDep !== null) {
            foreach (Db::tout(
                "SELECT a.* FROM autorisations_enseignant a
                   JOIN teachers t ON t.id = a.teacher_id
                  WHERE t.departement_id = ? AND a.statut = 'en_attente'
                  ORDER BY a.demande_at DESC",
                [$monDep]
            ) as $a) {
                $t = $refs['index']['teacher'][$a['teacher_id']] ?? null;
                $demandesRecues[] = [
                    'id'                   => $a['id'],
                    'teacherId'            => $a['teacher_id'],
                    'enseignant'           => $t ? trim($t['prenom'] . ' ' . $t['nom']) : '—',
                    'departementDemandeur' => $nomDep($a['departement_id']),
                    'demandeLe'            => Outils::versIso($a['demande_at']),
                ];
            }
        }

        // Prêts accordés : enseignants de MON département utilisés par d'autres
        // (que je peux révoquer).
        $pretsAccordes = [];
        if ($monDep !== null) {
            foreach (Db::tout(
                "SELECT a.* FROM autorisations_enseignant a
                   JOIN teachers t ON t.id = a.teacher_id
                  WHERE t.departement_id = ? AND a.statut = 'accordee'
                  ORDER BY a.decide_at DESC",
                [$monDep]
            ) as $a) {
                $t = $refs['index']['teacher'][$a['teacher_id']] ?? null;
                $pretsAccordes[] = [
                    'id'                   => $a['id'],
                    'teacherId'            => $a['teacher_id'],
                    'enseignant'           => $t ? trim($t['prenom'] . ' ' . $t['nom']) : '—',
                    'departementDemandeur' => $nomDep($a['departement_id']),
                ];
            }
        }

        return [
            'filieres'          => $filieres,
            'enseignants'       => $enseignants,
            'enseignantsAutres' => $enseignantsAutres,
            'demandesRecues'    => $demandesRecues,
            'pretsAccordes'     => $pretsAccordes,
            'departement'       => $nomDep($monDep),
            'semestreCourant'   => $semestreCourant,
            'justifications'    => Rapports::fileJustifications($filiereIds, $refs),
            'presences'         => Rapports::presencesFiliere($filiereIds, $refs),
            // §13.10 : le chef de département a le droit de voir le numéro du
            // parent, pour pouvoir le contacter.
            'alertes'           => Rapports::alertes($filiereIds, $refs),
        ];
    }

    /* ----------------------------------------------------------------- *
     *  Administration — seul rôle à recevoir les taux et les montants
     * ----------------------------------------------------------------- */

    private static function administration(Contexte $ctx, array $refs): ?array
    {
        // Ceinture et bretelles : la porte des montants est ici.
        if (!Garde::peutVoirLesMontants($ctx)) {
            return null;
        }
        $parametres = $refs['parametres'];

        $jourB    = Rapports::bornes('jour');
        $semaineB = Rapports::bornes('semaine');
        $moisB    = Rapports::bornes('mois');

        $jour    = Rapports::rapportAdmin($jourB['du'], $jourB['au'], true, $refs);
        $semaine = Rapports::rapportAdmin($semaineB['du'], $semaineB['au'], true, $refs);
        $mois    = Rapports::rapportAdmin($moisB['du'], $moisB['au'], true, $refs);
        $tout    = Rapports::rapportAdmin(null, null, true, $refs);

        $comptes = [];
        foreach (Db::tout('SELECT * FROM users ORDER BY nom, prenom') as $u) {
            $comptes[] = [
                'id'                 => $u['id'],
                'login'              => $u['login'],
                'nom'                => trim($u['prenom'] . ' ' . $u['nom']),
                'roles'              => Identite::roles($u['id']),
                'actif'              => (int) $u['actif'] === 1,
                'mustChangePassword' => (int) $u['must_change_password'] === 1,
                'createdAt'          => Outils::versIso($u['created_at']),
                // Jamais de password_hash dans une projection.
            ];
        }
        $parId = array_column($comptes, null, 'id');

        // Système simple : un taux horaire par niveau, pour tous les enseignants.
        // On expose le taux COURANT de chaque niveau existant.
        $tauxN = Taux::tous();
        $jourRefTaux = date('Y-m-d');
        $niveauxExistants = [];
        foreach ($refs['classes'] as $c) {
            $niveauxExistants[(int) $c['niveau']] = true;
        }
        ksort($niveauxExistants);
        $taux = [];
        foreach (array_keys($niveauxExistants) as $n) {
            $r = Taux::resoudre($tauxN, null, null, $n, $jourRefTaux);
            $taux[] = [
                'niveau'  => $n,
                'montant' => $r['montant'] ?? null,
            ];
        }

        // Fiches de paie : en attente (montant recalculé en direct sur les
        // séances réservées) et payées (montant figé). Détail par niveau ET par
        // matière. Les anciennes fiches « archivee » sont ignorées.
        $tauxTous = Taux::tous();
        $jourAuj  = Outils::jour(Outils::maintenant());
        $fichesAdmin = array_map(function ($f) use ($refs, $tauxTous, $jourAuj) {
            $t = $refs['index']['teacher'][$f['teacher_id']] ?? null;
            $dep = Rapports::departementDeTeacher($t, $refs);

            if ($f['statut'] === 'payee') {
                $parNiveau    = json_decode($f['par_niveau'], true) ?: [];
                $parMatiere   = json_decode((string) ($f['par_matiere'] ?? ''), true) ?: [];
                $montant      = $f['montant'] === null ? 0 : (int) $f['montant'];
                $incomplet    = false;
                $heuresPayees = (int) floor((float) $f['total_heures']);
                $tauxImpot    = (float) $f['taux_impot'];
                $impot        = $f['impot'] === null ? null : (int) $f['impot'];
                $net          = $f['net'] === null ? null : (int) $f['net'];
            } else {
                $calc         = Rapports::fichePaie($f['teacher_id'], null, null, true, $f['id'], $refs);
                $parNiveau    = $calc['parNiveau'];
                $parMatiere   = $calc['parMatiere'];
                $montant      = (int) $calc['montant'];
                $incomplet    = (bool) $calc['montantIncomplet'];
                $heuresPayees = (int) $calc['heuresPayees'];
                // En attente : l'impôt est saisi côté écran, pas encore figé.
                $tauxImpot    = null;
                $impot        = null;
                $net          = null;
            }

            // Taux courant par niveau (pré-remplissage de la saisie des taux).
            $parNiveau = array_map(function ($n) use ($tauxTous, $jourAuj, $f) {
                $r = Taux::resoudre($tauxTous, $f['teacher_id'], null, (int) $n['niveau'], $jourAuj);
                $n['taux'] = $r['montant'] ?? null;
                return $n;
            }, $parNiveau);

            return [
                'id'               => $f['id'],
                'statut'           => $f['statut'],
                'teacherId'        => $f['teacher_id'],
                'enseignant'       => $t ? $t['prenom'] . ' ' . $t['nom'] : '—',
                'departement'      => $dep['nom'] ?? null,
                'periode'          => $f['periode'],
                'debut'            => $f['debut'],
                'fin'              => $f['fin'],
                'totalHeures'      => (float) $f['total_heures'],
                'heuresPayees'     => $heuresPayees,
                'parNiveau'        => $parNiveau,
                'parMatiere'       => $parMatiere,
                'montant'          => $montant,
                'montantIncomplet' => $incomplet,
                'tauxImpot'        => $tauxImpot,
                'impot'            => $impot,
                'net'              => $net,
                'etablissement'    => $f['etablissement'],
                'creeePar'         => $f['sent_by_label'],
                'creeeLe'          => Outils::versIso($f['sent_at']),
                'payeePar'         => $f['paid_by_label'],
                'payeeLe'          => Outils::versIso($f['paid_at']),
            ];
        }, Db::tout(
            "SELECT * FROM fiches_heures WHERE statut IN ('en_attente','payee')"
            . " ORDER BY FIELD(statut, 'en_attente', 'payee'), sent_at DESC LIMIT 200"
        ));

        return [
            'parametres' => array_merge($parametres, [
                'manquants' => Parametres::manquants($parametres),
            ]),
            'fiches' => $fichesAdmin,
            'tableauDeBord' => [
                'jour'             => ['totaux' => $jour['totaux'], 'parJour' => $jour['parJour']],
                'semaine'          => ['totaux' => $semaine['totaux']],
                'mois'             => ['totaux' => $mois['totaux']],
                'enCours'          => $tout['enCours'],
                'incompletes'      => $tout['incompletes'],
                'saisiesManuelles' => $tout['saisiesManuelles'],
                'sansTaux'         => $tout['sansTaux'],
            ],
            'heuresEtCouts' => [
                'seances'       => $tout['seances'],
                'totaux'        => $tout['totaux'],
                'parEnseignant' => $tout['parEnseignant'],
                'parMatiere'    => $tout['parMatiere'],
                'parFiliere'    => $tout['parFiliere'],
                'parNiveau'     => $tout['parNiveau'],
                'parJour'       => $tout['parJour'],
            ],
            'referentiel' => self::referentielAdmin($refs, $parId),
            'taux'        => $taux,
            'alertes'     => Rapports::alertes(null, $refs),
            'historique'  => array_map(fn($h) => [
                'id'          => $h['id'],
                'at'          => Outils::versIso($h['at']),
                'entity'      => $h['entity'],
                'entityId'    => $h['entity_id'],
                'action'      => $h['action'],
                'authorLabel' => $h['author_label'],
                'field'       => $h['field'],
                'before'      => $h['before_value'],
                'after'       => $h['after_value'],
                'note'        => $h['note'],
                'flagged'     => (int) $h['flagged'] === 1,
            ], Historique::lire(300)),
            'anomalies' => array_map(fn($a) => [
                'id'       => $a['id'],
                'at'       => Outils::versIso($a['at']),
                'kind'     => $a['kind'],
                'titre'    => $a['titre'],
                'detail'   => $a['detail'],
                'severity' => $a['severity'],
            ], Historique::anomalies(200)),
        ];
    }

    private static function referentielAdmin(array $refs, array $comptesParId): array
    {
        $filieres = array_map(function ($f) use ($refs, $comptesParId) {
            $dep = $refs['index']['departement'][$f['departement_id'] ?? ''] ?? null;
            return [
                'id'            => $f['id'],
                'nom'           => $f['nom'],
                'chefUserId'    => $f['chef_user_id'],
                'chef'          => $f['chef_user_id'] === null
                    ? null
                    : ($comptesParId[$f['chef_user_id']]['nom'] ?? '—'),
                'departementId' => $f['departement_id'] ?? null,
                'departement'   => $dep['nom'] ?? null,
                'sectionAnglophone' => (int) ($f['section_anglophone'] ?? 0) === 1,
                'classes'       => count(array_filter($refs['classes'], fn($c) => $c['filiere_id'] === $f['id'])),
            ];
        }, $refs['filieres']);
        usort($filieres, fn($a, $b) => strcmp($a['nom'], $b['nom']));

        $classes = array_map(function ($c) use ($refs) {
            return [
                'id'       => $c['id'],
                'nom'      => Rapports::libelleClasse($c, $refs),
                'filiereId' => $c['filiere_id'],
                'niveau'   => (int) $c['niveau'],
                'effectif' => count(array_filter(
                    $refs['students'],
                    fn($s) => $s['classe_id'] === $c['id'] && (int) $s['actif'] === 1
                )),
                'matieres' => count(array_filter($refs['matieres'], fn($m) => $m['classe_id'] === $c['id'])),
            ];
        }, $refs['classes']);
        usort($classes, fn($a, $b) => strcmp($a['nom'], $b['nom']));

        $matieres = array_map(function ($m) use ($refs) {
            $ens = [];
            foreach ($refs['affectations'] as $a) {
                if ($a['matiere_id'] !== $m['id']) {
                    continue;
                }
                $t = $refs['index']['teacher'][$a['teacher_id']] ?? null;
                if ($t !== null) {
                    $ens[] = ['id' => $t['id'], 'nom' => $t['prenom'] . ' ' . $t['nom']];
                }
            }
            return [
                'id'          => $m['id'],
                'nom'         => $m['nom'],
                'nomEn'       => $m['nom_en'] ?? null,
                'classeId'    => $m['classe_id'],
                'classe'      => Rapports::libelleClasse($refs['index']['classe'][$m['classe_id']] ?? null, $refs),
                'enseignants' => $ens,
            ];
        }, $refs['matieres']);
        usort($matieres, fn($a, $b) => strcmp($a['nom'], $b['nom']));

        $enseignants = array_map(function ($t) use ($refs) {
            $sesMatieres = [];
            foreach ($refs['affectations'] as $a) {
                if ($a['teacher_id'] === $t['id']) {
                    $m = $refs['index']['matiere'][$a['matiere_id']] ?? null;
                    if ($m !== null) {
                        $sesMatieres[] = $m['nom'];
                    }
                }
            }
            $dep = Rapports::departementDeTeacher($t, $refs);
            return [
                'id'            => $t['id'],
                'userId'        => $t['user_id'],
                'nom'           => $t['prenom'] . ' ' . $t['nom'],
                'prenom'        => $t['prenom'],
                'nomFamille'    => $t['nom'],
                'telephone'     => $t['telephone'],
                'actif'         => (int) $t['actif'] === 1,
                'matieres'      => $sesMatieres,
                'departementId' => $dep['id'] ?? null,
                'departement'   => $dep['nom'] ?? null,
            ];
        }, $refs['teachers']);
        usort($enseignants, fn($a, $b) => strcmp($a['nom'], $b['nom']));

        $etudiants = array_map(function ($s) use ($refs) {
            $dep = Rapports::departementDeClasse($s['classe_id'], $refs);
            return [
                'id'        => $s['id'],
                'matricule' => $s['matricule'],
                'nom'       => $s['prenom'] . ' ' . $s['nom'],
                'prenom'    => $s['prenom'],
                'nomFamille' => $s['nom'],
                'classeId'  => $s['classe_id'],
                'classe'    => Rapports::libelleClasse($refs['index']['classe'][$s['classe_id']] ?? null, $refs),
                'section'      => $s['section'] ?? 'francophone',
                'sectionLabel' => Rapports::libelleSection($s['section'] ?? 'francophone'),
                // §13.10 : visible par l'administration et le chef de département.
                'parentPhone' => $s['parent_phone'],
                'actif'     => (int) $s['actif'] === 1,
                'departementId' => $dep['id'] ?? null,
                'departement'   => $dep['nom'] ?? null,
            ];
        }, $refs['students']);
        usort($etudiants, fn($a, $b) => strcmp($a['nom'], $b['nom']));

        return [
            'filieres'     => $filieres,
            'classes'      => $classes,
            'matieres'     => $matieres,
            'enseignants'  => $enseignants,
            'etudiants'    => $etudiants,
            'departements' => array_map(
                fn($d) => ['id' => $d['id'], 'nom' => $d['nom']],
                $refs['departements']
            ),
            'comptes'      => array_values($comptesParId),
        ];
    }
}
