<?php
declare(strict_types=1);

/**
 * Tous les calculs de lecture : heures, absences, coûts, alertes.
 *
 * §13.8 « Sécurité calculée côté client » : rien de ceci n'est recalculé dans
 * un écran. L'application affiche ce que ce fichier a produit.
 *
 * Ce fichier ne vérifie AUCUN droit : il est appelé exclusivement par
 * `Projection`, qui a déjà filtré le périmètre, et les montants ne sont joints
 * que derrière `Garde::exigerMontants()`.
 */
final class Rapports
{
    /* ----------------------------------------------------------------- *
     *  Socle commun
     * ----------------------------------------------------------------- */

    /** Référentiel chargé une fois, pour éviter les lectures en boucle. */
    public static function referentiel(): array
    {
        $filieres = Db::tout('SELECT * FROM filieres');
        $classes  = Db::tout('SELECT * FROM classes');
        $matieres = Db::tout('SELECT * FROM matieres');
        $teachers = Db::tout('SELECT * FROM teachers');
        $students = Db::tout('SELECT * FROM students');
        $departements = Db::tout('SELECT * FROM departements ORDER BY nom');

        return [
            'filieres'     => $filieres,
            'classes'      => $classes,
            'matieres'     => $matieres,
            'teachers'     => $teachers,
            'students'     => $students,
            'departements' => $departements,
            'affectations' => Db::tout('SELECT * FROM affectations'),
            'parametres'   => Parametres::lire(),
            'index' => [
                'filiere'     => array_column($filieres, null, 'id'),
                'classe'      => array_column($classes, null, 'id'),
                'matiere'     => array_column($matieres, null, 'id'),
                'teacher'     => array_column($teachers, null, 'id'),
                'student'     => array_column($students, null, 'id'),
                'departement' => array_column($departements, null, 'id'),
            ],
        ];
    }

    /** Département d'un enseignant (rattachement direct). */
    public static function departementDeTeacher(?array $teacher, array $refs): ?array
    {
        $id = $teacher['departement_id'] ?? null;
        if ($id === null) {
            return null;
        }
        $d = $refs['index']['departement'][$id] ?? null;
        return $d === null ? null : ['id' => $d['id'], 'nom' => $d['nom']];
    }

    /** Département d'une classe, via sa filière (pour les étudiants). */
    public static function departementDeClasse(?string $classeId, array $refs): ?array
    {
        $classe = $classeId === null ? null : ($refs['index']['classe'][$classeId] ?? null);
        $filiere = $classe === null ? null : ($refs['index']['filiere'][$classe['filiere_id']] ?? null);
        $id = $filiere['departement_id'] ?? null;
        if ($id === null) {
            return null;
        }
        $d = $refs['index']['departement'][$id] ?? null;
        return $d === null ? null : ['id' => $d['id'], 'nom' => $d['nom']];
    }

    /** Libellé lisible d'une classe : « Informatique · niveau 1 ». */
    public static function libelleClasse(?array $classe, array $refs): string
    {
        if ($classe === null) {
            return '—';
        }
        $filiere = $refs['index']['filiere'][$classe['filiere_id']] ?? null;
        return ($filiere['nom'] ?? 'Filière') . ' · niveau ' . $classe['niveau'];
    }

    /**
     * Nom d'affichage d'une matière selon la section (§4).
     *
     * La section anglophone affiche le nom ANGLAIS de la matière ; on se replie
     * sur le français si l'intitulé anglais n'a pas (encore) été saisi.
     */
    public static function nomMatiere(?array $matiere, ?string $section): string
    {
        if ($matiere === null) {
            return '—';
        }
        if (($section ?? 'francophone') === 'anglophone' && !empty($matiere['nom_en'])) {
            return $matiere['nom_en'];
        }
        return $matiere['nom'];
    }

    /** Libellé lisible d'une section. */
    public static function libelleSection(?string $section): ?string
    {
        return ($section ?? 'francophone') === 'anglophone' ? 'Anglophone' : 'Francophone';
    }

    /**
     * Présents retenus pour une séance.
     *
     * §9 règle 3 : la liste cochée par l'enseignant l'emporte sur les scans.
     * Avant validation du relevé, ce sont les scans qui comptent.
     */
    public static function presents(array $seance): array
    {
        if ((int) $seance['roll_code_ok'] === 1 && !empty($seance['roll_validated_at'])) {
            return array_column(
                Db::tout('SELECT student_id FROM session_presents WHERE session_id = ?', [$seance['id']]),
                'student_id'
            );
        }
        return array_column(
            Db::tout(
                "SELECT student_id FROM attendance WHERE session_id = ? AND status = 'present'",
                [$seance['id']]
            ),
            'student_id'
        );
    }

    /** Séance enrichie des informations dérivées, SANS aucun montant. */
    public static function decorer(array $s, array $refs): array
    {
        $matiere = $refs['index']['matiere'][$s['matiere_id']] ?? null;
        $classe  = $refs['index']['classe'][$s['classe_id']] ?? null;
        $teacher = $refs['index']['teacher'][$s['teacher_id']] ?? null;
        $section = $s['section'] ?? 'francophone';

        $scans = Db::compte(
            "SELECT COUNT(*) FROM attendance WHERE session_id = ? AND status = 'present'",
            [$s['id']]
        );
        $presents = self::presents($s);
        // Effectif de la séance : seuls les étudiants de SA section (§4).
        $effectif = Db::compte(
            'SELECT COUNT(*) FROM students WHERE classe_id = ? AND section = ? AND actif = 1',
            [$s['classe_id'], $section]
        );

        return [
            'id'             => $s['id'],
            'day'            => $s['day'],
            'status'         => Regles::etat($s),
            'manque'         => Regles::manque($s),
            'matiereId'      => $s['matiere_id'],
            'matiere'        => self::nomMatiere($matiere, $section),
            'matiereEn'      => $matiere['nom_en'] ?? null,
            'section'        => $section,
            'sectionLabel'   => self::libelleSection($section),
            'classeId'       => $s['classe_id'],
            'classe'         => self::libelleClasse($classe, $refs),
            'niveau'         => (int) $s['niveau'],
            'filiereId'      => $classe['filiere_id'] ?? null,
            'teacherId'      => $s['teacher_id'],
            'enseignant'     => $teacher ? $teacher['prenom'] . ' ' . $teacher['nom'] : '—',
            'arrivalAt'      => Outils::versIso($s['arrival_at']),
            'departureAt'    => Outils::versIso($s['departure_at']),
            'plannedEndAt'   => Outils::versIso($s['planned_end_at'] ?? null),
            'releveAt'       => Outils::versIso($s['roll_validated_at']),
            'codeOk'         => (int) $s['roll_code_ok'] === 1,
            'heuresPayees'   => Regles::heuresPayees($s),
            'ecartNonPaye'   => Regles::ecartNonPaye($s),
            'depassementNonPaye' => Regles::depassementNonPaye($s),
            'departManuel'   => $s['departure_via'] === 'saisie_manuelle' ? [
                'motif' => $s['departure_motif'],
                'par'   => self::labelUtilisateur($s['departure_manual_by']),
                'at'    => Outils::versIso($s['departure_manual_at']),
            ] : null,
            'arrivalVia'     => $s['arrival_via'],
            'departureVia'   => $s['departure_via'],
            'declareEnseignant' => (int) ($s['declare_enseignant'] ?? 0) === 1,
            'saisieAnterieure'  => (int) ($s['saisie_anterieure'] ?? 0) === 1,
            'rollOpenedAt'   => Outils::versIso($s['roll_opened_at']),
            'rollClosedAt'   => Outils::versIso($s['roll_closed_at']),
            'notifiee'       => (int) $s['notifiee'] === 1,
            'presentsCount'  => count($presents),
            'scansCount'     => $scans,
            'comptePhysique' => $s['roll_compte_physique'] !== null ? (int) $s['roll_compte_physique'] : null,
            'effectif'       => $effectif,
        ];
    }

    private static function labelUtilisateur(?string $userId): ?string
    {
        if ($userId === null) {
            return null;
        }
        $u = Db::un('SELECT prenom, nom FROM users WHERE id = ?', [$userId]);
        return $u === null ? null : trim($u['prenom'] . ' ' . $u['nom']);
    }

    /* ----------------------------------------------------------------- *
     *  Absences (§6)
     * ----------------------------------------------------------------- */

    /**
     * Absences d'un étudiant, séance par séance, avec l'état de justification.
     * Seules les séances « terminées » produisent des absences (§6).
     */
    public static function absencesEtudiant(string $studentId, ?array $refs = null): array
    {
        $refs = $refs ?? self::referentiel();
        $etudiant = $refs['index']['student'][$studentId] ?? null;
        if ($etudiant === null) {
            return ['absences' => [], 'seances' => [], 'etudiant' => null];
        }

        // §4 : l'étudiant ne voit que les séances de SA section. La section
        // anglophone et la francophone d'une même classe sont des groupes
        // distincts.
        $section = $etudiant['section'] ?? 'francophone';
        $seances = Db::tout(
            'SELECT * FROM sessions WHERE classe_id = ? AND section = ? ORDER BY arrival_at DESC',
            [$etudiant['classe_id'], $section]
        );

        $justifs = [];
        foreach (Db::tout('SELECT * FROM justifications WHERE student_id = ?', [$studentId]) as $j) {
            $justifs[$j['session_id']] = $j;
        }

        $absences = [];
        $lignes   = [];

        foreach ($seances as $s) {
            // Séance saisie a posteriori par le secrétariat : elle ne compte
            // que les heures de l'enseignant, jamais les présences des
            // étudiants (aucun relevé n'a été fait). On l'ignore ici.
            if ((int) ($s['saisie_anterieure'] ?? 0) === 1) {
                continue;
            }

            $etat     = Regles::etat($s);
            $presents = self::presents($s);
            $present  = in_array($studentId, $presents, true);
            $matiere  = $refs['index']['matiere'][$s['matiere_id']] ?? null;

            $scan = Db::un(
                'SELECT status FROM attendance WHERE session_id = ? AND student_id = ?',
                [$s['id'], $studentId]
            );

            $ligne = [
                'sessionId'     => $s['id'],
                'day'           => $s['day'],
                'arrivalAt'     => Outils::versIso($s['arrival_at']),
                'matiere'       => self::nomMatiere($matiere, $section),
                'matiereEn'     => $matiere['nom_en'] ?? null,
                'matiereId'     => $s['matiere_id'],
                'statutSeance'  => $etat,
                'heures'        => Regles::heuresPayees($s),
                'presence'      => $present
                    ? 'present'
                    : ($etat === Regles::TERMINEE ? 'absent' : 'en_attente'),
                'scanStatus'    => $scan['status'] ?? null,
            ];
            $lignes[] = $ligne;

            if ($etat === Regles::TERMINEE && !$present) {
                $j = $justifs[$s['id']] ?? null;
                $absences[] = array_merge($ligne, [
                    'justification' => $j === null ? null : [
                        'id'              => $j['id'],
                        'state'           => $j['state'],
                        'motif'           => $j['motif'],
                        'commentaire'     => $j['commentaire'],
                        'decidedAt'       => Outils::versIso($j['decided_at']),
                        'decidedByLabel'  => self::labelUtilisateur($j['decided_by']),
                    ],
                    'etat' => $j === null ? 'non_justifiee' : $j['state'],
                ]);
            }
        }

        return ['absences' => $absences, 'seances' => $lignes, 'etudiant' => $etudiant];
    }

    /**
     * Totaux d'absence d'un étudiant.
     *
     * Les heures justifiées sont comptées à part (§6) et sortent du calcul du
     * seuil d'alerte.
     */
    public static function totauxAbsences(string $studentId, ?string $semestreId = null, ?array $refs = null): array
    {
        $refs = $refs ?? self::referentiel();
        $semestres = Parametres::semestres($refs['parametres']);
        $donnees = self::absencesEtudiant($studentId, $refs);

        $cible = $semestreId !== null
            ? (array_values(array_filter($semestres, fn($s) => $s['id'] === $semestreId))[0] ?? null)
            : Parametres::semestreDe(gmdate('Y-m-d'), $semestres);

        $retenues = $donnees['absences'];
        if ($cible !== null) {
            $retenues = array_values(array_filter(
                $retenues,
                function (array $a) use ($semestres, $cible): bool {
                    $s = Parametres::semestreDe(substr((string) $a['day'], 0, 10), $semestres);
                    return $s !== null && $s['id'] === $cible['id'];
                }
            ));
        }

        $somme = function (array $lignes): float {
            return array_sum(array_map(fn($l) => (float) $l['heures'], $lignes));
        };

        $justifiees    = array_filter($retenues, fn($a) => $a['etat'] === 'acceptee');
        $nonJustifiees = array_filter($retenues, fn($a) => $a['etat'] !== 'acceptee');
        $enAttente     = array_filter($retenues, fn($a) => $a['etat'] === 'en_attente');

        // Détail par matière
        $parMatiere = [];
        foreach ($retenues as $a) {
            $id = $a['matiereId'];
            if (!isset($parMatiere[$id])) {
                $parMatiere[$id] = [
                    'matiereId'     => $id,
                    'matiere'       => $a['matiere'],
                    'matiereEn'     => $a['matiereEn'] ?? null,
                    'nonJustifiees' => 0.0,
                    'justifiees'    => 0.0,
                    'seances'       => 0,
                ];
            }
            $parMatiere[$id]['seances']++;
            if ($a['etat'] === 'acceptee') {
                $parMatiere[$id]['justifiees'] += (float) $a['heures'];
            } else {
                $parMatiere[$id]['nonJustifiees'] += (float) $a['heures'];
            }
        }
        $parMatiere = array_values($parMatiere);
        usort($parMatiere, fn($a, $b) => $b['nonJustifiees'] <=> $a['nonJustifiees']);

        return [
            'semestre'      => $cible === null ? null : ['id' => $cible['id'], 'nom' => $cible['nom']],
            'periodeLabel'  => $cible['nom'] ?? 'année en cours',
            'nonJustifiees' => $somme($nonJustifiees),
            'justifiees'    => $somme($justifiees),
            'enAttente'     => $somme($enAttente),
            'parMatiere'    => $parMatiere,
            'absences'      => $retenues,
        ];
    }

    /* ----------------------------------------------------------------- *
     *  Heures de l'enseignant (§7) — sans aucun montant
     * ----------------------------------------------------------------- */

    public static function heuresEnseignant(string $teacherId, ?array $refs = null): array
    {
        $refs = $refs ?? self::referentiel();
        $semestres = Parametres::semestres($refs['parametres']);

        $seances = Db::tout(
            'SELECT * FROM sessions WHERE teacher_id = ? ORDER BY arrival_at DESC',
            [$teacherId]
        );

        $lignes = array_map(fn($s) => self::decorer($s, $refs), $seances);
        $terminees = array_values(array_filter($lignes, fn($l) => $l['status'] === Regles::TERMINEE));

        $grouper = function (array $lignes, callable $clef, callable $libelle): array {
            $groupes = [];
            foreach ($lignes as $l) {
                $k = (string) $clef($l);
                if (!isset($groupes[$k])) {
                    $groupes[$k] = array_merge($libelle($l), ['heures' => 0.0, 'seances' => 0]);
                }
                $groupes[$k]['heures'] += (float) $l['heuresPayees'];
                $groupes[$k]['seances']++;
            }
            return array_values($groupes);
        };

        // §4 : on sépare les sections — une même matière enseignée en
        // francophone et en anglophone donne deux lignes (noms FR / EN).
        $parMatiere = $grouper(
            $terminees,
            fn($l) => $l['matiereId'] . '|' . ($l['section'] ?? 'francophone'),
            fn($l) => ['matiereId' => $l['matiereId'], 'matiere' => $l['matiere'], 'matiereEn' => $l['matiereEn'] ?? null, 'section' => $l['section'] ?? 'francophone', 'classe' => $l['classe']]
        );
        usort($parMatiere, fn($a, $b) => $b['heures'] <=> $a['heures']);

        // Ventilation par niveau — base de la fiche récapitulative (§7).
        $parNiveau = $grouper(
            $terminees,
            fn($l) => $l['niveau'],
            fn($l) => ['niveau' => (int) $l['niveau']]
        );
        usort($parNiveau, fn($a, $b) => $a['niveau'] <=> $b['niveau']);

        $parJour = $grouper($terminees, fn($l) => $l['day'], fn($l) => ['day' => $l['day']]);
        usort($parJour, fn($a, $b) => strcmp($b['day'], $a['day']));

        $parMois = $grouper(
            $terminees,
            fn($l) => substr($l['day'], 0, 7),
            fn($l) => ['mois' => substr($l['day'], 0, 7)]
        );
        usort($parMois, fn($a, $b) => strcmp($b['mois'], $a['mois']));

        $parSemestre = [];
        foreach ($semestres as $s) {
            $dedans = array_filter($terminees, function ($l) use ($semestres, $s) {
                $trouve = Parametres::semestreDe($l['day'], $semestres);
                return $trouve !== null && $trouve['id'] === $s['id'];
            });
            $parSemestre[] = [
                'id'      => $s['id'],
                'nom'     => $s['nom'],
                'heures'  => array_sum(array_map(fn($l) => (float) $l['heuresPayees'], $dedans)),
                'seances' => count($dedans),
            ];
        }

        return [
            'seances'            => $lignes,
            'totalHeures'        => array_sum(array_map(fn($l) => (float) $l['heuresPayees'], $terminees)),
            'totalEcartNonPaye'  => array_sum(array_map(fn($l) => (float) $l['ecartNonPaye'], $lignes)),
            'totalDepassement'   => array_sum(array_map(fn($l) => (float) ($l['depassementNonPaye'] ?? 0), $lignes)),
            'incompletes'        => array_values(array_filter($lignes, fn($l) => $l['status'] === Regles::INCOMPLETE)),
            'enCours'            => array_values(array_filter($lignes, fn($l) => $l['status'] === Regles::EN_COURS)),
            'parMatiere'         => $parMatiere,
            'parNiveau'          => $parNiveau,
            'parJour'            => $parJour,
            'parMois'            => $parMois,
            'parSemestre'        => $parSemestre,
        ];
    }

    /* ----------------------------------------------------------------- *
     *  Fiche de paie sur une période (§7)
     * ----------------------------------------------------------------- */

    /** Libellé lisible d'une période de paie. */
    public static function libellePeriode(?string $debut, ?string $fin): string
    {
        $fmt = fn($d) => $d ? date('d/m/Y', (int) strtotime($d)) : '…';
        if ($debut === null && $fin === null) {
            return 'Depuis le début';
        }
        return $fmt($debut) . ' → ' . $fmt($fin);
    }

    /**
     * Heures (et montant si demandé) d'un enseignant sur une PÉRIODE, ventilées
     * par niveau ET par matière. Ne compte QUE les séances terminées non encore
     * portées par une fiche (`fiche_id IS NULL`) : pas de double paiement.
     *
     * Quand `$ficheId` est fourni, on compte au contraire les séances DE cette
     * fiche (pour relire une fiche déjà créée, bornes ignorées).
     *
     * Le montant n'est joint que derrière `$avecMontant` (réservé à
     * l'administration et à l'enseignant concerné — §13.10).
     */
    public static function fichePaie(
        string $teacherId,
        ?string $debut,
        ?string $fin,
        bool $avecMontant = false,
        ?string $ficheId = null,
        ?array $refs = null
    ): array {
        $refs  = $refs ?? self::referentiel();
        $debut = $debut !== null ? substr($debut, 0, 10) : null;
        $fin   = $fin !== null ? substr($fin, 0, 10) : null;

        if ($ficheId !== null) {
            $sql = 'SELECT * FROM sessions WHERE teacher_id = ? AND status = ? AND fiche_id = ?'
                 . ' ORDER BY day ASC, arrival_at ASC';
            $seances = Db::tout($sql, [$teacherId, Regles::TERMINEE, $ficheId]);
        } else {
            $sql = 'SELECT * FROM sessions WHERE teacher_id = ? AND status = ? AND fiche_id IS NULL';
            $params = [$teacherId, Regles::TERMINEE];
            if ($debut !== null) { $sql .= ' AND day >= ?'; $params[] = $debut; }
            if ($fin !== null)   { $sql .= ' AND day <= ?'; $params[] = $fin; }
            $sql .= ' ORDER BY day ASC, arrival_at ASC';
            $seances = Db::tout($sql, $params);
        }

        $taux = $avecMontant ? Taux::tous() : [];
        // Une fiche de paie se calcule au TAUX COURANT (celui que l'admin vient
        // de définir), pas au taux historique séance par séance : le taux est
        // résolu à la date du jour, pour toute la fiche (§7).
        $jourRef = date('Y-m-d');
        $parNiveau = [];
        $parMatiere = [];
        $seanceIds = [];
        $totalHeures = 0.0;
        $totalMontant = 0;
        $incomplet = false;

        foreach ($seances as $s) {
            $d = self::decorer($s, $refs);
            $h = (float) $d['heuresPayees'];
            $seanceIds[] = $s['id'];
            $totalHeures += $h;

            $montantSeance = null;
            if ($avecMontant) {
                $resolu = Taux::resoudre(
                    $taux,
                    $s['teacher_id'],
                    $s['matiere_id'],
                    (int) $s['niveau'],
                    $jourRef
                );
                $montantSeance = $resolu === null ? null : (int) round($h * (float) $resolu['montant']);
                if ($montantSeance === null) {
                    $incomplet = true;
                } else {
                    $totalMontant += (int) $montantSeance;
                }
            }

            $kn = (string) ((int) $d['niveau']);
            if (!isset($parNiveau[$kn])) {
                $parNiveau[$kn] = [
                    'niveau' => (int) $d['niveau'], 'heures' => 0.0, 'seances' => 0,
                    'montant' => $avecMontant ? 0 : null, 'montantIncomplet' => false,
                ];
            }
            $parNiveau[$kn]['heures'] += $h;
            $parNiveau[$kn]['seances']++;

            $sec = $d['section'] ?? 'francophone';
            $km = $d['matiereId'] . '@' . ((int) $d['niveau']) . '@' . $sec;
            if (!isset($parMatiere[$km])) {
                $parMatiere[$km] = [
                    'matiereId' => $d['matiereId'],
                    'matiere'   => $d['matiere'],
                    'matiereEn' => $d['matiereEn'] ?? null,
                    'section'   => $sec,
                    'niveau'    => (int) $d['niveau'],
                    'heures'    => 0.0, 'seances' => 0,
                    'montant'   => $avecMontant ? 0 : null, 'montantIncomplet' => false,
                ];
            }
            $parMatiere[$km]['heures'] += $h;
            $parMatiere[$km]['seances']++;

            if ($avecMontant) {
                foreach ([&$parNiveau[$kn], &$parMatiere[$km]] as &$groupe) {
                    if ($montantSeance === null) {
                        $groupe['montantIncomplet'] = true;
                    } else {
                        $groupe['montant'] += (int) $montantSeance;
                    }
                }
                unset($groupe);
            }
        }

        $parNiveau = array_values($parNiveau);
        usort($parNiveau, fn($a, $b) => $a['niveau'] <=> $b['niveau']);
        $parMatiere = array_values($parMatiere);
        usort($parMatiere, fn($a, $b) => [$a['niveau'], $a['matiere']] <=> [$b['niveau'], $b['matiere']]);

        // Arrondis d'affichage.
        foreach ($parNiveau as &$n) { $n['heures'] = round($n['heures'], 2); } unset($n);
        foreach ($parMatiere as &$m) { $m['heures'] = round($m['heures'], 2); } unset($m);

        // Les minutes ne comptent pas : les heures PAYÉES sont le TOTAL de la
        // fiche arrondi à l'heure inférieure (ex. 6 h 07 → 6 h). Le montant brut
        // est le montant calculé ramené à ces heures entières.
        $heuresPayees = (int) floor($totalHeures);
        $brut = 0;
        if ($avecMontant) {
            $brut = $totalHeures > 0
                ? (int) round($totalMontant * ($heuresPayees / $totalHeures))
                : 0;
        }

        return [
            'debut'            => $debut,
            'fin'              => $fin,
            'periode'          => self::libellePeriode($debut, $fin),
            'totalHeures'      => round($totalHeures, 2),
            'heuresPayees'     => $heuresPayees,
            'totalSeances'     => count($seanceIds),
            'seanceIds'        => $seanceIds,
            'parNiveau'        => $parNiveau,
            'parMatiere'       => $parMatiere,
            'montant'          => $avecMontant ? $brut : null,
            'montantIncomplet' => $avecMontant ? $incomplet : false,
        ];
    }

    /* ----------------------------------------------------------------- *
     *  Heures et coûts pour l'administration (§7)
     * ----------------------------------------------------------------- */

    /**
     * Agrégat administratif.
     *
     * Les montants ne sont joints que si `$avecMontants` est vrai, et seul
     * `Projection` le passe à vrai, après `Garde::exigerMontants()`.
     */
    public static function rapportAdmin(?string $du = null, ?string $au = null, bool $avecMontants = false, ?array $refs = null): array
    {
        $refs = $refs ?? self::referentiel();
        $taux = $avecMontants ? Taux::tous() : [];

        $sql = 'SELECT * FROM sessions';
        $params = [];
        $conditions = [];
        if ($du !== null) {
            $conditions[] = 'day >= ?';
            $params[] = $du;
        }
        if ($au !== null) {
            $conditions[] = 'day <= ?';
            $params[] = $au;
        }
        if (count($conditions) > 0) {
            $sql .= ' WHERE ' . implode(' AND ', $conditions);
        }
        $sql .= ' ORDER BY arrival_at DESC';

        $lignes = [];
        foreach (Db::tout($sql, $params) as $s) {
            $base = self::decorer($s, $refs);
            if ($avecMontants) {
                $cout = Taux::coutSeance($s, $taux);
                $base['montant']    = $cout['montant'];
                $base['taux']       = $cout['taux'];
                $base['coutRaison'] = $cout['raison'];
            }
            $lignes[] = $base;
        }

        $terminees = array_values(array_filter($lignes, fn($l) => $l['status'] === Regles::TERMINEE));
        $sansTaux  = $avecMontants
            ? array_values(array_filter($terminees, fn($l) => ($l['coutRaison'] ?? null) === 'aucun_taux'))
            : [];

        $agreger = function (callable $clef, callable $libelle) use ($terminees, $avecMontants): array {
            $groupes = [];
            foreach ($terminees as $l) {
                $k = (string) $clef($l);
                if (!isset($groupes[$k])) {
                    $groupes[$k] = [
                        'key'              => $clef($l),
                        'libelle'          => $libelle($l),
                        'heures'           => 0.0,
                        'seances'          => 0,
                        'montant'          => $avecMontants ? 0 : null,
                        'montantIncomplet' => false,
                    ];
                }
                $groupes[$k]['heures'] += (float) $l['heuresPayees'];
                $groupes[$k]['seances']++;
                if ($avecMontants) {
                    if ($l['montant'] === null) {
                        $groupes[$k]['montantIncomplet'] = true;
                    } else {
                        $groupes[$k]['montant'] += (int) $l['montant'];
                    }
                }
            }
            $liste = array_values($groupes);
            usort($liste, fn($a, $b) => $b['heures'] <=> $a['heures']);
            return $liste;
        };

        $parJour = [];
        foreach ($terminees as $l) {
            $j = $l['day'];
            if (!isset($parJour[$j])) {
                $parJour[$j] = ['day' => $j, 'heures' => 0.0, 'seances' => 0, 'montant' => $avecMontants ? 0 : null];
            }
            $parJour[$j]['heures'] += (float) $l['heuresPayees'];
            $parJour[$j]['seances']++;
            if ($avecMontants && $l['montant'] !== null) {
                $parJour[$j]['montant'] += (int) $l['montant'];
            }
        }
        $parJour = array_values($parJour);
        usort($parJour, fn($a, $b) => strcmp($b['day'], $a['day']));

        return [
            'seances'          => $lignes,
            'enCours'          => array_values(array_filter($lignes, fn($l) => $l['status'] === Regles::EN_COURS)),
            'incompletes'      => array_values(array_filter($lignes, fn($l) => $l['status'] === Regles::INCOMPLETE)),
            'saisiesManuelles' => array_values(array_filter($lignes, fn($l) => $l['departManuel'] !== null)),
            'totaux' => [
                'heures'           => array_sum(array_map(fn($l) => (float) $l['heuresPayees'], $terminees)),
                'seances'          => count($terminees),
                'montant'          => $avecMontants
                    ? array_sum(array_map(fn($l) => (int) ($l['montant'] ?? 0), $terminees))
                    : null,
                'montantIncomplet' => $avecMontants && count($sansTaux) > 0,
            ],
            'sansTaux'      => $sansTaux,
            'parEnseignant' => $agreger(fn($l) => $l['teacherId'], fn($l) => $l['enseignant']),
            'parMatiere'    => $agreger(fn($l) => $l['matiereId'], fn($l) => $l['matiere']),
            'parFiliere'    => $agreger(fn($l) => $l['filiereId'], fn($l) => explode(' · ', $l['classe'])[0]),
            'parNiveau'     => $agreger(fn($l) => $l['niveau'], fn($l) => 'Niveau ' . $l['niveau']),
            'parJour'       => $parJour,
        ];
    }

    /** Bornes d'une période courante. */
    public static function bornes(string $type): array
    {
        $auj = gmdate('Y-m-d');
        if ($type === 'jour') {
            return ['du' => $auj, 'au' => $auj];
        }
        if ($type === 'semaine') {
            // Lundi de la semaine en cours.
            $jour = (int) gmdate('N');
            return ['du' => gmdate('Y-m-d', time() - ($jour - 1) * 86400), 'au' => $auj];
        }
        if ($type === 'mois') {
            return ['du' => gmdate('Y-m-01'), 'au' => $auj];
        }
        return ['du' => null, 'au' => null];
    }

    /* ----------------------------------------------------------------- *
     *  Étudiants en alerte (§8)
     * ----------------------------------------------------------------- */

    /**
     * Liste d'alerte.
     *
     * Tant que l'administration n'a pas fixé de seuil, la liste est vide et
     * `seuilDefini` vaut faux : l'écran le dit au lieu d'inventer un chiffre
     * (§14).
     */
    public static function alertes(?array $filiereIds = null, ?array $refs = null): array
    {
        $refs = $refs ?? self::referentiel();
        $seuil = $refs['parametres']['seuilAlerteHeures'];

        if ($seuil === null) {
            return [
                'seuilDefini' => false,
                'seuil'       => null,
                'periode'     => $refs['parametres']['seuilAlertePeriode'],
                'etudiants'   => [],
            ];
        }

        $dernierContact = [];
        foreach (Db::tout('SELECT * FROM parent_contacts ORDER BY at ASC') as $c) {
            $dernierContact[$c['student_id']] = $c;
        }

        $etudiants = [];
        foreach ($refs['students'] as $e) {
            if ((int) $e['actif'] !== 1) {
                continue;
            }
            $classe = $refs['index']['classe'][$e['classe_id']] ?? null;
            if ($filiereIds !== null && !in_array($classe['filiere_id'] ?? null, $filiereIds, true)) {
                continue;
            }

            $totaux = self::totauxAbsences($e['id'], null, $refs);
            if ($totaux['nonJustifiees'] < (float) $seuil) {
                continue;
            }

            $contact = $dernierContact[$e['id']] ?? null;
            $etudiants[] = [
                'studentId'            => $e['id'],
                'matricule'            => $e['matricule'],
                'nom'                  => $e['prenom'] . ' ' . $e['nom'],
                'classe'               => self::libelleClasse($classe, $refs),
                'filiereId'            => $classe['filiere_id'] ?? null,
                'heuresNonJustifiees'  => $totaux['nonJustifiees'],
                'periode'              => $totaux['periodeLabel'],
                // §13.10 : joint seulement pour les rôles autorisés, et c'est
                // `Projection` qui en décide.
                'parentPhone'          => $e['parent_phone'],
                'dernierContactAt'     => Outils::versIso($contact['at'] ?? null),
                'dernierContactPar'    => $contact['by_label'] ?? null,
            ];
        }

        usort($etudiants, fn($a, $b) => $b['heuresNonJustifiees'] <=> $a['heuresNonJustifiees']);

        return [
            'seuilDefini' => true,
            'seuil'       => (float) $seuil,
            'periode'     => $refs['parametres']['seuilAlertePeriode'],
            'etudiants'   => $etudiants,
        ];
    }

    /* ----------------------------------------------------------------- *
     *  Présences d'une filière (chef de département)
     * ----------------------------------------------------------------- */

    public static function presencesFiliere(array $filiereIds, ?array $refs = null): array
    {
        $refs = $refs ?? self::referentiel();

        $classes = array_values(array_filter(
            $refs['classes'],
            fn($c) => in_array($c['filiere_id'], $filiereIds, true)
        ));
        usort($classes, fn($a, $b) => $a['niveau'] <=> $b['niveau']);

        $parClasse = [];
        foreach ($classes as $classe) {
            $eleves = array_values(array_filter(
                $refs['students'],
                fn($s) => $s['classe_id'] === $classe['id'] && (int) $s['actif'] === 1
            ));
            usort($eleves, fn($a, $b) => strcmp($a['nom'] . $a['prenom'], $b['nom'] . $b['prenom']));

            $lignes = [];
            foreach ($eleves as $e) {
                $t = self::totauxAbsences($e['id'], null, $refs);
                $lignes[] = [
                    'studentId'     => $e['id'],
                    'matricule'     => $e['matricule'],
                    'nom'           => $e['prenom'] . ' ' . $e['nom'],
                    'section'       => $e['section'] ?? 'francophone',
                    'sectionLabel'  => self::libelleSection($e['section'] ?? 'francophone'),
                    'nonJustifiees' => $t['nonJustifiees'],
                    'justifiees'    => $t['justifiees'],
                    'enAttente'     => $t['enAttente'],
                ];
            }

            $parClasse[] = [
                'classeId'            => $classe['id'],
                'classe'              => self::libelleClasse($classe, $refs),
                'niveau'              => (int) $classe['niveau'],
                'effectif'            => count($eleves),
                'etudiants'           => $lignes,
                'totalNonJustifiees'  => array_sum(array_column($lignes, 'nonJustifiees')),
            ];
        }

        return $parClasse;
    }

    /** File des justifications à traiter, pour le chef de département. */
    public static function fileJustifications(array $filiereIds, ?array $refs = null): array
    {
        $refs = $refs ?? self::referentiel();
        if (count($filiereIds) === 0) {
            return [];
        }

        $marques = implode(',', array_fill(0, count($filiereIds), '?'));
        $rows = Db::tout(
            "SELECT * FROM justifications WHERE filiere_id IN ($marques) ORDER BY created_at DESC",
            $filiereIds
        );

        $sortie = [];
        foreach ($rows as $j) {
            $seance   = Db::un('SELECT * FROM sessions WHERE id = ?', [$j['session_id']]);
            $etudiant = $refs['index']['student'][$j['student_id']] ?? null;
            $matiere  = $seance ? ($refs['index']['matiere'][$seance['matiere_id']] ?? null) : null;
            $classe   = $etudiant ? ($refs['index']['classe'][$etudiant['classe_id']] ?? null) : null;

            $sortie[] = [
                'id'             => $j['id'],
                'state'          => $j['state'],
                'motif'          => $j['motif'],
                'commentaire'    => $j['commentaire'],
                'createdAt'      => Outils::versIso($j['created_at']),
                'decidedAt'      => Outils::versIso($j['decided_at']),
                'decidedByLabel' => self::labelUtilisateur($j['decided_by']),
                'directe'        => (int) $j['directe'] === 1,
                // Le fichier n'est pas joint : il se télécharge par une route
                // qui vérifie les droits (§13.7).
                'piece'          => $j['piece_nom'] === null ? null : [
                    'nom'  => $j['piece_nom'],
                    'type' => $j['piece_type'],
                ],
                'studentId'      => $j['student_id'],
                'etudiant'       => $etudiant ? $etudiant['prenom'] . ' ' . $etudiant['nom'] : '—',
                'matricule'      => $etudiant['matricule'] ?? '—',
                'classe'         => self::libelleClasse($classe, $refs),
                'sessionId'      => $j['session_id'],
                'matiere'        => self::nomMatiere($matiere, $seance['section'] ?? 'francophone'),
                'matiereEn'      => $matiere['nom_en'] ?? null,
                'seanceDu'       => $seance ? Outils::versIso($seance['arrival_at']) : null,
                'heures'         => $seance ? Regles::heuresPayees($seance) : 0.0,
            ];
        }

        return $sortie;
    }
}
