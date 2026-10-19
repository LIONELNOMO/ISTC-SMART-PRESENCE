/**
 * Choix du serveur : l'API PHP, ou la couche simulée dans le navigateur.
 *
 * Un seul réglage décide, au moment de la construction :
 *
 *   VITE_SERVEUR=local  la couche simulée — démonstration sans serveur
 *   (par défaut)        l'API PHP — production, et tout déploiement réel
 *
 * Une application déployée sans réglage doit parler à son serveur, pas à une
 * base qui vit dans le navigateur : c'est pourquoi l'API est le défaut.
 *
 * Tout le reste de l'application importe depuis ce fichier et ne sait pas
 * lequel des deux répond : les deux exposent les mêmes fonctions.
 */

import * as api from './api.js'

/**
 * `import.meta.env.VITE_SERVEUR` est remplacé par sa valeur à la construction.
 * La condition est donc résolue au build, et la couche simulée — avec Dexie et
 * ses tables — n'entre tout simplement pas dans le bundle de production.
 */
const MODE = import.meta.env?.VITE_SERVEUR === 'local' ? 'local' : 'api'

/**
 * Chargement différé de la couche simulée.
 *
 * Elle n'est demandée que si le mode « local » est explicitement choisi ; en
 * production, ce module n'est jamais atteint.
 */
async function serveurLocal() {
  const local = await import('../server/index.js')
  return local
}

export const MODE_SERVEUR = MODE

export async function connexion(args) {
  if (MODE === 'local') return (await serveurLocal()).connexion(args)
  return api.connexion(args)
}

export async function deconnexion(token) {
  if (MODE === 'local') return (await serveurLocal()).deconnexion(token)
  return api.deconnexion(token)
}

export async function changerMotDePasse(token, args) {
  if (MODE === 'local') return (await serveurLocal()).changerMotDePasse(token, args)
  return api.changerMotDePasse(token, args)
}

export async function lire(token, options) {
  if (MODE === 'local') return (await serveurLocal()).lire(token, options)
  return api.lire(token, options)
}

export async function soumettre(token, op, options) {
  if (MODE === 'local') return (await serveurLocal()).soumettre(token, op, options)
  return api.soumettre(token, op, options)
}

/**
 * Chiffres de l'écran de connexion.
 *
 * Passe par ce fichier comme le reste : c'est ce qui évite que l'écran de
 * connexion n'entraîne toute la couche simulée dans le bundle de production.
 */
export async function vitrine() {
  if (MODE === 'local') return (await import('../server/install.js')).vitrine()
  return api.vitrine()
}

/**
 * Fiche des heures d'un enseignant (secrétariat GRH, admin). Sans montants.
 */
export async function ficheEnseignant(token, teacherId, debut = null, fin = null) {
  if (MODE === 'local') {
    const { fichePaie } = await import('../server/reporting.js')
    try {
      // Côté secrétariat : les heures de la période, sans montant (§13.10).
      return { data: await fichePaie(teacherId, debut, fin, false) }
    } catch (e) {
      return { error: { code: 'interne', message: e?.message ?? 'Erreur' } }
    }
  }
  return api.ficheEnseignant(token, teacherId, debut, fin)
}

/**
 * Charge le jeu de démonstration — comptes de test et établissement fictif.
 *
 * N'existe qu'en mode local : en production, la fonction n'appelle rien et
 * répond une erreur, et le bouton qui s'en sert n'est de toute façon pas rendu.
 * L'installation réelle se fait par SQL (premier administrateur), sans écran.
 */
export async function installerDemo() {
  if (MODE !== 'local') {
    return { error: { code: 'indisponible', message: 'Indisponible en production.' } }
  }
  const { installer, estInstalle, JEU_DE_TEST } = await import('../server/install.js')
  if (await estInstalle()) {
    return { error: { code: 'conflit', message: 'Des comptes existent déjà.' } }
  }
  return installer({ ...JEU_DE_TEST, avecDemonstration: true })
}
