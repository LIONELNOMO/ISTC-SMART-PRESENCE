import { useState } from 'react'
import { AlertCircle, Clock, EyeOff, TrendingUp } from 'lucide-react'

import { useProjection } from '../../lib/session.jsx'
import { formatHours } from '../../lib/utils.js'
import { formatDate, formatTime } from '../../lib/dates.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import {
  Banner,
  BarRow,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  SectionTitle,
  Stat,
} from '../../components/ui/surfaces.jsx'
import { Segmented } from '../../components/ui/forms.jsx'
import { DataTable } from '../../components/ui/data.jsx'
import { StatutSeance, ViaBadge } from '../../components/app/SessionBits.jsx'

/**
 * « Mes heures » (§7, §10).
 *
 * Par séance : arrivée, départ, heure du relevé, heures payées, écart non payé.
 * Totaux par matière et par période.
 *
 * §13.3 « Fuite des taux et des montants » : aucun taux, aucun montant n'arrive
 * sur cet appareil. Ce n'est pas masqué à l'écran — ce n'est pas envoyé.
 */
export function EnseignantHeures() {
  const enseignant = useProjection('enseignant')
  const [periode, setPeriode] = useState('matiere')

  if (!enseignant?.heures) {
    return (
      <EmptyState icon={<Clock className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer vos heures.
      </EmptyState>
    )
  }

  const { heures } = enseignant
  const terminees = heures.seances.filter((s) => s.status === 'terminee')

  const groupes = {
    matiere: heures.parMatiere.map((row) => ({
      key: row.matiereId,
      label: `${row.matiere} — ${row.classe}`,
      value: row.heures,
      seances: row.seances,
    })),
    jour: heures.parJour.slice(0, 14).map((row) => ({
      key: row.day,
      label: formatDate(row.day),
      value: row.heures,
      seances: row.seances,
    })),
    mois: heures.parMois.map((row) => ({
      key: row.mois,
      label: row.mois,
      value: row.heures,
      seances: row.seances,
    })),
    semestre: heures.parSemestre.map((row) => ({
      key: row.id,
      label: row.nom,
      value: row.heures,
      seances: row.seances,
    })),
  }

  return (
    <>
      <PageHeader
        title="Mes heures"
        subtitle="Calculées à partir des heures pointées au secrétariat, à la minute près."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Heures effectuées"
          value={formatHours(heures.totalHeures)}
          tone="ok"
          icon={<Clock className="size-4" aria-hidden />}
          hint={`${terminees.length} séance${terminees.length > 1 ? 's' : ''} comptée${terminees.length > 1 ? 's' : ''}`}
        />
        <Stat
          label="Écart non payé"
          value={formatHours(heures.totalEcartNonPaye)}
          tone={heures.totalEcartNonPaye > 0 ? 'warn' : 'neutral'}
          icon={<EyeOff className="size-4" aria-hidden />}
          hint="Temps entre votre départ pointé et la validation du relevé."
        />
        <Stat
          label="Séances incomplètes"
          value={heures.incompletes.length}
          tone={heures.incompletes.length > 0 ? 'bad' : 'neutral'}
          icon={<AlertCircle className="size-4" aria-hidden />}
          hint="Non comptées : il leur manque un départ ou un relevé validé."
        />
      </div>

      {heures.incompletes.length > 0 && (
        <Banner tone="warn" className="mt-4" title="Des séances ne sont pas comptées">
          {heures.incompletes.length} séance{heures.incompletes.length > 1 ? 's' : ''} attend
          {heures.incompletes.length > 1 ? 'ent' : ''} un départ pointé ou un relevé validé. Passez au
          secrétariat, ou saisissez le relevé depuis l'écran « Relevé ».
        </Banner>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <SectionTitle>Totaux</SectionTitle>
          <Card>
            <CardHeader
              title="Répartition"
              icon={<TrendingUp className="size-4" aria-hidden />}
            />
            <CardBody className="space-y-4">
              <Segmented
                value={periode}
                onChange={setPeriode}
                size="sm"
                options={[
                  { value: 'matiere', label: 'Matière' },
                  { value: 'jour', label: 'Jour' },
                  { value: 'mois', label: 'Mois' },
                  { value: 'semestre', label: 'Semestre' },
                ]}
              />
              <BarRow
                rows={groupes[periode]}
                format={(value) => formatHours(value)}
                emptyLabel="Aucune séance comptée"
              />
            </CardBody>
          </Card>

          <p className="mt-3 text-[12px] leading-relaxed text-faint">
            Les taux horaires et les montants ne sont visibles que par l'administration : ils ne sont
            pas envoyés à cet appareil.
          </p>
        </div>

        <div className="lg:col-span-3">
          <SectionTitle hint="Les trois heures de chaque séance, comme demandé au §4.">
            Détail par séance
          </SectionTitle>
          <Card>
            <DataTable
              className="px-2 py-1 sm:px-3"
              columns={[
                {
                  key: 'matiere',
                  label: 'Séance',
                  strong: true,
                  render: (row) => (
                    <span>
                      {row.matiere}
                      <span className="ml-2 text-[12px] font-normal text-faint">
                        {formatDate(row.arrivalAt)}
                      </span>
                    </span>
                  ),
                },
                {
                  key: 'arrivalAt',
                  label: 'Arrivée',
                  mono: true,
                  render: (row) => formatTime(row.arrivalAt),
                },
                {
                  key: 'departureAt',
                  label: 'Départ',
                  mono: true,
                  render: (row) =>
                    row.departureAt ? (
                      formatTime(row.departureAt)
                    ) : (
                      <span className="font-sans text-bad">non pointé</span>
                    ),
                },
                {
                  key: 'releveAt',
                  label: 'Relevé',
                  mono: true,
                  hideOnTablet: true,
                  render: (row) =>
                    row.releveAt ? (
                      formatTime(row.releveAt)
                    ) : (
                      <span className="font-sans text-bad">non validé</span>
                    ),
                },
                {
                  key: 'heuresPayees',
                  label: 'Heures payées',
                  align: 'right',
                  render: (row) => (
                    <span className={row.status === 'terminee' ? 'font-semibold text-ok' : 'text-faint'}>
                      {row.status === 'terminee' ? formatHours(row.heuresPayees) : '—'}
                    </span>
                  ),
                },
                {
                  key: 'ecartNonPaye',
                  label: 'Écart',
                  align: 'right',
                  hideOnTablet: true,
                  render: (row) => (
                    <span className={row.ecartNonPaye > 0 ? 'text-warn' : 'text-faint'}>
                      {row.ecartNonPaye > 0 ? formatHours(row.ecartNonPaye) : '—'}
                    </span>
                  ),
                },
                {
                  key: 'depassementNonPaye',
                  label: 'Dépassement',
                  align: 'right',
                  hideOnTablet: true,
                  render: (row) => (
                    <span className={row.depassementNonPaye > 0 ? 'text-warn' : 'text-faint'}>
                      {row.depassementNonPaye > 0 ? formatHours(row.depassementNonPaye) : '—'}
                    </span>
                  ),
                },
                {
                  key: 'status',
                  label: 'État',
                  render: (row) => (
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <StatutSeance statut={row.status} />
                      {row.declareEnseignant ? (
                        <ViaBadge via="declare" />
                      ) : (
                        <ViaBadge via={row.departureVia === 'saisie_manuelle' ? 'saisie_manuelle' : null} />
                      )}
                    </span>
                  ),
                },
              ]}
              rows={heures.seances}
              empty="Aucune séance"
              emptyIcon={<Clock className="size-5" />}
              dense
              seuil="lg"
            />
          </Card>
        </div>
      </div>
    </>
  )
}
