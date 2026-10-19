import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'

import {
  deviceDb,
  readMeta,
  writeMeta,
  writeProjection,
  wipeDevice,
  ensureOwner,
  META,
} from './device-db.js'
import { deviceId, isOnline, isForcedOffline, setForcedOffline } from './device.js'
import { synchroniser, startAutoSync, pendingCount, refusedCount, OUTBOX_STATES } from './sync.js'
import { connexion, deconnexion, changerMotDePasse, lire } from './serveur.js'

/**
 * Session côté appareil.
 *
 * §13.2 « Vol du jeton » : en production, le jeton de session vit dans un cookie
 * HttpOnly + Secure + SameSite, inaccessible au JavaScript. Ici, l'API est
 * simulée dans le navigateur : le jeton est rangé dans IndexedDB, et il est
 * effacé à la déconnexion (§13.5). Le passage à l'API réelle consiste à retirer
 * ce stockage, pas à l'adapter.
 */

const SessionContext = createContext(null)

export function SessionProvider({ children }) {
  const [pret, setPret] = useState(false)
  const [moi, setMoi] = useState(null)
  const [espace, setEspaceState] = useState(null)
  const [erreurSession, setErreurSession] = useState(null)

  /* --- état du réseau, réactif --- */
  const [enLigne, setEnLigne] = useState(isOnline())
  useEffect(() => {
    const maj = () => setEnLigne(isOnline())
    window.addEventListener('online', maj)
    window.addEventListener('offline', maj)
    window.addEventListener('presences:network', maj)
    return () => {
      window.removeEventListener('online', maj)
      window.removeEventListener('offline', maj)
      window.removeEventListener('presences:network', maj)
    }
  }, [])

  /* --- reprise de session au démarrage --- */
  useEffect(() => {
    let annule = false
    ;(async () => {
      const token = await readMeta(META.TOKEN)
      if (!token) {
        setPret(true)
        return
      }

      // La session reste ouverte hors ligne (§2), dans la limite du §13.2.
      const reponse = await lire(token, { online: isOnline() })
      if (annule) return

      if (reponse.error) {
        await wipeDevice()
        setMoi(null)
        setErreurSession(reponse.error.message)
        setPret(true)
        return
      }

      await writeProjection(reponse.data)
      await writeMeta(META.DERNIERE_LECTURE, reponse.data.recuA)
      setMoi(reponse.data.moi)
      setEspaceState(await readMeta(META.ESPACE, reponse.data.moi.roles[0] ?? null))
      setPret(true)
      startAutoSync()
      if (isOnline()) synchroniser({ silencieux: true })
    })()
    return () => {
      annule = true
    }
  }, [])

  const connecter = useCallback(async (identifiant, motDePasse) => {
    if (!isOnline()) {
      // §9 : la première connexion sur un appareil demande du réseau.
      return {
        ok: false,
        message:
          'La connexion demande du réseau. Rétablissez la connexion, puis réessayez.',
      }
    }

    const reponse = await connexion({
      identifiant,
      motDePasse,
      deviceId: deviceId(),
    })
    if (reponse.error) return { ok: false, message: reponse.error.message }

    const { token, moi: identite, offlineDeadline } = reponse.data

    // §13.5 : un autre compte sur le même appareil efface d'abord tout.
    await ensureOwner(identite.id)
    await writeMeta(META.TOKEN, token)
    await writeMeta(META.MOI, identite)
    await writeMeta(META.ECHEANCE_HORS_LIGNE, offlineDeadline)

    const projection = await lire(token, { online: true })
    if (projection.data) {
      await writeProjection(projection.data)
      await writeMeta(META.DERNIERE_LECTURE, projection.data.recuA)
    }

    setMoi(identite)
    const defaut = identite.roles.length === 1 ? identite.roles[0] : null
    setEspaceState(defaut)
    await writeMeta(META.ESPACE, defaut)
    setErreurSession(null)
    startAutoSync()
    return { ok: true, moi: identite }
  }, [])

  const deconnecter = useCallback(async () => {
    const token = await readMeta(META.TOKEN)
    if (token) await deconnexion(token)
    // §13.2 « Déconnexion incomplète » : jeton invalidé ET appareil effacé.
    await wipeDevice()
    setMoi(null)
    setEspaceState(null)
  }, [])

  const changerMonMotDePasse = useCallback(async (actuel, nouveau) => {
    const token = await readMeta(META.TOKEN)
    if (!token) return { ok: false, message: 'Session expirée.' }
    const reponse = await changerMotDePasse(token, { actuel, nouveau })
    if (reponse.error) return { ok: false, message: reponse.error.message }
    const projection = await lire(token, { online: true })
    if (projection.data) {
      await writeProjection(projection.data)
      setMoi(projection.data.moi)
    }
    return { ok: true }
  }, [])

  const setEspace = useCallback(async (role) => {
    setEspaceState(role)
    await writeMeta(META.ESPACE, role)
  }, [])

  const valeur = useMemo(
    () => ({
      pret,
      moi,
      roles: moi?.roles ?? [],
      espace,
      setEspace,
      connecter,
      deconnecter,
      changerMonMotDePasse,
      enLigne,
      modeAvion: isForcedOffline(),
      basculerModeAvion: () => setForcedOffline(!isForcedOffline()),
      erreurSession,
      effacerErreurSession: () => setErreurSession(null),
    }),
    [
      pret,
      moi,
      espace,
      setEspace,
      connecter,
      deconnecter,
      changerMonMotDePasse,
      enLigne,
      erreurSession,
    ],
  )

  return <SessionContext.Provider value={valeur}>{children}</SessionContext.Provider>
}

export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession doit être utilisé dans <SessionProvider>')
  return value
}

/* ------------------------------------------------------------------ *
 *  Lecture des projections
 * ------------------------------------------------------------------ */

/**
 * Lit une branche de la projection reçue du serveur.
 * Les composants ne lisent JAMAIS la base du serveur : seulement ceci.
 */
export function useProjection(key, fallback = null) {
  return (
    useLiveQuery(async () => {
      const row = await deviceDb.projection.get(key)
      return row?.value ?? fallback
    }, [key]) ?? fallback
  )
}

export function useDerniereLecture() {
  return useLiveQuery(async () => (await deviceDb.meta.get(META.DERNIERE_LECTURE))?.value ?? null, [])
}

/** État de la file d'attente, pour l'indicateur permanent (§9). */
export function useOutbox() {
  const lignes = useLiveQuery(() => deviceDb.outbox.orderBy('createdAt').toArray(), [], [])
  return useMemo(() => {
    const enAttente = lignes.filter((l) => l.state !== OUTBOX_STATES.REFUSEE)
    const refusees = lignes.filter((l) => l.state === OUTBOX_STATES.REFUSEE)
    return { lignes, enAttente, refusees, total: lignes.length }
  }, [lignes])
}

export { pendingCount, refusedCount }
