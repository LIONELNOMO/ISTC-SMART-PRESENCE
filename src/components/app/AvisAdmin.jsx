import { useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Modal } from '../ui/overlays.jsx'
import { Button } from '../ui/primitives.jsx'
import { formatLongDate } from '../../lib/dates.js'

/**
 * Pop-up des fiches reçues par l'administration (§7).
 *
 * À l'ouverture de son espace, les fiches transmises par le secrétariat et pas
 * encore vues s'affichent. « Vu » est gardé sur l'appareil (confort d'affichage,
 * aucune donnée sensible).
 */
const CLE = 'istc_admin_fiche_vue'

export function AvisAdmin({ fiches = [] }) {
  const [ouvert, setOuvert] = useState(false)
  const [nouvelles, setNouvelles] = useState([])

  useEffect(() => {
    if (!fiches.length) return
    let dernierVu = ''
    try {
      dernierVu = localStorage.getItem(CLE) ?? ''
    } catch {
      /* stockage indisponible */
    }
    const recentes = fiches.filter(
      (f) => f.statut === 'en_attente' && (f.creeeLe ?? '') > dernierVu,
    )
    if (recentes.length) {
      setNouvelles(recentes)
      setOuvert(true)
    }
  }, [fiches])

  const fermer = () => {
    setOuvert(false)
    try {
      const plusRecent = fiches.reduce((m, f) => ((f.creeeLe ?? '') > m ? f.creeeLe : m), '')
      if (plusRecent) localStorage.setItem(CLE, plusRecent)
    } catch {
      /* stockage indisponible */
    }
  }

  if (!ouvert || nouvelles.length === 0) return null

  return (
    <Modal
      open={ouvert}
      onClose={fermer}
      title={nouvelles.length > 1 ? 'Nouvelles fiches de paie' : 'Nouvelle fiche de paie'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={fermer}>
            Plus tard
          </Button>
          <Button as={Link} to="/administration/fiches" onClick={fermer}>
            Voir les fiches
          </Button>
        </>
      }
    >
      <ul className="space-y-3">
        {nouvelles.map((f) => (
          <li key={f.id} className="rounded-xl border border-line bg-surface-2 p-3.5">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <BellRing className="size-4 shrink-0 text-accent-text" aria-hidden />
              {f.enseignant}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-soft">
              Fiche créée par {f.creeePar}
              {f.departement ? ` · ${f.departement}` : ''} · {f.periode}.
            </p>
            <p className="mt-1.5 text-[11px] text-faint">{formatLongDate(f.creeeLe)}</p>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
