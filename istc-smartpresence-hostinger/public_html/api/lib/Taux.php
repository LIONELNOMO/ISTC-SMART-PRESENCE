<?php
declare(strict_types=1);

/**
 * Taux horaires et coûts (§7).
 *
 *  §13.3 « Fuite des taux et des montants » — ce fichier n'est appelé que
 *         derrière `Garde::exigerMontants()`. Aucune projection non
 *         administrative ne le charge.
 *  §13.4 « Taux modifié rétroactivement »  — la date d'effet est obligatoire,
 *         et le coût d'une séance passée est figé au taux en vigueur ce jour-là.
 */
final class Taux
{
    /** Priorités du §7 : du plus précis au plus général. */
    public const PORTEES = [
        'enseignant_matiere' => 1,
        'enseignant_niveau'  => 2,
        'niveau'             => 3,
    ];

    public const LIBELLES = [
        'enseignant_matiere' => 'Enseignant + matière',
        'enseignant_niveau'  => 'Enseignant + niveau',
        'niveau'             => 'Niveau',
    ];

    /**
     * Taux applicable à une séance, à sa date.
     *
     * Règle : parmi les taux dont la date d'effet est antérieure ou égale au
     * jour de la séance, on prend le plus précis ; à précision égale, le plus
     * récent. C'est ce qui garantit qu'un taux créé aujourd'hui ne change pas
     * le coût d'hier.
     *
     * @return array{montant:int, scope:string, rateId:string}|null
     */
    public static function resoudre(
        array $tauxDisponibles,
        ?string $teacherId,
        ?string $matiereId,
        ?int $niveau,
        string $jour
    ): ?array {
        $candidats = [];

        foreach ($tauxDisponibles as $t) {
            if ($t['date_effet'] > $jour) {
                continue;
            }

            $priorite = null;
            if ($t['scope'] === 'enseignant_matiere'
                && $t['teacher_id'] === $teacherId
                && $t['matiere_id'] === $matiereId) {
                $priorite = 1;
            } elseif ($t['scope'] === 'enseignant_niveau'
                && $t['teacher_id'] === $teacherId
                && (int) $t['niveau'] === $niveau) {
                $priorite = 2;
            } elseif ($t['scope'] === 'niveau' && (int) $t['niveau'] === $niveau) {
                $priorite = 3;
            }

            if ($priorite !== null) {
                $candidats[] = ['taux' => $t, 'priorite' => $priorite];
            }
        }

        if (count($candidats) === 0) {
            return null;
        }

        usort($candidats, function (array $a, array $b): int {
            if ($a['priorite'] !== $b['priorite']) {
                return $a['priorite'] <=> $b['priorite'];
            }
            // Même précision : la date d'effet la plus récente gagne.
            $cmp = strcmp($b['taux']['date_effet'], $a['taux']['date_effet']);
            if ($cmp !== 0) {
                return $cmp;
            }
            return strcmp((string) $b['taux']['created_at'], (string) $a['taux']['created_at']);
        });

        $gagnant = $candidats[0]['taux'];
        return [
            'montant' => (int) $gagnant['montant'],
            'scope'   => $gagnant['scope'],
            'rateId'  => $gagnant['id'],
        ];
    }

    /**
     * Coût d'une séance.
     *
     * `montant` vaut null quand aucun taux ne s'applique : le §7 demande que
     * le coût reste vide et que le cas soit signalé à l'administration.
     */
    public static function coutSeance(array $seance, array $tauxDisponibles): array
    {
        if (Regles::etat($seance) !== Regles::TERMINEE) {
            return ['heures' => 0.0, 'montant' => null, 'taux' => null, 'raison' => 'non_terminee'];
        }

        $heures = Regles::heuresPayees($seance);
        $resolu = self::resoudre(
            $tauxDisponibles,
            $seance['teacher_id'],
            $seance['matiere_id'],
            (int) $seance['niveau'],
            $seance['day']
        );

        if ($resolu === null) {
            return ['heures' => $heures, 'montant' => null, 'taux' => null, 'raison' => 'aucun_taux'];
        }

        return [
            'heures'  => $heures,
            // Le montant est arrondi à l'unité monétaire (§7).
            'montant' => (int) round($heures * $resolu['montant']),
            'taux'    => $resolu['montant'],
            'scope'   => $resolu['scope'],
            'rateId'  => $resolu['rateId'],
            'raison'  => null,
        ];
    }

    /**
     * Cohérence d'un taux avant écriture : la portée impose les champs
     * présents. §13.3 « Affectation de masse » : un taux « niveau » ne peut
     * pas porter un teacherId en douce.
     *
     * La base pose la même contrainte (`ck_rates_coherence`) : ce contrôle-ci
     * sert à renvoyer un message clair plutôt qu'une erreur SQL.
     */
    public static function problemeDeTaux(array $t): ?string
    {
        if ($t['scope'] === 'enseignant_matiere') {
            if (empty($t['teacherId']) || empty($t['matiereId'])) {
                return 'Choisissez un enseignant et une matière.';
            }
            if (!empty($t['niveau'])) {
                return 'Un taux enseignant + matière ne porte pas de niveau.';
            }
            return null;
        }

        if ($t['scope'] === 'enseignant_niveau') {
            if (empty($t['teacherId']) || empty($t['niveau'])) {
                return 'Choisissez un enseignant et un niveau.';
            }
            if (!empty($t['matiereId'])) {
                return 'Un taux enseignant + niveau ne porte pas de matière.';
            }
            return null;
        }

        if ($t['scope'] === 'niveau') {
            if (empty($t['niveau'])) {
                return 'Choisissez un niveau.';
            }
            if (!empty($t['teacherId']) || !empty($t['matiereId'])) {
                return 'Un taux par niveau ne porte ni enseignant ni matière.';
            }
            return null;
        }

        return 'Portée inconnue.';
    }

    /** Tous les taux. Lecture réservée à l'administration. */
    public static function tous(): array
    {
        return Db::tout('SELECT * FROM rates ORDER BY date_effet DESC, created_at DESC');
    }

    /** Description lisible d'un taux, sans son montant. */
    public static function decrire(array $t, ?string $enseignant, ?string $matiere): string
    {
        if ($t['scope'] === 'enseignant_matiere') {
            return ($enseignant ?? 'Enseignant') . ' — ' . ($matiere ?? 'matière');
        }
        if ($t['scope'] === 'enseignant_niveau') {
            return ($enseignant ?? 'Enseignant') . ' — niveau ' . $t['niveau'];
        }
        return 'Tous les cours de niveau ' . $t['niveau'];
    }
}
