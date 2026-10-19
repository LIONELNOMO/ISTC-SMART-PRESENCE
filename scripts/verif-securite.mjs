/**
 * Vérifications automatiques de la section Sécurité, sur le code source.
 *
 *   npm run verif
 *
 * Ce script ne remplace pas la revue : il attrape les régressions évidentes,
 * celles qu'on introduit sans y penser. Chaque règle renvoie au point du
 * document securité.md qu'elle protège.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'

const RACINE = process.cwd()
const IGNORES = new Set(['node_modules', 'dist', '.git', 'coverage'])

/** Fichiers à inspecter : le code de l'application et les scripts. */
function collecter(dossier, acc = []) {
  for (const entree of readdirSync(dossier)) {
    if (IGNORES.has(entree)) continue
    const chemin = join(dossier, entree)
    if (statSync(chemin).isDirectory()) collecter(chemin, acc)
    else if (['.js', '.jsx', '.mjs', '.html'].includes(extname(entree))) acc.push(chemin)
  }
  return acc
}

const REGLES = [
  {
    id: '§13.8',
    nom: 'dangerouslySetInnerHTML interdit',
    motif: /dangerouslySetInnerHTML/,
    portee: /^src\//,
  },
  {
    id: '§13.8',
    nom: 'innerHTML / outerHTML interdits',
    motif: /\.(inner|outer)HTML\s*=/,
    portee: /^src\//,
  },
  {
    id: '§13.8',
    nom: 'eval et Function() interdits',
    motif: /\beval\s*\(|new\s+Function\s*\(/,
    portee: /^src\//,
  },
  {
    id: '§13.8',
    nom: 'lien javascript: interdit',
    motif: /["'`]javascript:/,
    portee: /^src\//,
    sauf: /safe-redirect|qr-codes/, // ces fichiers le refusent explicitement
  },
  {
    id: '§13.11',
    nom: 'Math.random interdit pour un code, un jeton ou un identifiant',
    motif: /Math\.random/,
    portee: /^src\//,
  },
  {
    id: '§13.11',
    nom: 'aucun secret préfixé VITE_',
    motif: /VITE_[A-Z_]*(SECRET|KEY|TOKEN|PASSWORD|PRIVATE)/,
    portee: /./,
  },
  {
    id: '§13.3',
    nom: 'seul src/server/ ouvre la base du serveur',
    motif: /from ['"].*server\/db\.js['"]/,
    portee: /^src\/(?!server\/)/,
  },
  {
    id: '§13.8',
    nom: 'lien externe sans rel="noopener noreferrer"',
    motif: /target=["']_blank["']/,
    portee: /^src\//,
    // L'attribut `rel` est souvent sur la ligne suivante : on regarde autour.
    voisinageRequis: /noopener\s+noreferrer/,
  },
  {
    id: '§13.10',
    nom: 'aucun console.log de données (console.info structuré uniquement)',
    motif: /console\.(log|debug)\s*\(/,
    portee: /^src\//,
  },
]

let echecs = 0
const fichiers = [...collecter(join(RACINE, 'src')), join(RACINE, 'index.html')]

for (const regle of REGLES) {
  const touches = []
  for (const chemin of fichiers) {
    const rel = relative(RACINE, chemin).replaceAll('\\', '/')
    if (!regle.portee.test(rel)) continue
    if (regle.sauf?.test(rel)) continue

    const lignes = readFileSync(chemin, 'utf8').split('\n')
    lignes.forEach((ligne, index) => {
      // On ignore les commentaires : le document explique souvent la règle.
      const nue = ligne.trim()
      if (nue.startsWith('*') || nue.startsWith('//') || nue.startsWith('/*')) return
      if (!regle.motif.test(ligne)) return

      // Certaines règles se jugent sur un petit voisinage : un attribut JSX
      // s'étale volontiers sur plusieurs lignes.
      if (regle.voisinageRequis) {
        const autour = lignes.slice(Math.max(0, index - 3), index + 4).join('\n')
        if (regle.voisinageRequis.test(autour)) return
      }

      touches.push(`${rel}:${index + 1}  ${nue.slice(0, 100)}`)
    })
  }

  if (touches.length) {
    echecs += touches.length
    console.log(`\n✖ ${regle.id}  ${regle.nom}`)
    for (const touche of touches) console.log(`    ${touche}`)
  } else {
    console.log(`✔ ${regle.id}  ${regle.nom}`)
  }
}

console.log(
  `\n${fichiers.length} fichiers inspectés — ${echecs === 0 ? 'aucun écart' : `${echecs} écart(s)`}.`,
)
process.exit(echecs === 0 ? 0 : 1)
