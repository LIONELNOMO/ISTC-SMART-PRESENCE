<?php
declare(strict_types=1);

/**
 * Configuration de l'API, lue une fois depuis `config.php`.
 *
 * §13.11 « Secrets dans le dépôt » : ce fichier ne contient aucune valeur par
 * défaut sensible. Si `config.php` manque, l'API refuse de démarrer plutôt que
 * de tourner avec des réglages devinables.
 */
final class Config
{
    private static ?array $valeurs = null;

    public static function charger(): void
    {
        if (self::$valeurs !== null) {
            return;
        }

        $chemin = dirname(__DIR__) . '/config.php';
        if (!is_file($chemin)) {
            // Message volontairement vague côté client ; le détail est pour
            // la personne qui installe, pas pour un visiteur.
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode([
                'error' => [
                    'code'    => 'configuration',
                    'message' => "L'API n'est pas configurée.",
                ],
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }

        self::$valeurs = require $chemin;
    }

    public static function get(string $clef, $defaut = null)
    {
        self::charger();
        return self::$valeurs[$clef] ?? $defaut;
    }

    public static function production(): bool
    {
        return (bool) self::get('production', true);
    }
}
