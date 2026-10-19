<?php
declare(strict_types=1);

/**
 * Le garde-barrière. Aucune opération, aucune lecture ne se fait sans passer ici.
 *
 * Transcription de `src/server/guard.js` :
 *
 *  §13.3 « Contrôle fait seulement dans l'interface » — chaque appel est
 *         vérifié côté serveur, quoi que l'écran affiche ou cache.
 *  §13.3 « Accès aux données d'autrui » — la propriété de l'objet est vérifiée.
 *  §13.2 « Session jamais révoquée » — compte et rôles relus À CHAQUE appel.
 *  §13.5 « Droits périmés hors ligne » — à la synchronisation, ce sont les
 *         droits du moment qui s'appliquent, pas ceux du moment de l'action.
 */
final class Contexte
{
    public string $token;
    public string $userId;
    public array  $roles;
    public ?string $teacherId;
    public ?string $studentId;
    public ?string $filiereId;
    public string $deviceId;
    public string $label;
    public bool   $doitChangerMotDePasse;
    public array  $user;

    public function aLeRole(string $role): bool
    {
        return in_array($role, $this->roles, true);
    }
}

final class Garde
{
    /** Durée d'une session en ligne. */
    private const TTL_SESSION = 12 * 3600;

    /* ----------------------------------------------------------------- *
     *  Ouverture et fermeture de session
     * ----------------------------------------------------------------- */

    /**
     * Crée une session serveur.
     *
     * §13.2 « Fixation de session » : la session précédente du MÊME appareil
     * est supprimée, si bien que l'identifiant change à chaque connexion.
     */
    public static function ouvrirSession(array $user, string $deviceId): array
    {
        $parametres = Parametres::lire();
        $jours = (int) ($parametres['dureeSessionHorsLigneJours'] ?? 7);

        Db::run(
            'DELETE FROM auth_sessions WHERE user_id = ? AND device_id = ?',
            [$user['id'], $deviceId]
        );

        $ligne = [
            'token'            => bin2hex(random_bytes(32)),
            'user_id'          => $user['id'],
            'device_id'        => mb_substr($deviceId, 0, 40),
            'created_at'       => Outils::maintenant(),
            'expires_at'       => Outils::dans(self::TTL_SESSION),
            // §13.2 « Session hors ligne sur téléphone perdu ».
            'offline_deadline' => Outils::dans($jours * 86400),
        ];
        Db::inserer('auth_sessions', $ligne);
        Journal::ecrire('connexion', ['userId' => $user['id']]);

        return $ligne;
    }

    public static function fermerSession(?string $token): void
    {
        if ($token !== null && $token !== '') {
            Db::supprimer('auth_sessions', ['token' => $token]);
        }
    }

    /** Ferme toutes les sessions d'un compte, sauf éventuellement une (§13.2). */
    public static function fermerToutesLesSessions(string $userId, ?string $sauf = null): void
    {
        if ($sauf === null) {
            Db::run('DELETE FROM auth_sessions WHERE user_id = ?', [$userId]);
            return;
        }
        Db::run('DELETE FROM auth_sessions WHERE user_id = ? AND token <> ?', [$userId, $sauf]);
    }

    /* ----------------------------------------------------------------- *
     *  Résolution du contexte
     * ----------------------------------------------------------------- */

    /**
     * Résout un jeton en contexte d'appel.
     *
     * Le compte et ses rôles sont RELUS EN BASE à chaque requête : un compte
     * désactivé ou un rôle retiré prend effet immédiatement, même si le jeton
     * est encore valide (§13.2 « Session jamais révoquée »).
     */
    public static function contexte(?string $token, bool $enLigne = true): Contexte
    {
        if ($token === null || strlen($token) < 32) {
            throw Erreurs::session();
        }

        $auth = Db::un('SELECT * FROM auth_sessions WHERE token = ?', [$token]);
        if ($auth === null) {
            throw Erreurs::session();
        }

        $maintenant = Outils::maintenant();

        if ($auth['offline_deadline'] < $maintenant) {
            Db::supprimer('auth_sessions', ['token' => $token]);
            throw Erreurs::sessionHorsLigne();
        }

        // Prolongation tacite quand le réseau est là et le compte valide.
        if ($enLigne && $auth['expires_at'] < $maintenant) {
            Db::modifier(
                'auth_sessions',
                ['expires_at' => Outils::dans(self::TTL_SESSION)],
                ['token' => $token]
            );
        }

        $user = Db::un('SELECT * FROM users WHERE id = ?', [$auth['user_id']]);
        if ($user === null || (int) $user['actif'] !== 1) {
            Db::supprimer('auth_sessions', ['token' => $token]);
            throw Erreurs::session();
        }

        $roles = array_column(
            Db::tout('SELECT role FROM user_roles WHERE user_id = ?', [$user['id']]),
            'role'
        );

        $ctx = new Contexte();
        $ctx->token      = $token;
        $ctx->userId     = $user['id'];
        $ctx->roles      = $roles;
        $ctx->teacherId  = $user['teacher_id'];
        $ctx->studentId  = $user['student_id'];
        $ctx->filiereId  = $user['filiere_id'];
        $ctx->deviceId   = $auth['device_id'];
        $ctx->label      = trim(($user['prenom'] ?? '') . ' ' . ($user['nom'] ?? '')) ?: $user['login'];
        $ctx->doitChangerMotDePasse = (int) $user['must_change_password'] === 1;
        $ctx->user       = $user;

        return $ctx;
    }

    /* ----------------------------------------------------------------- *
     *  Rôles et périmètres
     * ----------------------------------------------------------------- */

    /** Refus par défaut : la liste des rôles autorisés est obligatoire. */
    public static function exigerRole(Contexte $ctx, array $roles): void
    {
        if (count($roles) === 0) {
            throw Erreurs::droits();
        }
        foreach ($roles as $role) {
            if ($ctx->aLeRole($role)) {
                return;
            }
        }
        Journal::ecrire('refus_role', [
            'userId'   => $ctx->userId,
            'attendus' => implode(',', $roles),
        ]);
        throw Erreurs::droits();
    }

    /** Filières dont l'utilisateur est chef de département. */
    public static function filieresDuChef(Contexte $ctx): array
    {
        if (!$ctx->aLeRole('chef')) {
            return [];
        }
        return array_column(
            Db::tout('SELECT id FROM filieres WHERE chef_user_id = ?', [$ctx->userId]),
            'id'
        );
    }

    /** §13.3 « Chef de département hors filière ». */
    public static function exigerFiliereDuChef(Contexte $ctx, ?string $filiereId): void
    {
        if ($ctx->aLeRole('administration')) {
            return;
        }
        if ($filiereId === null || !in_array($filiereId, self::filieresDuChef($ctx), true)) {
            throw Erreurs::perimetre();
        }
    }

    /** §13.3 « Enseignant hors affectation ». */
    public static function exigerAffectation(Contexte $ctx, string $matiereId): void
    {
        if ($ctx->teacherId === null) {
            throw Erreurs::droits();
        }
        $existe = Db::compte(
            'SELECT COUNT(*) FROM affectations WHERE teacher_id = ? AND matiere_id = ?',
            [$ctx->teacherId, $matiereId]
        );
        if ($existe === 0) {
            Journal::ecrire('refus_affectation', ['userId' => $ctx->userId]);
            throw Erreurs::perimetre();
        }
    }

    /** §13.3 « Accès aux données d'autrui », pour une séance. */
    public static function seanceDeSonPerimetre(Contexte $ctx, string $sessionId): array
    {
        $seance = Db::un('SELECT * FROM sessions WHERE id = ?', [$sessionId]);
        if ($seance === null) {
            throw Erreurs::introuvable();
        }

        if ($ctx->aLeRole('administration') || $ctx->aLeRole('secretaire')) {
            return $seance;
        }
        if ($ctx->aLeRole('enseignant') && $seance['teacher_id'] === $ctx->teacherId) {
            return $seance;
        }
        if ($ctx->aLeRole('chef')) {
            $classe = Db::un('SELECT filiere_id FROM classes WHERE id = ?', [$seance['classe_id']]);
            if ($classe !== null && in_array($classe['filiere_id'], self::filieresDuChef($ctx), true)) {
                return $seance;
            }
        }
        throw Erreurs::perimetre();
    }

    /** §13.3 « Étudiant hors classe » : la séance doit concerner sa classe. */
    public static function exigerEtudiantDeLaSeance(Contexte $ctx, array $seance): array
    {
        if ($ctx->studentId === null) {
            throw Erreurs::droits();
        }
        $etudiant = Db::un('SELECT * FROM students WHERE id = ?', [$ctx->studentId]);
        if ($etudiant === null) {
            throw Erreurs::droits();
        }
        if ($etudiant['classe_id'] !== $seance['classe_id']) {
            Journal::ecrire('refus_classe', ['userId' => $ctx->userId]);
            throw Erreurs::perimetre();
        }
        return $etudiant;
    }

    /**
     * §13.3 « Fuite des taux et des montants » : une seule porte pour les
     * montants. Toute lecture de taux ou de coût passe par cet appel.
     */
    public static function peutVoirLesMontants(Contexte $ctx): bool
    {
        return $ctx->aLeRole('administration');
    }

    public static function exigerMontants(Contexte $ctx): void
    {
        if (!self::peutVoirLesMontants($ctx)) {
            Journal::ecrire('refus_montants', ['userId' => $ctx->userId]);
            throw Erreurs::droits();
        }
    }

    /** Poste de pointage rattaché à une secrétaire. */
    public static function stationDuSecretariat(Contexte $ctx): array
    {
        self::exigerRole($ctx, ['secretaire', 'administration']);
        $station = Db::un('SELECT * FROM stations WHERE secretary_user_id = ?', [$ctx->userId]);
        if ($station === null) {
            throw Erreurs::introuvable();
        }
        return $station;
    }
}
