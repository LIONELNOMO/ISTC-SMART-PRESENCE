import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Camera, CameraOff, RefreshCw, ScanLine } from 'lucide-react'

import { cn } from '../../lib/utils.js'
import { Button } from '../ui/primitives.jsx'
import { Banner } from '../ui/surfaces.jsx'
import { looksLikeUrl } from '../../lib/qr-codes.js'

/**
 * Lecture d'un code QR par la caméra, hors ligne (§11).
 *
 *  §13.8 « Permission caméra » — la caméra ne démarre QUE sur un geste
 *         explicite de l'utilisateur, et TOUTES les pistes sont arrêtées dès
 *         qu'il l'éteint, au démontage, ou quand l'onglet passe en arrière-plan.
 *         Elle ne reste jamais allumée « pour rien ».
 *  §13.1 « Injection par code QR » — le texte lu est remonté tel quel à
 *         `onScan`, comme une donnée. Rien n'est ouvert, rien n'est exécuté.
 *         Un contenu qui ressemble à une adresse est signalé et refusé.
 */
export function QrScanner({
  onScan,
  active = true,
  className,
  hauteur = 300,
  intervalleMs = 180,
  consigne = 'Placez le code dans le cadre',
}) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const boucleRef = useRef(0)
  const dernierRef = useRef({ texte: null, at: 0 })

  // La caméra part ÉTEINTE : l'utilisateur l'allume quand il est prêt à scanner.
  const [marche, setMarche] = useState(false)
  const [etat, setEtat] = useState('demarrage') // demarrage | pret | refus | indisponible
  const [message, setMessage] = useState(null)
  const [alerte, setAlerte] = useState(null)

  // La caméra ne tourne que si l'utilisateur l'a allumée ET que le parent
  // l'autorise (par exemple : coupée automatiquement hors ligne).
  const enMarche = marche && active

  const arreterCamera = useCallback(() => {
    cancelAnimationFrame(boucleRef.current)
    clearTimeout(boucleRef.current)
    const stream = streamRef.current
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  useEffect(() => {
    if (!enMarche) {
      arreterCamera()
      return undefined
    }

    let annule = false

    const demarrer = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setEtat('indisponible')
        setMessage(
          "Ce navigateur ne donne pas accès à la caméra. L'application doit être servie en HTTPS.",
        )
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (annule) {
          for (const track of stream.getTracks()) track.stop()
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        setEtat('pret')
        lire()
      } catch (error) {
        if (annule) return
        setEtat('refus')
        setMessage(
          error?.name === 'NotAllowedError'
            ? "L'accès à la caméra a été refusé. Autorisez-le dans les réglages du navigateur."
            : "La caméra n'a pas pu démarrer.",
        )
      }
    }

    const lire = () => {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || annule) return

      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const largeur = video.videoWidth
        const hauteurVideo = video.videoHeight
        if (largeur && hauteurVideo) {
          // On n'analyse que le centre de l'image : plus rapide sur un
          // téléphone d'entrée de gamme, et cela correspond au cadre affiché.
          const cote = Math.floor(Math.min(largeur, hauteurVideo) * 0.72)
          const x = Math.floor((largeur - cote) / 2)
          const y = Math.floor((hauteurVideo - cote) / 2)

          canvas.width = cote
          canvas.height = cote
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          ctx.drawImage(video, x, y, cote, cote, 0, 0, cote, cote)
          const image = ctx.getImageData(0, 0, cote, cote)
          const trouve = jsQR(image.data, image.width, image.height, {
            inversionAttempts: 'dontInvert',
          })

          if (trouve?.data) {
            const texte = trouve.data
            const maintenant = Date.now()
            const memeQuAvant =
              dernierRef.current.texte === texte && maintenant - dernierRef.current.at < 2500
            if (!memeQuAvant) {
              dernierRef.current = { texte, at: maintenant }
              if (looksLikeUrl(texte)) {
                // Un QR qui contient une adresse n'a rien à faire ici.
                setAlerte(
                  "Ce code contient une adresse internet : il n'est pas un code de l'application. Il a été ignoré.",
                )
              } else {
                setAlerte(null)
                onScan?.(texte)
              }
            }
          }
        }
      }
      boucleRef.current = setTimeout(() => {
        boucleRef.current = requestAnimationFrame(lire)
      }, intervalleMs)
    }

    demarrer()
    return () => {
      annule = true
      arreterCamera()
    }
  }, [enMarche, arreterCamera, intervalleMs, onScan])

  // Si le parent retire son autorisation (passage hors ligne), on reflète
  // l'arrêt dans le bouton pour que l'utilisateur doive la rallumer lui-même.
  useEffect(() => {
    if (!active) setMarche(false)
  }, [active])

  // Deuxième filet : si l'onglet est quitté, on relâche la caméra et on
  // repasse le bouton sur « éteint » — elle ne se rallume pas toute seule.
  useEffect(() => {
    const onVisibilite = () => {
      if (document.visibilityState === 'hidden') {
        arreterCamera()
        setMarche(false)
      }
    }
    document.addEventListener('visibilitychange', onVisibilite)
    return () => document.removeEventListener('visibilitychange', onVisibilite)
  }, [arreterCamera])

  if (etat === 'refus' || etat === 'indisponible') {
    return (
      <div className={cn('space-y-3', className)}>
        <div
          className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line bg-surface-2 px-6 text-center"
          style={{ height: `min(${hauteur}px, 55vh)` }}
        >
          <CameraOff className="size-8 text-faint" aria-hidden />
          <p className="max-w-xs text-[13px] leading-relaxed text-faint">{message}</p>
          {etat === 'refus' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEtat('demarrage')
                setMessage(null)
                setMarche(true)
              }}
            >
              <RefreshCw className="size-4" aria-hidden />
              Réessayer
            </Button>
          )}
        </div>
      </div>
    )
  }

  // Caméra éteinte : on ne demande RIEN tant que l'utilisateur n'a pas cliqué.
  if (!enMarche) {
    return (
      <div className={cn('space-y-3', className)}>
        <div
          className="flex flex-col items-center justify-center gap-4 rounded-card border border-dashed border-line bg-surface-2 px-6 text-center"
          style={{ height: `min(${hauteur}px, 55vh)` }}
        >
          <Camera className="size-9 text-faint" aria-hidden />
          <p className="max-w-xs text-[13px] leading-relaxed text-faint">
            {active
              ? 'La caméra est éteinte. Activez-la seulement au moment de scanner.'
              : "La caméra reste éteinte tant que la connexion n'est pas rétablie."}
          </p>
          <Button variant="primary" size="sm" onClick={() => setMarche(true)} disabled={!active}>
            <Camera className="size-4" aria-hidden />
            Activer la caméra
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div
        className="relative overflow-hidden rounded-card border border-line bg-black"
        style={{ height: `min(${hauteur}px, 55vh)` }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          className="size-full object-cover"
          aria-label="Aperçu de la caméra"
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Cadre de visée */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative aspect-square w-[72%]">
            <span className="absolute left-0 top-0 size-8 rounded-tl-xl border-l-[3px] border-t-[3px] border-white/90" />
            <span className="absolute right-0 top-0 size-8 rounded-tr-xl border-r-[3px] border-t-[3px] border-white/90" />
            <span className="absolute bottom-0 left-0 size-8 rounded-bl-xl border-b-[3px] border-l-[3px] border-white/90" />
            <span className="absolute bottom-0 right-0 size-8 rounded-br-xl border-b-[3px] border-r-[3px] border-white/90" />
          </div>
        </div>

        {/* Arrêt de la caméra, toujours accessible pendant le scan. */}
        <div className="absolute right-3 top-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setMarche(false)}
            className="bg-black/55 text-white backdrop-blur hover:bg-black/70"
          >
            <CameraOff className="size-4" aria-hidden />
            Arrêter
          </Button>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-8">
          <p className="flex items-center justify-center gap-2 text-center text-[12px] font-medium text-white/90">
            {etat === 'pret' ? (
              <ScanLine className="size-4 animate-pulse" aria-hidden />
            ) : (
              <Camera className="size-4" aria-hidden />
            )}
            {etat === 'pret' ? consigne : 'Démarrage de la caméra…'}
          </p>
        </div>
      </div>

      {alerte && <Banner tone="bad">{alerte}</Banner>}
    </div>
  )
}
