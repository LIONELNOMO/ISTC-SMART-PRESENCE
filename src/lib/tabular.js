/**
 * Import et export CSV (§3, §7) — et les pièges des tableurs (§13.1, §13.7).
 *
 *  §13.1 « Injection de formule »   — une cellule qui commence par = + - @ est
 *                                     neutralisée à l'import ET à l'export.
 *  §13.6 « Déni de service »        — taille de fichier et nombre de lignes bornés.
 *  §13.1 « Expression coûteuse »    — analyseur caractère par caractère, pas de
 *                                     regex sur le fichier entier.
 *  §13.7 « Import qui écrase »      — cette couche ne fait que LIRE et décrire ;
 *                                     la décision d'écrire appartient au serveur.
 */

export const MAX_FILE_BYTES = 2 * 1024 * 1024 // 2 Mo
export const MAX_ROWS = 5000
export const MAX_CELL_LENGTH = 200
export const MAX_COLUMNS = 24

const FORMULA_START = /^[=+\-@\t\r]/

/**
 * Neutralise une cellule susceptible d'être interprétée comme une formule.
 * À l'import, on retire le caractère déclencheur ; à l'export, on préfixe d'une
 * apostrophe. Dans les deux cas, la valeur reste lisible.
 */
export function neutralizeCell(value) {
  const text = String(value ?? '')
  if (FORMULA_START.test(text)) return `'${text}`
  return text
}

export function sanitizeImportedCell(value) {
  let text = String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim()
  if (text.length > MAX_CELL_LENGTH) text = text.slice(0, MAX_CELL_LENGTH)
  if (FORMULA_START.test(text)) text = `'${text}`
  return text
}

/** Détecte le séparateur sur la première ligne : virgule, point-virgule ou tabulation. */
function detectDelimiter(text) {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'))
  const counts = [
    [';', (firstLine.match(/;/g) || []).length],
    [',', (firstLine.match(/,/g) || []).length],
    ['\t', (firstLine.match(/\t/g) || []).length],
  ]
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ';'
}

/**
 * Analyseur CSV conforme à RFC 4180 (guillemets doublés), écrit à la main pour
 * rester prévisible en temps d'exécution.
 */
export function parseCsv(text, { delimiter = null, maxRows = MAX_ROWS } = {}) {
  const source = String(text ?? '').replace(/^﻿/, '') // retire le BOM
  const sep = delimiter || detectDelimiter(source)
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false
  let truncated = false

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]

    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
      continue
    }

    if (ch === '"' && cell === '') {
      inQuotes = true
    } else if (ch === sep) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1
      row.push(cell)
      cell = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
      if (rows.length > maxRows) {
        truncated = true
        break
      }
    } else {
      cell += ch
    }
  }

  if (!truncated) {
    row.push(cell)
    if (row.some((c) => c.trim() !== '')) rows.push(row)
  }

  return { rows, delimiter: sep, truncated }
}

/** Normalise un en-tête : minuscules, sans accent, sans ponctuation. */
export function normalizeHeader(label) {
  return String(label ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/** Correspondances acceptées pour chaque colonne attendue (§3). */
export const STUDENT_COLUMNS = {
  matricule: ['matricule', 'matricle', 'numeromatricule', 'id'],
  nom: ['nom', 'nomdefamille'],
  prenom: ['prenom', 'prenoms'],
  filiere: ['filiere', 'filliere', 'departement'],
  niveau: ['niveau', 'level', 'annee'],
  parent: ['numeroduparent', 'numeroparent', 'parent', 'telephoneparent', 'whatsappparent', 'telparent'],
}

/**
 * Colonnes FACULTATIVES (§4) : absentes, elles ne font pas échouer l'import.
 * `section` : « anglophone » / « francophone » (vide = francophone).
 */
export const STUDENT_COLUMNS_OPT = {
  section: ['section', 'groupe', 'langue'],
}

/**
 * Associe les colonnes du fichier aux champs attendus.
 * Les colonnes inconnues sont IGNORÉES, jamais recopiées (§13.3 affectation de masse).
 */
export function mapStudentHeaders(headerRow = []) {
  const normalized = headerRow.slice(0, MAX_COLUMNS).map(normalizeHeader)
  const index = {}
  const missing = []
  for (const [field, aliases] of Object.entries(STUDENT_COLUMNS)) {
    const position = normalized.findIndex((h) => aliases.includes(h))
    if (position === -1) missing.push(field)
    else index[field] = position
  }
  // Colonnes facultatives : ajoutées à l'index si présentes, sans jamais
  // figurer dans `missing`.
  for (const [field, aliases] of Object.entries(STUDENT_COLUMNS_OPT)) {
    const position = normalized.findIndex((h) => aliases.includes(h))
    if (position !== -1) index[field] = position
  }
  return { index, missing, ignored: normalized.filter((h, i) => h && !Object.values(index).includes(i)) }
}

/**
 * Lit un fichier d'étudiants et renvoie un APERÇU. Aucune écriture ici :
 * l'administration valide l'aperçu, puis le serveur décide (§13.7).
 */
export async function readStudentFile(file) {
  if (!file) return { error: 'Aucun fichier.' }
  const name = String(file.name || '')
  const isCsv = /\.csv$/i.test(name) || file.type === 'text/csv'

  if (!isCsv) {
    if (/\.xlsx?$/i.test(name)) {
      return {
        error:
          "Les fichiers Excel sont importés par le serveur : une archive .xlsx doit être " +
          'contrôlée contre les entités XML externes et les bombes de décompression ' +
          '(§13.1). Exportez la feuille en .csv pour un import depuis le navigateur.',
      }
    }
    return { error: 'Formats acceptés : .csv (ou .xlsx côté serveur).' }
  }

  if (file.size > MAX_FILE_BYTES) {
    return { error: `Fichier trop lourd : ${Math.round(file.size / 1024)} Ko pour ${MAX_FILE_BYTES / 1024 / 1024} Mo au maximum.` }
  }

  const text = await file.text()
  const { rows, truncated } = parseCsv(text)
  if (!rows.length) return { error: 'Fichier vide.' }

  const { index, missing, ignored } = mapStudentHeaders(rows[0])
  if (missing.length) {
    return {
      error: `Colonnes manquantes : ${missing.join(', ')}. Attendu : matricule, nom, prénom, filière, niveau, numéro du parent.`,
    }
  }

  const records = []
  const problems = []
  for (let i = 1; i < rows.length; i += 1) {
    const raw = rows[i]
    const record = {
      ligne: i + 1,
      matricule: sanitizeImportedCell(raw[index.matricule]),
      nom: sanitizeImportedCell(raw[index.nom]),
      prenom: sanitizeImportedCell(raw[index.prenom]),
      filiere: sanitizeImportedCell(raw[index.filiere]),
      niveau: sanitizeImportedCell(raw[index.niveau]),
      parent: sanitizeImportedCell(raw[index.parent]),
      // §4 : colonne facultative. Absente => chaîne vide => francophone côté serveur.
      section: index.section !== undefined ? sanitizeImportedCell(raw[index.section]) : '',
    }
    if (!record.matricule || !record.nom) {
      problems.push({ ligne: record.ligne, raison: 'Matricule ou nom manquant' })
      continue
    }
    records.push(record)
  }

  return { records, problems, ignored, truncated }
}

/* ------------------------------------------------------------------ *
 *  Export
 * ------------------------------------------------------------------ */

function csvCell(value, delimiter) {
  const text = neutralizeCell(value)
  const needsQuotes = text.includes(delimiter) || /["\n\r]/.test(text)
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * Sérialise un tableau en CSV. Chaque cellule passe par neutralizeCell :
 * une valeur `=1+1` importée ressort `'=1+1`, inoffensive à l'ouverture (§13.13).
 */
export function toCsv(columns, rows, { delimiter = ';' } = {}) {
  const header = columns.map((c) => csvCell(c.label ?? c.key, delimiter)).join(delimiter)
  const body = rows.map((row) =>
    columns.map((c) => csvCell(typeof c.value === 'function' ? c.value(row) : row[c.key], delimiter)).join(delimiter),
  )
  // BOM UTF-8 pour qu'Excel ouvre correctement les accents.
  return `﻿${[header, ...body].join('\r\n')}\r\n`
}

/** Déclenche le téléchargement d'un export. Le nom de fichier est généré ici. */
export function downloadCsv(filename, csv) {
  const safeName = String(filename).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = safeName.endsWith('.csv') ? safeName : `${safeName}.csv`
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
