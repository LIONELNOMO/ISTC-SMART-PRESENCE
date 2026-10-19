<?php
declare(strict_types=1);

/**
 * Référentiel et import des étudiants (§3).
 *
 *  §13.3 « Affectation de masse »          — chaque entité a sa liste blanche
 *         de champs, dans `Formes::referentiel()`.
 *  §13.7 « Import qui écrase des comptes » — l'import NE CRÉE que des
 *         étudiants. Un matricule déjà présent est signalé et laissé intact.
 *  §13.6 « Déni de service »               — nombre de lignes borné, débit limité.
 */
final class OperationsReferentiel
{
    /* ================================================================= *
     *  Référentiel
     * ================================================================= */

    public static function referentiel(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['administration']);
        if (!$meta['enLigne']) {
            throw Erreurs::reseau();
        }

        $formes = Formes::referentiel();
        if (!isset($formes[$p['entite']])) {
            throw Erreurs::invalide('Entité inconnue.');
        }

        // Les valeurs sont revalidées contre la forme de CETTE entité.
        $v = Schema::valider($p['valeurs'], $formes[$p['entite']], $p['entite']);

        $methode = 'entite' . ucfirst($p['entite']);
        return self::$methode($ctx, $v, $p['id'] ?? null, $meta);
    }

    private static function entiteFiliere(Contexte $ctx, array $v, ?string $id, array $meta): array
    {
        $avant = $id === null ? null : Db::un('SELECT * FROM filieres WHERE id = ?', [$id]);
        $id = $id ?? Outils::uuid();

        // §4 : la filière propose-t-elle une section anglophone ?
        $sectionAnglophone = !empty($v['sectionAnglophone']) ? 1 : 0;

        if ($avant === null) {
            Db::inserer('filieres', [
                'id' => $id, 'nom' => $v['nom'], 'chef_user_id' => $v['chefUserId'],
                'departement_id' => $v['departementId'],
                'section_anglophone' => $sectionAnglophone,
            ]);
        } else {
            Db::modifier(
                'filieres',
                [
                    'nom' => $v['nom'],
                    'chef_user_id' => $v['chefUserId'],
                    'departement_id' => $v['departementId'],
                    'section_anglophone' => $sectionAnglophone,
                ],
                ['id' => $id]
            );
        }

        if ($v['chefUserId'] !== null) {
            $chef = Db::un('SELECT * FROM users WHERE id = ?', [$v['chefUserId']]);
            if ($chef === null) {
                throw Erreurs::introuvable();
            }
            // Le cumul est vérifié ici (§13.3 « Pointage de soi-même »).
            Identite::ajouterRole($v['chefUserId'], 'chef');
            Db::modifier('users', ['filiere_id' => $id], ['id' => $v['chefUserId']]);
        }

        Historique::ajouter([
            'entity'      => 'referentiel',
            'entityId'    => $id,
            'action'      => $avant === null ? 'filiere_creee' : 'filiere_modifiee',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'field'       => 'nom',
            'before'      => $avant['nom'] ?? null,
            'after'       => $v['nom'],
        ]);

        return ['entite' => 'filiere', 'id' => $id];
    }

    private static function entiteClasse(Contexte $ctx, array $v, ?string $id, array $meta): array
    {
        $filiere = Db::un('SELECT * FROM filieres WHERE id = ?', [$v['filiereId']]);
        if ($filiere === null) {
            throw Erreurs::introuvable();
        }

        $existante = Db::un(
            'SELECT * FROM classes WHERE filiere_id = ? AND niveau = ?',
            [$v['filiereId'], $v['niveau']]
        );
        if ($existante !== null && $existante['id'] !== $id) {
            throw Erreurs::conflit('Cette classe existe déjà.');
        }

        $id = $id ?? Outils::uuid();
        $nom = $filiere['nom'] . ' — niveau ' . $v['niveau'];

        if ($existante === null) {
            Db::inserer('classes', [
                'id' => $id, 'filiere_id' => $v['filiereId'],
                'niveau' => $v['niveau'], 'nom' => $nom,
            ]);
        } else {
            Db::modifier('classes', ['niveau' => $v['niveau'], 'nom' => $nom], ['id' => $id]);
        }

        Historique::ajouter([
            'entity'      => 'referentiel',
            'entityId'    => $id,
            'action'      => $existante === null ? 'classe_creee' : 'classe_modifiee',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'after'       => $nom,
        ]);

        return ['entite' => 'classe', 'id' => $id];
    }

    private static function entiteMatiere(Contexte $ctx, array $v, ?string $id, array $meta): array
    {
        if (Db::compte('SELECT COUNT(*) FROM classes WHERE id = ?', [$v['classeId']]) === 0) {
            throw Erreurs::introuvable();
        }

        $avant = $id === null ? null : Db::un('SELECT * FROM matieres WHERE id = ?', [$id]);
        $id = $id ?? Outils::uuid();

        if ($avant === null) {
            Db::inserer('matieres', [
                'id' => $id, 'nom' => $v['nom'], 'nom_en' => $v['nomEn'] ?? null,
                'classe_id' => $v['classeId'], 'semestre' => $v['semestre'] ?? 1,
            ]);
        } else {
            $maj = ['nom' => $v['nom'], 'classe_id' => $v['classeId']];
            // Le nom anglais et le semestre ne changent que s'ils sont fournis.
            if (array_key_exists('nomEn', $v)) {
                $maj['nom_en'] = $v['nomEn'];
            }
            if (isset($v['semestre'])) {
                $maj['semestre'] = $v['semestre'];
            }
            Db::modifier('matieres', $maj, ['id' => $id]);
        }

        Historique::ajouter([
            'entity'      => 'referentiel',
            'entityId'    => $id,
            'action'      => $avant === null ? 'matiere_creee' : 'matiere_modifiee',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'field'       => 'nom',
            'before'      => $avant['nom'] ?? null,
            'after'       => $v['nom'],
        ]);

        return ['entite' => 'matiere', 'id' => $id];
    }

    private static function entiteEnseignant(Contexte $ctx, array $v, ?string $id, array $meta): array
    {
        return self::creerPersonnel($ctx, $v, $id, 'enseignant', $meta);
    }

    private static function entiteSecretaire(Contexte $ctx, array $v, ?string $id, array $meta): array
    {
        return self::creerPersonnel($ctx, $v, $id, 'secretaire', $meta);
    }

    /** Création d'un enseignant ou d'une secrétaire, avec son compte. */
    private static function creerPersonnel(Contexte $ctx, array $v, ?string $userId, string $role, array $meta): array
    {
        // §14 : le téléphone est l'identifiant de connexion.
        $loginKey = mb_strtolower($v['telephone']);
        $conflit = Db::un('SELECT id FROM users WHERE login_key = ?', [$loginKey]);
        if ($conflit !== null && $conflit['id'] !== $userId) {
            throw Erreurs::conflit('Ce numéro de téléphone est déjà utilisé par un compte.');
        }

        $existant = $userId === null ? null : Db::un('SELECT * FROM users WHERE id = ?', [$userId]);
        $resultat = ['entite' => $role];

        if ($existant === null) {
            // §13.2 : mot de passe provisoire aléatoire, jamais dérivé du nom.
            $provisoire = Outils::motDePasseProvisoire();
            $userId = Identite::creerCompte([
                'login'     => $v['telephone'],
                'nom'       => $v['nom'],
                'prenom'    => $v['prenom'],
                'telephone' => $v['telephone'],
            ], [$role], $provisoire);

            // Affiché une seule fois, jamais stocké en clair.
            $resultat['motDePasseProvisoire'] = $provisoire;
        } else {
            Db::modifier('users', [
                'login'     => $v['telephone'],
                'login_key' => $loginKey,
                'nom'       => $v['nom'],
                'prenom'    => $v['prenom'],
                'telephone' => $v['telephone'],
            ], ['id' => $userId]);
            Identite::ajouterRole($userId, $role);
        }

        if ($role === 'enseignant') {
            $user = Db::un('SELECT teacher_id FROM users WHERE id = ?', [$userId]);
            $teacherId = $user['teacher_id'] ?? null;

            if ($teacherId === null) {
                $teacherId = Outils::uuid();
                Db::inserer('teachers', [
                    'id' => $teacherId, 'nom' => $v['nom'], 'prenom' => $v['prenom'],
                    'telephone' => $v['telephone'], 'user_id' => $userId, 'actif' => 1,
                    'departement_id' => $v['departementId'] ?? null,
                ]);
                Db::modifier('users', ['teacher_id' => $teacherId], ['id' => $userId]);
            } else {
                Db::modifier('teachers', [
                    'nom' => $v['nom'], 'prenom' => $v['prenom'], 'telephone' => $v['telephone'],
                    'departement_id' => $v['departementId'] ?? null,
                ], ['id' => $teacherId]);
            }
            $resultat['teacherId'] = $teacherId;
        } else {
            // Poste de pointage de la secrétaire, avec sa clef de signature (§13.4).
            $station = Db::un('SELECT id FROM stations WHERE secretary_user_id = ?', [$userId]);
            if ($station === null) {
                Db::inserer('stations', [
                    'id'                => 'poste-' . strtolower(Outils::code(4)),
                    'label'             => 'Secrétariat — ' . $v['prenom'] . ' ' . $v['nom'],
                    'secret'            => QrCodes::nouveauSecretPoste(),
                    'secretary_user_id' => $userId,
                ]);
            }
        }

        Historique::ajouter([
            'entity'      => 'compte',
            'entityId'    => $userId,
            'action'      => $existant === null ? 'compte_cree' : 'compte_modifie',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'note'        => $v['prenom'] . ' ' . $v['nom'] . ' — ' . $role,
        ]);

        $resultat['id'] = $userId;
        return $resultat;
    }

    private static function entiteAffectation(Contexte $ctx, array $v, ?string $id, array $meta): array
    {
        $teacher = Db::un('SELECT * FROM teachers WHERE id = ?', [$v['teacherId']]);
        $matiere = Db::un('SELECT * FROM matieres WHERE id = ?', [$v['matiereId']]);
        if ($teacher === null || $matiere === null) {
            throw Erreurs::introuvable();
        }

        $deja = Db::compte(
            'SELECT COUNT(*) FROM affectations WHERE teacher_id = ? AND matiere_id = ?',
            [$v['teacherId'], $v['matiereId']]
        );
        if ($deja > 0) {
            throw Erreurs::conflit('Cette affectation existe déjà.');
        }

        $id = Outils::uuid();
        Db::inserer('affectations', [
            'id' => $id, 'teacher_id' => $v['teacherId'], 'matiere_id' => $v['matiereId'],
        ]);

        Historique::ajouter([
            'entity'      => 'referentiel',
            'entityId'    => $id,
            'action'      => 'affectation_creee',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'after'       => $teacher['nom'] . ' → ' . $matiere['nom'],
        ]);

        return ['entite' => 'affectation', 'id' => $id];
    }

    private static function entiteEtudiant(Contexte $ctx, array $v, ?string $id, array $meta): array
    {
        if (Db::compte('SELECT COUNT(*) FROM classes WHERE id = ?', [$v['classeId']]) === 0) {
            throw Erreurs::introuvable();
        }

        $doublon = Db::un('SELECT id FROM students WHERE matricule = ?', [$v['matricule']]);
        if ($doublon !== null && $doublon['id'] !== $id) {
            throw Erreurs::conflit('Ce matricule existe déjà.');
        }

        $existant = $id === null ? null : Db::un('SELECT * FROM students WHERE id = ?', [$id]);
        $id = $id ?? Outils::uuid();
        $resultat = ['entite' => 'etudiant', 'id' => $id];

        $userId = $existant['user_id'] ?? null;
        if ($userId === null) {
            $provisoire = Outils::motDePasseProvisoire();
            $userId = Identite::creerCompte([
                'login'     => $v['matricule'],
                'nom'       => $v['nom'],
                'prenom'    => $v['prenom'],
                'studentId' => $id,
            ], ['etudiant'], $provisoire);
            $resultat['motDePasseProvisoire'] = $provisoire;
        }

        // §4 : section (francophone par défaut). « anglophone » n'est retenu que
        // si la filière de la classe propose cette section.
        $section = ($v['section'] ?? 'francophone') === 'anglophone' ? 'anglophone' : 'francophone';
        if ($section === 'anglophone') {
            $cl = Db::un('SELECT filiere_id FROM classes WHERE id = ?', [$v['classeId']]);
            $fi = $cl === null ? null : Db::un('SELECT section_anglophone FROM filieres WHERE id = ?', [$cl['filiere_id']]);
            if ($fi === null || (int) ($fi['section_anglophone'] ?? 0) !== 1) {
                throw Erreurs::invalide("Cette filière n'a pas de section anglophone.");
            }
        }

        if ($existant === null) {
            Db::inserer('students', [
                'id' => $id, 'matricule' => $v['matricule'], 'nom' => $v['nom'],
                'prenom' => $v['prenom'], 'classe_id' => $v['classeId'], 'section' => $section,
                'parent_phone' => $v['parentPhone'] ?? '', 'user_id' => $userId, 'actif' => 1,
            ]);
        } else {
            Db::modifier('students', [
                'matricule' => $v['matricule'], 'nom' => $v['nom'], 'prenom' => $v['prenom'],
                'classe_id' => $v['classeId'], 'section' => $section, 'parent_phone' => $v['parentPhone'] ?? '',
            ], ['id' => $id]);
        }

        Historique::ajouter([
            'entity'      => 'referentiel',
            'entityId'    => $id,
            'action'      => $existant === null ? 'etudiant_cree' : 'etudiant_modifie',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            // §13.9 : tout changement de numéro de parent est historisé.
            'field'       => ($existant !== null && $existant['parent_phone'] !== ($v['parentPhone'] ?? ''))
                ? 'parentPhone' : null,
            'before'      => $existant['parent_phone'] ?? null,
            'after'       => $v['parentPhone'] ?? null,
            'note'        => $v['prenom'] . ' ' . $v['nom'] . ' (' . $v['matricule'] . ')',
        ]);

        return $resultat;
    }

    /* ================================================================= *
     *  Import des étudiants (§3)
     * ================================================================= */

    public static function importEtudiants(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['administration']);
        if (!$meta['enLigne']) {
            throw Erreurs::reseau();
        }
        Limites::exigerAutorise('import', $ctx->userId);

        $rapport = [
            'crees' => 0, 'doublons' => [], 'refusees' => [],
            'classesCreees' => [], 'sansParent' => [],
        ];

        $filieres = Db::tout('SELECT * FROM filieres');
        $classes  = Db::tout('SELECT * FROM classes');

        $normaliser = function (string $s): string {
            $s = mb_strtolower(trim($s));
            // Retire les accents pour comparer « Génie » et « Genie ».
            return strtr($s, [
                'à'=>'a','â'=>'a','ä'=>'a','é'=>'e','è'=>'e','ê'=>'e','ë'=>'e',
                'î'=>'i','ï'=>'i','ô'=>'o','ö'=>'o','ù'=>'u','û'=>'u','ü'=>'u','ç'=>'c',
            ]);
        };

        $formeLigne = Formes::ligneImport();

        foreach ($p['lignes'] as $brute) {
            try {
                $ligne = Schema::valider($brute, $formeLigne, 'ligne');
            } catch (ApiErreur $e) {
                $rapport['refusees'][] = [
                    'matricule' => is_array($brute) ? (string) ($brute['matricule'] ?? '?') : '?',
                    'raison'    => $e->getMessage(),
                ];
                continue;
            }

            // Filière
            $filiere = null;
            foreach ($filieres as $f) {
                if ($normaliser($f['nom']) === $normaliser($ligne['filiere'])) {
                    $filiere = $f;
                    break;
                }
            }
            if ($filiere === null) {
                $rapport['refusees'][] = [
                    'matricule' => $ligne['matricule'],
                    'raison'    => 'Filière inconnue : ' . $ligne['filiere'],
                ];
                continue;
            }

            // Section (§4) : francophone par défaut ; « anglophone » n'est
            // accepté que si la filière propose cette section.
            $sectionBrute = $normaliser((string) ($ligne['section'] ?? ''));
            $section = in_array($sectionBrute, ['anglophone', 'anglais', 'english', 'en', 'ang'], true)
                ? 'anglophone'
                : 'francophone';
            if ($section === 'anglophone' && (int) ($filiere['section_anglophone'] ?? 0) !== 1) {
                $rapport['refusees'][] = [
                    'matricule' => $ligne['matricule'],
                    'raison'    => 'La filière « ' . $filiere['nom'] . " » n'a pas de section anglophone.",
                ];
                continue;
            }

            // Niveau
            $niveau = (int) preg_replace('/\D/', '', $ligne['niveau']);
            if ($niveau < 1 || $niveau > 8) {
                $rapport['refusees'][] = [
                    'matricule' => $ligne['matricule'],
                    'raison'    => 'Niveau invalide : ' . $ligne['niveau'],
                ];
                continue;
            }

            // Classe, créée si elle manque
            $classe = null;
            foreach ($classes as $c) {
                if ($c['filiere_id'] === $filiere['id'] && (int) $c['niveau'] === $niveau) {
                    $classe = $c;
                    break;
                }
            }
            if ($classe === null) {
                $classe = [
                    'id'         => Outils::uuid(),
                    'filiere_id' => $filiere['id'],
                    'niveau'     => $niveau,
                    'nom'        => $filiere['nom'] . ' — niveau ' . $niveau,
                ];
                Db::inserer('classes', $classe);
                $classes[] = $classe;
                $rapport['classesCreees'][] = $classe['nom'];
            }

            // §13.7 : un matricule déjà présent est signalé, jamais écrasé.
            $existant = Db::un('SELECT * FROM students WHERE matricule = ?', [$ligne['matricule']]);
            if ($existant !== null) {
                $rapport['doublons'][] = [
                    'matricule' => $ligne['matricule'],
                    'nom'       => $existant['prenom'] . ' ' . $existant['nom'],
                ];
                continue;
            }

            // Un numéro présent mais illisible est refusé ; un numéro absent
            // est accepté, et l'étudiant est signalé comme à compléter.
            $parent = $ligne['parent'] === null ? null : Messages::numeroNormalise($ligne['parent']);
            if ($ligne['parent'] !== null && $parent === null) {
                $rapport['refusees'][] = [
                    'matricule' => $ligne['matricule'],
                    'raison'    => 'Numéro du parent invalide',
                ];
                continue;
            }
            if ($parent === null) {
                $rapport['sansParent'][] = [
                    'matricule' => $ligne['matricule'],
                    'nom'       => $ligne['prenom'] . ' ' . $ligne['nom'],
                ];
            }

            $studentId = Outils::uuid();
            $provisoire = Outils::motDePasseProvisoire();

            Db::transaction(function () use ($studentId, $ligne, $classe, $parent, $provisoire, $section) {
                $userId = Identite::creerCompte([
                    'login'     => $ligne['matricule'],
                    'nom'       => $ligne['nom'],
                    'prenom'    => $ligne['prenom'],
                    'studentId' => $studentId,
                ], ['etudiant'], $provisoire);

                Db::inserer('students', [
                    'id'           => $studentId,
                    'matricule'    => $ligne['matricule'],
                    'nom'          => $ligne['nom'],
                    'prenom'       => $ligne['prenom'],
                    'classe_id'    => $classe['id'],
                    'section'      => $section,
                    'parent_phone' => $parent ?? '',
                    'user_id'      => $userId,
                    'actif'        => 1,
                ]);
            });

            $rapport['crees']++;
        }

        Historique::ajouter([
            'entity'      => 'referentiel',
            'entityId'    => 'import',
            'action'      => 'import_etudiants',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'note'        => $rapport['crees'] . ' créé(s), '
                . count($rapport['doublons']) . ' doublon(s), '
                . count($rapport['refusees']) . ' refusée(s)',
        ]);

        Journal::ecrire('import_etudiants', [
            'crees'    => $rapport['crees'],
            'refusees' => count($rapport['refusees']),
        ]);

        return $rapport;
    }
}
