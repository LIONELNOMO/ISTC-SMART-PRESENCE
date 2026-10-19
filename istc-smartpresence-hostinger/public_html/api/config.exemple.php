<?php
/**
 * Configuration de l'API — MODÈLE.
 *
 * Copiez ce fichier en `config.php` et renseignez vos valeurs.
 *
 * §13.11 « Secrets dans le dépôt » : `config.php` est ignoré par Git. Il ne
 * doit jamais être versionné, ni déposé dans un dossier accessible par le web
 * autrement que par ce dossier `api/`, lui-même protégé par son `.htaccess`.
 *
 * Si vous changez d'hébergeur ou qu'un secret a pu être vu par un tiers,
 * régénérez-le : un secret divulgué est un secret mort.
 */

return [
    // -----------------------------------------------------------------
    //  Base de données
    // -----------------------------------------------------------------
    'db' => [
        'host'     => 'localhost',
        'name'     => 'istc_presences',
        // §13.6 « Base de données exposée » : ce compte ne doit avoir que
        // SELECT, INSERT, UPDATE, DELETE sur cette base — jamais DROP, jamais
        // GRANT, et jamais UPDATE/DELETE sur la table `audit`.
        'user'     => 'istc_app',
        'password' => 'a-remplacer',
        'charset'  => 'utf8mb4',
    ],

    // -----------------------------------------------------------------
    //  Secrets
    // -----------------------------------------------------------------

    // Sert à signer les cookies de session. 64 caractères hexadécimaux.
    // Générez-le avec :  php -r "echo bin2hex(random_bytes(32));"
    'session_secret' => 'a-remplacer-par-64-caracteres-hexadecimaux',

    // -----------------------------------------------------------------
    //  Déploiement
    // -----------------------------------------------------------------

    // Origine de l'application. Sur le même domaine que l'API, laissez null :
    // aucun en-tête CORS ne sera émis, ce qui est le réglage le plus sûr
    // (§13.6 « CORS trop ouvert »).
    'origine_autorisee' => null,

    // Mode production : messages d'erreur génériques, aucune trace renvoyée
    // au client (§13.6 « Erreurs trop bavardes »). À laisser à true en ligne.
    'production' => true,

    // Dossier des justificatifs. Il DOIT être hors du dossier web, sinon un
    // certificat médical serait téléchargeable par son adresse
    // (§13.7 « Justificatif accessible à tous »).
    // Exemple cPanel :  /home/moncompte/justificatifs
    'dossier_justificatifs' => __DIR__ . '/../../justificatifs-prives',

    // Fichier de journal, hors dossier web lui aussi (§13.12).
    'journal' => __DIR__ . '/../../logs/api.log',
];
