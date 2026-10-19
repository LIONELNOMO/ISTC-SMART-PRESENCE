import { useEffect, useRef, useState } from 'react'
import { Download, FileSpreadsheet, FileText, FileType, Table2 } from 'lucide-react'

import { cn } from '../../lib/utils.js'
import { exporterRapport, FORMATS } from '../../lib/export.js'
import { Button } from '../ui/primitives.jsx'
import { useToast } from '../ui/overlays.jsx'

const ICONES = {
  pdf: FileType,
  excel: FileSpreadsheet,
  word: FileText,
  csv: Table2,
}

/**
 * Bouton d'export, avec le choix du format.
 *
 * Le contenu du rapport est fourni par une fonction `rapport()` appelée au
 * moment du clic : les données exportées sont donc celles affichées à l'écran,
 * filtres compris, et rien n'est calculé tant qu'on n'exporte pas.
 */
export function BoutonExport({
  rapport,
  libelle = 'Exporter',
  desactive = false,
  variant = 'secondary',
  taille = 'md',
  className,
}) {
  const [ouvert, setOuvert] = useState(false)
  const [occupe, setOccupe] = useState(null)
  const conteneur = useRef(null)
  const toast = useToast()

  // Fermeture au clic extérieur et à la touche Échap.
  useEffect(() => {
    if (!ouvert) return undefined
    const auClic = (event) => {
      if (!conteneur.current?.contains(event.target)) setOuvert(false)
    }
    const auClavier = (event) => {
      if (event.key === 'Escape') setOuvert(false)
    }
    document.addEventListener('pointerdown', auClic)
    document.addEventListener('keydown', auClavier)
    return () => {
      document.removeEventListener('pointerdown', auClic)
      document.removeEventListener('keydown', auClavier)
    }
  }, [ouvert])

  const exporter = (format) => {
    setOccupe(format)
    try {
      const contenu = rapport()
      const resultat = exporterRapport({ ...contenu, format })
      if (!resultat.ok) {
        toast.erreur('Export impossible', resultat.message)
        return
      }
      const nom = FORMATS.find((f) => f.id === format)?.label ?? format
      toast.succes(
        format === 'pdf' ? 'Aperçu ouvert' : `Export ${nom} produit`,
        format === 'pdf'
          ? 'Choisissez « Enregistrer au format PDF » dans la fenêtre d’impression.'
          : `${contenu.lignes.length} ligne${contenu.lignes.length > 1 ? 's' : ''} exportée${contenu.lignes.length > 1 ? 's' : ''}.`,
      )
    } catch {
      toast.erreur('Export impossible', "Le rapport n'a pas pu être produit.")
    } finally {
      setOccupe(null)
      setOuvert(false)
    }
  }

  return (
    <div ref={conteneur} className={cn('relative', className)}>
      <Button
        variant={variant}
        size={taille}
        disabled={desactive}
        onClick={() => setOuvert((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={ouvert}
      >
        <Download className="size-4" aria-hidden />
        {libelle}
      </Button>

      {ouvert && (
        <div
          role="menu"
          className="animate-pop absolute right-0 z-50 mt-1.5 w-60 overflow-hidden rounded-card border border-line bg-surface shadow-pop"
        >
          <p className="border-b border-line bg-surface-2 px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-faint">
            Format du rapport
          </p>
          <ul className="p-1">
            {FORMATS.map((format) => {
              const Icone = ICONES[format.id]
              return (
                <li key={format.id}>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={occupe !== null}
                    onClick={() => exporter(format.id)}
                    className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent-soft/50 disabled:opacity-50"
                  >
                    <Icone className="size-4 shrink-0 text-accent-text" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-ink">{format.label}</span>
                      <span className="block text-[11px] text-faint">{format.description}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
