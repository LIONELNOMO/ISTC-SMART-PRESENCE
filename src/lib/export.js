/**
 * Export des rapports en CSV, Excel, Word et PDF.
 *
 * Aucune bibliothèque n'est ajoutée : les quatre formats sont produits à partir
 * de formats ouverts que les logiciels bureautiques savent lire directement.
 *
 *   CSV    texte séparé, déjà géré par `tabular.js`
 *   Excel  SpreadsheetML 2003 — un XML qu'Excel, LibreOffice et Google Sheets
 *          ouvrent nativement, avec les types de colonnes et la mise en forme
 *   Word   HTML encapsulé au format Word — ouvert tel quel par Word et
 *          LibreOffice Writer, avec en-tête, titre et tableau mis en forme
 *   PDF    rendu par le moteur d'impression du navigateur, dans une fenêtre
 *          dédiée : c'est le seul chemin qui garantisse des accents corrects
 *          et une pagination propre sans embarquer de police
 *
 * §13.1 « Injection de formule » : toute valeur passe par `neutralizeCell`
 * avant d'entrer dans un fichier tabulaire, comme pour le CSV.
 * §13.7 « Export trop large » : ce module met en forme ce qu'on lui donne. Le
 * filtrage par rôle est fait côté serveur, par les projections.
 */

import { neutralizeCell, toCsv, downloadCsv } from './tabular.js'

export { toCsv, downloadCsv }

/** Formats proposés à l'utilisateur. */
export const FORMATS = [
  { id: 'pdf', label: 'PDF', extension: 'pdf', description: 'Pour imprimer ou archiver' },
  { id: 'excel', label: 'Excel', extension: 'xls', description: 'Pour recalculer' },
  { id: 'word', label: 'Word', extension: 'doc', description: 'Pour commenter' },
  { id: 'csv', label: 'CSV', extension: 'csv', description: 'Pour un autre logiciel' },
]

/* ------------------------------------------------------------------ *
 *  Outils communs
 * ------------------------------------------------------------------ */

/** Échappement XML/HTML. React ne protège pas ces chaînes : on le fait ici. */
function echapper(valeur) {
  return String(valeur ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Valeur d'une cellule, selon que la colonne a une fonction de rendu ou non. */
function valeurCellule(colonne, ligne) {
  const brute = typeof colonne.value === 'function' ? colonne.value(ligne) : ligne[colonne.key]
  return brute === null || brute === undefined ? '' : String(brute)
}

/** Nom de fichier sûr : le nom d'origine ne sert jamais de chemin (§13.7). */
function nomDeFichier(base, extension) {
  const propre = String(base)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return `${propre || 'rapport'}.${extension}`
}

/** Déclenche le téléchargement d'un contenu produit en mémoire. */
function telecharger(nom, contenu, type) {
  const blob = new Blob([contenu], { type })
  const url = URL.createObjectURL(blob)
  const lien = document.createElement('a')
  lien.href = url
  lien.download = nom
  lien.rel = 'noopener'
  document.body.appendChild(lien)
  lien.click()
  lien.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Un nombre écrit « 1234,5 » ou « 1 234 » doit redevenir un nombre dans Excel. */
function estNombre(texte) {
  const nettoye = String(texte).replace(/\s| /g, '').replace(',', '.')
  return nettoye !== '' && Number.isFinite(Number(nettoye))
}

function versNombre(texte) {
  return Number(String(texte).replace(/\s| /g, '').replace(',', '.'))
}

/* ------------------------------------------------------------------ *
 *  Excel — SpreadsheetML 2003
 * ------------------------------------------------------------------ */

/**
 * Produit un classeur Excel.
 *
 * Le format SpreadsheetML est un XML documenté par Microsoft, lu sans
 * conversion par Excel, LibreOffice et Google Sheets. Il permet d'avoir de
 * vraies colonnes numériques et un en-tête figé — ce qu'un CSV ne peut pas
 * porter — sans embarquer de bibliothèque de plusieurs centaines de kilo-octets.
 */
export function versExcel({ titre, colonnes, lignes, meta = [] }) {
  const entetes = colonnes
    .map(
      (colonne) =>
        `<Cell ss:StyleID="entete"><Data ss:Type="String">${echapper(
          colonne.label ?? colonne.key,
        )}</Data></Cell>`,
    )
    .join('')

  const corps = lignes
    .map((ligne) => {
      const cellules = colonnes
        .map((colonne) => {
          const texte = valeurCellule(colonne, ligne)
          if (colonne.numerique && estNombre(texte)) {
            return `<Cell><Data ss:Type="Number">${versNombre(texte)}</Data></Cell>`
          }
          // Même neutralisation que pour le CSV : une cellule « =1+1 » ne doit
          // pas s'exécuter à l'ouverture du classeur.
          return `<Cell><Data ss:Type="String">${echapper(neutralizeCell(texte))}</Data></Cell>`
        })
        .join('')
      return `<Row>${cellules}</Row>`
    })
    .join('')

  const lignesMeta = meta
    .map(
      (ligne) =>
        `<Row><Cell ss:StyleID="meta"><Data ss:Type="String">${echapper(
          ligne,
        )}</Data></Cell></Row>`,
    )
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
          xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
    <Title>${echapper(titre)}</Title>
  </DocumentProperties>
  <Styles>
    <Style ss:ID="titre">
      <Font ss:Bold="1" ss:Size="14" ss:Color="#2A1C12"/>
    </Style>
    <Style ss:ID="meta">
      <Font ss:Size="9" ss:Color="#8D7D6F"/>
    </Style>
    <Style ss:ID="entete">
      <Font ss:Bold="1" ss:Color="#FFFFFF"/>
      <Interior ss:Color="#311F13" ss:Pattern="Solid"/>
      <Alignment ss:Vertical="Center"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Rapport">
    <Table>
      <Row><Cell ss:StyleID="titre"><Data ss:Type="String">${echapper(titre)}</Data></Cell></Row>
      ${lignesMeta}
      <Row/>
      <Row>${entetes}</Row>
      ${corps}
    </Table>
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
      <FreezePanes/>
      <FrozenNoSplit/>
      <SplitHorizontal>${3 + meta.length}</SplitHorizontal>
      <TopRowBottomPane>${3 + meta.length}</TopRowBottomPane>
      <ActivePane>2</ActivePane>
    </WorksheetOptions>
  </Worksheet>
</Workbook>`
}

/* ------------------------------------------------------------------ *
 *  Word et PDF — un même document mis en forme
 * ------------------------------------------------------------------ */

/** Feuille de style commune aux sorties Word et PDF, aux couleurs de la marque. */
const STYLE_DOCUMENT = `
  @page { size: A4 landscape; margin: 1.4cm; }
  body { font-family: Calibri, Carlito, Arial, sans-serif; font-size: 10pt; color: #2a1c12; }
  .entete { border-bottom: 2px solid #cc6c25; padding-bottom: 10px; margin-bottom: 16px; }
  .etablissement { font-size: 9pt; color: #8d7d6f; letter-spacing: .08em; text-transform: uppercase; }
  h1 { font-size: 17pt; margin: 6px 0 2px; color: #2a1c12; }
  .meta { font-size: 8.5pt; color: #8d7d6f; margin: 2px 0; }
  table { border-collapse: collapse; width: 100%; margin-top: 12px; }
  th { background: #311f13; color: #fff; font-size: 8.5pt; text-align: left;
       padding: 7px 8px; text-transform: uppercase; letter-spacing: .05em; }
  td { border-bottom: 1px solid #e8e0d6; padding: 6px 8px; font-size: 9.5pt; }
  tr:nth-child(even) td { background: #fbf5ed; }
  td.num, th.num { text-align: right; }
  .pied { margin-top: 18px; padding-top: 8px; border-top: 1px solid #e8e0d6;
          font-size: 8pt; color: #8d7d6f; }
`

/** Corps HTML du rapport, partagé par Word et PDF. */
function corpsDocument({ titre, colonnes, lignes, meta, etablissement }) {
  const entetes = colonnes
    .map(
      (colonne) =>
        `<th class="${colonne.numerique ? 'num' : ''}">${echapper(
          colonne.label ?? colonne.key,
        )}</th>`,
    )
    .join('')

  const corps = lignes
    .map(
      (ligne) =>
        `<tr>${colonnes
          .map(
            (colonne) =>
              `<td class="${colonne.numerique ? 'num' : ''}">${echapper(
                valeurCellule(colonne, ligne),
              )}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('')

  const edite = new Date().toLocaleString('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
  })

  return `
    <div class="entete">
      ${etablissement ? `<div class="etablissement">${echapper(etablissement)}</div>` : ''}
      <h1>${echapper(titre)}</h1>
      ${meta.map((ligne) => `<p class="meta">${echapper(ligne)}</p>`).join('')}
    </div>
    <table>
      <thead><tr>${entetes}</tr></thead>
      <tbody>${corps}</tbody>
    </table>
    <p class="pied">
      ${lignes.length} ligne${lignes.length > 1 ? 's' : ''} ·
      Édité le ${echapper(edite)} · ISTC SmartPresence
    </p>`
}

/**
 * Produit un document Word.
 *
 * Word ouvre sans broncher un HTML accompagné des déclarations Office
 * ci-dessous. C'est le chemin le plus sûr pour obtenir un .doc modifiable avec
 * un tableau mis en forme, sans générer de binaire .docx à la main.
 */
export function versWord({ titre, colonnes, lignes, meta = [], etablissement = null }) {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8">
  <title>${echapper(titre)}</title>
  <!--[if gte mso 9]><xml>
    <w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument>
  </xml><![endif]-->
  <style>${STYLE_DOCUMENT}</style>
</head>
<body>${corpsDocument({ titre, colonnes, lignes, meta, etablissement })}</body>
</html>`
}

/**
 * Ouvre le rapport dans une fenêtre d'impression, d'où l'utilisateur choisit
 * « Enregistrer au format PDF ».
 *
 * Produire un PDF à la main obligerait à embarquer une police complète pour
 * que les accents sortent correctement — plusieurs centaines de kilo-octets
 * pour un résultat moins bon que le moteur d'impression du navigateur, qui
 * gère en plus la pagination et les en-têtes répétés.
 */
export function versPdf({ titre, colonnes, lignes, meta = [], etablissement = null }) {
  const fenetre = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=760')
  if (!fenetre) {
    return {
      ok: false,
      message:
        "Le navigateur a bloqué la fenêtre d'impression. Autorisez les fenêtres surgissantes pour ce site, puis réessayez.",
    }
  }

  fenetre.document.write(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>${echapper(titre)}</title>
  <style>${STYLE_DOCUMENT}</style>
</head>
<body>${corpsDocument({ titre, colonnes, lignes, meta, etablissement })}</body>
</html>`)
  fenetre.document.close()

  // On attend la mise en page avant d'ouvrir le dialogue d'impression.
  fenetre.addEventListener('load', () => {
    fenetre.focus()
    fenetre.print()
  })
  // Filet de sécurité si l'événement « load » est déjà passé.
  setTimeout(() => {
    try {
      if (fenetre.document.readyState === 'complete') {
        fenetre.focus()
        fenetre.print()
      }
    } catch {
      /* fenêtre fermée entre-temps */
    }
  }, 350)

  return { ok: true }
}

/* ------------------------------------------------------------------ *
 *  Fiche récapitulative d'un enseignant (secrétariat GRH)
 *
 *  Document d'impression dédié : en-tête avec le logo de l'application,
 *  filigrane de l'établissement (logo ISTC) sur toute la page, et les
 *  heures ventilées par niveau. Aucun montant (§13.10).
 * ------------------------------------------------------------------ */

const STYLE_FICHE = `
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  @page { size: A4 portrait; margin: 1.5cm; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Calibri, Carlito, Arial, sans-serif; font-size: 10.5pt;
         color: #2a1c12; position: relative; }
  /* Le document tient sur une seule page : rien ne doit se couper. */
  .page { page-break-inside: avoid; break-inside: avoid; position: relative; }
  .filigrane { position: fixed; inset: 0; display: flex; align-items: center;
               justify-content: center; z-index: 0; }
  .filigrane img { width: 68%; max-width: 400px; opacity: 0.07; }
  .contenu { position: relative; z-index: 1; }
  .entete { display: flex; align-items: center; gap: 12px;
            border-bottom: 2px solid #cc6c25; padding-bottom: 10px; margin-bottom: 2px; }
  .entete img { width: 48px; height: 48px; object-fit: contain; }
  .marque-nom { font-size: 14pt; font-weight: 700; color: #311f13; }
  .marque-nom .istc { font-style: italic; color: #cc6c25; }
  .etablissement { font-size: 8pt; color: #8d7d6f; letter-spacing: .1em;
                   text-transform: uppercase; }
  h1 { font-size: 15pt; margin: 14px 0 2px; color: #2a1c12; }
  .meta { font-size: 9pt; color: #6b5d50; margin: 1px 0; }
  table { border-collapse: collapse; width: 100%; margin-top: 12px; }
  caption { text-align: left; font-size: 10.5pt; font-weight: 700; color: #311f13;
            margin: 14px 0 5px; }
  th { background: #311f13; color: #fff; font-size: 9pt; text-align: left;
       padding: 7px 10px; text-transform: uppercase; letter-spacing: .05em; }
  td { border-bottom: 1px solid #e8e0d6; padding: 6px 10px; font-size: 10pt; }
  tbody tr:nth-child(even) td { background: #fbf5ed; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .total td { font-weight: 700; border-top: 2px solid #311f13; background: #f3e9dc; }
  .signature { margin-top: 34px; display: flex; justify-content: space-between; }
  .signature div { width: 42%; border-top: 1px solid #8d7d6f; padding-top: 6px;
                   font-size: 8.5pt; color: #8d7d6f; text-align: center; }
  .pied { margin-top: 20px; padding-top: 8px; border-top: 1px solid #e8e0d6;
          font-size: 7.5pt; color: #8d7d6f; }
`

/** Heures en « 6 h 30 » lisible, à partir d'un nombre décimal. */
function heuresLisibles(h) {
  const total = Math.round((Number(h) || 0) * 60)
  const heures = Math.floor(total / 60)
  const minutes = total % 60
  return minutes === 0 ? `${heures} h` : `${heures} h ${String(minutes).padStart(2, '0')}`
}

/**
 * Imprime la fiche d'un enseignant via un iframe caché.
 *
 * Un iframe plutôt qu'une fenêtre surgissante : il n'est jamais bloqué par le
 * navigateur, et SEULE la fiche s'imprime — jamais la page de l'application
 * (donc plus de liste d'autres enseignants ni d'habillage inutile). La fiche
 * tient sur une seule page A4, filigrane ISTC compris.
 *
 * @param {object} p
 * @param {string} p.enseignant    nom affiché
 * @param {string} p.etablissement nom de l'établissement
 * @param {string} [p.departement] département de l'enseignant (fiche de paie)
 * @param {Array}  p.parNiveau     [{ niveau, heures, seances }]
 * @param {number} p.totalHeures
 * @param {string} p.logoUrl       adresse du logo (en-tête ET filigrane)
 * @param {string} [p.periode]     libellé de période
 */
export function fichePdfEnseignant({
  enseignant,
  etablissement,
  departement = null,
  parMatiere = [],
  totalHeures = 0,
  heuresPayees = null,
  logoUrl,
  periode = 'Depuis le début',
  // Côté administration / enseignant : fiche de paie avec brut, impôt et net.
  avecMontants = false,
  monnaie = 'FCFA',
  brut = 0,
  tauxImpot = 0,
  impot = 0,
  net = 0,
}) {
  const aujourdhui = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })

  const fmtMoney = (m) => (m == null ? '—' : `${Number(m).toLocaleString('fr-FR')} ${monnaie}`)
  const hPayees = heuresPayees != null ? heuresPayees : Math.floor(Number(totalHeures) || 0)

  const libelleMat = (m) =>
    m.matiereEn && m.matiereEn !== m.matiere ? `${m.matiere} · ${m.matiereEn}` : m.matiere
  const totalSeances = parMatiere.reduce((s, m) => s + (Number(m.seances) || 0), 0)
  const lignesMatiere = parMatiere.length
    ? parMatiere
        .map(
          (m) => `<tr>
            <td>${echapper(libelleMat(m))}<br><span style="color:#8d7d6f;font-size:9pt">Niveau ${echapper(m.niveau)}${m.section === 'anglophone' ? ' · Anglophone' : ''}</span></td>
            <td class="num">${echapper(m.seances)}</td>
            <td class="num">${echapper(heuresLisibles(m.heures))}</td>
          </tr>`,
        )
        .join('')
    : `<tr><td colspan="3" style="color:#8d7d6f">Aucune heure enregistrée.</td></tr>`

  // Résumé de paie : les minutes ne comptent pas (heures arrondies), puis brut,
  // impôt et net. En mode « heures seulement », on ne montre que le total.
  const resume = avecMontants
    ? `<table style="margin-top:14px">
        <tbody>
          <tr><td>Heures payées <span style="color:#8d7d6f;font-size:9pt">(minutes non comptées)</span></td><td class="num">${echapper(heuresLisibles(hPayees))}</td></tr>
          <tr><td>Brut</td><td class="num">${echapper(fmtMoney(brut))}</td></tr>
          <tr><td>Impôt (${echapper(tauxImpot)} %)</td><td class="num">− ${echapper(fmtMoney(impot))}</td></tr>
          <tr class="total"><td><strong>Net à payer</strong></td><td class="num"><strong>${echapper(fmtMoney(net))}</strong></td></tr>
        </tbody>
      </table>`
    : `<p class="meta" style="margin-top:12px"><strong>Total des heures payées :</strong> ${echapper(heuresLisibles(hPayees))}</p>`

  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>${avecMontants ? 'Fiche de paie' : 'Fiche des heures'} — ${echapper(enseignant)}</title>
  <style>${STYLE_FICHE}</style>
</head>
<body>
  <div class="page">
    <div class="filigrane"><img src="${echapper(logoUrl)}" alt=""></div>
    <div class="contenu">
      <div class="entete">
        <img src="${echapper(logoUrl)}" alt="">
        <div>
          <div class="marque-nom"><span class="istc">ISTC</span> SmartPresence</div>
          <div class="etablissement">${echapper(etablissement || 'Établissement')}</div>
        </div>
      </div>

      <h1>${avecMontants ? 'Fiche de paie' : 'Fiche récapitulative des heures'}</h1>
      <p class="meta"><strong>Enseignant :</strong> ${echapper(enseignant)}</p>
      ${departement ? `<p class="meta"><strong>Département :</strong> ${echapper(departement)}</p>` : ''}
      <p class="meta"><strong>Période :</strong> ${echapper(periode)}</p>
      <p class="meta"><strong>Établie le :</strong> ${echapper(aujourdhui)}</p>

      <table>
        <caption>Détail par matière</caption>
        <thead>
          <tr>
            <th>Matière</th>
            <th class="num">Séances</th>
            <th class="num">Heures</th>
          </tr>
        </thead>
        <tbody>
          ${lignesMatiere}
          <tr class="total">
            <td>Total</td>
            <td class="num">${echapper(totalSeances)}</td>
            <td class="num">${echapper(heuresLisibles(totalHeures))}</td>
          </tr>
        </tbody>
      </table>

      ${resume}

      <div class="signature">
        <div>${avecMontants ? "L'administration" : 'Le secrétariat'}</div>
        <div>L'enseignant</div>
      </div>

      <p class="pied">
        Document généré par ISTC SmartPresence. Les heures payées sont le total de
        la période arrondi à l'heure inférieure (les minutes ne sont pas comptées).${
          avecMontants ? " L'impôt est retenu au taux indiqué." : ' Les montants ne figurent pas sur cette fiche.'
        }
      </p>
    </div>
  </div>
</body>
</html>`

  // Iframe caché : hors écran, aucune trace visible dans la page.
  const cadre = document.createElement('iframe')
  cadre.setAttribute('aria-hidden', 'true')
  cadre.style.position = 'fixed'
  cadre.style.right = '0'
  cadre.style.bottom = '0'
  cadre.style.width = '0'
  cadre.style.height = '0'
  cadre.style.border = '0'
  document.body.appendChild(cadre)

  const doc = cadre.contentWindow?.document
  if (!doc) {
    cadre.remove()
    return { ok: false, message: "Impression impossible : l'aperçu n'a pas pu être préparé." }
  }
  doc.open()
  doc.write(html)
  doc.close()

  // On attend que le logo soit chargé, sinon en-tête et filigrane sortent vides.
  let imprime = false
  const lancer = () => {
    if (imprime) return
    imprime = true
    try {
      cadre.contentWindow.focus()
      cadre.contentWindow.print()
    } catch {
      /* ignore */
    }
    // On retire l'iframe une fois le dialogue d'impression traité.
    setTimeout(() => cadre.remove(), 1500)
  }

  const img = doc.querySelector('img')
  if (img && !img.complete) {
    img.addEventListener('load', lancer)
    img.addEventListener('error', lancer)
    setTimeout(lancer, 1500) // filet si l'image ne se charge jamais
  } else {
    setTimeout(lancer, 200)
  }

  return { ok: true }
}

/* ------------------------------------------------------------------ *
 *  Point d'entrée unique
 * ------------------------------------------------------------------ */

/**
 * Exporte un rapport dans le format demandé.
 *
 * @param {object} rapport
 * @param {string} rapport.format        'pdf' | 'excel' | 'word' | 'csv'
 * @param {string} rapport.titre         titre affiché en tête du document
 * @param {string} rapport.nomFichier    base du nom de fichier, sans extension
 * @param {Array}  rapport.colonnes      [{ key, label, value?, numerique? }]
 * @param {Array}  rapport.lignes        les données
 * @param {Array}  [rapport.meta]        lignes de contexte (période, filtres…)
 * @param {string} [rapport.etablissement]
 * @returns {{ok:boolean, message?:string}}
 */
export function exporterRapport({
  format,
  titre,
  nomFichier,
  colonnes,
  lignes,
  meta = [],
  etablissement = null,
}) {
  if (!lignes?.length) {
    return { ok: false, message: 'Aucune ligne à exporter sur cette période.' }
  }

  const base = nomFichier ?? titre

  if (format === 'csv') {
    downloadCsv(nomDeFichier(base, 'csv'), toCsv(colonnes, lignes))
    return { ok: true }
  }

  if (format === 'excel') {
    telecharger(
      nomDeFichier(base, 'xls'),
      versExcel({ titre, colonnes, lignes, meta }),
      'application/vnd.ms-excel;charset=utf-8',
    )
    return { ok: true }
  }

  if (format === 'word') {
    telecharger(
      nomDeFichier(base, 'doc'),
      versWord({ titre, colonnes, lignes, meta, etablissement }),
      'application/msword;charset=utf-8',
    )
    return { ok: true }
  }

  if (format === 'pdf') {
    return versPdf({ titre, colonnes, lignes, meta, etablissement })
  }

  return { ok: false, message: 'Format inconnu.' }
}
