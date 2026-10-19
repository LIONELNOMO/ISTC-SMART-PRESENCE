/**
 * Limitation des essais — §13.2 « Force brute », §13.4 « Code de séance deviné »,
 * §13.6 « Absence de limite de débit », §13.12 « Attaques non détectées ».
 *
 * Un compteur par couple (portée, clef). Le délai croît avec le nombre
 * d'échecs, et chaque dépassement est journalisé pour que l'administration le
 * voie dans l'écran « Anomalies ».
 */

import { serverDb } from './db.js'
import { errors, logServer } from './errors.js'
import { noteAnomalie } from './audit.js'

export const LIMITS = {
  connexion: { max: 5, windowMs: 15 * 60_000, lockMs: [60_000, 5 * 60_000, 15 * 60_000] },
  code_seance: { max: 5, windowMs: 30 * 60_000, lockMs: [5 * 60_000, 15 * 60_000, 60 * 60_000] },
  scan: { max: 60, windowMs: 60_000, lockMs: [60_000] },
  synchro: { max: 300, windowMs: 60_000, lockMs: [30_000] },
  import: { max: 5, windowMs: 60 * 60_000, lockMs: [10 * 60_000] },
}

function keyOf(scope, subject) {
  return `${scope}:${String(subject ?? 'anonyme').slice(0, 80)}`
}

/**
 * Vérifie qu'une action est permise. Lève une erreur « bloqué » si la limite
 * est atteinte. À appeler AVANT de faire le travail.
 */
export async function assertAllowed(scope, subject) {
  const limit = LIMITS[scope]
  if (!limit) return
  const key = keyOf(scope, subject)
  const row = await serverDb.attempts.get(key)
  const now = Date.now()

  if (row?.lockedUntil && row.lockedUntil > now) {
    const minutes = Math.max(1, Math.ceil((row.lockedUntil - now) / 60_000))
    throw errors.bloque(minutes)
  }

  if (row && now - row.windowStart > limit.windowMs) {
    await serverDb.attempts.put({ key, count: 0, windowStart: now, strikes: row.strikes ?? 0 })
  }
}

/** Enregistre un échec. Bloque le compte quand la limite est franchie. */
export async function recordFailure(scope, subject, context = {}) {
  const limit = LIMITS[scope]
  if (!limit) return { blocked: false }
  const key = keyOf(scope, subject)
  const now = Date.now()
  const row = (await serverDb.attempts.get(key)) ?? {
    key,
    count: 0,
    windowStart: now,
    strikes: 0,
  }

  if (now - row.windowStart > limit.windowMs) {
    row.count = 0
    row.windowStart = now
  }

  row.count += 1
  let blocked = false

  if (row.count >= limit.max) {
    const index = Math.min(row.strikes, limit.lockMs.length - 1)
    row.lockedUntil = now + limit.lockMs[index]
    row.strikes += 1
    row.count = 0
    row.windowStart = now
    blocked = true
    logServer('limite_atteinte', { scope, strikes: row.strikes, ...context })
    await noteAnomalie({
      kind: 'limite_atteinte',
      titre: `Trop d'essais (${scope})`,
      detail: `Blocage temporaire après ${limit.max} échecs.`,
      subjectId: context.subjectId ?? null,
    })
  } else {
    logServer('echec', { scope, count: row.count, ...context })
  }

  await serverDb.attempts.put(row)
  return { blocked, remaining: Math.max(0, limit.max - row.count) }
}

/** Remet le compteur à zéro après une réussite. */
export async function recordSuccess(scope, subject) {
  const key = keyOf(scope, subject)
  const row = await serverDb.attempts.get(key)
  if (row) await serverDb.attempts.delete(key)
}

/** Nombre d'essais restants, pour l'afficher à l'utilisateur légitime. */
export async function remainingAttempts(scope, subject) {
  const limit = LIMITS[scope]
  if (!limit) return null
  const row = await serverDb.attempts.get(keyOf(scope, subject))
  if (!row) return limit.max
  if (row.lockedUntil && row.lockedUntil > Date.now()) return 0
  return Math.max(0, limit.max - row.count)
}
