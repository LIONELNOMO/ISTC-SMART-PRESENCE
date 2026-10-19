<?php
declare(strict_types=1);

/**
 * Produit l'ordre SQL qui crée le premier administrateur.
 *
 * À LANCER EN LOCAL, jamais sur le serveur :
 *
 *     php api/outils/creer-administrateur.php
 *
 * Le script vous demande vos informations, calcule le haché Argon2id de votre
 * mot de passe, et affiche un INSERT prêt à coller dans phpMyAdmin.
 *
 * Pourquoi passer par là plutôt que par un écran d'installation :
 *
 *  §13.2 « Compte administrateur par défaut » — l'application ne contient
 *  aucun compte livré, et aucune page web ne permet d'en créer un. Il n'y a
 *  donc rien à exposer, même pendant les quelques minutes qui suivent la mise
 *  en ligne.
 *
 *  §13.2 « Mots de passe mal stockés » — le mot de passe n'est jamais écrit
 *  en base, seulement son haché Argon2id. Il ne quitte pas votre machine : ni
 *  réseau, ni site tiers, ni fichier.
 *
 * Ce fichier n'a rien à faire sur le serveur. Le `.htaccess` du dossier `api`
 * en interdit l'accès par le web, mais ne le déposez simplement pas.
 */

// Le script refuse de tourner autrement qu'en ligne de commande : servi par un
// serveur web, il deviendrait exactement la porte qu'on cherche à éviter.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../lib/Compat.php';

/* ------------------------------------------------------------------ *
 *  Saisie
 * ------------------------------------------------------------------ */

function demander(string $question, bool $masque = false): string
{
    echo $question;

    if ($masque && stripos(PHP_OS_FAMILY, 'Windows') === false) {
        // Sur un système Unix, on peut couper l'écho du terminal.
        shell_exec('stty -echo');
        $valeur = trim((string) fgets(STDIN));
        shell_exec('stty echo');
        echo PHP_EOL;
        return $valeur;
    }

    // Sous Windows, la saisie reste visible : le script tourne en local, sur
    // votre poste. On le signale plutôt que de prétendre le contraire.
    return trim((string) fgets(STDIN));
}

function uuid(): string
{
    $o = random_bytes(16);
    $o[6] = chr((ord($o[6]) & 0x0f) | 0x40);
    $o[8] = chr((ord($o[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($o), 4));
}

function quote(string $v): string
{
    return "'" . str_replace("'", "''", $v) . "'";
}

/* ------------------------------------------------------------------ *
 *  Déroulement
 * ------------------------------------------------------------------ */

echo PHP_EOL;
echo "  ISTC SmartPresence — création du premier administrateur" . PHP_EOL;
echo "  " . str_repeat('─', 56) . PHP_EOL . PHP_EOL;
echo "  Ce script ne touche à aucune base. Il produit un ordre SQL" . PHP_EOL;
echo "  que vous collerez dans phpMyAdmin." . PHP_EOL . PHP_EOL;

$prenom = demander('  Prénom                      : ');
$nom    = demander('  Nom                         : ');

while (true) {
    $telephone = preg_replace('/\D/', '', demander('  Téléphone (identifiant)     : '));
    if (preg_match('/^\d{8,15}$/', (string) $telephone)) {
        break;
    }
    echo "  → 8 à 15 chiffres attendus, au format international." . PHP_EOL;
}

echo PHP_EOL;
if (stripos(PHP_OS_FAMILY, 'Windows') !== false) {
    echo "  Note : sous Windows, le mot de passe s'affiche en clair." . PHP_EOL;
    echo "  Effacez la fenêtre du terminal ensuite." . PHP_EOL . PHP_EOL;
}

while (true) {
    $motDePasse = demander('  Mot de passe                : ', true);

    if (mb_strlen($motDePasse) < 8) {
        echo "  → 8 caractères minimum (§13.2)." . PHP_EOL;
        continue;
    }
    if (!preg_match('/[^a-zA-Z]/', $motDePasse)) {
        echo "  → Ajoutez au moins un chiffre ou un caractère spécial." . PHP_EOL;
        continue;
    }

    $confirmation = demander('  Confirmation                : ', true);
    if ($motDePasse !== $confirmation) {
        echo "  → Les deux saisies diffèrent." . PHP_EOL;
        continue;
    }
    break;
}

$etablissement = demander('  Nom de l\'établissement      : ');
if ($etablissement === '') {
    $etablissement = 'ISTC';
}

/* ------------------------------------------------------------------ *
 *  Haché Argon2id
 * ------------------------------------------------------------------ */

// §13.2 : Argon2id si disponible, bcrypt sinon. Les deux sont des algorithmes
// lents, conçus pour rendre coûteuse une attaque par dictionnaire.
$algo = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
$hash = password_hash($motDePasse, $algo);

if ($hash === false) {
    fwrite(STDERR, '  Le haché n\'a pas pu être calculé.' . PHP_EOL);
    exit(1);
}

$id    = uuid();
$date  = gmdate('Y-m-d H:i:s');
$nomAlgo = $algo === PASSWORD_BCRYPT ? 'bcrypt' : 'Argon2id';

/* ------------------------------------------------------------------ *
 *  Sortie
 * ------------------------------------------------------------------ */

echo PHP_EOL;
echo "  " . str_repeat('─', 56) . PHP_EOL;
echo "  Haché produit avec $nomAlgo." . PHP_EOL;
echo "  Collez les lignes ci-dessous dans phpMyAdmin → onglet SQL." . PHP_EOL;
echo "  " . str_repeat('─', 56) . PHP_EOL . PHP_EOL;

echo "-- Premier administrateur · ISTC SmartPresence" . PHP_EOL;
echo "-- Produit le $date UTC. À exécuter une seule fois." . PHP_EOL . PHP_EOL;

echo "INSERT INTO users" . PHP_EOL;
echo "  (id, login, login_key, nom, prenom, telephone," . PHP_EOL;
echo "   password_hash, must_change_password, actif, created_at)" . PHP_EOL;
echo "VALUES (" . PHP_EOL;
echo "  " . quote($id) . "," . PHP_EOL;
echo "  " . quote($telephone) . "," . PHP_EOL;
echo "  " . quote(mb_strtolower($telephone)) . "," . PHP_EOL;
echo "  " . quote($nom) . "," . PHP_EOL;
echo "  " . quote($prenom) . "," . PHP_EOL;
echo "  " . quote($telephone) . "," . PHP_EOL;
echo "  " . quote($hash) . "," . PHP_EOL;
// Le mot de passe a été choisi par vous : rien à changer à la connexion.
echo "  0," . PHP_EOL;
echo "  1," . PHP_EOL;
echo "  " . quote($date) . PHP_EOL;
echo ");" . PHP_EOL . PHP_EOL;

echo "INSERT INTO user_roles (user_id, role)" . PHP_EOL;
echo "VALUES (" . quote($id) . ", 'administration');" . PHP_EOL . PHP_EOL;

echo "INSERT INTO settings (`key`, value)" . PHP_EOL;
echo "VALUES ('parametres', " . quote(json_encode(
    ['etablissement' => $etablissement],
    JSON_UNESCAPED_UNICODE
)) . ")" . PHP_EOL;
echo "ON DUPLICATE KEY UPDATE value = VALUES(value);" . PHP_EOL . PHP_EOL;

echo "  " . str_repeat('─', 56) . PHP_EOL;
echo "  Identifiant de connexion : $telephone" . PHP_EOL;
echo "  Mot de passe             : celui que vous venez de saisir" . PHP_EOL;
echo PHP_EOL;
echo "  Le mot de passe n'est stocké nulle part en clair." . PHP_EOL;
echo "  Perdu, il se réinitialise en relançant ce script." . PHP_EOL;
echo "  " . str_repeat('─', 56) . PHP_EOL . PHP_EOL;
