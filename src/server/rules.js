/**
 * Les règles de calcul du cahier des charges, et personne d'autre ne les applique.
 *
 *  §13.3 « Changement d'état interdit » — l'état d'une séance est CALCULÉ ici,
 *         à partir de ses trois éléments. Aucun client ne peut l'écrire.
 *  §13.8 « Sécurité calculée côté client » — heures payées, écart non payé,
 *         absences : tout est calculé ici, jamais accepté depuis un téléphone.
 *  §13.4 « Durées impossibles »        — contrôles de cohérence avant écriture.
 *  §13.4 « Relevé de complaisance »    — écarts entre scans, comptage et liste.
 */

import { hoursBetween, HOUR } from '../lib/dates.js'

export const SESSION_STATES = {
  EN_COURS: 'en_cours',
  TERMINEE: 'terminee',
  INCOMPLETE: 'incomplete',
}

export const STATE_LABELS = {
  en_cours: 'En cours',
  terminee: 'Terminée',
  incomplete: 'Incomplète',
}

/** Durée maximale plausible d'une séance (§13.4 « Durées impossibles »). */
export const MAX_SESSION_HOURS = 12

/**
 * État d'une séance. Les trois éléments du §4 :
 *   1. arrivée pointée au secrétariat
 *   2. relevé validé avec le bon code de séance
 *   3. départ pointé au secrétariat
 */
export function computeStatus(session) {
  if (!session?.arrivalAt) return SESSION_STATES.INCOMPLETE
  // Relevé valide : confirmé par un code correct OU déclaré par l'enseignant
  // (secrétaire absente). Les deux comptent ; la 2e voie reste identifiable.
  const releveValide = Boolean(
    session.roll?.validatedAt && (session.roll?.codeOk || session.declareEnseignant),
  )
  if (!session.departureAt) {
    // L'enseignant est encore à l'école : « en cours ». S'il a déjà rendu son
    // relevé mais n'a pas pointé son départ, la séance reste incomplète.
    return releveValide ? SESSION_STATES.INCOMPLETE : SESSION_STATES.EN_COURS
  }
  return releveValide ? SESSION_STATES.TERMINEE : SESSION_STATES.INCOMPLETE
}

/** Ce qui manque à une séance, pour l'afficher à l'écran « Séances du jour ». */
export function missingParts(session) {
  const missing = []
  if (!session?.arrivalAt) missing.push('arrivée')
  if (!session?.roll?.validatedAt) missing.push('relevé')
  else if (!session.roll.codeOk) missing.push('code de séance correct')
  if (!session?.departureAt) missing.push('départ')
  return missing
}

/**
 * Heures payées (§4, §7) : de l'arrivée jusqu'à la fin retenue, pointées au
 * secrétariat, à la minute près. L'heure du relevé n'allonge jamais la durée.
 * Seules les séances « terminées » comptent.
 *
 * La fin retenue est le PLUS TÔT entre le départ réel et la fin prévue :
 *   — départ avant la fin prévue → payé le temps réel ;
 *   — départ après → payé jusqu'à la fin prévue, pas au-delà (§4).
 */
export function paidHours(session) {
  if (computeStatus(session) !== SESSION_STATES.TERMINEE) return 0
  const hours = hoursBetween(session.arrivalAt, payableEnd(session))
  return hours && hours > 0 ? hours : 0
}

/** Fin retenue pour le paiement : min(départ réel, fin prévue). */
function payableEnd(session) {
  const depart = session?.departureAt ?? null
  const prevue = session?.plannedEndAt ?? null
  if (!depart) return prevue
  if (!prevue) return depart
  return new Date(depart).getTime() <= new Date(prevue).getTime() ? depart : prevue
}

/**
 * Dépassement non payé : temps entre la fin prévue et le départ réel, quand
 * l'enseignant est resté au-delà de l'heure prévue. Zéro sinon. Affiché à
 * part, jamais ajouté aux heures payées (§4).
 */
export function overrunUnpaidHours(session) {
  if (computeStatus(session) !== SESSION_STATES.TERMINEE) return 0
  if (!session?.plannedEndAt || !session?.departureAt) return 0
  const over = hoursBetween(session.plannedEndAt, session.departureAt)
  return over && over > 0 ? over : 0
}

/** Durée affichable même si la séance n'est pas terminée (tableau de bord). */
export function elapsedHours(session, now = Date.now()) {
  if (!session?.arrivalAt) return null
  return hoursBetween(session.arrivalAt, session.departureAt ?? new Date(now).toISOString())
}

/**
 * Écart non payé (§4) : temps entre le départ pointé et la validation du relevé,
 * quand le relevé arrive après le départ. Ce temps n'est jamais payé.
 *
 * §14 : l'exemple du client (30 minutes) ne permet pas de fixer une autre règle.
 * Celle retenue ici est celle du §4, littéralement : « le temps en dehors de la
 * trace du secrétariat n'est pas payé ».
 */
export function unpaidGapHours(session) {
  const releve = session?.roll?.validatedAt
  if (!releve || !session?.departureAt) return 0
  const gap = hoursBetween(session.departureAt, releve)
  return gap && gap > 0 ? gap : 0
}

/* ------------------------------------------------------------------ *
 *  Cohérence — appelé AVANT toute écriture
 * ------------------------------------------------------------------ */

/**
 * Vérifie qu'un couple arrivée/départ est plausible.
 * @returns {string|null} le motif du refus, ou null si tout va bien.
 */
export function checkTimesPlausible({ arrivalAt, departureAt }) {
  if (!arrivalAt) return "L'heure d'arrivée est obligatoire."
  const start = new Date(arrivalAt).getTime()
  if (Number.isNaN(start)) return "Heure d'arrivée illisible."
  if (!departureAt) return null

  const end = new Date(departureAt).getTime()
  if (Number.isNaN(end)) return 'Heure de départ illisible.'
  if (end <= start) return "Le départ ne peut pas précéder l'arrivée."
  if (end - start > MAX_SESSION_HOURS * HOUR) {
    return `Une séance ne peut pas dépasser ${MAX_SESSION_HOURS} heures.`
  }
  // §13.4 : une séance ne chevauche pas deux jours civils.
  if (new Date(start).toDateString() !== new Date(end).toDateString()) {
    return 'Une séance ne peut pas être à cheval sur deux jours.'
  }
  return null
}

/** §4 : un enseignant n'a qu'une séance ouverte à la fois. */
export function hasOpenSession(sessions, teacherId) {
  return sessions.some(
    (s) => s.teacherId === teacherId && s.arrivalAt && !s.departureAt,
  )
}

/**
 * §5 : fenêtre de scan. Un scan hors de la période d'ouverture du relevé est
 * refusé, avec 5 minutes de tolérance pour les écarts d'horloge.
 */
export function scanWindowProblem(session, { receivedAt, toleranceMs }) {
  if (!session.rollOpenedAt) return 'Le relevé de présences n’est pas ouvert.'
  const t = new Date(receivedAt).getTime()
  if (t < new Date(session.rollOpenedAt).getTime() - toleranceMs) {
    return 'Scan effectué avant l’ouverture du relevé.'
  }
  if (session.rollClosedAt && t > new Date(session.rollClosedAt).getTime() + toleranceMs) {
    return 'Scan effectué après la fermeture du relevé.'
  }
  return null
}

/* ------------------------------------------------------------------ *
 *  Écarts à signaler (§5, §13.4)
 * ------------------------------------------------------------------ */

/**
 * Compare les trois sources : scans reçus, nombre de personnes comptées dans la
 * salle, liste cochée par l'enseignant.
 */
export function compareCounts({ scans, comptePhysique, coches, effectif }) {
  const ecarts = []
  if (typeof comptePhysique === 'number' && comptePhysique !== null) {
    if (scans !== comptePhysique) {
      ecarts.push({
        kind: 'scans_vs_comptage',
        message: `${scans} scan${scans > 1 ? 's' : ''} reçu${scans > 1 ? 's' : ''} pour ${comptePhysique} personne${comptePhysique > 1 ? 's' : ''} comptée${comptePhysique > 1 ? 's' : ''} dans la salle.`,
        severity: 'attention',
      })
    }
    if (coches !== comptePhysique) {
      ecarts.push({
        kind: 'liste_vs_comptage',
        message: `${coches} étudiant${coches > 1 ? 's' : ''} coché${coches > 1 ? 's' : ''} pour ${comptePhysique} personne${comptePhysique > 1 ? 's' : ''} comptée${comptePhysique > 1 ? 's' : ''}.`,
        severity: 'attention',
      })
    }
  }
  // Relevé de complaisance : toute la classe cochée sans aucun scan.
  if (effectif > 0 && coches === effectif && scans === 0) {
    ecarts.push({
      kind: 'classe_entiere',
      message: `Toute la classe est cochée (${effectif}) sans aucun scan reçu.`,
      severity: 'attention',
    })
  }
  return ecarts
}

/**
 * Présents retenus pour une séance (§9, règle 3) :
 * la liste cochée par l'enseignant l'emporte toujours sur les scans.
 * Avant validation du relevé, on affiche les scans.
 */
export function effectivePresent(session, scanStudentIds) {
  if (session?.roll?.validatedAt) return new Set(session.roll.presents ?? [])
  return new Set(scanStudentIds)
}

/**
 * Absences d'une séance terminée (§6) : les étudiants de la classe qui ne sont
 * pas marqués présents. Les heures d'absence valent la durée de la séance.
 */
export function absencesOf(session, classStudentIds, presentIds) {
  if (computeStatus(session) !== SESSION_STATES.TERMINEE) return []
  const hours = paidHours(session)
  const present = new Set(presentIds)
  return classStudentIds
    .filter((id) => !present.has(id))
    .map((studentId) => ({ studentId, sessionId: session.id, heures: hours }))
}
