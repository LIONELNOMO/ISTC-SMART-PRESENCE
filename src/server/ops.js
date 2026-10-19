/**
 * Les opérations d'écriture. Une seule porte, et elle est gardée.
 *
 * Chaque gestionnaire reçoit :
 *   ctx     — contexte résolu par guard.js (compte et rôles relus en base)
 *   payload — DÉJÀ validé contre le schéma du §13.1/§13.6
 *   meta    — { opId, clientAt, receivedAt, online }
 *
 * `clientAt` est l'heure déclarée par l'appareil : elle n'est jamais crue sans
 * contrôle (§13.5 « Heure locale antidatée »). `receivedAt` est l'heure du
 * serveur, et c'est elle qui tranche.
 */

import Dexie from 'dexie'

import { serverDb } from './db.js'
import { errors, logServer } from './errors.js'
import {
  requireRole,
  hasRole,
  assertAffectation,
  assertFiliereDuChef,
  assertStudentInSession,
  loadOwnSession,
  filieresDuChef,
  departementDuChef,
  revokeAllSessions,
} from './guard.js'
import { appendAudit, noteAnomalie } from './audit.js'
import { assertAllowed, recordFailure, recordSuccess } from './ratelimit.js'
import { getSettings, putSettings } from './settings.js'
import {
  validate,
  REFERENTIEL_SHAPES,
  IMPORT_ROW_SHAPE,
  roleCombinationProblem,
} from './schema.js'
import {
  computeStatus,
  checkTimesPlausible,
  hasOpenSession,
  scanWindowProblem,
  compareCounts,
  missingParts,
  SESSION_STATES,
} from './rules.js'
import {
  randomId,
  randomCode,
  constantTimeEqual,
  hashPassword,
  temporaryPassword,
  newHmacSecret,
} from '../lib/crypto.js'
import {
  verifyPointageQr,
  parsePointageQr,
  parsePresenceQr,
  newScanToken,
  PRESENCE_CLOCK_TOLERANCE_MS,
} from '../lib/qr-codes.js'
import { dayKey, nowIso, timeOnDayToIso, DAY, MINUTE } from '../lib/dates.js'
import { buildWhatsAppLink, renderTemplate, normalizePhone } from '../lib/whatsapp.js'
 import { absenceTotals, fichePaie, matiereLabel } from './reporting.js'

/**
 * Les primitives WebCrypto renvoient des promesses étrangères à Dexie. Attendues
 * nues dans une transaction, elles la laisseraient se valider avant la fin des
 * écritures (§13.6 « Erreur mal gérée »). Dexie.waitFor maintient la transaction
 * ouverte le temps du calcul.
 */
const hashPasswordTx = (plain) => Dexie.waitFor(hashPassword(plain))
const verifyPointageQrTx = (args) => Dexie.waitFor(verifyPointageQr(args))

/** Écart d'horloge toléré avant signalement (§13.4). */
const CLOCK_SKEW_FLAG_MS = 5 * MINUTE

/**
 * Retient une heure déclarée par un appareil de confiance (poste du secrétariat)
 * après contrôle. Hors des bornes, l'heure du serveur s'applique.
 */
function trustedInstant(clientAt, receivedAt, { maxPastMs = 7 * DAY } = {}) {
  const server = new Date(receivedAt).getTime()
  const claimed = new Date(clientAt ?? '').getTime()
  if (Number.isNaN(claimed)) return { at: receivedAt, skewMs: 0, replaced: true }
  if (claimed > server + CLOCK_SKEW_FLAG_MS) return { at: receivedAt, skewMs: claimed - server, replaced: true }
  if (server - claimed > maxPastMs) return { at: receivedAt, skewMs: server - claimed, replaced: true }
  return { at: new Date(claimed).toISOString(), skewMs: Math.abs(server - claimed), replaced: false }
}

/** Recalcule l'état d'une séance et l'écrit. Jamais écrit par un client (§13.3). */
async function refreshStatus(session) {
  const status = computeStatus(session)
  const next = { ...session, status, manque: missingParts(session) }
  await serverDb.sessions.put(next)
  return next
}

async function loadMatiereContext(matiereId) {
  const matiere = await serverDb.matieres.get(matiereId)
  if (!matiere) throw errors.introuvable()
  const classe = await serverDb.classes.get(matiere.classeId)
  if (!classe) throw errors.introuvable()
  return { matiere, classe }
}

async function classStudentIds(classeId, section = null) {
  const rows = await serverDb.students.where('classeId').equals(classeId).toArray()
  // §4 : si une section est précisée, seuls les étudiants de CE groupe.
  return rows
    .filter((s) => s.actif !== false && (section === null || (s.section ?? 'francophone') === section))
    .map((s) => s.id)
}

/**
 * Section demandée pour une séance (§4). On n'autorise « anglophone » que si
 * la filière de la classe propose cette section ; sinon tout retombe sur
 * « francophone ».
 */
async function sectionDemandee(payload, classe) {
  const demandee = (payload?.section ?? 'francophone') === 'anglophone' ? 'anglophone' : 'francophone'
  if (demandee !== 'anglophone') return 'francophone'
  const filiere = await serverDb.filieres.get(classe?.filiereId)
  if (!filiere || !filiere.sectionAnglophone) {
    throw errors.invalide("Cette filière n'a pas de section anglophone.")
  }
  return 'anglophone'
}

/* ================================================================== *
 *  Secrétariat (§4)
 * ================================================================== */

/**
 * Pointage d'arrivée par la secrétaire.
 * L'heure retenue est celle du poste du secrétariat, qui fait foi (§4), après
 * contrôle de plausibilité.
 */
async function secretariatArrivee(ctx, payload, meta) {
  requireRole(ctx, ['secretaire'])

  const teacher = await serverDb.teachers.get(payload.teacherId)
  if (!teacher || teacher.actif === false) throw errors.introuvable()

  // §13.3 « Pointage de soi-même » : impossible par construction, le cumul
  // secrétaire + enseignant est refusé à la création du compte. Deuxième barrière :
  if (ctx.teacherId && ctx.teacherId === teacher.id) throw errors.droits()

  const { matiere, classe } = await loadMatiereContext(payload.matiereId)

  // §4 : la matière doit relever du DÉPARTEMENT de l'enseignant (le secrétariat
  // cherche parmi les matières du département), ou lui être affectée.
  const filiere = await serverDb.filieres.get(classe?.filiereId)
  const memeDep = !!filiere?.departementId && filiere.departementId === (teacher.departementId ?? null)
  if (!memeDep) {
    const affectation = await serverDb.affectations
      .where('[teacherId+matiereId]')
      .equals([teacher.id, payload.matiereId])
      .first()
    if (!affectation) throw errors.invalide("Cette matière n'est pas du département de l'enseignant.")
  }

  // §4 : une seule séance ouverte à la fois.
  const existantes = await serverDb.sessions.where('teacherId').equals(teacher.id).toArray()
  if (hasOpenSession(existantes, teacher.id)) {
    throw errors.conflit(
      'Cet enseignant a déjà une séance en cours. Pointez son départ avant une nouvelle arrivée.',
    )
  }

  const { at: arrivalAt, skewMs } = trustedInstant(meta.clientAt, meta.receivedAt, { maxPastMs: DAY })
  const probleme = checkTimesPlausible({ arrivalAt, departureAt: null })
  if (probleme) throw errors.invalide(probleme)

  // Fin prévue : l'heure HH:MM rattachée au jour de l'arrivée ; si elle tombe
  // avant/à l'arrivée, elle vise le lendemain (cours de fin de soirée).
  let plannedEndAt = timeOnDayToIso(payload.finPrevue, arrivalAt)
  if (!plannedEndAt) throw errors.invalide("Heure de fin prévue invalide.")
  if (new Date(plannedEndAt).getTime() <= new Date(arrivalAt).getTime()) {
    plannedEndAt = new Date(new Date(plannedEndAt).getTime() + DAY).toISOString()
  }

  // §4 : section visée (francophone par défaut, anglophone si la filière en
  // propose une). Fixe les étudiants concernés et la langue affichée.
  const section = await sectionDemandee(payload, classe)
  const nomMatiere = matiereLabel(matiere, section)

  const session = {
    id: randomId(), // §13.3 : identifiant non devinable
    teacherId: teacher.id,
    matiereId: matiere.id,
    classeId: classe.id,
    section,
    // Niveau choisi par le secrétariat (pré-rempli depuis la classe).
    niveau: payload.niveau,
    day: dayKey(arrivalAt),
    arrivalAt,
    arrivalReceivedAt: meta.receivedAt,
    arrivalBy: ctx.userId,
    arrivalVia: 'secretariat',
    plannedEndAt,
    departureAt: null,
    departureManual: null,
    code: randomCode(6), // aléa cryptographique (§13.4)
    codeAttempts: 0,
    scanToken: newScanToken(), // jeton secret du QR de présence (§13.4)
    rollOpenedAt: null,
    rollClosedAt: null,
    roll: null,
    notifiee: false,
    status: SESSION_STATES.EN_COURS,
    manque: ['relevé', 'départ'],
    createdAt: nowIso(),
  }
  await serverDb.sessions.add(session)

  if (skewMs > CLOCK_SKEW_FLAG_MS) {
    await noteAnomalie({
      kind: 'ecart_horloge',
      titre: 'Écart d’horloge au pointage',
      detail: `Le poste du secrétariat déclarait une heure décalée de ${Math.round(skewMs / MINUTE)} min.`,
      sessionId: session.id,
      severity: 'attention',
    })
  }

  // §4 : notification aux étudiants. Elle demande du réseau (§9).
  let notifiee = false
  if (meta.online) {
    await serverDb.notifications.add({
      id: randomId(),
      classeId: classe.id,
      sessionId: session.id,
      at: nowIso(),
      // §13.9 « Contenu sensible » : matière et nom de l'enseignant, rien de plus.
      titre: `Le cours de ${nomMatiere} va commencer`,
      corps: `${teacher.prenom} ${teacher.nom} est en route.`,
    })
    notifiee = true
    await serverDb.sessions.put({ ...session, notifiee: true })
  }

  await appendAudit({
    entity: 'seance',
    entityId: session.id,
    action: 'arrivee_pointee',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    field: 'arrivalAt',
    after: arrivalAt,
    note: `${teacher.prenom} ${teacher.nom} — ${nomMatiere}`,
  })

  return { sessionId: session.id, code: session.code, notifiee, section }
}

/** Pointage de départ par la secrétaire. */
async function secretariatDepart(ctx, payload, meta) {
  requireRole(ctx, ['secretaire'])
  const session = await serverDb.sessions.get(payload.sessionId)
  if (!session) throw errors.introuvable()
  if (session.departureAt) throw errors.conflit('Le départ est déjà enregistré.')

  const { at: departureAt } = trustedInstant(meta.clientAt, meta.receivedAt, { maxPastMs: DAY })
  const probleme = checkTimesPlausible({ arrivalAt: session.arrivalAt, departureAt })
  if (probleme) throw errors.invalide(probleme)

  const updated = await refreshStatus({
    ...session,
    departureAt,
    departureReceivedAt: meta.receivedAt,
    departureBy: ctx.userId,
    departureVia: 'secretariat',
  })

  await appendAudit({
    entity: 'seance',
    entityId: session.id,
    action: 'depart_pointe',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    field: 'departureAt',
    after: departureAt,
  })

  return { status: updated.status }
}

/**
 * Départ saisi après coup, avec motif obligatoire (§4).
 * §13.4 « Départ saisi après coup de façon abusive » : motif, historique,
 * anomalie signalée à l'administration, et délai maximal.
 */
async function secretariatDepartManuel(ctx, payload, meta) {
  requireRole(ctx, ['secretaire'])
  const settings = await getSettings()
  const session = await serverDb.sessions.get(payload.sessionId)
  if (!session) throw errors.introuvable()
  if (session.departureAt) throw errors.conflit('Le départ est déjà enregistré.')

  const age = new Date(meta.receivedAt).getTime() - new Date(session.arrivalAt).getTime()
  if (age > settings.delaiReleveJours * DAY) {
    throw errors.invalide(
      `Cette séance a plus de ${settings.delaiReleveJours} jours : seule l'administration peut la corriger.`,
    )
  }

  const departureAt = timeOnDayToIso(payload.heure, session.arrivalAt)
  if (!departureAt) throw errors.invalide('Heure de départ invalide.')
  const probleme = checkTimesPlausible({ arrivalAt: session.arrivalAt, departureAt })
  if (probleme) throw errors.invalide(probleme)

  const updated = await refreshStatus({
    ...session,
    departureAt,
    departureReceivedAt: meta.receivedAt,
    departureBy: ctx.userId,
    departureVia: 'saisie_manuelle',
    departureManual: {
      motif: payload.motif,
      byUserId: ctx.userId,
      byLabel: ctx.label,
      at: meta.receivedAt,
    },
  })

  await appendAudit({
    entity: 'seance',
    entityId: session.id,
    action: 'depart_saisi_apres_coup',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    field: 'departureAt',
    before: null,
    after: departureAt,
    note: payload.motif,
    flagged: true,
  })

  const teacher = await serverDb.teachers.get(session.teacherId)
  await noteAnomalie({
    kind: 'depart_manuel',
    titre: 'Départ saisi après coup',
    detail: `${teacher ? `${teacher.prenom} ${teacher.nom}` : 'Enseignant'} — motif : ${payload.motif}`,
    sessionId: session.id,
    subjectId: session.teacherId,
    severity: 'attention',
  })

  return { status: updated.status }
}

/* ================================================================== *
 *  Pointage par scan, côté enseignant (§4)
 * ================================================================== */

/**
 * L'enseignant scanne le code affiché par la secrétaire.
 *
 * Cette opération EXIGE le réseau. C'est une décision de sécurité : la fenêtre
 * de 60 secondes du §4 ne peut être vérifiée que contre l'heure du serveur. Si
 * un scan hors ligne était accepté puis contrôlé à la synchronisation, une photo
 * du code prise le matin passerait le soir — exactement la faille §13.4
 * « Photo du code QR de pointage ». Quand le téléphone de l'enseignant n'a pas
 * de réseau, le §4 prévoit déjà la solution : la secrétaire pointe elle-même.
 */
async function pointageScan(ctx, payload, meta) {
  requireRole(ctx, ['enseignant'])
  if (!meta.online) throw errors.reseau()
  if (!ctx.teacherId) throw errors.droits()

  await assertAllowed('scan', ctx.userId)

  // On lit d'abord la station annoncée, sans rien croire d'autre.
  const parsed = parsePointageQr(payload.qr)
  if (!parsed) {
    await recordFailure('scan', ctx.userId, { raison: 'format' })
    throw errors.invalide("Ce code n'est pas un code de pointage.")
  }

  const station = await serverDb.stations.get(parsed.stationId)
  if (!station) {
    await recordFailure('scan', ctx.userId, { raison: 'station' })
    throw errors.invalide('Code de pointage inconnu.')
  }

  const check = await verifyPointageQrTx({
    raw: payload.qr,
    stationSecret: station.secret,
    receivedAt: new Date(meta.receivedAt).getTime(),
  })
  if (!check.ok) {
    await recordFailure('scan', ctx.userId, { raison: check.reason })
    if (check.reason === 'expire') {
      throw errors.invalide('Ce code a expiré. Demandez à la secrétaire de rafraîchir son écran.')
    }
    await noteAnomalie({
      kind: 'qr_invalide',
      titre: 'Code QR de pointage refusé',
      detail: `Signature ou format invalide (${check.reason}).`,
      subjectId: ctx.teacherId,
      severity: 'grave',
    })
    throw errors.invalide('Code de pointage invalide.')
  }

  // §13.4 « Rejeu d'un pointage » : un nonce ne sert qu'une fois.
  try {
    await serverDb.usedTokens.add({
      stationId: parsed.stationId,
      nonce: parsed.nonce,
      at: meta.receivedAt,
      userId: ctx.userId,
    })
  } catch {
    throw errors.conflit('Ce code a déjà été utilisé.')
  }

  // L'heure retenue est celle du créneau du code, donc celle du poste de la
  // secrétaire — jamais celle du téléphone de l'enseignant (§4).
  const stationAt = new Date(parsed.slot * 60_000).toISOString()

  const sessions = await serverDb.sessions.where('teacherId').equals(ctx.teacherId).toArray()
  const ouverte = sessions.find((s) => s.arrivalAt && !s.departureAt)

  if (ouverte) {
    const probleme = checkTimesPlausible({ arrivalAt: ouverte.arrivalAt, departureAt: stationAt })
    if (probleme) throw errors.invalide(probleme)
    const updated = await refreshStatus({
      ...ouverte,
      departureAt: stationAt,
      departureReceivedAt: meta.receivedAt,
      departureBy: ctx.userId,
      departureVia: 'scan',
    })
    await appendAudit({
      entity: 'seance',
      entityId: ouverte.id,
      action: 'depart_scanne',
      authorId: ctx.userId,
      authorLabel: ctx.label,
      field: 'departureAt',
      after: stationAt,
    })
    await recordSuccess('scan', ctx.userId)
    return { sens: 'depart', sessionId: ouverte.id, status: updated.status }
  }

  if (!payload.matiereId) throw errors.invalide('Choisissez la matière que vous venez enseigner.')
  await assertAffectation(ctx, payload.matiereId)
  const { matiere, classe } = await loadMatiereContext(payload.matiereId)

  // Fin prévue facultative au scan ; sans elle, pas de plafond.
  let plannedEndAt = null
  if (payload.finPrevue) {
    plannedEndAt = timeOnDayToIso(payload.finPrevue, stationAt)
    if (plannedEndAt && new Date(plannedEndAt).getTime() <= new Date(stationAt).getTime()) {
      plannedEndAt = new Date(new Date(plannedEndAt).getTime() + DAY).toISOString()
    }
  }

  const section = await sectionDemandee(payload, classe)
  const nomMatiere = matiereLabel(matiere, section)

  const session = {
    id: randomId(),
    teacherId: ctx.teacherId,
    matiereId: matiere.id,
    classeId: classe.id,
    section,
    niveau: classe.niveau,
    day: dayKey(stationAt),
    arrivalAt: stationAt,
    arrivalReceivedAt: meta.receivedAt,
    arrivalBy: station.secretaryUserId,
    arrivalVia: 'scan',
    plannedEndAt,
    departureAt: null,
    departureManual: null,
    code: randomCode(6),
    codeAttempts: 0,
    scanToken: newScanToken(),
    rollOpenedAt: null,
    rollClosedAt: null,
    roll: null,
    notifiee: false,
    status: SESSION_STATES.EN_COURS,
    manque: ['relevé', 'départ'],
    createdAt: nowIso(),
  }
  await serverDb.sessions.add(session)

  await serverDb.notifications.add({
    id: randomId(),
    classeId: classe.id,
    sessionId: session.id,
    at: nowIso(),
    titre: `Le cours de ${nomMatiere} va commencer`,
    corps: `${ctx.label} est en route.`,
  })
  await serverDb.sessions.put({ ...session, notifiee: true })

  await appendAudit({
    entity: 'seance',
    entityId: session.id,
    action: 'arrivee_scannee',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    field: 'arrivalAt',
    after: stationAt,
    note: nomMatiere,
  })
  await recordSuccess('scan', ctx.userId)

  // Le code de séance s'affiche dans l'application de l'enseignant (§4).
  return { sens: 'arrivee', sessionId: session.id, code: session.code }
}

/* ================================================================== *
 *  Relevé de présences (§5)
 * ================================================================== */

async function releveOuvrir(ctx, payload, meta) {
  requireRole(ctx, ['enseignant'])
  const session = await loadOwnSession(ctx, payload.sessionId)
  if (session.teacherId !== ctx.teacherId) throw errors.perimetre()
  const { at } = trustedInstant(meta.clientAt, meta.receivedAt, { maxPastMs: DAY })
  await serverDb.sessions.put({ ...session, rollOpenedAt: at, rollClosedAt: null })
  return { rollOpenedAt: at }
}

/**
 * Cœur partagé du changement de matière d'une séance en cours. Permis tant que
 * le relevé n'est pas validé ; la matière doit être de la même classe et
 * affectée à l'enseignant de la séance (§4). La séance arrive déjà chargée et
 * son périmètre vérifié par l'appelant.
 */
async function changeSessionMatiere(ctx, session, matiereId) {
  if (session.roll?.codeOk) {
    throw errors.conflit('Le relevé est déjà validé : la matière ne peut plus être changée.')
  }
  const matiere = await serverDb.matieres.get(matiereId)
  if (!matiere) throw errors.introuvable()
  if (matiere.classeId !== session.classeId) {
    throw errors.invalide("Cette matière n'est pas de la classe de la séance.")
  }
  const affectation = await serverDb.affectations
    .where('[teacherId+matiereId]')
    .equals([session.teacherId, matiereId])
    .first()
  if (!affectation) throw errors.invalide("Cette matière n'est pas affectée à cet enseignant.")

  if (matiere.id === session.matiereId) {
    return { sessionId: session.id, matiereId: matiere.id }
  }

  const before = session.matiereId
  await serverDb.sessions.put({ ...session, matiereId: matiere.id })
  await appendAudit({
    entity: 'seance',
    entityId: session.id,
    action: 'matiere_changee',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    field: 'matiereId',
    before,
    after: matiere.id,
    note: matiere.nom,
  })
  return { sessionId: session.id, matiereId: matiere.id }
}

/** Changement de matière par la secrétaire. */
async function secretariatChangerMatiere(ctx, payload) {
  requireRole(ctx, ['secretaire'])
  const session = await serverDb.sessions.get(payload.sessionId)
  if (!session) throw errors.introuvable()
  return changeSessionMatiere(ctx, session, payload.matiereId)
}

/** Changement de matière par l'enseignant, sur SA séance. */
async function releveChangerMatiere(ctx, payload) {
  requireRole(ctx, ['enseignant'])
  const session = await loadOwnSession(ctx, payload.sessionId)
  if (session.teacherId !== ctx.teacherId) throw errors.perimetre()
  return changeSessionMatiere(ctx, session, payload.matiereId)
}

/**
 * Appel déclaré par l'enseignant, sans secrétaire ni code (§4). Il coche les
 * présents ; ses heures ne sont pas saisies ici. En attente de pointage.
 * Un appel déjà déclaré le même jour pour la même matière est remplacé.
 */
async function releveDeclarer(ctx, payload, meta) {
  requireRole(ctx, ['enseignant'])
  if (!ctx.teacherId) throw errors.droits()
  await assertAffectation(ctx, payload.matiereId)
  const { matiere, classe } = await loadMatiereContext(payload.matiereId)

  // §4 : section visée (francophone par défaut).
  const section = (payload.section ?? 'francophone') === 'anglophone' ? 'anglophone' : 'francophone'
  const eleves = new Set(await classStudentIds(classe.id, section))
  const presents = (payload.presents ?? []).filter((id) => eleves.has(id))
  const day = dayKey(meta.receivedAt)

  const miens = await serverDb.declares.where('teacherId').equals(ctx.teacherId).toArray()
  const existant = miens.find(
    (d) => d.matiereId === payload.matiereId && d.day === day && (d.section ?? 'francophone') === section && !d.sessionId,
  )

  let id
  if (existant) {
    id = existant.id
    await serverDb.declares.update(id, {
      presents,
      comptePhysique: payload.comptePhysique ?? null,
      declaredAt: meta.receivedAt,
      niveau: payload.niveau,
    })
  } else {
    id = randomId()
    await serverDb.declares.add({
      id,
      teacherId: ctx.teacherId,
      matiereId: payload.matiereId,
      classeId: classe.id,
      section,
      niveau: payload.niveau,
      day,
      presents,
      comptePhysique: payload.comptePhysique ?? null,
      declaredAt: meta.receivedAt,
      sessionId: null,
    })
  }

  await appendAudit({
    entity: 'releve_declare',
    entityId: id,
    action: existant ? 'appel_declare_modifie' : 'appel_declare',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    note: `${matiereLabel(matiere, section)} — ${presents.length} présent(s)`,
  })

  return { id, presents: presents.length }
}

/**
 * Le secrétariat pointe les heures d'un appel déclaré : il attribue une
 * arrivée et un départ au jour de l'appel, ce qui crée la séance avec les
 * présences déjà cochées. Elle reste marquée « déclarée par l'enseignant ».
 */
async function secretariatPointerDeclare(ctx, payload, meta) {
  requireRole(ctx, ['secretaire'])
  const decl = await serverDb.declares.get(payload.declareId)
  if (!decl) throw errors.introuvable()
  if (decl.sessionId) throw errors.conflit('Cet appel a déjà été pointé.')

  const teacher = await serverDb.teachers.get(decl.teacherId)
  const matiere = await serverDb.matieres.get(decl.matiereId)
  if (!teacher || !matiere) throw errors.introuvable()

  const arrivalAt = `${decl.day}T${payload.heureArrivee}:00.000Z`
  const departureAt = `${decl.day}T${payload.heureDepart}:00.000Z`
  const probleme = checkTimesPlausible({ arrivalAt, departureAt })
  if (probleme) throw errors.invalide(probleme)

  const section = decl.section ?? 'francophone'
  const eleves = new Set(await classStudentIds(decl.classeId, section))
  const presents = (decl.presents ?? []).filter((id) => eleves.has(id))

  const id = randomId()
  await serverDb.sessions.add({
    id,
    teacherId: decl.teacherId,
    matiereId: decl.matiereId,
    classeId: decl.classeId,
    section,
    niveau: decl.niveau,
    day: decl.day,
    arrivalAt,
    arrivalReceivedAt: meta.receivedAt,
    arrivalBy: ctx.userId,
    arrivalVia: 'secretariat',
    plannedEndAt: null,
    departureAt,
    departureReceivedAt: meta.receivedAt,
    departureBy: ctx.userId,
    departureVia: 'saisie_manuelle',
    departureManual: null,
    code: randomCode(6),
    codeAttempts: 0,
    scanToken: newScanToken(),
    rollOpenedAt: null,
    rollClosedAt: meta.receivedAt,
    roll: {
      validatedAt: decl.declaredAt,
      receivedAt: meta.receivedAt,
      codeOk: false,
      presents,
      comptePhysique: decl.comptePhysique ?? null,
      byUserId: ctx.userId,
      lastEditAt: meta.receivedAt,
    },
    declareEnseignant: true,
    notifiee: true,
    status: SESSION_STATES.TERMINEE,
    createdAt: nowIso(),
  })
  await serverDb.declares.update(decl.id, { sessionId: id })

  await appendAudit({
    entity: 'seance',
    entityId: id,
    action: 'releve_declare_pointe',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    note: `${teacher.prenom} ${teacher.nom} — ${decl.day}`,
  })

  const heures = Math.round(((new Date(departureAt) - new Date(arrivalAt)) / 3600000) * 10) / 10
  await appendAvis(
    decl.teacherId,
    'heures_ajoutees',
    'Vos heures ont été enregistrées',
    `Le ${decl.day} : ${matiereLabel(matiere, section)} — ${heures} h, pointées par le secrétariat.`,
    meta.receivedAt,
  )

  return { id, teacherId: decl.teacherId }
}

/**
 * Dépose un avis destiné à un enseignant (pop-up à l'ouverture de son espace).
 */
async function appendAvis(teacherId, type, titre, corps, at) {
  await serverDb.avis.add({
    id: randomId(),
    teacherId,
    type,
    titre: String(titre).slice(0, 160),
    corps: String(corps).slice(0, 300),
    at,
  })
}

/**
 * Chacun modifie son propre profil : prénom, nom, téléphone (§2). Si la
 * personne se connecte avec son téléphone, le changer met aussi à jour son
 * identifiant (avec contrôle d'unicité).
 */
async function compteProfil(ctx, payload) {
  const user = await serverDb.users.get(ctx.userId)
  if (!user) throw errors.introuvable()

  const prenom = String(payload.prenom).trim()
  const nom = String(payload.nom).trim()
  let telephone = payload.telephone != null ? String(payload.telephone).trim() : user.telephone ?? ''
  telephone = telephone === '' ? null : telephone

  const patch = { prenom, nom, telephone }

  const ancienTel = user.telephone ?? ''
  const parTel = ancienTel !== '' && user.loginKey === ancienTel.toLowerCase()
  if (parTel && telephone && telephone !== ancienTel) {
    const nouvelleClef = telephone.toLowerCase()
    const conflit = await serverDb.users.where('loginKey').equals(nouvelleClef).first()
    if (conflit && conflit.id !== user.id) {
      throw errors.conflit('Ce numéro est déjà utilisé comme identifiant.')
    }
    patch.login = telephone
    patch.loginKey = nouvelleClef
  }

  await serverDb.users.update(user.id, patch)
  if (user.teacherId) {
    await serverDb.teachers.update(user.teacherId, { prenom, nom, telephone: telephone ?? '' })
  }
  if (user.studentId) {
    await serverDb.students.update(user.studentId, { prenom, nom })
  }

  await appendAudit({
    entity: 'compte',
    entityId: user.id,
    action: 'profil_modifie',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    note: `${prenom} ${nom}`,
  })

  return { id: user.id, identifiantChange: Boolean(patch.login) }
}

/**
 * Création d'une fiche de paie sur une PÉRIODE (§7). Le secrétariat choisit
 * l'enseignant et les bornes ; les heures sont calculées depuis les séances
 * terminées de la fenêtre non encore portées par une fiche, et ces séances
 * sont réservées (une séance = au plus une fiche). Aucun montant (§13.10).
 */
async function secretariatCreerFiche(ctx, payload, meta) {
  requireRole(ctx, ['secretaire'])
  const teacher = await serverDb.teachers.get(payload.teacherId)
  if (!teacher) throw errors.introuvable()

  const debut = String(payload.debut).slice(0, 10)
  const fin = String(payload.fin).slice(0, 10)
  if (debut > fin) throw errors.invalide('La date de début doit précéder la date de fin.')

  const fiche = await fichePaie(payload.teacherId, debut, fin, false)
  if (fiche.totalSeances === 0) {
    throw errors.invalide(
      "Aucune heure payable sur cette période : aucune séance terminée, " +
        'ou toutes sont déjà sur une autre fiche.',
    )
  }
  const arrondi = (v) => Math.round((Number(v) || 0) * 100) / 100
  const parNiveau = fiche.parNiveau.map((n) => ({
    niveau: Number(n.niveau),
    heures: arrondi(n.heures),
    seances: Number(n.seances) || 0,
    montant: null,
  }))
  const parMatiere = fiche.parMatiere.map((m) => ({
    niveau: Number(m.niveau),
    matiere: m.matiere,
    matiereEn: m.matiereEn ?? null,
    heures: arrondi(m.heures),
    seances: Number(m.seances) || 0,
    montant: null,
  }))
  const settings = await getSettings()

  const id = randomId()
  await serverDb.fiches.add({
    id,
    teacherId: payload.teacherId,
    periode: fiche.periode,
    debut,
    fin,
    statut: 'en_attente',
    totalHeures: arrondi(fiche.totalHeures),
    montant: null,
    parNiveau,
    parMatiere,
    etablissement: settings.etablissement ?? '',
    sentBy: ctx.userId,
    sentByLabel: ctx.label,
    sentAt: meta.receivedAt,
    paidAt: null,
    paidBy: null,
    paidByLabel: '',
  })

  // Réservation : chaque séance de la période est rattachée à cette fiche.
  for (const sid of fiche.seanceIds) {
    await serverDb.sessions.update(sid, { ficheId: id })
  }

  await appendAudit({
    entity: 'fiche',
    entityId: id,
    action: 'fiche_creee',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    note: `${teacher.prenom} ${teacher.nom} — ${fiche.periode}`,
  })

  return { id, teacherId: payload.teacherId }
}

/** Annule une fiche EN ATTENTE : ses séances redeviennent disponibles. */
async function secretariatAnnulerFiche(ctx, payload, meta) {
  requireRole(ctx, ['secretaire'])
  const fiche = await serverDb.fiches.get(payload.ficheId)
  if (!fiche) throw errors.introuvable()
  if (fiche.statut !== 'en_attente') {
    throw errors.invalide('Seule une fiche en attente peut être annulée.')
  }
  const sessions = await serverDb.sessions.where('teacherId').equals(fiche.teacherId).toArray()
  for (const s of sessions) {
    if (s.ficheId === payload.ficheId) await serverDb.sessions.update(s.id, { ficheId: null })
  }
  await serverDb.fiches.delete(payload.ficheId)
  await appendAudit({
    entity: 'fiche',
    entityId: payload.ficheId,
    action: 'fiche_annulee',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    note: fiche.periode,
  })
  return { ok: true }
}

/**
 * L'administration paie une fiche en attente : le montant (taux × heures) est
 * recalculé puis FIGÉ, et la fiche passe à « payée ». Refusé tant qu'une séance
 * n'a pas de taux (§7).
 */
async function adminPayerFiche(ctx, payload, meta) {
  requireRole(ctx, ['administration'])
  if (!meta.online) throw errors.reseau()

  const fiche = await serverDb.fiches.get(payload.ficheId)
  if (!fiche) throw errors.introuvable()
  if (fiche.statut === 'payee') throw errors.conflit('Cette fiche est déjà payée.')
  if (fiche.statut !== 'en_attente') throw errors.invalide('Cette fiche ne peut pas être payée.')

  const calc = await fichePaie(fiche.teacherId, null, null, true, payload.ficheId)
  if (calc.totalSeances === 0) throw errors.invalide('Cette fiche ne porte plus aucune séance.')
  if (calc.montantIncomplet) {
    throw errors.invalide(
      "Certaines séances n'ont pas de taux horaire. Définissez les taux manquants avant de payer.",
    )
  }

  const arrondi = (v) => Math.round((Number(v) || 0) * 100) / 100
  const parNiveau = calc.parNiveau.map((n) => ({
    niveau: Number(n.niveau),
    heures: arrondi(n.heures),
    seances: Number(n.seances) || 0,
    montant: Number(n.montant) || 0,
  }))
  const parMatiere = calc.parMatiere.map((m) => ({
    niveau: Number(m.niveau),
    matiere: m.matiere,
    matiereEn: m.matiereEn ?? null,
    heures: arrondi(m.heures),
    seances: Number(m.seances) || 0,
    montant: Number(m.montant) || 0,
  }))

  // Impôt (§7) : taux saisi par l'administration, retenu sur le brut.
  const brut = Number(calc.montant) || 0
  const tauxImpot = Math.max(0, Math.min(100, Number(payload.tauxImpot) || 0))
  const impot = Math.round((brut * tauxImpot) / 100)
  const net = brut - impot

  await serverDb.fiches.update(payload.ficheId, {
    statut: 'payee',
    montant: brut,
    tauxImpot,
    impot,
    net,
    totalHeures: arrondi(calc.totalHeures),
    parNiveau,
    parMatiere,
    paidAt: meta.receivedAt,
    paidBy: ctx.userId,
    paidByLabel: ctx.label,
  })

  await appendAudit({
    entity: 'fiche',
    entityId: payload.ficheId,
    action: 'fiche_payee',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    note: fiche.periode,
  })
  await appendAvis(
    fiche.teacherId,
    'fiche',
    'Une fiche de paie a été réglée',
    'Une période a été payée. Retrouvez le détail dans « Historique de paiement ».',
    meta.receivedAt,
  )

  return { id: payload.ficheId, montant: brut, impot, net }
}

/**
 * Crée une séance pour un JOUR PASSÉ (coupure, secrétaire absente…). Compte
 * seulement les heures de l'enseignant ; aucune présence d'étudiant (§13.5).
 * Antidatage réservé au secrétariat, borné à 30 jours, refusé dans le futur.
 */
async function secretariatSeanceAnterieure(ctx, payload, meta) {
  requireRole(ctx, ['secretaire'])
  const teacher = await serverDb.teachers.get(payload.teacherId)
  if (!teacher) throw errors.introuvable()

  const { matiere, classe } = await loadMatiereContext(payload.matiereId)

  // La matière doit relever du DÉPARTEMENT de l'enseignant, ou lui être affectée
  // (même règle qu'au pointage d'arrivée, §4).
  const filiere = await serverDb.filieres.get(classe?.filiereId)
  const memeDep = !!filiere?.departementId && filiere.departementId === (teacher.departementId ?? null)
  if (!memeDep) {
    const affectation = await serverDb.affectations
      .where('[teacherId+matiereId]')
      .equals([payload.teacherId, payload.matiereId])
      .first()
    if (!affectation) throw errors.invalide("Cette matière n'est pas du département de l'enseignant.")
  }

  const arrivalAt = `${payload.jour}T${payload.heureArrivee}:00.000Z`
  const departureAt = `${payload.jour}T${payload.heureDepart}:00.000Z`
  const tArr = new Date(arrivalAt).getTime()
  if (Number.isNaN(tArr)) throw errors.invalide('Date ou heure invalide.')

  const now = Date.now()
  if (tArr > now) throw errors.invalide("Une séance antérieure ne peut pas être dans le futur.")
  if (tArr < now - 30 * DAY) {
    throw errors.invalide('Au-delà de 30 jours, une séance ne peut plus être saisie.')
  }

  const probleme = checkTimesPlausible({ arrivalAt, departureAt })
  if (probleme) throw errors.invalide(probleme)

  const section = await sectionDemandee(payload, classe)
  const nomMatiere = matiereLabel(matiere, section)

  const id = randomId()
  await serverDb.sessions.add({
    id,
    teacherId: teacher.id,
    matiereId: matiere.id,
    classeId: classe.id,
    section,
    niveau: payload.niveau,
    day: payload.jour,
    arrivalAt,
    arrivalReceivedAt: meta.receivedAt,
    arrivalBy: ctx.userId,
    arrivalVia: 'secretariat',
    plannedEndAt: null, // pas de plafond : heures payées = temps réel saisi
    departureAt,
    departureReceivedAt: meta.receivedAt,
    departureBy: ctx.userId,
    departureVia: 'saisie_manuelle',
    departureManual: payload.motif
      ? { motif: payload.motif, byUserId: ctx.userId, byLabel: ctx.label, at: meta.receivedAt }
      : null,
    code: randomCode(6),
    codeAttempts: 0,
    scanToken: newScanToken(),
    rollOpenedAt: null,
    rollClosedAt: meta.receivedAt,
    // Relevé « validé » d'office : la séance compte les heures (pas de code à
    // échanger a posteriori). Aucun présent → aucune absence (saisie figée).
    roll: {
      validatedAt: meta.receivedAt,
      receivedAt: meta.receivedAt,
      codeOk: true,
      presents: [],
      comptePhysique: null,
      byUserId: ctx.userId,
      lastEditAt: meta.receivedAt,
    },
    saisieAnterieure: true,
    saisieMotif: payload.motif ?? null,
    notifiee: true,
    status: SESSION_STATES.TERMINEE,
    createdAt: nowIso(),
  })

  await appendAudit({
    entity: 'seance',
    entityId: id,
    action: 'seance_anterieure_creee',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    note: `${teacher.prenom} ${teacher.nom} — ${payload.jour}${payload.motif ? ' — ' + payload.motif : ''}`,
  })

  const heures = Math.round(((new Date(departureAt) - new Date(arrivalAt)) / 3600000) * 10) / 10
  await appendAvis(
    teacher.id,
    'heures_ajoutees',
    'Des heures ont été ajoutées',
    `Le ${payload.jour} : ${nomMatiere} — ${heures} h, ajoutées par le secrétariat.`,
    meta.receivedAt,
  )

  return { id, teacherId: teacher.id }
}

async function releveFermer(ctx, payload, meta) {
  requireRole(ctx, ['enseignant'])
  const session = await loadOwnSession(ctx, payload.sessionId)
  if (session.teacherId !== ctx.teacherId) throw errors.perimetre()
  const { at } = trustedInstant(meta.clientAt, meta.receivedAt, { maxPastMs: DAY })
  await serverDb.sessions.put({ ...session, rollClosedAt: at })
  return { rollClosedAt: at }
}

/**
 * Validation du relevé par le code de séance.
 *
 *  §13.4 « Code de séance partagé » — le code n'est accepté que depuis le compte
 *         de l'enseignant de la séance.
 *  §13.4 « Code de séance deviné »  — 5 essais, puis blocage.
 *  §12   — un code faux conserve le relevé mais laisse la séance « incomplète ».
 */
async function releveValider(ctx, payload, meta) {
  requireRole(ctx, ['enseignant'])
  if (!ctx.teacherId) throw errors.droits()
  await assertAffectation(ctx, payload.matiereId)
  await assertAllowed('code_seance', ctx.userId)

  const settings = await getSettings()
  const limite = new Date(meta.receivedAt).getTime() - settings.delaiReleveJours * DAY

  // Recherche de la séance : par identifiant si l'appareil la connaissait,
  // sinon la plus récente séance de cette matière en attente de relevé (§5).
  let session = null
  if (payload.sessionId) {
    session = await serverDb.sessions.get(payload.sessionId)
    if (!session) throw errors.introuvable()
    if (session.teacherId !== ctx.teacherId) throw errors.perimetre()
  } else {
    const candidates = (
      await serverDb.sessions.where('teacherId').equals(ctx.teacherId).toArray()
    )
      .filter(
        (s) =>
          s.matiereId === payload.matiereId &&
          new Date(s.arrivalAt).getTime() >= limite &&
          !(s.roll?.codeOk === true),
      )
      .sort((a, b) => (a.arrivalAt < b.arrivalAt ? 1 : -1))
    session = candidates[0] ?? null
  }

  if (!session) {
    throw errors.invalide(
      `Aucune séance de cette matière ouverte par le secrétariat dans les ${settings.delaiReleveJours} derniers jours.`,
    )
  }

  if (new Date(session.arrivalAt).getTime() < limite) {
    throw errors.invalide(
      `Le délai de ${settings.delaiReleveJours} jours est dépassé. Adressez-vous à l'administration.`,
    )
  }

  // Comparaison à temps constant du code de séance.
  const codeOk = constantTimeEqual(payload.code, session.code)

  // Les présents doivent appartenir à la classe de la matière (§5) ET à la
  // section de la séance (§4).
  const eleves = await classStudentIds(session.classeId, session.section ?? 'francophone')
  const autorises = new Set(eleves)
  const presents = (payload.presents ?? []).filter((id) => autorises.has(id))
  if ((payload.presents ?? []).length !== presents.length) {
    await noteAnomalie({
      kind: 'presents_hors_classe',
      titre: 'Relevé contenant des étudiants hors classe',
      detail: `${(payload.presents ?? []).length - presents.length} identifiant(s) écarté(s).`,
      sessionId: session.id,
      subjectId: ctx.teacherId,
      severity: 'grave',
    })
  }

  const { at: validatedAt, skewMs } = trustedInstant(meta.clientAt, meta.receivedAt, {
    maxPastMs: settings.delaiReleveJours * DAY,
  })

  const scans = await serverDb.attendance.where('sessionId').equals(session.id).toArray()
  const scansRetenus = scans.filter((s) => s.status === 'present')

  const roll = {
    validatedAt,
    receivedAt: meta.receivedAt,
    codeOk,
    presents,
    comptePhysique: payload.comptePhysique ?? null,
    scansAuMomentDeLaValidation: scansRetenus.length,
    byUserId: ctx.userId,
    lastEditAt: validatedAt,
    skewMs,
  }

  const next = await refreshStatus({
    ...session,
    roll,
    rollClosedAt: session.rollClosedAt ?? validatedAt,
    codeAttempts: codeOk ? 0 : (session.codeAttempts ?? 0) + 1,
  })

  if (!codeOk) {
    const { blocked, remaining } = await recordFailure('code_seance', ctx.userId, {
      subjectId: ctx.teacherId,
    })
    await appendAudit({
      entity: 'releve',
      entityId: session.id,
      action: 'code_seance_refuse',
      authorId: ctx.userId,
      authorLabel: ctx.label,
      note: 'Relevé conservé, séance laissée incomplète.',
      flagged: true,
    })
    return {
      ok: false,
      raison: 'code',
      sessionId: session.id,
      status: next.status,
      essaisRestants: blocked ? 0 : remaining,
      message: 'Code de séance incorrect. Le relevé est conservé : corrigez le code pour le valider.',
    }
  }

  await recordSuccess('code_seance', ctx.userId)

  const ecarts = compareCounts({
    scans: scansRetenus.length,
    comptePhysique: roll.comptePhysique,
    coches: presents.length,
    effectif: eleves.length,
  })
  for (const ecart of ecarts) {
    await noteAnomalie({
      kind: ecart.kind,
      titre: 'Écart sur un relevé de présences',
      detail: ecart.message,
      sessionId: session.id,
      subjectId: ctx.teacherId,
      severity: ecart.severity,
    })
  }

  if (skewMs > CLOCK_SKEW_FLAG_MS) {
    await noteAnomalie({
      kind: 'ecart_horloge',
      titre: 'Écart d’horloge sur un relevé',
      detail: `Heure déclarée décalée de ${Math.round(skewMs / MINUTE)} min par rapport au serveur.`,
      sessionId: session.id,
      subjectId: ctx.teacherId,
      severity: 'info',
    })
  }

  await appendAudit({
    entity: 'releve',
    entityId: session.id,
    action: 'releve_valide',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    field: 'presents',
    after: presents,
    note: `${presents.length}/${eleves.length} présents`,
  })

  return {
    ok: true,
    sessionId: session.id,
    status: next.status,
    presents: presents.length,
    effectif: eleves.length,
    ecarts,
  }
}

/**
 * Correction d'un relevé (§5).
 * L'enseignant dispose du délai réglé ; passé ce délai, seul le chef de
 * département peut modifier. Le délai est vérifié ICI (§13.3).
 */
async function releveCorriger(ctx, payload, meta) {
  requireRole(ctx, ['enseignant', 'chef'])
  const settings = await getSettings()
  const session = await loadOwnSession(ctx, payload.sessionId)
  if (!session.roll?.codeOk) throw errors.invalide("Ce relevé n'a pas encore été validé.")

  const estEnseignantDeLaSeance = ctx.teacherId && session.teacherId === ctx.teacherId
  const estChefCompetent = await (async () => {
    if (!hasRole(ctx, 'chef')) return false
    const classe = await serverDb.classes.get(session.classeId)
    const ids = await filieresDuChef(ctx)
    return Boolean(classe && ids.includes(classe.filiereId))
  })()

  if (!estEnseignantDeLaSeance && !estChefCompetent) throw errors.perimetre()

  if (estEnseignantDeLaSeance && !estChefCompetent) {
    const age = new Date(meta.receivedAt).getTime() - new Date(session.roll.validatedAt).getTime()
    if (age > settings.delaiCorrectionHeures * 3_600_000) {
      throw errors.invalide(
        `Le délai de correction de ${settings.delaiCorrectionHeures} h est dépassé. Seul le chef de département peut encore modifier ce relevé.`,
      )
    }
  }

  const eleves = await classStudentIds(session.classeId, session.section ?? 'francophone')
  const autorises = new Set(eleves)
  const presents = (payload.presents ?? []).filter((id) => autorises.has(id))
  const avant = session.roll.presents ?? []

  // §9 règle 4 : entre deux modifications, la plus récente l'emporte.
  const next = await refreshStatus({
    ...session,
    roll: {
      ...session.roll,
      presents,
      lastEditAt: meta.receivedAt,
      lastEditBy: ctx.userId,
      lastEditRole: estChefCompetent && !estEnseignantDeLaSeance ? 'chef' : 'enseignant',
    },
  })

  await appendAudit({
    entity: 'releve',
    entityId: session.id,
    action: 'releve_corrige',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    field: 'presents',
    before: avant,
    after: presents,
    note: payload.motif ?? null,
  })

  return { ok: true, status: next.status, presents: presents.length }
}

/* ================================================================== *
 *  Scan de présence, côté étudiant (§5)
 * ================================================================== */

/**
 *  §13.4 « Scan forgé sans code »   — le jeton secret de la séance est exigé.
 *  §13.3 « Étudiant hors classe »   — appartenance à la classe vérifiée.
 *  §13.4 « Double scan »            — clef primaire [sessionId+studentId].
 *  §9    — un scan arrivé avant la séance est gardé en attente.
 */
async function presenceScan(ctx, payload, meta) {
  requireRole(ctx, ['etudiant'])
  if (!ctx.studentId) throw errors.droits()
  await assertAllowed('scan', ctx.userId)

  const parsed = parsePresenceQr(payload.qr)
  if (!parsed) {
    await recordFailure('scan', ctx.userId, { raison: 'format' })
    throw errors.invalide("Ce code n'est pas un code de présence.")
  }

  const session = await serverDb.sessions.get(parsed.sessionId)

  // §9 : le scan peut précéder la séance si le secrétariat était hors ligne.
  if (!session) {
    await serverDb.attendance.put({
      sessionId: parsed.sessionId,
      studentId: ctx.studentId,
      id: randomId(),
      status: 'attente_seance',
      source: 'scan',
      at: meta.receivedAt,
      receivedAt: meta.receivedAt,
      deviceId: payload.deviceId,
      tokenPresente: parsed.scanToken, // vérifié à l'arrivée de la séance
    })
    return { status: 'attente_seance', message: 'Scan enregistré. La séance n’est pas encore connue du serveur.' }
  }

  // Jeton secret : un scan sans lui est refusé.
  if (!constantTimeEqual(parsed.scanToken, session.scanToken)) {
    await recordFailure('scan', ctx.userId, { raison: 'jeton' })
    await noteAnomalie({
      kind: 'scan_jeton_invalide',
      titre: 'Scan de présence sans jeton valide',
      detail: 'Un scan a été présenté avec un jeton de séance incorrect.',
      sessionId: session.id,
      subjectId: ctx.studentId,
      severity: 'grave',
    })
    throw errors.invalide('Code de présence invalide.')
  }

  await assertStudentInSession(ctx, session) // lève perimetre si autre classe

  const probleme = scanWindowProblem(session, {
    receivedAt: meta.receivedAt,
    toleranceMs: PRESENCE_CLOCK_TOLERANCE_MS,
  })
  if (probleme) throw errors.invalide(probleme)

  const existing = await serverDb.attendance.get([session.id, ctx.studentId])
  if (existing?.status === 'present') {
    // Doublon ignoré, sans erreur : l'étudiant reste présent une seule fois.
    return { status: 'present', duplicate: true }
  }

  // §13.4 « Scan pour un camarade » : deux comptes, un seul appareil.
  const memeAppareil = await serverDb.attendance
    .where('sessionId')
    .equals(session.id)
    .filter((row) => row.deviceId === payload.deviceId && row.studentId !== ctx.studentId)
    .first()

  await serverDb.attendance.put({
    sessionId: session.id,
    studentId: ctx.studentId,
    id: existing?.id ?? randomId(),
    status: 'present',
    source: 'scan',
    at: meta.receivedAt,
    receivedAt: meta.receivedAt,
    deviceId: payload.deviceId,
  })

  if (memeAppareil) {
    await noteAnomalie({
      kind: 'appareil_partage',
      titre: 'Deux comptes sur un même appareil',
      detail: 'Deux étudiants ont scanné la même séance depuis le même téléphone.',
      sessionId: session.id,
      subjectId: ctx.studentId,
      severity: 'attention',
    })
  }

  return { status: 'present', duplicate: false }
}

/* ================================================================== *
 *  Justifications (§6)
 * ================================================================== */

async function justificationDemander(ctx, payload, meta) {
  requireRole(ctx, ['etudiant'])
  if (!meta.online) throw errors.reseau() // §9
  if (!ctx.studentId) throw errors.droits()

  const session = await serverDb.sessions.get(payload.sessionId)
  if (!session) throw errors.introuvable()
  const student = await assertStudentInSession(ctx, session)
  if (computeStatus(session) !== SESSION_STATES.TERMINEE) {
    throw errors.invalide("Cette séance n'est pas encore terminée.")
  }

  const presents = new Set(session.roll?.presents ?? [])
  if (presents.has(ctx.studentId)) throw errors.invalide('Vous êtes marqué présent à cette séance.')

  const deja = await serverDb.justifications
    .where('[sessionId+studentId]')
    .equals([payload.sessionId, ctx.studentId])
    .first()
  if (deja) throw errors.conflit('Une demande existe déjà pour cette absence.')

  // §13.7 : limite du nombre de dépôts par étudiant.
  const total = await serverDb.justifications.where('studentId').equals(ctx.studentId).count()
  if (total >= 50) throw errors.invalide('Trop de demandes déposées. Contactez votre chef de département.')

  const classe = await serverDb.classes.get(session.classeId)

  await serverDb.justifications.add({
    id: randomId(),
    sessionId: payload.sessionId,
    studentId: ctx.studentId,
    filiereId: classe?.filiereId ?? null,
    motif: payload.motif,
    piece: payload.piece ?? null, // déjà contrôlée par files.js + schema.js
    state: 'en_attente',
    createdAt: meta.receivedAt,
    decidedAt: null,
    decidedBy: null,
    commentaire: null,
  })

  await appendAudit({
    entity: 'justification',
    entityId: payload.sessionId,
    action: 'demande_deposee',
    authorId: ctx.userId,
    authorLabel: `${student.prenom} ${student.nom}`,
    note: payload.motif,
  })

  return { ok: true }
}

async function justificationDecider(ctx, payload, meta) {
  requireRole(ctx, ['chef'])
  if (!meta.online) throw errors.reseau()

  const justification = await serverDb.justifications.get(payload.justificationId)
  if (!justification) throw errors.introuvable()
  await assertFiliereDuChef(ctx, justification.filiereId)

  const before = justification.state
  await serverDb.justifications.put({
    ...justification,
    state: payload.decision,
    commentaire: payload.commentaire ?? null,
    decidedAt: meta.receivedAt,
    decidedBy: ctx.userId,
    decidedByLabel: ctx.label,
  })

  await appendAudit({
    entity: 'justification',
    entityId: justification.id,
    action: payload.decision === 'acceptee' ? 'justification_acceptee' : 'justification_refusee',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    field: 'state',
    before,
    after: payload.decision,
    note: payload.commentaire ?? null,
  })

  return { ok: true }
}

/** Le chef peut justifier directement, sans demande de l'étudiant (§6). */
async function justificationDirecte(ctx, payload, meta) {
  requireRole(ctx, ['chef'])
  if (!meta.online) throw errors.reseau()

  const session = await serverDb.sessions.get(payload.sessionId)
  if (!session) throw errors.introuvable()
  const classe = await serverDb.classes.get(session.classeId)
  await assertFiliereDuChef(ctx, classe?.filiereId)

  const student = await serverDb.students.get(payload.studentId)
  if (!student || student.classeId !== session.classeId) throw errors.perimetre()

  const existing = await serverDb.justifications
    .where('[sessionId+studentId]')
    .equals([payload.sessionId, payload.studentId])
    .first()
  const row = {
    id: existing?.id ?? randomId(),
    sessionId: payload.sessionId,
    studentId: payload.studentId,
    filiereId: classe?.filiereId ?? null,
    motif: existing?.motif ?? 'Justifiée par le chef de département',
    piece: existing?.piece ?? null,
    state: 'acceptee',
    createdAt: existing?.createdAt ?? meta.receivedAt,
    decidedAt: meta.receivedAt,
    decidedBy: ctx.userId,
    decidedByLabel: ctx.label,
    commentaire: payload.commentaire ?? null,
    directe: true,
  }
  await serverDb.justifications.put(row)

  await appendAudit({
    entity: 'justification',
    entityId: row.id,
    action: 'justification_directe',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    field: 'state',
    before: existing?.state ?? null,
    after: 'acceptee',
    note: payload.commentaire ?? null,
    flagged: true, // §13.4 « Décision sans trace »
  })

  return { ok: true }
}

/* ================================================================== *
 *  Affectation matière → enseignant par le chef de département (§6)
 * ================================================================== */

/**
 * Le chef affecte un enseignant à une matière de SA filière, ou l'en retire
 * (teacherId absent). Une matière n'a qu'un enseignant : la nouvelle
 * affectation remplace l'ancienne.
 */
async function departementAffecter(ctx, payload, meta) {
  requireRole(ctx, ['chef', 'administration'])
  if (!meta.online) throw errors.reseau()

  const matiere = await serverDb.matieres.get(payload.matiereId)
  if (!matiere) throw errors.introuvable()
  const classe = await serverDb.classes.get(matiere.classeId)
  const filiere = await serverDb.filieres.get(classe?.filiereId)
  if (!filiere) throw errors.introuvable()
  // §13.3 « Chef de département hors filière » (l'admin passe).
  await assertFiliereDuChef(ctx, filiere.id)

  // Affectation(s) existante(s) sur cette matière : on les retire toujours.
  const existantes = await serverDb.affectations
    .where('matiereId')
    .equals(matiere.id)
    .toArray()

  const teacherId = payload.teacherId ?? null

  if (teacherId === null) {
    const ancien = existantes[0]
      ? await serverDb.teachers.get(existantes[0].teacherId)
      : null
    for (const a of existantes) await serverDb.affectations.delete(a.id)
    await appendAudit({
      entity: 'affectation',
      entityId: matiere.id,
      action: 'affectation_retiree',
      authorId: ctx.userId,
      authorLabel: ctx.label,
      before: ancien ? `${ancien.prenom} ${ancien.nom} → ${matiere.nom}` : null,
      after: null,
    })
    return { matiereId: matiere.id, teacherId: null }
  }

  const teacher = await serverDb.teachers.get(teacherId)
  if (!teacher) throw errors.introuvable()
  // §13.3 : un chef n'affecte qu'un enseignant de son propre département, OU un
  // enseignant d'un autre département autorisé pour son département.
  if (!hasRole(ctx, 'administration') && (teacher.departementId ?? null) !== (filiere.departementId ?? null)) {
    const autorise = await serverDb.autorisations
      .where('[teacherId+departementId]')
      .equals([teacherId, filiere.departementId])
      .first()
    if (!autorise || autorise.statut !== 'accordee') throw errors.perimetre()
  }

  for (const a of existantes) await serverDb.affectations.delete(a.id)
  const id = randomId()
  await serverDb.affectations.add({ id, teacherId, matiereId: matiere.id })

  await appendAudit({
    entity: 'affectation',
    entityId: id,
    action: 'affectation_creee',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    after: `${teacher.prenom} ${teacher.nom} → ${matiere.nom}`,
  })

  return { matiereId: matiere.id, teacherId }
}

/** Le chef crée une matière dans une de SES filières, à un niveau donné. */
async function departementCreerMatiere(ctx, payload, meta) {
  requireRole(ctx, ['chef'])
  if (!meta.online) throw errors.reseau()
  await assertFiliereDuChef(ctx, payload.filiereId)

  const filiere = await serverDb.filieres.get(payload.filiereId)
  if (!filiere) throw errors.introuvable()

  // Classe (filière + niveau) : créée si elle n'existe pas encore.
  let classe = (await serverDb.classes.where('filiereId').equals(payload.filiereId).toArray()).find(
    (c) => Number(c.niveau) === Number(payload.niveau),
  )
  if (!classe) {
    const classeId = randomId()
    classe = {
      id: classeId,
      filiereId: payload.filiereId,
      niveau: Number(payload.niveau),
      nom: `${filiere.nom} — niveau ${Number(payload.niveau)}`,
    }
    await serverDb.classes.add(classe)
  }

  const id = randomId()
  await serverDb.matieres.add({
    id,
    nom: payload.nom,
    nomEn: payload.nomEn ?? null,
    classeId: classe.id,
    semestre: payload.semestre ?? 1,
  })

  await appendAudit({
    entity: 'referentiel',
    entityId: id,
    action: 'matiere_creee',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    field: 'nom',
    after: payload.nom,
  })
  return { id }
}

/* --- partage d'enseignants entre départements (§13.3) --- */

/** Un chef demande à utiliser un enseignant d'un autre département. */
async function departementDemanderAcces(ctx, payload, meta) {
  requireRole(ctx, ['chef'])
  if (!meta.online) throw errors.reseau()
  const monDep = await departementDuChef(ctx)
  if (!monDep) throw errors.perimetre()
  const teacher = await serverDb.teachers.get(payload.teacherId)
  if (!teacher) throw errors.introuvable()
  if (!teacher.departementId) throw errors.invalide("Cet enseignant n'est rattaché à aucun département.")
  if (teacher.departementId === monDep) throw errors.invalide('Cet enseignant est déjà dans votre département.')

  const existe = await serverDb.autorisations
    .where('[teacherId+departementId]')
    .equals([payload.teacherId, monDep])
    .first()
  if (existe?.statut === 'accordee') throw errors.conflit('Vous avez déjà accès à cet enseignant.')
  if (existe?.statut === 'en_attente') throw errors.conflit('Une demande est déjà en attente pour cet enseignant.')

  let id
  if (existe) {
    id = existe.id
    await serverDb.autorisations.update(id, {
      statut: 'en_attente',
      demandePar: ctx.userId,
      demandeAt: meta.receivedAt,
      decidePar: null,
      decideAt: null,
    })
  } else {
    id = randomId()
    await serverDb.autorisations.add({
      id,
      teacherId: payload.teacherId,
      departementId: monDep,
      statut: 'en_attente',
      demandePar: ctx.userId,
      demandeAt: meta.receivedAt,
      decidePar: null,
      decideAt: null,
    })
  }

  await appendAudit({
    entity: 'autorisation',
    entityId: id,
    action: 'acces_demande',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    after: `${teacher.prenom} ${teacher.nom}`,
  })
  return { id, statut: 'en_attente' }
}

/** Le chef propriétaire de l'enseignant accorde ou refuse la demande. */
async function departementDeciderAcces(ctx, payload, meta) {
  requireRole(ctx, ['chef'])
  if (!meta.online) throw errors.reseau()
  const a = await serverDb.autorisations.get(payload.autorisationId)
  if (!a) throw errors.introuvable()
  const teacher = await serverDb.teachers.get(a.teacherId)
  const monDep = await departementDuChef(ctx)
  if (!monDep || monDep !== (teacher?.departementId ?? null)) throw errors.perimetre()
  if (a.statut !== 'en_attente') throw errors.invalide('Cette demande a déjà été traitée.')

  await serverDb.autorisations.update(a.id, {
    statut: payload.decision,
    decidePar: ctx.userId,
    decideAt: meta.receivedAt,
  })
  await appendAudit({
    entity: 'autorisation',
    entityId: a.id,
    action: payload.decision === 'accordee' ? 'acces_accorde' : 'acces_refuse',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    after: teacher ? `${teacher.prenom} ${teacher.nom}` : null,
  })
  return { id: a.id, statut: payload.decision }
}

/** Le chef propriétaire révoque un accès accordé ; retire les affectations. */
async function departementRevoquerAcces(ctx, payload, meta) {
  requireRole(ctx, ['chef'])
  if (!meta.online) throw errors.reseau()
  const a = await serverDb.autorisations.get(payload.autorisationId)
  if (!a) throw errors.introuvable()
  const teacher = await serverDb.teachers.get(a.teacherId)
  const monDep = await departementDuChef(ctx)
  if (!monDep || monDep !== (teacher?.departementId ?? null)) throw errors.perimetre()
  if (a.statut !== 'accordee') throw errors.invalide('Seule une autorisation accordée peut être révoquée.')

  await serverDb.autorisations.update(a.id, {
    statut: 'revoquee',
    decidePar: ctx.userId,
    decideAt: meta.receivedAt,
  })

  // Retrait des affectations de cet enseignant dans le département demandeur.
  const matieresDuDep = new Set()
  const classes = await serverDb.classes.toArray()
  const filieresDuDep = new Set(
    (await serverDb.filieres.toArray())
      .filter((f) => f.departementId === a.departementId)
      .map((f) => f.id),
  )
  const classesDuDep = new Set(classes.filter((c) => filieresDuDep.has(c.filiereId)).map((c) => c.id))
  for (const m of await serverDb.matieres.toArray()) {
    if (classesDuDep.has(m.classeId)) matieresDuDep.add(m.id)
  }
  const aRetirer = (await serverDb.affectations.where('teacherId').equals(a.teacherId).toArray()).filter(
    (af) => matieresDuDep.has(af.matiereId),
  )
  for (const af of aRetirer) await serverDb.affectations.delete(af.id)

  await appendAudit({
    entity: 'autorisation',
    entityId: a.id,
    action: 'acces_revoque',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    after: teacher ? `${teacher.prenom} ${teacher.nom}` : null,
  })
  return { id: a.id, statut: 'revoquee' }
}

/* ================================================================== *
 *  Alerte aux parents (§8)
 * ================================================================== */

/**
 * §13.9 « Alerte envoyée au mauvais parent » : le lien est construit ICI, avec
 * le numéro LU EN BASE. Le navigateur n'envoie qu'un identifiant d'étudiant.
 */
async function parentContacter(ctx, payload, meta) {
  requireRole(ctx, ['chef', 'administration'])
  if (!meta.online) throw errors.reseau()

  const student = await serverDb.students.get(payload.studentId)
  if (!student) throw errors.introuvable()

  const classe = await serverDb.classes.get(student.classeId)
  if (!hasRole(ctx, 'administration')) {
    await assertFiliereDuChef(ctx, classe?.filiereId)
  }

  const settings = await getSettings()
  const filiere = await serverDb.filieres.get(classe?.filiereId)
  const totals = await absenceTotals({ studentId: student.id })

  const message = renderTemplate(settings.modeleMessage, {
    etudiant: `${student.prenom} ${student.nom}`,
    classe: `${filiere?.nom ?? ''} niveau ${classe?.niveau ?? ''}`.trim(),
    heures: `${totals.nonJustifiees.toFixed(1).replace('.', ',')} h`,
    periode: totals.periodeLabel,
    etablissement: settings.etablissement,
  })

  const lien = buildWhatsAppLink({ phoneFromDatabase: student.parentPhone, message })
  if (!lien) throw errors.invalide("Le numéro du parent n'est pas au format international.")

  await serverDb.parentContacts.add({
    id: randomId(),
    studentId: student.id,
    at: meta.receivedAt,
    byUserId: ctx.userId,
    byLabel: ctx.label,
  })

  await appendAudit({
    entity: 'alerte',
    entityId: student.id,
    action: 'parent_contacte',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    note: `${student.prenom} ${student.nom}`,
  })

  // L'application ne peut pas savoir si le message a été envoyé (§8).
  return { lien, message }
}

/* ================================================================== *
 *  Administration (§3, §7)
 * ================================================================== */

async function adminReferentiel(ctx, payload, meta) {
  requireRole(ctx, ['administration'])
  if (!meta.online) throw errors.reseau()

  const shape = REFERENTIEL_SHAPES[payload.entite]
  if (!shape) throw errors.invalide('Entité inconnue.')
  const valeurs = validate(payload.valeurs, shape, payload.entite)

  const result = { entite: payload.entite }

  if (payload.entite === 'filiere') {
    const id = payload.id ?? randomId()
    const before = payload.id ? await serverDb.filieres.get(payload.id) : null
    await serverDb.filieres.put({
      id,
      nom: valeurs.nom,
      chefUserId: valeurs.chefUserId ?? null,
      departementId: valeurs.departementId ?? null,
      // §4 : la filière propose-t-elle une section anglophone ?
      sectionAnglophone: !!valeurs.sectionAnglophone,
    })
    if (valeurs.chefUserId) {
      const chef = await serverDb.users.get(valeurs.chefUserId)
      if (!chef) throw errors.introuvable()
      const roles = [...new Set([...(chef.roles ?? []), 'chef'])]
      const probleme = roleCombinationProblem(roles)
      if (probleme) throw errors.invalide(probleme)
      await serverDb.users.put({ ...chef, roles, filiereId: id })
    }
    await appendAudit({
      entity: 'referentiel',
      entityId: id,
      action: payload.id ? 'filiere_modifiee' : 'filiere_creee',
      authorId: ctx.userId,
      authorLabel: ctx.label,
      field: 'nom',
      before: before?.nom ?? null,
      after: valeurs.nom,
    })
    result.id = id
  } else if (payload.entite === 'classe') {
    const filiere = await serverDb.filieres.get(valeurs.filiereId)
    if (!filiere) throw errors.introuvable()
    const existing = await serverDb.classes
      .where('filiereId')
      .equals(valeurs.filiereId)
      .filter((c) => c.niveau === valeurs.niveau)
      .first()
    if (existing && existing.id !== payload.id) {
      throw errors.conflit('Cette classe existe déjà.')
    }
    const id = payload.id ?? randomId()
    await serverDb.classes.put({
      id,
      filiereId: valeurs.filiereId,
      niveau: valeurs.niveau,
      nom: `${filiere.nom} — niveau ${valeurs.niveau}`,
    })
    await appendAudit({
      entity: 'referentiel',
      entityId: id,
      action: payload.id ? 'classe_modifiee' : 'classe_creee',
      authorId: ctx.userId,
      authorLabel: ctx.label,
      after: `${filiere.nom} niveau ${valeurs.niveau}`,
    })
    result.id = id
  } else if (payload.entite === 'matiere') {
    const classe = await serverDb.classes.get(valeurs.classeId)
    if (!classe) throw errors.introuvable()
    const id = payload.id ?? randomId()
    const before = payload.id ? await serverDb.matieres.get(payload.id) : null
    // Le semestre n'est écrasé que s'il est fourni ; 1 par défaut à la création.
    const semestre = valeurs.semestre ?? before?.semestre ?? 1
    // Nom anglais : écrasé s'il est fourni, sinon conservé.
    const nomEn = Object.hasOwn(valeurs, 'nomEn') ? valeurs.nomEn : before?.nomEn ?? null
    await serverDb.matieres.put({ id, nom: valeurs.nom, nomEn, classeId: valeurs.classeId, semestre })
    await appendAudit({
      entity: 'referentiel',
      entityId: id,
      action: payload.id ? 'matiere_modifiee' : 'matiere_creee',
      authorId: ctx.userId,
      authorLabel: ctx.label,
      field: 'nom',
      before: before?.nom ?? null,
      after: valeurs.nom,
    })
    result.id = id
  } else if (payload.entite === 'enseignant' || payload.entite === 'secretaire') {
    const role = payload.entite === 'enseignant' ? 'enseignant' : 'secretaire'
    const table = payload.entite === 'enseignant' ? serverDb.teachers : null
    const loginKey = valeurs.telephone // §14 : téléphone comme identifiant

    const existingUser = await serverDb.users.where('loginKey').equals(loginKey).first()
    if (existingUser && existingUser.id !== payload.id) {
      throw errors.conflit('Ce numéro de téléphone est déjà utilisé par un compte.')
    }

    const roles = [role]
    const probleme = roleCombinationProblem(roles)
    if (probleme) throw errors.invalide(probleme)

    const temp = temporaryPassword()
    const userId = payload.id ?? randomId()
    const existing = await serverDb.users.get(userId)

    await serverDb.users.put({
      id: userId,
      login: valeurs.telephone,
      loginKey,
      nom: valeurs.nom,
      prenom: valeurs.prenom,
      telephone: valeurs.telephone,
      roles: existing ? [...new Set([...(existing.roles ?? []), role])] : roles,
      // §13.2 : mot de passe provisoire aléatoire, à changer à la première connexion.
      passwordHash: existing?.passwordHash ?? (await hashPasswordTx(temp)),
      mustChangePassword: existing ? Boolean(existing.mustChangePassword) : true,
      actif: true,
      teacherId: existing?.teacherId ?? null,
      createdAt: existing?.createdAt ?? meta.receivedAt,
    })

    if (table) {
      const teacherId = existing?.teacherId ?? randomId()
      await table.put({
        id: teacherId,
        nom: valeurs.nom,
        prenom: valeurs.prenom,
        telephone: valeurs.telephone,
        userId,
        departementId: valeurs.departementId ?? null,
        actif: true,
      })
      const user = await serverDb.users.get(userId)
      await serverDb.users.put({ ...user, teacherId })
      result.teacherId = teacherId
    } else {
      // Poste de pointage de la secrétaire, avec sa clef de signature (§13.4).
      const station = await serverDb.stations.filter((s) => s.secretaryUserId === userId).first()
      if (!station) {
        await serverDb.stations.add({
          id: `poste-${randomCode(4).toLowerCase()}`,
          label: `Secrétariat — ${valeurs.prenom} ${valeurs.nom}`,
          secret: newHmacSecret(),
          secretaryUserId: userId,
        })
      }
    }

    await appendAudit({
      entity: 'compte',
      entityId: userId,
      action: existing ? 'compte_modifie' : 'compte_cree',
      authorId: ctx.userId,
      authorLabel: ctx.label,
      note: `${valeurs.prenom} ${valeurs.nom} — ${role}`,
    })

    result.id = userId
    // Le mot de passe provisoire n'est affiché qu'une fois, jamais stocké en clair.
    if (!existing) result.motDePasseProvisoire = temp
  } else if (payload.entite === 'affectation') {
    const teacher = await serverDb.teachers.get(valeurs.teacherId)
    const matiere = await serverDb.matieres.get(valeurs.matiereId)
    if (!teacher || !matiere) throw errors.introuvable()
    const existing = await serverDb.affectations
      .where('[teacherId+matiereId]')
      .equals([valeurs.teacherId, valeurs.matiereId])
      .first()
    if (existing) throw errors.conflit('Cette affectation existe déjà.')
    const id = randomId()
    await serverDb.affectations.add({ id, teacherId: valeurs.teacherId, matiereId: valeurs.matiereId })
    await appendAudit({
      entity: 'referentiel',
      entityId: id,
      action: 'affectation_creee',
      authorId: ctx.userId,
      authorLabel: ctx.label,
      after: `${teacher.nom} → ${matiere.nom}`,
    })
    result.id = id
  } else if (payload.entite === 'etudiant') {
    const classe = await serverDb.classes.get(valeurs.classeId)
    if (!classe) throw errors.introuvable()
    const doublon = await serverDb.students.where('matricule').equals(valeurs.matricule).first()
    if (doublon && doublon.id !== payload.id) {
      throw errors.conflit('Ce matricule existe déjà.')
    }
    const id = payload.id ?? randomId()
    const existing = await serverDb.students.get(id)
    const temp = temporaryPassword()
    let userId = existing?.userId ?? null

    if (!userId) {
      userId = randomId()
      await serverDb.users.add({
        id: userId,
        login: valeurs.matricule,
        loginKey: valeurs.matricule.toLowerCase(),
        nom: valeurs.nom,
        prenom: valeurs.prenom,
        roles: ['etudiant'],
        passwordHash: await hashPasswordTx(temp),
        mustChangePassword: true,
        actif: true,
        studentId: id,
        createdAt: meta.receivedAt,
      })
      result.motDePasseProvisoire = temp
    }

    // §4 : section (francophone par défaut). « anglophone » n'est retenu que
    // si la filière de la classe propose cette section.
    let section = (valeurs.section ?? 'francophone') === 'anglophone' ? 'anglophone' : 'francophone'
    if (section === 'anglophone') {
      const filiere = await serverDb.filieres.get(classe.filiereId)
      if (!filiere || !filiere.sectionAnglophone) {
        throw errors.invalide("Cette filière n'a pas de section anglophone.")
      }
    }

    await serverDb.students.put({
      id,
      matricule: valeurs.matricule,
      nom: valeurs.nom,
      prenom: valeurs.prenom,
      classeId: valeurs.classeId,
      section,
      // §13.9 : numéro du parent modifiable par l'administration seulement.
      parentPhone: valeurs.parentPhone,
      userId,
      actif: true,
    })

    await appendAudit({
      entity: 'referentiel',
      entityId: id,
      action: existing ? 'etudiant_modifie' : 'etudiant_cree',
      authorId: ctx.userId,
      authorLabel: ctx.label,
      field: existing && existing.parentPhone !== valeurs.parentPhone ? 'parentPhone' : null,
      before: existing?.parentPhone ?? null,
      after: valeurs.parentPhone,
      note: `${valeurs.prenom} ${valeurs.nom} (${valeurs.matricule})`,
    })
    result.id = id
  }

  return result
}

async function adminTaux(ctx, payload, meta) {
  requireRole(ctx, ['administration'])
  if (!meta.online) throw errors.reseau()

  const id = randomId()
  // Système simple : un taux par niveau, pour tous (scope « niveau »).
  await serverDb.rates.add({
    id,
    scope: 'niveau',
    teacherId: null,
    matiereId: null,
    niveau: Number(payload.niveau),
    montant: Number(payload.montant),
    // §13.4 : date d'effet obligatoire, le passé reste figé.
    dateEffet: payload.dateEffet,
    createdAt: meta.receivedAt,
    createdBy: ctx.userId,
  })

  await appendAudit({
    entity: 'taux',
    entityId: id,
    action: 'taux_cree',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    field: 'montant',
    after: payload.montant,
    note: `Niveau ${payload.niveau} — effet au ${payload.dateEffet}`,
  })

  return { id }
}

async function adminParametres(ctx, payload, meta) {
  requireRole(ctx, ['administration'])
  if (!meta.online) throw errors.reseau()

  const before = await getSettings()
  const patch = {}
  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined) continue
    patch[key] = value
  }
  const after = await putSettings(patch)

  for (const key of Object.keys(patch)) {
    if (before[key] !== after[key]) {
      await appendAudit({
        entity: 'parametre',
        entityId: key,
        action: 'parametre_modifie',
        authorId: ctx.userId,
        authorLabel: ctx.label,
        field: key,
        before: before[key],
        after: after[key],
        flagged: key === 'modeleMessage', // §13.9 « Message d'alerte piégé »
      })
    }
  }

  return { ok: true }
}

async function adminSemestres(ctx, payload, meta) {
  requireRole(ctx, ['administration'])
  if (!meta.online) throw errors.reseau()
  const s = payload.semestres
  if (s.s1Debut >= s.s1Fin || s.s2Debut >= s.s2Fin) {
    throw errors.invalide('Chaque semestre doit finir après son début.')
  }
  if (s.s1Fin >= s.s2Debut) throw errors.invalide('Le semestre 2 doit commencer après le semestre 1.')

  const before = await getSettings()
  await putSettings({ semestres: s })
  await appendAudit({
    entity: 'parametre',
    entityId: 'semestres',
    action: 'semestres_modifies',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    field: 'semestres',
    before: before.semestres,
    after: s,
  })
  return { ok: true }
}

async function adminCompte(ctx, payload, meta) {
  requireRole(ctx, ['administration'])
  if (!meta.online) throw errors.reseau()

  const user = await serverDb.users.get(payload.userId)
  if (!user) throw errors.introuvable()

  const result = {}

  if (payload.actif !== null && payload.actif !== undefined && payload.actif !== user.actif) {
    await serverDb.users.put({ ...user, actif: payload.actif })
    // §13.2 « Session jamais révoquée » : on coupe les sessions ouvertes.
    if (!payload.actif) await revokeAllSessions(user.id)
    await appendAudit({
      entity: 'compte',
      entityId: user.id,
      action: payload.actif ? 'compte_active' : 'compte_desactive',
      authorId: ctx.userId,
      authorLabel: ctx.label,
      field: 'actif',
      before: user.actif,
      after: payload.actif,
    })
    result.actif = payload.actif
  }

  if (payload.reinitialiser) {
    // §13.2 « Réinitialisation de mot de passe » : faite par l'administration.
    const temp = temporaryPassword()
    await serverDb.users.put({
      ...(await serverDb.users.get(user.id)),
      passwordHash: await hashPasswordTx(temp),
      mustChangePassword: true,
    })
    await revokeAllSessions(user.id)
    await appendAudit({
      entity: 'compte',
      entityId: user.id,
      action: 'mot_de_passe_reinitialise',
      authorId: ctx.userId,
      authorLabel: ctx.label,
      note: 'Mot de passe provisoire remis à l’utilisateur.',
    })
    result.motDePasseProvisoire = temp
  }

  return result
}

/**
 * Import d'étudiants (§3).
 *
 *  §13.7 « Import qui écrase des comptes » — l'import NE CRÉE que des étudiants.
 *         Un matricule déjà présent est signalé et laissé intact.
 *  §13.6 « Déni de service »               — nombre de lignes borné, débit limité.
 */
async function adminImportEtudiants(ctx, payload, meta) {
  requireRole(ctx, ['administration'])
  if (!meta.online) throw errors.reseau()
  await assertAllowed('import', ctx.userId)

  const lignes = payload.lignes
  const rapport = { crees: 0, doublons: [], refusees: [], classesCreees: [], sansParent: [] }

  const filieres = await serverDb.filieres.toArray()
  const classes = await serverDb.classes.toArray()
  const normal = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

  for (const brute of lignes) {
    let ligne
    try {
      ligne = validate(brute, IMPORT_ROW_SHAPE, 'ligne')
    } catch (error) {
      rapport.refusees.push({ matricule: brute?.matricule ?? '?', raison: error.message })
      continue
    }

    const filiere = filieres.find((f) => normal(f.nom) === normal(ligne.filiere))
    if (!filiere) {
      rapport.refusees.push({ matricule: ligne.matricule, raison: `Filière inconnue : ${ligne.filiere}` })
      continue
    }

    // Section (§4) : francophone par défaut ; « anglophone » n'est accepté que
    // si la filière propose cette section.
    const sectionBrute = normal(ligne.section)
    const section = ['anglophone', 'anglais', 'english', 'en', 'ang'].includes(sectionBrute)
      ? 'anglophone'
      : 'francophone'
    if (section === 'anglophone' && !filiere.sectionAnglophone) {
      rapport.refusees.push({
        matricule: ligne.matricule,
        raison: `La filière « ${filiere.nom} » n'a pas de section anglophone.`,
      })
      continue
    }

    const niveau = Number(String(ligne.niveau).replace(/\D/g, ''))
    if (!Number.isInteger(niveau) || niveau < 1 || niveau > 8) {
      rapport.refusees.push({ matricule: ligne.matricule, raison: `Niveau invalide : ${ligne.niveau}` })
      continue
    }

    let classe = classes.find((c) => c.filiereId === filiere.id && c.niveau === niveau)
    if (!classe) {
      classe = {
        id: randomId(),
        filiereId: filiere.id,
        niveau,
        nom: `${filiere.nom} — niveau ${niveau}`,
      }
      await serverDb.classes.add(classe)
      classes.push(classe)
      rapport.classesCreees.push(classe.nom)
    }

    const existant = await serverDb.students.where('matricule').equals(ligne.matricule).first()
    if (existant) {
      rapport.doublons.push({ matricule: ligne.matricule, nom: `${existant.prenom} ${existant.nom}` })
      continue
    }

    // Un numéro présent mais illisible est refusé ; un numéro absent est
    // accepté, et l'étudiant est signalé comme à compléter (voir §3 et le
    // commentaire de IMPORT_ROW_SHAPE).
    const parentNormalise = ligne.parent ? normalizePhone(ligne.parent) : null
    if (ligne.parent && !parentNormalise) {
      rapport.refusees.push({ matricule: ligne.matricule, raison: 'Numéro du parent invalide' })
      continue
    }
    if (!parentNormalise) {
      rapport.sansParent.push({
        matricule: ligne.matricule,
        nom: `${ligne.prenom} ${ligne.nom}`,
      })
    }

    const studentId = randomId()
    const userId = randomId()
    const temp = temporaryPassword()

    await serverDb.users.add({
      id: userId,
      login: ligne.matricule,
      loginKey: ligne.matricule.toLowerCase(),
      nom: ligne.nom,
      prenom: ligne.prenom,
      roles: ['etudiant'],
      passwordHash: await hashPasswordTx(temp),
      mustChangePassword: true, // §13.2
      actif: true,
      studentId,
      createdAt: meta.receivedAt,
    })
    await serverDb.students.add({
      id: studentId,
      matricule: ligne.matricule,
      nom: ligne.nom,
      prenom: ligne.prenom,
      classeId: classe.id,
      section,
      parentPhone: parentNormalise,
      userId,
      actif: true,
    })
    rapport.crees += 1
  }

  await appendAudit({
    entity: 'referentiel',
    entityId: 'import',
    action: 'import_etudiants',
    authorId: ctx.userId,
    authorLabel: ctx.label,
    note: `${rapport.crees} créé(s), ${rapport.doublons.length} doublon(s), ${rapport.refusees.length} refusée(s)`,
  })
  logServer('import_etudiants', { crees: rapport.crees, refusees: rapport.refusees.length })

  return rapport
}

/* ================================================================== *
 *  Table des opérations
 * ================================================================== */

export const HANDLERS = {
  'secretariat.arrivee': { run: secretariatArrivee, requiresNetwork: false },
  'secretariat.depart': { run: secretariatDepart, requiresNetwork: false },
  'secretariat.depart_manuel': { run: secretariatDepartManuel, requiresNetwork: false },
  'secretariat.changer_matiere': { run: secretariatChangerMatiere, requiresNetwork: false },
  'secretariat.creer_fiche': { run: secretariatCreerFiche, requiresNetwork: true },
  'secretariat.annuler_fiche': { run: secretariatAnnulerFiche, requiresNetwork: true },
  'admin.payer_fiche': { run: adminPayerFiche, requiresNetwork: true },
  'secretariat.seance_anterieure': { run: secretariatSeanceAnterieure, requiresNetwork: false },
  'secretariat.pointer_declare': { run: secretariatPointerDeclare, requiresNetwork: false },
  'compte.profil': { run: compteProfil, requiresNetwork: true },
  'pointage.scan': { run: pointageScan, requiresNetwork: true },
  'releve.ouvrir': { run: releveOuvrir, requiresNetwork: false },
  'releve.changer_matiere': { run: releveChangerMatiere, requiresNetwork: false },
  'releve.declarer': { run: releveDeclarer, requiresNetwork: false },
  'releve.fermer': { run: releveFermer, requiresNetwork: false },
  'releve.valider': { run: releveValider, requiresNetwork: false },
  'releve.corriger': { run: releveCorriger, requiresNetwork: false },
  'presence.scan': { run: presenceScan, requiresNetwork: false },
  'justification.demander': { run: justificationDemander, requiresNetwork: true },
  'justification.decider': { run: justificationDecider, requiresNetwork: true },
  'justification.directe': { run: justificationDirecte, requiresNetwork: true },
  'departement.affecter': { run: departementAffecter, requiresNetwork: true },
  'departement.creer_matiere': { run: departementCreerMatiere, requiresNetwork: true },
  'departement.demander_acces': { run: departementDemanderAcces, requiresNetwork: true },
  'departement.decider_acces': { run: departementDeciderAcces, requiresNetwork: true },
  'departement.revoquer_acces': { run: departementRevoquerAcces, requiresNetwork: true },
  'parent.contacter': { run: parentContacter, requiresNetwork: true },
  'admin.referentiel': { run: adminReferentiel, requiresNetwork: true },
  'admin.taux': { run: adminTaux, requiresNetwork: true },
  'admin.parametres': { run: adminParametres, requiresNetwork: true },
  'admin.semestres': { run: adminSemestres, requiresNetwork: true },
  'admin.compte': { run: adminCompte, requiresNetwork: true },
  'admin.import_etudiants': { run: adminImportEtudiants, requiresNetwork: true },
}

/**
 * §9 : les scans arrivés avant leur séance sont rattachés dès qu'elle existe.
 * Appelé après chaque arrivée de séance et à chaque synchronisation.
 */
export async function reconcilePendingScans() {
  const attente = await serverDb.attendance.where('status').equals('attente_seance').toArray()
  let rattaches = 0
  for (const row of attente) {
    const session = await serverDb.sessions.get(row.sessionId)
    if (!session) continue

    const jetonOk = constantTimeEqual(row.tokenPresente ?? '', session.scanToken)
    const student = await serverDb.students.get(row.studentId)
    const memeClasse = student && student.classeId === session.classeId
    const fenetre = scanWindowProblem(session, {
      receivedAt: row.receivedAt,
      toleranceMs: PRESENCE_CLOCK_TOLERANCE_MS,
    })

    if (jetonOk && memeClasse && !fenetre) {
      await serverDb.attendance.put({ ...row, status: 'present', tokenPresente: undefined })
      rattaches += 1
    } else {
      await serverDb.attendance.put({
        ...row,
        status: 'refuse',
        raison: !jetonOk ? 'jeton' : !memeClasse ? 'classe' : 'fenetre',
        tokenPresente: undefined,
      })
    }
  }
  return rattaches
}
