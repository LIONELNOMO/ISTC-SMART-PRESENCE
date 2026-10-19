# Cahier des charges — Application de suivi des présences

> **Version** 1.0 · **Date** 9 octobre 2026 · **Demandeur** @Pascale MINYA
> **Pile technique retenue** React (Vite) + Tailwind CSS · PWA hors ligne · IndexedDB

---

## Sommaire

1. [Contexte et objectif](#1-contexte-et-objectif)
2. [Rôles et accès](#2-rôles-et-accès)
3. [Données de référence](#3-données-de-référence)
4. [Séance de cours et pointage de l'enseignant](#4-séance-de-cours-et-pointage-de-lenseignant)
5. [Relevé des présences](#5-relevé-des-présences)
6. [Absences et justification](#6-absences-et-justification)
7. [Heures et coûts](#7-heures-et-coûts)
8. [Alerte aux parents](#8-alerte-aux-parents)
9. [Hors ligne et synchronisation](#9-hors-ligne-et-synchronisation)
10. [Écrans par rôle](#10-écrans-par-rôle)
11. [Choix techniques](#11-choix-techniques)
12. [Critères de validation](#12-critères-de-validation)
13. [Sécurité](#13-sécurité)
14. [Points à confirmer](#14-points-à-confirmer)

---

## 1. Contexte et objectif

L'application enregistre la présence des enseignants et des étudiants à chaque cours, sur téléphone, avec ou sans connexion. Elle en tire trois résultats :

- les **heures d'absence** de chaque étudiant, par semestre ;
- les **heures effectuées** par chaque enseignant, par matière ;
- le **coût des heures d'enseignement** par jour, pour l'administration.

C'est une application web installable (**PWA**). Elle fonctionne hors ligne et se synchronise dès que le réseau revient. **Les salles ne sont pas gérées.**

### Hors périmètre de cette version

Emploi du temps · salles · notes · paiement des enseignants · envoi automatique de messages · mesure des retards.

---

## 2. Rôles et accès

Il y a **une seule application** et **une seule page de connexion**. Après connexion, chaque utilisateur arrive dans l'espace de son rôle.

| Rôle | Ce qu'il fait | Ce qu'il ne voit pas |
| --- | --- | --- |
| **Étudiant** | Reçoit la notification de début de cours. Scanne le code QR de présence. Consulte ses heures d'absence par semestre et par matière. Demande la justification d'une absence. | Les données des autres étudiants |
| **Enseignant** | Pointe son arrivée et son départ au secrétariat. Relève les présences et les valide avec le code de séance. Consulte ses heures par matière. | Les taux horaires et les montants |
| **Secrétaire** | Pointe l'arrivée et le départ des enseignants. Remet le code de séance. Corrige un départ oublié. | Les taux horaires et les montants |
| **Chef de département** | Accepte ou refuse les justifications d'absence des étudiants de sa filière. Suit les présences de sa filière. | Les taux horaires et les montants |
| **Administration** | Gère les comptes, les filières, les matières, les affectations et les taux. Suit les heures et les coûts. Contacte les parents. | *Rien n'est masqué* |

### Règles d'accès

- Les comptes sont créés par l'administration. **Il n'y a pas d'inscription libre.**
- Un même compte peut être enseignant **et** chef de département. Il choisit alors son espace après la connexion.
- La **première connexion** sur un appareil demande du réseau. Ensuite, la session reste ouverte hors ligne.
- Les droits sont vérifiés **par le serveur**, pas seulement par l'interface.

---

## 3. Données de référence

Toutes ces données sont créées et modifiées par l'administration.

| Donnée | Contenu |
| --- | --- |
| Année académique | Dates de début et de fin de chaque semestre |
| Filière | Nom, chef de département |
| Classe | Une filière et un niveau (ex. : Informatique, niveau 1) |
| Étudiant | Matricule, nom, prénom, classe, numéro WhatsApp du parent |
| Enseignant | Nom, prénom, téléphone |
| Secrétaire | Nom, prénom, téléphone |
| Matière | Nom, classe concernée |
| Affectation | Un enseignant et une matière |
| Taux horaire | Montant par heure, date d'effet (voir [§7](#7-heures-et-coûts)) |

### Règles

- Un enseignant peut avoir **plusieurs matières**, dans plusieurs classes et plusieurs niveaux.
- Une matière appartient à **une seule classe**. Les étudiants attendus à une séance sont donc ceux de la classe de la matière.
- La liste des étudiants et de leurs niveaux est fournie par le client. L'administration l'importe par fichier **CSV ou Excel**.
- Colonnes du fichier d'import : `matricule`, `nom`, `prénom`, `filière`, `niveau`, `numéro du parent` (format international).
- Le **semestre** d'une séance est déduit de sa date.

---

## 4. Séance de cours et pointage de l'enseignant

> Le pointage de l'enseignant passe par le secrétariat. La secrétaire enregistre son arrivée et son départ, et lui remet un code de séance. **Les heures payées viennent de cette trace, pas du téléphone de l'enseignant.**

### Déroulement

| Étape | Qui | Action | Ce que l'application enregistre |
| --- | --- | --- | --- |
| 1 | Enseignant + secrétaire | L'enseignant arrive à l'école et passe au secrétariat. Il scanne le code affiché par la secrétaire, ou la secrétaire pointe elle-même son arrivée. | Heure d'arrivée, matière, séance « en cours » |
| 2 | Application | Un code de séance est créé et remis à l'enseignant. Les étudiants de la classe sont prévenus. | Code de séance, notification envoyée |
| 3 | Enseignant | Il va en salle et donne son cours. | *Rien* |
| 4 | Enseignant | À la fin du cours, il relève les présences ([§5](#5-relevé-des-présences)). Il valide le relevé en saisissant le code de séance. | Relevé, heure du relevé |
| 5 | Enseignant + secrétaire | Il repasse au secrétariat. Il scanne le code de départ, ou la secrétaire pointe son départ. | Heure de départ, séance « terminée » |

### Trois codes à ne pas confondre

| Code | Affiché par | Utilisé par | Sert à |
| --- | --- | --- | --- |
| **Code QR de pointage** | La secrétaire | L'enseignant, qui le scanne | Enregistrer l'arrivée et le départ |
| **Code de séance** | La secrétaire et l'application de l'enseignant | L'enseignant, qui le saisit | Valider le relevé de présences |
| **Code QR de présence** | L'enseignant | Les étudiants, qui le scannent | Marquer leur présence |

### Pointage au secrétariat

Deux façons, au choix :

- **Par scan.** La secrétaire affiche le code QR de pointage sur son écran. L'enseignant le scanne avec son application. À l'arrivée, il choisit la matière qu'il vient enseigner.
- **Par la secrétaire.** Elle choisit l'enseignant et la matière dans sa liste, puis appuie sur « Pointer l'arrivée » ou « Pointer le départ ».

**Règles**

- L'heure enregistrée est toujours l'heure du moment, prise **sur le poste de la secrétaire**. Elle ne dépend pas du téléphone de l'enseignant.
- Le code QR de pointage **change toutes les 60 secondes**. Une photo du code ne peut pas servir plus tard.
- Un enseignant n'a **qu'une séance ouverte à la fois**. Pour un deuxième cours, il pointe le départ du premier puis l'arrivée du second.

### Code de séance

- Créé au pointage d'arrivée. **6 caractères**, valable uniquement pour cette séance.
- Affiché sur l'écran de la secrétaire, et dans l'application de l'enseignant s'il a scanné.
- L'enseignant doit le saisir pour valider son relevé de présences.
- Il prouve que le relevé correspond à une séance ouverte par le secrétariat.

### Notification aux étudiants

- Dès que l'arrivée est pointée, la séance passe « **en cours** ». L'administration la voit aussitôt.
- Les étudiants de la classe reçoivent : « *Le cours de [matière] va commencer. [Enseignant] est en route.* »
- Le message apparaît aussi dans l'espace de l'étudiant, pour ceux qui n'ont pas activé les notifications.
- La notification demande du réseau, au secrétariat comme chez l'étudiant.

### Heures payées

- **Heures payées = heure de départ − heure d'arrivée**, toutes deux pointées au secrétariat, à la minute près.
- L'heure du relevé **n'allonge jamais** la durée payée. Le temps en dehors de la trace du secrétariat n'est pas payé.
- *Exemple :* arrivée 10 h, départ 16 h, relevé validé 17 h → **6 heures payées**.
- Le tableau de bord de l'enseignant affiche, par séance : arrivée, départ, heure du relevé, heures payées, écart non payé.

### Séance incomplète

Une séance est comptée seulement si elle a ses **trois éléments** : arrivée pointée, relevé validé avec le code, départ pointé.

| Cas | Ce qui se passe |
| --- | --- |
| Départ non pointé | La séance reste « incomplète ». La secrétaire saisit l'heure de départ après coup, avec un **motif obligatoire**. |
| Relevé manquant | La séance reste « incomplète » jusqu'à ce que l'enseignant saisisse le relevé avec le code. |
| Code de séance faux | Le relevé est gardé mais **non validé**. L'enseignant corrige le code. |
| Téléphone de l'enseignant éteint | La secrétaire pointe l'arrivée et le départ et lui donne le code. Il fait l'appel sur papier, puis saisit le relevé plus tard avec le code. |

- Le relevé peut être saisi jusqu'à **7 jours** après le cours (délai réglable). Passé ce délai, l'enseignant s'adresse à l'administration.
- Toute heure saisie après coup par la secrétaire est gardée dans l'historique et **signalée à l'administration**.

### États d'une séance

| État | Signification | Comptée dans les heures et les coûts |
| --- | --- | --- |
| **En cours** | Arrivée pointée, enseignant encore à l'école | Non |
| **Terminée** | Arrivée, relevé validé et départ enregistrés | **Oui** |
| **Incomplète** | Il manque le départ ou le relevé validé | Non |

---

## 5. Relevé des présences

L'enseignant dispose de **deux méthodes** : le code QR et la liste à cocher. Il peut utiliser les deux dans la même séance. Dans les deux cas, il valide le relevé en saisissant le code de séance remis par la secrétaire.

### Par code QR

1. L'enseignant appuie sur « Afficher le code de présence ». Son téléphone génère un code QR propre à la séance, **sans réseau**.
2. Chaque étudiant ouvre son application et scanne le code sur le téléphone de l'enseignant.
3. Le téléphone de l'étudiant enregistre le scan : séance, étudiant, heure.
4. Avec réseau, le scan part aussitôt → « **présent** ». Sans réseau → « **en attente** », puis « présent » après synchronisation.

**Règles**

- Le code QR de présence **reste le même** pendant toute la séance. Pas de code tournant dans cette version.
- L'enseignant ouvre et ferme le relevé. Un scan fait en dehors de cette période est refusé, avec **5 minutes de tolérance** pour les écarts d'horloge.
- Un scan est accepté seulement si l'étudiant appartient à la **classe de la matière**.
- Un étudiant ne compte **qu'une fois** par séance. Les scans en double sont ignorés.

### Par liste

- L'enseignant voit la liste des étudiants de la classe et coche les présents. Cette liste fonctionne **sans réseau**.
- Il peut cocher ou décocher n'importe quel étudiant, y compris un étudiant qui a scanné.
- **La décision de l'enseignant l'emporte toujours sur le scan.**

### Compteur de scans

- L'écran affiche le nombre de présents sur l'effectif de la classe (ex. : **34 / 42**).
- Avec réseau, le compteur augmente à chaque scan.
- Sans réseau, le téléphone de l'enseignant ne reçoit pas les scans : l'enseignant saisit le **nombre de personnes comptées** dans la salle.
- À la synchronisation, l'application compare les scans au nombre saisi. **Tout écart est signalé** à l'enseignant, qui corrige la liste.

### Validation par le code de séance

1. Quand le relevé est fini, l'enseignant appuie sur « Valider le relevé ».
2. L'application lui demande le code de séance remis par la secrétaire.
3. Si le code est bon, le relevé est validé et rattaché à la séance. L'heure de validation devient l'**heure du relevé**.

**Règles**

- Un relevé se rattache toujours à une séance ouverte par le secrétariat.
- Si le téléphone de l'enseignant ne connaît pas encore la séance (pas de réseau), il choisit la matière et saisit le code.
- Sans réseau, le code est vérifié par le serveur **à la synchronisation**.
- Si le code est faux, le relevé est gardé mais non validé.

### Correction après validation

- L'enseignant peut corriger son relevé pendant **48 heures** après la validation (délai réglable).
- Passé ce délai, seul le **chef de département** peut le modifier.
- Chaque modification est gardée dans l'historique ([§11](#historique-des-modifications)).

---

## 6. Absences et justification

Un étudiant est **absent** à une séance comptée s'il fait partie de la classe et n'est pas marqué présent. Ses heures d'absence sont égales à la **durée de la séance**.

### Règles de calcul

- Les heures d'absence sont totalisées **par semestre**, avec le détail par matière.
- Seules les séances « **terminées** » produisent des absences.
- Un étudiant est **soit présent, soit absent**. Les retards ne sont pas mesurés.

### Justification

Seul le **chef de département** de la filière décide si une absence est justifiée.

1. L'étudiant ouvre l'absence dans son espace et envoie une demande : motif et photo du justificatif (facultative).
2. Le chef de département voit la demande dans « Justifications à traiter ».
3. Il l'accepte ou la refuse, avec un commentaire facultatif.
4. L'étudiant voit la décision dans son espace.

Le chef de département peut aussi **justifier une absence directement**, sans demande de l'étudiant.

| État de l'absence | Comptée dans le total | Comptée pour l'alerte aux parents |
| --- | --- | --- |
| Non justifiée | Oui | **Oui** |
| Justification en attente | Oui | **Oui** |
| Justifiée | Oui, *dans une ligne séparée* | Non |

### Tableau de bord de l'étudiant

Pour le semestre en cours : heures d'absence non justifiées, heures justifiées, détail par matière, liste des séances avec leur état.

---

## 7. Heures et coûts

Les heures d'un enseignant sont calculées **par matière** à partir des heures pointées au secrétariat. Le coût est le produit de ces heures par un taux que **seule l'administration** fixe et voit.

### Heures de l'enseignant

- **Durée payée** d'une séance = heure de départ − heure d'arrivée (pointées au secrétariat, à la minute près).
- Seules les séances « terminées » sont comptées ([§4](#4-séance-de-cours-et-pointage-de-lenseignant)).
- L'enseignant voit pour chaque séance l'arrivée, le départ, l'heure du relevé et les heures payées.
- Il voit ses totaux par matière, par jour, par mois et par semestre.
- **Il ne voit jamais les taux ni les montants.**

### Taux horaires

Le taux se règle à **trois niveaux**. Quand plusieurs taux existent, **le plus précis s'applique**.

| Priorité | Taux défini pour | Exemple |
| --- | --- | --- |
| **1** (le plus précis) | Un enseignant **et** une matière | M. A en Algorithmique niveau 2 |
| **2** | Un enseignant **et** un niveau | M. A au niveau 1 |
| **3** (par défaut) | Un niveau | Tous les cours de niveau 1 |

- Un même enseignant peut avoir un taux au niveau 1 et un autre au niveau 2.
- Chaque taux a une **date d'effet**. Changer un taux ne modifie pas le coût des séances déjà faites.
- Une séance **sans aucun taux applicable** est signalée à l'administration et son coût reste vide.

### Calcul du coût

- **Coût d'une séance = durée en heures × taux applicable à la date de la séance.**
- Le montant est arrondi à l'unité monétaire.
- **Coût du jour** = somme des coûts des séances comptées ce jour-là.

### Suivi par l'administration

- Heures et coûts du jour, de la semaine et du mois.
- Détail par enseignant, par matière, par filière et par niveau.
- Séances **en cours** affichées dès le pointage d'arrivée, sans coût tant qu'elles ne sont pas terminées.
- Séances **incomplètes** affichées à part, avec ce qui leur manque.
- Heures saisies après coup par la secrétaire **signalées**.
- **Export** des heures et des coûts par période, en CSV ou Excel.

Le suivi est en temps réel quand le secrétariat est connecté : une séance apparaît dès le pointage d'arrivée. Si le secrétariat est hors ligne, elle apparaît à la synchronisation. L'écran affiche **l'heure de la dernière donnée reçue**.

---

## 8. Alerte aux parents

L'alerte est un bouton qui ouvre WhatsApp sur le numéro du parent, avec un message déjà rédigé. **L'envoi reste manuel** : il n'y a ni API WhatsApp ni envoi automatique.

- L'administration fixe un **seuil d'heures d'absence non justifiées**. Un étudiant qui le dépasse entre dans la liste « Étudiants en alerte ».
- La liste affiche : nom, classe, heures d'absence, numéro du parent, date du dernier contact.
- Le bouton « Contacter le parent » ouvre `https://wa.me/<numéro>?text=<message>`.
- Le **modèle de message** est modifiable par l'administration. Il reprend automatiquement le nom de l'étudiant, ses heures d'absence et la période.
- L'application enregistre la **date et l'auteur de chaque clic**. Elle ne peut pas savoir si le message a été réellement envoyé.
- La liste et le bouton sont accessibles à l'administration et au chef de département (pour sa filière).

---

## 9. Hors ligne et synchronisation

Le pointage au secrétariat et tout ce qui se passe en salle de cours fonctionnent **sans réseau**. Les notifications, les décisions et les réglages demandent une connexion.

| Action | Sans réseau |
| --- | --- |
| Première connexion sur un appareil | ❌ |
| Pointer l'arrivée et le départ au secrétariat | ✅ |
| Notification « le professeur est en route » | ❌ |
| Afficher le code QR de présence | ✅ |
| Scanner le code QR de présence | ✅ |
| Cocher la liste des présents | ✅ |
| Valider le relevé avec le code de séance | ✅ *(code vérifié à la synchronisation)* |
| Consulter son tableau de bord | ✅ *(dernières données reçues)* |
| Compteur de scans en direct | ❌ |
| Justifier une absence | ❌ |
| Tableau de bord et réglages de l'administration | ❌ |

### Règles de synchronisation

- Chaque action faite hors ligne est gardée sur l'appareil dans une **file d'attente**, avec un identifiant unique et son heure.
- L'envoi démarre automatiquement au retour du réseau. Un bouton « Synchroniser » permet aussi de le lancer à la main.
- Un **indicateur toujours visible** montre l'état (en ligne / hors ligne) et le nombre d'éléments en attente.
- Une action envoyée deux fois n'est enregistrée **qu'une fois**, grâce à son identifiant (idempotence).
- Une donnée en attente n'est effacée de l'appareil **qu'après confirmation du serveur**.
- Si le scan d'un étudiant arrive **avant** la séance de l'enseignant, le serveur le garde en attente jusqu'à l'arrivée de la séance.
- Les matières de l'enseignant et les listes d'étudiants sont téléchargées à la connexion, puis mises à jour à chaque synchronisation.

### Résolution des conflits

1. Les heures **pointées au secrétariat** l'emportent sur toute heure venant du téléphone de l'enseignant.
2. La décision du **chef de département** l'emporte sur le relevé de l'enseignant.
3. La **liste cochée par l'enseignant** l'emporte sur le scan de l'étudiant.
4. Entre deux modifications du même relevé, **la plus récente** l'emporte.

---

## 10. Écrans par rôle

L'interface est **en français** et conçue d'abord pour le téléphone. Les espaces du secrétariat et de l'administration doivent aussi être confortables sur ordinateur.

| Rôle | Écran | Contenu |
| --- | --- | --- |
| Étudiant | **Accueil** | Heures d'absence du semestre : non justifiées, justifiées, détail par matière ; messages de début de cours |
| Étudiant | **Scanner** | Caméra pour lire le code QR de présence, puis confirmation « présent » ou « en attente » |
| Étudiant | **Mes séances** | Liste des séances avec l'état (présent, absent, en attente) et la demande de justification |
| Enseignant | **Pointage** | Caméra pour scanner le code QR de pointage, choix de la matière, affichage du code de séance |
| Enseignant | **Séance en cours** | Code QR de présence, liste à cocher, compteur de présents, validation par le code de séance |
| Enseignant | **Relevé après le cours** | Choix de la séance ou de la matière, liste à cocher, saisie du code de séance |
| Enseignant | **Mes heures** | Par séance : arrivée, départ, heure du relevé, heures payées, écart non payé ; totaux par matière et par période |
| Secrétaire | **Pointage** | Code QR de pointage à l'écran, liste des enseignants, boutons « Pointer l'arrivée » / « Pointer le départ », code de séance à remettre |
| Secrétaire | **Séances du jour** | Séances en cours, terminées et incomplètes ; saisie d'un départ oublié avec motif |
| Chef de département | **Justifications à traiter** | Demandes des étudiants de sa filière, à accepter ou refuser |
| Chef de département | **Présences de la filière** | Absences par classe et par étudiant |
| Chef de département | **Étudiants en alerte** | Liste et bouton « Contacter le parent » |
| Administration | **Tableau de bord** | Heures et coûts du jour, séances en cours, séances incomplètes |
| Administration | **Heures et coûts** | Détail par période, enseignant, matière, filière, niveau ; export |
| Administration | **Référentiel** | Comptes, import des étudiants, filières, classes, matières, affectations |
| Administration | **Taux horaires** | Taux par niveau, par enseignant et par matière, avec date d'effet |
| Administration | **Paramètres** | Semestres, seuil d'alerte, délais, modèle de message |
| Administration | **Étudiants en alerte** | Liste et bouton « Contacter le parent » |
| Administration | **Historique** | Toutes les modifications, avec auteur et date |

---

## 11. Choix techniques

L'interface est écrite en **React**, avec **Tailwind CSS** pour le style. Le serveur reste à confirmer ([§14](#14-points-à-confirmer)).

| Élément | Choix |
| --- | --- |
| Interface | React (JavaScript), projet créé avec **Vite** |
| Style | **Tailwind CSS** |
| PWA | Manifeste et service worker ; application installable sur l'écran d'accueil |
| Stockage sur l'appareil | **IndexedDB**, pour les données de référence et la file d'attente |
| Codes QR | Génération et lecture par la caméra dans le navigateur, **sans réseau** |
| Notifications | Push du navigateur, doublées d'un message dans l'application ; sur iPhone, l'application doit être installée sur l'écran d'accueil |
| Serveur et base de données | Proposition : API **Node.js + PostgreSQL**, ou **Supabase** pour aller plus vite |
| Connexion | Identifiant et mot de passe ; session gardée sur l'appareil |

### Exigences

- L'application reste fluide sur un téléphone **Android d'entrée de gamme** et une connexion lente.
- Elle est servie en **HTTPS**, condition nécessaire pour la caméra et le mode hors ligne.
- Les droits de chaque rôle sont vérifiés **par le serveur à chaque requête**.
- Les taux et les montants ne sont **jamais** envoyés aux comptes étudiant, enseignant, secrétaire et chef de département.
- Les mots de passe sont stockés sous forme **hachée**.

### Historique des modifications

Toute modification d'une séance, d'un relevé, d'une justification, d'un taux ou d'un paramètre est enregistrée avec **l'auteur, la date, l'ancienne valeur et la nouvelle**. L'historique **ne peut pas être modifié**.

---

## 12. Critères de validation

L'application est acceptée quand chacun de ces tests réussit.

- [ ] L'application s'installe sur l'écran d'accueil et s'ouvre sans réseau.
- [ ] La secrétaire pointe l'arrivée d'un enseignant : un code de séance s'affiche et la séance apparaît « en cours » côté administration.
- [ ] Au pointage d'arrivée, les étudiants de la classe reçoivent la notification « le professeur est en route ».
- [ ] L'enseignant scanne le code QR de pointage : l'arrivée est enregistrée à l'heure du poste de la secrétaire et le code de séance s'affiche dans son application.
- [ ] Une photo du code QR de pointage scannée 5 minutes plus tard est refusée.
- [ ] Un relevé validé avec un code de séance faux n'est pas compté ; la séance reste « incomplète ».
- [ ] Une séance sans départ pointé n'ajoute aucune heure tant que la secrétaire n'a pas saisi le départ.
- [ ] Arrivée 10 h, départ 16 h, relevé validé 17 h : l'enseignant voit les trois heures et **6 heures payées**.
- [ ] Téléphone de l'enseignant éteint : la secrétaire pointe l'arrivée et le départ, l'enseignant saisit le relevé le lendemain avec le code, la séance devient « terminée ».
- [ ] En mode avion, un enseignant coche les présents et valide avec le code. Au retour du réseau, le relevé est rattaché à la bonne séance, **une seule fois**.
- [ ] En mode avion, un étudiant scanne le code QR de présence et voit « en attente ». Une fois les deux téléphones synchronisés, il est « présent ».
- [ ] Une synchronisation coupée puis relancée ne crée **aucun doublon**.
- [ ] Un étudiant d'une autre classe scanne le code QR de présence : son scan est **refusé**.
- [ ] L'enseignant décoche un étudiant qui a scanné : l'étudiant est **absent**.
- [ ] Sans réseau, l'enseignant saisit 30 personnes comptées. Si 33 scans arrivent à la synchronisation, l'écart lui est signalé.
- [ ] Un enseignant fait 2 h au niveau 1 (taux X) et 2 h au niveau 2 (taux Y) : le coût du jour est **2X + 2Y**.
- [ ] Un taux modifié aujourd'hui ne change pas le coût des séances d'hier.
- [ ] Un compte enseignant ou secrétaire ne reçoit aucun taux ni montant, **même en interrogeant directement le serveur**.
- [ ] Une absence justifiée acceptée passe dans les heures justifiées et sort du calcul du seuil d'alerte.
- [ ] Un étudiant qui dépasse le seuil apparaît dans « Étudiants en alerte ». Le bouton ouvre WhatsApp sur le numéro du parent, avec le message rempli.
- [ ] Chaque modification d'un relevé ou d'une heure de pointage apparaît dans l'historique avec son auteur et sa date.

---

## 13. Sécurité

Le code doit empêcher chacune des failles listées dans l'annexe **[securité.md](securité.md)**. Le principe de base : **le serveur ne fait confiance à rien de ce qui vient d'un téléphone ou d'un navigateur.** Formulaires, scans, heures et file d'attente hors ligne sont tous revérifiés par le serveur.

L'annexe donne, pour chaque faille, la façon dont elle peut se produire dans cette application, la mesure exigée et l'endroit du code qui la porte.

| § | Famille | Failles |
| --- | --- | --- |
| 13.1 | Injections (SQL, NoSQL, XSS, QR, formules CSV, commandes, prototype) | 17 |
| 13.2 | Authentification et sessions | 14 |
| 13.3 | Contrôle d'accès (IDOR, élévation de rôle, fuite des taux) | 15 |
| 13.4 | Fraude sur le pointage et les présences | 17 |
| 13.5 | Hors ligne, stockage local et synchronisation | 12 |
| 13.6 | API et serveur | 14 |
| 13.7 | Fichiers : justificatifs, import et export | 9 |
| 13.8 | Interface React et navigateur | 11 |
| 13.9 | Notifications et lien WhatsApp | 7 |
| 13.10 | Données personnelles | 8 |
| 13.11 | Secrets, configuration et dépendances | 8 |
| 13.12 | Journalisation et surveillance | 5 |
| 13.13 | Vérifications avant mise en ligne | 19 tests |

### Quatre règles qui gouvernent tout le code

1. **Refus par défaut.** Une route sans vérification explicite de session et de rôle est une route fermée.
2. **Le serveur calcule, le client affiche.** État d'une séance, heures payées, coûts, absences : calculés côté serveur, jamais acceptés depuis le client.
3. **Liste blanche, jamais liste noire.** Champs acceptés, colonnes triables, types de fichiers, schémas de requête : tout est énuméré.
4. **Tout ce qui est sensible laisse une trace.** Historique en ajout seul, consultable par l'administration.

### Frontière de confiance dans le dépôt

Tant que l'API de production n'est pas écrite, la frontière est matérialisée par le module `src/server/` : il reçoit les opérations, les **revalide intégralement** (session, rôle, périmètre, schéma, cohérence des heures, idempotence) et n'expose que des **projections filtrées par rôle**. Aucun autre module n'écrit dans la base. Ces contrôles devront être **portés tels quels** dans l'API avant la mise en ligne — voir l'annexe A de [securité.md](securité.md).

### Risques explicitement acceptés dans cette version

| Risque | Ce qui le limite |
| --- | --- |
| Un présent envoie la photo du code QR de présence à un absent | Fenêtre de scan ouverte et fermée par l'enseignant, compteur de présents, droit de décocher |
| Deux comptes qui scannent depuis le même téléphone | Identifiant d'appareil joint au scan, cas signalé à l'administration |
| Justificatif falsifié | Décision humaine du chef de département, pièce conservée et historisée |

---

## 14. Points à confirmer

Ces points n'ont pas été tranchés. Le document retient une hypothèse pour chacun ; elle s'applique tant qu'elle n'est pas corrigée.

| Point | Hypothèse retenue |
| --- | --- |
| Écart non payé | Les heures payées vont de l'arrivée au départ pointés au secrétariat. L'exemple fourni (cours 10 h–16 h, relevé 17 h, 30 min non payées) ne permet pas de fixer l'écart exact : **règle à préciser** |
| Plusieurs cours le même jour | L'enseignant repasse au secrétariat entre deux cours : départ du premier, arrivée du second |
| Départ oublié | La secrétaire saisit l'heure après coup, avec un motif ; l'administration est prévenue |
| Compte de la secrétaire | Un rôle à part, sans accès aux taux ni aux coûts |
| Code QR de pointage | Il change toutes les 60 secondes |
| Relevé saisi après le cours | Possible pendant 7 jours, avec le code de séance |
| Compteur de scans hors ligne | L'enseignant saisit le nombre de personnes comptées ; la comparaison se fait à la synchronisation |
| Seuil d'alerte | Valeur et période (mois ou semestre) à fixer par l'administration ; **aucune valeur par défaut** |
| Qui contacte les parents | L'administration et le chef de département |
| Qui demande la justification | L'étudiant depuis son espace ; le chef de département peut aussi justifier directement |
| « L'administration définit les heures » | Compris comme : l'administration fixe les **taux horaires**. Aucun volume d'heures prévu par matière |
| Enseignants permanents et vacataires | Tous les enseignants sont payés à l'heure |
| Cours communs à plusieurs classes | Non prévus : une matière appartient à une seule classe |
| Retards | Non mesurés : un étudiant est présent ou absent |
| Moment du relevé | En fin de cours ; l'application n'empêche pas de le faire plus tôt |
| Coûts visibles par le chef de département | Non |
| Identifiant de connexion | **Matricule** pour l'étudiant, **numéro de téléphone** pour les autres rôles |
| Serveur | Node.js + PostgreSQL, ou Supabase |
| Monnaie | À préciser ; montants arrondis à l'unité |

### Données à fournir par le client avant le développement

- [ ] Liste des étudiants : matricule, nom, prénom, filière, niveau, numéro du parent
- [ ] Liste des filières avec leur chef de département
- [ ] Liste des enseignants avec leurs matières et leurs classes
- [ ] Dates des semestres
