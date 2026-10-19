# ISTC SmartPresence

> *Chaque présence compte.*

Application web installable de suivi des présences.

Enregistre la présence des enseignants et des étudiants à chaque cours, sur téléphone, avec ou sans connexion. Elle en tire les heures d'absence des étudiants, les heures effectuées par les enseignants et le coût des heures d'enseignement.

**Documents de référence** — [cahier-de-charge.md](cahier-de-charge.md) · [securité.md](securité.md)

---

## Démarrer

```bash
npm install
npm run dev        # http://localhost:5173
```

Au premier lancement, l'application affiche un écran **Installation**. Il n'existe aucun compte par défaut ([§13.2](securité.md#132-authentification-et-sessions)) : vous créez le premier administrateur et choisissez son mot de passe. Cochez « Charger un établissement fictif » pour obtenir des filières, des classes, des enseignants, 30 étudiants et une quinzaine de séances passées — tout est inventé.

| Commande | Effet |
| --- | --- |
| `npm run dev` | Serveur de développement, service worker actif |
| `npm run build` | Build de production dans `dist/` |
| `npm run preview` | Sert `dist/` sur le réseau local, pour tester sur un vrai téléphone |
| `npm test` | 49 tests des règles de calcul et des protections |
| `npm run verif` | 9 contrôles de sécurité sur le code source |
| `npm run icones` | Régénère le favicon et les icônes PWA depuis le logo |
| `npm run audit` | `npm audit` sur les dépendances de production |

### Tester sur un téléphone

La caméra et le mode hors ligne exigent **HTTPS** (ou `localhost`). Pour un test sur téléphone depuis votre poste :

```bash
npm run build && npm run preview   # affiche une adresse http://192.168.x.x:4173
```

`http://192.168.x.x` suffit pour la navigation mais **pas pour la caméra**. Pour scanner depuis un téléphone, passez par un tunnel HTTPS (`npx localtunnel --port 4173`, `cloudflared tunnel`, `ngrok`) ou déployez.

---

## Ce qui est livré

| Rôle | Écrans |
| --- | --- |
| Étudiant | Accueil · Scanner · Mes séances |
| Enseignant | Pointage · Séance en cours · Relevé · Mes heures |
| Secrétaire | Pointage · Séances du jour |
| Chef de département | Justifications · Présences · Étudiants en alerte |
| Administration | Tableau de bord · Heures et coûts · Référentiel · Taux horaires · Étudiants en alerte · Paramètres · Historique |

Les 19 écrans du [§10](cahier-de-charge.md#10-écrans-par-rôle) sont présents, en français, pensés pour le téléphone d'abord.

### Responsive

Trois dispositions, une seule coquille :

| Largeur | Disposition |
| --- | --- |
| **< 768 px** | Barre de navigation en bas, en-tête compact, tableaux transformés en fiches empilées, modales en feuille qui monte du bas |
| **768 – 1279 px** | Rail d'icônes à gauche, pleine largeur pour le contenu |
| **≥ 1280 px** | Barre latérale complète avec libellés, tableaux à colonnes, jusqu'à 7 colonnes de détail |

Points traités explicitement : champs de saisie à 16 px sur téléphone (en dessous, iOS zoome au focus et ne revient jamais), cibles tactiles de 44 px minimum, aucun débordement horizontal possible, marges qui tiennent compte de l'encoche (`env(safe-area-inset-*)`), bandes d'onglets défilantes, titres fluides en `clamp()`, et `prefers-reduced-motion` respecté.

---

## Identité visuelle

Le logo — le livre ouvert, les trois étudiants, la toque, le téléphone et sa coche — est la source unique de toute l'identité :

| Où | Quoi |
| --- | --- |
| **Écran de lancement** | Le logo s'assemble pièce par pièce, puis le nom et le slogan apparaissent. Environ 3 s, passables d'un appui. |
| **Barre latérale et en-tête** | La pastille carrée, avec le nom aux couleurs de la marque |
| **Connexion** | La marque complète : logo, nom, slogan |
| **Favicon et icônes PWA** | Produits depuis le même tracé, par `npm run icones` |

Les composants sont dans [src/components/app/Logo.jsx](src/components/app/Logo.jsx) — `LogoMark` (la pastille), `LogoNom` (le nom coloré) et `Marque` (l'ensemble) — et [src/components/app/SplashScreen.jsx](src/components/app/SplashScreen.jsx) pour l'animation. Les icônes se régénèrent avec [scripts/generer-icones.mjs](scripts/generer-icones.mjs), qui encode les PNG sans aucune bibliothèque graphique.

L'écran de lancement **ne retarde pas l'application** : il se superpose pendant que React monte et que la session se rétablit. Sous `prefers-reduced-motion`, le logo s'affiche d'un coup et l'écran se retire en 0,9 s. Un appui, un clic ou une touche le passe à tout moment.

---

## Architecture

```
src/
  server/            ← FRONTIÈRE DE CONFIANCE : tout passe par ici
  lib/               ← outils du client (crypto, QR, CSV, fichiers, synchro)
  components/        ← système de composants + caméra et codes QR
  routes/            ← les 19 écrans, un dossier par rôle
  app/               ← routage et navigation
tests/               ← tests des règles de calcul et des protections
```

### La frontière de confiance

Le serveur de production (Node + PostgreSQL, ou Supabase) n'est pas encore écrit : c'est le [§14](cahier-de-charge.md#14-points-à-confirmer) qui doit le trancher. Pour que la séparation soit **écrite dès maintenant** et non bricolée après coup, le module `src/server/` joue le rôle du serveur :

- il reçoit des **opérations** et les revalide intégralement — session, rôle, périmètre, schéma, cohérence des heures, idempotence ;
- il ne renvoie que des **projections filtrées par rôle** : un enseignant ne reçoit ni taux, ni montant, ni numéro de parent ;
- il écrit dans sa propre base IndexedDB (`presences_serveur`), à laquelle aucun écran n'a accès.

L'appareil, lui, a sa base (`presences_appareil`) qui ne contient que trois choses : le jeton de session, la file d'attente et les projections reçues.

```
  écran  ──► enqueue(type, payload) ──► serveur.soumettre()
                     │                        │ guard  : session, rôle, périmètre
                     │                        │ schema : liste blanche de champs
                     │                        │ ops    : règles métier + historique
                     ▼                        ▼
            file d'attente locale      base « serveur »
                     │                        │
                     └──── synchroniser() ◄── projection filtrée par rôle
```

**Ce module ne remplace pas un vrai serveur.** Il tourne dans le navigateur : un utilisateur déterminé peut le contourner sur son propre appareil. Les mêmes contrôles doivent être **portés tels quels** dans l'API avant la mise en ligne. L'annexe A de [securité.md](securité.md) indique, faille par faille, ce qui relève de `serveur/`, de `src/`, de l'hébergement ou de l'organisation.

### Hors ligne et synchronisation

Chaque action faite hors ligne est rangée dans une file d'attente avec un **identifiant unique**. Au retour du réseau, elle part ; le serveur ignore les rejeux grâce au couple `(utilisateur, identifiant)`. Rien n'est effacé localement avant confirmation. Un indicateur permanent montre l'état du réseau et le nombre d'éléments en attente.

Pour éprouver tout cela sans couper le Wi-Fi, l'application a un **mode avion** : bouton sur l'écran de connexion, et dans le panneau de synchronisation.

---

## Les trois codes

| Code | Affiché par | Scanné / saisi par | Protection |
| --- | --- | --- | --- |
| **QR de pointage** | la secrétaire | l'enseignant | Signé HMAC-SHA256 avec la clef du poste, renouvelé toutes les 60 s, à usage unique |
| **Code de séance** (6 car.) | la secrétaire | l'enseignant | Tiré avec `crypto.getRandomValues`, accepté depuis le seul compte de l'enseignant de la séance, 5 essais puis blocage |
| **QR de présence** | l'enseignant | les étudiants | Contient un jeton secret de séance ; un scan sans ce jeton est refusé |

---

## Vérifier les critères de validation du §12

Les calculs et les protections sont couverts par `npm test` (49 tests, chacun nommé d'après son point du cahier des charges). Les critères qui demandent deux appareils ou le réseau se vérifient à la main :

<details>
<summary><strong>Scénario complet, avec un seul navigateur</strong></summary>

1. **Installer** avec le jeu de démonstration. Notez le mot de passe commun.
2. **Secrétaire** (`237699000200`) → *Pointage* → « Pointer l'arrivée » sur Alain Kamdem, matière Algorithmique. Un **code de séance** s'affiche.
3. **Administration** → *Tableau de bord* : la séance apparaît aussitôt en « en cours », sans coût.
4. **Enseignant** (`237699000301`, autre navigateur ou fenêtre privée) → *Séance en cours* → « Afficher le code de présence ».
5. **Étudiant** (`INF1001`) → *Scanner*. Sans deuxième téléphone, affichez le QR sur un écran et scannez-le avec la webcam.
6. Passez l'étudiant en **mode avion** avant de scanner : il voit « en attente ». Quittez le mode avion → il passe « présent ».
7. **Enseignant** → cochez la liste, saisissez un **code faux** : le relevé est conservé, la séance reste « incomplète ». Corrigez le code : elle se valide.
8. **Secrétaire** → « Pointer le départ ». La séance passe « terminée » et entre dans les heures.
9. **Enseignant** → *Mes heures* : arrivée, départ, heure du relevé, heures payées et écart non payé.
10. **Administration** → *Heures et coûts* : le coût apparaît, au taux en vigueur à la date de la séance.

</details>

| Critère du §12 | Où le vérifier |
| --- | --- |
| Photo du code de pointage refusée 5 min plus tard | `npm test` + à la main : photographiez le QR du secrétariat, attendez, scannez |
| Code de séance faux → séance incomplète | étape 7 ci-dessus |
| 10 h → 16 h, relevé 17 h = 6 h payées | `npm test` |
| Mode avion : relevé rattaché une seule fois | étapes 6–7, puis panneau de synchronisation |
| Étudiant d'une autre classe refusé | connectez-vous en `GES1001` et scannez un QR d'Informatique |
| Enseignant décoche un scanneur → absent | étape 7, décochez puis validez |
| 30 comptés / 33 scans → écart signalé | mode avion, saisissez 30 dans « personnes comptées » |
| 2X + 2Y pour deux niveaux | `npm test` |
| Taux modifié aujourd'hui sans effet sur hier | `npm test` + écran *Taux horaires* |
| Aucun taux chez l'enseignant, même côté serveur | outils du navigateur → IndexedDB → `presences_appareil` → `projection` |
| Alerte parent ouvre WhatsApp pré-rempli | *Étudiants en alerte*, après avoir fixé un seuil dans *Paramètres* |
| Chaque modification dans l'historique | *Administration → Historique* |

---

## Décisions prises, et pourquoi

Trois points méritent d'être validés par le client, car ils s'écartent de la lecture la plus simple du cahier des charges.

**1. Le scan de pointage par l'enseignant exige le réseau.**
Le [§4](cahier-de-charge.md#4-séance-de-cours-et-pointage-de-lenseignant) demande que le code change toutes les 60 secondes, et le [§13.4](securité.md#134-fraude-sur-le-pointage-et-les-présences) que la photo d'un code soit refusée. Cette fenêtre ne peut être vérifiée que contre l'heure du serveur : un scan accepté hors ligne puis contrôlé à la synchronisation laisserait passer une photo prise le matin et rejouée le soir. Le [§9](cahier-de-charge.md#9-hors-ligne-et-synchronisation) prévoit déjà la solution quand le téléphone de l'enseignant ne répond pas : **la secrétaire pointe elle-même**, et ce chemin-là fonctionne hors ligne. L'écran de pointage le dit explicitement quand il n'y a pas de réseau.

**2. L'import Excel (.xlsx) est renvoyé au serveur.**
Le [§3](cahier-de-charge.md#3-données-de-référence) accepte CSV ou Excel. Un `.xlsx` est une archive XML : le [§13.1](securité.md#131-injections) exige de la contrôler contre les entités externes et les bombes de décompression, ce qui n'a pas sa place dans le navigateur. L'import **CSV est complet** (aperçu avant validation, formules neutralisées, doublons signalés et jamais écrasés) ; le `.xlsx` affiche un message qui renvoie à l'import serveur.

**3. L'écart non payé suit la lettre du §4.**
Le [§14](cahier-de-charge.md#14-points-à-confirmer) note que l'exemple du client (30 minutes) ne permet pas de fixer la règle. L'application applique donc ce que dit le §4 : **heures payées = départ − arrivée**, et affiche séparément l'écart entre le départ pointé et la validation du relevé. Si une autre règle est voulue, elle tient dans `unpaidGapHours()` de `src/server/rules.js`.

### Valeurs volontairement absentes

Le seuil d'alerte et les dates de semestre n'ont **aucune valeur par défaut**, comme demandé au §14. Tant qu'ils ne sont pas saisis dans *Paramètres*, les écrans le disent au lieu d'inventer un chiffre : la liste d'alerte reste vide et les absences sont totalisées sur l'année.

---

## Avant la mise en ligne

La liste complète est au [§13.13](securité.md#1313-vérifications-avant-mise-en-ligne). Les points qui ne dépendent pas du code livré ici :

1. **Écrire l'API** en portant les contrôles de `src/server/` (requêtes paramétrées, hachage Argon2id, cookie de session HttpOnly + SameSite, jeton anti-CSRF, limites de débit, RLS si Supabase).
2. **Servir en HTTPS**, avec les en-têtes de [`public/_headers`](public/_headers). Pour Nginx, reporter les mêmes valeurs :
   ```nginx
   add_header Content-Security-Policy "default-src 'self'; script-src 'self'; …" always;
   add_header X-Content-Type-Options nosniff always;
   add_header Referrer-Policy strict-origin-when-cross-origin always;
   add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
   ```
3. **Ne pas charger le jeu de démonstration** en production : c'est une case à cocher de l'écran d'installation.
4. **`npm run audit`** : aucune faille élevée ou critique.
5. **Vérifier** qu'aucun secret n'est préfixé `VITE_` — tout ce qui l'est part dans le navigateur.

---

## Pile technique

React 18 (Vite) · Tailwind CSS v4 · IndexedDB via Dexie · `vite-plugin-pwa` (manifeste + service worker, mise à jour automatique) · `qrcode` pour la génération, `jsQR` pour la lecture caméra · WebCrypto pour l'aléa, les signatures HMAC et le hachage.

Le bundle initial fait 144 ko compressés. Les écrans sont chargés à la demande, par rôle : un étudiant ne télécharge ni les écrans d'administration, ni la bibliothèque de lecture de codes QR tant qu'il n'ouvre pas le scanner.
