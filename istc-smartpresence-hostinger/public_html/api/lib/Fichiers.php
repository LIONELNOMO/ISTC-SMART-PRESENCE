<?php
declare(strict_types=1);

/**
 * Justificatifs d'absence (§6) — §13.7 « Fichiers ».
 *
 *  « Fichier dangereux »      — type vérifié sur le CONTENU (nombre magique),
 *                               jamais sur l'extension ni sur ce qu'annonce
 *                               le client.
 *  « Fichier trop lourd »     — 5 Mo maximum.
 *  « Nom de fichier piégé »   — le nom d'origine est jeté ; on en génère un.
 *  « Traversée de chemin »    — le nom produit ne contient que des caractères
 *                               sûrs, et le chemin est vérifié après assemblage.
 *  « Justificatif accessible à tous » — le dossier est HORS du dossier web.
 *                               Le téléchargement passe par une route qui
 *                               vérifie les droits.
 */
final class Fichiers
{
    public const TAILLE_MAX = 5 * 1024 * 1024;

    /** Signatures acceptées. Un .svg ou .html renommé .jpg échoue ici. */
    private const SIGNATURES = [
        ['type' => 'image/jpeg',      'ext' => 'jpg', 'octets' => "\xFF\xD8\xFF"],
        ['type' => 'image/png',       'ext' => 'png', 'octets' => "\x89PNG\r\n\x1a\n"],
        ['type' => 'application/pdf', 'ext' => 'pdf', 'octets' => '%PDF-'],
    ];

    /** Dossier des justificatifs, créé si besoin, hors du dossier web. */
    private static function dossier(): string
    {
        $dossier = (string) Config::get('dossier_justificatifs');
        if ($dossier === '') {
            throw Erreurs::interne('Dossier des justificatifs non configuré.');
        }
        if (!is_dir($dossier) && !@mkdir($dossier, 0750, true) && !is_dir($dossier)) {
            throw Erreurs::interne("Le dossier des justificatifs n'a pas pu être créé.");
        }
        return rtrim($dossier, '/\\');
    }

    /**
     * Enregistre un justificatif reçu en data URL et renvoie son nom généré.
     *
     * Le contenu est décodé puis EXAMINÉ : c'est son nombre magique qui décide
     * du type, pas ce que le client annonce.
     */
    public static function enregistrerJustificatif(array $piece): string
    {
        $dataUrl = (string) ($piece['dataUrl'] ?? '');

        if (!preg_match('#^data:([a-z]+/[a-z0-9.+-]+);base64,#i', $dataUrl, $m)) {
            throw Erreurs::invalide('Justificatif illisible.');
        }

        $donnees = base64_decode(substr($dataUrl, strlen($m[0])), true);
        if ($donnees === false || $donnees === '') {
            throw Erreurs::invalide('Justificatif illisible.');
        }

        if (strlen($donnees) > self::TAILLE_MAX) {
            throw Erreurs::invalide(
                'Fichier trop lourd : ' . round(strlen($donnees) / 1048576, 1) . ' Mo pour 5 Mo au maximum.'
            );
        }

        $reconnu = null;
        foreach (self::SIGNATURES as $candidat) {
            if (strncmp($donnees, $candidat['octets'], strlen($candidat['octets'])) === 0) {
                $reconnu = $candidat;
                break;
            }
        }

        if ($reconnu === null) {
            throw Erreurs::invalide(
                'Type de fichier refusé. Le contenu doit être une photo JPEG ou PNG, ou un PDF — '
                . "l'extension du fichier n'est pas prise en compte."
            );
        }

        // §13.7 « Nom de fichier piégé » : nom entièrement généré.
        $nom = 'justificatif-' . Outils::uuid() . '.' . $reconnu['ext'];

        $chemin = self::dossier() . DIRECTORY_SEPARATOR . $nom;

        // Ceinture et bretelles contre la traversée de chemin : le fichier doit
        // se trouver dans le dossier prévu, une fois le chemin résolu.
        if (dirname($chemin) !== self::dossier()) {
            throw Erreurs::interne('Chemin de justificatif invalide.');
        }

        if (@file_put_contents($chemin, $donnees, LOCK_EX) === false) {
            throw Erreurs::interne("Le justificatif n'a pas pu être enregistré.");
        }
        @chmod($chemin, 0640);

        return $nom;
    }

    /**
     * Lit un justificatif pour le renvoyer.
     *
     * L'appelant a vérifié les droits (§13.10 : l'étudiant concerné, son chef
     * de département, l'administration). Le nom est revalidé ici : il vient de
     * la base, mais on ne lui fait pas confiance pour autant (§13.1
     * « Injection SQL de second ordre » appliquée aux chemins).
     */
    public static function lireJustificatif(string $nom): array
    {
        if (!preg_match('/^justificatif-[0-9a-f-]{36}\.(jpg|png|pdf)$/', $nom)) {
            throw Erreurs::introuvable();
        }

        $chemin = self::dossier() . DIRECTORY_SEPARATOR . $nom;
        if (!is_file($chemin)) {
            throw Erreurs::introuvable();
        }

        $types = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'pdf' => 'application/pdf'];
        $ext = strtolower(pathinfo($nom, PATHINFO_EXTENSION));

        return [
            'contenu' => (string) file_get_contents($chemin),
            'type'    => $types[$ext] ?? 'application/octet-stream',
            'nom'     => $nom,
        ];
    }

    /** Supprime un justificatif. Appelé quand la justification disparaît. */
    public static function supprimerJustificatif(?string $nom): void
    {
        if ($nom === null || !preg_match('/^justificatif-[0-9a-f-]{36}\.(jpg|png|pdf)$/', $nom)) {
            return;
        }
        @unlink(self::dossier() . DIRECTORY_SEPARATOR . $nom);
    }
}
