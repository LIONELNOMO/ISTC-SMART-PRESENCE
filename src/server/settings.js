/**
 * Paramètres de l'établissement (§3, §8, §14).
 *
 * Les valeurs que le cahier des charges laisse ouvertes n'ont volontairement
 * AUCUNE valeur par défaut : le seuil d'alerte et les dates de semestre doivent
 * être saisis par l'administration. Tant qu'ils sont vides, les écrans le disent
 * au lieu d'inventer un chiffre.
 */

import { serverDb } from './db.js'
import { DEFAULT_TEMPLATE } from '../lib/whatsapp.js'

export const DEFAULT_SETTINGS = {
  etablissement: 'Établissement',
  monnaie: 'FCFA', // §14 : à préciser par le client
  // §14 « Seuil d'alerte » : aucune valeur par défaut.
  seuilAlerteHeures: null,
  seuilAlertePeriode: 'semestre',
  // §4 : relevé possible pendant 7 jours, réglable.
  delaiReleveJours: 7,
  // §5 : correction du relevé pendant 48 heures, réglable.
  delaiCorrectionHeures: 48,
  // §13.2 : durée maximale d'une session hors ligne.
  dureeSessionHorsLigneJours: 7,
  modeleMessage: DEFAULT_TEMPLATE,
  // §3 : dates fournies par le client.
  semestres: null, // { s1Debut, s1Fin, s2Debut, s2Fin }
}

const CACHE_KEY = 'parametres'

export async function getSettings() {
  const row = await serverDb.settings.get(CACHE_KEY)
  return { ...DEFAULT_SETTINGS, ...(row?.value ?? {}) }
}

/** Écriture réservée à l'administration : l'appelant a déjà vérifié le rôle. */
export async function putSettings(patch) {
  const current = await getSettings()
  const next = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, key)) continue // liste blanche
    if (value === null || value === undefined) continue
    next[key] = value
  }
  await serverDb.settings.put({ key: CACHE_KEY, value: next })
  return next
}

/** Liste des semestres exploitable par `semesterOf` (§3). */
export function semestresOf(settings) {
  const s = settings?.semestres
  if (!s?.s1Debut || !s?.s1Fin || !s?.s2Debut || !s?.s2Fin) return []
  return [
    { id: 's1', nom: 'Semestre 1', debut: s.s1Debut, fin: `${s.s1Fin}T23:59:59.999Z` },
    { id: 's2', nom: 'Semestre 2', debut: s.s2Debut, fin: `${s.s2Fin}T23:59:59.999Z` },
  ]
}

/** Vrai quand l'administration n'a pas encore réglé un point obligatoire. */
export function missingSettings(settings) {
  const gaps = []
  if (!settings.semestres) gaps.push('Dates des semestres')
  if (settings.seuilAlerteHeures === null || settings.seuilAlerteHeures === undefined) {
    gaps.push("Seuil d'alerte aux parents")
  }
  return gaps
}
