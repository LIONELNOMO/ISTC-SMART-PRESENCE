/**
 * Alerte aux parents (§8) — et les cinq façons de la détourner (§13.9).
 *
 *  §13.1 « Injection dans le lien WhatsApp »    — numéro : chiffres seuls ;
 *                                                 message : encodeURIComponent.
 *  §13.1 « Injection dans le modèle de message » — substitution de texte, sans
 *                                                 aucun moteur qui exécute du code.
 *  §13.9 « Alerte envoyée au mauvais parent »   — le numéro vient de la base,
 *                                                 jamais d'un champ de la page.
 *  §13.8 « Lien javascript: »                   — seul le schéma https est produit.
 */

/** Format international accepté : 8 à 15 chiffres (recommandation E.164). */
const DIGITS_ONLY = /^\d{8,15}$/

/**
 * Normalise un numéro : on retire tout ce qui n'est pas un chiffre, y compris
 * le « + », les espaces et les séparateurs. Retourne null si le résultat ne
 * ressemble pas à un numéro international.
 */
export function normalizePhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '')
  return DIGITS_ONLY.test(digits) ? digits : null
}

export function isValidPhone(raw) {
  return normalizePhone(raw) !== null
}

/** Affichage lisible « +237 6 99 00 11 22 », sans jamais servir à construire l'URL. */
export function formatPhone(raw) {
  const digits = normalizePhone(raw)
  if (!digits) return '—'
  return `+${digits.replace(/(\d{1,3})(\d{3})(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3 $4 $5')}`
}

/**
 * Variables autorisées dans le modèle de message. Toute autre accolade est
 * laissée telle quelle, affichée comme du texte.
 */
export const TEMPLATE_VARIABLES = [
  { key: 'etudiant', label: "Nom de l'étudiant" },
  { key: 'classe', label: 'Classe' },
  { key: 'heures', label: "Heures d'absence non justifiées" },
  { key: 'periode', label: 'Période' },
  { key: 'etablissement', label: "Nom de l'établissement" },
]

const ALLOWED_KEYS = new Set(TEMPLATE_VARIABLES.map((v) => v.key))

/** Retire les caractères de contrôle d'une valeur avant substitution. */
function cleanValue(value) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .slice(0, 200)
}

/**
 * Substitution pure. On ne construit aucune fonction, on n'évalue rien :
 * `{{clef}}` est remplacé si la clef est dans la liste blanche, sinon le texte
 * reste visible tel quel. Un modèle contenant du code reste du texte.
 */
export function renderTemplate(template, values = {}) {
  const source = String(template ?? '').slice(0, 1000)
  return source.replace(/\{\{\s*([a-z_]{1,24})\s*\}\}/gi, (whole, key) => {
    const normalized = String(key).toLowerCase()
    if (!ALLOWED_KEYS.has(normalized)) return whole
    return cleanValue(values[normalized])
  })
}

export const DEFAULT_TEMPLATE =
  'Bonjour, {{etablissement}} vous informe que {{etudiant}} ({{classe}}) totalise ' +
  "{{heures}} d'absence non justifiée sur la période {{periode}}. " +
  'Nous restons à votre disposition.'

/**
 * Construit le lien wa.me.
 *
 * @param {object} args
 * @param {string} args.phoneFromDatabase numéro LU EN BASE pour cet étudiant.
 *   Ne jamais passer une valeur venant d'un champ de formulaire ou de l'URL.
 * @param {string} args.message message déjà rendu par renderTemplate.
 * @returns {string|null} une URL https, ou null si le numéro est invalide.
 */
export function buildWhatsAppLink({ phoneFromDatabase, message }) {
  const digits = normalizePhone(phoneFromDatabase)
  if (!digits) return null
  const text = encodeURIComponent(String(message ?? '').slice(0, 1200))
  const url = `https://wa.me/${digits}?text=${text}`
  // Ceinture et bretelles : on vérifie que l'URL produite est bien https.
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'wa.me') return null
    return parsed.toString()
  } catch {
    return null
  }
}
