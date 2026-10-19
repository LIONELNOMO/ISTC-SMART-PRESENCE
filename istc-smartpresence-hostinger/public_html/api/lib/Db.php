<?php
declare(strict_types=1);

/**
 * Accès à la base.
 *
 * §13.1 « Injection SQL » : cette classe n'expose aucune méthode qui accepte
 * du SQL assemblé avec des données. Toute valeur passe par un paramètre lié.
 * Les rares endroits où un nom de colonne vient de l'extérieur (tri) passent
 * par `colonneAutorisee()`, qui travaille sur liste blanche.
 */
final class Db
{
    private static ?PDO $pdo = null;

    /** Connexion unique, en mode exception et sans émulation de requêtes. */
    public static function pdo(): PDO
    {
        if (self::$pdo !== null) {
            return self::$pdo;
        }

        $cfg = Config::get('db');
        $dsn = sprintf(
            'mysql:host=%s;dbname=%s;charset=%s',
            $cfg['host'],
            $cfg['name'],
            $cfg['charset']
        );

        self::$pdo = new PDO($dsn, $cfg['user'], $cfg['password'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // §13.1 : sans cette ligne, PDO simule les requêtes préparées en
            // concaténant les valeurs lui-même — ce qui rouvre la porte aux
            // injections sur certaines versions de MySQL.
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_STRINGIFY_FETCHES  => false,
        ]);

        // Toutes les dates circulent en UTC (§13.4 « Durées impossibles »).
        self::$pdo->exec("SET time_zone = '+00:00'");

        return self::$pdo;
    }

    /** Exécute une requête paramétrée et renvoie le relevé. */
    public static function run(string $sql, array $params = []): PDOStatement
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        return $st;
    }

    /** Première ligne, ou null. */
    public static function un(string $sql, array $params = []): ?array
    {
        $ligne = self::run($sql, $params)->fetch();
        return $ligne === false ? null : $ligne;
    }

    /** Toutes les lignes. */
    public static function tout(string $sql, array $params = []): array
    {
        return self::run($sql, $params)->fetchAll();
    }

    /** Première colonne de la première ligne. */
    public static function valeur(string $sql, array $params = [])
    {
        $v = self::run($sql, $params)->fetchColumn();
        return $v === false ? null : $v;
    }

    /** Nombre de lignes correspondant à la requête. */
    public static function compte(string $sql, array $params = []): int
    {
        return (int) self::valeur($sql, $params);
    }

    /**
     * Insère une ligne. Les clefs du tableau sont des noms de colonnes écrits
     * dans le code, jamais des données reçues : il n'y a donc pas d'injection
     * possible par ce chemin.
     */
    public static function inserer(string $table, array $valeurs): void
    {
        $colonnes = array_keys($valeurs);
        self::garantirIdentifiants(array_merge([$table], $colonnes));

        $sql = sprintf(
            'INSERT INTO `%s` (%s) VALUES (%s)',
            $table,
            implode(', ', array_map(fn($c) => "`$c`", $colonnes)),
            implode(', ', array_map(fn($c) => ":$c", $colonnes))
        );
        self::run($sql, $valeurs);
    }

    /** Met à jour une ligne par sa clef primaire. */
    public static function modifier(string $table, array $valeurs, array $ou): void
    {
        self::garantirIdentifiants(array_merge([$table], array_keys($valeurs), array_keys($ou)));

        $sets = implode(', ', array_map(fn($c) => "`$c` = :set_$c", array_keys($valeurs)));
        $cond = implode(' AND ', array_map(fn($c) => "`$c` = :ou_$c", array_keys($ou)));

        $params = [];
        foreach ($valeurs as $c => $v) {
            $params["set_$c"] = $v;
        }
        foreach ($ou as $c => $v) {
            $params["ou_$c"] = $v;
        }

        self::run("UPDATE `$table` SET $sets WHERE $cond", $params);
    }

    /** Supprime des lignes par condition d'égalité. */
    public static function supprimer(string $table, array $ou): void
    {
        self::garantirIdentifiants(array_merge([$table], array_keys($ou)));
        $cond = implode(' AND ', array_map(fn($c) => "`$c` = :$c", array_keys($ou)));
        self::run("DELETE FROM `$table` WHERE $cond", $ou);
    }

    /**
     * §13.1 « Injection SQL par le tri » : un nom de colonne venu du client
     * n'est jamais inséré tel quel. On vérifie qu'il appartient à la liste
     * blanche de l'appel, sinon on retombe sur la valeur par défaut.
     */
    public static function colonneAutorisee(?string $demandee, array $permises, string $defaut): string
    {
        return in_array($demandee, $permises, true) ? $demandee : $defaut;
    }

    /** Sens de tri : deux valeurs possibles, pas une de plus. */
    public static function sensAutorise(?string $demande): string
    {
        return strtoupper((string) $demande) === 'DESC' ? 'DESC' : 'ASC';
    }

    /**
     * Exécute un bloc dans une transaction (§13.6 « Erreur mal gérée ») : en
     * cas d'exception, rien n'est écrit. Les transactions imbriquées sont
     * tolérées — seule la plus externe valide.
     */
    public static function transaction(callable $bloc)
    {
        $pdo = self::pdo();
        if ($pdo->inTransaction()) {
            return $bloc();
        }

        $pdo->beginTransaction();
        try {
            $resultat = $bloc();
            $pdo->commit();
            return $resultat;
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    /**
     * Dernier filet : un identifiant SQL construit dans le code ne contient
     * que des lettres, des chiffres et des tirets bas. Si ce n'est pas le cas,
     * c'est un bug de programmation, pas une donnée utilisateur — on arrête.
     */
    private static function garantirIdentifiants(array $noms): void
    {
        foreach ($noms as $nom) {
            if (!preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', (string) $nom)) {
                throw new LogicException('Identifiant SQL invalide.');
            }
        }
    }
}
