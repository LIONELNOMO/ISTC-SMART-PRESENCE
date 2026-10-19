<?php
declare(strict_types=1);

/**
 * Validation par schéma — la première porte du serveur.
 *
 * Transcription de `src/server/schema.js`, règle pour règle :
 *
 *  §13.1 « Injection NoSQL »        — un tableau là où un texte est attendu
 *                                     est refusé, pas converti.
 *  §13.1 « Pollution de prototype » — __proto__, constructor et prototype
 *                                     sont refusés comme clefs.
 *  §13.1 « Expression coûteuse »    — chaque champ a une longueur maximale.
 *  §13.3 « Affectation de masse »   — une clef non déclarée fait ÉCHOUER la
 *                                     requête, elle n'est pas ignorée.
 *  §13.6 « Entrées non validées »   — type, longueur, format, valeurs permises.
 */
final class Schema
{
    private const CLEFS_DANGEREUSES = ['__proto__', 'prototype', 'constructor'];

    private const RE_UUID      = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';
    private const RE_CODE      = '/^[ACDEFGHJKLMNPQRTUVWXY34679]{6}$/';
    private const RE_PHONE     = '/^\d{8,15}$/';
    private const RE_MATRICULE = '/^[A-Za-z0-9][A-Za-z0-9._-]{1,23}$/';
    private const RE_ISO       = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/';
    private const RE_DATE      = '/^\d{4}-\d{2}-\d{2}$/';
    private const RE_TIME      = '/^([01]\d|2[0-3]):([0-5]\d)$/';
    private const RE_TOKEN     = '/^[A-Za-z0-9_-]{16,64}$/';
    private const RE_SLUG      = '/^[A-Za-z0-9_-]{1,40}$/';

    /**
     * Valide un tableau contre une forme. Lève une ApiErreur au premier écart.
     * Le résultat est un tableau NEUF : rien de non déclaré ne passe.
     */
    public static function valider($entree, array $forme, string $label = 'requête'): array
    {
        if (!is_array($entree) || array_is_list($entree)) {
            throw Erreurs::invalide("$label : format attendu.");
        }

        foreach (array_keys($entree) as $clef) {
            if (in_array((string) $clef, self::CLEFS_DANGEREUSES, true)) {
                throw Erreurs::invalide("$label : clef refusée.");
            }
            if (!array_key_exists($clef, $forme)) {
                $propre = self::nettoyer((string) $clef, 40);
                throw Erreurs::invalide("$label : champ « $propre » non autorisé.");
            }
        }

        $sortie = [];
        foreach ($forme as $clef => $regle) {
            $brut = $entree[$clef] ?? null;

            if ($brut === null || $brut === '') {
                if (!empty($regle['required'])) {
                    throw Erreurs::invalide("$label : « $clef » est obligatoire.");
                }
                $sortie[$clef] = $regle['default'] ?? null;
                continue;
            }

            $valeur = self::verifier($brut, $regle, $label, (string) $clef);
            if ($valeur === null) {
                throw Erreurs::invalide("$label : « $clef » est invalide.");
            }
            $sortie[$clef] = $valeur;
        }

        return $sortie;
    }

    /** Applique une règle à une valeur. Renvoie null si elle ne passe pas. */
    private static function verifier($v, array $regle, string $label, string $clef)
    {
        switch ($regle['type']) {
            case 'uuid':
                return is_string($v) && preg_match(self::RE_UUID, $v) ? strtolower($v) : null;

            case 'code':
                if (!is_string($v)) {
                    return null;
                }
                $maj = preg_replace('/[^A-Z0-9]/', '', strtoupper($v));
                return preg_match(self::RE_CODE, $maj) ? $maj : null;

            case 'token':
                return is_string($v) && preg_match(self::RE_TOKEN, $v) ? $v : null;

            case 'slug':
                return is_string($v) && preg_match(self::RE_SLUG, $v) ? $v : null;

            case 'qr':
                // Le contenu d'un QR est une donnée : on borne sa taille, et
                // c'est `QrCodes` qui en vérifie le format strict (§13.1).
                return is_string($v) && mb_strlen($v) <= 256 ? $v : null;

            case 'matricule':
                return is_string($v) && preg_match(self::RE_MATRICULE, trim($v)) ? trim($v) : null;

            case 'phone':
                if (!is_string($v) && !is_int($v)) {
                    return null;
                }
                $chiffres = preg_replace('/\D/', '', (string) $v);
                return preg_match(self::RE_PHONE, $chiffres) ? $chiffres : null;

            case 'iso':
                return is_string($v) && preg_match(self::RE_ISO, $v) ? $v : null;

            case 'date':
                return is_string($v) && preg_match(self::RE_DATE, $v) ? $v : null;

            case 'time':
                return is_string($v) && preg_match(self::RE_TIME, $v) ? $v : null;

            case 'bool':
                return is_bool($v) ? $v : null;

            case 'text':
                if (is_int($v) || is_float($v)) {
                    return self::nettoyer((string) $v, $regle['max'] ?? 200);
                }
                // Un tableau ou un objet là où un texte est attendu : refusé,
                // jamais converti (§13.1 « Injection NoSQL »).
                if (!is_string($v)) {
                    return null;
                }
                $propre = self::nettoyer($v, $regle['max'] ?? 200);
                if (isset($regle['min']) && mb_strlen($propre) < $regle['min']) {
                    return null;
                }
                return $propre;

            case 'int':
                if (is_bool($v) || !is_numeric($v) || (int) $v != $v) {
                    return null;
                }
                $n = (int) $v;
                if (isset($regle['min']) && $n < $regle['min']) {
                    return null;
                }
                if (isset($regle['max']) && $n > $regle['max']) {
                    return null;
                }
                return $n;

            case 'number':
                if (is_bool($v) || !is_numeric($v)) {
                    return null;
                }
                $n = (float) $v;
                if (isset($regle['min']) && $n < $regle['min']) {
                    return null;
                }
                if (isset($regle['max']) && $n > $regle['max']) {
                    return null;
                }
                return $n;

            case 'enum':
                return in_array($v, $regle['values'], true) ? $v : null;

            case 'uuids':
                if (!is_array($v) || !array_is_list($v)) {
                    return null;
                }
                if (count($v) > ($regle['max'] ?? 500)) {
                    return null;
                }
                $sortie = [];
                foreach ($v as $item) {
                    if (!is_string($item) || !preg_match(self::RE_UUID, $item)) {
                        return null;
                    }
                    $sortie[] = strtolower($item);
                }
                return array_values(array_unique($sortie));

            case 'object':
                if (!is_array($v) || array_is_list($v)) {
                    return null;
                }
                return self::valider($v, $regle['shape'], $regle['label'] ?? $clef);

            case 'raw':
                // Objet dont la forme dépend d'un autre champ : il est repassé
                // par valider() plus loin, avec la forme correspondante. On
                // borne seulement la taille et on refuse les clefs dangereuses.
                if (!is_array($v) || array_is_list($v)) {
                    return null;
                }
                if (count($v) > 40) {
                    return null;
                }
                foreach (array_keys($v) as $k) {
                    if (in_array((string) $k, self::CLEFS_DANGEREUSES, true)) {
                        return null;
                    }
                }
                return $v;

            case 'rawList':
                if (!is_array($v) || !array_is_list($v)) {
                    return null;
                }
                if (count($v) > ($regle['max'] ?? 5000)) {
                    return null;
                }
                foreach ($v as $item) {
                    if (!is_array($item) || array_is_list($item)) {
                        return null;
                    }
                }
                return $v;
        }

        throw Erreurs::interne("Type de schéma inconnu : {$regle['type']}");
    }

    /** Borne la longueur et retire les caractères de contrôle. */
    private static function nettoyer(string $v, int $max): string
    {
        $v = preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u', '', $v);
        return mb_substr(trim($v), 0, $max);
    }

    /* ----------------------------------------------------------------- *
     *  Rôles
     * ----------------------------------------------------------------- */

    public const ROLES = ['etudiant', 'enseignant', 'secretaire', 'chef', 'administration'];

    public const LIBELLES_ROLES = [
        'etudiant'       => 'Étudiant',
        'enseignant'     => 'Enseignant',
        'secretaire'     => 'Secrétaire',
        'chef'           => 'Chef de département',
        'administration' => 'Administration',
    ];

    /**
     * §13.3 « Pointage de soi-même » : le cumul secrétaire + enseignant est
     * refusé, sinon un même compte pourrait pointer ses propres heures.
     */
    public static function problemeDeRoles(array $roles): ?string
    {
        if (count($roles) === 0) {
            return 'Au moins un rôle est requis.';
        }
        foreach ($roles as $role) {
            if (!in_array($role, self::ROLES, true)) {
                return 'Rôle inconnu.';
            }
        }
        if (in_array('secretaire', $roles, true) && in_array('enseignant', $roles, true)) {
            return 'Le cumul « Secrétaire » et « Enseignant » est interdit : '
                 . 'un compte ne peut pas pointer ses propres heures.';
        }
        if (in_array('etudiant', $roles, true) && count($roles) > 1) {
            return 'Le rôle « Étudiant » ne se cumule avec aucun autre.';
        }
        return null;
    }
}
