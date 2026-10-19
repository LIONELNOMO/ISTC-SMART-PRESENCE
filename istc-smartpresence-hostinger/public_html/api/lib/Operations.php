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

        // §13.3 « Enseignant hors affectation » : la matière doit être la sienne.
        $affecte = Db::compte(
            'SELECT COUNT(*) FROM affectations WHERE teacher_id = ? AND matiere_id = ?',
            [$enseignant['id'], $p['matiereId']]
        );
        if ($affecte === 0) {
            throw Erreurs::invalide("Cette matière n'est pas affectée à cet enseignant.");
        }

        $matiere = Db::un('SELECT * FROM matieres WHERE id = ?', [$p['matiereId']]);
        if ($matiere === null) {
            throw Erreurs::introuvable();
        }
        $classe = Db::un('SELECT * FROM classes WHERE id = ?', [$matiere['classe_id']]);
        if ($classe === null) {
            throw Erreurs::introuvable();
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

        $id = Outils::uuid();
        Db::inserer('sessions', [
            'id'                  => $id,
            'teacher_id'          => $enseignant['id'],
            'matiere_id'          => $matiere['id'],
            'classe_id'           => $classe['id'],
            'niveau'              => (int) $classe['niveau'],
            'day'                 => Outils::jour($instant['at']),
            'arrival_at'          => $instant['at'],
            'arrival_received_at' => $meta['recuA'],
            'arrival_by'          => $ctx->userId,
            'arrival_via'         => 'secretariat',
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
                'titre'      => mb_substr('Le cours de ' . $matiere['nom'] . ' va commencer', 0, 160),
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
            'note'        => $enseignant['prenom'] . ' ' . $enseignant['nom'] . ' — ' . $matiere['nom'],
        ]);

        return ['sessionId' => $id, 'code' => $code, 'notifiee' => $notifiee];
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

        $id = Outils::uuid();
        Db::inserer('sessions', [
            'id'                  => $id,
            'teacher_id'          => $ctx->teacherId,
            'matiere_id'          => $matiere['id'],
            'classe_id'           => $classe['id'],
            'niveau'              => (int) $classe['niveau'],
            'day'                 => Outils::jour($heurePoste),
            'arrival_at'          => $heurePoste,
            'arrival_received_at' => $meta['recuA'],
            'arrival_by'          => $station['secretary_user_id'],
            'arrival_via'         => 'scan',
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
            'titre'      => mb_substr('Le cours de ' . $matiere['nom'] . ' va commencer', 0, 160),
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
            'note'        => $matiere['nom'],
        ]);

        Limites::reussite('scan', $ctx->userId);

        // Le code de séance s'affiche dans l'application de l'enseignant (§4).
        $code = Db::un('SELECT code FROM sessions WHERE id = ?', [$id])['code'];
        return ['sens' => 'arrivee', 'sessionId' => $id, 'code' => $code];
    }
}
