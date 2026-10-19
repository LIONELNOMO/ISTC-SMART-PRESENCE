import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

import { cn } from '../../lib/utils.js'
import { Spinner } from '../ui/primitives.jsx'

/**
 * Génération d'un code QR, entièrement dans le navigateur, sans réseau (§11).
 *
 * Le fond reste blanc et les modules noirs quel que soit le thème : un QR
 * inversé ou coloré se lit mal sur les téléphones d'entrée de gamme.
 */
export function QrImage({ value, size = 240, className, label, quietZone = 2 }) {
  const [dataUrl, setDataUrl] = useState(null)
  const [erreur, setErreur] = useState(null)

  useEffect(() => {
    let annule = false
    if (!value) {
      setDataUrl(null)
      return undefined
    }
    QRCode.toDataURL(String(value), {
      errorCorrectionLevel: 'M',
      margin: quietZone,
      width: size * 2, // on génère en double pour les écrans à forte densité
      color: { dark: '#0b1020ff', light: '#ffffffff' },
    })
      .then((url) => {
        if (!annule) {
          setDataUrl(url)
          setErreur(null)
        }
      })
      .catch(() => {
        if (!annule) setErreur('Impossible de produire le code.')
      })
    return () => {
      annule = true
    }
  }, [value, size, quietZone])

  return (
    <div className={cn('inline-flex flex-col items-center gap-2', className)}>
      <div
        className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl bg-white p-2 shadow-card ring-1 ring-black/5"
        style={{ width: `min(${size}px, 72vw)` }}
      >
        {erreur ? (
          <p className="px-3 text-center text-[12px] font-medium text-bad">{erreur}</p>
        ) : dataUrl ? (
          <img
            src={dataUrl}
            alt={label ?? 'Code QR'}
            width={size}
            height={size}
            className="size-full object-contain"
            draggable={false}
          />
        ) : (
          <Spinner />
        )}
      </div>
      {label && <p className="text-[12px] font-medium text-faint">{label}</p>}
    </div>
  )
}
