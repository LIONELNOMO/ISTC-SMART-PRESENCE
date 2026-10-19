/**
 * Historique des modifications (§11) et anomalies (§13.12).
 *
 *  « Actions sensibles non tracées » — toute modification d'une séance, d'un
 *    relevé, d'une justification, d'un taux ou d'un paramètre passe par ici.
 *  « Historique modifiable »         — ce module n'expose QUE `add`. Les hooks
 *    Dexie de `db.js` refusent toute mise à jour ou suppression, même depuis la
 *    console du navigateur.
 *  §13.10 « Données dans les journaux » — les valeurs sensibles sont masquées
 *    avant écriture : un code de séance ou un numéro de parent n'entre jamais
 *    en clair dans l'historique.
 */

import { serverDb } from './db.js'
import { randomId } from '../lib/crypto.js'
import { nowIso } from '../lib/dates.js'

const MASKED_FIELDS = new Set([
  'code',
  'scanToken',
  'passwordHash',
  'secret',
  'motDePasse',
  'parentPhone',
  'dataUrl',
])

function maskValue(field, value) {
  if (value === undefined) return null
  if (MASKED_FIELDS.has(field)) return value === null ? null : '[masqué]'
  if (typeof value === 'string') {
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300)
  }
  if (Array.isArray(value)) return `${value.length} élément(s)`
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = maskValue(k, v)
    return out
  }
  return value
}

/**
 * Ajoute une entrée d'historique. Jamais d'autre opération que celle-ci.
 *
 * @param {object} entry
 * @param {string} entry.entity   'seance' | 'releve' | 'justification' | 'taux' | 'parametre' | 'compte' | 'referentiel'
 * @param {string} entry.entityId identifiant de l'objet touché
 * @param {string} entry.action   verbe court, par exemple 'depart_manuel'
 * @param {string} entry.authorId auteur
 * @param {string} [entry.field]  champ modifié
 * @param {*} [entry.before]      ancienne valeur
 * @param {*} [entry.after]       nouvelle valeur
 * @param {string} [entry.note]   précision lisible
 */
export async function appendAudit(entry) {
  const row = {
    id: randomId(),
    at: nowIso(),
    entity: String(entry.entity ?? 'inconnu').slice(0, 40),
    entityId: entry.entityId ?? null,
    action: String(entry.action ?? 'modification').slice(0, 60),
    authorId: entry.authorId ?? null,
    authorLabel: String(entry.authorLabel ?? '').slice(0, 80) || null,
    field: entry.field ? String(entry.field).slice(0, 60) : null,
    before: maskValue(entry.field, entry.before),
    after: maskValue(entry.field, entry.after),
    note: entry.note ? String(entry.note).slice(0, 300) : null,
    flagged: Boolean(entry.flagged),
  }
  await serverDb.audit.add(row)
  return row
}

/**
 * Anomalie à signaler à l'administration (§13.12 « Anomalies non signalées ») :
 * départ saisi après coup, écart entre scans et liste cochée, deux comptes sur
 * un même appareil, séance sans taux applicable, blocage pour trop d'essais.
 */
export async function noteAnomalie({ kind, titre, detail = null, subjectId = null, sessionId = null, severity = 'info' }) {
  const row = {
    id: randomId(),
    at: nowIso(),
    kind: String(kind).slice(0, 40),
    titre: String(titre).slice(0, 140),
    detail: detail ? String(detail).slice(0, 400) : null,
    subjectId,
    sessionId,
    severity, // 'info' | 'attention' | 'grave'
    vue: false,
  }
  await serverDb.anomalies.add(row)
  return row
}

/** Lecture de l'historique — réservée à l'administration (voir guard.js). */
export async function readAudit({ limit = 200, entity = null } = {}) {
  let collection = serverDb.audit.orderBy('at').reverse()
  if (entity) collection = collection.filter((row) => row.entity === entity)
  return collection.limit(Math.min(limit, 1000)).toArray()
}

export async function readAnomalies({ limit = 200 } = {}) {
  return serverDb.anomalies.orderBy('at').reverse().limit(Math.min(limit, 1000)).toArray()
}
