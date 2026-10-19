<?php
declare(strict_types=1);

/**
 * Paramètres de l'établissement (§3, §8, §14).
 *
 * Les valeurs que le cahier des charges laisse ouvertes n'ont volontairement
 * AUCUNE valeur par défaut : le seuil d'alerte et les dates de semestre doivent
 * être saisis par l'administration. Tant qu'ils sont vides, les écrans le
 * disent au lieu d'inventer un chiffre.
 */
final class Parametres
{
    private const CLEF = 'parametres';

    public const DEFAUTS = [
        'etablissement' => 'Établissement',
        'monnaie'       => 'FCFA',
        // §14 « Seuil d'alerte » : aucune valeur par défaut.
        'seuilAlerteHeures'  => null,
        'seuilAlertePeriode' => 'semestre',
        // §4 : relevé possible pendant 7 jours, réglable.
        'delaiReleveJours'   => 7,
        // §5 : correction du relevé pendant 48 heures, réglable.
        'delaiCorrectionHeures' => 48,
        // §13.2 : durée maximale d'une session hors ligne.
        'dureeSessionHorsLigneJours' => 7,
        'modeleMessage' => 'Bonjour, {{etablissement}} vous informe que {{etudiant}} ({{classe}}) '
            . "totalise {{heures}} d'absence non justifiée sur la période {{periode}}. "
            . 'Nous restons à votre disposition.',
        // §3 : dates fournies par le client.
        'semestres' => null,
    ];

    private static ?array $cache = null;

    public static function lire(): array
    {
        if (self::$cache !== null) {
            return self::$cache;
        }
        $ligne = Db::un('SELECT value FROM settings WHERE `key` = ?', [self::CLEF]);
        $stockees = $ligne === null ? [] : (json_decode($ligne['value'], true) ?: []);
        self::$cache = array_merge(self::DEFAUTS, $stockees);
        return self::$cache;
    }

    /** Écriture réservée à l'administration : l'appelant a vérifié le rôle. */
    public static function ecrire(array $patch): array
    {
        $courant = self::lire();
        foreach ($patch as $clef => $valeur) {
            // Liste blanche : une clef inconnue n'entre pas.
            if (!array_key_exists($clef, self::DEFAUTS)) {
                continue;
            }
            if ($valeur === null) {
                continue;
            }
            $courant[$clef] = $valeur;
        }

        $json = json_encode($courant, JSON_UNESCAPED_UNICODE);
        Db::run(
            'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
            [self::CLEF, $json]
        );

        self::$cache = $courant;
        return $courant;
    }

    /** Liste des semestres exploitable par `semestreDe` (§3). */
    public static function semestres(array $parametres): array
    {
        $s = $parametres['semestres'] ?? null;
        if (!is_array($s)
            || empty($s['s1Debut']) || empty($s['s1Fin'])
            || empty($s['s2Debut']) || empty($s['s2Fin'])) {
            return [];
        }
        return [
            ['id' => 's1', 'nom' => 'Semestre 1', 'debut' => $s['s1Debut'], 'fin' => $s['s1Fin']],
            ['id' => 's2', 'nom' => 'Semestre 2', 'debut' => $s['s2Debut'], 'fin' => $s['s2Fin']],
        ];
    }

    /** Semestre d'une date, déduit des dates saisies par l'administration. */
    public static function semestreDe(?string $jour, array $semestres): ?array
    {
        if ($jour === null) {
            return null;
        }
        $jour = substr($jour, 0, 10);
        foreach ($semestres as $s) {
            if ($jour >= $s['debut'] && $jour <= $s['fin']) {
                return $s;
            }
        }
        return null;
    }

    /** Points obligatoires que l'administration n'a pas encore réglés. */
    public static function manquants(array $parametres): array
    {
        $gaps = [];
        if (empty($parametres['semestres'])) {
            $gaps[] = 'Dates des semestres';
        }
        if ($parametres['seuilAlerteHeures'] === null) {
            $gaps[] = "Seuil d'alerte aux parents";
        }
        return $gaps;
    }
}
