/**
 * Dates et heures.
 *
 * §13.4 « Durées impossibles » : toutes les dates circulent et sont stockées en
 * ISO 8601 UTC. L'affichage local se fait au dernier moment, à la lecture.
 */

export const MINUTE = 60_000
export const HOUR = 3_600_000
export const DAY = 86_400_000

/** Horodatage serveur, en UTC. */
export function nowIso() {
  return new Date().toISOString()
}

export function toIso(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Jour civil local au format YYYY-MM-DD, pour grouper les séances. */
export function dayKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function monthKey(value = new Date()) {
  return dayKey(value)?.slice(0, 7) ?? null
}

/** Lundi de la semaine du jour donné. */
export function startOfWeek(value = new Date()) {
  const d = new Date(value)
  d.setHours(0, 0, 0, 0)
  const shift = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - shift)
  return d
}

export function startOfDay(value = new Date()) {
  const d = new Date(value)
  d.setHours(0, 0, 0, 0)
  return d
}

export function startOfMonth(value = new Date()) {
  const d = new Date(value)
  d.setHours(0, 0, 0, 0)
  d.setDate(1)
  return d
}

const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' })
const longFmt = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})
const stampFmt = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : timeFmt.format(d)
}

export function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d)
}

export function formatLongDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : longFmt.format(d)
}

export function formatStamp(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : stampFmt.format(d)
}

/** « il y a 4 min » — utilisé par l'indicateur de dernière donnée reçue (§7). */
export function formatAgo(iso, from = Date.now()) {
  if (!iso) return 'jamais'
  const delta = from - new Date(iso).getTime()
  if (Number.isNaN(delta)) return 'jamais'
  if (delta < 10_000) return "à l'instant"
  if (delta < MINUTE) return `il y a ${Math.floor(delta / 1000)} s`
  if (delta < HOUR) return `il y a ${Math.floor(delta / MINUTE)} min`
  if (delta < DAY) return `il y a ${Math.floor(delta / HOUR)} h`
  return `il y a ${Math.floor(delta / DAY)} j`
}

/** Durée en heures décimales entre deux instants, à la minute près (§4, §7). */
export function hoursBetween(startIso, endIso) {
  if (!startIso || !endIso) return null
  const a = new Date(startIso).getTime()
  const b = new Date(endIso).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  const minutes = Math.round((b - a) / MINUTE)
  return minutes / 60
}

/** Durée lisible « 6 h 05 » entre deux instants. */
export function formatSpan(startIso, endIso) {
  const h = hoursBetween(startIso, endIso)
  if (h === null) return '—'
  const totalMinutes = Math.round(h * 60)
  const hh = Math.floor(totalMinutes / 60)
  const mm = totalMinutes % 60
  return mm === 0 ? `${hh} h` : `${hh} h ${String(mm).padStart(2, '0')}`
}

/**
 * Semestre d'une date, déduit des dates saisies par l'administration (§3).
 * `semestres` : [{ id, nom, debut, fin }]
 */
export function semesterOf(iso, semestres = []) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return (
    semestres.find((s) => {
      const start = new Date(s.debut).getTime()
      const end = new Date(s.fin).getTime()
      return t >= start && t <= end
    }) ?? null
  )
}

export function isSameDay(a, b) {
  return dayKey(a) === dayKey(b)
}

/** Validation d'une date saisie à la main par la secrétaire (§13.4). */
export function isPlausibleInstant(iso, { notBefore = null, notAfter = null } = {}) {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return false
  if (notBefore && t < new Date(notBefore).getTime()) return false
  if (notAfter && t > new Date(notAfter).getTime()) return false
  return true
}

/** Convertit « 16:30 » sur le jour d'un instant de référence en ISO UTC. */
export function timeOnDayToIso(hhmm, referenceIso) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || '').trim())
  if (!match) return null
  const ref = new Date(referenceIso)
  if (Number.isNaN(ref.getTime())) return null
  const d = new Date(ref)
  d.setHours(Number(match[1]), Number(match[2]), 0, 0)
  return d.toISOString()
}

/** Valeur pour un <input type="time"> à partir d'un ISO. */
export function isoToTimeInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
