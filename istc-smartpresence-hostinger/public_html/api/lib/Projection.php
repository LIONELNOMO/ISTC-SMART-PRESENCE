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
                'etudiants' => array_map(fn($s) => [
                    'id'        => $s['id'],
                    'matricule' => $s['matricule'],
                    'nom'       => $s['prenom'] . ' ' . $s['nom'],
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
                $sesMatieres[] = [
                    'id'     => $m['id'],
                    'nom'    => $m['nom'],
                    'classe' => Rapports::libelleClasse($refs['index']['classe'][$m['classe_id']] ?? null, $refs),
                ];
            }
            $enseignants[] = [
                'id'        => $t['id'],
                'nom'       => $t['prenom'] . ' ' . $t['nom'],
                'telephone' => $t['telephone'],
                'matieres'  => $sesMatieres,
            ];
        }
        usort($enseignants, fn($a, $b) => strcmp($a['nom'], $b['nom']));

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
        ];
    }

    /* ----------------------------------------------------------------- *
     *  Chef de département — sa filière, sans aucun montant (§14)
     * ----------------------------------------------------------------- */

    private static function departement(Contexte $ctx, array $refs): array
    {
        $filiereIds = Garde::filieresDuChef($ctx);
        if (count($filiereIds) === 0) {
            return ['filieres' => [], 'justifications' => [], 'presences' => [], 'alertes' => null];
        }

        return [
            'filieres' => array_map(
                fn($id) => ['id' => $id, 'nom' => $refs['index']['filiere'][$id]['nom'] ?? '—'],
                $filiereIds
            ),
            'justifications' => Rapports::fileJustifications($filiereIds, $refs),
            'presences'      => Rapports::presencesFiliere($filiereIds, $refs),
            // §13.10 : le chef de département a le droit de voir le numéro du
            // parent, pour pouvoir le contacter.
            'alertes'        => Rapports::alertes($filiereIds, $refs),
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

        $taux = [];
        foreach (Taux::tous() as $t) {
            $ens = $t['teacher_id'] !== null ? ($refs['index']['teacher'][$t['teacher_id']] ?? null) : null;
            $mat = $t['matiere_id'] !== null ? ($refs['index']['matiere'][$t['matiere_id']] ?? null) : null;
            $taux[] = [
                'id'         => $t['id'],
                'scope'      => $t['scope'],
                'scopeLabel' => Taux::LIBELLES[$t['scope']] ?? $t['scope'],
                'cible'      => Taux::decrire(
                    $t,
                    $ens ? $ens['prenom'] . ' ' . $ens['nom'] : null,
                    $mat['nom'] ?? null
                ),
                'montant'    => (int) $t['montant'],
                'dateEffet'  => $t['date_effet'],
                'niveau'     => $t['niveau'] === null ? null : (int) $t['niveau'],
                'teacherId'  => $t['teacher_id'],
                'matiereId'  => $t['matiere_id'],
                'createdAt'  => Outils::versIso($t['created_at']),
            ];
        }

        return [
            'parametres' => array_merge($parametres, [
                'manquants' => Parametres::manquants($parametres),
            ]),
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
            return [
                'id'         => $f['id'],
                'nom'        => $f['nom'],
                'chefUserId' => $f['chef_user_id'],
                'chef'       => $f['chef_user_id'] === null
                    ? null
                    : ($comptesParId[$f['chef_user_id']]['nom'] ?? '—'),
                'classes'    => count(array_filter($refs['classes'], fn($c) => $c['filiere_id'] === $f['id'])),
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
            return [
                'id'        => $t['id'],
                'userId'    => $t['user_id'],
                'nom'       => $t['prenom'] . ' ' . $t['nom'],
                'telephone' => $t['telephone'],
                'actif'     => (int) $t['actif'] === 1,
                'matieres'  => $sesMatieres,
            ];
        }, $refs['teachers']);
        usort($enseignants, fn($a, $b) => strcmp($a['nom'], $b['nom']));

        $etudiants = array_map(fn($s) => [
            'id'        => $s['id'],
            'matricule' => $s['matricule'],
            'nom'       => $s['prenom'] . ' ' . $s['nom'],
            'classeId'  => $s['classe_id'],
            'classe'    => Rapports::libelleClasse($refs['index']['classe'][$s['classe_id']] ?? null, $refs),
            // §13.10 : visible par l'administration et le chef de département.
            'parentPhone' => $s['parent_phone'],
            'actif'     => (int) $s['actif'] === 1,
        ], $refs['students']);
        usort($etudiants, fn($a, $b) => strcmp($a['nom'], $b['nom']));

        return [
            'filieres'    => $filieres,
            'classes'     => $classes,
            'matieres'    => $matieres,
            'enseignants' => $enseignants,
            'etudiants'   => $etudiants,
            'comptes'     => array_values($comptesParId),
        ];
    }
}
