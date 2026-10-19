/**
 * Produit le favicon et les icônes de la PWA à partir du logo
 * ISTC SmartPresence.
 *
 *   npm run icones
 *
 * Le SVG est la source unique : il est écrit tel quel pour le favicon, puis
 * rendu en PNG aux tailles demandées par le manifeste. Le rendu est fait par
 * un traceur minimal écrit ici même, pour ne dépendre d'aucune bibliothèque
 * graphique (§13.11 « Dépendances peu nombreuses »).
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

const SORTIE = process.argv[2] ?? 'public'

/* ------------------------------------------------------------------ *
 *  Encodeur PNG
 * ------------------------------------------------------------------ */

const TABLE_CRC = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let crc = 0xffffffff
  for (const octet of buf) crc = TABLE_CRC[(crc ^ octet) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function bloc(type, data) {
  const longueur = Buffer.alloc(4)
  longueur.writeUInt32BE(data.length)
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const controle = Buffer.alloc(4)
  controle.writeUInt32BE(crc32(corps))
  return Buffer.concat([longueur, corps, controle])
}

function encoderPng(largeur, hauteur, rgba) {
  const entete = Buffer.alloc(13)
  entete.writeUInt32BE(largeur, 0)
  entete.writeUInt32BE(hauteur, 4)
  entete[8] = 8 // 8 bits par canal
  entete[9] = 6 // RGBA
  const brut = Buffer.alloc((largeur * 4 + 1) * hauteur)
  for (let y = 0; y < hauteur; y += 1) {
    brut[y * (largeur * 4 + 1)] = 0 // filtre « none »
    rgba.copy(brut, y * (largeur * 4 + 1) + 1, y * largeur * 4, (y + 1) * largeur * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', entete),
    bloc('IDAT', deflateSync(brut, { level: 9 })),
    bloc('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------------------------------------------ *
 *  Géométrie : distances signées, évaluées par pixel
 * ------------------------------------------------------------------ */

function couleur(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

// Emblème ISTC : globe, couronne de laurier et pages (cf. écran d'accueil).
const FOND = couleur('#042C53') // bleu ISTC
const EAU = couleur('#378ADD') // globe
const CONTINENT = couleur('#0C447C')
const GRILLE = couleur('#B5D4F4') // méridien, équateur, contour
const LAURIER = couleur('#F0892E') // couronne cuivrée
const PAGES = couleur('#185FA5') // livre ouvert sous le globe

function distanceCercle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r
}

function distanceSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const wx = px - ax
  const wy = py - ay
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)))
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy))
}

/** Buste : demi-disque posé sur une base, approximé par un cercle écrasé. */
function distanceBuste(px, py, cx, sommet, demiLargeur, bas) {
  if (py > bas) return 1e9
  const rx = demiLargeur
  const ry = bas - sommet
  const nx = (px - cx) / rx
  const ny = (py - bas) / ry
  return (Math.hypot(nx, ny) - 1) * Math.min(rx, ry)
}

/** Aile du livre : triangle courbe, approximé par un triangle plein. */
function dansTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const signe = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3)
  const d1 = signe(px, py, ax, ay, bx, by)
  const d2 = signe(px, py, bx, by, cx, cy)
  const d3 = signe(px, py, cx, cy, ax, ay)
  const negatif = d1 < 0 || d2 < 0 || d3 < 0
  const positif = d1 > 0 || d2 > 0 || d3 > 0
  return !(negatif && positif)
}

/**
 * Dessine la pastille du logo dans un carré de `taille` pixels.
 * Le repère interne reprend celui du SVG (boîte 140..540 × 150..380).
 */
function dessiner(taille, { masquable = false } = {}) {
  const rgba = Buffer.alloc(taille * taille * 4)

  // Cadre du logo dans le repère SVG, et marge de sécurité pour l'icône
  // masquable (Android rogne jusqu'à 20 % de chaque bord).
  //
  // Le dessin s'étend de x≈186 à x≈534 et de y≈165 à y≈372. On prend un carré
  // qui l'englobe en le centrant, sinon le logo flotte en haut de l'icône.
  const marge = masquable ? 0.24 : 0.06
  const minX = 22
  const maxX = 138
  const minY = 8
  const maxY = 124
  const vTaille = Math.max(maxX - minX, maxY - minY)
  const vx0 = (minX + maxX) / 2 - vTaille / 2
  const vy0 = (minY + maxY) / 2 - vTaille / 2

  const echantillons = [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ]

  for (let y = 0; y < taille; y += 1) {
    for (let x = 0; x < taille; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      for (const [dx, dy] of echantillons) {
        // Pixel → repère du SVG, en tenant compte de la marge.
        const u = (x + dx) / taille
        const v = (y + dy) / taille
        const interieur = (u - marge) / (1 - 2 * marge)
        const interieurV = (v - marge) / (1 - 2 * marge)
        const sx = vx0 + interieur * vTaille
        const sy = vy0 + interieurV * vTaille

        const pixel = teinte(sx, sy)
        r += pixel[0]
        g += pixel[1]
        b += pixel[2]
        a += pixel[3]
      }

      const n = echantillons.length
      const i = (y * taille + x) * 4
      rgba[i] = Math.round(r / n)
      rgba[i + 1] = Math.round(g / n)
      rgba[i + 2] = Math.round(b / n)
      rgba[i + 3] = Math.round(a / n)
    }
  }

  return encoderPng(taille, taille, rgba)
}

function dansEllipse(px, py, cx, cy, rx, ry) {
  const nx = (px - cx) / rx
  const ny = (py - cy) / ry
  return nx * nx + ny * ny <= 1
}

/** Couleur de l'emblème au point (sx, sy) du repère SVG (0..160). Fond opaque. */
function teinte(sx, sy) {
  let c = FOND

  const dG = Math.hypot(sx - 80, sy - 64) // distance au centre du globe
  let ang = (Math.atan2(sy - 64, sx - 80) * 180) / Math.PI
  if (ang < 0) ang += 360

  // Couronne de laurier : deux arcs cuivrés sur les côtés (ouverts haut et bas).
  const surArc = dG >= 46 && dG <= 53
  const cote = (ang >= 118 && ang <= 242) || ang <= 62 || ang >= 298
  if (surArc && cote) c = LAURIER

  // Pages (livre ouvert) sous le globe.
  if (dansEllipse(sx, sy, 57, 111, 24, 9) || dansEllipse(sx, sy, 103, 111, 24, 9)) c = PAGES

  // Globe : eau, continents, méridien, équateur.
  if (dG < 30) {
    c = EAU
    if (dansEllipse(sx, sy, 84, 61, 8, 21) || dansEllipse(sx, sy, 65, 68, 4.5, 9)) c = CONTINENT
    const e = Math.hypot((sx - 80) / 13, (sy - 64) / 30)
    if (Math.abs(e - 1) < 0.045) c = GRILLE
    if (Math.abs(sy - 64) < 0.9) c = GRILLE
  }
  // Contour du globe.
  if (Math.abs(dG - 30) < 1.1) c = GRILLE

  return [c[0], c[1], c[2], 255]
}

/* ------------------------------------------------------------------ *
 *  Favicon SVG : la source du logo, telle quelle
 * ------------------------------------------------------------------ */

// Emblème ISTC (globe + couronne de laurier + pages) sur fond bleu, cadré dans
// un carré arrondi. C'est la source du favicon ET des PNG (via `teinte`).
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
  <title>ISTC SmartPresence</title>
  <rect width="160" height="160" rx="34" fill="#042C53"/>
  <path d="M44.6 99.4 A50 50 0 0 0 51.3 23" fill="none" stroke="#F0892E" stroke-width="3" stroke-linecap="round"/>
  <path d="M115.4 99.4 A50 50 0 0 1 108.7 23" fill="none" stroke="#F0892E" stroke-width="3" stroke-linecap="round"/>
  <g fill="#F0892E">
    <g transform="translate(44.6 99.4) rotate(225)"><ellipse rx="5" ry="2.3"/></g>
    <g transform="translate(33 81.1) rotate(250)"><ellipse rx="5" ry="2.3"/></g>
    <g transform="translate(30.2 59.6) rotate(275)"><ellipse rx="5" ry="2.3"/></g>
    <g transform="translate(36.7 39) rotate(300)"><ellipse rx="5" ry="2.3"/></g>
    <g transform="translate(51.3 23) rotate(325)"><ellipse rx="5" ry="2.3"/></g>
    <g transform="translate(115.4 99.4) rotate(-45)"><ellipse rx="5" ry="2.3"/></g>
    <g transform="translate(127 81.1) rotate(-70)"><ellipse rx="5" ry="2.3"/></g>
    <g transform="translate(129.8 59.6) rotate(-95)"><ellipse rx="5" ry="2.3"/></g>
    <g transform="translate(123.3 39) rotate(-120)"><ellipse rx="5" ry="2.3"/></g>
    <g transform="translate(108.7 23) rotate(-145)"><ellipse rx="5" ry="2.3"/></g>
  </g>
  <path d="M80 104 C68 97 52 96 36 100 L36 118 C52 114 68 115 80 122 Z" fill="#185FA5"/>
  <path d="M80 104 C92 97 108 96 124 100 L124 118 C108 114 92 115 80 122 Z" fill="#185FA5"/>
  <circle cx="80" cy="64" r="30" fill="#378ADD"/>
  <path d="M80 39 C88 38 93 44 91 50 C97 54 99 61 95 68 C93 77 87 84 83 89 C79 83 77 76 73 71 C67 67 67 60 71 56 C69 50 73 43 80 39Z" fill="#0C447C"/>
  <path d="M55 46 C61 44 62 52 58 58 C62 64 60 72 56 78 C52 72 51 58 55 46Z" fill="#0C447C"/>
  <ellipse cx="80" cy="64" rx="13" ry="30" fill="none" stroke="#B5D4F4" stroke-width=".7"/>
  <line x1="50" y1="64" x2="110" y2="64" stroke="#B5D4F4" stroke-width=".7"/>
  <circle cx="80" cy="64" r="30" fill="none" stroke="#B5D4F4" stroke-width="1.1"/>
</svg>
`

/* ------------------------------------------------------------------ *
 *  Écriture
 * ------------------------------------------------------------------ */

mkdirSync(join(SORTIE, 'icons'), { recursive: true })

writeFileSync(join(SORTIE, 'favicon.svg'), FAVICON)
writeFileSync(join(SORTIE, 'icons', 'icon-192.png'), dessiner(192))
writeFileSync(join(SORTIE, 'icons', 'icon-512.png'), dessiner(512))
writeFileSync(join(SORTIE, 'icons', 'icon-512-maskable.png'), dessiner(512, { masquable: true }))
writeFileSync(join(SORTIE, 'apple-touch-icon.png'), dessiner(180))

console.log(`Icônes ISTC SmartPresence écrites dans ${SORTIE}/`)
