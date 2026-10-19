<?php
declare(strict_types=1);

/**
 * Mots de passe et comptes.
 *
 *  §13.2 « Mots de passe mal stockés » — Argon2id, avec repli sur bcrypt si
 *         l'hébergeur ne le propose pas. Jamais MD5, jamais SHA-1, jamais de
 *         mot de passe en clair.
 *  §13.2 « Énumération de comptes »    — même message et même coût pour un
 *         compte inconnu et un mot de passe faux.
 */
final class Identite
{
    /**
     * Condensé factice, utilisé quand le compte n'existe pas.
     *
     * Sans lui, une connexion sur un identifiant inconnu répondrait beaucoup
     * plus vite qu'une connexion sur un identifiant réel : il suffirait de
     * mesurer le temps de réponse pour savoir quels comptes existent.
     */
    private const CONDENSE_FACTICE =
        '$argon2id$v=19$m=65536,t=4,p=1$ZmFjdGljZWZhY3RpY2U$'
        . 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    /** Algorithme retenu : Argon2id si disponible. */
    private static function algorithme(): string
    {
        return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
    }

    public static function hacher(string $motDePasse): string
    {
        $hache = password_hash($motDePasse, self::algorithme());
        if ($hache === false) {
            throw Erreurs::interne('Le haché du mot de passe n\'a pas pu être calculé.');
        }
        return $hache;
    }

    /** Vérifie un mot de passe contre son condensé. */
    public static function verifier(string $motDePasse, ?string $condense): bool
    {
        if ($condense === null || $condense === '') {
            // On calcule quand même, pour ne pas répondre plus vite.
            password_verify($motDePasse, self::CONDENSE_FACTICE);
            return false;
        }
        return password_verify($motDePasse, $condense);
    }

    /** Consomme le même temps qu'une vérification réelle (§13.2). */
    public static function verifierAVide(string $motDePasse): void
    {
        password_verify($motDePasse, self::CONDENSE_FACTICE);
    }

    /**
     * Politique de mot de passe (§13.2).
     * @return string|null le motif du refus, ou null si le mot de passe convient.
     */
    public static function problemeDeMotDePasse(string $motDePasse): ?string
    {
        if (mb_strlen($motDePasse) < 8) {
            return 'Le mot de passe doit faire au moins 8 caractères.';
        }
        if (mb_strlen($motDePasse) > 128) {
            return 'Le mot de passe est trop long.';
        }
        if (!preg_match('/[^a-zA-Z]/', $motDePasse)) {
            return 'Ajoutez au moins un chiffre ou un caractère spécial.';
        }
        return null;
    }

    /**
     * Crée un compte et ses rôles, dans une seule transaction.
     *
     * §13.3 « Élévation de rôle » : les rôles sont posés ici, par du code
     * d'administration, jamais depuis une requête ordinaire.
     */
    public static function creerCompte(array $champs, array $roles, string $motDePasse): string
    {
        $probleme = Schema::problemeDeRoles($roles);
        if ($probleme !== null) {
            throw Erreurs::invalide($probleme);
        }

        $id = $champs['id'] ?? Outils::uuid();

        Db::transaction(function () use ($id, $champs, $roles, $motDePasse) {
            Db::inserer('users', [
                'id'                   => $id,
                'login'                => $champs['login'],
                'login_key'            => mb_strtolower($champs['login']),
                'nom'                  => $champs['nom'] ?? '',
                'prenom'               => $champs['prenom'] ?? '',
                'telephone'            => $champs['telephone'] ?? null,
                'password_hash'        => self::hacher($motDePasse),
                // §13.2 : mot de passe provisoire, à changer à la première connexion.
                'must_change_password' => $champs['mustChangePassword'] ?? 1,
                'actif'                => 1,
                'teacher_id'           => $champs['teacherId'] ?? null,
                'student_id'           => $champs['studentId'] ?? null,
                'filiere_id'           => $champs['filiereId'] ?? null,
                'created_at'           => Outils::maintenant(),
            ]);

            foreach ($roles as $role) {
                Db::inserer('user_roles', ['user_id' => $id, 'role' => $role]);
            }
        });

        return $id;
    }

    /** Rôles d'un compte. */
    public static function roles(string $userId): array
    {
        return array_column(
            Db::tout('SELECT role FROM user_roles WHERE user_id = ?', [$userId]),
            'role'
        );
    }

    /** Ajoute un rôle, en vérifiant que le cumul reste permis (§13.3). */
    public static function ajouterRole(string $userId, string $role): void
    {
        $roles = self::roles($userId);
        if (in_array($role, $roles, true)) {
            return;
        }

        $roles[] = $role;
        $probleme = Schema::problemeDeRoles($roles);
        if ($probleme !== null) {
            throw Erreurs::invalide($probleme);
        }

        Db::inserer('user_roles', ['user_id' => $userId, 'role' => $role]);
    }
}
