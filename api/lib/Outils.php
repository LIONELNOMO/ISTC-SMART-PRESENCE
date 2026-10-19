<?php
declare(strict_types=1);

/**
 * Primitives partagées : aléa, dates, comparaisons.
 *
 * §13.11 « Aléa et chiffrement faibles » : tout ce qui sert de code, de jeton
 * ou d'identifiant est tiré avec `random_bytes()`, jamais avec `rand()` ni
 * `mt_rand()`, qui sont prévisibles.
 */
final class Outils
{
    /** Alphabet sans caractères ambigus : ni O/0, ni I/1, ni S/5, ni B/8. */
    private const ALPHABET_CODE = 'ACDEFGHJKLMNPQRTUVWXY34679';

    /** Identifiant non devinable (§13.3 « Identifiants devinables »). */
    public static function uuid(): string
    {
        $o = random_bytes(16);
        $o[6] = chr((ord($o[6]) & 0x0f) | 0x40);
        $o[8] = chr((ord($o[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($o), 4));
    }

    /**
     * Code de séance : tirage uniforme par rejet.
     *
     * Le rejet évite le biais du modulo : sans lui, les premières lettres de
     * l'alphabet sortiraient un peu plus souvent, ce qui réduirait l'espace
     * réellement à couvrir pour deviner un code (§13.4).
     */
    public static function code(int $longueur = 6): string
    {
        $n = strlen(self::ALPHABET_CODE);
        $limite = intdiv(256, $n) * $n;
        $sortie = '';

        while (strlen($sortie) < $longueur) {
            foreach (str_split(random_bytes($longueur * 2)) as $octet) {
                $v = ord($octet);
                if ($v >= $limite) {
                    continue;
                }
                $sortie .= self::ALPHABET_CODE[$v % $n];
                if (strlen($sortie) === $longueur) {
                    break;
                }
            }
        }
        return $sortie;
    }

    /** Jeton opaque, en base64url (§13.4 « Scan forgé sans code »). */
    public static function jeton(int $octets = 24): string
    {
        return rtrim(strtr(base64_encode(random_bytes($octets)), '+/', '-_'), '=');
    }

    /** Mot de passe provisoire lisible, jamais dérivé du matricule (§13.2). */
    public static function motDePasseProvisoire(): string
    {
        return self::code(4) . '-' . self::code(4);
    }

    /**
     * Comparaison à temps constant.
     *
     * `hash_equals` ne révèle pas, par sa durée, à quel caractère deux chaînes
     * commencent à différer — ce qui permettrait de deviner un code à l'essai.
     */
    public static function memeSecret(?string $a, ?string $b): bool
    {
        return hash_equals((string) $a, (string) $b);
    }

    /* ----------------------------------------------------------------- *
     *  Dates — tout est en UTC (§13.4 « Durées impossibles »)
     * ----------------------------------------------------------------- */

    /** Maintenant, au format MySQL. */
    public static function maintenant(): string
    {
        return gmdate('Y-m-d H:i:s');
    }

    /** Convertit un instant ISO 8601 en format MySQL, ou null s'il est illisible. */
    public static function versMysql(?string $iso): ?string
    {
        if ($iso === null || $iso === '') {
            return null;
        }
        $t = strtotime($iso);
        return $t === false ? null : gmdate('Y-m-d H:i:s', $t);
    }

    /** Convertit une date MySQL en ISO 8601 UTC, pour l'application. */
    public static function versIso(?string $mysql): ?string
    {
        if ($mysql === null || $mysql === '') {
            return null;
        }
        $t = strtotime($mysql . ' UTC');
        return $t === false ? null : gmdate('Y-m-d\TH:i:s\.000\Z', $t);
    }

    /** Ajoute des secondes à maintenant, au format MySQL. */
    public static function dans(int $secondes): string
    {
        return gmdate('Y-m-d H:i:s', time() + $secondes);
    }

    /** Écart en secondes entre deux instants MySQL. */
    public static function ecart(string $a, string $b): int
    {
        return (int) (strtotime($b . ' UTC') - strtotime($a . ' UTC'));
    }

    /** Durée en heures décimales, arrondie à la minute (§4, §7). */
    public static function heuresEntre(?string $debut, ?string $fin): ?float
    {
        if ($debut === null || $fin === null) {
            return null;
        }
        $minutes = (int) round(self::ecart($debut, $fin) / 60);
        return $minutes / 60;
    }

    /** Jour civil d'un instant, au format AAAA-MM-JJ. */
    public static function jour(string $mysql): string
    {
        return substr($mysql, 0, 10);
    }
}
