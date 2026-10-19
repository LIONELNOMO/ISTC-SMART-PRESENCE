/**
 * Recalculs périodiques côté serveur.
 *
 * §13.3 « Changement d'état interdit » : l'état d'une séance n'est jamais écrit
 * par un client. Il est recalculé ici à partir des trois éléments du §4, et à
 * chaque écriture dans ops.js.
 */

import { serverDb } from './db.js'
import { computeStatus, missingParts } from './rules.js'
import { allRates } from './rates.js'
import { sessionCost } from './rates.js'
import { noteAnomalie } from './audit.js'

/** Recalcule l'état de toutes les séances. */
export async function refreshAllStatuses() {
  const sessions = await serverDb.sessions.toArray()
  const updates = sessions.map((session) => ({
    ...session,
    status: computeStatus(session),
    manque: missingParts(session),
  }))
  await serverDb.sessions.bulkPut(updates)
  return updates.length
}

/**
 * §7 : une séance terminée sans taux applicable est signalée à l'administration
 * et son coût reste vide. On ne crée qu'une anomalie par séance.
 */
export async function flagSessionsWithoutRate() {
  const [sessions, rates, existantes] = await Promise.all([
    serverDb.sessions.toArray(),
    allRates(),
    serverDb.anomalies.where('kind').equals('aucun_taux').toArray(),
  ])
  const dejaSignalees = new Set(existantes.map((a) => a.sessionId))
  let nouvelles = 0

  for (const session of sessions) {
    if (computeStatus(session) !== 'terminee') continue
    if (dejaSignalees.has(session.id)) continue
    const cost = sessionCost(session, rates)
    if (cost.raison === 'aucun_taux') {
      await noteAnomalie({
        kind: 'aucun_taux',
        titre: 'Séance sans taux applicable',
        detail: `Niveau ${session.niveau} — le coût reste vide jusqu'à la création d'un taux.`,
        sessionId: session.id,
        subjectId: session.teacherId,
        severity: 'attention',
      })
      nouvelles += 1
    }
  }
  return nouvelles
}

/** Nettoyage des jetons de pointage consommés et des sessions expirées. */
export async function purgeExpired() {
  const now = Date.now()
  const limite = new Date(now - 7 * 86_400_000).toISOString()
  await serverDb.usedTokens.where('at').below(limite).delete()
  const sessions = await serverDb.authSessions.toArray()
  await Promise.all(
    sessions
      .filter((s) => new Date(s.offlineDeadline).getTime() < now)
      .map((s) => serverDb.authSessions.delete(s.token)),
  )
}
