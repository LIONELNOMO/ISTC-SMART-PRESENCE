import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Utilitaires sans aucune responsabilité de sécurité.
 * Les codes, jetons, identifiants et mots de passe sont dans `crypto.js`
 * (§13.11 : jamais de Math.random pour un secret).
 */

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function sortBy(list, pick, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1
  return [...list].sort((a, b) => {
    const va = pick(a)
    const vb = pick(b)
    if (va === vb) return 0
    if (va === undefined || va === null) return 1
    if (vb === undefined || vb === null) return -1
    return va > vb ? sign : -sign
  })
}

export function groupBy(list, pick) {
  const map = new Map()
  for (const item of list) {
    const key = pick(item)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(item)
  }
  return map
}

export function sum(list, pick = (x) => x) {
  return list.reduce((acc, item) => acc + (Number(pick(item)) || 0), 0)
}

export function unique(list) {
  return [...new Set(list)]
}

export function initials(nom = '', prenom = '') {
  const value = `${(prenom[0] || '').toUpperCase()}${(nom[0] || '').toUpperCase()}`
  return value || '?'
}

export function debounce(fn, ms = 250) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Découpe une liste en tranches, pour la pagination obligatoire (§13.6). */
export function paginate(list, page = 1, size = 50) {
  const total = list.length
  const pages = Math.max(1, Math.ceil(total / size))
  const current = Math.min(Math.max(1, page), pages)
  const start = (current - 1) * size
  return { rows: list.slice(start, start + size), total, pages, page: current, size }
}

/** Nombre d'heures décimales formaté « 6 h 30 ». */
export function formatHours(hours) {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return '—'
  const totalMinutes = Math.round(Number(hours) * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (m === 0) return `${h} h`
  return `${h} h ${String(m).padStart(2, '0')}`
}

/**
 * Libellé bilingue d'une matière, en une seule chaîne : « Français · English ».
 * L'anglais est omis s'il est absent ou identique au français.
 */
export function libelleMatiere(nom, nomEn) {
  const fr = (nom ?? '').trim()
  const en = (nomEn ?? '').trim()
  if (!en || en === fr) return fr || '—'
  return `${fr} · ${en}`
}

/** Montant arrondi à l'unité monétaire (§7). */
export function formatMoney(amount, currency = 'FCFA') {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—'
  const rounded = Math.round(Number(amount))
  return `${rounded.toLocaleString('fr-FR')} ${currency}`
}

export function formatCount(n) {
  return Number(n || 0).toLocaleString('fr-FR')
}

/** Tronque un texte pour l'affichage, sans jamais interpréter son contenu. */
export function truncate(text, max = 80) {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
