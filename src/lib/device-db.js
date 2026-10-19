import Dexie from 'dexie'

/**
 * Base de l'APPAREIL. Elle ne contient que :
 *   - `meta`       : jeton de session, identité, horodatage de dernière lecture
 *   - `outbox`     : file d'attente des actions faites hors ligne (§9)
 *   - `projection` : les données reçues du serveur, DÉJÀ filtrées par rôle
 *
 * §13.5 « Données sensibles sur l'appareil » : ce qui n'est pas dans la
 * projection du rôle n'arrive jamais ici. Un téléphone d'enseignant ne contient
 * donc ni taux, ni montant, ni numéro de parent.
 *
 * §13.5 « Données locales modifiées » : tout ce qui part d'ici vers le serveur
 * est revérifié. Modifier cette base à la main ne donne aucun droit.
 */
export const deviceDb = new Dexie('presences_appareil')

deviceDb.version(1).stores({
  meta: 'key',
  outbox: 'opId, state, createdAt',
  projection: 'key',
})

export const META = {
  TOKEN: 'token',
  MOI: 'moi',
  PROPRIETAIRE: 'proprietaire',
  DERNIERE_LECTURE: 'derniereLecture',
  ESPACE: 'espace',
  ECHEANCE_HORS_LIGNE: 'echeanceHorsLigne',
}

export async function readMeta(key, fallback = null) {
  const row = await deviceDb.meta.get(key)
  return row?.value ?? fallback
}

export async function writeMeta(key, value) {
  await deviceDb.meta.put({ key, value })
}

export async function readProjection(key, fallback = null) {
  const row = await deviceDb.projection.get(key)
  return row?.value ?? fallback
}

/**
 * Écrit la projection reçue du serveur. Les clefs absentes de la réponse sont
 * SUPPRIMÉES : si un rôle est retiré à un compte, les données de ce rôle
 * disparaissent de l'appareil à la synchronisation suivante (§13.5).
 */
export async function writeProjection(data) {
  const keys = Object.keys(data)
  await deviceDb.transaction('rw', deviceDb.projection, async () => {
    const existantes = await deviceDb.projection.toCollection().primaryKeys()
    const aSupprimer = existantes.filter((key) => !keys.includes(key))
    if (aSupprimer.length) await deviceDb.projection.bulkDelete(aSupprimer)
    await deviceDb.projection.bulkPut(keys.map((key) => ({ key, value: data[key] })))
  })
}

/**
 * §13.5 « Données restées après déconnexion » et §13.2 « Déconnexion incomplète ».
 * Efface la base de l'appareil ET les caches du service worker.
 */
export async function wipeDevice() {
  try {
    await deviceDb.delete()
  } catch {
    /* base déjà absente */
  }
  await deviceDb.open()

  // Les caches ne contiennent que les fichiers de l'application, mais on les
  // vide quand même : un appareil partagé ne garde rien.
  try {
    if (globalThis.caches) {
      const noms = await caches.keys()
      await Promise.all(noms.map((nom) => caches.delete(nom)))
    }
  } catch {
    /* API Cache indisponible */
  }
}

/**
 * Sépare les données par utilisateur : si un autre compte se connecte sur le
 * même téléphone, la base est effacée avant d'écrire quoi que ce soit (§13.5).
 */
export async function ensureOwner(userId) {
  const actuel = await readMeta(META.PROPRIETAIRE)
  if (actuel && actuel !== userId) {
    await wipeDevice()
  }
  await writeMeta(META.PROPRIETAIRE, userId)
}
