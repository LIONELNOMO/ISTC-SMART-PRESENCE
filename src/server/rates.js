/**
 * Taux horaires et coûts (§7).
 *
 *  §13.3 « Fuite des taux et des montants » — ce module n'est appelé que derrière
 *         `assertCanSeeMoney`. Aucune projection non administrative ne l'importe.
 *  §13.4 « Taux modifié rétroactivement »  — la date d'effet est obligatoire et
 *         le coût d'une séance passée est figé au taux en vigueur ce jour-là.
 */

import { serverDb } from './db.js'
import { paidHours, computeStatus, SESSION_STATES } from './rules.js'
import { dayKey } from '../lib/dates.js'

/** Priorités du §7 : du plus précis au plus général. */
export const RATE_SCOPES = [
  { key: 'enseignant_matiere', priorite: 1, label: 'Enseignant + matière' },
  { key: 'enseignant_niveau', priorite: 2, label: 'Enseignant + niveau' },
  { key: 'niveau', priorite: 3, label: 'Niveau' },
]

export const SCOPE_LABELS = Object.fromEntries(RATE_SCOPES.map((s) => [s.key, s.label]))

/**
 * Taux applicable à une séance, à sa date.
 *
 * Système simple : UN taux par niveau, identique pour tous. Pour le niveau
 * demandé, on prend le taux dont la date d'effet est la plus récente (≤ au jour).
 * `teacherId` et `matiereId` sont ignorés (gardés pour compatibilité d'appel).
 *
 * @returns {{montant:number, scope:string, rateId:string}|null}
 */
export function resolveRate({ rates, teacherId, matiereId, niveau, day }) {
  const candidats = rates.filter(
    (rate) => rate.scope === 'niveau' && rate.niveau === niveau && rate.dateEffet <= day,
  )
  if (!candidats.length) return null

  candidats.sort((a, b) => {
    // La date d'effet la plus récente gagne, puis le dernier saisi.
    if (a.dateEffet !== b.dateEffet) return a.dateEffet < b.dateEffet ? 1 : -1
    return (b.createdAt ?? '') > (a.createdAt ?? '') ? 1 : -1
  })

  const winner = candidats[0]
  return { montant: winner.montant, scope: 'niveau', rateId: winner.id }
}

/**
 * Coût d'une séance. `null` quand aucun taux ne s'applique : le §7 demande que
 * le coût reste vide et que le cas soit signalé à l'administration.
 */
export function sessionCost(session, rates) {
  if (computeStatus(session) !== SESSION_STATES.TERMINEE) {
    return { heures: 0, montant: null, taux: null, raison: 'non_terminee' }
  }
  const heures = paidHours(session)
  const resolved = resolveRate({
    rates,
    teacherId: session.teacherId,
    matiereId: session.matiereId,
    niveau: session.niveau,
    day: session.day ?? dayKey(session.arrivalAt),
  })
  if (!resolved) {
    return { heures, montant: null, taux: null, raison: 'aucun_taux' }
  }
  return {
    heures,
    montant: Math.round(heures * resolved.montant),
    taux: resolved.montant,
    scope: resolved.scope,
    rateId: resolved.rateId,
    raison: null,
  }
}

/** Tous les taux, pour les calculs. Lecture réservée à l'administration. */
export async function allRates() {
  return serverDb.rates.toArray()
}

/**
 * Description lisible d'un taux, pour l'écran « Taux horaires ».
 * Ne renvoie pas le montant : l'appelant l'ajoute après `assertCanSeeMoney`.
 */
export function describeRate(rate, { teacherName, matiereName }) {
  if (rate.scope === 'enseignant_matiere') {
    return `${teacherName ?? 'Enseignant'} — ${matiereName ?? 'matière'}`
  }
  if (rate.scope === 'enseignant_niveau') {
    return `${teacherName ?? 'Enseignant'} — niveau ${rate.niveau}`
  }
  return `Tous les cours de niveau ${rate.niveau}`
}

/**
 * Cohérence d'un taux avant écriture : la portée impose les champs présents.
 * §13.3 « Affectation de masse » : un taux « niveau » ne peut pas porter un
 * teacherId en douce.
 */
export function rateProblem(rate) {
  if (rate.scope === 'enseignant_matiere') {
    if (!rate.teacherId || !rate.matiereId) return 'Choisissez un enseignant et une matière.'
    if (rate.niveau) return 'Un taux enseignant + matière ne porte pas de niveau.'
    return null
  }
  if (rate.scope === 'enseignant_niveau') {
    if (!rate.teacherId || !rate.niveau) return 'Choisissez un enseignant et un niveau.'
    if (rate.matiereId) return 'Un taux enseignant + niveau ne porte pas de matière.'
    return null
  }
  if (rate.scope === 'niveau') {
    if (!rate.niveau) return 'Choisissez un niveau.'
    if (rate.teacherId || rate.matiereId) return 'Un taux par niveau ne porte ni enseignant ni matière.'
    return null
  }
  return 'Portée inconnue.'
}
