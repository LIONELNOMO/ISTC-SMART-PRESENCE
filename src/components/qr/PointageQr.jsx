import { useEffect, useMemo, useState } from 'react'
import { Timer } from 'lucide-react'

import { QrImage } from './QrImage.jsx'
import { buildPointageQr, POINTAGE_SLOT_MS, currentSlot } from '../../lib/qr-codes.js'
import { Banner } from '../ui/surfaces.jsx'
import { cn } from '../../lib/utils.js'

/**
 * Code QR de pointage affiché au secrétariat (§4).
 *
 * Il est renouvelé à chaque créneau de 60 secondes et signé avec la clef du
 * poste. Une photo du code ne vaut plus rien au créneau suivant
 * (§13.4 « Photo du code QR de pointage »).
 */
export function PointageQr({ station, size = 232, className }) {
  const [valeur, setValeur] = useState(null)
  const [slot, setSlot] = useState(() => currentSlot())
  const [resteMs, setResteMs] = useState(POINTAGE_SLOT_MS)
  const [erreur, setErreur] = useState(null)

  // Régénération à chaque changement de créneau.
  useEffect(() => {
    if (!station?.secret) return undefined
    let annule = false
    buildPointageQr({ stationId: station.id, stationSecret: station.secret })
      .then((texte) => {
        if (!annule) {
          setValeur(texte)
          setErreur(null)
        }
      })
      .catch(() => {
        if (!annule) setErreur("La clef du poste de pointage n'a pas pu être utilisée.")
      })
    return () => {
      annule = true
    }
  }, [station?.id, station?.secret, slot])

  // Horloge : met à jour le compte à rebours et déclenche le créneau suivant.
  useEffect(() => {
    const tick = () => {
      const maintenant = Date.now()
      const courant = currentSlot(maintenant)
      setResteMs(POINTAGE_SLOT_MS - (maintenant % POINTAGE_SLOT_MS))
      setSlot((precedent) => (precedent === courant ? precedent : courant))
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [])

  const secondes = Math.ceil(resteMs / 1000)
  const proportion = useMemo(() => resteMs / POINTAGE_SLOT_MS, [resteMs])

  if (!station) {
    return (
      <Banner tone="warn" title="Aucun poste de pointage">
        Ce compte n'est rattaché à aucun poste de secrétariat. L'administration doit en créer un.
      </Banner>
    )
  }

  if (erreur) return <Banner tone="bad">{erreur}</Banner>

  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      <QrImage value={valeur} size={size} label={null} />

      <div className="w-full max-w-[232px]">
        <div className="mb-1.5 flex items-center justify-between text-[12px]">
          <span className="flex items-center gap-1.5 font-medium text-faint">
            <Timer className="size-3.5" aria-hidden />
            Nouveau code dans
          </span>
          <span
            className={cn(
              'font-mono font-bold tabular-nums',
              secondes <= 10 ? 'text-warn' : 'text-soft',
            )}
          >
            {secondes} s
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-500 ease-linear',
              secondes <= 10 ? 'bg-warn' : 'bg-brand',
            )}
            style={{ width: `${proportion * 100}%` }}
          />
        </div>
      </div>

      <p className="max-w-[260px] text-center text-[12px] leading-relaxed text-faint">
        L'enseignant scanne ce code pour pointer son arrivée ou son départ.
        Une photo du code devient inutilisable dès le créneau suivant.
      </p>
    </div>
  )
}
