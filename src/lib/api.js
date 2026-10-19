/**
 * Client de l'API.
 *
 * Expose exactement les mêmes fonctions que `src/server/index.js` — la couche
 * simulée — pour que le reste de l'application n'ait pas à savoir laquelle
 * des deux répond : `connexion`, `deconnexion`, `changerMotDePasse`, `lire`,
 * `soumettre`.
 *
 * §13.2 « Vol du jeton » : en production, la session tient dans un cookie
 * HttpOnly posé par le serveur — un script injecté ne peut pas le lire. Le
 * jeton rendu par la connexion n'est gardé que comme repli, pour les
 * navigateurs qui bloquent les cookies dans certains contextes.
 *
 * §13.8 « Sécurité calculée côté client » : ce fichier ne décide de rien. Il
 * transporte, et renvoie tel quel ce que le serveur répond.
 */

import { readMeta, writeMeta, META } from './device-db.js'

/**
 * Adresse de l'API.
 *
 * Vide par défaut : l'application et l'API sont servies par le même domaine,
 * donc un chemin relatif suffit et aucun en-tête CORS n'est nécessaire
 * (§13.6 « CORS trop ouvert »). `VITE_API_URL` ne sert qu'au cas où elles
 * seraient séparées — et c'est une adresse publique, pas un secret (§13.8).
 */
const BASE = (import.meta.env?.VITE_API_URL ?? '').replace(/\/+$/, '')

/** Délai au-delà duquel on considère que le réseau ne répond pas. */
const DELAI_MS = 20000

/**
 * Appelle une route de l'API.
 *
 * Retourne toujours `{ data }` ou `{ error }` — jamais une exception — pour
 * que les appelants n'aient qu'une seule forme à traiter, comme avec la
 * couche simulée.
 */
async function appeler(route, { methode = 'GET', corps = null } = {}) {
  const controleur = new AbortController()
  const minuterie = setTimeout(() => controleur.abort(), DELAI_MS)

  try {
    const entetes = { Accept: 'application/json' }
    if (corps !== null) {
      entetes['Content-Type'] = 'application/json'
    }

    // Repli quand le cookie ne passe pas : le jeton voyage en en-tête.
    const jeton = await readMeta(META.TOKEN)
    if (jeton) {
      entetes['X-Jeton'] = jeton
    }

    const reponse = await fetch(`${BASE}/api/${route}`, {
      method: methode,
      headers: entetes,
      body: corps === null ? undefined : JSON.stringify(corps),
      // Indispensable pour que le cookie de session circule.
      credentials: 'include',
      signal: controleur.signal,
    })

    // Une réponse non-JSON signale un problème d'hébergement (page d'erreur
    // HTML, redirection). On le dit clairement plutôt que de planter.
    const texte = await reponse.text()
    let charge
    try {
      charge = JSON.parse(texte)
    } catch {
      return {
        error: {
          code: 'reponse_invalide',
          message:
            "Le serveur n'a pas répondu en JSON. Vérifiez que le dossier /api est bien déployé.",
          retryable: true,
        },
      }
    }

    if (charge.error) {
      return charge
    }
    return { data: charge.data }
  } catch (erreur) {
    // Coupure réseau, délai dépassé, serveur injoignable : c'est réessayable,
    // ce qui permet à la file d'attente de garder l'action (§9).
    const expire = erreur?.name === 'AbortError'
    return {
      error: {
        code: 'reseau',
        message: expire
          ? "Le serveur met trop de temps à répondre."
          : 'Pas de connexion au serveur.',
        retryable: true,
      },
    }
  } finally {
    clearTimeout(minuterie)
  }
}

/* ------------------------------------------------------------------ *
 *  Les cinq fonctions attendues par l'application
 * ------------------------------------------------------------------ */

export async function connexion({ identifiant, motDePasse, deviceId }) {
  const reponse = await appeler('connexion', {
    methode: 'POST',
    corps: { identifiant, motDePasse, deviceId },
  })

  // Le jeton de repli est rangé dès la connexion, avant tout autre appel.
  if (reponse.data?.token) {
    await writeMeta(META.TOKEN, reponse.data.token)
  }
  return reponse
}

export async function deconnexion() {
  return appeler('deconnexion', { methode: 'POST' })
}

export async function changerMotDePasse(_token, { actuel, nouveau }) {
  return appeler('mot-de-passe', { methode: 'POST', corps: { actuel, nouveau } })
}

export async function lire(_token, { online = true } = {}) {
  // Hors ligne, inutile d'essayer : l'appareil garde sa dernière projection.
  if (!online) {
    return {
      error: { code: 'reseau', message: 'Action impossible hors ligne.', retryable: true },
    }
  }
  return appeler('lire')
}

export async function soumettre(_token, op, { online = true } = {}) {
  return appeler('soumettre', {
    methode: 'POST',
    corps: {
      opId: op.opId,
      type: op.type,
      payload: op.payload,
      clientAt: op.clientAt,
      online,
    },
  })
}

/* ------------------------------------------------------------------ *
 *  Divers
 * ------------------------------------------------------------------ */

/** État du service, sans aucun secret. Utile au diagnostic de déploiement. */
export async function sante() {
  return appeler('sante')
}

/**
 * Fiche des heures d'un enseignant (secrétariat GRH, admin). Sans montants.
 * Lecture paramétrée : la fiche n'est chargée que pour l'enseignant demandé.
 */
export async function ficheEnseignant(_token, teacherId, debut = null, fin = null) {
  const qs = new URLSearchParams({ teacher: teacherId })
  if (debut) qs.set('debut', debut)
  if (fin) qs.set('fin', fin)
  return appeler(`rapport?${qs.toString()}`)
}

/**
 * Chiffres affichés sur l'écran de connexion.
 *
 * §13.10 : seuls des comptages et le nom de l'établissement. Appelée avant
 * toute session, elle ne doit rien révéler d'une personne.
 */
export async function vitrine() {
  const reponse = await appeler('vitrine')
  // L'écran de connexion doit s'afficher même si le serveur ne répond pas.
  if (reponse.error) {
    return { etablissement: null, enseignants: 0, etudiants: 0, seances: 0 }
  }
  return reponse.data
}

/**
 * Adresse de téléchargement d'un justificatif.
 *
 * §13.7 : le fichier n'est pas transporté dans la projection. Il passe par une
 * route qui vérifie les droits, et le serveur force le téléchargement plutôt
 * que l'affichage.
 */
export function lienJustificatif(nom) {
  return `${BASE}/api/justificatif?nom=${encodeURIComponent(nom)}`
}
