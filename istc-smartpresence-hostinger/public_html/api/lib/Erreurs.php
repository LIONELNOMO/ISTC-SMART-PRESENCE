<?php
declare(strict_types=1);

/**
 * Erreurs renvoyées au client, et journal.
 *
 * §13.6 « Erreurs trop bavardes » : le client reçoit un code et une phrase
 * courte, jamais une trace, jamais une requête, jamais le nom d'une table.
 * Le détail part dans le journal, hors du dossier web.
 *
 * Ce fichier reprend, code pour code, les erreurs de `src/server/errors.js` :
 * l'application React sait déjà les interpréter.
 */
final class ApiErreur extends Exception
{
    /**
     * Code métier renvoyé au client. Il ne peut pas s'appeler `$code` :
     * `Exception` déclare déjà cette propriété, typée entier.
     */
    public string $codeApi;
    public int $statut;
    public bool $reessayable;
    /** Détail destiné au journal seulement. Jamais renvoyé. */
    public ?string $detail;

    public function __construct(
        string $code,
        string $message,
        int $statut = 400,
        bool $reessayable = false,
        ?string $detail = null
    ) {
        parent::__construct($message);
        $this->codeApi     = $code;
        $this->statut      = $statut;
        $this->reessayable = $reessayable;
        $this->detail      = $detail;
    }

    public function versClient(): array
    {
        return [
            'error' => [
                'code'      => $this->codeApi,
                'message'   => $this->getMessage(),
                'retryable' => $this->reessayable,
            ],
        ];
    }
}

final class Erreurs
{
    /** §13.2 : même message pour « compte inconnu » et « mot de passe faux ». */
    public static function identifiants(): ApiErreur
    {
        return new ApiErreur('identifiants', 'Identifiant ou mot de passe incorrect.', 401);
    }

    public static function bloque(int $minutes): ApiErreur
    {
        $s = $minutes > 1 ? 's' : '';
        return new ApiErreur(
            'bloque',
            "Trop d'essais. Nouvelle tentative possible dans {$minutes} minute{$s}.",
            429
        );
    }

    public static function session(): ApiErreur
    {
        return new ApiErreur('session', 'Session expirée. Reconnectez-vous.', 401);
    }

    public static function sessionHorsLigne(): ApiErreur
    {
        return new ApiErreur(
            'session_hors_ligne',
            'Votre session hors ligne a atteint sa durée maximale. Reconnectez-vous une fois en ligne.',
            401
        );
    }

    public static function droits(): ApiErreur
    {
        return new ApiErreur('droits', "Vous n'avez pas accès à cette action.", 403);
    }

    public static function perimetre(): ApiErreur
    {
        return new ApiErreur('perimetre', 'Cet élément ne fait pas partie de votre périmètre.', 403);
    }

    public static function introuvable(): ApiErreur
    {
        return new ApiErreur('introuvable', 'Élément introuvable.', 404);
    }

    public static function invalide(string $message = 'Données invalides.'): ApiErreur
    {
        return new ApiErreur('invalide', $message, 400);
    }

    public static function conflit(string $message = 'Action déjà enregistrée.'): ApiErreur
    {
        return new ApiErreur('conflit', $message, 409);
    }

    public static function reseau(): ApiErreur
    {
        return new ApiErreur('reseau', 'Action impossible hors ligne.', 503, true);
    }

    public static function interne(?string $detail = null): ApiErreur
    {
        return new ApiErreur(
            'interne',
            "Une erreur est survenue. L'action n'a pas été enregistrée.",
            500,
            true,
            $detail
        );
    }
}

final class Journal
{
    /**
     * Journal structuré en JSON.
     *
     * §13.1 « Injection dans les journaux » : les retours à la ligne et les
     * caractères de contrôle sont retirés, sinon un motif de justification
     * bien choisi fabriquerait de fausses lignes.
     *
     * §13.10 « Données dans les journaux » : tout champ dont le nom évoque un
     * secret ou une donnée personnelle est masqué, sans exception.
     */
    private const SENSIBLES = '/(password|motdepasse|secret|token|jeton|code|hash|phone|telephone|parent)/i';

    public static function ecrire(string $evenement, array $champs = []): void
    {
        $propres = [];
        foreach ($champs as $clef => $valeur) {
            if (preg_match(self::SENSIBLES, (string) $clef)) {
                $propres[$clef] = $valeur === null ? null : '[masqué]';
                continue;
            }
            if (is_string($valeur)) {
                $valeur = preg_replace('/[\x00-\x1f\x7f]/u', ' ', $valeur);
                $valeur = mb_substr($valeur, 0, 200);
            }
            $propres[$clef] = $valeur;
        }

        $ligne = json_encode(
            array_merge(['at' => gmdate('c'), 'event' => $evenement], $propres),
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        );

        $chemin = Config::get('journal');
        if (!$chemin) {
            return;
        }

        $dossier = dirname($chemin);
        if (!is_dir($dossier)) {
            @mkdir($dossier, 0750, true);
        }
        @file_put_contents($chemin, $ligne . PHP_EOL, FILE_APPEND | LOCK_EX);
    }
}
