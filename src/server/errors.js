/**
 * §13.6 « Erreurs trop bavardes ».
 *
 * Le client reçoit un code et un message court, jamais une trace, jamais une
 * requête, jamais le nom d'une table. Le détail part dans le journal serveur.
 */

export class AppError extends Error {
  constructor(code, message, { status = 400, detail = null, retryable = false } = {}) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = status
    this.detail = detail // jamais renvoyé au client
    this.retryable = retryable
  }

  /** Ce que le client reçoit, et rien de plus. */
  toClient() {
    return { error: { code: this.code, message: this.message, retryable: this.retryable } }
  }
}

export const errors = {
  /** Même message pour « compte inconnu » et « mot de passe faux » (§13.2). */
  identifiants: () =>
    new AppError('identifiants', 'Identifiant ou mot de passe incorrect.', { status: 401 }),
  bloque: (minutes) =>
    new AppError(
      'bloque',
      `Trop d'essais. Nouvelle tentative possible dans ${minutes} minute${minutes > 1 ? 's' : ''}.`,
      { status: 429 },
    ),
  session: () =>
    new AppError('session', 'Session expirée. Reconnectez-vous.', { status: 401 }),
  sessionHorsLigne: () =>
    new AppError(
      'session_hors_ligne',
      'Votre session hors ligne a atteint sa durée maximale. Reconnectez-vous une fois en ligne.',
      { status: 401 },
    ),
  droits: () =>
    new AppError('droits', "Vous n'avez pas accès à cette action.", { status: 403 }),
  perimetre: () =>
    new AppError('perimetre', 'Cet élément ne fait pas partie de votre périmètre.', {
      status: 403,
    }),
  introuvable: () => new AppError('introuvable', 'Élément introuvable.', { status: 404 }),
  invalide: (message = 'Données invalides.') => new AppError('invalide', message, { status: 400 }),
  conflit: (message = 'Action déjà enregistrée.') =>
    new AppError('conflit', message, { status: 409 }),
  reseau: () =>
    new AppError('reseau', 'Action impossible hors ligne.', { status: 503, retryable: true }),
  interne: () =>
    new AppError('interne', "Une erreur est survenue. L'action n'a pas été enregistrée.", {
      status: 500,
      retryable: true,
    }),
}

/**
 * Enveloppe toute erreur inattendue : le client ne voit jamais le message
 * d'origine d'une exception.
 */
export function toClientError(error) {
  if (error instanceof AppError) return error.toClient()
  logServer('erreur_inattendue', { message: error?.message })
  return errors.interne().toClient()
}

/**
 * Journal serveur structuré (§13.1 « Injection dans les journaux »).
 * Les retours à la ligne et les caractères de contrôle sont neutralisés, et
 * aucun secret ni donnée personnelle complète n'y entre (§13.10).
 */
const SENSITIVE = /(password|motdepasse|secret|token|jeton|code|hash|phone|telephone|parent)/i

export function logServer(event, fields = {}) {
  const safe = {}
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE.test(key)) {
      safe[key] = value === undefined || value === null ? null : '[masqué]'
      continue
    }
    safe[key] =
      typeof value === 'string'
        ? // eslint-disable-next-line no-control-regex
          value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200)
        : value
  }
  const line = { at: new Date().toISOString(), event, ...safe }
  if (import.meta.env?.DEV) {
    // En production, ce journal part vers un collecteur externe (§13.12).
    console.info('[serveur]', JSON.stringify(line))
  }
}
