<?php
declare(strict_types=1);

/**
 * Justifications (§6), alerte aux parents (§8) et administration (§3, §7).
 */
final class OperationsAdmin
{
    /* ================================================================= *
     *  Justifications (§6)
     * ================================================================= */

    public static function justificationDemander(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['etudiant']);
        if (!$meta['enLigne']) {
            throw Erreurs::reseau(); // §9
        }
        if ($ctx->studentId === null) {
            throw Erreurs::droits();
        }

        $seance = Db::un('SELECT * FROM sessions WHERE id = ?', [$p['sessionId']]);
        if ($seance === null) {
            throw Erreurs::introuvable();
        }
        $etudiant = Garde::exigerEtudiantDeLaSeance($ctx, $seance);

        if (Regles::etat($seance) !== Regles::TERMINEE) {
            throw Erreurs::invalide("Cette séance n'est pas encore terminée.");
        }

        $present = Db::compte(
            'SELECT COUNT(*) FROM session_presents WHERE session_id = ? AND student_id = ?',
            [$seance['id'], $ctx->studentId]
        );
        if ($present > 0) {
            throw Erreurs::invalide('Vous êtes marqué présent à cette séance.');
        }

        $deja = Db::compte(
            'SELECT COUNT(*) FROM justifications WHERE session_id = ? AND student_id = ?',
            [$seance['id'], $ctx->studentId]
        );
        if ($deja > 0) {
            throw Erreurs::conflit('Une demande existe déjà pour cette absence.');
        }

        // §13.7 : limite du nombre de dépôts par étudiant.
        $total = Db::compte('SELECT COUNT(*) FROM justifications WHERE student_id = ?', [$ctx->studentId]);
        if ($total >= 50) {
            throw Erreurs::invalide('Trop de demandes déposées. Contactez votre chef de département.');
        }

        $classe = Db::un('SELECT filiere_id FROM classes WHERE id = ?', [$seance['classe_id']]);

        // §13.7 « Justificatif accessible à tous » : le fichier est rangé hors
        // du dossier web ; la base ne garde que son nom généré.
        $piece = $p['piece'] ?? null;
        $nomFichier = null;
        if ($piece !== null) {
            $nomFichier = Fichiers::enregistrerJustificatif($piece);
        }

        Db::inserer('justifications', [
            'id'           => Outils::uuid(),
            'session_id'   => $seance['id'],
            'student_id'   => $ctx->studentId,
            'filiere_id'   => $classe['filiere_id'] ?? null,
            'motif'        => $p['motif'],
            'piece_nom'    => $nomFichier,
            'piece_type'   => $piece['type'] ?? null,
            'piece_taille' => $piece['size'] ?? null,
            'state'        => 'en_attente',
            'directe'      => 0,
            'created_at'   => $meta['recuA'],
        ]);

        Historique::ajouter([
            'entity'      => 'justification',
            'entityId'    => $seance['id'],
            'action'      => 'demande_deposee',
            'authorId'    => $ctx->userId,
            'authorLabel' => $etudiant['prenom'] . ' ' . $etudiant['nom'],
            'note'        => $p['motif'],
        ]);

        return ['ok' => true];
    }

    public static function justificationDecider(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['chef']);
        if (!$meta['enLigne']) {
            throw Erreurs::reseau();
        }

        $justif = Db::un('SELECT * FROM justifications WHERE id = ?', [$p['justificationId']]);
        if ($justif === null) {
            throw Erreurs::introuvable();
        }
        // §13.3 « Chef de département hors filière ».
        Garde::exigerFiliereDuChef($ctx, $justif['filiere_id']);

        Db::modifier('justifications', [
            'state'       => $p['decision'],
            'commentaire' => $p['commentaire'],
            'decided_at'  => $meta['recuA'],
            'decided_by'  => $ctx->userId,
        ], ['id' => $justif['id']]);

        // §13.4 « Décision sans trace » : chaque décision est historisée.
        Historique::ajouter([
            'entity'      => 'justification',
            'entityId'    => $justif['id'],
            'action'      => $p['decision'] === 'acceptee'
                ? 'justification_acceptee' : 'justification_refusee',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'field'       => 'state',
            'before'      => $justif['state'],
            'after'       => $p['decision'],
            'note'        => $p['commentaire'],
        ]);

        return ['ok' => true];
    }

    /** Le chef peut justifier directement, sans demande de l'étudiant (§6). */
    public static function justificationDirecte(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['chef']);
        if (!$meta['enLigne']) {
            throw Erreurs::reseau();
        }

        $seance = Db::un('SELECT * FROM sessions WHERE id = ?', [$p['sessionId']]);
        if ($seance === null) {
            throw Erreurs::introuvable();
        }
        $classe = Db::un('SELECT filiere_id FROM classes WHERE id = ?', [$seance['classe_id']]);
        Garde::exigerFiliereDuChef($ctx, $classe['filiere_id'] ?? null);

        $etudiant = Db::un('SELECT * FROM students WHERE id = ?', [$p['studentId']]);
        if ($etudiant === null || $etudiant['classe_id'] !== $seance['classe_id']) {
            throw Erreurs::perimetre();
        }

        $existant = Db::un(
            'SELECT * FROM justifications WHERE session_id = ? AND student_id = ?',
            [$seance['id'], $p['studentId']]
        );

        if ($existant === null) {
            Db::inserer('justifications', [
                'id'          => Outils::uuid(),
                'session_id'  => $seance['id'],
                'student_id'  => $p['studentId'],
                'filiere_id'  => $classe['filiere_id'] ?? null,
                'motif'       => 'Justifiée par le chef de département',
                'state'       => 'acceptee',
                'directe'     => 1,
                'commentaire' => $p['commentaire'],
                'created_at'  => $meta['recuA'],
                'decided_at'  => $meta['recuA'],
                'decided_by'  => $ctx->userId,
            ]);
        } else {
            Db::modifier('justifications', [
                'state'       => 'acceptee',
                'directe'     => 1,
                'commentaire' => $p['commentaire'],
                'decided_at'  => $meta['recuA'],
                'decided_by'  => $ctx->userId,
            ], ['id' => $existant['id']]);
        }

        Historique::ajouter([
            'entity'      => 'justification',
            'entityId'    => $existant['id'] ?? $seance['id'],
            'action'      => 'justification_directe',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'field'       => 'state',
            'before'      => $existant['state'] ?? null,
            'after'       => 'acceptee',
            'note'        => $p['commentaire'],
            // §13.4 « Décision sans trace » : signalé, car sans demande préalable.
            'flagged'     => true,
        ]);

        return ['ok' => true];
    }

    /* ================================================================= *
     *  Alerte aux parents (§8)
     * ================================================================= */

    /**
     * §13.9 « Alerte envoyée au mauvais parent » : le lien est construit ICI,
     * avec le numéro LU EN BASE. Le navigateur n'envoie qu'un identifiant.
     */
    public static function contacterParent(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['chef', 'administration']);
        if (!$meta['enLigne']) {
            throw Erreurs::reseau();
        }

        $etudiant = Db::un('SELECT * FROM students WHERE id = ?', [$p['studentId']]);
        if ($etudiant === null) {
            throw Erreurs::introuvable();
        }

        $classe = Db::un('SELECT * FROM classes WHERE id = ?', [$etudiant['classe_id']]);
        if (!$ctx->aLeRole('administration')) {
            Garde::exigerFiliereDuChef($ctx, $classe['filiere_id'] ?? null);
        }

        // Sans numéro, il n'y a personne à joindre.
        $numero = preg_replace('/\D/', '', (string) $etudiant['parent_phone']);
        if (!preg_match('/^\d{8,15}$/', $numero)) {
            throw Erreurs::invalide(
                "Aucun numéro de parent valide pour cet étudiant. Complétez-le dans le Référentiel."
            );
        }

        $parametres = Parametres::lire();
        $filiere = Db::un('SELECT nom FROM filieres WHERE id = ?', [$classe['filiere_id'] ?? null]);
        $totaux  = Rapports::totauxAbsences($etudiant['id']);

        // §13.1 « Injection dans le modèle de message » : substitution de texte,
        // sans aucun moteur qui exécute du code.
        $message = Messages::rendre($parametres['modeleMessage'], [
            'etudiant'      => $etudiant['prenom'] . ' ' . $etudiant['nom'],
            'classe'        => trim(($filiere['nom'] ?? '') . ' niveau ' . ($classe['niveau'] ?? '')),
            'heures'        => number_format($totaux['nonJustifiees'], 1, ',', ' ') . ' h',
            'periode'       => $totaux['periodeLabel'],
            'etablissement' => $parametres['etablissement'],
        ]);

        // §13.1 « Injection dans le lien WhatsApp » : chiffres seuls, message encodé.
        $lien = 'https://wa.me/' . $numero . '?text=' . rawurlencode($message);

        Db::inserer('parent_contacts', [
            'id'         => Outils::uuid(),
            'student_id' => $etudiant['id'],
            'at'         => $meta['recuA'],
            'by_user_id' => $ctx->userId,
            'by_label'   => $ctx->label,
        ]);

        Historique::ajouter([
            'entity'      => 'alerte',
            'entityId'    => $etudiant['id'],
            'action'      => 'parent_contacte',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'note'        => $etudiant['prenom'] . ' ' . $etudiant['nom'],
        ]);

        // L'application ne peut pas savoir si le message a été envoyé (§8).
        return ['lien' => $lien, 'message' => $message];
    }

    /* ================================================================= *
     *  Taux et paramètres (§7)
     * ================================================================= */

    public static function adminTaux(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['administration']);
        if (!$meta['enLigne']) {
            throw Erreurs::reseau();
        }

        $probleme = Taux::problemeDeTaux($p);
        if ($probleme !== null) {
            throw Erreurs::invalide($probleme);
        }

        if (!empty($p['teacherId'])
            && Db::compte('SELECT COUNT(*) FROM teachers WHERE id = ?', [$p['teacherId']]) === 0) {
            throw Erreurs::introuvable();
        }
        if (!empty($p['matiereId'])
            && Db::compte('SELECT COUNT(*) FROM matieres WHERE id = ?', [$p['matiereId']]) === 0) {
            throw Erreurs::introuvable();
        }

        $id = Outils::uuid();
        // §13.4 : un taux n'est jamais modifié, on en crée un nouveau.
        Db::inserer('rates', [
            'id'         => $id,
            'scope'      => $p['scope'],
            'teacher_id' => $p['teacherId'],
            'matiere_id' => $p['matiereId'],
            'niveau'     => $p['niveau'],
            'montant'    => $p['montant'],
            'date_effet' => $p['dateEffet'],
            'created_at' => $meta['recuA'],
            'created_by' => $ctx->userId,
        ]);

        Historique::ajouter([
            'entity'      => 'taux',
            'entityId'    => $id,
            'action'      => 'taux_cree',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'field'       => 'montant',
            'after'       => $p['montant'],
            'note'        => $p['scope'] . ' — effet au ' . $p['dateEffet'],
        ]);

        return ['id' => $id];
    }

    public static function adminParametres(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['administration']);
        if (!$meta['enLigne']) {
            throw Erreurs::reseau();
        }

        $avant = Parametres::lire();
        $patch = array_filter($p, fn($v) => $v !== null);
        $apres = Parametres::ecrire($patch);

        foreach (array_keys($patch) as $clef) {
            if (($avant[$clef] ?? null) !== ($apres[$clef] ?? null)) {
                Historique::ajouter([
                    'entity'      => 'parametre',
                    'entityId'    => $clef,
                    'action'      => 'parametre_modifie',
                    'authorId'    => $ctx->userId,
                    'authorLabel' => $ctx->label,
                    'field'       => $clef,
                    'before'      => $avant[$clef] ?? null,
                    'after'       => $apres[$clef] ?? null,
                    // §13.9 « Message d'alerte piégé » : changement signalé.
                    'flagged'     => $clef === 'modeleMessage',
                ]);
            }
        }

        return ['ok' => true];
    }

    public static function adminSemestres(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['administration']);
        if (!$meta['enLigne']) {
            throw Erreurs::reseau();
        }

        $s = $p['semestres'];
        if ($s['s1Debut'] >= $s['s1Fin'] || $s['s2Debut'] >= $s['s2Fin']) {
            throw Erreurs::invalide('Chaque semestre doit finir après son début.');
        }
        if ($s['s1Fin'] >= $s['s2Debut']) {
            throw Erreurs::invalide('Le semestre 2 doit commencer après le semestre 1.');
        }

        $avant = Parametres::lire();
        Parametres::ecrire(['semestres' => $s]);

        Historique::ajouter([
            'entity'      => 'parametre',
            'entityId'    => 'semestres',
            'action'      => 'semestres_modifies',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'field'       => 'semestres',
            'before'      => json_encode($avant['semestres'] ?? null, JSON_UNESCAPED_UNICODE),
            'after'       => json_encode($s, JSON_UNESCAPED_UNICODE),
        ]);

        return ['ok' => true];
    }

    public static function adminCompte(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['administration']);
        if (!$meta['enLigne']) {
            throw Erreurs::reseau();
        }

        $user = Db::un('SELECT * FROM users WHERE id = ?', [$p['userId']]);
        if ($user === null) {
            throw Erreurs::introuvable();
        }

        $resultat = [];

        if ($p['actif'] !== null && (bool) $p['actif'] !== ((int) $user['actif'] === 1)) {
            Db::modifier('users', ['actif' => $p['actif'] ? 1 : 0], ['id' => $user['id']]);

            // §13.2 « Session jamais révoquée » : on coupe les sessions ouvertes.
            if (!$p['actif']) {
                Garde::fermerToutesLesSessions($user['id']);
            }

            Historique::ajouter([
                'entity'      => 'compte',
                'entityId'    => $user['id'],
                'action'      => $p['actif'] ? 'compte_active' : 'compte_desactive',
                'authorId'    => $ctx->userId,
                'authorLabel' => $ctx->label,
                'field'       => 'actif',
                'before'      => (int) $user['actif'] === 1 ? 'oui' : 'non',
                'after'       => $p['actif'] ? 'oui' : 'non',
            ]);

            $resultat['actif'] = (bool) $p['actif'];
        }

        if (!empty($p['reinitialiser'])) {
            // §13.2 « Réinitialisation de mot de passe » : par l'administration.
            $provisoire = Outils::motDePasseProvisoire();
            Db::modifier('users', [
                'password_hash'        => Identite::hacher($provisoire),
                'must_change_password' => 1,
            ], ['id' => $user['id']]);

            Garde::fermerToutesLesSessions($user['id']);

            Historique::ajouter([
                'entity'      => 'compte',
                'entityId'    => $user['id'],
                'action'      => 'mot_de_passe_reinitialise',
                'authorId'    => $ctx->userId,
                'authorLabel' => $ctx->label,
                'note'        => "Mot de passe provisoire remis à l'utilisateur.",
            ]);

            // Affiché une seule fois, jamais stocké en clair.
            $resultat['motDePasseProvisoire'] = $provisoire;
        }

        return $resultat;
    }
}
