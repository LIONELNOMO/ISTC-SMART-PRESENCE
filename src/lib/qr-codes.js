/**
 * Les trois codes du §4, et la façon de ne pas se faire tromper par eux.
 *
 * Failles couvertes :
 *  §13.1 « Injection par code QR »       — le contenu scanné est une donnée, au
 *                                          format strict, jamais une URL ouverte.
 *  §13.4 « Photo du code QR de pointage » — fenêtre de 60 s.
 *  §13.4 « Code QR de pointage fabriqué » — signature HMAC avec une clé serveur.
 *  §13.4 « Rejeu d'un pointage »          — nonce à usage unique.
 *  §13.4 « Scan forgé sans code »         — jeton secret dans le QR de présence.
 */

import { hmacSign, hmacVerify, randomToken } from './crypto.js'

export const POINTAGE_SLOT_MS = 60_000 // le code change toutes les 60 secondes (§4)
export const POINTAGE_SLOT_TOLERANCE = 1 // on accepte le créneau précédent
export const PRESENCE_CLOCK_TOLERANCE_MS = 5 * 60_000 // 5 min d'écart d'horloge (§5)

/** Créneau de 60 secondes courant. */
export function currentSlot(at = Date.now()) {
  return Math.floor(at / POINTAGE_SLOT_MS)
}

/* ------------------------------------------------------------------ *
 *  1. Code QR de pointage — affiché par la secrétaire
 * ------------------------------------------------------------------ */

const POINTAGE_PREFIX = 'PRESENCES.P1'
// Format strict : PRESENCES.P1.<station>.<slot>.<nonce>.<signature>
const POINTAGE_RE = /^PRESENCES\.P1\.([A-Za-z0-9_-]{1,40})\.(\d{1,15})\.([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]{16,64})$/

/**
 * Fabrique le contenu du QR affiché au secrétariat.
 * La clé `stationSecret` est délivrée par le serveur au poste de la secrétaire
 * et ne sort jamais de ce poste (§13.4).
 */
export async function buildPointageQr({ stationId, stationSecret, at = Date.now() }) {
  const slot = currentSlot(at)
  const nonce = randomToken(16)
  const message = pointageMessage(stationId, slot, nonce)
  const signature = await hmacSign(stationSecret, message)
  return `${POINTAGE_PREFIX}.${stationId}.${slot}.${nonce}.${signature}`
}

function pointageMessage(stationId, slot, nonce) {
  return `${POINTAGE_PREFIX}|${stationId}|${slot}|${nonce}`
}

/**
 * Analyse sans confiance le texte lu par la caméra.
 * Retourne `null` dès que le format n'est pas exactement celui attendu : on ne
 * tente aucune récupération, et on n'ouvre jamais le contenu comme un lien.
 */
export function parsePointageQr(raw) {
  if (typeof raw !== 'string' || raw.length > 256) return null
  const match = POINTAGE_RE.exec(raw.trim())
  if (!match) return null
  return {
    stationId: match[1],
    slot: Number(match[2]),
    nonce: match[3],
    signature: match[4],
  }
}

/**
 * Vérification côté serveur. Les quatre contrôles sont indépendants :
 * format, fraîcheur, signature, usage unique (ce dernier est fait par l'appelant,
 * qui seul a accès à la table des nonces consommés).
 */
export async function verifyPointageQr({ raw, stationSecret, receivedAt = Date.now() }) {
  const parsed = parsePointageQr(raw)
  if (!parsed) return { ok: false, reason: 'format' }

  const slotNow = currentSlot(receivedAt)
  if (parsed.slot > slotNow || parsed.slot < slotNow - POINTAGE_SLOT_TOLERANCE) {
    // Une photo prise 5 minutes plus tôt tombe forcément ici (§12).
    return { ok: false, reason: 'expire', parsed }
  }

  const message = pointageMessage(parsed.stationId, parsed.slot, parsed.nonce)
  const valid = await hmacVerify(stationSecret, message, parsed.signature)
  if (!valid) return { ok: false, reason: 'signature', parsed }

  return { ok: true, parsed }
}

/* ------------------------------------------------------------------ *
 *  2. Code QR de présence — affiché par l'enseignant, scanné par les étudiants
 * ------------------------------------------------------------------ */

const PRESENCE_PREFIX = 'PRESENCES.A1'
const PRESENCE_RE = /^PRESENCES\.A1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{24,64})$/

/** Jeton secret de séance, créé au pointage d'arrivée et jamais diffusé. */
export function newScanToken() {
  return randomToken(24)
}

/**
 * Contenu du QR de présence. Il reste identique pendant toute la séance (§5) :
 * c'est le jeton secret, et non sa rotation, qui empêche un scan forgé.
 */
export function buildPresenceQr({ sessionId, scanToken }) {
  return `${PRESENCE_PREFIX}.${sessionId}.${scanToken}`
}

export function parsePresenceQr(raw) {
  if (typeof raw !== 'string' || raw.length > 256) return null
  const match = PRESENCE_RE.exec(raw.trim())
  if (!match) return null
  return { sessionId: match[1], scanToken: match[2] }
}

/* ------------------------------------------------------------------ *
 *  3. Code de séance — remis de la main à la main, saisi au clavier
 * ------------------------------------------------------------------ */

const SESSION_CODE_RE = /^[ACDEFGHJKLMNPQRTUVWXY34679]{6}$/

/** Nettoyage de la saisie : majuscules, sans espaces. Ne corrige rien d'autre. */
export function normalizeSessionCode(input) {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6)
}

export function isSessionCodeShape(input) {
  return SESSION_CODE_RE.test(normalizeSessionCode(input))
}

/** Nombre d'essais avant blocage du code de séance (§13.4). */
export const SESSION_CODE_MAX_ATTEMPTS = 5

/* ------------------------------------------------------------------ *
 *  Garde-fou commun
 * ------------------------------------------------------------------ */

/**
 * Un contenu scanné n'est JAMAIS une adresse. Si un QR fabriqué contient
 * `javascript:` ou `https://…`, il échoue au format ci-dessus ; cette fonction
 * existe pour que le refus soit explicite dans les journaux.
 */
export function looksLikeUrl(raw) {
  return /^[a-z][a-z0-9+.-]*:/i.test(String(raw ?? '').trim())
}
