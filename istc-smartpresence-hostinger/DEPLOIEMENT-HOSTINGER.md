# Déployer ISTC SmartPresence sur Hostinger

> Guide pas à pas. Comptez **45 minutes** la première fois.
> Vous n'avez besoin d'aucune compétence en ligne de commande, sauf pour une
> seule étape, faite sur votre propre ordinateur.

---

## ⚠️ À lire avant de commencer

L'API PHP est **écrite et vérifiée fichier par fichier**, mais elle n'a pas pu
être testée de bout en bout : la base MariaDB de mon poste s'arrête de façon
répétée, ce qui m'a empêché d'enchaîner connexion → pointage → relevé.

Concrètement : **attendez-vous à une ou deux erreurs au premier essai.** La
section [Si quelque chose ne marche pas](#si-quelque-chose-ne-marche-pas)
explique comment lire le journal et me rapporter le message exact.

Déployez d'abord sur un **sous-domaine de test** si vous en avez la
possibilité.

---

## Ce que vous allez obtenir

```
votre-domaine.cm/            l'application (React)
votre-domaine.cm/api/        le serveur (PHP)
                             la base MySQL
                             les justificatifs, hors du dossier web
```

Tout sur **un seul domaine** : pas de CORS à régler, et la session tient dans
un cookie HttpOnly, inaccessible aux scripts.

---

## Étape 1 · Créer la base de données

Dans **hPanel → Bases de données → Gestion des bases MySQL** :

1. **Créer une base**
   - Nom : `presences` (Hostinger le préfixera, par exemple `u123456789_presences`)
   - Utilisateur : `presences`
   - Mot de passe : cliquez sur **Générer**, puis **copiez-le quelque part**

2. **Notez les trois valeurs**, vous en aurez besoin à l'étape 4 :

   | | Exemple | La vôtre |
   |---|---|---|
   | Base | `u123456789_presences` | |
   | Utilisateur | `u123456789_presences` | |
   | Mot de passe | `xK9!mP2vQ...` | |

> **Hôte** : sur Hostinger c'est `localhost`. Si hPanel affiche autre chose
> (par exemple `mysql.hostinger.com`), retenez cette valeur à la place.

---

## Étape 2 · Charger le schéma

Toujours dans hPanel → **phpMyAdmin** (bouton à côté de votre base).

1. Sélectionnez votre base dans la colonne de gauche
2. Onglet **Importer**
3. **Choisir un fichier** → `api/schema.sql`
4. **Exécuter**

Vous devez voir **23 tables** apparaître à gauche.

<details>
<summary>Si l'import échoue sur les déclencheurs (<code>DELIMITER</code>)</summary>

Certaines versions de phpMyAdmin butent sur les deux déclencheurs à la fin du
fichier. Dans ce cas :

1. Ouvrez `api/schema.sql` dans un éditeur de texte
2. Supprimez tout le bloc entre `DELIMITER //` et `DELIMITER ;`
3. Réimportez
4. Puis, dans l'onglet **SQL**, collez ceci :

```sql
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit
FOR EACH ROW SIGNAL SQLSTATE '45000'
SET MESSAGE_TEXT = 'Historique en ajout seul : modification interdite.';

CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit
FOR EACH ROW SIGNAL SQLSTATE '45000'
SET MESSAGE_TEXT = 'Historique en ajout seul : suppression interdite.';
```

**Ne sautez pas cette partie.** Ces deux déclencheurs sont ce qui rend
l'historique impossible à falsifier, y compris par un administrateur.
</details>

---

## Étape 3 · Créer le dossier des justificatifs

Les certificats médicaux ne doivent **jamais** être téléchargeables par leur
adresse. Ils vont donc **hors** du dossier web.

Dans hPanel → **Gestionnaire de fichiers** :

```
/home/u123456789/
├── domains/
│   └── votre-domaine.cm/
│       └── public_html/        ← le dossier web
├── justificatifs-prives/       ← À CRÉER ICI (à côté, pas dedans)
└── logs-app/                   ← À CRÉER AUSSI
```

Remontez jusqu'à voir le dossier `domains`, puis créez `justificatifs-prives`
et `logs-app` **au même niveau**.

> Si vous les créez dans `public_html`, n'importe qui pourra télécharger les
> certificats médicaux de vos étudiants.

---

## Étape 4 · Préparer le fichier de configuration

Sur **votre ordinateur**, dupliquez `api/config.exemple.php` en
`api/config.php`, puis ouvrez-le et remplissez :

```php
<?php
return [
    'db' => [
        'host'     => 'localhost',
        'name'     => 'u123456789_presences',      // ← étape 1
        'user'     => 'u123456789_presences',      // ← étape 1
        'password' => 'votre-mot-de-passe',        // ← étape 1
        'charset'  => 'utf8mb4',
    ],

    // Une longue suite de caractères au hasard. Tapez n'importe quoi de long,
    // ou utilisez un générateur de mot de passe (64 caractères).
    'session_secret' => 'collez-ici-64-caracteres-au-hasard',

    // L'application et l'API sont sur le même domaine : laissez null.
    'origine_autorisee' => null,

    // true en production : les messages d'erreur restent génériques.
    'production' => true,

    // Les deux dossiers de l'étape 3. Remplacez u123456789 par VOTRE identifiant.
    'dossier_justificatifs' => '/home/u123456789/justificatifs-prives',
    'journal'               => '/home/u123456789/logs-app/api.log',
];
```

> **Votre identifiant Hostinger** se lit dans le gestionnaire de fichiers, en
> haut : c'est le `u` suivi de chiffres.

---

## Étape 5 · Le paquet est déjà prêt

Vous n'avez rien à construire : **`istc-smartpresence-hostinger.zip`**
contient déjà l'application compilée, l'API et les règles de serveur, dans
l'arborescence finale.

```
istc-smartpresence-hostinger.zip
├── LISEZ-MOI-DABORD.txt
├── DEPLOIEMENT-HOSTINGER.md              ce guide
├── public_html/                          ← à déposer sur Hostinger
├── a-importer-dans-phpmyadmin/
│   └── schema.sql                        ← étape 2
├── a-garder-sur-votre-ordinateur/
│   └── creer-administrateur.php          ← étape 9
└── etudiants-a-importer-dans-lapp.csv    ← étape 10
```

Seul `public_html/` part en ligne. Les trois autres éléments restent chez
vous : le schéma s'importe par phpMyAdmin, et le script d'administrateur
s'exécute sur votre machine pour que votre mot de passe ne circule pas.

<details>
<summary>Reconstruire le paquet vous-même (facultatif)</summary>

```bash
npm install
npm run build
```

`dist/` contient alors l'application. Le paquet fourni correspond à
`dist/` + `api/`, moins `api/config.php`, `api/schema.sql` et `api/outils/`.
</details>

---

## Étape 6 · Déposer les fichiers

Dans hPanel → **Gestionnaire de fichiers**, ouvrez
`domains/votre-domaine.cm/public_html/`.

1. **Téléverser** le ZIP dans ce dossier
2. Clic droit dessus → **Extraire**
3. Vous obtenez un sous-dossier `public_html/` **à l'intérieur** de
   `public_html/` : ouvrez-le, sélectionnez tout, et **déplacez** son contenu
   d'un niveau vers le haut
4. Supprimez le sous-dossier vide, le ZIP, et les trois éléments qui ne vont
   pas en ligne (`a-importer-dans-phpmyadmin/`,
   `a-garder-sur-votre-ordinateur/`, le `.md` et le `.csv`)
5. Déposez votre `api/config.php` de l'étape 4 dans `public_html/api/`

Résultat attendu :

```
public_html/
├── .htaccess               ← fourni
├── index.html
├── manifest.webmanifest
├── sw.js
├── assets/
├── icons/
├── marque/
└── api/
    ├── .htaccess           ← fourni
    ├── index.php
    ├── config.exemple.php
    ├── config.php          ← celui que VOUS avez rempli
    └── lib/
        └── .htaccess       ← fourni
```

> **Si `index.html` se retrouve dans `public_html/public_html/`**, le site
> affichera une page blanche. C'est l'erreur la plus fréquente : vérifiez que
> `index.html` est bien **directement** dans `public_html/`.

### Vérifiez les fichiers `.htaccess`

Il y en a **trois**, et ils sont déjà dans le ZIP. Ils commencent par un point,
donc le gestionnaire de fichiers peut les masquer : cherchez l'option
**« Afficher les fichiers cachés »** et confirmez leur présence.

| Fichier | Ce qu'il fait |
|---|---|
| `public_html/.htaccess` | adresses de l'application, en-têtes de sécurité, HTTPS forcé |
| `public_html/api/.htaccess` | dirige tout vers `index.php`, bloque `.sql` et `.php` de config |
| `public_html/api/lib/.htaccess` | interdit l'accès direct au code |

Sans le premier, l'application affiche une page blanche dès qu'on rafraîchit une
page interne. Sans les deux autres, votre code et vos identifiants deviennent
téléchargeables.

---

## Étape 7 · Activer HTTPS

Dans hPanel → **Sécurité → SSL** :

1. Installez le certificat gratuit (Let's Encrypt)
2. Activez **Forcer HTTPS**

**C'est obligatoire, pas optionnel.** Sans HTTPS :
- la caméra ne fonctionne pas, donc aucun scan de QR possible ;
- le mode hors ligne ne s'installe pas ;
- les mots de passe circulent en clair sur le réseau de l'école.

Attendez 10 à 15 minutes que le certificat soit actif.

---

## Étape 8 · Vérifier que l'API répond

Ouvrez dans votre navigateur :

```
https://votre-domaine.cm/api/sante
```

**Attendu :**

```json
{"data":{"ok":true,"installe":false,"heure":"2026-10-10T..."}}
```

| Ce que vous voyez | Ce que ça veut dire |
|---|---|
| `"ok":true` | ✅ l'API et la base fonctionnent |
| `{"error":{"code":"configuration"...` | `config.php` manquant ou mal placé |
| `{"error":{"code":"interne"...` | identifiants de base incorrects — relisez l'étape 4 |
| Une page HTML ou une erreur 500 | le `.htaccess` ou PHP pose problème |

**N'allez pas plus loin tant que vous ne voyez pas `"ok":true`.**

---

## Étape 9 · Créer votre compte administrateur

Il n'existe **aucun compte par défaut** — c'est voulu : un mot de passe livré
avec l'application serait connu de tous.

Sur **votre ordinateur**, dans le dossier extrait du ZIP :

```bash
php a-garder-sur-votre-ordinateur/creer-administrateur.php
```

> Sous Windows avec XAMPP :
> `C:\xampp\php\php.exe a-garder-sur-votre-ordinateur\creer-administrateur.php`

Le script vous demande vos informations, puis affiche un bloc SQL.
**Copiez-le entièrement**, allez dans phpMyAdmin → votre base → onglet **SQL**,
collez, **Exécuter**.

Votre mot de passe n'a jamais quitté votre ordinateur : seul son empreinte
Argon2id part en base.

---

## Étape 10 · Première connexion

```
https://votre-domaine.cm/
```

Connectez-vous avec **votre numéro de téléphone** et le mot de passe choisi.

Puis, dans cet ordre :

1. **Paramètres** — nom de l'établissement, monnaie, dates des semestres,
   seuil d'alerte
2. **Référentiel → Filières** — créez vos 7 filières :
   Génie logiciel, Réseaux et sécurité, NETSEC, CGE, GRH, MCV, Santé
3. **Référentiel → Étudiants → Import** — chargez
   `etudiants-a-importer-dans-lapp.csv`, à la racine du ZIP (vos 22 étudiants)
4. **Référentiel → Enseignants** — créez-les ; notez le mot de passe
   provisoire de chacun, il ne s'affiche qu'une fois
5. **Référentiel → Matières**, puis **Affectations**
6. **Taux horaires** — au minimum un taux par niveau

---

## Si quelque chose ne marche pas

### Lire le journal

Le fichier `/home/u123456789/logs-app/api.log` contient le détail des erreurs
— que le navigateur, lui, ne montre jamais (c'est volontaire : un message
d'erreur bavard renseigne un attaquant).

Ouvrez-le dans le gestionnaire de fichiers. La dernière ligne est la plus
récente :

```json
{"at":"2026-10-10T08:14:22+00:00","event":"erreur_inattendue",
 "message":"SQLSTATE[42S02] Table 'xxx.users' doesn't exist","fichier":"Db.php:32"}
```

**Envoyez-moi cette ligne** et je vous dis quoi corriger.

### Pannes courantes

| Symptôme | Cause probable | Correction |
|---|---|---|
| Page blanche | Les fichiers de `dist/` sont dans un sous-dossier | Ils doivent être **directement** dans `public_html/` |
| `code: configuration` | `config.php` absent | Vérifiez qu'il est bien dans `public_html/api/` |
| `code: interne` sur `/api/sante` | Identifiants de base faux | Relisez l'étape 4, vérifiez le préfixe `u123456789_` |
| La connexion échoue toujours | Compte pas créé | Refaites l'étape 9 |
| « Trop d'essais » | Protection anti-force brute | Attendez 1 à 15 minutes, c'est normal |
| La caméra ne s'ouvre pas | HTTPS absent | Étape 7 |
| Les écrans restent vides | L'API ne répond pas | Testez `/api/sante` |

### Repartir de zéro

Dans phpMyAdmin, onglet **SQL** :

```sql
DROP DATABASE `u123456789_presences`;
CREATE DATABASE `u123456789_presences`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Puis reprenez à l'étape 2.

---

## Avant d'ouvrir aux utilisateurs

- [ ] `https://votre-domaine.cm/api/sante` répond `"ok":true`
- [ ] Vous vous connectez avec votre compte
- [ ] `https://votre-domaine.cm/api/config.php` affiche **403** ou **404**
      (jamais le contenu du fichier)
- [ ] `https://votre-domaine.cm/api/lib/Db.php` affiche **403**
- [ ] `https://votre-domaine.cm/api/schema.sql` affiche **403** ou **404**
- [ ] HTTPS forcé : `http://` redirige vers `https://`
- [ ] Le dossier `justificatifs-prives` est **hors** de `public_html`
- [ ] `api/outils/` n'est pas en ligne
- [ ] Vous avez noté votre mot de passe administrateur ailleurs que dans un
      fichier du serveur

La liste complète est au [§13.13 de securité.md](securité.md#1313-vérifications-avant-mise-en-ligne).

---

## Mettre à jour plus tard

Vous recevrez un nouveau ZIP, ou vous reconstruirez avec `npm run build`.
Déposez le contenu de `public_html/` (ou de `dist/`) en écrasant l'ancien.

**Deux choses à ne jamais écraser :**

- `api/config.php` — il contient vos identifiants de base
- le dossier `justificatifs-prives` — il contient les pièces jointes

Videz ensuite le cache de votre navigateur, ou attendez quelques minutes : le
service worker recharge l'application tout seul.

Si le schéma de la base change, je vous fournirai un fichier de migration
distinct : ne réimportez jamais `schema.sql`, il effacerait tout.

---

## Sauvegardes

Hostinger sauvegarde automatiquement, mais pensez à faire une copie manuelle
avant chaque mise à jour :

**phpMyAdmin → votre base → Exporter → Exécuter** → un fichier `.sql` à garder
en lieu sûr.

Et pensez aussi au dossier `justificatifs-prives`, qui n'est pas dans la base.
