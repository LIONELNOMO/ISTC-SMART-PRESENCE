import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  PenLine,
  QrCode,
  UserCheck,
} from 'lucide-react'

import { cn, formatHours, libelleMatiere } from '../../lib/utils.js'
import { formatDate, formatTime } from '../../lib/dates.js'
import { Badge } from '../ui/primitives.jsx'
import { KeyValue } from '../ui/data.jsx'
import { Card, CardBody } from '../ui/surfaces.jsx'

/** État d'une séance (§4). L'état vient du serveur, jamais du client. */
export function StatutSeance({ statut, className }) {
  const config = {
    en_cours: { tone: 'warn', label: 'En cours', Icon: Clock3 },
    terminee: { tone: 'ok', label: 'Terminée', Icon: CheckCircle2 },
    incomplete: { tone: 'bad', label: 'Incomplète', Icon: AlertCircle },
  }[statut] ?? { tone: 'neutral', label: statut ?? '—', Icon: AlertCircle }

  const { tone, label, Icon } = config
  return (
    <Badge tone={tone} className={className}>
      <Icon className="size-3" aria-hidden />
      {label}
    </Badge>
  )
}

/** Présence d'un étudiant à une séance. */
export function EtatPresence({ etat, className }) {
  const config = {
    present: { tone: 'ok', label: 'Présent' },
    absent: { tone: 'bad', label: 'Absent' },
    en_attente: { tone: 'warn', label: 'En attente' },
  }[etat] ?? { tone: 'neutral', label: etat ?? '—' }
  return (
    <Badge tone={config.tone} className={className}>
      {config.label}
    </Badge>
  )
}

/** État d'une justification (§6). */
export function EtatJustification({ etat, className }) {
  const config = {
    non_justifiee: { tone: 'bad', label: 'Non justifiée' },
    en_attente: { tone: 'warn', label: 'Justification en attente' },
    acceptee: { tone: 'ok', label: 'Justifiée' },
    refusee: { tone: 'bad', label: 'Justification refusée' },
  }[etat] ?? { tone: 'neutral', label: etat ?? '—' }
  return (
    <Badge tone={config.tone} className={className}>
      {config.label}
    </Badge>
  )
}

/** Ce qui manque à une séance incomplète. */
export function ManqueListe({ manque, className }) {
  if (!manque?.length) return null
  return (
    <span className={cn('text-[12px] text-bad', className)}>
      Il manque : {manque.join(', ')}
    </span>
  )
}

/** Comment l'heure a été enregistrée : scan, secrétariat, saisie après coup. */
export function ViaBadge({ via, className }) {
  if (!via) return null
  const config = {
    scan: { tone: 'info', label: 'Scanné', Icon: QrCode },
    secretariat: { tone: 'neutral', label: 'Secrétariat', Icon: UserCheck },
    saisie_manuelle: { tone: 'warn', label: 'Saisie après coup', Icon: PenLine },
    declare: { tone: 'warn', label: "Déclaré par l'enseignant", Icon: ClipboardCheck },
  }[via]
  if (!config) return null
  const { tone, label, Icon } = config
  return (
    <Badge tone={tone} className={className}>
      <Icon className="size-3" aria-hidden />
      {label}
    </Badge>
  )
}

/**
 * Fiche de séance réutilisée par l'enseignant, le secrétariat et
 * l'administration. `montant` n'est passé que par l'administration.
 */
export function SeanceCard({
  seance,
  montant = null,
  actions,
  className,
  afficherEnseignant = true,
  afficherCode = null,
  children,
}) {
  return (
    <Card className={className}>
      <CardBody>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-[15px] font-semibold text-ink">
                {libelleMatiere(seance.matiere, seance.matiereEn)}
              </h3>
              <StatutSeance statut={seance.status} />
            </div>
            <p className="mt-0.5 text-[13px] text-faint">
              {seance.classe}
              {afficherEnseignant && seance.enseignant ? ` · ${seance.enseignant}` : ''}
              {' · '}
              {formatDate(seance.arrivalAt)}
            </p>
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>

        <KeyValue
          className="mt-4"
          columns={3}
          items={[
            { label: 'Arrivée', value: formatTime(seance.arrivalAt), mono: true },
            {
              label: 'Départ',
              value: seance.departureAt ? formatTime(seance.departureAt) : 'non pointé',
              mono: Boolean(seance.departureAt),
              tone: seance.departureAt ? undefined : 'bad',
            },
            {
              label: 'Relevé',
              value: seance.releveAt ? formatTime(seance.releveAt) : 'non validé',
              mono: Boolean(seance.releveAt),
              tone: seance.releveAt ? undefined : 'bad',
            },
            {
              label: 'Heures payées',
              value: seance.status === 'terminee' ? formatHours(seance.heuresPayees) : '—',
              tone: seance.status === 'terminee' ? 'ok' : 'faint',
            },
            seance.ecartNonPaye > 0
              ? {
                  label: 'Écart non payé',
                  value: formatHours(seance.ecartNonPaye),
                  tone: 'warn',
                }
              : null,
            {
              label: 'Présents',
              value: `${seance.presentsCount} / ${seance.effectif}`,
            },
            montant !== null
              ? {
                  label: 'Coût',
                  value: montant,
                  tone: 'ok',
                }
              : null,
            afficherCode ? { label: 'Code de séance', value: afficherCode, mono: true } : null,
          ]}
        />

        {seance.status === 'incomplete' && (
          <p className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-[12px] font-medium text-bad">
            Séance non comptée dans les heures. Il manque : {seance.manque?.join(', ')}.
          </p>
        )}

        {seance.departManuel && (
          <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-[12px] text-warn">
            Départ saisi après coup par {seance.departManuel.par} — motif :{' '}
            {seance.departManuel.motif}
          </p>
        )}

        {children}
      </CardBody>
    </Card>
  )
}
