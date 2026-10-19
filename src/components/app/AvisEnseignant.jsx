import { useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'

import { Modal } from '../ui/overlays.jsx'
import { Button } from '../ui/primitives.jsx'
import { formatStamp } from '../../lib/dates.js'

/**
 * Pop-up des avis destinés à l'enseignant (§7).
 *
 * À l'ouverture de son espace, les avis qu'il n'a pas encore vus s'affichent
 * dans une fenêtre : heures ajoutées a posteriori, fiche transmise…
 *
 * « Vu » est gardé sur l'appareil (horodatage du dernier avis fermé). C'est un
 * simple confort d'affichage : aucune donnée sensible, et l'app fonctionne si
 * le stockage local est indisponible (le pop-up se réaffichera, sans plus).
 */
const CLE = 'istc_avis_vu'

export function AvisEnseignant({ avis = [] }) {
  const [ouvert, setOuvert] = useState(false)
  const [nouveaux, setNouveaux] = useState([])

  useEffect(() => {
    if (!avis.length) return
    let dernierVu = ''
    try {
      dernierVu = localStorage.getItem(CLE) ?? ''
    } catch {
      /* stockage indisponible */
    }
    // Les horodatages sont au format ISO : la comparaison de chaînes suffit.
    const recents = avis.filter((a) => a.at > dernierVu)
    if (recents.length) {
      setNouveaux(recents)
      setOuvert(true)
    }
  }, [avis])

  const fermer = () => {
    setOuvert(false)
    try {
      const plusRecent = avis.reduce((m, a) => (a.at > m ? a.at : m), '')
      if (plusRecent) localStorage.setItem(CLE, plusRecent)
    } catch {
      /* stockage indisponible */
    }
  }

  if (!ouvert || nouveaux.length === 0) return null

  return (
    <Modal
      open={ouvert}
      onClose={fermer}
      title={nouveaux.length > 1 ? 'Vous avez des nouveautés' : 'Une nouveauté'}
      size="sm"
      footer={<Button onClick={fermer}>J'ai vu</Button>}
    >
      <ul className="space-y-3">
        {nouveaux.map((a) => (
          <li key={a.id} className="rounded-xl border border-line bg-surface-2 p-3.5">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <BellRing className="size-4 shrink-0 text-accent-text" aria-hidden />
              {a.titre}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-soft">{a.corps}</p>
            <p className="mt-1.5 text-[11px] text-faint">{formatStamp(a.at)}</p>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
