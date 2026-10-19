<?php
declare(strict_types=1);

/**
 * Relevé des présences, scans d'étudiants et justifications (§5, §6).
 *
 * Suite de `Operations`, séparée pour que chaque fichier reste lisible.
 */
final class OperationsReleve
{
    private const ECART_HORLOGE = 300;

    private static function instantDeConfiance(?string $clientAt, string $recuA, int $maxPasse = 604800): array
    {
        $declare = Outils::versMysql($clientAt);
        if ($declare === null) {
            return ['at' => $recuA, 'ecart' => 0];
        }
        $ecart = Outils::ecart($declare, $recuA);
        if ($ecart < -self::ECART_HORLOGE || $ecart > $maxPasse) {
            return ['at' => $recuA, 'ecart' => abs($ecart)];
        }
        return ['at' => $declare, 'ecart' => abs($ecart)];
    }

    private static function rafraichirEtat(array $seance): array
    {
        $etat = Regles::etat($seance);
        Db::modifier('sessions', ['status' => $etat], ['id' => $seance['id']]);
        $seance['status'] = $etat;
        return $seance;
    }

    private static function elevesDeLaClasse(string $classeId): array
    {
        return array_column(
            Db::tout('SELECT id FROM students WHERE classe_id = ? AND actif = 1', [$classeId]),
            'id'
        );
    }

    /* ================================================================= *
     *  Ouverture et fermeture du relevé
     * ================================================================= */

    public static function ouvrir(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['enseignant']);
        $seance = Garde::seanceDeSonPerimetre($ctx, $p['sessionId']);
        if ($seance['teacher_id'] !== $ctx->teacherId) {
            throw Erreurs::perimetre();
        }

        $instant = self::instantDeConfiance($meta['clientAt'], $meta['recuA'], 86400);
        Db::modifier(
            'sessions',
            ['roll_opened_at' => $instant['at'], 'roll_closed_at' => null],
            ['id' => $seance['id']]
        );

        return ['rollOpenedAt' => Outils::versIso($instant['at'])];
    }

    public static function fermer(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['enseignant']);
        $seance = Garde::seanceDeSonPerimetre($ctx, $p['sessionId']);
        if ($seance['teacher_id'] !== $ctx->teacherId) {
            throw Erreurs::perimetre();
        }

        $instant = self::instantDeConfiance($meta['clientAt'], $meta['recuA'], 86400);
        Db::modifier('sessions', ['roll_closed_at' => $instant['at']], ['id' => $seance['id']]);

        return ['rollClosedAt' => Outils::versIso($instant['at'])];
    }

    /* ================================================================= *
     *  Validation du relevé par le code de séance (§5)
     * ================================================================= */

    /**
     *  §13.4 « Code de séance partagé » — le code n'est accepté que depuis le
     *         compte de l'enseignant de la séance.
     *  §13.4 « Code de séance deviné »  — 5 essais, puis blocage.
     *  §12   — un code faux conserve le relevé mais laisse la séance incomplète.
     */
    public static function valider(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['enseignant']);
        if ($ctx->teacherId === null) {
            throw Erreurs::droits();
        }
        Garde::exigerAffectation($ctx, $p['matiereId']);
        Limites::exigerAutorise('code_seance', $ctx->userId);

        $parametres = Parametres::lire();
        $jours  = (int) $parametres['delaiReleveJours'];
        $limite = gmdate('Y-m-d H:i:s', time() - $jours * 86400);

        // Recherche de la séance : par identifiant si l'appareil la connaissait,
        // sinon la plus récente de cette matière en attente de relevé (§5).
        if (!empty($p['sessionId'])) {
            $seance = Db::un('SELECT * FROM sessions WHERE id = ?', [$p['sessionId']]);
            if ($seance === null) {
                throw Erreurs::introuvable();
            }
            if ($seance['teacher_id'] !== $ctx->teacherId) {
                throw Erreurs::perimetre();
            }
        } else {
            $seance = Db::un(
                'SELECT * FROM sessions
                 WHERE teacher_id = ? AND matiere_id = ? AND arrival_at >= ? AND roll_code_ok = 0
                 ORDER BY arrival_at DESC LIMIT 1',
                [$ctx->teacherId, $p['matiereId'], $limite]
            );
        }

        if ($seance === null) {
            throw Erreurs::invalide(
                "Aucune séance de cette matière ouverte par le secrétariat dans les $jours derniers jours."
            );
        }

        if ($seance['arrival_at'] < $limite) {
            throw Erreurs::invalide(
                "Le délai de $jours jours est dépassé. Adressez-vous à l'administration."
            );
        }

        // Comparaison à temps constant du code de séance.
        $codeOk = Outils::memeSecret($p['code'], $seance['code']);

        // Les présents doivent appartenir à la classe de la matière (§5).
        $eleves    = self::elevesDeLaClasse($seance['classe_id']);
        $demandes  = $p['presents'] ?? [];
        $presents  = array_values(array_intersect($demandes, $eleves));
        $ecartes   = count($demandes) - count($presents);

        if ($ecartes > 0) {
            Historique::anomalie([
                'kind'      => 'presents_hors_classe',
                'titre'     => 'Relevé contenant des étudiants hors classe',
                'detail'    => "$ecartes identifiant(s) écarté(s).",
                'sessionId' => $seance['id'],
                'subjectId' => $ctx->teacherId,
                'severity'  => 'grave',
            ]);
        }

        $instant = self::instantDeConfiance($meta['clientAt'], $meta['recuA'], $jours * 86400);

        $scansRetenus = Db::compte(
            "SELECT COUNT(*) FROM attendance WHERE session_id = ? AND status = 'present'",
            [$seance['id']]
        );

        Db::transaction(function () use ($seance, $presents, $instant, $meta, $codeOk, $p, $ctx) {
            Db::modifier('sessions', [
                'roll_validated_at'    => $instant['at'],
                'roll_received_at'     => $meta['recuA'],
                'roll_code_ok'         => $codeOk ? 1 : 0,
                'roll_compte_physique' => $p['comptePhysique'],
                'roll_by'              => $ctx->userId,
                'roll_last_edit_at'    => $instant['at'],
                'roll_closed_at'       => $seance['roll_closed_at'] ?? $instant['at'],
                'code_attempts'        => $codeOk ? 0 : ((int) $seance['code_attempts'] + 1),
            ], ['id' => $seance['id']]);

            // La liste cochée remplace l'ancienne (§9 règle 4 : la plus récente
            // l'emporte).
            Db::supprimer('session_presents', ['session_id' => $seance['id']]);
            foreach ($presents as $studentId) {
                Db::inserer('session_presents', [
                    'session_id' => $seance['id'],
                    'student_id' => $studentId,
                ]);
            }
        });

        $seance = self::rafraichirEtat(Db::un('SELECT * FROM sessions WHERE id = ?', [$seance['id']]));

        if (!$codeOk) {
            $limite = Limites::echec('code_seance', $ctx->userId, ['subjectId' => $ctx->teacherId]);

            Historique::ajouter([
                'entity'      => 'releve',
                'entityId'    => $seance['id'],
                'action'      => 'code_seance_refuse',
                'authorId'    => $ctx->userId,
                'authorLabel' => $ctx->label,
                'note'        => 'Relevé conservé, séance laissée incomplète.',
                'flagged'     => true,
            ]);

            return [
                'ok'             => false,
                'raison'         => 'code',
                'sessionId'      => $seance['id'],
                'status'         => $seance['status'],
                'essaisRestants' => $limite['bloque'] ? 0 : $limite['restants'],
                'message'        => 'Code de séance incorrect. Le relevé est conservé : '
                    . 'corrigez le code pour le valider.',
            ];
        }

        Limites::reussite('code_seance', $ctx->userId);

        $ecarts = Regles::comparerLesComptes(
            $scansRetenus,
            $p['comptePhysique'],
            count($presents),
            count($eleves)
        );

        foreach ($ecarts as $e) {
            Historique::anomalie([
                'kind'      => $e['kind'],
                'titre'     => 'Écart sur un relevé de présences',
                'detail'    => $e['message'],
                'sessionId' => $seance['id'],
                'subjectId' => $ctx->teacherId,
                'severity'  => $e['severity'],
            ]);
        }

        if ($instant['ecart'] > self::ECART_HORLOGE) {
            Historique::anomalie([
                'kind'      => 'ecart_horloge',
                'titre'     => "Écart d'horloge sur un relevé",
                'detail'    => 'Heure déclarée décalée de ' . round($instant['ecart'] / 60)
                    . ' min par rapport au serveur.',
                'sessionId' => $seance['id'],
                'subjectId' => $ctx->teacherId,
                'severity'  => 'info',
            ]);
        }

        Historique::ajouter([
            'entity'      => 'releve',
            'entityId'    => $seance['id'],
            'action'      => 'releve_valide',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'field'       => 'presents',
            'after'       => $presents,
            'note'        => count($presents) . '/' . count($eleves) . ' présents',
        ]);

        return [
            'ok'        => true,
            'sessionId' => $seance['id'],
            'status'    => $seance['status'],
            'presents'  => count($presents),
            'effectif'  => count($eleves),
            'ecarts'    => $ecarts,
        ];
    }

    /**
     * Correction d'un relevé (§5).
     *
     * L'enseignant dispose du délai réglé ; passé ce délai, seul le chef de
     * département peut modifier. Le délai est vérifié ICI (§13.3 « Modification
     * après le délai »), jamais par l'interface seule.
     */
    public static function corriger(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['enseignant', 'chef']);
        $parametres = Parametres::lire();

        $seance = Garde::seanceDeSonPerimetre($ctx, $p['sessionId']);
        if ((int) $seance['roll_code_ok'] !== 1) {
            throw Erreurs::invalide("Ce relevé n'a pas encore été validé.");
        }

        $estEnseignantDeLaSeance = $ctx->teacherId !== null && $seance['teacher_id'] === $ctx->teacherId;

        $estChefCompetent = false;
        if ($ctx->aLeRole('chef')) {
            $classe = Db::un('SELECT filiere_id FROM classes WHERE id = ?', [$seance['classe_id']]);
            $estChefCompetent = $classe !== null
                && in_array($classe['filiere_id'], Garde::filieresDuChef($ctx), true);
        }

        if (!$estEnseignantDeLaSeance && !$estChefCompetent) {
            throw Erreurs::perimetre();
        }

        if ($estEnseignantDeLaSeance && !$estChefCompetent) {
            $heures = (int) $parametres['delaiCorrectionHeures'];
            if (Outils::ecart($seance['roll_validated_at'], $meta['recuA']) > $heures * 3600) {
                throw Erreurs::invalide(
                    "Le délai de correction de $heures h est dépassé. "
                    . 'Seul le chef de département peut encore modifier ce relevé.'
                );
            }
        }

        $eleves   = self::elevesDeLaClasse($seance['classe_id']);
        $presents = array_values(array_intersect($p['presents'] ?? [], $eleves));

        $avant = array_column(
            Db::tout('SELECT student_id FROM session_presents WHERE session_id = ?', [$seance['id']]),
            'student_id'
        );

        Db::transaction(function () use ($seance, $presents, $meta) {
            Db::supprimer('session_presents', ['session_id' => $seance['id']]);
            foreach ($presents as $studentId) {
                Db::inserer('session_presents', [
                    'session_id' => $seance['id'],
                    'student_id' => $studentId,
                ]);
            }
            Db::modifier(
                'sessions',
                ['roll_last_edit_at' => $meta['recuA']],
                ['id' => $seance['id']]
            );
        });

        $seance = self::rafraichirEtat(Db::un('SELECT * FROM sessions WHERE id = ?', [$seance['id']]));

        Historique::ajouter([
            'entity'      => 'releve',
            'entityId'    => $seance['id'],
            'action'      => 'releve_corrige',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'field'       => 'presents',
            'before'      => $avant,
            'after'       => $presents,
            'note'        => $p['motif'] ?? null,
        ]);

        return ['ok' => true, 'status' => $seance['status'], 'presents' => count($presents)];
    }

    /* ================================================================= *
     *  Scan de présence, côté étudiant (§5)
     * ================================================================= */

    /**
     *  §13.4 « Scan forgé sans code »   — le jeton secret de la séance est exigé.
     *  §13.3 « Étudiant hors classe »   — appartenance à la classe vérifiée.
     *  §13.4 « Double scan »            — clef primaire (session, étudiant).
     *  §9    — un scan arrivé avant la séance est gardé en attente.
     */
    public static function scanPresence(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['etudiant']);
        if ($ctx->studentId === null) {
            throw Erreurs::droits();
        }
        Limites::exigerAutorise('scan', $ctx->userId);

        $lu = QrCodes::lirePresence($p['qr']);
        if ($lu === null) {
            Limites::echec('scan', $ctx->userId, ['raison' => 'format']);
            throw Erreurs::invalide("Ce code n'est pas un code de présence.");
        }

        $seance = Db::un('SELECT * FROM sessions WHERE id = ?', [$lu['sessionId']]);

        // §9 : le scan peut précéder la séance si le secrétariat était hors ligne.
        if ($seance === null) {
            Db::run(
                'INSERT INTO attendance
                   (session_id, student_id, id, status, source, at, received_at, device_id, token_presente)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE received_at = VALUES(received_at)',
                [
                    $lu['sessionId'], $ctx->studentId, Outils::uuid(), 'attente_seance', 'scan',
                    $meta['recuA'], $meta['recuA'], $p['deviceId'], $lu['scanToken'],
                ]
            );
            return [
                'status'  => 'attente_seance',
                'message' => "Scan enregistré. La séance n'est pas encore connue du serveur.",
            ];
        }

        // Jeton secret : un scan sans lui est refusé.
        if (!Outils::memeSecret($lu['scanToken'], $seance['scan_token'])) {
            Limites::echec('scan', $ctx->userId, ['raison' => 'jeton']);
            Historique::anomalie([
                'kind'      => 'scan_jeton_invalide',
                'titre'     => 'Scan de présence sans jeton valide',
                'detail'    => 'Un scan a été présenté avec un jeton de séance incorrect.',
                'sessionId' => $seance['id'],
                'subjectId' => $ctx->studentId,
                'severity'  => 'grave',
            ]);
            throw Erreurs::invalide('Code de présence invalide.');
        }

        // Lève « perimetre » si l'étudiant n'est pas de cette classe (§12).
        Garde::exigerEtudiantDeLaSeance($ctx, $seance);

        $probleme = Regles::fenetreDeScan($seance, $meta['recuA'], QrCodes::TOLERANCE_SCAN);
        if ($probleme !== null) {
            throw Erreurs::invalide($probleme);
        }

        $existant = Db::un(
            'SELECT * FROM attendance WHERE session_id = ? AND student_id = ?',
            [$seance['id'], $ctx->studentId]
        );

        if ($existant !== null && $existant['status'] === 'present') {
            // Doublon ignoré, sans erreur : un étudiant ne compte qu'une fois.
            return ['status' => 'present', 'duplicate' => true];
        }

        // §13.4 « Scan pour un camarade » : deux comptes, un seul appareil.
        $memeAppareil = Db::compte(
            'SELECT COUNT(*) FROM attendance WHERE session_id = ? AND device_id = ? AND student_id <> ?',
            [$seance['id'], $p['deviceId'], $ctx->studentId]
        );

        Db::run(
            'INSERT INTO attendance
               (session_id, student_id, id, status, source, at, received_at, device_id, token_presente)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
             ON DUPLICATE KEY UPDATE
               status = VALUES(status), at = VALUES(at),
               received_at = VALUES(received_at), device_id = VALUES(device_id),
               token_presente = NULL',
            [
                $seance['id'], $ctx->studentId, $existant['id'] ?? Outils::uuid(),
                'present', 'scan', $meta['recuA'], $meta['recuA'], $p['deviceId'],
            ]
        );

        if ($memeAppareil > 0) {
            Historique::anomalie([
                'kind'      => 'appareil_partage',
                'titre'     => 'Deux comptes sur un même appareil',
                'detail'    => 'Deux étudiants ont scanné la même séance depuis le même téléphone.',
                'sessionId' => $seance['id'],
                'subjectId' => $ctx->studentId,
                'severity'  => 'attention',
            ]);
        }

        return ['status' => 'present', 'duplicate' => false];
    }

    /**
     * §9 : les scans arrivés avant leur séance sont rattachés dès qu'elle
     * existe. Appelé après chaque arrivée de séance et à chaque lecture.
     */
    public static function rattacherScansEnAttente(): int
    {
        $enAttente = Db::tout("SELECT * FROM attendance WHERE status = 'attente_seance'");
        $rattaches = 0;

        foreach ($enAttente as $ligne) {
            $seance = Db::un('SELECT * FROM sessions WHERE id = ?', [$ligne['session_id']]);
            if ($seance === null) {
                continue;
            }

            $jetonOk  = Outils::memeSecret($ligne['token_presente'] ?? '', $seance['scan_token']);
            $etudiant = Db::un('SELECT classe_id FROM students WHERE id = ?', [$ligne['student_id']]);
            $memeClasse = $etudiant !== null && $etudiant['classe_id'] === $seance['classe_id'];
            $fenetre  = Regles::fenetreDeScan($seance, $ligne['received_at'], QrCodes::TOLERANCE_SCAN);

            if ($jetonOk && $memeClasse && $fenetre === null) {
                Db::modifier(
                    'attendance',
                    ['status' => 'present', 'token_presente' => null],
                    ['session_id' => $ligne['session_id'], 'student_id' => $ligne['student_id']]
                );
                $rattaches++;
            } else {
                Db::modifier(
                    'attendance',
                    [
                        'status'         => 'refuse',
                        'token_presente' => null,
                        'raison'         => !$jetonOk ? 'jeton' : (!$memeClasse ? 'classe' : 'fenetre'),
                    ],
                    ['session_id' => $ligne['session_id'], 'student_id' => $ligne['student_id']]
                );
            }
        }

        return $rattaches;
    }
}
