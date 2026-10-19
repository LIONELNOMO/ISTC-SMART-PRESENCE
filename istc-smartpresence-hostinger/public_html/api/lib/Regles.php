<?php
declare(strict_types=1);

/**
 * Les règles de calcul du cahier des charges, et personne d'autre ne les applique.
 *
 * Transcription de `src/server/rules.js` :
 *
 *  §13.3 « Changement d'état interdit » — l'état d'une séance est CALCULÉ ici,
 *         à partir de ses trois éléments. Aucun client ne peut l'écrire.
 *  §13.8 « Sécurité calculée côté client » — heures payées, écart non payé,
 *         absences : tout est calculé ici, jamais accepté depuis un téléphone.
 *  §13.4 « Durées impossibles »        — contrôles de cohérence avant écriture.
 *  §13.4 « Relevé de complaisance »    — écarts entre scans, comptage et liste.
 */
final class Regles
{
    public const EN_COURS   = 'en_cours';
    public const TERMINEE   = 'terminee';
    public const INCOMPLETE = 'incomplete';

    /** Durée maximale plausible d'une séance (§13.4). */
    public const HEURES_MAX = 12;

    /**
     * État d'une séance. Les trois éléments du §4 :
     *   1. arrivée pointée au secrétariat
     *   2. relevé validé avec le bon code de séance
     *   3. départ pointé au secrétariat
     */
    public static function etat(array $s): string
    {
        if (empty($s['arrival_at'])) {
            return self::INCOMPLETE;
        }

        $releveValide = !empty($s['roll_validated_at']) && (int) ($s['roll_code_ok'] ?? 0) === 1;

        if (empty($s['departure_at'])) {
            // L'enseignant est encore à l'école : « en cours ». S'il a déjà
            // rendu son relevé sans pointer son départ, la séance est incomplète.
            return $releveValide ? self::INCOMPLETE : self::EN_COURS;
        }

        return $releveValide ? self::TERMINEE : self::INCOMPLETE;
    }

    /** Ce qui manque à une séance, pour l'écran « Séances du jour ». */
    public static function manque(array $s): array
    {
        $manque = [];
        if (empty($s['arrival_at'])) {
            $manque[] = 'arrivée';
        }
        if (empty($s['roll_validated_at'])) {
            $manque[] = 'relevé';
        } elseif ((int) ($s['roll_code_ok'] ?? 0) !== 1) {
            $manque[] = 'code de séance correct';
        }
        if (empty($s['departure_at'])) {
            $manque[] = 'départ';
        }
        return $manque;
    }

    /**
     * Heures payées (§4, §7) : départ − arrivée, pointés au secrétariat, à la
     * minute près. L'heure du relevé n'allonge jamais la durée.
     * Seules les séances « terminées » comptent.
     */
    public static function heuresPayees(array $s): float
    {
        if (self::etat($s) !== self::TERMINEE) {
            return 0.0;
        }
        $h = Outils::heuresEntre($s['arrival_at'], $s['departure_at']);
        return ($h !== null && $h > 0) ? $h : 0.0;
    }

    /**
     * Écart non payé (§4) : temps entre le départ pointé et la validation du
     * relevé, quand le relevé arrive après le départ.
     *
     * §14 : l'exemple du client (30 minutes) ne permet pas de fixer une autre
     * règle. Celle retenue est celle du §4, littéralement : « le temps en
     * dehors de la trace du secrétariat n'est pas payé ».
     */
    public static function ecartNonPaye(array $s): float
    {
        if (empty($s['roll_validated_at']) || empty($s['departure_at'])) {
            return 0.0;
        }
        $h = Outils::heuresEntre($s['departure_at'], $s['roll_validated_at']);
        return ($h !== null && $h > 0) ? $h : 0.0;
    }

    /* ----------------------------------------------------------------- *
     *  Cohérence — appelé AVANT toute écriture
     * ----------------------------------------------------------------- */

    /**
     * Vérifie qu'un couple arrivée/départ est plausible.
     * @return string|null le motif du refus, ou null si tout va bien.
     */
    public static function heuresPlausibles(?string $arrivee, ?string $depart): ?string
    {
        if ($arrivee === null) {
            return "L'heure d'arrivée est obligatoire.";
        }
        if ($depart === null) {
            return null;
        }

        $ecart = Outils::ecart($arrivee, $depart);

        if ($ecart <= 0) {
            return "Le départ ne peut pas précéder l'arrivée.";
        }
        if ($ecart > self::HEURES_MAX * 3600) {
            return 'Une séance ne peut pas dépasser ' . self::HEURES_MAX . ' heures.';
        }
        // §13.4 : une séance ne chevauche pas deux jours civils.
        if (Outils::jour($arrivee) !== Outils::jour($depart)) {
            return 'Une séance ne peut pas être à cheval sur deux jours.';
        }
        return null;
    }

    /**
     * §5 : fenêtre de scan. Un scan hors de la période d'ouverture du relevé
     * est refusé, avec 5 minutes de tolérance pour les écarts d'horloge.
     */
    public static function fenetreDeScan(array $s, string $recuA, int $tolerance): ?string
    {
        if (empty($s['roll_opened_at'])) {
            return "Le relevé de présences n'est pas ouvert.";
        }
        if (Outils::ecart($s['roll_opened_at'], $recuA) < -$tolerance) {
            return "Scan effectué avant l'ouverture du relevé.";
        }
        if (!empty($s['roll_closed_at'])
            && Outils::ecart($s['roll_closed_at'], $recuA) > $tolerance) {
            return 'Scan effectué après la fermeture du relevé.';
        }
        return null;
    }

    /* ----------------------------------------------------------------- *
     *  Écarts à signaler (§5, §13.4)
     * ----------------------------------------------------------------- */

    /**
     * Compare les trois sources : scans reçus, nombre de personnes comptées
     * dans la salle, liste cochée par l'enseignant.
     */
    public static function comparerLesComptes(
        int $scans,
        ?int $comptePhysique,
        int $coches,
        int $effectif
    ): array {
        $ecarts = [];

        if ($comptePhysique !== null) {
            if ($scans !== $comptePhysique) {
                $ecarts[] = [
                    'kind'     => 'scans_vs_comptage',
                    'message'  => self::accord($scans, 'scan', 'reçu') . ' pour '
                        . self::accord($comptePhysique, 'personne', 'comptée') . ' dans la salle.',
                    'severity' => 'attention',
                ];
            }
            if ($coches !== $comptePhysique) {
                $ecarts[] = [
                    'kind'     => 'liste_vs_comptage',
                    'message'  => self::accord($coches, 'étudiant', 'coché') . ' pour '
                        . self::accord($comptePhysique, 'personne', 'comptée') . '.',
                    'severity' => 'attention',
                ];
            }
        }

        // Relevé de complaisance : toute la classe cochée sans aucun scan.
        if ($effectif > 0 && $coches === $effectif && $scans === 0) {
            $ecarts[] = [
                'kind'     => 'classe_entiere',
                'message'  => "Toute la classe est cochée ($effectif) sans aucun scan reçu.",
                'severity' => 'attention',
            ];
        }

        return $ecarts;
    }

    /** Accord en nombre, pour des messages lisibles. */
    private static function accord(int $n, string $nom, string $participe): string
    {
        $s = $n > 1 ? 's' : '';
        return "$n $nom$s $participe$s";
    }
}
