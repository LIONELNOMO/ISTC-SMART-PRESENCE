/**
 * Justificatifs d'absence (§6) — §13.7 « Fichiers ».
 *
 *  « Fichier dangereux »      — type vérifié sur le CONTENU (nombre magique),
 *                               jamais sur l'extension ni sur file.type.
 *  « Fichier trop lourd »     — 5 Mo maximum.
 *  « Métadonnées des photos » — image ré-encodée via canvas : l'EXIF, donc la
 *                               position GPS, disparaît.
 *  « Nom de fichier piégé »   — le nom d'origine est jeté ; on génère un nom.
 *  « Fichier exécuté »        — un PDF n'est jamais rendu dans la page ; il est
 *                               proposé en téléchargement (attachment).
 */

import { randomId } from './crypto.js'

export const MAX_JUSTIFICATIF_BYTES = 5 * 1024 * 1024 // 5 Mo
export const MAX_JUSTIFICATIFS_PAR_ETUDIANT = 20

/** Signatures acceptées. Un .svg ou .html renommé .jpg échoue ici. */
const MAGIC = [
  { type: 'image/jpeg', ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/png', ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'application/pdf', ext: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
]

function matchMagic(head) {
  return (
    MAGIC.find((candidate) => candidate.bytes.every((byte, i) => head[i] === byte)) ?? null
  )
}

/**
 * Contrôle complet d'un fichier déposé. Retourne soit `{ error }`, soit un
 * objet prêt à être stocké, avec un nom généré et sans métadonnées.
 */
export async function prepareJustificatif(file) {
  if (!file) return { error: 'Aucun fichier.' }
  if (file.size === 0) return { error: 'Fichier vide.' }
  if (file.size > MAX_JUSTIFICATIF_BYTES) {
    return { error: `Fichier trop lourd : ${(file.size / 1024 / 1024).toFixed(1)} Mo pour 5 Mo au maximum.` }
  }

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const kind = matchMagic(head)
  if (!kind) {
    return {
      error:
        "Type de fichier refusé. Le contenu doit être une photo JPEG ou PNG, ou un PDF — " +
        "l'extension du fichier n'est pas prise en compte.",
    }
  }

  const id = randomId()
  const name = `justificatif-${id}.${kind.ext}`

  if (kind.type === 'application/pdf') {
    // Un PDF n'est pas ré-encodé : il est stocké tel quel et jamais affiché
    // dans le domaine de l'application (§13.7 « Fichier exécuté »).
    return {
      id,
      name,
      type: kind.type,
      size: file.size,
      dataUrl: await blobToDataUrl(file),
      exifStripped: false,
    }
  }

  const reencoded = await reencodeImage(file, kind.type)
  if (reencoded.error) return reencoded

  return {
    id,
    name,
    type: 'image/jpeg',
    size: reencoded.size,
    dataUrl: reencoded.dataUrl,
    exifStripped: true,
  }
}

/**
 * Ré-encodage par canvas. Effet de bord voulu : toutes les métadonnées EXIF
 * (dont le GPS) sont perdues, et un fichier qui n'est pas une vraie image
 * échoue au décodage.
 */
async function reencodeImage(file, declaredType) {
  const url = URL.createObjectURL(file)
  try {
    const image = await loadImage(url)
    const maxSide = 1600
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return { error: 'Impossible de traiter cette image.' }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(image, 0, 0, width, height)

    const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
    return { dataUrl, size: Math.round((dataUrl.length * 3) / 4), declaredType }
  } catch {
    return { error: "Ce fichier n'est pas une image lisible." }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('decode'))
    img.src = url
  })
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('read'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Téléchargement d'un justificatif. On force le téléchargement plutôt que
 * l'affichage : rien ne s'exécute dans le domaine de l'application.
 */
export function downloadJustificatif(piece) {
  if (!piece?.dataUrl) return
  const link = document.createElement('a')
  link.href = piece.dataUrl
  link.download = piece.name || 'justificatif'
  link.rel = 'noopener noreferrer'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/** Une image de justificatif peut être affichée : elle a été ré-encodée. */
export function isDisplayableImage(piece) {
  return Boolean(piece?.dataUrl) && piece.type?.startsWith('image/') && piece.exifStripped
}
