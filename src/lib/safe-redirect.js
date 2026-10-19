/**
 * §13.6 « Redirection ouverte » et §13.8 « Lien javascript: ».
 *
 * Après la connexion, l'application revient là où l'utilisateur voulait aller.
 * Cette destination vient de l'URL : elle est donc hostile par défaut.
 * Seuls des chemins internes connus sont acceptés.
 */

/** Préfixes de routes existantes. Toute autre destination est refusée. */
const ALLOWED_PREFIXES = [
  '/etudiant',
  '/enseignant',
  '/secretariat',
  '/departement',
  '/administration',
  '/espaces',
  '/compte',
]

export const DEFAULT_REDIRECT = '/'

/**
 * @param {string|null} candidate destination demandée
 * @returns {string} un chemin interne sûr
 */
export function safeRedirect(candidate) {
  const value = String(candidate ?? '').trim()
  if (!value) return DEFAULT_REDIRECT

  // Un chemin interne commence par un seul « / » et ne contient pas de schéma.
  if (!value.startsWith('/')) return DEFAULT_REDIRECT
  if (value.startsWith('//')) return DEFAULT_REDIRECT // //evil.example
  if (/^\/\\/.test(value)) return DEFAULT_REDIRECT // /\evil.example
  if (/[\u0000-\u001f]/.test(value)) return DEFAULT_REDIRECT
  if (/^[a-z][a-z0-9+.-]*:/i.test(value.slice(1))) return DEFAULT_REDIRECT

  const path = value.split('?')[0].split('#')[0]
  if (path.includes('..')) return DEFAULT_REDIRECT

  const allowed = ALLOWED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  )
  return allowed ? value : DEFAULT_REDIRECT
}

/**
 * Les seuls liens externes de l'application sont les liens WhatsApp, construits
 * par `whatsapp.js`. Cette fonction garde la porte pour tout le reste.
 */
export function isAllowedExternalUrl(url) {
  try {
    const parsed = new URL(String(url))
    return parsed.protocol === 'https:' && parsed.hostname === 'wa.me'
  } catch {
    return false
  }
}
