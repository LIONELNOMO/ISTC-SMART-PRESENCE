# Sécurité — Application de suivi des présences

> **Version** 1.0 · **Date** 9 octobre 2026 · Annexe au [cahier de charges](cahier-de-charge.md) (§13)
> **Statut** contrat de développement : aucune de ces failles ne doit subsister à la mise en ligne.

---

## Principe fondateur

> **Le serveur ne fait confiance à rien de ce qui vient d'un téléphone ou d'un navigateur.**

Formulaires, scans, heures, fichiers importés et file d'attente hors ligne sont **tous revérifiés par le serveur**. Le navigateur est une surface d'affichage et de saisie : il ne décide ni des droits, ni des heures, ni des montants.

Quatre corollaires appliqués partout dans ce projet :

1. **Refus par défaut.** Une route sans vérification explicite de session et de rôle est une route fermée.
2. **Le serveur calcule, le client affiche.** État d'une séance, heures payées, coûts, absences : calculés côté serveur, jamais acceptés depuis le client.
3. **Liste blanche, jamais liste noire.** Champs acceptés, colonnes triables, types de fichiers, schémas de requête : tout est énuméré.
4. **Tout ce qui est sensible laisse une trace.** Historique en ajout seul, consultable par l'administration.

### Comment lire ce document

Chaque tableau donne la **faille**, la façon dont elle **peut se produire dans cette application**, la **mesure exigée**, et l'**endroit du code** qui la porte. La colonne « Où » est tenue à jour avec le code ; `serveur/` désigne l'API à écrire (Node + PostgreSQL ou Supabase), `src/` l'application React.

Légende de la colonne « Où » :

| Marque | Sens |
| --- | --- |
| `serveur/` | Obligation côté API — **seul endroit qui fait foi** |
| `src/` | Obligation côté application React (défense en profondeur, jamais la seule) |
| `infra` | Obligation d'hébergement, de configuration ou d'exploitation |
| `process` | Obligation d'organisation (revue, audit, rotation de secrets) |

---

## Sommaire

| § | Famille | Nombre de failles |
| --- | --- | --- |
| [13.1](#131-injections) | Injections | 17 |
| [13.2](#132-authentification-et-sessions) | Authentification et sessions | 14 |
| [13.3](#133-contrôle-daccès) | Contrôle d'accès | 15 |
| [13.4](#134-fraude-sur-le-pointage-et-les-présences) | Fraude sur le pointage et les présences | 17 |
| [13.5](#135-hors-ligne-stockage-local-et-synchronisation) | Hors ligne, stockage local et synchronisation | 12 |
| [13.6](#136-api-et-serveur) | API et serveur | 14 |
| [13.7](#137-fichiers--justificatifs-import-et-export) | Fichiers : justificatifs, import et export | 9 |
| [13.8](#138-interface-react-et-navigateur) | Interface React et navigateur | 11 |
| [13.9](#139-notifications-et-lien-whatsapp) | Notifications et lien WhatsApp | 7 |
| [13.10](#1310-données-personnelles) | Données personnelles | 8 |
| [13.11](#1311-secrets-configuration-et-dépendances) | Secrets, configuration et dépendances | 8 |
| [13.12](#1312-journalisation-et-surveillance) | Journalisation et surveillance | 5 |
| [13.13](#1313-vérifications-avant-mise-en-ligne) | Vérifications avant mise en ligne | 19 tests |

---

## 13.1 Injections

| Faille | Comment elle se produit ici | Mesure exigée | Où |
| --- | --- | --- | --- |
| **Injection SQL** | Un champ (identifiant, recherche, filtre, matricule importé) est collé dans une requête | Requêtes paramétrées ou ORM partout. **Aucune concaténation de texte dans une requête** | `serveur/` |
| **Injection SQL par le tri ou les filtres** | Le nom de colonne ou l'ordre de tri vient du navigateur | **Liste blanche** des colonnes et des ordres autorisés | `serveur/` |
| **Injection SQL de second ordre** | Une valeur déjà en base (nom importé, motif) est réutilisée dans une requête construite à la main | Paramétrer **aussi** les requêtes qui utilisent des données de la base | `serveur/` |
| **Injection NoSQL** | Si une base NoSQL est utilisée, un objet JSON remplace une valeur attendue (`{"$ne": null}`) | Vérifier le **type** de chaque champ ; refuser un objet là où un texte est attendu | `serveur/`, `src/server/schema.js` |
| **XSS stocké** | Un nom, un motif de justification ou un modèle de message contient du HTML ou du script, affiché ensuite chez un autre rôle | Laisser **React échapper** le texte. Interdire `dangerouslySetInnerHTML`. Nettoyer aussi côté serveur | `src/` (interdit partout), `serveur/` |
| **XSS réfléchi et XSS dans la page** | Un paramètre d'URL ou le contenu d'un code QR est affiché ou exécuté tel quel | Ne **jamais** injecter une valeur d'URL ou de QR dans la page sans validation | `src/server/schema.js` |
| **Injection par code QR** | Un QR fabriqué contient une URL, du script ou un identifiant forgé | Le contenu scanné est une **donnée** : format strict vérifié, **jamais ouvert comme un lien** | `src/lib/qr-codes.js` |
| **Injection de formule (CSV, Excel)** | Un nom commençant par `=`, `+`, `-` ou `@` s'exécute à l'ouverture de l'export | **Neutraliser** ces cellules à l'import et les préfixer d'une apostrophe à l'export | `src/lib/tabular.js` |
| **Injection dans le lien WhatsApp** | Le numéro ou le message contient des caractères qui modifient l'URL | Numéro : **chiffres uniquement**, format international validé. Message encodé avec `encodeURIComponent` | `src/lib/whatsapp.js` |
| **Injection dans le modèle de message** | Les variables du modèle sont évaluées comme du code | **Simple substitution de texte**, sans moteur qui exécute du code | `src/lib/whatsapp.js` |
| **Injection de commande** | Le serveur lance une commande système avec un nom de fichier ou un paramètre utilisateur | **Aucun appel au shell** avec des données utilisateur | `serveur/` |
| **Traversée de chemin** | Un nom de fichier comme `../../` sort du dossier prévu | Noms de fichiers **générés par le serveur** ; le nom d'origine ne sert jamais de chemin | `serveur/` |
| **XXE et bombe de décompression** | Un fichier Excel importé (archive XML) contient des entités externes ou se décompresse en gigaoctets | Entités externes **désactivées** ; taille maximale **avant et après** décompression | `serveur/` |
| **Injection dans les journaux** | Un texte avec retours à la ligne fabrique de fausses lignes de journal | Journaux **structurés (JSON)** ; caractères de contrôle échappés | `serveur/` |
| **Injection d'en-têtes HTTP** | Une valeur utilisateur est placée dans un en-tête (nom de fichier, redirection) | Valeurs d'en-tête nettoyées, **sans retour à la ligne** | `serveur/` |
| **Pollution de prototype** | Un JSON contenant `__proto__` est fusionné dans un objet du serveur | Chaque requête validée contre un **schéma strict** ; clés inconnues **refusées** | `src/server/schema.js`, `serveur/` |
| **Expression régulière coûteuse** | Une expression régulière fragile bloque le serveur sur une entrée très longue | **Longueur maximale** sur chaque champ ; expressions régulières simples | `src/server/schema.js`, `serveur/` |

---

## 13.2 Authentification et sessions

| Faille | Comment elle se produit ici | Mesure exigée | Où |
| --- | --- | --- | --- |
| **Mot de passe faible ou par défaut** | Comptes créés par import avec le matricule comme mot de passe | Mot de passe **provisoire aléatoire**, à changer à la première connexion ; **8 caractères minimum** | `serveur/`, `src/server/auth.js` |
| **Mots de passe mal stockés** | En clair, ou hachés avec MD5 ou SHA-1 | Hachage **Argon2id ou bcrypt**, avec sel | `serveur/` (navigateur : PBKDF2 de démonstration seulement) |
| **Force brute** | Essais illimités à la connexion, alors que les matricules sont devinables | Limite d'essais **par compte et par adresse IP**, délai croissant, blocage temporaire | `serveur/`, `src/server/ratelimit.js` |
| **Énumération de comptes** | Le message distingue « compte inconnu » et « mot de passe faux » | **Même message et même temps de réponse** dans les deux cas | `src/server/auth.js` |
| **Jeton de session falsifiable** | JWT avec secret faible, algorithme `none` accepté, ou sans expiration | Secret long et aléatoire, **algorithme imposé**, durée courte, renouvellement révocable | `serveur/` |
| **Vol du jeton** | Jeton gardé dans `localStorage` et lu par un script injecté | Cookie **HttpOnly, Secure et SameSite** de préférence | `serveur/` |
| **CSRF** | Avec des cookies, un autre site déclenche une action au nom de l'utilisateur | `SameSite=Lax` ou `Strict` **et** jeton anti-CSRF sur toute requête qui modifie | `serveur/` |
| **Fixation de session** | L'identifiant de session reste le même avant et après la connexion | **Nouveau jeton à chaque connexion** | `serveur/`, `src/server/auth.js` |
| **Session jamais révoquée** | Compte désactivé ou rôle changé, mais l'ancien jeton marche encore | Le serveur **revérifie l'état du compte et le rôle à chaque requête** | `src/server/guard.js` |
| **Déconnexion incomplète** | Après déconnexion, le jeton ou les données restent sur l'appareil | Jeton invalidé côté serveur **et données locales effacées** | `src/lib/session.js` |
| **Session hors ligne sur téléphone perdu ou prêté** | La session reste ouverte sans réseau, sans limite | **Durée maximale hors ligne (7 jours par défaut)**, puis reconnexion obligatoire | `src/lib/session.js` |
| **Réinitialisation de mot de passe** | Lien devinable ou sans expiration, identité non vérifiée | Réinitialisation **par l'administration**, ou lien aléatoire à usage unique et durée courte | `serveur/` |
| **Changement de mot de passe sans l'ancien** | Un téléphone déverrouillé suffit à prendre le compte | **Mot de passe actuel exigé** ; les autres sessions sont fermées | `src/server/auth.js` |
| **Compte administrateur par défaut** | `admin / admin` laissé en production | **Aucun compte par défaut** ; premier administrateur créé à l'installation | `src/lib/seed.js` (jeu de démonstration **désactivé en production**) |

---

## 13.3 Contrôle d'accès

| Faille | Comment elle se produit ici | Mesure exigée | Où |
| --- | --- | --- | --- |
| **Contrôle fait seulement dans l'interface** | Un bouton est caché, mais la route du serveur répond quand même | **Chaque route** vérifie la session, le rôle et les droits côté serveur | `src/server/guard.js` |
| **Accès aux données d'autrui (IDOR)** | Changer un identifiant dans une requête montre les absences d'un autre étudiant ou les heures d'un autre enseignant | Vérifier **à chaque requête** que l'objet appartient à l'utilisateur ou à son périmètre | `src/server/guard.js` |
| **Élévation de rôle** | Le champ `role` est envoyé dans une requête de profil et accepté | Rôle modifiable **par l'administration seulement** | `src/server/schema.js` |
| **Affectation de masse** | Des champs non prévus (classe, taux, état de séance, heures) sont acceptés dans une mise à jour | **Liste blanche de champs par route** ; champs inconnus refusés | `src/server/schema.js` |
| **Chef de département hors filière** | Il consulte ou justifie des étudiants d'une autre filière | **Filtrage par filière côté serveur** | `src/server/guard.js` |
| **Enseignant hors affectation** | Il fait un relevé pour une matière qui n'est pas la sienne | **Affectation vérifiée** à chaque séance et à chaque relevé | `src/server/ops.js` |
| **Étudiant hors classe** | Il envoie un scan pour une séance d'une autre classe | **Appartenance à la classe vérifiée** | `src/server/ops.js` |
| **Fuite des taux et des montants** | La réponse du serveur contient les taux, seulement masqués à l'écran | Les taux et montants **ne sortent jamais du serveur** pour les rôles non autorisés | `src/server/projection.js` |
| **Pointage de soi-même** | Un compte à la fois secrétaire et enseignant pointe ses propres heures | **Cumul secrétaire et enseignant refusé** | `src/server/ops.js`, `src/server/schema.js` |
| **Routes oubliées** | Import, export, paramètres ou routes de test restent ouverts | **Refus par défaut** : toute route exige une session et un rôle explicite | `src/server/guard.js` |
| **Accès direct à la base** | Avec Supabase, la clé publique lit les tables si aucune règle n'est posée | **RLS sur toutes les tables** ; clé de service **jamais** dans l'application | `infra` |
| **Identifiants devinables** | Des identifiants `1, 2, 3` permettent de parcourir séances et étudiants | **Identifiants aléatoires (UUID)** pour séances, relevés et fichiers | `src/lib/crypto.js` |
| **Changement d'état interdit** | Un enseignant passe lui-même sa séance à « terminée » | **Seul le serveur calcule l'état** d'une séance, à partir de ses trois éléments | `src/server/rules.js` |
| **Modification après le délai** | Un relevé est modifié après 48 heures par un appel direct au serveur | **Délais vérifiés côté serveur** | `src/server/ops.js` |
| **Droits périmés hors ligne** | Un rôle retiré continue d'agir avec les données déjà sur le téléphone | Droits **revérifiés à la synchronisation**, avec les droits du moment | `src/server/guard.js` |

---

## 13.4 Fraude sur le pointage et les présences

> Cette famille est la raison d'être du dispositif à trois codes. Les mesures ci-dessous ne sont pas optionnelles : sans elles, les heures payées ne valent rien.

| Faille | Comment elle se produit ici | Mesure exigée | Où |
| --- | --- | --- | --- |
| **Photo du code QR de pointage** | L'enseignant photographie le code et le scanne plus tard, depuis chez lui | Code **renouvelé toutes les 60 secondes**, refusé une fois expiré | `src/lib/qr-codes.js` |
| **Code QR de pointage fabriqué** | L'enseignant génère lui-même un code d'apparence valide | Code **signé** avec une clé délivrée par le serveur au poste de la secrétaire ; **signature vérifiée** | `src/lib/qr-codes.js` (HMAC-SHA256) |
| **Rejeu d'un pointage** | Le même scan est renvoyé plusieurs fois, ou un autre jour | Un code ne sert **qu'une fois par enseignant** ; identifiant unique par pointage | `src/server/ops.js` (table `usedTokens`) |
| **Code de séance deviné** | Les 6 caractères sont testés en boucle | **5 essais, puis blocage** ; code tiré avec un **aléa cryptographique** ; expiration avec la séance | `src/server/ratelimit.js`, `src/lib/crypto.js` |
| **Code de séance partagé** | Un collègue valide le relevé à la place de l'enseignant | Code accepté **uniquement depuis le compte de l'enseignant de la séance** | `src/server/ops.js` |
| **Horloge du téléphone modifiée** | L'enseignant ou l'étudiant change l'heure pour entrer dans une fenêtre | Les heures payées viennent du **secrétariat**. Le serveur note l'**heure de réception** et signale les écarts | `src/server/ops.js` (`receivedAt`) |
| **Départ saisi après coup de façon abusive** | La secrétaire allonge les heures d'un enseignant | **Motif obligatoire**, historique, **alerte à l'administration**, délai maximal de correction | `src/server/ops.js` |
| **Séance fictive** | Arrivée et départ pointés sans cours réel | Séance comptée **seulement avec un relevé validé** ; nombre de présents visible par l'administration | `src/server/rules.js` |
| **Relevé de complaisance** | L'enseignant coche toute la classe sans faire l'appel | **Écarts signalés** entre scans, personnes comptées et liste cochée ; statistiques par enseignant | `src/server/rules.js`, écran *Anomalies* |
| **Scan à distance** | Un présent envoie la photo du code QR de présence à un absent | **Risque accepté dans cette version** ; limité par le compteur, la fenêtre de scan et le droit de décocher | — (documenté) |
| **Scan forgé sans code** | Un étudiant appelle directement le serveur avec l'identifiant de la séance | Le code QR de présence contient un **jeton aléatoire secret** ; un scan sans ce jeton est refusé | `src/lib/qr-codes.js`, `src/server/ops.js` |
| **Scan pour un camarade** | Deux comptes scannent depuis le même téléphone | **Identifiant d'appareil** joint au scan ; deux comptes sur un même appareil pour une séance sont **signalés** | `src/lib/device.js`, `src/server/rules.js` |
| **Double scan ou double pointage** | Deux requêtes simultanées créent deux présences ou deux séances | **Contraintes d'unicité** en base ; opérations dans une **transaction** | `src/server/ops.js` (clé `[sessionId+studentId]`) |
| **Durées impossibles** | Départ avant l'arrivée, séance de 30 heures, séance à cheval sur deux jours | **Contrôles de cohérence** côté serveur ; heures stockées en **UTC** | `src/server/rules.js` |
| **Justificatif falsifié** | Un faux document est envoyé comme preuve | **Décision humaine** du chef de département ; pièce conservée et historisée | `src/server/ops.js` |
| **Taux modifié rétroactivement** | Un taux est changé pour gonfler des séances passées | **Date d'effet obligatoire** ; coût des séances passées **figé** ; historique | `src/server/rates.js` |
| **Décision sans trace** | Un chef de département justifie les absences d'un proche | Chaque décision **historisée** et consultable par l'administration | `src/server/audit.js` |

---

## 13.5 Hors ligne, stockage local et synchronisation

> **IndexedDB est modifiable par son propriétaire.** Tout ce qui en sort est une saisie, pas une vérité.

| Faille | Comment elle se produit ici | Mesure exigée | Où |
| --- | --- | --- | --- |
| **Données locales modifiées** | L'utilisateur modifie IndexedDB avec les outils du navigateur (présences, heures, file d'attente) | Tout ce qui vient de l'appareil est **revérifié par le serveur** comme une saisie non fiable | `src/server/guard.js` |
| **File d'attente falsifiée** | Des actions inventées sont ajoutées à la file | **Mêmes contrôles** de droits et de cohérence à la synchronisation qu'en ligne | `src/server/index.js` |
| **Rejeu de synchronisation** | La même action est renvoyée pour être comptée deux fois | **Identifiant unique par action** ; doublon ignoré | `src/server/index.js` (table `processed`) |
| **Identifiant d'action usurpé** | Un client réutilise l'identifiant d'action d'un autre pour bloquer sa synchronisation | Unicité vérifiée par **couple utilisateur + identifiant** | `src/server/index.js` |
| **Heure locale antidatée** | Une action hors ligne porte une heure fausse | **Heure de réception** enregistrée ; action plus ancienne que le délai autorisé **refusée** | `src/server/ops.js` |
| **Données sensibles sur l'appareil** | Listes, numéros des parents ou taux présents sur un téléphone perdu | Stocker **le strict nécessaire au rôle** ; jamais de taux ni de numéros de parents sur le téléphone d'un enseignant ou d'un étudiant | `src/server/projection.js` |
| **Données restées après déconnexion** | Le compte suivant sur le même téléphone voit les données du précédent | IndexedDB et caches **effacés à la déconnexion** ; données séparées par utilisateur | `src/lib/session.js` |
| **Cache du service worker** | Des réponses privées sont mises en cache et servies à un autre utilisateur | Seuls les **fichiers de l'application** sont mis en cache, **jamais les réponses privées** | `vite.config.js` |
| **Ancienne version bloquée** | Le service worker garde une version vulnérable de l'application | **Mise à jour automatique** ; version minimale imposée par le serveur | `vite.config.js` (`registerType: autoUpdate`) |
| **Service worker détourné** | Un script tiers enregistre son propre service worker | Service worker servi par **le domaine de l'application uniquement** ; aucun script tiers | `infra` |
| **Conflit qui écrase une décision** | Une synchronisation tardive remplace une correction du chef de département | **Règles de priorité du §9** appliquées par le serveur | `src/server/rules.js` |
| **Perte de données en attente** | La file est vidée avant confirmation | Suppression locale **seulement après accusé de réception** du serveur | `src/lib/sync.js` |

---

## 13.6 API et serveur

| Faille | Comment elle se produit ici | Mesure exigée | Où |
| --- | --- | --- | --- |
| **Entrées non validées** | Types, longueurs ou formats inattendus | **Validation par schéma** sur chaque route : type, longueur, format, valeurs autorisées | `src/server/schema.js` |
| **Absence de limite de débit** | Rafales de requêtes sur la connexion, le scan, la synchronisation ou le code de séance | **Limites par utilisateur et par adresse IP** sur toutes les routes sensibles | `src/server/ratelimit.js` |
| **Déni de service par volume** | Corps de requête géant, import énorme, liste sans pagination | **Taille maximale** des requêtes et des fichiers ; **pagination obligatoire** | `serveur/`, `src/lib/tabular.js` |
| **Erreurs trop bavardes** | Trace d'erreur, requête SQL ou version du serveur renvoyées au client | **Message générique** au client ; détail dans les journaux seulement | `src/server/errors.js` |
| **Erreur mal gérée** | Une exception laisse une opération à moitié faite (séance sans code, heure comptée deux fois) | **Transactions** ; en cas d'erreur, tout est annulé et l'accès est **refusé par défaut** | `src/server/index.js` |
| **CORS trop ouvert** | `Access-Control-Allow-Origin: *` avec identifiants | **Seule l'origine de l'application** est autorisée | `infra` |
| **HTTPS absent ou partiel** | Mot de passe ou jeton en clair sur le réseau de l'école | **HTTPS partout**, redirection HTTP → HTTPS, en-tête **HSTS** | `infra` |
| **En-têtes de sécurité manquants** | Pas de politique de contenu, page intégrable dans un cadre | `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`, `Referrer-Policy` | `infra`, `public/_headers` |
| **Redirection ouverte** | Un paramètre de retour après connexion renvoie vers un site piégé | **Redirections internes uniquement**, vers des chemins connus | `src/lib/safe-redirect.js` |
| **Requête forgée côté serveur (SSRF)** | Le serveur télécharge une adresse fournie par un utilisateur | **Aucune fonction** ne télécharge une URL fournie par l'utilisateur | `serveur/` |
| **Routes de test et documentation** | Routes de débogage ou documentation d'API ouvertes en production | **Désactivées en production** | `infra` |
| **Requêtes simultanées** | Deux validations en parallèle contournent une vérification | **Verrous ou contraintes** en base sur les opérations critiques | `src/server/index.js` |
| **Base de données exposée** | Port de la base ouvert sur Internet, compte tout-puissant | Base accessible **depuis le serveur seulement** ; compte applicatif aux **droits minimaux** | `infra` |

---

## 13.7 Fichiers : justificatifs, import et export

| Faille | Comment elle se produit ici | Mesure exigée | Où |
| --- | --- | --- | --- |
| **Fichier dangereux en justificatif** | Un fichier HTML, SVG ou exécutable est déposé comme « photo » | Types autorisés : **JPEG, PNG, PDF**. Type vérifié **sur le contenu** (nombre magique), pas sur l'extension | `src/lib/files.js` |
| **Fichier trop lourd** | Des dépôts répétés remplissent le disque | **Taille maximale 5 Mo** ; nombre de dépôts limité par étudiant | `src/lib/files.js` |
| **Justificatif accessible à tous** | Fichier rangé dans un dossier public avec une adresse devinable | **Stockage privé** ; téléchargement par une route qui vérifie les droits | `serveur/` |
| **Fichier exécuté par le navigateur** | Le justificatif s'ouvre dans le domaine de l'application et lance un script | Servi avec **`Content-Disposition: attachment`** et `nosniff` | `serveur/` |
| **Métadonnées des photos** | La photo d'un justificatif contient la position GPS | **Métadonnées EXIF supprimées** à la réception | `src/lib/files.js` (ré-encodage canvas) |
| **Nom de fichier piégé** | Nom contenant un chemin ou des caractères spéciaux | Fichier **renommé avec un identifiant aléatoire** | `src/lib/files.js` |
| **Import malveillant** | CSV ou Excel avec formules, macros, milliers de lignes ou encodage cassé | **`.csv` et `.xlsx` seulement**, sans macro ; **limite de lignes** ; chaque cellule validée | `src/lib/tabular.js` |
| **Import qui écrase des comptes** | Un matricule en double remplace un étudiant existant ou change un rôle | **Aperçu avant validation** ; l'import ne crée **que des étudiants** ; doublons signalés, **jamais écrasés en silence** | `src/server/ops.js`, écran *Référentiel* |
| **Export trop large** | L'export contient des données hors du périmètre du rôle | Export **réservé à l'administration**, filtré côté serveur, **journalisé** | `src/server/projection.js` |

---

## 13.8 Interface React et navigateur

| Faille | Comment elle se produit ici | Mesure exigée | Où |
| --- | --- | --- | --- |
| **`dangerouslySetInnerHTML`** | Du HTML venant de la base est injecté dans la page | **Interdit dans tout le projet** | `src/` — vérifié par `npm run verif` |
| **Lien `javascript:`** | Une adresse fournie par un utilisateur est placée dans un `href` | Aucun lien construit à partir d'une saisie libre ; **schéma `https` uniquement** | `src/lib/whatsapp.js`, `src/lib/safe-redirect.js` |
| **`eval` et code dynamique** | Du texte est exécuté comme du code | Interdits ; politique de contenu **sans `unsafe-eval` ni `unsafe-inline`** | `src/`, `infra` |
| **Secrets dans le code de l'application** | Clé ou mot de passe placé dans une variable `VITE_` | Tout le code du navigateur est **public** : **aucun secret dedans** | `process` |
| **Sécurité calculée côté client** | Les heures, les coûts ou les droits sont calculés dans le navigateur | Calculs et contrôles **refaits par le serveur, qui fait foi** | `src/server/` → `serveur/` |
| **Données de trop dans les réponses** | Le serveur renvoie l'objet complet et l'interface en masque une partie | Le serveur ne renvoie **que les champs utiles au rôle** | `src/server/projection.js` |
| **Onglet détourné** | Un lien externe s'ouvre dans un nouvel onglet sans protection | **`rel="noopener noreferrer"`** sur tout lien externe, WhatsApp compris | `src/components/ui/ExternalLink.jsx` |
| **Détournement de clic** | L'application est affichée dans un cadre invisible sur un autre site | **`frame-ancestors 'none'`** | `infra`, `public/_headers` |
| **Scripts tiers** | Un script chargé depuis un autre site est compromis | **Tous les scripts sont servis par l'application elle-même** | `index.html` |
| **Fichiers de débogage** | Source maps et `console.log` de données en production | **Source maps désactivées** ; aucune donnée personnelle dans la console | `vite.config.js` |
| **Permission caméra** | La caméra reste active après le scan | Caméra demandée **sur les écrans de scan seulement**, **arrêtée à la sortie** | `src/components/qr/QrScanner.jsx` |

---

## 13.9 Notifications et lien WhatsApp

| Faille | Comment elle se produit ici | Mesure exigée | Où |
| --- | --- | --- | --- |
| **Notifications envoyées par un tiers** | La route d'envoi est appelable sans droit et sert à inonder les étudiants | **Seul le serveur envoie**, après un pointage d'arrivée valide ; **une notification par séance** | `src/server/ops.js` |
| **Abonnement détourné** | Un utilisateur enregistre son appareil sur le compte d'un autre | Abonnement **lié au compte connecté** ; supprimé à la déconnexion | `src/lib/session.js` |
| **Clé de notification exposée** | La clé privée d'envoi se trouve dans le code du navigateur | **Clé privée sur le serveur uniquement** | `process` |
| **Contenu sensible** | La notification affiche des données personnelles sur un écran verrouillé | Contenu limité à **la matière et au nom de l'enseignant** | `src/server/ops.js` |
| **Numéro de parent modifié** | Un étudiant change le numéro de son parent pour détourner l'alerte | Numéro modifiable **par l'administration seulement** ; changement historisé | `src/server/schema.js` |
| **Message d'alerte piégé** | Le modèle de message contient un lien frauduleux | Modèle modifiable **par l'administration seulement** ; changement historisé | `src/server/ops.js` |
| **Alerte envoyée au mauvais parent** | Le lien est construit avec un numéro envoyé par le navigateur | Lien construit avec le numéro **lu en base** pour l'étudiant concerné | `src/lib/whatsapp.js` |

---

## 13.10 Données personnelles

| Faille | Comment elle se produit ici | Mesure exigée | Où |
| --- | --- | --- | --- |
| **Collecte excessive** | L'application stocke plus que nécessaire | **Seules les données du §3** sont collectées | `src/lib/db.js` |
| **Numéros des parents exposés** | Ils sont visibles par les enseignants ou les étudiants | Visibles par **l'administration et le chef de département seulement** | `src/server/projection.js` |
| **Liste de classe exposée** | Un étudiant récupère les noms et matricules de sa classe | Un étudiant ne reçoit **que ses propres données** | `src/server/projection.js` |
| **Justificatifs médicaux** | Des documents de santé sont lisibles par trop de rôles | Lisibles par **l'étudiant concerné, son chef de département et l'administration** | `src/server/guard.js` |
| **Données dans les journaux** | Mots de passe, jetons, codes de séance ou numéros écrits dans les journaux | **Aucun secret ni donnée personnelle complète** dans les journaux | `src/server/audit.js` |
| **Sauvegardes non protégées** | Copie de la base en clair sur un disque ou un service public | Sauvegardes **chiffrées**, accès restreint, **restauration testée** | `infra` |
| **Conservation sans fin** | Anciens étudiants et justificatifs gardés indéfiniment | Durée de conservation fixée par l'établissement ; comptes sortants **désactivés** | `process` |
| **Vraies données en développement** | Données réelles copiées sur un poste de développement | **Données fictives** pour le développement et les tests | `src/lib/seed.js` |

---

## 13.11 Secrets, configuration et dépendances

| Faille | Comment elle se produit ici | Mesure exigée | Où |
| --- | --- | --- | --- |
| **Secrets dans le dépôt** | Fichier `.env`, mot de passe de base ou clé enregistrés dans Git | Secrets en **variables d'environnement** ; `.env` **ignoré par Git** ; tout secret divulgué est **changé** | `.gitignore`, `process` |
| **Configuration par défaut** | Mots de passe par défaut de la base ou du serveur | **Tous les identifiants par défaut changés** avant la mise en ligne | `infra` |
| **Mode débogage en production** | Détails d'erreur et outils de développement actifs | **Mode production strict** | `vite.config.js`, `infra` |
| **Dépendances vulnérables** | Un paquet npm a une faille connue | **`npm audit` avant chaque mise en ligne** ; versions figées par le fichier de verrouillage | `process` |
| **Paquet malveillant** | Faute de frappe dans un nom de paquet, paquet inconnu | Dépendances **peu nombreuses, connues et maintenues** | `package.json` |
| **Droits trop larges** | Le compte de la base peut tout supprimer | **Droits minimaux** pour le compte de l'application | `infra` |
| **Aléa et chiffrement faibles** | Codes et jetons tirés avec `Math.random`, algorithmes anciens ou faits maison | **Aléa cryptographique** (`crypto.getRandomValues`) pour codes et jetons ; bibliothèques reconnues | `src/lib/crypto.js` |
| **Serveur non mis à jour** | Système ou moteur de base avec des failles connues | Mises à jour de sécurité **appliquées régulièrement** | `infra` |

---

## 13.12 Journalisation et surveillance

| Faille | Comment elle se produit ici | Mesure exigée | Où |
| --- | --- | --- | --- |
| **Actions sensibles non tracées** | Impossible de savoir qui a changé une heure, un relevé ou un taux | **Historique du §11** pour toute modification | `src/server/audit.js` |
| **Historique modifiable** | Un administrateur efface ses propres traces | Historique **en ajout seul** ; aucune route de modification ni de suppression | `src/server/audit.js` |
| **Attaques non détectées** | Des essais en rafale sur la connexion ou le code de séance passent inaperçus | Échecs de connexion, codes faux et refus d'accès **journalisés** ; **alerte au-delà d'un seuil** | `src/server/ratelimit.js` |
| **Anomalies non signalées** | Corrections fréquentes par une même secrétaire, écarts répétés chez un enseignant | **Liste des anomalies** visible par l'administration | écran *Anomalies* |
| **Journaux perdus** | Les journaux sont sur le même serveur et disparaissent avec lui | Journaux conservés **à part**, pendant une durée définie | `infra` |

---

## 13.13 Vérifications avant mise en ligne

Chaque test doit réussir avant que l'application soit ouverte aux utilisateurs.

- [ ] Aucune requête SQL n'est construite par concaténation de texte.
- [ ] Chaque route a été testée avec **chacun des cinq rôles, et sans session**.
- [ ] Changer un identifiant dans une requête ne donne **jamais** accès aux données d'un autre.
- [ ] Les champs `role`, `taux` et `état de séance` sont **refusés** dans les requêtes des rôles non autorisés.
- [ ] Un compte étudiant, enseignant, secrétaire ou chef de département ne reçoit **aucun taux ni montant**.
- [ ] Le texte `<script>alert(1)</script>` saisi dans chaque champ s'affiche **comme du texte**.
- [ ] Une cellule `=1+1` importée ressort **neutralisée** dans l'export.
- [ ] La connexion et le code de séance se **bloquent** après plusieurs essais faux.
- [ ] Un code QR de pointage **expiré, modifié ou rejoué** est refusé.
- [ ] Un scan envoyé **sans le jeton secret** de la séance est refusé.
- [ ] Une file d'attente modifiée à la main ne fait passer **aucune action interdite**.
- [ ] Un fichier `.html` ou `.svg` renommé en `.jpg` est **refusé**.
- [ ] Un justificatif n'est accessible **ni sans session, ni par un autre étudiant**.
- [ ] Après déconnexion, **aucune donnée** ne reste sur l'appareil.
- [ ] Le code de l'application ne contient **aucun secret**.
- [ ] `npm audit` ne signale **aucune faille élevée ou critique**.
- [ ] Le site répond en **HTTPS uniquement**, avec les en-têtes de sécurité.
- [ ] **Aucun compte ni mot de passe par défaut** n'existe.
- [ ] Chaque modification sensible apparaît dans l'historique, et **l'historique ne peut pas être modifié**.

---

## Annexe A — Où la sécurité vit dans ce dépôt

Le serveur de production n'existe pas encore (§14 : Node + PostgreSQL ou Supabase). Pour que la frontière de confiance soit **écrite dès maintenant** et non ajoutée après coup, l'application contient un module `src/server/` qui joue le rôle du serveur : il reçoit des opérations, les **revalide intégralement** et n'expose que des projections filtrées par rôle. Le reste de `src/` ne peut pas écrire dans la base directement.

```
src/
  server/            ← FRONTIÈRE DE CONFIANCE. Tout passe par ici.
    index.js         file d'attente, idempotence, transactions
    guard.js         session, rôle, périmètre, propriété de l'objet (§13.3)
    schema.js        validation stricte, liste blanche de champs (§13.1, §13.6)
    ops.js           règles métier revérifiées (§13.4)
    rules.js         état des séances, heures, écarts (§13.4)
    rates.js         taux et coûts — jamais exposés hors administration (§13.3)
    projection.js    ce que chaque rôle reçoit, champ par champ (§13.8, §13.10)
    ratelimit.js     essais de connexion et de code de séance (§13.2, §13.4)
    audit.js         historique en ajout seul (§13.12)
    errors.js        messages génériques au client (§13.6)
    reporting.js     heures, absences, coûts, alertes — calculs de lecture
    settings.js      paramètres ; aucune valeur par défaut inventée (§14)
    install.js       premier administrateur, jeu de données fictives (§13.2)
    maintenance.js   recalcul des états, séances sans taux (§13.3)
    db.js            base du serveur ; historique en ajout seul
  lib/
    crypto.js        aléa cryptographique, HMAC, PBKDF2 (§13.11)
    qr-codes.js      jetons de pointage signés et tournants (§13.4)
    device.js        identifiant d'appareil (§13.4)
    session.js       durée hors ligne, effacement à la déconnexion (§13.2, §13.5)
    tabular.js       CSV/Excel : formules neutralisées (§13.1, §13.7)
    files.js         justificatifs : type réel, taille, EXIF (§13.7)
    whatsapp.js      lien wa.me construit depuis la base (§13.9)
    safe-redirect.js redirections internes uniquement (§13.6)
```

**Ce que le module `src/server/` ne remplace pas.** Il démontre et verrouille les règles, mais il tourne dans le navigateur : un utilisateur déterminé peut le contourner sur son propre appareil. Les mêmes contrôles doivent être **portés tels quels** dans l'API avant toute mise en ligne. Les tableaux ci-dessus marquent `serveur/` partout où le navigateur ne peut rien garantir — notamment les paragraphes [13.1](#131-injections) (SQL), [13.2](#132-authentification-et-sessions) (jetons, hachage) et [13.6](#136-api-et-serveur) (en-têtes, CORS, HTTPS).

## Annexe B — Risques acceptés dans cette version

| Risque | Pourquoi il est accepté | Ce qui le limite |
| --- | --- | --- |
| **Scan à distance** : un présent envoie la photo du code QR de présence à un absent | Le code QR de présence est fixe pendant la séance, par choix (§5) | Fenêtre de scan ouverte et fermée par l'enseignant, compteur de présents, droit de décocher, écart signalé |
| **Deux comptes sur un même téléphone** | Impossible à empêcher sans matériel dédié | Identifiant d'appareil joint au scan, cas signalé à l'administration |
| **Justificatif falsifié** | Aucune vérification automatique n'est fiable | Décision humaine du chef de département, pièce conservée et historisée |
