<?php
declare(strict_types=1);

/**
 * Les opérations d'écriture. Une seule porte, et elle est gardée.
 *
 * Chaque méthode reçoit :
 *   $ctx     contexte résolu par Garde (compte et rôles relus en base)
 *   $p       contenu DÉJÀ validé contre la forme du §13.1/§13.6
 *   $meta    ['opId','clientAt','recuA','enLigne']
 *
 * `clientAt` est l'heure déclarée par l'appareil : elle n'est jamais crue sans
 * contrôle (§13.5 « Heure locale antidatée »). `recuA` est l'heure du serveur,
 * et c'est elle qui tranche.
 */
final class Operations
{
    /** Écart d'horloge toléré avant signalement (§13.4). */
    private const ECART_HORLOGE = 300;

    /* ================================================================= *
     *  Outils internes
     * ================================================================= */

    /**
     * Retient une heure déclarée par un appareil de confiance (poste du
     * secrétariat) après contrôle. Hors des bornes, l'heure du serveur
     * s'applique — on ne laisse pas une horloge trafiquée allonger des heures.
     */
    private static function instantDeConfiance(?string $clientAt, string $recuA, int $maxPasse = 604800): array
    {
        $declare = Outils::versMysql($clientAt);
        if ($declare === null) {
            return ['at' => $recuA, 'ecart' => 0];
        }

        $ecart = Outils::ecart($declare, $recuA);

        // Heure dans le futur, ou trop ancienne : on prend celle du serveur.
        if ($ecart < -self::ECART_HORLOGE || $ecart > $maxPasse) {
            return ['at' => $recuA, 'ecart' => abs($ecart)];
        }

        return ['at' => $declare, 'ecart' => abs($ecart)];
    }

    /**
     * Recalcule l'état d'une séance et l'écrit.
     * §13.3 : jamais écrit par un client.
     */
    private static function rafraichirEtat(array $seance): array
    {
        $etat = Regles::etat($seance);
        Db::modifier('sessions', ['status' => $etat], ['id' => $seance['id']]);
        $seance['status'] = $etat;
        return $seance;
    }

    /** Identifiants des étudiants actifs d'une classe. */
    private static function elevesDeLaClasse(string $classeId): array
    {
        return array_column(
            Db::tout('SELECT id FROM students WHERE classe_id = ? AND actif = 1', [$classeId]),
            'id'
        );
    }

    /**
     * Section demandée pour une séance (§4).
     *
     * On n'autorise « anglophone » que si la filière de la classe propose bien
     * cette section ; sinon tout retombe sur « francophone », le cas normal.
     */
    private static function sectionDemandee(array $p, array $classe): string
    {
        $demandee = ($p['section'] ?? 'francophone') === 'anglophone' ? 'anglophone' : 'francophone';
        if ($demandee !== 'anglophone') {
            return 'francophone';
        }
        $filiere = Db::un('SELECT section_anglophone FROM filieres WHERE id = ?', [$classe['filiere_id']]);
        if ($filiere === null || (int) ($filiere['section_anglophone'] ?? 0) !== 1) {
            throw Erreurs::invalide("Cette filière n'a pas de section anglophone.");
        }
        return 'anglophone';
    }

    /* ================================================================= *
     *  Secrétariat (§4)
     * ================================================================= */

    /**
     * Pointage d'arrivée par la secrétaire.
     *
     * L'heure retenue est celle du poste du secrétariat, qui fait foi (§4),
     * après contrôle de plausibilité.
     */
    public static function secretariatArrivee(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['secretaire']);

        $enseignant = Db::un('SELECT * FROM teachers WHERE id = ? AND actif = 1', [$p['teacherId']]);
        if ($enseignant === null) {
            throw Erreurs::introuvable();
        }

        // §13.3 « Pointage de soi-même » : impossible par construction, le
        // cumul secrétaire + enseignant est refusé à la création du compte.
        // Deuxième barrière :
        if ($ctx->teacherId !== null && $ctx->teacherId === $enseignant['id']) {
            throw Erreurs::droits();
        }

        $matiere = Db::un('SELECT * FROM matieres WHERE id = ?', [$p['matiereId']]);
        if ($matiere === null) {
            throw Erreurs::introuvable();
        }
        $classe = Db::un('SELECT * FROM classes WHERE id = ?', [$matiere['classe_id']]);
        if ($classe === null) {
            throw Erreurs::introuvable();
        }

        // §4 : la matière doit relever du DÉPARTEMENT de l'enseignant (le
        // secrétariat cherche parmi les matières du département), ou lui être
        // affectée (affectation du chef, éventuellement inter-départements).
        $filiere = Db::un('SELECT departement_id FROM filieres WHERE id = ?', [$classe['filiere_id']]);
        $memeDep = $filiere !== null
            && !empty($filiere['departement_id'])
            && $filiere['departement_id'] === ($enseignant['departement_id'] ?? null);
        if (!$memeDep) {
            $affecte = Db::compte(
                'SELECT COUNT(*) FROM affectations WHERE teacher_id = ? AND matiere_id = ?',
                [$enseignant['id'], $p['matiereId']]
            );
            if ($affecte === 0) {
                throw Erreurs::invalide("Cette matière n'est pas du département de l'enseignant.");
            }
        }

        // §4 : une seule séance ouverte à la fois.
        $ouverte = Db::compte(
            'SELECT COUNT(*) FROM sessions WHERE teacher_id = ? AND departure_at IS NULL',
            [$enseignant['id']]
        );
        if ($ouverte > 0) {
            throw Erreurs::conflit(
                'Cet enseignant a déjà une séance en cours. Pointez son départ avant une nouvelle arrivée.'
            );
        }

        $instant = self::instantDeConfiance($meta['clientAt'], $meta['recuA'], 86400);
        $probleme = Regles::heuresPlausibles($instant['at'], null);
        if ($probleme !== null) {
            throw Erreurs::invalide($probleme);
        }

        // Fin prévue : l'heure HH:MM est rattachée au jour de l'arrivée. Si
        // elle tombe avant ou à l'arrivée, c'est qu'elle vise le lendemain
        // (cours de fin de soirée) — on ajoute un jour.
        $finPrevue = Outils::jour($instant['at']) . ' ' . $p['finPrevue'] . ':00';
        if (strtotime($finPrevue) <= strtotime($instant['at'])) {
            $finPrevue = gmdate('Y-m-d H:i:s', strtotime($finPrevue) + 86400);
        }

        // §4 : section visée (francophone par défaut, anglophone si la filière
        // en propose une). Fixe les étudiants concernés et la langue affichée.
        $section = self::sectionDemandee($p, $classe);
        $nomMatiere = Rapports::nomMatiere($matiere, $section);

        $id = Outils::uuid();
        Db::inserer('sessions', [
            'id'                  => $id,
            'teacher_id'          => $enseignant['id'],
            'matiere_id'          => $matiere['id'],
            'classe_id'           => $classe['id'],
            'section'             => $section,
            // Niveau choisi par le secrétariat (pré-rempli depuis la classe).
            'niveau'              => (int) $p['niveau'],
            'day'                 => Outils::jour($instant['at']),
            'arrival_at'          => $instant['at'],
            'arrival_received_at' => $meta['recuA'],
            'arrival_by'          => $ctx->userId,
            'arrival_via'         => 'secretariat',
            'planned_end_at'      => $finPrevue,
            // §13.4 : aléa cryptographique pour le code et le jeton.
            'code'                => Outils::code(6),
            'scan_token'          => QrCodes::nouveauJetonScan(),
            'notifiee'            => 0,
            'status'              => Regles::EN_COURS,
            'created_at'          => $meta['recuA'],
        ]);

        if ($instant['ecart'] > self::ECART_HORLOGE) {
            Historique::anomalie([
                'kind'      => 'ecart_horloge',
                'titre'     => "Écart d'horloge au pointage",
                'detail'    => 'Le poste du secrétariat déclarait une heure décalée de '
                    . round($instant['ecart'] / 60) . ' min.',
                'sessionId' => $id,
                'severity'  => 'attention',
            ]);
        }

        // §4 : notification aux étudiants. Elle demande du réseau (§9).
        $notifiee = false;
        if ($meta['enLigne']) {
            Db::inserer('notifications', [
                'id'         => Outils::uuid(),
                'classe_id'  => $classe['id'],
                'session_id' => $id,
                'at'         => $meta['recuA'],
                // §13.9 « Contenu sensible » : matière et nom de l'enseignant.
                'titre'      => mb_substr('Le cours de ' . $nomMatiere . ' va commencer', 0, 160),
                'corps'      => mb_substr($enseignant['prenom'] . ' ' . $enseignant['nom'] . ' est en route.', 0, 240),
            ]);
            Db::modifier('sessions', ['notifiee' => 1], ['id' => $id]);
            $notifiee = true;
        }

        $code = Db::un('SELECT code FROM sessions WHERE id = ?', [$id])['code'];

        Historique::ajouter([
            'entity'      => 'seance',
            'entityId'    => $id,
            'action'      => 'arrivee_pointee',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'field'       => 'arrivalAt',
            'after'       => $instant['at'],
            'note'        => $enseignant['prenom'] . ' ' . $enseignant['nom'] . ' — ' . $nomMatiere,
        ]);

        return ['sessionId' => $id, 'code' => $code, 'notifiee' => $notifiee, 'section' => $section];
    }

    /** Pointage de départ par la secrétaire. */
    public static function secretariatDepart(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['secretaire']);

        $seance = Db::un('SELECT * FROM sessions WHERE id = ?', [$p['sessionId']]);
        if ($seance === null) {
            throw Erreurs::introuvable();
        }
        if (!empty($seance['departure_at'])) {
            throw Erreurs::conflit('Le départ est déjà enregistré.');
        }

        $instant = self::instantDeConfiance($meta['clientAt'], $meta['recuA'], 86400);
        $probleme = Regles::heuresPlausibles($seance['arrival_at'], $instant['at']);
        if ($probleme !== null) {
            throw Erreurs::invalide($probleme);
        }

        Db::modifier('sessions', [
            'departure_at'          => $instant['at'],
            'departure_received_at' => $meta['recuA'],
            'departure_by'          => $ctx->userId,
            'departure_via'         => 'secretariat',
        ], ['id' => $seance['id']]);

        $seance = Db::un('SELECT * FROM sessions WHERE id = ?', [$seance['id']]);
        $seance = self::rafraichirEtat($seance);

        Historique::ajouter([
            'entity'      => 'seance',
            'entityId'    => $seance['id'],
            'action'      => 'depart_pointe',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'field'       => 'departureAt',
            'after'       => $instant['at'],
        ]);

        return ['status' => $seance['status']];
    }

    /**
     * Départ saisi après coup, avec motif obligatoire (§4).
     *
     * §13.4 « Départ saisi après coup de façon abusive » : motif, historique,
     * anomalie signalée à l'administration, et délai maximal.
     */
    public static function secretariatDepartManuel(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['secretaire']);
        $parametres = Parametres::lire();

        $seance = Db::un('SELECT * FROM sessions WHERE id = ?', [$p['sessionId']]);
        if ($seance === null) {
            throw Erreurs::introuvable();
        }
        if (!empty($seance['departure_at'])) {
            throw Erreurs::conflit('Le départ est déjà enregistré.');
        }

        $jours = (int) $parametres['delaiReleveJours'];
        if (Outils::ecart($seance['arrival_at'], $meta['recuA']) > $jours * 86400) {
            throw Erreurs::invalide(
                "Cette séance a plus de $jours jours : seule l'administration peut la corriger."
            );
        }

        // L'heure saisie est rattachée au jour de la séance.
        $depart = Outils::jour($seance['arrival_at']) . ' ' . $p['heure'] . ':00';
        $probleme = Regles::heuresPlausibles($seance['arrival_at'], $depart);
        if ($probleme !== null) {
            throw Erreurs::invalide($probleme);
        }

        Db::modifier('sessions', [
            'departure_at'          => $depart,
            'departure_received_at' => $meta['recuA'],
            'departure_by'          => $ctx->userId,
            'departure_via'         => 'saisie_manuelle',
            'departure_motif'       => $p['motif'],
            'departure_manual_by'   => $ctx->userId,
            'departure_manual_at'   => $meta['recuA'],
        ], ['id' => $seance['id']]);

        $seance = Db::un('SELECT * FROM sessions WHERE id = ?', [$seance['id']]);
        $seance = self::rafraichirEtat($seance);

        Historique::ajouter([
            'entity'      => 'seance',
            'entityId'    => $seance['id'],
            'action'      => 'depart_saisi_apres_coup',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'field'       => 'departureAt',
            'after'       => $depart,
            'note'        => $p['motif'],
            'flagged'     => true,
        ]);

        $enseignant = Db::un('SELECT nom, prenom FROM teachers WHERE id = ?', [$seance['teacher_id']]);
        Historique::anomalie([
            'kind'      => 'depart_manuel',
            'titre'     => 'Départ saisi après coup',
            'detail'    => ($enseignant ? $enseignant['prenom'] . ' ' . $enseignant['nom'] : 'Enseignant')
                . ' — motif : ' . $p['motif'],
            'sessionId' => $seance['id'],
            'subjectId' => $seance['teacher_id'],
            'severity'  => 'attention',
        ]);

        return ['status' => $seance['status']];
    }

    /* ================================================================= *
     *  Pointage par scan, côté enseignant (§4)
     * ================================================================= */

    /**
     * L'enseignant scanne le code affiché par la secrétaire.
     *
     * Cette opération EXIGE le réseau. C'est une décision de sécurité : la
     * fenêtre de 60 secondes du §4 ne peut être vérifiée que contre l'heure du
     * serveur. Un scan accepté hors ligne puis contrôlé à la synchronisation
     * laisserait passer une photo prise le matin et rejouée le soir — la
     * faille §13.4 « Photo du code QR de pointage ». Quand le téléphone de
     * l'enseignant n'a pas de réseau, le §4 prévoit déjà la solution : la
     * secrétaire pointe elle-même.
     */
    public static function pointageScan(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['enseignant']);
        if (!$meta['enLigne']) {
            throw Erreurs::reseau();
        }
        if ($ctx->teacherId === null) {
            throw Erreurs::droits();
        }

        Limites::exigerAutorise('scan', $ctx->userId);

        $lu = QrCodes::lirePointage($p['qr']);
        if ($lu === null) {
            Limites::echec('scan', $ctx->userId, ['raison' => 'format']);
            throw Erreurs::invalide("Ce code n'est pas un code de pointage.");
        }

        $station = Db::un('SELECT * FROM stations WHERE id = ?', [$lu['stationId']]);
        if ($station === null) {
            Limites::echec('scan', $ctx->userId, ['raison' => 'station']);
            throw Erreurs::invalide('Code de pointage inconnu.');
        }

        $controle = QrCodes::verifierPointage($p['qr'], $station['secret'], time());
        if (!$controle['ok']) {
            Limites::echec('scan', $ctx->userId, ['raison' => $controle['raison']]);

            if ($controle['raison'] === 'expire') {
                throw Erreurs::invalide(
                    'Ce code a expiré. Demandez à la secrétaire de rafraîchir son écran.'
                );
            }

            Historique::anomalie([
                'kind'      => 'qr_invalide',
                'titre'     => 'Code QR de pointage refusé',
                'detail'    => 'Signature ou format invalide (' . $controle['raison'] . ').',
                'subjectId' => $ctx->teacherId,
                'severity'  => 'grave',
            ]);
            throw Erreurs::invalide('Code de pointage invalide.');
        }

        // §13.4 « Rejeu d'un pointage » : un nonce ne sert qu'une fois.
        // La clef primaire (station, nonce) rend le rejeu impossible même en
        // cas de requêtes simultanées.
        try {
            Db::inserer('used_tokens', [
                'station_id' => $lu['stationId'],
                'nonce'      => $lu['nonce'],
                'at'         => $meta['recuA'],
                'user_id'    => $ctx->userId,
            ]);
        } catch (PDOException $e) {
            throw Erreurs::conflit('Ce code a déjà été utilisé.');
        }

        // L'heure retenue est celle du créneau du code, donc celle du poste de
        // la secrétaire — jamais celle du téléphone de l'enseignant (§4).
        $heurePoste = gmdate('Y-m-d H:i:s', $lu['creneau'] * QrCodes::DUREE_CRENEAU);

        $ouverte = Db::un(
            'SELECT * FROM sessions WHERE teacher_id = ? AND departure_at IS NULL LIMIT 1',
            [$ctx->teacherId]
        );

        if ($ouverte !== null) {
            $probleme = Regles::heuresPlausibles($ouverte['arrival_at'], $heurePoste);
            if ($probleme !== null) {
                throw Erreurs::invalide($probleme);
            }

            Db::modifier('sessions', [
                'departure_at'          => $heurePoste,
                'departure_received_at' => $meta['recuA'],
                'departure_by'          => $ctx->userId,
                'departure_via'         => 'scan',
            ], ['id' => $ouverte['id']]);

            $ouverte = self::rafraichirEtat(Db::un('SELECT * FROM sessions WHERE id = ?', [$ouverte['id']]));

            Historique::ajouter([
                'entity'      => 'seance',
                'entityId'    => $ouverte['id'],
                'action'      => 'depart_scanne',
                'authorId'    => $ctx->userId,
                'authorLabel' => $ctx->label,
                'field'       => 'departureAt',
                'after'       => $heurePoste,
            ]);

            Limites::reussite('scan', $ctx->userId);
            return ['sens' => 'depart', 'sessionId' => $ouverte['id'], 'status' => $ouverte['status']];
        }

        if (empty($p['matiereId'])) {
            throw Erreurs::invalide('Choisissez la matière que vous venez enseigner.');
        }
        Garde::exigerAffectation($ctx, $p['matiereId']);

        $matiere = Db::un('SELECT * FROM matieres WHERE id = ?', [$p['matiereId']]);
        $classe  = Db::un('SELECT * FROM classes WHERE id = ?', [$matiere['classe_id']]);

        // Fin prévue facultative au scan : l'enseignant ne la saisit pas
        // forcément. Si absente, pas de plafond (paiement au temps réel).
        $finPrevue = null;
        if (!empty($p['finPrevue'])) {
            $finPrevue = Outils::jour($heurePoste) . ' ' . $p['finPrevue'] . ':00';
            if (strtotime($finPrevue) <= strtotime($heurePoste)) {
                $finPrevue = gmdate('Y-m-d H:i:s', strtotime($finPrevue) + 86400);
            }
        }

        $section = self::sectionDemandee($p, $classe);
        $nomMatiere = Rapports::nomMatiere($matiere, $section);

        $id = Outils::uuid();
        Db::inserer('sessions', [
            'id'                  => $id,
            'teacher_id'          => $ctx->teacherId,
            'matiere_id'          => $matiere['id'],
            'classe_id'           => $classe['id'],
            'section'             => $section,
            'niveau'              => (int) $classe['niveau'],
            'day'                 => Outils::jour($heurePoste),
            'arrival_at'          => $heurePoste,
            'arrival_received_at' => $meta['recuA'],
            'arrival_by'          => $station['secretary_user_id'],
            'arrival_via'         => 'scan',
            'planned_end_at'      => $finPrevue,
            'code'                => Outils::code(6),
            'scan_token'          => QrCodes::nouveauJetonScan(),
            'notifiee'            => 1,
            'status'              => Regles::EN_COURS,
            'created_at'          => $meta['recuA'],
        ]);

        Db::inserer('notifications', [
            'id'         => Outils::uuid(),
            'classe_id'  => $classe['id'],
            'session_id' => $id,
            'at'         => $meta['recuA'],
            'titre'      => mb_substr('Le cours de ' . $nomMatiere . ' va commencer', 0, 160),
            'corps'      => mb_substr($ctx->label . ' est en route.', 0, 240),
        ]);

        Historique::ajouter([
            'entity'      => 'seance',
            'entityId'    => $id,
            'action'      => 'arrivee_scannee',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'field'       => 'arrivalAt',
            'after'       => $heurePoste,
            'note'        => $nomMatiere,
        ]);

        Limites::reussite('scan', $ctx->userId);

        // Le code de séance s'affiche dans l'application de l'enseignant (§4).
        $code = Db::un('SELECT code FROM sessions WHERE id = ?', [$id])['code'];
        return ['sens' => 'arrivee', 'sessionId' => $id, 'code' => $code];
    }

    /**
     * Change la matière d'une séance encore en cours (secrétaire).
     *
     * Permis tant que le relevé n'est pas validé : après validation, les
     * présences sont attachées à la matière, on n'y touche plus (§4). La
     * nouvelle matière doit être affectée au même enseignant et appartenir à
     * la même classe — on ne déplace pas une séance vers une autre classe.
     */
    public static function changerMatiere(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['secretaire']);
        return self::appliquerChangementMatiere($ctx, $p, $meta);
    }

    /**
     * Cœur partagé du changement de matière, appelé par la secrétaire et par
     * l'enseignant (OperationsReleve::changerMatiere).
     */
    public static function appliquerChangementMatiere(Contexte $ctx, array $p, array $meta): array
    {
        $seance = Db::un('SELECT * FROM sessions WHERE id = ?', [$p['sessionId']]);
        if ($seance === null) {
            throw Erreurs::introuvable();
        }
        if ((int) $seance['roll_code_ok'] === 1) {
            throw Erreurs::conflit(
                'Le relevé est déjà validé : la matière ne peut plus être changée.'
            );
        }

        // La nouvelle matière doit exister, être de la même classe, et être
        // affectée à l'enseignant de la séance.
        $matiere = Db::un('SELECT * FROM matieres WHERE id = ?', [$p['matiereId']]);
        if ($matiere === null) {
            throw Erreurs::introuvable();
        }
        if ($matiere['classe_id'] !== $seance['classe_id']) {
            throw Erreurs::invalide(
                "Cette matière n'est pas de la classe de la séance."
            );
        }
        $affecte = Db::compte(
            'SELECT COUNT(*) FROM affectations WHERE teacher_id = ? AND matiere_id = ?',
            [$seance['teacher_id'], $p['matiereId']]
        );
        if ($affecte === 0) {
            throw Erreurs::invalide("Cette matière n'est pas affectée à cet enseignant.");
        }

        if ($matiere['id'] === $seance['matiere_id']) {
            return ['sessionId' => $seance['id'], 'matiereId' => $matiere['id']];
        }

        Db::modifier('sessions', ['matiere_id' => $matiere['id']], ['id' => $seance['id']]);

        Historique::ajouter([
            'entity'      => 'seance',
            'entityId'    => $seance['id'],
            'action'      => 'matiere_changee',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'field'       => 'matiereId',
            'before'      => $seance['matiere_id'],
            'after'       => $matiere['id'],
            'note'        => $matiere['nom'],
        ]);

        return ['sessionId' => $seance['id'], 'matiereId' => $matiere['id']];
    }

    /**
     * Dépose un avis destiné à un enseignant (pop-up à l'ouverture de son
     * espace). Aucun montant (§13.10).
     */
    public static function avisEnseignant(
        string $teacherId,
        string $type,
        string $titre,
        string $corps,
        string $at
    ): void {
        Db::inserer('avis_enseignant', [
            'id'         => Outils::uuid(),
            'teacher_id' => $teacherId,
            'type'       => $type,
            'titre'      => mb_substr($titre, 0, 160),
            'corps'      => mb_substr($corps, 0, 300),
            'at'         => $at,
        ]);
    }

    /**
     * Transmet à un enseignant un instantané figé de ses heures par niveau.
     *
     * Les heures sont calculées et COPIÉES maintenant : la fiche ne bougera
     * plus (§7). L'enseignant la voit dans son espace et peut l'imprimer.
     * Aucun montant n'est enregistré ni renvoyé (§13.10).
     */
    public static function creerFiche(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['secretaire']);

        $teacher = Db::un('SELECT * FROM teachers WHERE id = ?', [$p['teacherId']]);
        if ($teacher === null) {
            throw Erreurs::introuvable();
        }

        $debut = substr($p['debut'], 0, 10);
        $fin   = substr($p['fin'], 0, 10);
        if ($debut > $fin) {
            throw Erreurs::invalide('La date de début doit précéder la date de fin.');
        }

        // Heures de la période (séances terminées non encore portées par une
        // fiche). Pas de montant ici : la secrétaire ne voit pas l'argent (§13.10).
        $fiche = Rapports::fichePaie($p['teacherId'], $debut, $fin, false);
        if ((int) $fiche['totalSeances'] === 0) {
            throw Erreurs::invalide(
                "Aucune heure payable sur cette période : aucune séance terminée, "
                . "ou toutes sont déjà sur une autre fiche."
            );
        }

        $parNiveau = array_map(fn($n) => [
            'niveau'  => (int) $n['niveau'],
            'heures'  => round((float) $n['heures'], 2),
            'seances' => (int) $n['seances'],
            'montant' => null,
        ], $fiche['parNiveau']);
        $parMatiere = array_map(fn($m) => [
            'niveau'    => (int) $m['niveau'],
            'matiere'   => $m['matiere'],
            'matiereEn' => $m['matiereEn'] ?? null,
            'heures'    => round((float) $m['heures'], 2),
            'seances'   => (int) $m['seances'],
            'montant'   => null,
        ], $fiche['parMatiere']);

        $reglages = Parametres::lire();

        $id = Outils::uuid();
        Db::inserer('fiches_heures', [
            'id'            => $id,
            'teacher_id'    => $p['teacherId'],
            'periode'       => $fiche['periode'],
            'debut'         => $debut,
            'fin'           => $fin,
            'statut'        => 'en_attente',
            'total_heures'  => round((float) $fiche['totalHeures'], 2),
            'montant'       => null,
            'par_niveau'    => json_encode($parNiveau, JSON_UNESCAPED_UNICODE),
            'par_matiere'   => json_encode($parMatiere, JSON_UNESCAPED_UNICODE),
            'etablissement' => (string) ($reglages['etablissement'] ?? ''),
            'sent_by'       => $ctx->userId,
            'sent_by_label' => $ctx->label,
            'sent_at'       => $meta['recuA'],
        ]);

        // Réservation : chaque séance de la période est rattachée à cette fiche.
        foreach ($fiche['seanceIds'] as $sid) {
            Db::modifier('sessions', ['fiche_id' => $id], ['id' => $sid]);
        }

        Historique::ajouter([
            'entity'      => 'fiche',
            'entityId'    => $id,
            'action'      => 'fiche_creee',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'note'        => $teacher['prenom'] . ' ' . $teacher['nom'] . ' — ' . $fiche['periode'],
        ]);

        return ['id' => $id, 'teacherId' => $p['teacherId']];
    }

    /**
     * Annule une fiche encore EN ATTENTE : ses séances redeviennent
     * disponibles. Une fiche déjà payée ne peut pas être annulée ici.
     */
    public static function annulerFiche(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['secretaire']);

        $fiche = Db::un('SELECT * FROM fiches_heures WHERE id = ?', [$p['ficheId']]);
        if ($fiche === null) {
            throw Erreurs::introuvable();
        }
        if ($fiche['statut'] !== 'en_attente') {
            throw Erreurs::invalide('Seule une fiche en attente peut être annulée.');
        }

        // Libère les séances réservées, puis supprime la fiche.
        Db::run('UPDATE sessions SET fiche_id = NULL WHERE fiche_id = ?', [$p['ficheId']]);
        Db::supprimer('fiches_heures', ['id' => $p['ficheId']]);

        Historique::ajouter([
            'entity'      => 'fiche',
            'entityId'    => $p['ficheId'],
            'action'      => 'fiche_annulee',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'note'        => $fiche['periode'],
        ]);

        return ['ok' => true];
    }

    /**
     * Crée une séance pour un JOUR PASSÉ (coupure de courant, secrétaire
     * absente…). Ne compte que les heures de l'enseignant : aucune présence
     * d'étudiant n'est générée (saisie_anterieure = 1).
     *
     * §13.5 « Heure locale antidatée » : l'antidatage est réservé au
     * secrétariat, borné à 30 jours, refusé dans le futur, tracé dans
     * l'historique avec un motif facultatif.
     */
    public static function seanceAnterieure(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['secretaire']);

        $teacher = Db::un('SELECT * FROM teachers WHERE id = ?', [$p['teacherId']]);
        if ($teacher === null) {
            throw Erreurs::introuvable();
        }

        $matiere = Db::un('SELECT * FROM matieres WHERE id = ?', [$p['matiereId']]);
        if ($matiere === null) {
            throw Erreurs::introuvable();
        }
        $classe = Db::un('SELECT * FROM classes WHERE id = ?', [$matiere['classe_id']]);
        if ($classe === null) {
            throw Erreurs::introuvable();
        }

        // La matière doit relever du DÉPARTEMENT de l'enseignant, ou lui être
        // affectée (même règle qu'au pointage d'arrivée, §4).
        $filiere = Db::un('SELECT departement_id FROM filieres WHERE id = ?', [$classe['filiere_id']]);
        $memeDep = $filiere !== null
            && !empty($filiere['departement_id'])
            && $filiere['departement_id'] === ($teacher['departement_id'] ?? null);
        if (!$memeDep) {
            $affecte = Db::compte(
                'SELECT COUNT(*) FROM affectations WHERE teacher_id = ? AND matiere_id = ?',
                [$p['teacherId'], $p['matiereId']]
            );
            if ($affecte === 0) {
                throw Erreurs::invalide("Cette matière n'est pas du département de l'enseignant.");
            }
        }

        $arrivee = $p['jour'] . ' ' . $p['heureArrivee'] . ':00';
        $depart  = $p['jour'] . ' ' . $p['heureDepart'] . ':00';
        $tArr = strtotime($arrivee . ' UTC');
        if ($tArr === false) {
            throw Erreurs::invalide('Date ou heure invalide.');
        }

        $maintenant = time();
        if ($tArr > $maintenant) {
            throw Erreurs::invalide("Une séance antérieure ne peut pas être dans le futur.");
        }
        if ($tArr < $maintenant - 30 * 86400) {
            throw Erreurs::invalide('Au-delà de 30 jours, une séance ne peut plus être saisie.');
        }

        $probleme = Regles::heuresPlausibles($arrivee, $depart);
        if ($probleme !== null) {
            throw Erreurs::invalide($probleme);
        }

        $section = self::sectionDemandee($p, $classe);
        $nomMatiere = Rapports::nomMatiere($matiere, $section);

        $id = Outils::uuid();
        Db::inserer('sessions', [
            'id'                  => $id,
            'teacher_id'          => $teacher['id'],
            'matiere_id'          => $matiere['id'],
            'classe_id'           => $classe['id'],
            'section'             => $section,
            'niveau'              => (int) $p['niveau'],
            'day'                 => Outils::jour($arrivee),
            'arrival_at'          => $arrivee,
            'arrival_received_at' => $meta['recuA'],
            'arrival_by'          => $ctx->userId,
            'arrival_via'         => 'secretariat',
            // Fin prévue nulle : les heures payées sont le temps réel saisi.
            'planned_end_at'      => null,
            'departure_at'          => $depart,
            'departure_received_at' => $meta['recuA'],
            'departure_by'          => $ctx->userId,
            'departure_via'         => 'saisie_manuelle',
            // La séance est complète et compte les heures : relevé « validé »
            // d'office, car il n'y aura pas de code à échanger a posteriori.
            'roll_validated_at'   => $meta['recuA'],
            'roll_received_at'    => $meta['recuA'],
            'roll_code_ok'        => 1,
            'roll_by'             => $ctx->userId,
            'saisie_anterieure'   => 1,
            'saisie_motif'        => $p['motif'] ?? null,
            'code'                => Outils::code(6),
            'scan_token'          => QrCodes::nouveauJetonScan(),
            'notifiee'            => 1,
            'status'              => Regles::TERMINEE,
            'created_at'          => $meta['recuA'],
        ]);

        Historique::ajouter([
            'entity'      => 'seance',
            'entityId'    => $id,
            'action'      => 'seance_anterieure_creee',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'note'        => $teacher['prenom'] . ' ' . $teacher['nom'] . ' — ' . $p['jour']
                . ($p['motif'] ? ' — ' . $p['motif'] : ''),
        ]);

        $heures = round(Outils::ecart($arrivee, $depart) / 3600, 1);
        self::avisEnseignant(
            $teacher['id'],
            'heures_ajoutees',
            'Des heures ont été ajoutées',
            'Le ' . $p['jour'] . ' : ' . $nomMatiere . ' — ' . $heures
                . ' h, ajoutées par le secrétariat.',
            $meta['recuA']
        );

        return ['id' => $id, 'teacherId' => $teacher['id']];
    }

    /**
     * Le secrétariat pointe les heures d'un appel déclaré par un enseignant.
     *
     * Il attribue une arrivée et un départ au jour de l'appel : la séance est
     * alors créée, avec les présences déjà cochées par l'enseignant, et compte
     * les heures. Elle reste marquée « déclarée par l'enseignant » (§4).
     */
    public static function pointerDeclare(Contexte $ctx, array $p, array $meta): array
    {
        Garde::exigerRole($ctx, ['secretaire']);

        $decl = Db::un('SELECT * FROM releves_declares WHERE id = ?', [$p['declareId']]);
        if ($decl === null) {
            throw Erreurs::introuvable();
        }
        if ($decl['session_id'] !== null) {
            throw Erreurs::conflit('Cet appel a déjà été pointé.');
        }

        $teacher = Db::un('SELECT * FROM teachers WHERE id = ?', [$decl['teacher_id']]);
        $matiere = Db::un('SELECT * FROM matieres WHERE id = ?', [$decl['matiere_id']]);
        if ($teacher === null || $matiere === null) {
            throw Erreurs::introuvable();
        }

        $arrivee = $decl['day'] . ' ' . $p['heureArrivee'] . ':00';
        $depart  = $decl['day'] . ' ' . $p['heureDepart'] . ':00';
        $probleme = Regles::heuresPlausibles($arrivee, $depart);
        if ($probleme !== null) {
            throw Erreurs::invalide($probleme);
        }

        $section  = $decl['section'] ?? 'francophone';
        $presents = json_decode($decl['presents'], true) ?: [];
        // On revalide l'appartenance à la classe ET à la section au cas où
        // elle a changé.
        $eleves   = OperationsReleve::elevesDeLaClassePublic($decl['classe_id'], $section);
        $presents = array_values(array_intersect($presents, $eleves));

        $id = Outils::uuid();
        Db::transaction(function () use ($id, $decl, $matiere, $arrivee, $depart, $presents, $meta, $ctx, $section) {
            Db::inserer('sessions', [
                'id'                  => $id,
                'teacher_id'          => $decl['teacher_id'],
                'matiere_id'          => $decl['matiere_id'],
                'classe_id'           => $decl['classe_id'],
                'section'             => $section,
                'niveau'              => (int) $decl['niveau'],
                'day'                 => $decl['day'],
                'arrival_at'          => $arrivee,
                'arrival_received_at' => $meta['recuA'],
                'arrival_by'          => $ctx->userId,
                'arrival_via'         => 'secretariat',
                'planned_end_at'      => null,
                'departure_at'          => $depart,
                'departure_received_at' => $meta['recuA'],
                'departure_by'          => $ctx->userId,
                'departure_via'         => 'saisie_manuelle',
                'roll_validated_at'   => $decl['declared_at'],
                'roll_received_at'    => $meta['recuA'],
                'roll_code_ok'        => 0,
                'roll_compte_physique' => $decl['compte_physique'],
                'roll_by'             => $ctx->userId,
                'declare_enseignant'  => 1,
                'code'                => Outils::code(6),
                'scan_token'          => QrCodes::nouveauJetonScan(),
                'notifiee'            => 1,
                'status'              => Regles::TERMINEE,
                'created_at'          => $meta['recuA'],
            ]);

            foreach ($presents as $studentId) {
                Db::inserer('session_presents', [
                    'session_id' => $id,
                    'student_id' => $studentId,
                ]);
            }

            Db::modifier('releves_declares', ['session_id' => $id], ['id' => $decl['id']]);
        });

        Historique::ajouter([
            'entity'      => 'seance',
            'entityId'    => $id,
            'action'      => 'releve_declare_pointe',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'note'        => $teacher['prenom'] . ' ' . $teacher['nom'] . ' — ' . $decl['day'],
        ]);

        $heures = round(Outils::ecart($arrivee, $depart) / 3600, 1);
        self::avisEnseignant(
            $decl['teacher_id'],
            'heures_ajoutees',
            'Vos heures ont été enregistrées',
            'Le ' . $decl['day'] . ' : ' . Rapports::nomMatiere($matiere, $section) . ' — ' . $heures
                . ' h, pointées par le secrétariat.',
            $meta['recuA']
        );

        return ['id' => $id, 'teacherId' => $decl['teacher_id']];
    }

    /**
     * Chacun modifie son propre profil : prénom, nom, téléphone (§2).
     *
     * Si la personne se connecte avec son téléphone, le changer met aussi à
     * jour son identifiant (avec contrôle d'unicité). Les fiches liées
     * (enseignant, étudiant) sont gardées cohérentes.
     */
    public static function profil(Contexte $ctx, array $p, array $meta): array
    {
        $user = Db::un('SELECT * FROM users WHERE id = ?', [$ctx->userId]);
        if ($user === null) {
            throw Erreurs::introuvable();
        }

        $prenom = trim($p['prenom']);
        $nom    = trim($p['nom']);
        $tel    = isset($p['telephone']) ? trim((string) $p['telephone']) : ($user['telephone'] ?? '');
        $tel    = $tel === '' ? null : $tel;

        $maj = ['prenom' => $prenom, 'nom' => $nom, 'telephone' => $tel];

        // L'utilisateur se connecte-t-il avec son téléphone ?
        $ancienTel = (string) ($user['telephone'] ?? '');
        $parTel = $ancienTel !== '' && $user['login_key'] === mb_strtolower($ancienTel);
        if ($parTel && $tel !== null && $tel !== $ancienTel) {
            $nouvelleClef = mb_strtolower($tel);
            $conflit = Db::un(
                'SELECT id FROM users WHERE login_key = ? AND id <> ?',
                [$nouvelleClef, $user['id']]
            );
            if ($conflit !== null) {
                throw Erreurs::conflit('Ce numéro est déjà utilisé comme identifiant.');
            }
            $maj['login']     = $tel;
            $maj['login_key'] = $nouvelleClef;
        }

        Db::transaction(function () use ($user, $maj, $prenom, $nom, $tel) {
            Db::modifier('users', $maj, ['id' => $user['id']]);
            if (!empty($user['teacher_id'])) {
                Db::modifier(
                    'teachers',
                    ['prenom' => $prenom, 'nom' => $nom, 'telephone' => $tel ?? ''],
                    ['id' => $user['teacher_id']]
                );
            }
            if (!empty($user['student_id'])) {
                Db::modifier('students', ['prenom' => $prenom, 'nom' => $nom], ['id' => $user['student_id']]);
            }
        });

        Historique::ajouter([
            'entity'      => 'compte',
            'entityId'    => $user['id'],
            'action'      => 'profil_modifie',
            'authorId'    => $ctx->userId,
            'authorLabel' => $ctx->label,
            'note'        => $prenom . ' ' . $nom,
        ]);

        return ['id' => $user['id'], 'identifiantChange' => isset($maj['login'])];
    }
}
