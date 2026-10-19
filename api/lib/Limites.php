<?php
declare(strict_types=1);

/**
 * Limitation des essais.
 *
 *  §13.2 « Force brute »             — essais de connexion
 *  §13.4 « Code de séance deviné »   — 5 essais, puis blocage
 *  §13.6 « Absence de limite de débit »
 *  §13.12 « Attaques non détectées » — chaque blocage est journalisé et
 *          remonte dans l'écran « Anomalies »
 *
 * Le délai croît avec le nombre de blocages successifs : un attaquant qui
 * insiste attend de plus en plus longtemps.
 */
final class Limites
{
    private const REGLES = [
        'connexion'   => ['max' => 5,   'fenetre' => 900,  'blocages' => [60, 300, 900]],
        'code_seance' => ['max' => 5,   'fenetre' => 1800, 'blocages' => [300, 900, 3600]],
        'scan'        => ['max' => 60,  'fenetre' => 60,   'blocages' => [60]],
        'synchro'     => ['max' => 300, 'fenetre' => 60,   'blocages' => [30]],
        'import'      => ['max' => 5,   'fenetre' => 3600, 'blocages' => [600]],
    ];

    private static function clef(string $portee, ?string $sujet): string
    {
        return mb_substr($portee . ':' . ($sujet ?? 'anonyme'), 0, 100);
    }

    /**
     * Vérifie qu'une action est permise. Lève « bloqué » si la limite est
     * atteinte. À appeler AVANT de faire le travail.
     */
    public static function exigerAutorise(string $portee, ?string $sujet): void
    {
        $regle = self::REGLES[$portee] ?? null;
        if ($regle === null) {
            return;
        }

        $clef = self::clef($portee, $sujet);
        $ligne = Db::un('SELECT * FROM attempts WHERE `key` = ?', [$clef]);
        if ($ligne === null) {
            return;
        }

        $maintenant = Outils::maintenant();

        if ($ligne['locked_until'] !== null && $ligne['locked_until'] > $maintenant) {
            $minutes = max(1, (int) ceil(Outils::ecart($maintenant, $ligne['locked_until']) / 60));
            throw Erreurs::bloque($minutes);
        }

        // La fenêtre est écoulée : le compteur repart de zéro.
        if (Outils::ecart($ligne['window_start'], $maintenant) > $regle['fenetre']) {
            Db::modifier(
                'attempts',
                ['count' => 0, 'window_start' => $maintenant, 'locked_until' => null],
                ['key' => $clef]
            );
        }
    }

    /** Enregistre un échec. Bloque quand la limite est franchie. */
    public static function echec(string $portee, ?string $sujet, array $contexte = []): array
    {
        $regle = self::REGLES[$portee] ?? null;
        if ($regle === null) {
            return ['bloque' => false, 'restants' => null];
        }

        $clef = self::clef($portee, $sujet);
        $maintenant = Outils::maintenant();

        $ligne = Db::un('SELECT * FROM attempts WHERE `key` = ?', [$clef]);
        if ($ligne === null) {
            $ligne = [
                'key'          => $clef,
                'count'        => 0,
                'window_start' => $maintenant,
                'locked_until' => null,
                'strikes'      => 0,
            ];
            Db::inserer('attempts', $ligne);
        }

        $compte  = (int) $ligne['count'];
        $debut   = $ligne['window_start'];
        $strikes = (int) $ligne['strikes'];

        if (Outils::ecart($debut, $maintenant) > $regle['fenetre']) {
            $compte = 0;
            $debut  = $maintenant;
        }

        $compte++;
        $bloque = false;
        $verrou = null;

        if ($compte >= $regle['max']) {
            $palier = min($strikes, count($regle['blocages']) - 1);
            $verrou = Outils::dans($regle['blocages'][$palier]);
            $strikes++;
            $compte = 0;
            $debut  = $maintenant;
            $bloque = true;

            Journal::ecrire('limite_atteinte', array_merge(['portee' => $portee, 'strikes' => $strikes], $contexte));
            Historique::anomalie([
                'kind'      => 'limite_atteinte',
                'titre'     => "Trop d'essais ({$portee})",
                'detail'    => "Blocage temporaire après {$regle['max']} échecs.",
                'subjectId' => $contexte['subjectId'] ?? null,
                'severity'  => 'attention',
            ]);
        } else {
            Journal::ecrire('echec', array_merge(['portee' => $portee, 'compte' => $compte], $contexte));
        }

        Db::modifier(
            'attempts',
            [
                'count'        => $compte,
                'window_start' => $debut,
                'locked_until' => $verrou,
                'strikes'      => $strikes,
            ],
            ['key' => $clef]
        );

        return ['bloque' => $bloque, 'restants' => max(0, $regle['max'] - $compte)];
    }

    /** Remet le compteur à zéro après une réussite. */
    public static function reussite(string $portee, ?string $sujet): void
    {
        Db::supprimer('attempts', ['key' => self::clef($portee, $sujet)]);
    }

    /** Essais restants, pour l'afficher à l'utilisateur légitime. */
    public static function restants(string $portee, ?string $sujet): ?int
    {
        $regle = self::REGLES[$portee] ?? null;
        if ($regle === null) {
            return null;
        }
        $ligne = Db::un('SELECT * FROM attempts WHERE `key` = ?', [self::clef($portee, $sujet)]);
        if ($ligne === null) {
            return $regle['max'];
        }
        if ($ligne['locked_until'] !== null && $ligne['locked_until'] > Outils::maintenant()) {
            return 0;
        }
        return max(0, $regle['max'] - (int) $ligne['count']);
    }
}
