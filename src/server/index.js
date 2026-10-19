/**
 * L'API du serveur de démonstration. Cinq fonctions, et rien d'autre n'écrit.
 *
 *   connexion()        — §13.2
 *   deconnexion()      — §13.2
 *   changerMotDePasse()— §13.2
 *   lire()             — projections filtrées par rôle (§13.8, §13.10)
 *   soumettre()        — file d'attente, idempotence, transactions (§13.5, §13.6)
 *
 * Tout appel passe par guard.js. Toute écriture passe par ops.js. Toute lecture
 * passe par projection.js. Il n'existe aucun autre chemin vers la base.
 */

import Dexie from 'dexie'

import { serverDb } from './db.js'
import { AppError, errors, logServer, toClientError } from './errors.js'
import {
  createAuthSession,
  resolveContext,
  revokeAuthSession,
  revokeAllSessions,
  requireRole,
} from './guard.js'
import { project } from './projection.js'
import { HANDLERS, reconcilePendingScans } from './ops.js'
import {
  OP_SCHEMAS,
  CONNEXION_SHAPE,
  CHANGE_PASSWORD_SHAPE,
  validate,
} from './schema.js'
import { assertAllowed, recordFailure, recordSuccess, remainingAttempts } from './ratelimit.js'
import { appendAudit } from './audit.js'
import { hashPassword, verifyPassword, passwordProblem } from '../lib/crypto.js'
import { nowIso } from '../lib/dates.js'

const hashTx = (plain) => Dexie.waitFor(hashPassword(plain))
const verifyTx = (plain, stored) => Dexie.waitFor(verifyPassword(plain, stored))

/** Résultat uniforme : soit `{ data }`, soit `{ error }`. Jamais d'exception brute. */
function ok(data) {
  return { data }
}

/* ================================================================== *
 *  Connexion
 * ================================================================== */

/**
 * §13.2 « Énumération de comptes » : même message et même coût pour un compte
 * inconnu et un mot de passe faux. On calcule un condensé factice quand le
 * compte n'existe pas, pour que le temps de réponse ne trahisse rien.
 */
const FAUX_CONDENSE =
  'pbkdf2$210000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

export async function connexion(input) {
  try {
    const payload = validate(input, CONNEXION_SHAPE, 'connexion')
    const loginKey = payload.identifiant.trim().toLowerCase()

    // Limite par compte visé ET par appareil (§13.2 « Force brute »).
    await assertAllowed('connexion', loginKey)
    await assertAllowed('connexion', `appareil:${payload.deviceId}`)

    const user = await serverDb.users.where('loginKey').equals(loginKey).first()
    const stored = user?.passwordHash ?? FAUX_CONDENSE
    const bon = await verifyTx(payload.motDePasse, stored)

    if (!user || !bon || user.actif === false) {
      await recordFailure('connexion', loginKey, { identifiant: '[masqué]' })
      await recordFailure('connexion', `appareil:${payload.deviceId}`)
      logServer('connexion_refusee', {})
      throw errors.identifiants()
    }

    await recordSuccess('connexion', loginKey)
    await recordSuccess('connexion', `appareil:${payload.deviceId}`)

    const auth = await createAuthSession(user, payload.deviceId)
    const ctx = await resolveContext(auth.token, { online: true })

    return ok({
      token: auth.token,
      offlineDeadline: auth.offlineDeadline,
      moi: {
        id: user.id,
        nom: user.nom ?? '',
        prenom: user.prenom ?? '',
        telephone: user.telephone ?? '',
        label: ctx.label,
        login: user.login,
        roles: ctx.roles,
        mustChangePassword: Boolean(user.mustChangePassword),
      },
    })
  } catch (error) {
    return toClientError(error)
  }
}

export async function deconnexion(token) {
  try {
    await revokeAuthSession(token)
    return ok({ ok: true })
  } catch (error) {
    return toClientError(error)
  }
}

/**
 * §13.2 « Changement de mot de passe sans l'ancien » : le mot de passe actuel est
 * exigé, et toutes les autres sessions sont fermées.
 */
export async function changerMotDePasse(token, input) {
  try {
    const ctx = await resolveContext(token, { online: true })
    const payload = validate(input, CHANGE_PASSWORD_SHAPE, 'mot de passe')

    await assertAllowed('connexion', `changement:${ctx.userId}`)
    const bon = await verifyTx(payload.actuel, ctx.user.passwordHash)
    if (!bon) {
      await recordFailure('connexion', `changement:${ctx.userId}`)
      throw errors.identifiants()
    }

    const probleme = passwordProblem(payload.nouveau)
    if (probleme) throw errors.invalide(probleme)
    if (payload.nouveau === payload.actuel) {
      throw errors.invalide('Choisissez un mot de passe différent de l’actuel.')
    }

    const hash = await hashTx(payload.nouveau)
    await serverDb.users.put({
      ...(await serverDb.users.get(ctx.userId)),
      passwordHash: hash,
      mustChangePassword: false,
      passwordChangedAt: nowIso(),
    })
    await revokeAllSessions(ctx.userId, { except: token })
    await recordSuccess('connexion', `changement:${ctx.userId}`)

    await appendAudit({
      entity: 'compte',
      entityId: ctx.userId,
      action: 'mot_de_passe_change',
      authorId: ctx.userId,
      authorLabel: ctx.label,
    })

    return ok({ ok: true })
  } catch (error) {
    return toClientError(error)
  }
}

/* ================================================================== *
 *  Lecture
 * ================================================================== */

/**
 * Projection complète pour le rôle du porteur du jeton. Appelée à la connexion
 * puis à chaque synchronisation (§9).
 */
export async function lire(token, { online = true } = {}) {
  try {
    const ctx = await resolveContext(token, { online })
    await reconcilePendingScans() // §9 : scans arrivés avant leur séance
    const data = await project(ctx)
    return ok(data)
  } catch (error) {
    return toClientError(error)
  }
}

/** Essais restants sur le code de séance, pour l'afficher à l'enseignant. */
export async function essaisCodeSeance(token) {
  try {
    const ctx = await resolveContext(token, { online: false })
    return ok({ restants: await remainingAttempts('code_seance', ctx.userId) })
  } catch (error) {
    return toClientError(error)
  }
}

/* ================================================================== *
 *  Écriture
 * ================================================================== */

/**
 * Soumet une opération. C'est le point d'entrée de la file d'attente hors ligne.
 *
 *  §13.5 « File d'attente falsifiée » — les mêmes contrôles qu'en ligne.
 *  §13.5 « Rejeu de synchronisation » — clef primaire [userId+opId].
 *  §13.5 « Identifiant d'action usurpé » — l'unicité porte sur le COUPLE
 *         utilisateur + identifiant, pas sur l'identifiant seul.
 *  §13.5 « Droits périmés hors ligne » — le contexte est résolu maintenant.
 *  §13.6 « Erreur mal gérée »         — tout se passe dans une transaction.
 *
 * @param {string} token
 * @param {{opId:string, type:string, payload:object, clientAt:string}} op
 * @param {{online:boolean}} options
 */
export async function soumettre(token, op, { online = true } = {}) {
  const receivedAt = nowIso()
  try {
    if (!op || typeof op !== 'object') throw errors.invalide()
    const type = String(op.type ?? '')
    const opId = String(op.opId ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(opId)) throw errors.invalide('Identifiant d’action invalide.')

    const schema = OP_SCHEMAS[type]
    const handler = HANDLERS[type]
    // §13.3 « Routes oubliées » : sans schéma ET sans gestionnaire, c'est non.
    if (!schema || !handler) throw errors.droits()

    const ctx = await resolveContext(token, { online })
    await assertAllowed('synchro', ctx.userId)

    // Première porte : le rôle. Avant même de regarder le contenu.
    requireRole(ctx, schema.roles)

    // §9 : certaines actions demandent le réseau.
    if (handler.requiresNetwork && !online) throw errors.reseau()

    // Idempotence : une action déjà traitée renvoie son résultat d'origine.
    const deja = await serverDb.processed.get([ctx.userId, opId])
    if (deja) {
      logServer('action_rejouee', { type, userId: ctx.userId })
      return ok({ ...deja.result, rejouee: true })
    }

    const payload = validate(op.payload ?? {}, schema.shape, type)
    const meta = { opId, clientAt: op.clientAt ?? null, receivedAt, online }

    const result = await serverDb.transaction('rw', serverDb.tables, async () => {
      // Deuxième lecture dans la transaction : deux synchronisations simultanées
      // ne peuvent pas passer toutes les deux (§13.6 « Requêtes simultanées »).
      const encore = await serverDb.processed.get([ctx.userId, opId])
      if (encore) return { ...encore.result, rejouee: true }

      const out = (await handler.run(ctx, payload, meta)) ?? { ok: true }
      await serverDb.processed.add({
        userId: ctx.userId,
        opId,
        type,
        at: receivedAt,
        result: out,
      })
      return out
    })

    await recordSuccess('synchro', ctx.userId)
    if (type === 'secretariat.arrivee' || type === 'pointage.scan') {
      await reconcilePendingScans()
    }
    logServer('action_acceptee', { type, userId: ctx.userId })
    return ok(result)
  } catch (error) {
    if (error instanceof AppError) {
      logServer('action_refusee', { type: op?.type, code: error.code })
    } else {
      logServer('action_erreur', { type: op?.type, message: error?.message })
    }
    return toClientError(error)
  }
}

/* ================================================================== *
 *  Administration de la démonstration
 * ================================================================== */

/** Compte le nombre d'entrées d'historique, pour l'écran Historique. */
export async function compterHistorique(token) {
  try {
    const ctx = await resolveContext(token, { online: false })
    requireRole(ctx, ['administration'])
    return ok({ total: await serverDb.audit.count() })
  } catch (error) {
    return toClientError(error)
  }
}
