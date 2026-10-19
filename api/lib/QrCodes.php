<?php
declare(strict_types=1);

/**
 * Les trois codes du §4, vérifiés côté serveur.
 *
 * Transcription de `src/lib/qr-codes.js`. L'application produit les codes,
 * le serveur les VÉRIFIE : c'est ici que se joue la sécurité.
 *
 *  §13.1 « Injection par code QR »       — le contenu scanné est une donnée,
 *                                          au format strict, jamais une URL.
 *  §13.4 « Photo du code QR de pointage » — fenêtre de 60 secondes.
 *  §13.4 « Code QR de pointage fabriqué » — signature HMAC avec la clef du poste.
 *  §13.4 « Rejeu d'un pointage »          — nonce à usage unique (table used_tokens).
 *  §13.4 « Scan forgé sans code »         — jeton secret dans le QR de présence.
 */
final class QrCodes
{
    /** Le code de pointage change toutes les 60 secondes (§4). */
    public const DUREE_CRENEAU = 60;

    /** On accepte le créneau précédent, pour les horloges légèrement décalées. */
    public const TOLERANCE_CRENEAUX = 1;

    /** 5 minutes de tolérance sur les scans de présence (§5). */
    public const TOLERANCE_SCAN = 300;

    private const PREFIXE_POINTAGE = 'PRESENCES.P1';
    private const PREFIXE_PRESENCE = 'PRESENCES.A1';

    // Format strict : PRESENCES.P1.<station>.<creneau>.<nonce>.<signature>
    private const RE_POINTAGE = '/^PRESENCES\.P1\.([A-Za-z0-9_-]{1,40})\.(\d{1,15})\.([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]{16,64})$/';
    private const RE_PRESENCE = '/^PRESENCES\.A1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{24,64})$/';

    public static function creneau(?int $instant = null): int
    {
        return intdiv($instant ?? time(), self::DUREE_CRENEAU);
    }

    /* ----------------------------------------------------------------- *
     *  1. Code QR de pointage — affiché par la secrétaire
     * ----------------------------------------------------------------- */

    /**
     * Analyse sans confiance le texte lu par la caméra.
     *
     * Retourne null dès que le format n'est pas exactement celui attendu : on
     * ne tente aucune récupération, et on n'ouvre jamais le contenu comme un
     * lien. Un QR contenant `javascript:` ou `https://` échoue ici.
     */
    public static function lirePointage(string $brut): ?array
    {
        if (mb_strlen($brut) > 256) {
            return null;
        }
        if (!preg_match(self::RE_POINTAGE, trim($brut), $m)) {
            return null;
        }
        return [
            'stationId' => $m[1],
            'creneau'   => (int) $m[2],
            'nonce'     => $m[3],
            'signature' => $m[4],
        ];
    }

    /** Message signé. Doit correspondre exactement à celui de l'application. */
    private static function messagePointage(string $stationId, int $creneau, string $nonce): string
    {
        return self::PREFIXE_POINTAGE . '|' . $stationId . '|' . $creneau . '|' . $nonce;
    }

    /**
     * Vérifie un code de pointage. Trois contrôles indépendants : format,
     * fraîcheur, signature. L'usage unique est vérifié par l'appelant, seul à
     * pouvoir écrire dans `used_tokens`.
     *
     * @return array{ok:bool, raison?:string, parsed?:array}
     */
    public static function verifierPointage(string $brut, string $secret, ?int $recuA = null): array
    {
        $parsed = self::lirePointage($brut);
        if ($parsed === null) {
            return ['ok' => false, 'raison' => 'format'];
        }

        $creneauActuel = self::creneau($recuA);
        if ($parsed['creneau'] > $creneauActuel
            || $parsed['creneau'] < $creneauActuel - self::TOLERANCE_CRENEAUX) {
            // Une photo prise 5 minutes plus tôt tombe forcément ici (§12).
            return ['ok' => false, 'raison' => 'expire', 'parsed' => $parsed];
        }

        $attendue = self::signer(
            $secret,
            self::messagePointage($parsed['stationId'], $parsed['creneau'], $parsed['nonce'])
        );

        if (!Outils::memeSecret($attendue, $parsed['signature'])) {
            return ['ok' => false, 'raison' => 'signature', 'parsed' => $parsed];
        }

        return ['ok' => true, 'parsed' => $parsed];
    }

    /** HMAC-SHA256, encodé comme côté application (base64url). */
    private static function signer(string $secret, string $message): string
    {
        $brut = hash_hmac('sha256', $message, $secret, true);
        return rtrim(strtr(base64_encode($brut), '+/', '-_'), '=');
    }

    /** Clef de signature d'un poste de pointage. Ne sort pas du serveur. */
    public static function nouveauSecretPoste(): string
    {
        return Outils::jeton(32);
    }

    /* ----------------------------------------------------------------- *
     *  2. Code QR de présence — affiché par l'enseignant
     * ----------------------------------------------------------------- */

    /** Jeton secret de séance, créé au pointage d'arrivée (§13.4). */
    public static function nouveauJetonScan(): string
    {
        return Outils::jeton(24);
    }

    public static function lirePresence(string $brut): ?array
    {
        if (mb_strlen($brut) > 256) {
            return null;
        }
        if (!preg_match(self::RE_PRESENCE, trim($brut), $m)) {
            return null;
        }
        return ['sessionId' => $m[1], 'scanToken' => $m[2]];
    }

    /* ----------------------------------------------------------------- *
     *  3. Code de séance — remis de la main à la main
     * ----------------------------------------------------------------- */

    /** Nombre d'essais avant blocage (§13.4 « Code de séance deviné »). */
    public const MAX_ESSAIS_CODE = 5;

    /**
     * Un contenu scanné n'est JAMAIS une adresse. Cette fonction existe pour
     * que le refus soit explicite dans les journaux (§13.1).
     */
    public static function ressembleAUneUrl(string $brut): bool
    {
        return (bool) preg_match('/^[a-z][a-z0-9+.-]*:/i', trim($brut));
    }
}
