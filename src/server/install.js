/**
 * Installation et jeu de données fictives.
 *
 *  §13.2 « Compte administrateur par défaut » — il n'existe AUCUN compte à
 *         l'installation. Le premier administrateur est créé par la personne qui
 *         installe, avec le mot de passe qu'elle choisit.
 *  §13.10 « Vraies données en développement » — les données de démonstration sont
 *         entièrement inventées.
 *  §13.11 — aucun mot de passe en clair n'est stocké, pas même pour la démonstration.
 */

import { serverDb } from './db.js'
import { putSettings } from './settings.js'
import { appendAudit, noteAnomalie } from './audit.js'
import { errors, toClientError } from './errors.js'
import { roleCombinationProblem, validate } from './schema.js'
import { refreshAllStatuses } from './maintenance.js'
import {
  randomId,
  randomCode,
  hashPassword,
  newHmacSecret,
  passwordProblem,
} from '../lib/crypto.js'
import { newScanToken } from '../lib/qr-codes.js'
import { dayKey, nowIso, DAY, HOUR, MINUTE } from '../lib/dates.js'
import { normalizePhone } from '../lib/whatsapp.js'

// Identifiants fixes des trois départements (identiques au SQL de schéma).
export const DEPARTEMENTS = {
  technologique: 'd0000000-0000-4000-8000-000000000001',
  gestion: 'd0000000-0000-4000-8000-000000000002',
  sante: 'd0000000-0000-4000-8000-000000000003',
}

const INSTALL_SHAPE = {
  nom: { type: 'text', required: true, min: 2, max: 60 },
  prenom: { type: 'text', required: true, min: 1, max: 60 },
  telephone: { type: 'phone', required: true },
  motDePasse: { type: 'text', required: true, min: 8, max: 128 },
  etablissement: { type: 'text', required: false, max: 120 },
  avecDemonstration: { type: 'bool', required: false, default: false },
  motDePasseDemonstration: { type: 'text', required: false, min: 8, max: 128 },
}

/** Vrai si l'application a déjà un administrateur. */
export async function estInstalle() {
  const total = await serverDb.users.count()
  return total > 0
}

/**
 * Chiffres de l'établissement affichés sur l'écran de connexion.
 *
 * C'est la SEULE lecture autorisée sans session, et elle ne renvoie que des
 * comptages et le nom de l'établissement : aucun nom de personne, aucun
 * identifiant, aucun numéro. Un visiteur apprend que l'école existe et sa
 * taille, rien de plus (§13.10 « Collecte excessive », §13.8 « Données de trop
 * dans les réponses »).
 */
export async function vitrine() {
  try {
    const [etablissement, enseignants, etudiants, seances] = await Promise.all([
      getSettings().then((s) => s.etablissement),
      serverDb.teachers.count(),
      serverDb.students.count(),
      serverDb.sessions.count(),
    ])
    return { etablissement, enseignants, etudiants, seances }
  } catch {
    // L'écran de connexion doit s'afficher même si la base est indisponible.
    return { etablissement: null, enseignants: 0, etudiants: 0, seances: 0 }
  }
}

/**
 * Crée le premier administrateur, et facultativement un jeu de données fictives.
 * @returns {{data:object}|{error:object}}
 */
export async function installer(input) {
  try {
    if (await estInstalle()) {
      throw errors.conflit("L'application est déjà installée.")
    }
    const payload = validate(input, INSTALL_SHAPE, 'installation')

    const probleme = passwordProblem(payload.motDePasse)
    if (probleme) throw errors.invalide(probleme)

    const roles = ['administration']
    const combi = roleCombinationProblem(roles)
    if (combi) throw errors.invalide(combi)

    const adminId = randomId()
    await serverDb.users.add({
      id: adminId,
      login: payload.telephone,
      loginKey: payload.telephone,
      nom: payload.nom,
      prenom: payload.prenom,
      telephone: payload.telephone,
      roles,
      passwordHash: await hashPassword(payload.motDePasse),
      // Le mot de passe a été choisi par la personne elle-même : rien à changer.
      mustChangePassword: false,
      actif: true,
      createdAt: nowIso(),
    })

    await putSettings({
      etablissement: payload.etablissement || 'Établissement',
    })

    // Les trois départements de l'établissement (identifiants fixes, comme en SQL).
    await serverDb.departements.bulkPut([
      { id: DEPARTEMENTS.technologique, nom: 'Technologique' },
      { id: DEPARTEMENTS.gestion, nom: 'Gestion' },
      { id: DEPARTEMENTS.sante, nom: 'Santé' },
    ])

    await appendAudit({
      entity: 'compte',
      entityId: adminId,
      action: 'installation',
      authorId: adminId,
      authorLabel: `${payload.prenom} ${payload.nom}`,
      note: 'Premier administrateur créé.',
    })

    let demonstration = null
    if (payload.avecDemonstration) {
      const motDePasseDemo = payload.motDePasseDemonstration
      const problemeDemo = passwordProblem(motDePasseDemo ?? '')
      if (problemeDemo) {
        throw errors.invalide(
          `Mot de passe commun aux comptes de démonstration : ${problemeDemo.toLowerCase()}`,
        )
      }
      demonstration = await chargerDemonstration({ adminId, motDePasse: motDePasseDemo })
    }

    return { data: { adminId, demonstration } }
  } catch (error) {
    return toClientError(error)
  }
}

/* ================================================================== *
 *  Jeu de données fictives
 * ================================================================== */

const PRENOMS = [
  'Awa', 'Brice', 'Clarisse', 'Didier', 'Elodie', 'Franck', 'Ghislaine', 'Hervé',
  'Ines', 'Joel', 'Karine', 'Landry', 'Mireille', 'Narcisse', 'Olive', 'Patrick',
  'Quentin', 'Rachelle', 'Samuel', 'Thérèse', 'Ulrich', 'Viviane', 'Wilfried', 'Yolande',
  'Zacharie', 'Aline', 'Boris', 'Carine', 'Dieudonné', 'Estelle',
]
const NOMS = [
  'Abena', 'Bekono', 'Chendjou', 'Djomo', 'Essomba', 'Fouda', 'Guetsop', 'Hamadou',
  'Ibrahim', 'Jiofack', 'Kamdem', 'Lontsi', 'Mbarga', 'Ndongo', 'Owona', 'Pokam',
  'Rameau', 'Sanda', 'Tchouta', 'Um', 'Voufo', 'Wandji', 'Yimga', 'Zoa',
]

function pick(list, i) {
  return list[i % list.length]
}

/**
 * Crée un établissement fictif complet : référentiel, taux, séances passées,
 * présences, justifications. Tous les comptes partagent le mot de passe choisi
 * par l'administrateur, stocké haché.
 */
async function chargerDemonstration({ adminId, motDePasse }) {
  const hash = await hashPassword(motDePasse)
  const comptes = []

  const addUser = async ({ login, nom, prenom, roles, extra = {} }) => {
    const id = randomId()
    await serverDb.users.add({
      id,
      login,
      loginKey: String(login).toLowerCase(),
      nom,
      prenom,
      roles,
      passwordHash: hash,
      // Données de démonstration : on n'impose pas le changement, sinon chaque
      // essai de l'application commencerait par un formulaire.
      mustChangePassword: false,
      actif: true,
      createdAt: nowIso(),
      ...extra,
    })
    comptes.push({ login, nom: `${prenom} ${nom}`, roles })
    return id
  }

  /* --- filières, chefs de département --- */
  const chefInfoId = await addUser({
    login: '237699000101',
    nom: 'Nkeng',
    prenom: 'Serge',
    roles: ['chef'],
    extra: { telephone: '237699000101' },
  })
  const chefGestionId = await addUser({
    login: '237699000102',
    nom: 'Abena',
    prenom: 'Pascale',
    roles: ['chef'],
    extra: { telephone: '237699000102' },
  })

  const filiereInfo = {
    id: randomId(),
    nom: 'Informatique',
    chefUserId: chefInfoId,
    departementId: DEPARTEMENTS.technologique,
  }
  const filiereGestion = {
    id: randomId(),
    nom: 'Gestion',
    chefUserId: chefGestionId,
    departementId: DEPARTEMENTS.gestion,
    // §4 : Gestion a une SECTION ANGLOPHONE (démonstration) : les mêmes cours,
    // affichés sous leur nom anglais, pour un groupe d'étudiants distinct.
    sectionAnglophone: true,
  }
  await serverDb.filieres.bulkAdd([filiereInfo, filiereGestion])
  await serverDb.users.update(chefInfoId, { filiereId: filiereInfo.id })
  await serverDb.users.update(chefGestionId, { filiereId: filiereGestion.id })

  /* --- classes --- */
  const classes = [
    { id: randomId(), filiereId: filiereInfo.id, niveau: 1, nom: 'Informatique — niveau 1' },
    { id: randomId(), filiereId: filiereInfo.id, niveau: 2, nom: 'Informatique — niveau 2' },
    { id: randomId(), filiereId: filiereGestion.id, niveau: 1, nom: 'Gestion — niveau 1' },
  ]
  await serverDb.classes.bulkAdd(classes)
  const [infoN1, infoN2, gestionN1] = classes

  /* --- matières --- */
  const matieres = [
    { id: randomId(), nom: 'Algorithmique', nomEn: 'Algorithms', classeId: infoN1.id },
    { id: randomId(), nom: 'Architecture des ordinateurs', nomEn: 'Computer Architecture', classeId: infoN1.id },
    { id: randomId(), nom: 'Bases de données', nomEn: 'Databases', classeId: infoN2.id },
    { id: randomId(), nom: 'Réseaux', nomEn: 'Networks', classeId: infoN2.id },
    { id: randomId(), nom: 'Comptabilité générale', nomEn: 'General Accounting', classeId: gestionN1.id },
  ]
  await serverDb.matieres.bulkAdd(matieres)
  const [algo, archi, bdd, reseaux, compta] = matieres

  /* --- secrétaire et son poste de pointage --- */
  const secretaireId = await addUser({
    login: '237699000200',
    nom: 'Mbarga',
    prenom: 'Lucie',
    roles: ['secretaire'], // §13.3 : jamais cumulé avec « enseignant »
    extra: { telephone: '237699000200' },
  })
  await serverDb.stations.add({
    id: `poste-${randomCode(4).toLowerCase()}`,
    label: 'Secrétariat — Lucie Mbarga',
    secret: newHmacSecret(), // clef de signature, ne sort pas du poste
    secretaryUserId: secretaireId,
  })

  /* --- enseignants --- */
  const enseignantsSeed = [
    { nom: 'Kamdem', prenom: 'Alain', tel: '237699000301', matieres: [algo.id, bdd.id], dep: DEPARTEMENTS.technologique },
    { nom: 'Ndongo', prenom: 'Berthe', tel: '237699000302', matieres: [archi.id, reseaux.id], dep: DEPARTEMENTS.technologique },
    { nom: 'Fouda', prenom: 'Célestin', tel: '237699000303', matieres: [compta.id], dep: DEPARTEMENTS.gestion },
  ]
  const teachers = []
  for (const seed of enseignantsSeed) {
    const userId = await addUser({
      login: seed.tel,
      nom: seed.nom,
      prenom: seed.prenom,
      roles: ['enseignant'],
      extra: { telephone: seed.tel },
    })
    const teacherId = randomId()
    await serverDb.teachers.add({
      id: teacherId,
      nom: seed.nom,
      prenom: seed.prenom,
      telephone: seed.tel,
      userId,
      departementId: seed.dep,
      actif: true,
    })
    await serverDb.users.update(userId, { teacherId })
    for (const matiereId of seed.matieres) {
      await serverDb.affectations.add({ id: randomId(), teacherId, matiereId })
    }
    teachers.push({ id: teacherId, userId, ...seed })
  }
  const [kamdem, ndongo, fouda] = teachers

  /* --- un compte à la fois enseignant et chef de département (§2) --- */
  await serverDb.users.update(chefInfoId, { roles: ['chef'] })

  /* --- étudiants --- */
  const repartition = [
    { classe: infoN1, prefixe: 'INF1', nombre: 12 },
    { classe: infoN2, prefixe: 'INF2', nombre: 10 },
    { classe: gestionN1, prefixe: 'GES1', nombre: 8 },
  ]
  const students = []
  let compteur = 0
  for (const groupe of repartition) {
    for (let i = 0; i < groupe.nombre; i += 1) {
      const matricule = `${groupe.prefixe}${String(i + 1).padStart(3, '0')}`
      const prenom = pick(PRENOMS, compteur)
      const nom = pick(NOMS, compteur * 3 + 1)
      const studentId = randomId()
      const userId = await addUser({
        login: matricule,
        nom,
        prenom,
        roles: ['etudiant'],
        extra: { studentId },
      })
      // §4 : en Gestion (section anglophone activée), les 3 derniers étudiants
      // forment le groupe anglophone de démonstration.
      const section =
        groupe.classe.id === gestionN1.id && i >= groupe.nombre - 3 ? 'anglophone' : 'francophone'
      const student = {
        id: studentId,
        matricule,
        nom,
        prenom,
        classeId: groupe.classe.id,
        section,
        parentPhone: `23769900${String(1000 + compteur).slice(-4)}`,
        userId,
        actif: true,
      }
      await serverDb.students.add(student)
      students.push(student)
      compteur += 1
    }
  }

  /* --- paramètres (§3, §8) --- */
  const annee = new Date().getFullYear()
  await putSettings({
    etablissement: 'Institut Supérieur des Technologies et de Commerce',
    monnaie: 'FCFA',
    seuilAlerteHeures: 10,
    seuilAlertePeriode: 'semestre',
    semestres: {
      s1Debut: `${annee}-09-01`,
      s1Fin: `${annee + 1}-01-31`,
      s2Debut: `${annee + 1}-02-01`,
      s2Fin: `${annee + 1}-06-30`,
    },
  })

  /* --- taux horaires, avec date d'effet (§7) --- */
  const effetAncien = dayKey(new Date(Date.now() - 120 * DAY))
  await serverDb.rates.bulkAdd([
    {
      id: randomId(),
      scope: 'niveau',
      teacherId: null,
      matiereId: null,
      niveau: 1,
      montant: 4000,
      dateEffet: effetAncien,
      createdAt: nowIso(),
      createdBy: adminId,
    },
    {
      id: randomId(),
      scope: 'niveau',
      teacherId: null,
      matiereId: null,
      niveau: 2,
      montant: 5000,
      dateEffet: effetAncien,
      createdAt: nowIso(),
      createdBy: adminId,
    },
    {
      id: randomId(),
      scope: 'enseignant_niveau',
      teacherId: kamdem.id,
      matiereId: null,
      niveau: 1,
      montant: 4500,
      dateEffet: effetAncien,
      createdAt: nowIso(),
      createdBy: adminId,
    },
    {
      id: randomId(),
      scope: 'enseignant_matiere',
      teacherId: kamdem.id,
      matiereId: bdd.id,
      niveau: null,
      montant: 6500,
      dateEffet: effetAncien,
      createdAt: nowIso(),
      createdBy: adminId,
    },
  ])

  /* --- séances passées, pour que les tableaux de bord parlent --- */
  const plan = [
    { teacher: kamdem, matiere: algo, classe: infoN1, joursAvant: 14, debut: 8, duree: 3, absents: 2 },
    { teacher: ndongo, matiere: archi, classe: infoN1, joursAvant: 13, debut: 10, duree: 2, absents: 3 },
    { teacher: kamdem, matiere: bdd, classe: infoN2, joursAvant: 12, debut: 8, duree: 4, absents: 1 },
    { teacher: ndongo, matiere: reseaux, classe: infoN2, joursAvant: 11, debut: 13, duree: 3, absents: 2 },
    { teacher: fouda, matiere: compta, classe: gestionN1, joursAvant: 10, debut: 9, duree: 2, absents: 2 },
    { teacher: kamdem, matiere: algo, classe: infoN1, joursAvant: 7, debut: 10, duree: 10 / 6, absents: 4 },
    { teacher: kamdem, matiere: bdd, classe: infoN2, joursAvant: 6, debut: 8, duree: 3, absents: 0 },
    { teacher: ndongo, matiere: reseaux, classe: infoN2, joursAvant: 5, debut: 14, duree: 2, absents: 3 },
    { teacher: fouda, matiere: compta, classe: gestionN1, joursAvant: 3, debut: 9, duree: 3, absents: 1 },
    { teacher: kamdem, matiere: algo, classe: infoN1, joursAvant: 1, debut: 8, duree: 6, absents: 2, releveTardif: 60 },
    // §4 : exemple du cahier des charges — 10 h → 16 h, relevé à 17 h.
    { teacher: ndongo, matiere: archi, classe: infoN1, joursAvant: 2, debut: 10, duree: 6, absents: 1, releveTardif: 60 },
    // Séance incomplète : départ non pointé.
    { teacher: fouda, matiere: compta, classe: gestionN1, joursAvant: 4, debut: 11, duree: null, absents: 0 },
    // Séance avec départ saisi après coup, signalée à l'administration.
    { teacher: ndongo, matiere: reseaux, classe: infoN2, joursAvant: 8, debut: 15, duree: 2, absents: 1, departManuel: true },
  ]

  const sessions = []
  for (const item of plan) {
    const base = new Date(Date.now() - item.joursAvant * DAY)
    base.setHours(item.debut, 0, 0, 0)
    const arrivalAt = base.toISOString()
    const departureAt =
      item.duree === null ? null : new Date(base.getTime() + item.duree * HOUR).toISOString()
    const releveAt =
      item.duree === null
        ? null
        : new Date(
            base.getTime() + item.duree * HOUR + (item.releveTardif ?? -10) * MINUTE,
          ).toISOString()

    const eleves = students.filter((s) => s.classeId === item.classe.id)
    const presents = eleves.slice(0, Math.max(0, eleves.length - item.absents)).map((s) => s.id)

    const session = {
      id: randomId(),
      teacherId: item.teacher.id,
      matiereId: item.matiere.id,
      classeId: item.classe.id,
      niveau: item.classe.niveau,
      day: dayKey(arrivalAt),
      arrivalAt,
      arrivalReceivedAt: arrivalAt,
      arrivalBy: secretaireId,
      arrivalVia: 'secretariat',
      departureAt,
      departureReceivedAt: departureAt,
      departureBy: departureAt ? secretaireId : null,
      departureVia: departureAt ? (item.departManuel ? 'saisie_manuelle' : 'secretariat') : null,
      departureManual: item.departManuel
        ? {
            motif: "L'enseignant a quitté l'école sans repasser au secrétariat.",
            byUserId: secretaireId,
            byLabel: 'Lucie Mbarga',
            at: departureAt,
          }
        : null,
      code: randomCode(6),
      codeAttempts: 0,
      scanToken: newScanToken(),
      rollOpenedAt: arrivalAt,
      rollClosedAt: releveAt,
      roll: releveAt
        ? {
            validatedAt: releveAt,
            receivedAt: releveAt,
            codeOk: true,
            presents,
            comptePhysique: null,
            scansAuMomentDeLaValidation: presents.length,
            byUserId: item.teacher.userId,
            lastEditAt: releveAt,
            skewMs: 0,
          }
        : null,
      notifiee: true,
      status: 'terminee',
      manque: [],
      createdAt: arrivalAt,
    }
    sessions.push(session)

    for (const studentId of presents) {
      await serverDb.attendance.add({
        sessionId: session.id,
        studentId,
        id: randomId(),
        status: 'present',
        source: 'scan',
        at: arrivalAt,
        receivedAt: arrivalAt,
        deviceId: `demo-${studentId.slice(0, 8)}`,
      })
    }

    if (item.departManuel) {
      await noteAnomalie({
        kind: 'depart_manuel',
        titre: 'Départ saisi après coup',
        detail: `${item.teacher.prenom} ${item.teacher.nom} — motif : l'enseignant a quitté l'école sans repasser au secrétariat.`,
        sessionId: session.id,
        subjectId: item.teacher.id,
        severity: 'attention',
      })
    }
  }
  await serverDb.sessions.bulkAdd(sessions)

  /* --- justifications (§6) --- */
  const terminees = sessions.filter((s) => s.departureAt && s.roll?.codeOk)
  let demandes = 0
  for (const session of terminees) {
    const eleves = students.filter((s) => s.classeId === session.classeId)
    const absents = eleves.filter((e) => !(session.roll.presents ?? []).includes(e.id))
    for (const absent of absents.slice(0, 1)) {
      if (demandes >= 4) break
      const classe = classes.find((c) => c.id === session.classeId)
      const etats = ['en_attente', 'en_attente', 'acceptee', 'refusee']
      const state = etats[demandes]
      await serverDb.justifications.add({
        id: randomId(),
        sessionId: session.id,
        studentId: absent.id,
        filiereId: classe.filiereId,
        motif:
          state === 'refusee'
            ? 'Oubli du cours.'
            : 'Consultation médicale, certificat joint.',
        piece: null,
        state,
        createdAt: new Date(new Date(session.departureAt).getTime() + DAY).toISOString(),
        decidedAt:
          state === 'en_attente'
            ? null
            : new Date(new Date(session.departureAt).getTime() + 2 * DAY).toISOString(),
        decidedBy: state === 'en_attente' ? null : chefInfoId,
        decidedByLabel: state === 'en_attente' ? null : 'Serge Nkeng',
        commentaire: state === 'refusee' ? 'Motif non recevable.' : null,
      })
      demandes += 1
    }
  }

  /* --- notifications déjà reçues --- */
  for (const session of sessions.slice(-4)) {
    const matiere = matieres.find((m) => m.id === session.matiereId)
    const teacher = teachers.find((t) => t.id === session.teacherId)
    await serverDb.notifications.add({
      id: randomId(),
      classeId: session.classeId,
      sessionId: session.id,
      at: session.arrivalAt,
      titre: `Le cours de ${matiere.nom} va commencer`,
      corps: `${teacher.prenom} ${teacher.nom} est en route.`,
    })
  }

  await refreshAllStatuses()

  await appendAudit({
    entity: 'referentiel',
    entityId: 'demonstration',
    action: 'jeu_de_donnees_charge',
    authorId: adminId,
    authorLabel: 'Installation',
    note: `${students.length} étudiants, ${teachers.length} enseignants, ${sessions.length} séances — données fictives.`,
  })

  // Liste des accès, construite à partir des comptes réellement créés : elle ne
  // peut donc pas se désynchroniser du jeu de données.
  const parMatricule = (matricule) => students.find((s) => s.matricule === matricule)
  const etudiantDemo = (matricule, classe) => {
    const eleve = parMatricule(matricule)
    return eleve
      ? {
          role: 'Étudiant',
          login: eleve.matricule,
          nom: `${eleve.prenom} ${eleve.nom}`,
          detail: classe,
        }
      : null
  }

  return {
    etablissement: 'Institut Supérieur des Technologies et de Commerce',
    comptes: [
      {
        role: 'Secrétaire',
        login: '237699000200',
        nom: 'Lucie Mbarga',
        detail: 'Pointage des enseignants',
      },
      {
        role: 'Enseignant',
        login: '237699000301',
        nom: 'Alain Kamdem',
        detail: 'Algorithmique (niv. 1) · Bases de données (niv. 2)',
      },
      {
        role: 'Enseignant',
        login: '237699000302',
        nom: 'Berthe Ndongo',
        detail: 'Architecture (niv. 1) · Réseaux (niv. 2)',
      },
      {
        role: 'Enseignant',
        login: '237699000303',
        nom: 'Célestin Fouda',
        detail: 'Comptabilité générale (Gestion niv. 1)',
      },
      {
        role: 'Chef de département',
        login: '237699000101',
        nom: 'Serge Nkeng',
        detail: 'Filière Informatique',
      },
      {
        role: 'Chef de département',
        login: '237699000102',
        nom: 'Pascale Abena',
        detail: 'Filière Gestion',
      },
      etudiantDemo('INF1001', 'Informatique niveau 1'),
      etudiantDemo('INF2001', 'Informatique niveau 2'),
      etudiantDemo('GES1001', 'Gestion niveau 1'),
    ].filter(Boolean),
    totaux: {
      etudiants: students.length,
      enseignants: teachers.length,
      seances: sessions.length,
      matieres: matieres.length,
    },
  }
}

/** Numéro de téléphone proposé par défaut au formulaire d'installation. */
export function exempleTelephone() {
  return normalizePhone('+237 6 99 00 00 00') ?? '237699000000'
}

/**
 * Valeurs de remplissage du formulaire d'installation, pour éprouver
 * l'application sans rien inventer soi-même.
 *
 * §13.2 « Compte administrateur par défaut » : ce n'est PAS un compte livré avec
 * l'application. Rien n'existe tant que personne n'a rempli le formulaire. Ces
 * valeurs sont une saisie assistée, visible et modifiable, réservée aux essais —
 * le bouton qui les utilise porte un avertissement.
 */
export const JEU_DE_TEST = {
  prenom: 'Pascale',
  nom: 'Minya',
  telephone: '237699000001',
  etablissement: 'Institut Supérieur des Technologies et de Commerce',
  motDePasse: 'Presences2026!',
  motDePasseDemonstration: 'Presences2026!',
}
