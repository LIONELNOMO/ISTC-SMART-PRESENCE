# Comptes de test

> ⚠️ **Jeu de données fictives, pour les essais uniquement.** Ces personnes n'existent pas.
> Ne jamais charger ce jeu, ni utiliser ce mot de passe, sur une installation réelle.

---

## 1. Créer les comptes

Au premier lancement (`npm run dev`), l'application affiche l'écran **Installation** : aucun compte n'existe encore, c'est volontaire ([§13.2](securité.md#132-authentification-et-sessions) « Compte administrateur par défaut »).

1. Cliquez sur **« Remplir avec le jeu de test »**
2. Cliquez sur **« Installer »**

Les comptes ci-dessous existent alors, ainsi qu'un établissement complet : 2 filières, 3 classes, 5 matières, 30 étudiants et 13 séances passées.

---

## 2. Mot de passe

**Tous les comptes partagent le même :**

```
Presences2026!
```

Il n'est stocké nulle part en clair — pas même dans la base. Si vous le perdez, l'administration peut réinitialiser n'importe quel compte depuis **Référentiel → Comptes → Réinitialiser**.

---

## 3. Identifiants

L'identifiant est le **matricule** pour un étudiant, le **numéro de téléphone** pour tous les autres rôles ([§14](cahier-de-charge.md#14-points-à-confirmer)).

| Rôle | Identifiant | Personne | Ce qu'il permet de voir |
| --- | --- | --- | --- |
| **Administration** | `237699000001` | Pascale Minya | Tout : heures, coûts, taux, référentiel, historique |
| **Secrétaire** | `237699000200` | Lucie Mbarga | Pointage des enseignants, séances du jour |
| **Enseignant** | `237699000301` | Alain Kamdem | Algorithmique (niv. 1) · Bases de données (niv. 2) |
| **Enseignant** | `237699000302` | Berthe Ndongo | Architecture (niv. 1) · Réseaux (niv. 2) |
| **Enseignant** | `237699000303` | Célestin Fouda | Comptabilité générale (Gestion niv. 1) |
| **Chef de département** | `237699000101` | Serge Nkeng | Filière **Informatique** |
| **Chef de département** | `237699000102` | Pascale Abena | Filière **Gestion** |
| **Étudiant** | `INF1001` | — | Informatique niveau 1 |
| **Étudiant** | `INF2001` | — | Informatique niveau 2 |
| **Étudiant** | `GES1001` | — | Gestion niveau 1 |

Les 30 étudiants suivent la même numérotation : `INF1001` à `INF1012`, `INF2001` à `INF2010`, `GES1001` à `GES1008`. La liste complète avec les noms est dans **Administration → Référentiel → Étudiants**.

---

## 4. Scénario de démonstration en 10 minutes

Ouvrez deux fenêtres (dont une en navigation privée) pour jouer deux rôles en même temps.

| # | Compte | Action | Ce que vous devez voir |
| --- | --- | --- | --- |
| 1 | Secrétaire | *Pointage* → « Pointer l'arrivée » sur **Alain Kamdem**, matière **Algorithmique** | Un **code de séance** à 6 caractères s'affiche |
| 2 | Administration | *Tableau de bord* | La séance apparaît aussitôt en **« en cours »**, sans coût |
| 3 | Étudiant `INF1001` | *Accueil* | Le message « Le cours d'Algorithmique va commencer » |
| 4 | Enseignant `…301` | *Séance en cours* → « Afficher le code de présence » | Le QR de présence |
| 5 | Étudiant `INF1001` | *Scanner* le QR affiché à l'étape 4 | **« Présent »** |
| 6 | Étudiant `GES1001` | *Scanner* le même QR | **Refusé** — il n'est pas de cette classe |
| 7 | Enseignant | Cocher la liste, saisir un **code faux** | Le relevé est gardé, la séance reste **« incomplète »** |
| 8 | Enseignant | Saisir le **bon** code (étape 1) | Relevé validé |
| 9 | Secrétaire | « Pointer le départ » | La séance passe **« terminée »** |
| 10 | Enseignant | *Mes heures* | Arrivée, départ, heure du relevé, heures payées — **et aucun montant** |
| 11 | Administration | *Heures et coûts* | Le coût apparaît, au taux en vigueur à la date de la séance |

### Éprouver le hors ligne

Le bouton **Mode avion** (écran de connexion, et panneau de synchronisation) coupe le réseau sans toucher au Wi-Fi.

| # | Action | Ce que vous devez voir |
| --- | --- | --- |
| 1 | Étudiant en mode avion → *Scanner* | **« En attente »**, et le compteur de la file d'attente monte |
| 2 | Quitter le mode avion | Le scan part, l'étudiant passe **« présent »** |
| 3 | Enseignant en mode avion → cocher, saisir le code, valider | Le relevé est mis en file d'attente |
| 4 | Quitter le mode avion, puis **synchroniser deux fois** | Le relevé est rattaché **une seule fois** — aucun doublon |
| 5 | Secrétaire en mode avion → pointer une arrivée | Enregistré ; la notification partira au retour du réseau |
| 6 | Enseignant en mode avion → saisir « 30 personnes comptées » | À la synchronisation, l'écart avec les scans reçus est signalé |

### Vérifier qu'un enseignant ne reçoit aucun montant

Connecté en enseignant : **F12 → Application → IndexedDB → `presences_appareil` → `projection`**.
La clef `enseignant` ne contient ni taux, ni montant, ni numéro de parent. Ce n'est pas masqué à l'écran : ce n'est pas envoyé à l'appareil ([§13.3](securité.md#133-contrôle-daccès)).

---

## 5. Repartir de zéro

La déconnexion efface les données de l'appareil, mais pas celles du « serveur ». Pour tout remettre à zéro et revoir l'écran d'installation :

**F12 → Application → Storage → Delete site data**, ou dans la console :

```js
indexedDB.deleteDatabase('presences_serveur')
indexedDB.deleteDatabase('presences_appareil')
localStorage.clear()
// puis rechargez la page
```

---

## 6. En production

- **Ne cochez pas** « Charger un établissement fictif » à l'installation.
- Créez l'administrateur avec un vrai mot de passe, qui n'est écrit nulle part.
- Les comptes réels se créent ensuite depuis **Référentiel** : chacun reçoit un **mot de passe provisoire aléatoire**, affiché une seule fois, que la personne doit changer à sa première connexion.
- Les étudiants s'importent par fichier CSV (**Référentiel → Étudiants → Import**), avec aperçu avant validation.
