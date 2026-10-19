/**
 * Le garde-barrière. Aucune opération, aucune lecture ne se fait sans passer ici.
 *
 *  §13.3 « Contrôle fait seulement dans l'interface » — chaque appel est vérifié
 *         côté serveur, indépendamment de ce que l'écran affiche ou cache.
 *  §13.3 « Routes oubliées »        — refus par défaut : sans rôle déclaré, c'est non.
 *  §13.3 « Accès aux données d'autrui » — la propriété de l'objet est vérifiée.
 *  §13.2 « Session jamais révoquée » — compte et rôles relus À CHAQUE appel.
 *  §13.2 « Fixation de session »    — un nouveau jeton à chaque connexion.
 *  §13.5 « Droits périmés hors ligne » — à la synchronisation, les droits du
 *         moment s'appliquent, pas ceux du moment de l'action.
 */

import { serverDb } from './db.js'
import { errors, logServer } from './errors.js'
import { randomToken } from '../lib/crypto.js'
import { nowIso, DAY } from '../lib/dates.js'
import { getSettings } from './settings.js'

const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // 12 h en ligne

/**
 * Crée une session serveur. Le jeton précédent du même appareil est révoqué :
 * l'identifiant de session change à chaque connexion (§13.2).
 */
export async function createAuthSession(user, deviceId) {
  const settings = await getSettings()
  const now = Date.now()
  const token = randomToken(32)

  await serverDb.authSessions.where('userId').equals(user.id).filter((s) => s.deviceId === deviceId).delete()

  const row = {
    token,
    userId: user.id,
    deviceId: String(deviceId ?? 'inconnu').slice(0, 40),
    createdAt: nowIso(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    // §13.2 « Session hors ligne sur téléphone perdu » : au-delà de cette date,
    // l'appareil doit repasser par une connexion en ligne.
    offlineDeadline: new Date(now + settings.dureeSessionHorsLigneJours * DAY).toISOString(),
  }
  await serverDb.authSessions.put(row)
  logServer('connexion', { userId: user.id })
  return row
}

export async function revokeAuthSession(token) {
  if (!token) return
  await serverDb.authSessions.delete(token)
}

/** Appelée quand un mot de passe change : toutes les autres sessions tombent (§13.2). */
export async function revokeAllSessions(userId, { except = null } = {}) {
  const rows = await serverDb.authSessions.where('userId').equals(userId).toArray()
  await Promise.all(
    rows.filter((row) => row.token !== except).map((row) => serverDb.authSessions.delete(row.token)),
  )
}

/**
 * Résout un jeton en contexte d'appel. Le compte et ses rôles sont relus en
 * base : un compte désactivé ou un rôle retiré prend effet immédiatement, même
 * si le jeton est encore valide.
 */
export async function resolveContext(token, { online = true } = {}) {
  if (typeof token !== 'string' || token.length < 16) throw errors.session()
  const auth = await serverDb.authSessions.get(token)
  if (!auth) throw errors.session()

  const now = Date.now()
  if (new Date(auth.offlineDeadline).getTime() < now) {
    await serverDb.authSessions.delete(token)
    throw errors.sessionHorsLigne()
  }
  if (online && new Date(auth.expiresAt).getTime() < now) {
    // Prolongation tacite quand le réseau est là et le compte toujours valide.
    auth.expiresAt = new Date(now + SESSION_TTL_MS).toISOString()
    await serverDb.authSessions.put(auth)
  }

  const user = await serverDb.users.get(auth.userId)
  if (!user || user.actif === false) {
    await serverDb.authSessions.delete(token)
    throw errors.session()
  }

  return {
    token,
    user,
    userId: user.id,
    roles: Array.isArray(user.roles) ? user.roles : [],
    teacherId: user.teacherId ?? null,
    studentId: user.studentId ?? null,
    filiereId: user.filiereId ?? null,
    deviceId: auth.deviceId,
    label: `${user.prenom ?? ''} ${user.nom ?? ''}`.trim() || user.login,
    mustChangePassword: Boolean(user.mustChangePassword),
  }
}

/** Refus par défaut : la liste des rôles autorisés est obligatoire. */
export function requireRole(ctx, roles) {
  if (!Array.isArray(roles) || roles.length === 0) throw errors.droits()
  const ok = roles.some((role) => ctx.roles.includes(role))
  if (!ok) {
    logServer('refus_role', { userId: ctx.userId, attendus: roles.join(',') })
    throw errors.droits()
  }
  return true
}

export function hasRole(ctx, role) {
  return ctx.roles.includes(role)
}

/* ------------------------------------------------------------------ *
 *  Périmètres
 * ------------------------------------------------------------------ */

/** Filières dont l'utilisateur est chef de département. */
export async function filieresDuChef(ctx) {
  if (!hasRole(ctx, 'chef')) return []
  const rows = await serverDb.filieres.filter((f) => f.chefUserId === ctx.userId).toArray()
  return rows.map((f) => f.id)
}

/** Département que ce chef dirige (null s'il n'en dirige aucun). */
export async function departementDuChef(ctx) {
  if (!hasRole(ctx, 'chef')) return null
  const dep = await serverDb.departements.filter((d) => d.chefUserId === ctx.userId).first()
  return dep?.id ?? null
}

/** §13.3 « Chef de département hors filière ». */
export async function assertFiliereDuChef(ctx, filiereId) {
  if (hasRole(ctx, 'administration')) return true
  const ids = await filieresDuChef(ctx)
  if (!filiereId || !ids.includes(filiereId)) throw errors.perimetre()
  return true
}

/** §13.3 « Enseignant hors affectation ». */
export async function assertAffectation(ctx, matiereId) {
  if (!ctx.teacherId) throw errors.droits()
  const affectation = await serverDb.affectations
    .where('[teacherId+matiereId]')
    .equals([ctx.teacherId, matiereId])
    .first()
  if (!affectation) {
    logServer('refus_affectation', { userId: ctx.userId })
    throw errors.perimetre()
  }
  return true
}

/** §13.3 « Accès aux données d'autrui » pour une séance. */
export async function loadOwnSession(ctx, sessionId) {
  const session = await serverDb.sessions.get(sessionId)
  if (!session) throw errors.introuvable()
  if (hasRole(ctx, 'administration')) return session
  if (hasRole(ctx, 'enseignant') && session.teacherId === ctx.teacherId) return session
  if (hasRole(ctx, 'secretaire')) return session
  if (hasRole(ctx, 'chef')) {
    const classe = await serverDb.classes.get(session.classeId)
    const ids = await filieresDuChef(ctx)
    if (classe && ids.includes(classe.filiereId)) return session
  }
  throw errors.perimetre()
}

/** §13.3 « Étudiant hors classe » : la séance doit concerner sa classe. */
export async function assertStudentInSession(ctx, session) {
  if (!ctx.studentId) throw errors.droits()
  const student = await serverDb.students.get(ctx.studentId)
  if (!student) throw errors.droits()
  if (student.classeId !== session.classeId) {
    logServer('refus_classe', { userId: ctx.userId })
    throw errors.perimetre()
  }
  return student
}

/** Un étudiant n'agit que sur lui-même. */
export function assertSelfStudent(ctx, studentId) {
  if (hasRole(ctx, 'administration')) return true
  if (!ctx.studentId || ctx.studentId !== studentId) throw errors.perimetre()
  return true
}

/**
 * §13.10 « Justificatifs médicaux » : lisibles par l'étudiant concerné, son chef
 * de département et l'administration. Personne d'autre.
 */
export async function assertCanReadJustificatif(ctx, justification) {
  if (hasRole(ctx, 'administration')) return true
  if (ctx.studentId && ctx.studentId === justification.studentId) return true
  if (hasRole(ctx, 'chef')) {
    const ids = await filieresDuChef(ctx)
    if (ids.includes(justification.filiereId)) return true
  }
  throw errors.perimetre()
}

/**
 * §13.3 « Fuite des taux et des montants » : une seule porte pour les montants.
 * Toute lecture de taux ou de coût passe par cet appel.
 */
export function assertCanSeeMoney(ctx) {
  if (!hasRole(ctx, 'administration')) {
    logServer('refus_montants', { userId: ctx.userId })
    throw errors.droits()
  }
  return true
}

export function canSeeMoney(ctx) {
  return hasRole(ctx, 'administration')
}

/** Station de pointage associée à une secrétaire. */
export async function stationDuSecretariat(ctx) {
  requireRole(ctx, ['secretaire', 'administration'])
  const station = await serverDb.stations.filter((s) => s.secretaryUserId === ctx.userId).first()
  if (!station) throw errors.introuvable()
  return station
}
