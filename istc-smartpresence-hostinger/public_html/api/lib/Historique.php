<?php
declare(strict_types=1);

/**
 * Historique des modifications (§11) et anomalies (§13.12).
 *
 *  « Actions sensibles non tracées » — toute modification d'une séance, d'un
 *    relevé, d'une justification, d'un taux ou d'un paramètre passe par ici.
 *
 *  « Historique modifiable » — cette classe n'expose QUE l'ajout. Les
 *    déclencheurs posés dans `schema.sql` refusent toute mise à jour ou
 *    suppression, même depuis phpMyAdmin, même par le compte root.
 *
 *  §13.10 « Données dans les journaux » — les valeurs sensibles sont masquées
 *    avant écriture : un code de séance ou un numéro de parent n'entre jamais
 *    en clair dans l'historique.
 */
final class Historique
{
    private const CHAMPS_MASQUES = [
        'code', 'scanToken', 'scan_token', 'passwordHash', 'password_hash',
        'secret', 'motDePasse', 'parentPhone', 'parent_phone', 'dataUrl',
    ];

    /** Masque ou borne une valeur avant de l'écrire. */
    private static function masquer(?string $champ, $valeur): ?string
    {
        if ($valeur === null) {
            return null;
        }
        if ($champ !== null && in_array($champ, self::CHAMPS_MASQUES, true)) {
            return '[masqué]';
        }
        if (is_array($valeur)) {
            return count($valeur) . ' élément(s)';
        }
        if (is_bool($valeur)) {
            return $valeur ? 'oui' : 'non';
        }
        $texte = (string) $valeur;
        $texte = preg_replace('/[\x00-\x1f\x7f]/u', ' ', $texte);
        return mb_substr($texte, 0, 300);
    }

    /**
     * Ajoute une entrée. C'est la seule écriture possible sur cette table.
     *
     * @param array $e entity, entityId, action, authorId, authorLabel,
     *                 field, before, after, note, flagged
     */
    public static function ajouter(array $e): void
    {
        $champ = $e['field'] ?? null;

        Db::inserer('audit', [
            'id'           => Outils::uuid(),
            'at'           => Outils::maintenant(),
            'entity'       => mb_substr((string) ($e['entity'] ?? 'inconnu'), 0, 40),
            'entity_id'    => $e['entityId'] ?? null,
            'action'       => mb_substr((string) ($e['action'] ?? 'modification'), 0, 60),
            'author_id'    => $e['authorId'] ?? null,
            'author_label' => isset($e['authorLabel']) ? mb_substr((string) $e['authorLabel'], 0, 120) : null,
            'field'        => $champ !== null ? mb_substr((string) $champ, 0, 60) : null,
            'before_value' => self::masquer($champ, $e['before'] ?? null),
            'after_value'  => self::masquer($champ, $e['after'] ?? null),
            'note'         => isset($e['note']) ? mb_substr((string) $e['note'], 0, 300) : null,
            'flagged'      => !empty($e['flagged']) ? 1 : 0,
        ]);
    }

    /**
     * Anomalie à signaler à l'administration (§13.12 « Anomalies non
     * signalées ») : départ saisi après coup, écart entre scans et liste
     * cochée, deux comptes sur un même appareil, séance sans taux applicable,
     * blocage pour trop d'essais.
     */
    public static function anomalie(array $a): void
    {
        Db::inserer('anomalies', [
            'id'         => Outils::uuid(),
            'at'         => Outils::maintenant(),
            'kind'       => mb_substr((string) $a['kind'], 0, 40),
            'titre'      => mb_substr((string) $a['titre'], 0, 160),
            'detail'     => isset($a['detail']) ? mb_substr((string) $a['detail'], 0, 400) : null,
            'subject_id' => $a['subjectId'] ?? null,
            'session_id' => $a['sessionId'] ?? null,
            'severity'   => in_array($a['severity'] ?? 'info', ['info', 'attention', 'grave'], true)
                ? $a['severity'] : 'info',
            'vue'        => 0,
        ]);
    }

    /** Lecture — réservée à l'administration (vérifié par l'appelant). */
    public static function lire(int $limite = 300): array
    {
        $limite = max(1, min($limite, 1000));
        return Db::tout("SELECT * FROM audit ORDER BY at DESC LIMIT $limite");
    }

    public static function anomalies(int $limite = 200): array
    {
        $limite = max(1, min($limite, 1000));
        return Db::tout("SELECT * FROM anomalies ORDER BY at DESC LIMIT $limite");
    }
}
