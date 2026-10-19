<?php
declare(strict_types=1);

/**
 * Modèle de message aux parents (§8).
 *
 *  §13.1 « Injection dans le modèle de message » — simple substitution de
 *         texte. Aucun moteur de gabarit, aucun `eval`, aucune fonction
 *         construite : un modèle contenant du code reste du texte.
 *  §13.9 « Message d'alerte piégé »              — le modèle n'est modifiable
 *         que par l'administration, et chaque changement est historisé.
 */
final class Messages
{
    /** Variables autorisées. Toute autre accolade reste affichée telle quelle. */
    public const VARIABLES = ['etudiant', 'classe', 'heures', 'periode', 'etablissement'];

    /**
     * Substitution pure.
     *
     * `{{clef}}` est remplacé si la clef est dans la liste blanche, sinon le
     * texte reste visible. Les valeurs sont débarrassées de leurs caractères
     * de contrôle et bornées en longueur.
     */
    public static function rendre(string $modele, array $valeurs): string
    {
        $modele = mb_substr($modele, 0, 1000);

        return preg_replace_callback(
            '/\{\{\s*([a-z_]{1,24})\s*\}\}/i',
            static function (array $m) use ($valeurs): string {
                $clef = mb_strtolower($m[1]);
                if (!in_array($clef, self::VARIABLES, true)) {
                    // Clef inconnue : on laisse le texte d'origine.
                    return $m[0];
                }
                $valeur = (string) ($valeurs[$clef] ?? '');
                $valeur = preg_replace('/[\x00-\x1f\x7f-\x9f]/u', ' ', $valeur);
                return mb_substr($valeur, 0, 200);
            },
            $modele
        );
    }

    /**
     * Normalise un numéro pour wa.me : chiffres seuls, format international.
     *
     * §13.1 « Injection dans le lien WhatsApp » : on retire tout ce qui n'est
     * pas un chiffre, y compris le « + » et les séparateurs. Un numéro
     * contenant `?text=` ne peut donc pas détourner l'adresse.
     */
    public static function numeroNormalise(?string $brut): ?string
    {
        $chiffres = preg_replace('/\D/', '', (string) $brut);
        return preg_match('/^\d{8,15}$/', $chiffres) ? $chiffres : null;
    }
}
