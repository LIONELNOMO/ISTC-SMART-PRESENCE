import Dexie from 'dexie'

/**
 * Base du SERVEUR de démonstration.
 *
 * Seuls les modules de `src/server/` ouvrent ce fichier. Aucun écran, aucun
 * composant, aucun module de `src/lib/` n'y touche : c'est la frontière de
 * confiance décrite à l'annexe A de securité.md.
 *
 * L'appareil, lui, écrit dans `src/lib/device-db.js`, qui ne contient que des
 * projections filtrées par rôle (§13.5 « Données sensibles sur l'appareil »).
 */
export const serverDb = new Dexie('presences_serveur')

serverDb.version(1).stores({
  // --- comptes et référentiel (§3) ---
  users: 'id, &loginKey, filiereId, teacherId, studentId',
  filieres: 'id, nom',
  classes: 'id, filiereId, niveau',
  students: 'id, &matricule, classeId, userId',
  teachers: 'id, userId',
  matieres: 'id, classeId',
  affectations: 'id, teacherId, matiereId, &[teacherId+matiereId]',

  // --- taux : jamais projetés hors administration (§13.3) ---
  rates: 'id, scope, teacherId, matiereId, niveau, dateEffet',

  // --- séances et présences ---
  sessions: 'id, teacherId, matiereId, classeId, day, status',
  attendance: '[sessionId+studentId], sessionId, studentId, status, at',
  justifications: 'id, [sessionId+studentId], state, filiereId, studentId',
  notifications: 'id, classeId, sessionId, at',
  parentContacts: 'id, studentId, at',

  // --- historique en ajout seul (§13.12) ---
  audit: 'id, at, entity, entityId, authorId',

  // --- plomberie de sécurité ---
  authSessions: 'token, userId, expiresAt',
  processed: '[userId+opId], at', // idempotence de la file d'attente (§13.5)
  usedTokens: '[stationId+nonce], at', // rejeu d'un pointage (§13.4)
  attempts: 'key', // force brute (§13.2, §13.4)
  stations: 'id, secretaryUserId',
  settings: 'key',
  anomalies: 'id, at, kind, subjectId',
})

// v2 : fiches d'heures transmises par le secrétariat à un enseignant (§7).
// Version incrémentée plutôt qu'ajout dans la v1, pour ne pas casser une base
// déjà créée sur un poste.
serverDb.version(2).stores({
  fiches: 'id, teacherId, sentAt',
})

// v3 : avis destinés à un enseignant (pop-up à l'ouverture de son espace).
serverDb.version(3).stores({
  avis: 'id, teacherId, at',
})

// v4 : appels déclarés par un enseignant sans secrétaire, en attente de
// pointage des heures (§4).
serverDb.version(4).stores({
  declares: 'id, teacherId, matiereId, day, sessionId',
})

// v5 : départements (Gestion, Technologique, Santé).
serverDb.version(5).stores({
  departements: 'id, nom',
})

// v6 : autorisations de partage d'un enseignant entre départements (§13.3).
serverDb.version(6).stores({
  autorisations: 'id, teacherId, departementId, statut, &[teacherId+departementId]',
})

// v7 : section anglophone (§4). On indexe `section` sur les étudiants et les
// séances pour filtrer un groupe sans parcourir toute la table. Le drapeau
// `sectionAnglophone` de la filière est un simple champ (pas d'index).
serverDb.version(7).stores({
  students: 'id, &matricule, classeId, userId, section',
  sessions: 'id, teacherId, matiereId, classeId, day, status, section',
})

/**
 * §13.12 « Historique modifiable ».
 *
 * L'historique est en AJOUT SEUL. Dexie déclenche ces hooks pour toute écriture,
 * y compris depuis la console du navigateur : modifier ou supprimer une ligne
 * d'historique lève une erreur au lieu de passer silencieusement.
 */

/**
 * Erreur levée par les hooks ci-dessous.
 *
 * `Dexie.ModifyError` attend un objet de causes, pas un message : construite
 * avec une chaîne, elle lève un TypeError pendant sa propre construction et le
 * refus devient illisible. On utilise donc une erreur ordinaire, dont le
 * message dit clairement ce qui est interdit.
 */
export class HistoriqueImmuableError extends Error {
  constructor(message) {
    super(message)
    this.name = 'HistoriqueImmuableError'
  }
}

serverDb.audit.hook('updating', () => {
  throw new HistoriqueImmuableError("L'historique ne peut pas être modifié.")
})
serverDb.audit.hook('deleting', () => {
  throw new HistoriqueImmuableError("L'historique ne peut pas être supprimé.")
})

/** Tables effacées lors d'une remise à zéro de la démonstration. */
export const ALL_TABLES = [
  'users',
  'filieres',
  'classes',
  'students',
  'teachers',
  'matieres',
  'affectations',
  'rates',
  'sessions',
  'attendance',
  'justifications',
  'notifications',
  'parentContacts',
  'authSessions',
  'processed',
  'usedTokens',
  'attempts',
  'stations',
  'settings',
  'anomalies',
  'autorisations',
]

/**
 * Remise à zéro complète. `audit` est volontairement exclue des effacements
 * ciblés : seule une suppression de la base entière la vide, et c'est un geste
 * explicite de l'administrateur de la démonstration.
 */
export async function resetServer() {
  await serverDb.delete()
  await serverDb.open()
}
