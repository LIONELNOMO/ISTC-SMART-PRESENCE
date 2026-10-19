import { useEffect, useState } from 'react'
import {
  CloudOff,
  Cloud,
  Plane,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Wifi,
  WifiOff,
} from 'lucide-react'

import { cn } from '../../lib/utils.js'
import { formatAgo, formatStamp } from '../../lib/dates.js'
import { Button, Count, IconButton } from '../ui/primitives.jsx'
import { Banner } from '../ui/surfaces.jsx'
import { Modal } from '../ui/overlays.jsx'
import { useDerniereLecture, useOutbox, useSession } from '../../lib/session.jsx'
import { synchroniser, abandonner, onSync, OUTBOX_STATES } from '../../lib/sync.js'

const LIBELLES_OPS = {
  'secretariat.arrivee': "Pointage d'arrivée",
  'secretariat.depart': 'Pointage de départ',
  'secretariat.depart_manuel': 'Départ saisi après coup',
  'pointage.scan': 'Scan de pointage',
  'releve.ouvrir': 'Ouverture du relevé',
  'releve.fermer': 'Fermeture du relevé',
  'releve.valider': 'Validation du relevé',
  'releve.corriger': 'Correction du relevé',
  'presence.scan': 'Scan de présence',
  'justification.demander': 'Demande de justification',
  'justification.decider': 'Décision sur une justification',
  'justification.directe': 'Justification directe',
  'parent.contacter': 'Contact du parent',
  'admin.referentiel': 'Modification du référentiel',
  'admin.taux': 'Création de taux',
  'admin.parametres': 'Modification des paramètres',
  'admin.semestres': 'Dates des semestres',
  'admin.compte': 'Gestion de compte',
  'admin.import_etudiants': 'Import des étudiants',
}

/**
 * Indicateur toujours visible : état du réseau et nombre d'éléments en attente
 * (§9). Le bouton « Synchroniser » permet de lancer l'envoi à la main.
 */
export function NetworkPill({ className, compact = false }) {
  const { enLigne, modeAvion } = useSession()
  const { enAttente, refusees } = useOutbox()
  const [enCours, setEnCours] = useState(false)
  const [ouvert, setOuvert] = useState(false)
  const derniere = useDerniereLecture()

  useEffect(
    () =>
      onSync((event) => {
        if (event.kind === 'debut') setEnCours(true)
        if (event.kind === 'fin') setEnCours(false)
      }),
    [],
  )

  const total = enAttente.length
  const tone = !enLigne ? 'bad' : total > 0 ? 'warn' : 'ok'

  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className={cn(
          'inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-[12px] font-semibold transition-colors',
          tone === 'bad' && 'border-bad/30 bg-bad-soft text-bad',
          tone === 'warn' && 'border-warn/35 bg-warn-soft text-warn',
          tone === 'ok' && 'border-ok/30 bg-ok-soft text-ok',
          className,
        )}
        aria-label="État de la synchronisation"
      >
        {modeAvion ? (
          <Plane className="size-3.5" aria-hidden />
        ) : enLigne ? (
          <Wifi className="size-3.5" aria-hidden />
        ) : (
          <WifiOff className="size-3.5" aria-hidden />
        )}
        {!compact && <span>{modeAvion ? 'Mode avion' : enLigne ? 'En ligne' : 'Hors ligne'}</span>}
        {total > 0 && <Count value={total} tone={enLigne ? 'brand' : 'bad'} />}
        {refusees.length > 0 && <TriangleAlert className="size-3.5" aria-hidden />}
      </button>

      <Modal
        open={ouvert}
        onClose={() => setOuvert(false)}
        title="Synchronisation"
        subtitle={
          derniere
            ? `Dernière donnée reçue ${formatAgo(derniere)} · ${formatStamp(derniere)}`
            : 'Aucune donnée reçue pour le moment'
        }
        footer={
          <>
            <ModeAvionBouton />
            <Button
              onClick={async () => {
                setEnCours(true)
                await synchroniser()
                setEnCours(false)
              }}
              loading={enCours}
              disabled={!enLigne}
            >
              <RefreshCw className="size-4" aria-hidden />
              Synchroniser
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3">
            <span
              className={cn(
                'flex size-9 items-center justify-center rounded-lg',
                enLigne ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad',
              )}
            >
              {enLigne ? <Cloud className="size-4" aria-hidden /> : <CloudOff className="size-4" aria-hidden />}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                {modeAvion ? 'Mode avion activé' : enLigne ? 'Connexion active' : 'Aucune connexion'}
              </p>
              <p className="text-[12px] leading-snug text-faint">
                {enLigne
                  ? 'Les actions partent immédiatement.'
                  : 'Les actions sont gardées sur cet appareil et partiront au retour du réseau.'}
              </p>
            </div>
          </div>

          {refusees.length > 0 && (
            <Banner tone="bad" title={`${refusees.length} action${refusees.length > 1 ? 's' : ''} refusée${refusees.length > 1 ? 's' : ''}`}>
              Le serveur a refusé ces actions. Corrigez la saisie, ou abandonnez-les.
            </Banner>
          )}

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
              File d'attente ({total})
            </p>
            {total === 0 && refusees.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-faint">
                Rien en attente. Tout est enregistré sur le serveur.
              </p>
            ) : (
              <ul className="space-y-2">
                {[...enAttente, ...refusees].map((op) => (
                  <li
                    key={op.opId}
                    className={cn(
                      'flex items-start gap-3 rounded-xl border px-3.5 py-2.5',
                      op.state === OUTBOX_STATES.REFUSEE
                        ? 'border-bad/30 bg-bad-soft/40'
                        : 'border-line bg-surface-2',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-ink">
                        {op.label ?? LIBELLES_OPS[op.type] ?? op.type}
                      </p>
                      <p className="mt-0.5 text-[11px] text-faint">
                        {formatStamp(op.createdAt)}
                        {op.tentatives > 0 && ` · ${op.tentatives} tentative${op.tentatives > 1 ? 's' : ''}`}
                      </p>
                      {op.erreur && <p className="mt-1 text-[12px] font-medium text-bad">{op.erreur}</p>}
                    </div>
                    {op.state === OUTBOX_STATES.REFUSEE && (
                      <IconButton
                        label="Abandonner cette action"
                        size="icon-sm"
                        onClick={() => abandonner(op.opId)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </IconButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-[12px] leading-relaxed text-faint">
            Chaque action porte un identifiant unique : une synchronisation coupée puis relancée
            n'enregistre jamais deux fois la même chose. Une action n'est effacée de cet appareil
            qu'après confirmation du serveur.
          </p>
        </div>
      </Modal>
    </>
  )
}

/** Bascule du mode avion, pour éprouver le hors ligne sans couper le Wi-Fi. */
export function ModeAvionBouton({ className }) {
  const { modeAvion, basculerModeAvion } = useSession()
  return (
    <Button
      variant={modeAvion ? 'danger' : 'secondary'}
      onClick={basculerModeAvion}
      className={className}
    >
      <Plane className="size-4" aria-hidden />
      {modeAvion ? 'Quitter le mode avion' : 'Mode avion'}
    </Button>
  )
}
