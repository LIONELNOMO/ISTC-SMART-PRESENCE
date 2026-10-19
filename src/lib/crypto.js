/**
 * Primitives cryptographiques — §13.11 « Aléa et chiffrement faibles ».
 *
 * Règles tenues ici :
 *  - aucun Math.random pour un code, un jeton ou un identifiant ;
 *  - aucun algorithme maison : WebCrypto uniquement ;
 *  - comparaison de secrets à temps constant.
 *
 * Le hachage de mot de passe utilise PBKDF2-SHA256, seul algorithme lent
 * disponible dans le navigateur. En production, le hachage est fait PAR LE
 * SERVEUR avec Argon2id ou bcrypt (§13.2) : cette implémentation ne sert qu'au
 * serveur de démonstration embarqué.
 */

const subtle = globalThis.crypto?.subtle

function requireCrypto() {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('WebCrypto indisponible : HTTPS requis.')
  }
}

/** Identifiant aléatoire — §13.3 « Identifiants devinables ». */
export function randomId() {
  requireCrypto()
  if (crypto.randomUUID) return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Alphabet sans caractères ambigus (ni O/0, ni I/1, ni S/5, ni B/8). */
const CODE_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY34679'

/**
 * Code de séance : tirage uniforme par rejet, à partir d'un aléa
 * cryptographique — §13.4 « Code de séance deviné ».
 */
export function randomCode(length = 6, alphabet = CODE_ALPHABET) {
  requireCrypto()
  const n = alphabet.length
  const limit = Math.floor(256 / n) * n // borne de rejet : évite le biais modulo
  let out = ''
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2))
    for (const byte of bytes) {
      if (byte >= limit) continue
      out += alphabet[byte % n]
      if (out.length === length) break
    }
  }
  return out
}

/** Jeton secret opaque (base64url) — §13.4 « Scan forgé sans code ». */
export function randomToken(bytes = 24) {
  requireCrypto()
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export function toBase64Url(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/* ------------------------------------------------------------------ *
 *  HMAC-SHA256 — signature des codes QR de pointage (§13.4)
 * ------------------------------------------------------------------ */

/** Nouvelle clé de signature. Elle ne quitte jamais le serveur. */
export function newHmacSecret() {
  return randomToken(32)
}

async function hmacKey(secret) {
  if (!subtle) throw new Error('WebCrypto indisponible : HTTPS requis.')
  return subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

export async function hmacSign(secret, message) {
  const key = await hmacKey(secret)
  const sig = await subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return toBase64Url(new Uint8Array(sig))
}

/**
 * Vérification par recalcul puis comparaison à temps constant.
 * On ne compare jamais deux signatures avec `===` sur des longueurs
 * différentes sans passer par constantTimeEqual.
 */
export async function hmacVerify(secret, message, signature) {
  const expected = await hmacSign(secret, message)
  return constantTimeEqual(expected, signature)
}

/** Comparaison à temps constant — évite les attaques par mesure du temps. */
export function constantTimeEqual(a, b) {
  const sa = String(a ?? '')
  const sb = String(b ?? '')
  // On compare sur la longueur maximale pour ne pas révéler la longueur.
  const len = Math.max(sa.length, sb.length)
  let diff = sa.length ^ sb.length
  for (let i = 0; i < len; i += 1) {
    diff |= (sa.charCodeAt(i) || 0) ^ (sb.charCodeAt(i) || 0)
  }
  return diff === 0
}

/* ------------------------------------------------------------------ *
 *  Mots de passe (§13.2)
 * ------------------------------------------------------------------ */

const PBKDF2_ITERATIONS = 210_000

/** Hachage salé et lent. Production : Argon2id côté serveur. */
export async function hashPassword(plain, saltB64 = null) {
  if (!subtle) throw new Error('WebCrypto indisponible : HTTPS requis.')
  const salt = saltB64 ? fromBase64Url(saltB64) : crypto.getRandomValues(new Uint8Array(16))
  const base = await subtle.importKey('raw', new TextEncoder().encode(plain), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    256,
  )
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(new Uint8Array(bits))}`
}

/** Vérifie un mot de passe. Toujours à temps constant sur le condensé. */
export async function verifyPassword(plain, stored) {
  if (typeof stored !== 'string') return false
  const [scheme, iters, salt] = stored.split('$')
  if (scheme !== 'pbkdf2' || !salt) return false
  const again = await hashPassword(plain, salt)
  // Les itérations sont relues du condensé stocké pour rester compatible.
  if (Number(iters) !== PBKDF2_ITERATIONS) {
    const base = await subtle.importKey('raw', new TextEncoder().encode(plain), 'PBKDF2', false, [
      'deriveBits',
    ])
    const bits = await subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: fromBase64Url(salt),
        iterations: Number(iters),
        hash: 'SHA-256',
      },
      base,
      256,
    )
    return constantTimeEqual(
      `pbkdf2$${iters}$${salt}$${toBase64Url(new Uint8Array(bits))}`,
      stored,
    )
  }
  return constantTimeEqual(again, stored)
}

/**
 * Mot de passe provisoire lisible — §13.2 « Mot de passe faible ou par défaut ».
 * Jamais dérivé du matricule : tiré au hasard, à changer à la première connexion.
 */
export function temporaryPassword() {
  return `${randomCode(4)}-${randomCode(4)}`
}

/** Politique de mot de passe : 8 caractères minimum (§13.2). */
export const PASSWORD_MIN = 8

export function passwordProblem(plain) {
  const value = String(plain ?? '')
  if (value.length < PASSWORD_MIN) return `Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères.`
  if (value.length > 128) return 'Le mot de passe est trop long.'
  if (!/[^a-zA-Z]/.test(value)) return 'Ajoutez au moins un chiffre ou un caractère spécial.'
  return null
}
