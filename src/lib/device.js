/**
 * Identifiant d'appareil — §13.4 « Scan pour un camarade ».
 *
 * Ce n'est pas une empreinte de navigateur : c'est un identifiant aléatoire
 * tiré une fois et conservé localement. Il ne sert qu'à SIGNALER deux comptes
 * qui scannent depuis le même téléphone pour une même séance, jamais à
 * authentifier quoi que ce soit.
 */

import { randomId } from './crypto.js'

const KEY = 'presences.deviceId'

export function deviceId() {
  try {
    let value = localStorage.getItem(KEY)
    if (!value || !/^[0-9a-f-]{36}$/.test(value)) {
      value = randomId()
      localStorage.setItem(KEY, value)
    }
    return value
  } catch {
    // Navigation privée ou stockage refusé : l'appareil reste anonyme.
    return 'inconnu'
  }
}

/** Le mode avion simulé, pour éprouver le hors ligne sans couper le Wi-Fi. */
const OFFLINE_KEY = 'presences.forceOffline'

export function isForcedOffline() {
  try {
    return localStorage.getItem(OFFLINE_KEY) === '1'
  } catch {
    return false
  }
}

export function setForcedOffline(value) {
  try {
    if (value) localStorage.setItem(OFFLINE_KEY, '1')
    else localStorage.removeItem(OFFLINE_KEY)
  } catch {
    /* stockage indisponible */
  }
  window.dispatchEvent(new Event('presences:network'))
}

/** Vrai réseau ET mode avion simulé. */
export function isOnline() {
  return navigator.onLine !== false && !isForcedOffline()
}

const THEME_KEY = 'presences.theme'

export function readTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    /* ignore */
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.classList.toggle('light', theme === 'light')
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* ignore */
  }
}
