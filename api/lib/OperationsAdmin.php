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
     *  Affectation matière → enseignant par le chef de département (§6)
     * ================================================================= */

    /**
     * Le chef affecte un enseignant à une matière de SA filière, ou l'en
     * retire (teacherId absent). Une matière n'a qu'un enseignant : la
     * nouvelle affectation remplace l'ancienne.
     *
     * §13.3 « Chef de département hors filière » : la matière doit relever
     * d'une de ses filières. L'enseignant doit appartenir à son département
     * (le partage inter-départements fera l'objet d'une autorisation).
     */
    public static function departementAffecter(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['chef', 'administration']);
        if (!$meta['enLigne']) {
            throw Erreurs::reseau();
        }

        // La matière, avec la filière et le département de sa classe.
        $matiere = Db::un(
            'SELECT m.id, m.nom, c.filiere_id, f.departement_id
               FROM matieres m
               JOIN classes c  ON c.id = m.classe_id
               JOIN filieres f ON f.id = c.filiere_id
              WHERE m.id = ?',
            [$p['matiereId']]
        );
        if ($matiere === null) {
            throw Erreurs::introuvable();
        }
        // Le chef ne touche qu'aux matières de ses filières (l'admin passe).
        Garde::exigerFiliereDuChef($ctx, $matiere['filiere_id']);

        $teacherId = $p['teacherId'] ?? null;

        // Retrait : plus aucun enseignant sur cette matière.
        if ($teacherId === null) {
            $avant = Db::un(
                'SELECT a.teacher_id, t.nom, t.prenom
                   FROM affectations a JOIN teachers t ON t.id = a.teacher_id
                  WHERE a.matiere_id = ? LIMIT 1',
                [$matiere['id']]
            );
            Db::supprimer('affectations', ['matiere_id' => $matiere['id']]);
            Historique::ajouter([
                'entity'      => 'affectation',
                'entityId'    => $matiere['id'],
                'action'      => 'affectation_retiree',
                'authorId'    => $ctx->userId,
                'authorLabel' => $ctx->label,
                'before'      => $avant === null ? null
                    : trim($avant['prenom'] . ' ' . $avant['nom']) . ' → ' . $matiere['nom'],
                'after'       => null,
            ]);
            return ['matiereId' => $matiere['id'], 'teacherId' => null];
        }

        // Affectation : l'enseignant doit exister et relever du département.
        $teacher = Db::un('SELECT * FROM teachers WHERE id = ?', [$teacherId]);
        if ($teacher === null) {
            throw Erreurs::introuvable();
        }
        // §13.3 : un chef n'affecte qu'un enseignant de son propre département,
        // OU un enseignant d'un autre département pour lequel son département a
        // reçu une autorisation (partage inter-chefs).
        if (!$ctx->aLeRole('administration')
            && ($teacher['departement_id'] ?? null) !== ($matiere['departement_id'] ?? null)) {
            $autorise = Db::compte(
                "SELECT COUNT(*) FROM autorisations_enseignant
                  WHERE teacher_id = ? AND departement_id = ? AND statut = 'accordee'",
                [$teacherId, $matiere['departement_id']]
            );
            if ($autorise === 0) {
                Journal::ecrire('refus_affectation_perimetre', ['userId' => $ctx->userId]);
                throw Erreurs::perimetre();
            }
        }

        // Une matière = un enseignant : on remplace l'affectation existante.
        Db::supprimer('affectations', ['matiere_id' => $matiere['id']]);
        $id = Outils::uuid();
        Db::inserer('affectations', [
            'id' => $id, 'teacher_id' => $teacherId, 'matiere_id' => $matiere['id'],
        ]);

        Historique::ajouter([
            'entity'      => 'affectation',
            'entityId'    => $id,
            'action'      => 'affectation_creee',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'after'       => trim($teacher['prenom'] . ' ' . $teacher['nom']) . ' → ' . $matiere['nom'],
        ]);

        return ['matiereId' => $matiere['id'], 'teacherId' => $teacherId];
    }

    /** Le chef crée une matière dans une de SES filières, à un niveau donné. */
    public static function departementCreerMatiere(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['chef']);
        if (!$meta['enLigne']) {
            throw Erreurs::reseau();
        }
        Garde::exigerFiliereDuChef($ctx, $p['filiereId']);

        $filiere = Db::un('SELECT * FROM filieres WHERE id = ?', [$p['filiereId']]);
        if ($filiere === null) {
            throw Erreurs::introuvable();
        }

        // Classe (filière + niveau) : créée si elle n'existe pas encore.
        $classe = Db::un(
            'SELECT * FROM classes WHERE filiere_id = ? AND niveau = ?',
            [$p['filiereId'], (int) $p['niveau']]
        );
        if ($classe === null) {
            $classeId = Outils::uuid();
            Db::inserer('classes', [
                'id'         => $classeId,
                'filiere_id' => $p['filiereId'],
                'niveau'     => (int) $p['niveau'],
                'nom'        => $filiere['nom'] . ' — niveau ' . (int) $p['niveau'],
            ]);
        } else {
            $classeId = $classe['id'];
        }

        $id = Outils::uuid();
        Db::inserer('matieres', [
            'id'        => $id,
            'nom'       => $p['nom'],
            'nom_en'    => $p['nomEn'] ?? null,
            'classe_id' => $classeId,
            'semestre'  => $p['semestre'] ?? 1,
        ]);

        Historique::ajouter([
            'entity'      => 'referentiel',
            'entityId'    => $id,
            'action'      => 'matiere_creee',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'field'       => 'nom',
            'after'       => $p['nom'],
        ]);

        return ['id' => $id];
    }

    /* ================================================================= *
     *  Partage d'enseignants entre départements (§13.3)
     * ================================================================= */

    /** Un chef demande à utiliser un enseignant d'un autre département. */
    public static function departementDemanderAcces(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['chef']);
        if (!$meta['enLigne']) {
            throw Erreurs::reseau();
        }
        $monDep = Garde::departementDuChef($ctx);
        if ($monDep === null) {
            throw Erreurs::perimetre();
        }
        $teacher = Db::un('SELECT * FROM teachers WHERE id = ?', [$p['teacherId']]);
        if ($teacher === null) {
            throw Erreurs::introuvable();
        }
        if (($teacher['departement_id'] ?? null) === null) {
            throw Erreurs::invalide("Cet enseignant n'est rattaché à aucun département.");
        }
        if ($teacher['departement_id'] === $monDep) {
            throw Erreurs::invalide('Cet enseignant est déjà dans votre département.');
        }

        $existe = Db::un(
            'SELECT * FROM autorisations_enseignant WHERE teacher_id = ? AND departement_id = ?',
            [$p['teacherId'], $monDep]
        );
        if ($existe !== null && $existe['statut'] === 'accordee') {
            throw Erreurs::conflit('Vous avez déjà accès à cet enseignant.');
        }
        if ($existe !== null && $existe['statut'] === 'en_attente') {
            throw Erreurs::conflit('Une demande est déjà en attente pour cet enseignant.');
        }

        if ($existe !== null) {
            // Ancienne demande refusée/révoquée : on la relance.
            $id = $existe['id'];
            Db::modifier('autorisations_enseignant', [
                'statut'      => 'en_attente',
                'demande_par' => $ctx->userId,
                'demande_at'  => $meta['recuA'],
                'decide_par'  => null,
                'decide_at'   => null,
            ], ['id' => $id]);
        } else {
            $id = Outils::uuid();
            Db::inserer('autorisations_enseignant', [
                'id'             => $id,
                'teacher_id'     => $p['teacherId'],
                'departement_id' => $monDep,
                'statut'         => 'en_attente',
                'demande_par'    => $ctx->userId,
                'demande_at'     => $meta['recuA'],
            ]);
        }

        Historique::ajouter([
            'entity'      => 'autorisation',
            'entityId'    => $id,
            'action'      => 'acces_demande',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'after'       => $teacher['prenom'] . ' ' . $teacher['nom'],
        ]);

        return ['id' => $id, 'statut' => 'en_attente'];
    }

    /** Le chef propriétaire de l'enseignant accorde ou refuse la demande. */
    public static function departementDeciderAcces(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['chef']);
        if (!$meta['enLigne']) {
            throw Erreurs::reseau();
        }
        $a = Db::un('SELECT * FROM autorisations_enseignant WHERE id = ?', [$p['autorisationId']]);
        if ($a === null) {
            throw Erreurs::introuvable();
        }
        $teacher = Db::un('SELECT * FROM teachers WHERE id = ?', [$a['teacher_id']]);
        $monDep = Garde::departementDuChef($ctx);
        // Seul le chef du département PROPRIÉTAIRE de l'enseignant décide.
        if ($monDep === null || $monDep !== ($teacher['departement_id'] ?? null)) {
            throw Erreurs::perimetre();
        }
        if ($a['statut'] !== 'en_attente') {
            throw Erreurs::invalide('Cette demande a déjà été traitée.');
        }

        Db::modifier('autorisations_enseignant', [
            'statut'     => $p['decision'],
            'decide_par' => $ctx->userId,
            'decide_at'  => $meta['recuA'],
        ], ['id' => $a['id']]);

        Historique::ajouter([
            'entity'      => 'autorisation',
            'entityId'    => $a['id'],
            'action'      => $p['decision'] === 'accordee' ? 'acces_accorde' : 'acces_refuse',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'after'       => $teacher['prenom'] . ' ' . $teacher['nom'],
        ]);

        return ['id' => $a['id'], 'statut' => $p['decision']];
    }

    /**
     * Le chef propriétaire révoque un accès déjà accordé : les affectations de
     * l'enseignant dans les filières du département demandeur sont retirées.
     */
    public static function departementRevoquerAcces(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['chef']);
        if (!$meta['enLigne']) {
            throw Erreurs::reseau();
        }
        $a = Db::un('SELECT * FROM autorisations_enseignant WHERE id = ?', [$p['autorisationId']]);
        if ($a === null) {
            throw Erreurs::introuvable();
        }
        $teacher = Db::un('SELECT * FROM teachers WHERE id = ?', [$a['teacher_id']]);
        $monDep = Garde::departementDuChef($ctx);
        if ($monDep === null || $monDep !== ($teacher['departement_id'] ?? null)) {
            throw Erreurs::perimetre();
        }
        if ($a['statut'] !== 'accordee') {
            throw Erreurs::invalide('Seule une autorisation accordée peut être révoquée.');
        }

        Db::modifier('autorisations_enseignant', [
            'statut'     => 'revoquee',
            'decide_par' => $ctx->userId,
            'decide_at'  => $meta['recuA'],
        ], ['id' => $a['id']]);

        // Retrait des affectations de cet enseignant dans le département demandeur.
        Db::run(
            'DELETE af FROM affectations af
               JOIN matieres m ON m.id = af.matiere_id
               JOIN classes c  ON c.id = m.classe_id
               JOIN filieres f ON f.id = c.filiere_id
              WHERE af.teacher_id = ? AND f.departement_id = ?',
            [$a['teacher_id'], $a['departement_id']]
        );

        Historique::ajouter([
            'entity'      => 'autorisation',
            'entityId'    => $a['id'],
            'action'      => 'acces_revoque',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'after'       => $teacher['prenom'] . ' ' . $teacher['nom'],
        ]);

        return ['id' => $a['id'], 'statut' => 'revoquee'];
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
     *  Paiement d'une fiche de paie (§7)
     * ================================================================= */

    /**
     * L'administration paie une fiche en attente : le montant (taux × heures)
     * est recalculé depuis les séances de la fiche puis FIGÉ, et la fiche passe
     * à « payée ». Les séances étaient déjà réservées à la création ; elles sont
     * désormais soldées (elles ne reviendront dans aucune autre fiche).
     *
     * Le paiement est refusé tant qu'une séance n'a pas de taux (§7) : il faut
     * d'abord régler les taux manquants.
     */
    public static function payerFiche(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['administration']);
        if (!$meta['enLigne']) {
            throw Erreurs::reseau();
        }

        $fiche = Db::un('SELECT * FROM fiches_heures WHERE id = ?', [$p['ficheId']]);
        if ($fiche === null) {
            throw Erreurs::introuvable();
        }
        if ($fiche['statut'] === 'payee') {
            throw Erreurs::conflit('Cette fiche est déjà payée.');
        }
        if ($fiche['statut'] !== 'en_attente') {
            throw Erreurs::invalide('Cette fiche ne peut pas être payée.');
        }

        // Recalcul (avec montant) sur les séances de la fiche.
        $calc = Rapports::fichePaie($fiche['teacher_id'], null, null, true, $p['ficheId']);
        if ((int) $calc['totalSeances'] === 0) {
            throw Erreurs::invalide('Cette fiche ne porte plus aucune séance.');
        }
        if ($calc['montantIncomplet']) {
            throw Erreurs::invalide(
                "Certaines séances n'ont pas de taux horaire. Définissez les taux manquants avant de payer."
            );
        }

        $parNiveau = array_map(fn($n) => [
            'niveau'  => (int) $n['niveau'],
            'heures'  => round((float) $n['heures'], 2),
            'seances' => (int) $n['seances'],
            'montant' => (int) $n['montant'],
        ], $calc['parNiveau']);
        $parMatiere = array_map(fn($m) => [
            'niveau'    => (int) $m['niveau'],
            'matiere'   => $m['matiere'],
            'matiereEn' => $m['matiereEn'] ?? null,
            'heures'    => round((float) $m['heures'], 2),
            'seances'   => (int) $m['seances'],
            'montant'   => (int) $m['montant'],
        ], $calc['parMatiere']);

        // Impôt (§7) : taux saisi par l'administration, retenu sur le brut.
        $brut = (int) $calc['montant'];
        $tauxImpot = max(0.0, min(100.0, (float) ($p['tauxImpot'] ?? 0)));
        $impot = (int) round($brut * $tauxImpot / 100);
        $net = $brut - $impot;

        Db::modifier('fiches_heures', [
            'statut'        => 'payee',
            'montant'       => $brut,
            'taux_impot'    => $tauxImpot,
            'impot'         => $impot,
            'net'           => $net,
            'total_heures'  => round((float) $calc['totalHeures'], 2),
            'par_niveau'    => json_encode($parNiveau, JSON_UNESCAPED_UNICODE),
            'par_matiere'   => json_encode($parMatiere, JSON_UNESCAPED_UNICODE),
            'paid_at'       => $meta['recuA'],
            'paid_by'       => $ctx->userId,
            'paid_by_label' => $ctx->label,
        ], ['id' => $p['ficheId']]);

        Historique::ajouter([
            'entity'      => 'fiche',
            'entityId'    => $p['ficheId'],
            'action'      => 'fiche_payee',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'note'        => $fiche['periode'],
        ]);

        // L'enseignant est prévenu (sans montant dans le pop-up, §13.10).
        Operations::avisEnseignant(
            $fiche['teacher_id'],
            'fiche',
            'Une fiche de paie a été réglée',
            'Une période a été payée. Retrouvez le détail dans « Historique de paiement ».',
            $meta['recuA']
        );

        return ['id' => $p['ficheId'], 'montant' => $brut, 'impot' => $impot, 'net' => $net];
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

        $id = Outils::uuid();
        // §13.4 : un taux n'est jamais modifié, on en crée un nouveau. Système
        // simple : un taux par niveau, pour tous (scope « niveau »).
        Db::inserer('rates', [
            'id'         => $id,
            'scope'      => 'niveau',
            'teacher_id' => null,
            'matiere_id' => null,
            'niveau'     => (int) $p['niveau'],
            'montant'    => (int) $p['montant'],
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
