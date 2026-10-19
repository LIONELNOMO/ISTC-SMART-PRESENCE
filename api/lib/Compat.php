<?php
declare(strict_types=1);

/**
 * Compatibilité avec les versions de PHP encore répandues en mutualisé.
 *
 * L'API vise PHP 8.0 et au-delà : c'est ce que servent la plupart des
 * hébergements mutualisés, et ce que fournit XAMPP. Les quelques fonctions
 * apparues plus tard sont redéfinies ici, à l'identique.
 */

if (!function_exists('array_is_list')) {
    /**
     * Vrai si le tableau est une liste : clefs entières, de 0 à n-1, sans trou.
     * Introduite en PHP 8.1.
     *
     * Sert à distinguer une liste d'un objet JSON — distinction sur laquelle
     * repose le refus des injections NoSQL (§13.1).
     */
    function array_is_list(array $tableau): bool
    {
        $attendue = 0;
        foreach ($tableau as $clef => $_) {
            if ($clef !== $attendue) {
                return false;
            }
            $attendue++;
        }
        return true;
    }
}

if (!function_exists('str_contains')) {
    // Introduite en PHP 8.0 ; présente ici par prudence si l'hébergeur est en 7.4.
    function str_contains(string $botte, string $aiguille): bool
    {
        return $aiguille === '' || strpos($botte, $aiguille) !== false;
    }
}

if (!function_exists('str_starts_with')) {
    function str_starts_with(string $botte, string $aiguille): bool
    {
        return strncmp($botte, $aiguille, strlen($aiguille)) === 0;
    }
}
