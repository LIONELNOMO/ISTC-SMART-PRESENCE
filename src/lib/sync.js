/**
 * File d'attente et synchronisation (§9).
 *
 *  « Chaque action faite hors ligne est gardée sur l'appareil… avec un
 *    identifiant unique et son heure. »                → `enqueue`
 *  « L'envoi démarre automatiquement au retour du réseau. » → écouteurs
 *  « Une action envoyée deux fois n'est enregistrée qu'une fois. » → opId
 *  « Une donnée en attente n'est effacée qu'après confirmation du serveur. »
 *                                                      → suppression après succès
 *
 * §13.5 « Perte de données en attente » : rien n'est supprimé localement avant
 * l'accusé de réception. Une action refusée définitivement reste visible dans la
 * file, avec son motif, jusqu'à ce que l'utilisateur la corrige ou l'abandonne.
 */

import { deviceDb, readMeta, writeMeta, writeProjection, META } from './device-db.js'
import { randomId } from './crypto.js'
import { nowIso } from './dates.js'
import { isOnline } from './device.js'
import { lire, soumettre } from './serveur.js'

/**
 * Actions qui demandent le réseau (§9, tableau « Hors ligne »).
 *
 * Cette liste est écrite en clair plutôt que déduite du serveur : elle doit
 * valoir aussi bien pour l'API PHP que pour la couche simulée, et l'interface
 * s'en sert pour désactiver un bouton AVANT tout appel.
 *
 * Elle ne fait que du confort : le serveur refuse de toute façon ces actions
 * hors ligne, et c'est lui qui fait foi.
 */
export const NETWORK_ONLY = new Set([
  // Le code de pointage change toutes les 60 s : seule l'heure du serveur peut
  // vérifier cette fenêtre (§13.4 « Photo du code QR de pointage »).
  'pointage.scan',
  // Les décisions et les réglages modifient le calcul des absences.
  'justification.demander',
  'justification.decider',
  'justification.directe',
  'parent.contacter',
  'departement.creer_matiere',
  'departement.demander_acces',
  'departement.decider_acces',
  'departement.revoquer_acces',
  'secretariat.creer_fiche',
  'secretariat.annuler_fiche',
  'admin.payer_fiche',
  'compte.profil',
  'admin.referentiel',
  'admin.taux',
  'admin.parametres',
  'admin.semestres',
  'admin.compte',
  'admin.import_etudiants',
])

export const OUTBOX_STATES = {
  EN_ATTENTE: 'en_attente',
  ENVOI: 'envoi',
  REFUSEE: 'refusee',
}

const listeners = new Set()

function emit(event) {
  for (const listener of listeners) listener(event)
}

export function onSync(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/* ------------------------------------------------------------------ *
 *  File d'attente
 * ------------------------------------------------------------------ */

/**
 * Met une action dans la file, puis tente de l'envoyer tout de suite si le
 * réseau est là.
 *
 * @returns {Promise<{ok:boolean, data?:object, error?:object, enAttente?:boolean}>}
 */
export async function enqueue(type, payload, { labelPourUtilisateur = null } = {}) {
  const op = {
    opId: randomId(), // clef d'idempotence (§9)
    type,
    payload,
    clientAt: nowIso(), // heure déclarée, revérifiée par le serveur
    createdAt: nowIso(),
    state: OUTBOX_STATES.EN_ATTENTE,
    tentatives: 0,
    label: labelPourUtilisateur,
    erreur: null,
  }
  await deviceDb.outbox.add(op)
  emit({ kind: 'file' })

  if (!isOnline()) {
    if (NETWORK_ONLY.has(type)) {
      // §9 : cette action n'est pas prévue hors ligne. On la retire pour ne pas
      // laisser croire qu'elle partira plus tard.
      await deviceDb.outbox.delete(op.opId)
      emit({ kind: 'file' })
      return {
        ok: false,
        error: {
          code: 'reseau',
          message: 'Cette action demande une connexion. Reconnectez-vous pour la réaliser.',
        },
      }
    }
    return { ok: true, enAttente: true, opId: op.opId }
  }

  const resultat = await envoyer(op)
  return resultat
}

/** Envoie une opération et met la file à jour selon la réponse du serveur. */
async function envoyer(op) {
  const token = await readMeta(META.TOKEN)
  if (!token) {
    return { ok: false, error: { code: 'session', message: 'Session expirée.' } }
  }

  await deviceDb.outbox.update(op.opId, {
    state: OUTBOX_STATES.ENVOI,
    tentatives: (op.tentatives ?? 0) + 1,
  })
  emit({ kind: 'file' })

  const reponse = await soumettre(
    token,
    { opId: op.opId, type: op.type, payload: op.payload, clientAt: op.clientAt },
    { online: isOnline() },
  )

  if (reponse.data) {
    // Confirmation reçue : on peut effacer localement (§9).
    await deviceDb.outbox.delete(op.opId)
    emit({ kind: 'file' })
    return { ok: true, data: reponse.data }
  }

  const erreur = reponse.error
  if (erreur.retryable) {
    await deviceDb.outbox.update(op.opId, {
      state: OUTBOX_STATES.EN_ATTENTE,
      erreur: erreur.message,
    })
    emit({ kind: 'file' })
    return { ok: false, enAttente: true, error: erreur }
  }

  // Refus définitif : l'action reste visible pour que l'utilisateur la corrige
  // (code de séance faux, par exemple), elle ne repart pas toute seule.
  await deviceDb.outbox.update(op.opId, {
    state: OUTBOX_STATES.REFUSEE,
    erreur: erreur.message,
  })
  emit({ kind: 'file' })
  return { ok: false, error: erreur }
}

/** Abandonne une action refusée. */
export async function abandonner(opId) {
  await deviceDb.outbox.delete(opId)
  emit({ kind: 'file' })
}

/* ------------------------------------------------------------------ *
 *  Synchronisation
 * ------------------------------------------------------------------ */

let enCours = false

/**
 * Vide la file dans l'ordre, puis relit la projection.
 * Une synchronisation coupée puis relancée ne crée aucun doublon : chaque action
 * garde son identifiant, et le serveur ignore les rejeux.
 */
export async function synchroniser({ silencieux = false } = {}) {
  if (enCours) return { ok: false, raison: 'deja_en_cours' }
  if (!isOnline()) return { ok: false, raison: 'hors_ligne' }

  const token = await readMeta(META.TOKEN)
  if (!token) return { ok: false, raison: 'pas_de_session' }

  enCours = true
  if (!silencieux) emit({ kind: 'debut' })

  let envoyees = 0
  let refusees = 0

  try {
    const aEnvoyer = await deviceDb.outbox
      .where('state')
      .anyOf([OUTBOX_STATES.EN_ATTENTE, OUTBOX_STATES.ENVOI])
      .sortBy('createdAt')

    for (const op of aEnvoyer) {
      if (!isOnline()) break
      const resultat = await envoyer(op)
      if (resultat.ok) envoyees += 1
      else if (!resultat.enAttente) refusees += 1
    }

    const projection = await lire(token, { online: true })
    if (projection.data) {
      await writeProjection(projection.data)
      await writeMeta(META.DERNIERE_LECTURE, projection.data.recuA)
      emit({ kind: 'fin', envoyees, refusees })
      return { ok: true, envoyees, refusees }
    }

    emit({ kind: 'fin', envoyees, refusees, erreur: projection.error })
    return { ok: false, raison: projection.error?.code ?? 'lecture', erreur: projection.error }
  } finally {
    enCours = false
  }
}

/** Nombre d'éléments en attente, pour l'indicateur permanent (§9). */
export async function pendingCount() {
  return deviceDb.outbox.where('state').notEqual(OUTBOX_STATES.REFUSEE).count()
}

export async function refusedCount() {
  return deviceDb.outbox.where('state').equals(OUTBOX_STATES.REFUSEE).count()
}

/* ------------------------------------------------------------------ *
 *  Déclencheurs automatiques
 * ------------------------------------------------------------------ */

let installe = false

export function startAutoSync() {
  if (installe) return
  installe = true

  const relancer = () => {
    if (isOnline()) synchroniser({ silencieux: true })
  }

  window.addEventListener('online', relancer)
  window.addEventListener('presences:network', relancer)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') relancer()
  })

  // Rafraîchissement régulier quand le réseau est là : le suivi est « en temps
  // réel quand le secrétariat est connecté » (§7).
  setInterval(relancer, 30_000)
}
