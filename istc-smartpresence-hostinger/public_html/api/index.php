<?php
declare(strict_types=1);

/**
 * Point d'entrée unique de l'API.
 *
 * Toutes les requêtes passent par ce fichier. Il n'existe aucune autre porte :
 * le `.htaccess` du dossier interdit l'accès direct aux fichiers de `lib/` et
 * à `config.php` (§13.3 « Routes oubliées », §13.11 « Secrets dans le dépôt »).
 *
 * Routes :
 *   POST /api/connexion            ouvre une session
 *   POST /api/deconnexion          la ferme
 *   POST /api/mot-de-passe         change le mot de passe
 *   GET  /api/lire                 projection filtrée par rôle
 *   POST /api/soumettre            une opération d'écriture
 *   GET  /api/justificatif?nom=…   télécharge une pièce jointe
 *   GET  /api/sante                état du service, sans secret
 *   GET  /api/vitrine              comptages de l'écran de connexion
 */

// -------------------------------------------------------------------
//  Rien ne s'affiche en dehors de notre JSON (§13.6 « Erreurs trop bavardes »)
// -------------------------------------------------------------------
ini_set('display_errors', '0');
error_reporting(E_ALL);

require __DIR__ . '/lib/Compat.php';
require __DIR__ . '/lib/Config.php';
require __DIR__ . '/lib/Erreurs.php';
require __DIR__ . '/lib/Db.php';
require __DIR__ . '/lib/Outils.php';
require __DIR__ . '/lib/Schema.php';
require __DIR__ . '/lib/Formes.php';
require __DIR__ . '/lib/Identite.php';
require __DIR__ . '/lib/Messages.php';
require __DIR__ . '/lib/Fichiers.php';
require __DIR__ . '/lib/Parametres.php';
require __DIR__ . '/lib/Historique.php';
require __DIR__ . '/lib/Limites.php';
require __DIR__ . '/lib/Garde.php';
require __DIR__ . '/lib/QrCodes.php';
require __DIR__ . '/lib/Regles.php';
require __DIR__ . '/lib/Taux.php';
require __DIR__ . '/lib/Rapports.php';
require __DIR__ . '/lib/Projection.php';
require __DIR__ . '/lib/Operations.php';
require __DIR__ . '/lib/OperationsReleve.php';
require __DIR__ . '/lib/OperationsAdmin.php';
require __DIR__ . '/lib/OperationsReferentiel.php';

Config::charger();

/* ------------------------------------------------------------------ *
 *  En-têtes
 * ------------------------------------------------------------------ */

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
// Une réponse d'API ne doit jamais être mise en cache : elle contient des
// données personnelles (§13.5 « Cache du service worker »).
header('Cache-Control: no-store, no-cache, must-revalidate, private');
header('Pragma: no-cache');

// §13.6 « CORS trop ouvert » : par défaut, aucun en-tête CORS n'est émis.
// L'application est servie depuis le même domaine, donc elle n'en a pas besoin.
$origineAutorisee = Config::get('origine_autorisee');
if ($origineAutorisee !== null) {
    $origine = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origine === $origineAutorisee) {
        header('Access-Control-Allow-Origin: ' . $origineAutorisee);
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Headers: Content-Type, X-Jeton');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Vary: Origin');
    }
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/* ------------------------------------------------------------------ *
 *  Outils de réponse
 * ------------------------------------------------------------------ */

function repondre(array $charge, int $statut = 200): void
{
    http_response_code($statut);
    echo json_encode($charge, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function repondreErreur(Throwable $e): void
{
    if ($e instanceof ApiErreur) {
        if ($e->detail !== null) {
            Journal::ecrire('erreur_api', ['code' => $e->codeApi, 'detail' => $e->detail]);
        }
        repondre($e->versClient(), $e->statut);
    }

    // Toute autre exception : message générique au client, détail au journal.
    Journal::ecrire('erreur_inattendue', [
        'message' => $e->getMessage(),
        'fichier' => basename($e->getFile()) . ':' . $e->getLine(),
    ]);
    repondre(Erreurs::interne()->versClient(), 500);
}

/** Corps JSON de la requête, borné en taille (§13.6 « Déni de service »). */
function corpsJson(): array
{
    $brut = file_get_contents('php://input');
    if ($brut === false || $brut === '') {
        return [];
    }
    if (strlen($brut) > 8 * 1024 * 1024) {
        throw Erreurs::invalide('Requête trop volumineuse.');
    }
    $donnees = json_decode($brut, true);
    if (!is_array($donnees)) {
        throw Erreurs::invalide('Corps de requête illisible.');
    }
    return $donnees;
}

/**
 * Jeton de session.
 *
 * §13.2 « Vol du jeton » : le cookie est HttpOnly, Secure et SameSite=Lax —
 * un script injecté ne peut donc pas le lire. L'en-tête `X-Jeton` n'est accepté
 * qu'en repli, pour les contextes où le cookie ne passe pas.
 */
function jetonDeLaRequete(): ?string
{
    if (!empty($_COOKIE['istc_session'])) {
        return (string) $_COOKIE['istc_session'];
    }
    $entete = $_SERVER['HTTP_X_JETON'] ?? '';
    return $entete !== '' ? $entete : null;
}

function poserCookieSession(string $jeton, string $expireLe): void
{
    $secure = (($_SERVER['HTTPS'] ?? '') !== '' && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');

    setcookie('istc_session', $jeton, [
        'expires'  => strtotime($expireLe . ' UTC'),
        'path'     => '/',
        // En local (http://localhost), `secure` empêcherait le cookie d'être
        // posé. En ligne, HTTPS est obligatoire et le drapeau s'active.
        'secure'   => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function effacerCookieSession(): void
{
    setcookie('istc_session', '', [
        'expires'  => time() - 3600,
        'path'     => '/',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

/** Vrai si la requête se dit faite en ligne. Le serveur, lui, l'est toujours. */
function enLigne(array $corps): bool
{
    return !isset($corps['online']) || $corps['online'] !== false;
}

/* ------------------------------------------------------------------ *
 *  Routage
 * ------------------------------------------------------------------ */

/**
 * Extraction de la route.
 *
 * Trois formes doivent fonctionner, selon que l'hébergeur réécrit les URL
 * ou non :
 *   /api/lire              (avec mod_rewrite)
 *   /api/index.php/lire    (sans réécriture)
 *   /api/index.php?r=lire  (dernier repli)
 */
$chemin = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';

// Ce qui suit « /api/ », ou le chemin entier si le dossier porte un autre nom.
$position = strpos($chemin, '/api/');
$route = $position !== false ? substr($chemin, $position + 5) : ltrim($chemin, '/');

// Le nom du script ne fait pas partie de la route.
if (str_starts_with($route, 'index.php')) {
    $route = substr($route, strlen('index.php'));
}

$route = trim($route, '/');

// Repli par paramètre, pour les hébergeurs sans réécriture ni PATH_INFO.
if ($route === '' && !empty($_GET['r'])) {
    $route = trim((string) $_GET['r'], '/');
}

// §13.1 : la route ne sert qu'à choisir un cas du switch, mais on la borne
// quand même avant de l'utiliser ou de la journaliser.
if (!preg_match('/^[a-z-]{0,40}$/', $route)) {
    $route = '';
}

$methode = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    switch ($route) {

        /* ----------------------------------------------------------- *
         *  Connexion
         * ----------------------------------------------------------- */
        case 'connexion':
            if ($methode !== 'POST') {
                throw Erreurs::droits();
            }

            $p = Schema::valider(corpsJson(), Formes::connexion(), 'connexion');
            $loginKey = mb_strtolower(trim($p['identifiant']));

            // §13.2 « Force brute » : limite par compte visé ET par appareil.
            Limites::exigerAutorise('connexion', $loginKey);
            Limites::exigerAutorise('connexion', 'appareil:' . $p['deviceId']);

            $user = Db::un('SELECT * FROM users WHERE login_key = ?', [$loginKey]);

            // §13.2 « Énumération de comptes » : même message et même coût
            // pour un compte inconnu et un mot de passe faux.
            $bon = $user === null
                ? (Identite::verifierAVide($p['motDePasse']) ?? false)
                : Identite::verifier($p['motDePasse'], $user['password_hash']);

            if ($user === null || !$bon || (int) $user['actif'] !== 1) {
                Limites::echec('connexion', $loginKey);
                Limites::echec('connexion', 'appareil:' . $p['deviceId']);
                Journal::ecrire('connexion_refusee', []);
                throw Erreurs::identifiants();
            }

            Limites::reussite('connexion', $loginKey);
            Limites::reussite('connexion', 'appareil:' . $p['deviceId']);

            $auth = Garde::ouvrirSession($user, $p['deviceId']);
            poserCookieSession($auth['token'], $auth['expires_at']);

            $ctx = Garde::contexte($auth['token'], true);

            repondre(['data' => [
                // Renvoyé aussi dans le corps, pour le repli par en-tête.
                'token'            => $auth['token'],
                'offlineDeadline'  => Outils::versIso($auth['offline_deadline']),
                'moi' => [
                    'id'                 => $user['id'],
                    'nom'                => $user['nom'],
                    'prenom'             => $user['prenom'],
                    'label'              => $ctx->label,
                    'login'              => $user['login'],
                    'roles'              => $ctx->roles,
                    'mustChangePassword' => $ctx->doitChangerMotDePasse,
                ],
            ]]);
            break;

        /* ----------------------------------------------------------- *
         *  Déconnexion
         * ----------------------------------------------------------- */
        case 'deconnexion':
            Garde::fermerSession(jetonDeLaRequete());
            effacerCookieSession();
            repondre(['data' => ['ok' => true]]);
            break;

        /* ----------------------------------------------------------- *
         *  Changement de mot de passe (§13.2)
         * ----------------------------------------------------------- */
        case 'mot-de-passe':
            if ($methode !== 'POST') {
                throw Erreurs::droits();
            }

            $ctx = Garde::contexte(jetonDeLaRequete(), true);
            $p = Schema::valider(corpsJson(), Formes::changementMotDePasse(), 'mot de passe');

            Limites::exigerAutorise('connexion', 'changement:' . $ctx->userId);

            // §13.2 « Changement de mot de passe sans l'ancien ».
            if (!Identite::verifier($p['actuel'], $ctx->user['password_hash'])) {
                Limites::echec('connexion', 'changement:' . $ctx->userId);
                throw Erreurs::identifiants();
            }

            $probleme = Identite::problemeDeMotDePasse($p['nouveau']);
            if ($probleme !== null) {
                throw Erreurs::invalide($probleme);
            }
            if ($p['nouveau'] === $p['actuel']) {
                throw Erreurs::invalide("Choisissez un mot de passe différent de l'actuel.");
            }

            Db::modifier('users', [
                'password_hash'        => Identite::hacher($p['nouveau']),
                'must_change_password' => 0,
                'password_changed_at'  => Outils::maintenant(),
            ], ['id' => $ctx->userId]);

            // Les autres sessions tombent (§13.2).
            Garde::fermerToutesLesSessions($ctx->userId, $ctx->token);
            Limites::reussite('connexion', 'changement:' . $ctx->userId);

            Historique::ajouter([
                'entity'      => 'compte',
                'entityId'    => $ctx->userId,
                'action'      => 'mot_de_passe_change',
                'authorId'    => $ctx->userId,
                'authorLabel' => $ctx->label,
            ]);

            repondre(['data' => ['ok' => true]]);
            break;

        /* ----------------------------------------------------------- *
         *  Lecture — projection filtrée par rôle
         * ----------------------------------------------------------- */
        case 'lire':
            $ctx = Garde::contexte(jetonDeLaRequete(), true);
            // §9 : les scans arrivés avant leur séance sont rattachés.
            OperationsReleve::rattacherScansEnAttente();
            repondre(['data' => Projection::pour($ctx)]);
            break;

        /* ----------------------------------------------------------- *
         *  Écriture — file d'attente et idempotence
         * ----------------------------------------------------------- */
        case 'soumettre':
            if ($methode !== 'POST') {
                throw Erreurs::droits();
            }
            repondre(traiterOperation(corpsJson()));
            break;

        /* ----------------------------------------------------------- *
         *  Justificatif — droits vérifiés avant tout envoi (§13.7, §13.10)
         * ----------------------------------------------------------- */
        case 'justificatif':
            $ctx = Garde::contexte(jetonDeLaRequete(), true);
            $nom = (string) ($_GET['nom'] ?? '');

            $justif = Db::un('SELECT * FROM justifications WHERE piece_nom = ?', [$nom]);
            if ($justif === null) {
                throw Erreurs::introuvable();
            }

            // §13.10 « Justificatifs médicaux » : l'étudiant concerné, son chef
            // de département, l'administration. Personne d'autre.
            $autorise = $ctx->aLeRole('administration')
                || ($ctx->studentId !== null && $ctx->studentId === $justif['student_id'])
                || ($ctx->aLeRole('chef')
                    && in_array($justif['filiere_id'], Garde::filieresDuChef($ctx), true));

            if (!$autorise) {
                Journal::ecrire('refus_justificatif', ['userId' => $ctx->userId]);
                throw Erreurs::perimetre();
            }

            $fichier = Fichiers::lireJustificatif($nom);

            // §13.7 « Fichier exécuté par le navigateur » : téléchargement
            // forcé, jamais d'affichage dans le domaine de l'application.
            header('Content-Type: ' . $fichier['type']);
            header('Content-Disposition: attachment; filename="' . $fichier['nom'] . '"');
            header('X-Content-Type-Options: nosniff');
            header('Content-Length: ' . strlen($fichier['contenu']));
            echo $fichier['contenu'];
            exit;

        /* ----------------------------------------------------------- *
         *  État du service — aucune donnée sensible
         * ----------------------------------------------------------- */
        case 'sante':
            $comptes = Db::compte('SELECT COUNT(*) FROM users');
            repondre(['data' => [
                'ok'      => true,
                'installe' => $comptes > 0,
                'heure'   => Outils::versIso(Outils::maintenant()),
            ]]);
            break;

        /* ----------------------------------------------------------- *
         *  Chiffres de l'écran de connexion
         *
         *  Appelée sans session — c'est le seul cas de lecture dans cette
         *  situation, et c'est pourquoi elle ne renvoie que des comptages
         *  et le nom de l'établissement (§13.10 « Fuite par les agrégats »).
         *  Aucun nom de personne, aucun identifiant, aucun numéro, aucun
         *  taux ni montant ne passe par ici.
         * ----------------------------------------------------------- */
        case 'vitrine':
            $reglages = Parametres::lire();
            repondre(['data' => [
                'etablissement' => $reglages['etablissement'] ?? null,
                'enseignants'   => Db::compte('SELECT COUNT(*) FROM teachers'),
                'etudiants'     => Db::compte('SELECT COUNT(*) FROM students'),
                'seances'       => Db::compte('SELECT COUNT(*) FROM sessions'),
            ]]);
            break;

        default:
            // §13.3 « Routes oubliées » : refus par défaut.
            throw Erreurs::introuvable();
    }
} catch (Throwable $e) {
    repondreErreur($e);
}

/* ------------------------------------------------------------------ *
 *  Traitement d'une opération d'écriture
 * ------------------------------------------------------------------ */

/**
 * Soumet une opération.
 *
 *  §13.5 « File d'attente falsifiée »    — les mêmes contrôles qu'en ligne.
 *  §13.5 « Rejeu de synchronisation »    — clef primaire (user_id, op_id).
 *  §13.5 « Identifiant d'action usurpé » — l'unicité porte sur le COUPLE.
 *  §13.5 « Droits périmés hors ligne »   — le contexte est résolu maintenant.
 *  §13.6 « Erreur mal gérée »            — tout se passe dans une transaction.
 */
function traiterOperation(array $corps): array
{
    $recuA = Outils::maintenant();

    $type = (string) ($corps['type'] ?? '');
    $opId = (string) ($corps['opId'] ?? '');

    if (!preg_match('/^[0-9a-f-]{36}$/i', $opId)) {
        throw Erreurs::invalide("Identifiant d'action invalide.");
    }

    $operations = Formes::operations();
    // §13.3 « Routes oubliées » : sans forme déclarée, c'est non.
    if (!isset($operations[$type])) {
        throw Erreurs::droits();
    }
    $definition = $operations[$type];

    $enLigne = enLigne($corps);
    $ctx = Garde::contexte(jetonDeLaRequete(), $enLigne);

    Limites::exigerAutorise('synchro', $ctx->userId);

    // Première porte : le rôle. Avant même de regarder le contenu.
    Garde::exigerRole($ctx, $definition['roles']);

    // §9 : certaines actions demandent le réseau.
    if ($definition['reseau'] && !$enLigne) {
        throw Erreurs::reseau();
    }

    // Idempotence : une action déjà traitée renvoie son résultat d'origine.
    $deja = Db::un(
        'SELECT result FROM processed_ops WHERE user_id = ? AND op_id = ?',
        [$ctx->userId, $opId]
    );
    if ($deja !== null) {
        Journal::ecrire('action_rejouee', ['type' => $type, 'userId' => $ctx->userId]);
        $resultat = json_decode($deja['result'], true) ?: [];
        return ['data' => array_merge($resultat, ['rejouee' => true])];
    }

    $charge = Schema::valider($corps['payload'] ?? [], $definition['forme'], $type);
    $meta = [
        'opId'     => $opId,
        'clientAt' => $corps['clientAt'] ?? null,
        'recuA'    => $recuA,
        'enLigne'  => $enLigne,
    ];

    $executants = [
        'secretariat.arrivee'       => [Operations::class, 'secretariatArrivee'],
        'secretariat.depart'        => [Operations::class, 'secretariatDepart'],
        'secretariat.depart_manuel' => [Operations::class, 'secretariatDepartManuel'],
        'pointage.scan'             => [Operations::class, 'pointageScan'],
        'releve.ouvrir'             => [OperationsReleve::class, 'ouvrir'],
        'releve.fermer'             => [OperationsReleve::class, 'fermer'],
        'releve.valider'            => [OperationsReleve::class, 'valider'],
        'releve.corriger'           => [OperationsReleve::class, 'corriger'],
        'presence.scan'             => [OperationsReleve::class, 'scanPresence'],
        'justification.demander'    => [OperationsAdmin::class, 'justificationDemander'],
        'justification.decider'     => [OperationsAdmin::class, 'justificationDecider'],
        'justification.directe'     => [OperationsAdmin::class, 'justificationDirecte'],
        'parent.contacter'          => [OperationsAdmin::class, 'contacterParent'],
        'admin.taux'                => [OperationsAdmin::class, 'adminTaux'],
        'admin.parametres'          => [OperationsAdmin::class, 'adminParametres'],
        'admin.semestres'           => [OperationsAdmin::class, 'adminSemestres'],
        'admin.compte'              => [OperationsAdmin::class, 'adminCompte'],
        'admin.referentiel'         => [OperationsReferentiel::class, 'referentiel'],
        'admin.import_etudiants'    => [OperationsReferentiel::class, 'importEtudiants'],
    ];

    if (!isset($executants[$type])) {
        throw Erreurs::droits();
    }

    $resultat = Db::transaction(function () use ($executants, $type, $ctx, $charge, $meta, $opId, $recuA) {
        // Deuxième lecture dans la transaction : deux synchronisations
        // simultanées ne peuvent pas passer toutes les deux
        // (§13.6 « Requêtes simultanées »).
        $encore = Db::un(
            'SELECT result FROM processed_ops WHERE user_id = ? AND op_id = ?',
            [$ctx->userId, $opId]
        );
        if ($encore !== null) {
            return array_merge(json_decode($encore['result'], true) ?: [], ['rejouee' => true]);
        }

        $sortie = call_user_func($executants[$type], $ctx, $charge, $meta) ?? ['ok' => true];

        Db::inserer('processed_ops', [
            'user_id' => $ctx->userId,
            'op_id'   => $opId,
            'type'    => $type,
            'at'      => $recuA,
            'result'  => json_encode($sortie, JSON_UNESCAPED_UNICODE),
        ]);

        return $sortie;
    });

    Limites::reussite('synchro', $ctx->userId);

    if ($type === 'secretariat.arrivee' || $type === 'pointage.scan') {
        OperationsReleve::rattacherScansEnAttente();
    }

    Journal::ecrire('action_acceptee', ['type' => $type, 'userId' => $ctx->userId]);
    return ['data' => $resultat];
}
