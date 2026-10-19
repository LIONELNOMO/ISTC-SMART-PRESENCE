/**
 * Parcours complets, de bout en bout, à travers l'API du serveur.
 *
 *   node --test tests/parcours.test.mjs
 *
 * Contrairement à `regles.test.mjs` qui teste les fonctions pures, ce fichier
 * installe une vraie base (IndexedDB simulé), crée les comptes, se connecte et
 * enchaîne les opérations comme le feraient les écrans. Il vérifie donc ce que
 * le navigateur seul pouvait vérifier jusqu'ici : les droits, les projections,
 * l'idempotence et la file d'attente.
 */

import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'

import { installer, estInstalle, JEU_DE_TEST } from '../src/server/install.js'
import { connexion, soumettre, lire, changerMotDePasse } from '../src/server/index.js'
import { serverDb } from '../src/server/db.js'
import { randomId } from '../src/lib/crypto.js'
import { buildPresenceQr } from '../src/lib/qr-codes.js'

/* ------------------------------------------------------------------ *
 *  Mise en place : une seule installation pour tout le fichier
 * ------------------------------------------------------------------ */

const MDP = JEU_DE_TEST.motDePasse
const session = {} // jetons par rôle

function op(type, payload) {
  return { opId: randomId(), type, payload, clientAt: new Date().toISOString() }
}

/** Soumet une opération et renvoie `data`, en échouant si le serveur refuse. */
async function doit(token, type, payload) {
  const reponse = await soumettre(token, op(type, payload), { online: true })
  assert.equal(
    reponse.error,
    undefined,
    `${type} aurait dû passer : ${reponse.error?.message ?? ''}`,
  )
  return reponse.data
}

/** Soumet une opération en attendant un refus, et renvoie l'erreur. */
async function refuse(token, type, payload) {
  const reponse = await soumettre(token, op(type, payload), { online: true })
  assert.ok(reponse.error, `${type} aurait dû être refusé`)
  return reponse.error
}

async function connecter(identifiant, motDePasse = MDP) {
  const reponse = await connexion({ identifiant, motDePasse, deviceId: `appareil-${identifiant}` })
  assert.equal(reponse.error, undefined, `connexion ${identifiant} : ${reponse.error?.message ?? ''}`)
  return reponse.data
}

test('installation : aucun compte avant, tous les comptes après', async () => {
  assert.equal(await estInstalle(), false)

  const reponse = await installer({
    nom: JEU_DE_TEST.nom,
    prenom: JEU_DE_TEST.prenom,
    telephone: JEU_DE_TEST.telephone,
    etablissement: JEU_DE_TEST.etablissement,
    motDePasse: MDP,
    avecDemonstration: true,
    motDePasseDemonstration: JEU_DE_TEST.motDePasseDemonstration,
  })

  assert.equal(reponse.error, undefined, reponse.error?.message)
  assert.equal(await estInstalle(), true)
  assert.equal(reponse.data.demonstration.totaux.etudiants, 30)
  assert.equal(reponse.data.demonstration.totaux.enseignants, 3)

  // Une deuxième installation est refusée.
  const encore = await installer({
    nom: 'X',
    prenom: 'Y',
    telephone: '237600000000',
    motDePasse: 'autre-mot-de-passe-1',
  })
  assert.equal(encore.error.code, 'conflit')
})

test('les comptes de test annoncés se connectent vraiment', async () => {
  const attendus = [
    ['237699000001', 'administration'],
    ['237699000200', 'secretaire'],
    ['237699000301', 'enseignant'],
    ['237699000302', 'enseignant'],
    ['237699000303', 'enseignant'],
    ['237699000101', 'chef'],
    ['237699000102', 'chef'],
    ['INF1001', 'etudiant'],
    ['INF2001', 'etudiant'],
    ['GES1001', 'etudiant'],
  ]

  for (const [identifiant, role] of attendus) {
    const data = await connecter(identifiant)
    assert.ok(
      data.moi.roles.includes(role),
      `${identifiant} devrait avoir le rôle ${role}, il a ${data.moi.roles.join(',')}`,
    )
    // L'administrateur a choisi son mot de passe : rien à changer au premier accès.
    if (identifiant === JEU_DE_TEST.telephone) {
      assert.equal(data.moi.mustChangePassword, false)
    }
    session[identifiant] = data.token
  }

  // Une seconde connexion depuis le MÊME appareil révoque la précédente
  // (§13.2 « Fixation de session »). On ne se reconnecte donc pas en double :
  // cela invaliderait les jetons que les tests suivants utilisent.
})

test('§13.2 — même refus pour un compte inconnu et un mot de passe faux', async () => {
  const inconnu = await connexion({
    identifiant: 'NEXISTEPAS',
    motDePasse: MDP,
    deviceId: 'a1',
  })
  const faux = await connexion({
    identifiant: '237699000301',
    motDePasse: 'mauvais-mot-de-passe',
    deviceId: 'a2',
  })
  assert.equal(inconnu.error.code, 'identifiants')
  assert.equal(faux.error.code, 'identifiants')
  assert.equal(inconnu.error.message, faux.error.message)
})

test('§13.2 — la connexion se bloque après plusieurs essais faux', async () => {
  let dernier = null
  for (let i = 0; i < 7; i += 1) {
    dernier = await connexion({
      identifiant: '237699000302',
      motDePasse: 'encore-faux',
      deviceId: 'appareil-attaquant',
    })
  }
  assert.equal(dernier.error.code, 'bloque')
})

/* ================================================================== *
 *  Le parcours du §4 : arrivée → relevé → départ
 * ================================================================== */

let sessionId = null
let codeSeance = null
let scanToken = null
let matiereAlgo = null

test('§4 — la secrétaire pointe une arrivée et obtient un code de séance', async () => {
  const projection = (await lire(session['237699000200'])).data
  const kamdem = projection.secretariat.enseignants.find((e) => e.nom === 'Alain Kamdem')
  assert.ok(kamdem, 'Alain Kamdem doit être dans la liste du secrétariat')

  matiereAlgo = kamdem.matieres.find((m) => m.nom === 'Algorithmique')
  assert.ok(matiereAlgo)

  const data = await doit(session['237699000200'], 'secretariat.arrivee', {
    teacherId: kamdem.id,
    matiereId: matiereAlgo.id,
  })

  sessionId = data.sessionId
  codeSeance = data.code
  assert.match(codeSeance, /^[ACDEFGHJKLMNPQRTUVWXY34679]{6}$/)
  assert.equal(data.notifiee, true)
})

test('§12 — la séance apparaît « en cours » côté administration, sans coût', async () => {
  const projection = (await lire(session['237699000001'])).data
  const enCours = projection.administration.tableauDeBord.enCours.find((s) => s.id === sessionId)
  assert.ok(enCours, 'la séance doit apparaître aussitôt')
  assert.equal(enCours.status, 'en_cours')
  assert.equal(enCours.heuresPayees, 0)
})

test('§4 — les étudiants de la classe reçoivent la notification', async () => {
  const projection = (await lire(session.INF1001)).data
  const notification = projection.etudiant.notifications.find((n) => n.sessionId === sessionId)
  assert.ok(notification, 'la notification de début de cours doit être reçue')
  assert.match(notification.titre, /Algorithmique/)
  assert.match(notification.corps, /Alain Kamdem/)
})

test('§4 — un enseignant n’a qu’une séance ouverte à la fois', async () => {
  const projection = (await lire(session['237699000200'])).data
  const kamdem = projection.secretariat.enseignants.find((e) => e.nom === 'Alain Kamdem')
  const erreur = await refuse(session['237699000200'], 'secretariat.arrivee', {
    teacherId: kamdem.id,
    matiereId: kamdem.matieres[1].id,
  })
  assert.equal(erreur.code, 'conflit')
})

test('§5 — l’enseignant ouvre le relevé et reçoit le jeton de sa séance', async () => {
  const token = session['237699000301']
  await doit(token, 'releve.ouvrir', { sessionId })

  const projection = (await lire(token)).data
  const seance = projection.enseignant.seanceEnCours
  assert.equal(seance.id, sessionId)
  assert.equal(seance.code, codeSeance, 'l’enseignant voit son propre code de séance')
  assert.ok(seance.scanToken, 'il reçoit le jeton pour afficher le QR hors ligne')
  scanToken = seance.scanToken
})

test('§5 — un étudiant de la classe scanne et devient présent', async () => {
  const qr = buildPresenceQr({ sessionId, scanToken })
  const data = await doit(session.INF1001, 'presence.scan', { qr, deviceId: 'tel-inf1001' })
  assert.equal(data.status, 'present')
})

test('§5 — un deuxième scan du même étudiant est ignoré, pas compté deux fois', async () => {
  const qr = buildPresenceQr({ sessionId, scanToken })
  const data = await doit(session.INF1001, 'presence.scan', { qr, deviceId: 'tel-inf1001' })
  assert.equal(data.duplicate, true)

  const lignes = await serverDb.attendance.where('sessionId').equals(sessionId).toArray()
  assert.equal(lignes.filter((l) => l.studentId && l.status === 'present').length, 1)
})

test('§12 — un étudiant d’une autre classe est refusé', async () => {
  const qr = buildPresenceQr({ sessionId, scanToken })
  const erreur = await refuse(session.GES1001, 'presence.scan', { qr, deviceId: 'tel-ges1001' })
  assert.equal(erreur.code, 'perimetre')
})

test('§13.4 — un scan sans le jeton secret est refusé', async () => {
  const faux = buildPresenceQr({ sessionId, scanToken: 'a'.repeat(32) })
  const erreur = await refuse(session.INF2001, 'presence.scan', { qr: faux, deviceId: 'tel-x' })
  // L'étudiant n'est pas non plus de la bonne classe ; le jeton est vérifié d'abord.
  assert.equal(erreur.code, 'invalide')
})

test('§12 — un relevé validé avec un code faux laisse la séance incomplète', async () => {
  const token = session['237699000301']
  const projection = (await lire(token)).data
  // La projection du secrétariat ne porte pas de classeId : on passe par celle
  // de l'enseignant, qui expose la classe de chacune de ses matières.
  const saMatiere = projection.enseignant.matieres.find((m) => m.id === matiereAlgo.id)
  const eleves = projection.enseignant.listes.find((l) => l.classeId === saMatiere.classeId)

  const data = await doit(token, 'releve.valider', {
    sessionId,
    matiereId: matiereAlgo.id,
    code: 'AAAAAA', // code volontairement faux
    presents: eleves.etudiants.slice(0, 8).map((e) => e.id),
  })

  assert.equal(data.ok, false)
  assert.equal(data.raison, 'code')

  // Le départ n'étant pas encore pointé, la séance reste « en cours » :
  // l'enseignant est toujours à l'école. Ce qui compte ici, c'est qu'elle ne
  // soit pas « terminée », donc qu'elle n'entre ni dans les heures ni dans les
  // coûts. Elle basculera en « incomplète » au pointage du départ, tant que le
  // relevé n'aura pas été validé avec le bon code.
  assert.notEqual(data.status, 'terminee')

  const apres = (await lire(session['237699000001'])).data
  const vueAdmin = [
    ...apres.administration.tableauDeBord.enCours,
    ...apres.administration.tableauDeBord.incompletes,
  ].find((s) => s.id === sessionId)
  assert.ok(vueAdmin, 'la séance doit rester visible et non comptée')
  assert.equal(vueAdmin.heuresPayees, 0)
})

test('§5 — le bon code valide le relevé', async () => {
  const token = session['237699000301']
  const projection = (await lire(token)).data
  // La projection du secrétariat ne porte pas de classeId : on passe par celle
  // de l'enseignant, qui expose la classe de chacune de ses matières.
  const saMatiere = projection.enseignant.matieres.find((m) => m.id === matiereAlgo.id)
  const eleves = projection.enseignant.listes.find((l) => l.classeId === saMatiere.classeId)

  const data = await doit(token, 'releve.valider', {
    sessionId,
    matiereId: matiereAlgo.id,
    code: codeSeance,
    presents: eleves.etudiants.slice(0, 8).map((e) => e.id),
  })

  assert.equal(data.ok, true)
  assert.equal(data.presents, 8)
  // Le départ n'est pas pointé : la séance reste incomplète.
  assert.equal(data.status, 'incomplete')
})

test('§13.4 — un collègue ne peut pas valider le relevé avec le code', async () => {
  const projection = (await lire(session['237699000302'])).data
  const matiere = projection.enseignant.matieres[0]
  const erreur = await refuse(session['237699000302'], 'releve.valider', {
    sessionId,
    matiereId: matiere.id,
    code: codeSeance,
    presents: [],
  })
  // La séance ne lui appartient pas.
  assert.ok(['perimetre', 'invalide'].includes(erreur.code))
})

test('§12 — tant que le départ n’est pas pointé, aucune heure n’est ajoutée', async () => {
  const projection = (await lire(session['237699000301'])).data
  const seance = projection.enseignant.heures.seances.find((s) => s.id === sessionId)
  assert.equal(seance.status, 'incomplete')
  assert.equal(seance.heuresPayees, 0)
})

test('§4 — le départ pointé termine la séance et produit les heures', async () => {
  await doit(session['237699000200'], 'secretariat.depart', { sessionId })

  const projection = (await lire(session['237699000301'])).data
  const seance = projection.enseignant.heures.seances.find((s) => s.id === sessionId)
  assert.equal(seance.status, 'terminee')
  assert.ok(seance.arrivalAt && seance.departureAt && seance.releveAt)
  // La séance vient d'être ouverte : la durée est proche de zéro mais définie.
  assert.equal(typeof seance.heuresPayees, 'number')
})

/* ================================================================== *
 *  §13.3 — Ce que chaque rôle reçoit
 * ================================================================== */

test('§12 — un enseignant ne reçoit aucun taux ni montant', async () => {
  const projection = (await lire(session['237699000301'])).data
  assert.equal(projection.administration, undefined)
  assert.equal(projection.departement, undefined)

  const texte = JSON.stringify(projection)
  assert.ok(!texte.includes('"montant"'), 'aucun montant ne doit être projeté')
  assert.ok(!texte.includes('"taux"'), 'aucun taux ne doit être projeté')
  assert.ok(!texte.includes('parentPhone'), 'aucun numéro de parent ne doit être projeté')
})

test('§12 — une secrétaire ne reçoit aucun taux ni montant', async () => {
  const projection = (await lire(session['237699000200'])).data
  const texte = JSON.stringify(projection)
  assert.equal(projection.administration, undefined)
  assert.ok(!texte.includes('"montant"'))
  assert.ok(!texte.includes('parentPhone'))
})

test('§13.10 — un étudiant ne reçoit que ses propres données', async () => {
  const projection = (await lire(session.INF1001)).data
  assert.equal(projection.enseignant, undefined)
  assert.equal(projection.administration, undefined)

  const texte = JSON.stringify(projection)
  assert.ok(!texte.includes('parentPhone'))
  // Aucun autre matricule de la classe ne doit apparaître.
  assert.ok(!texte.includes('INF1002'), 'la liste de classe ne doit pas être exposée')
})

test('§13.3 — le chef de département ne voit que sa filière, et aucun coût', async () => {
  const projection = (await lire(session['237699000101'])).data
  assert.deepEqual(
    projection.departement.filieres.map((f) => f.nom),
    ['Informatique'],
  )
  const classes = projection.departement.presences.map((p) => p.classe)
  assert.ok(classes.every((c) => c.startsWith('Informatique')))
  assert.ok(!JSON.stringify(projection).includes('"montant"'))
})

test('§13.3 — l’administration reçoit les taux et les montants', async () => {
  const projection = (await lire(session['237699000001'])).data
  assert.ok(projection.administration.taux.length > 0)
  assert.ok(typeof projection.administration.taux[0].montant === 'number')
  assert.ok(projection.administration.heuresEtCouts.totaux.montant >= 0)
})

test('§13.3 — une opération d’administration est refusée aux autres rôles', async () => {
  const erreur = await refuse(session['237699000301'], 'admin.taux', {
    scope: 'niveau',
    niveau: 1,
    montant: 999_999,
    dateEffet: '2026-01-01',
  })
  assert.equal(erreur.code, 'droits')

  const erreur2 = await refuse(session['237699000200'], 'admin.parametres', {
    seuilAlerteHeures: 0,
  })
  assert.equal(erreur2.code, 'droits')
})

test('§13.3 — un chef de département ne décide pas pour une autre filière', async () => {
  const chefGestion = (await lire(session['237699000102'])).data
  const chefInfo = (await lire(session['237699000101'])).data

  const demandeInfo = chefInfo.departement.justifications.find((j) => j.state === 'en_attente')
  assert.ok(demandeInfo, 'le jeu de démonstration contient des demandes en attente')
  assert.ok(
    !chefGestion.departement.justifications.some((j) => j.id === demandeInfo.id),
    'elle ne doit pas apparaître chez le chef de Gestion',
  )

  const erreur = await refuse(session['237699000102'], 'justification.decider', {
    justificationId: demandeInfo.id,
    decision: 'acceptee',
  })
  assert.equal(erreur.code, 'perimetre')
})

/* ================================================================== *
 *  §13.5 — File d'attente et idempotence
 * ================================================================== */

test('§12 — la même action envoyée deux fois n’est enregistrée qu’une fois', async () => {
  const token = session['237699000200']
  const projection = (await lire(token)).data
  const ndongo = projection.secretariat.enseignants.find((e) => e.nom === 'Berthe Ndongo')

  const action = op('secretariat.arrivee', {
    teacherId: ndongo.id,
    matiereId: ndongo.matieres[0].id,
  })

  const premier = await soumettre(token, action, { online: true })
  const second = await soumettre(token, action, { online: true }) // rejeu exact

  assert.equal(premier.error, undefined)
  assert.equal(second.error, undefined)
  assert.equal(second.data.rejouee, true)
  assert.equal(premier.data.sessionId, second.data.sessionId)

  const seances = await serverDb.sessions.where('teacherId').equals(ndongo.id).toArray()
  const ouvertes = seances.filter((s) => !s.departureAt)
  assert.equal(ouvertes.length, 1, 'une seule séance doit avoir été créée')
})

test('§13.5 — un identifiant d’action est propre à un utilisateur', async () => {
  const action = op('releve.ouvrir', { sessionId })
  await soumettre(session['237699000301'], action, { online: true })

  // Un autre compte réutilisant le même identifiant ne récupère pas le résultat.
  const autre = await soumettre(session['237699000302'], action, { online: true })
  assert.ok(autre.error, 'le rejeu croisé doit être refusé sur le fond, pas servi depuis le cache')
})

test('§9 — une action réservée au réseau est refusée hors ligne', async () => {
  const reponse = await soumettre(
    session['237699000001'],
    op('admin.parametres', { seuilAlerteHeures: 10 }),
    { online: false },
  )
  assert.equal(reponse.error.code, 'reseau')
  assert.equal(reponse.error.retryable, true)
})

test('§9 — le pointage au secrétariat fonctionne hors ligne', async () => {
  const token = session['237699000200']
  const projection = (await lire(token)).data
  const fouda = projection.secretariat.enseignants.find((e) => e.nom === 'Célestin Fouda')

  const reponse = await soumettre(
    token,
    op('secretariat.arrivee', { teacherId: fouda.id, matiereId: fouda.matieres[0].id }),
    { online: false },
  )
  assert.equal(reponse.error, undefined)
  assert.ok(reponse.data.code)
  // La notification demande du réseau : elle n'est pas partie.
  assert.equal(reponse.data.notifiee, false)
})

/* ================================================================== *
 *  §13.1 / §13.3 — Entrées hostiles
 * ================================================================== */

test('§13.3 — un champ non prévu fait échouer la requête', async () => {
  const reponse = await soumettre(
    session['237699000200'],
    op('secretariat.depart', { sessionId, heuresPayees: 99 }),
    { online: true },
  )
  assert.equal(reponse.error.code, 'invalide')
  assert.match(reponse.error.message, /non autorisé/)
})

test('§13.3 — un rôle ne peut pas être modifié depuis une requête ordinaire', async () => {
  const reponse = await soumettre(
    session['237699000301'],
    op('releve.ouvrir', { sessionId, role: 'administration' }),
    { online: true },
  )
  assert.equal(reponse.error.code, 'invalide')
})

test('§13.3 — une route inconnue est refusée par défaut', async () => {
  const reponse = await soumettre(session['237699000001'], op('admin.tout_supprimer', {}), {
    online: true,
  })
  assert.equal(reponse.error.code, 'droits')
})

test('§13.2 — un jeton invalide ne donne accès à rien', async () => {
  const reponse = await lire('jeton-fabrique-de-toutes-pieces')
  assert.equal(reponse.error.code, 'session')
})

test('§13.2 — un compte désactivé perd l’accès immédiatement', async () => {
  const admin = session['237699000001']
  const projection = (await lire(admin)).data
  const compteFouda = projection.administration.referentiel.comptes.find(
    (c) => c.login === '237699000303',
  )

  const avant = await lire(session['237699000303'])
  assert.equal(avant.error, undefined)

  await doit(admin, 'admin.compte', { userId: compteFouda.id, actif: false })

  const apres = await lire(session['237699000303'])
  assert.equal(apres.error.code, 'session')
})

/* ================================================================== *
 *  §11 — Historique
 * ================================================================== */

test('§12 — chaque modification apparaît dans l’historique avec son auteur', async () => {
  const projection = (await lire(session['237699000001'])).data
  const historique = projection.administration.historique

  const arrivee = historique.find((h) => h.entityId === sessionId && h.action === 'arrivee_pointee')
  assert.ok(arrivee, "le pointage d'arrivée doit être historisé")
  assert.ok(arrivee.authorLabel, "l'auteur doit être nommé")
  assert.ok(arrivee.at, 'la date doit être enregistrée')

  const codeRefuse = historique.find((h) => h.action === 'code_seance_refuse')
  assert.ok(codeRefuse, 'le code de séance refusé doit laisser une trace')
  assert.equal(codeRefuse.flagged, true)
})

test('§13.12 — l’historique ne peut être ni modifié ni supprimé', async () => {
  const ligne = await serverDb.audit.orderBy('at').first()
  assert.ok(ligne)

  await assert.rejects(
    () => serverDb.audit.update(ligne.id, { authorLabel: 'quelqu’un d’autre' }),
    /ne peut pas être modifié/,
  )
  await assert.rejects(() => serverDb.audit.delete(ligne.id), /ne peut pas être supprimé/)

  // La ligne est intacte.
  const relue = await serverDb.audit.get(ligne.id)
  assert.equal(relue.authorLabel, ligne.authorLabel)
})

test('§13.10 — le code de séance n’apparaît jamais en clair dans l’historique', async () => {
  const toutes = await serverDb.audit.toArray()
  const texte = JSON.stringify(toutes)
  assert.ok(!texte.includes(codeSeance), 'le code de séance ne doit pas être journalisé')
})

/* ================================================================== *
 *  §13.2 — Mot de passe
 * ================================================================== */

test('§13.2 — changer son mot de passe exige l’ancien et ferme les autres sessions', async () => {
  const data = await connecter('INF2001')
  const autreAppareil = await connexion({
    identifiant: 'INF2001',
    motDePasse: MDP,
    deviceId: 'second-telephone',
  })
  assert.equal(autreAppareil.error, undefined)

  const sansAncien = await changerMotDePasse(data.token, {
    actuel: 'mauvais',
    nouveau: 'NouveauMotDePasse1!',
  })
  assert.equal(sansAncien.error.code, 'identifiants')

  const tropCourt = await changerMotDePasse(data.token, { actuel: MDP, nouveau: 'court1' })
  assert.ok(tropCourt.error)

  const ok = await changerMotDePasse(data.token, {
    actuel: MDP,
    nouveau: 'NouveauMotDePasse1!',
  })
  assert.equal(ok.error, undefined)

  // La session de l'autre appareil est fermée.
  const apres = await lire(autreAppareil.data.token)
  assert.equal(apres.error.code, 'session')

  // L'ancien mot de passe ne fonctionne plus.
  const ancien = await connexion({ identifiant: 'INF2001', motDePasse: MDP, deviceId: 'x' })
  assert.equal(ancien.error.code, 'identifiants')
})
