import { Link } from 'react-router-dom'
import { Bell, BookOpen, CalendarClock, CheckCircle2, Clock, ScanLine } from 'lucide-react'

import { useProjection } from '../../lib/session.jsx'
import { formatHours } from '../../lib/utils.js'
import { formatAgo } from '../../lib/dates.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { Badge, Button } from '../../components/ui/primitives.jsx'
import {
  Banner,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  SectionTitle,
  Stat,
} from '../../components/ui/surfaces.jsx'
import { DataTable } from '../../components/ui/data.jsx'

/**
 * Accueil de l'étudiant (§10) : heures d'absence du semestre — non justifiées,
 * justifiées, détail par matière — et messages de début de cours.
 *
 * Toutes ces valeurs sont calculées par le serveur et reçues telles quelles
 * (§13.8). L'étudiant ne reçoit aucune donnée d'un autre étudiant (§13.10).
 */
export function EtudiantAccueil() {
  const etudiant = useProjection('etudiant')
  const parametres = useProjection('parametres')

  if (!etudiant) {
    return (
      <EmptyState icon={<BookOpen className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer vos absences.
      </EmptyState>
    )
  }

  const { totaux, profil, notifications, seanceOuverte } = etudiant
  const sansSemestre = !totaux.semestre

  return (
    <>
      <PageHeader
        title={profil.nom}
        subtitle={`${profil.classe}${profil.section === 'anglophone' ? ' · Section anglophone' : ''} · matricule ${profil.matricule}`}
        actions={
          <Button as="span" variant="secondary" size="sm" className="pointer-events-none">
            {totaux.periodeLabel}
          </Button>
        }
      />

      {sansSemestre && (
        <Banner tone="info" className="mb-4" title="Semestres non renseignés">
          L'administration n'a pas encore saisi les dates des semestres. Vos absences sont donc
          totalisées sur l'ensemble de l'année.
        </Banner>
      )}

      {seanceOuverte && (
        <Banner
          tone="ok"
          className="mb-4"
          title="Un relevé de présences est ouvert"
          actions={
            <Button size="sm" as={Link} to="/etudiant/scanner">
              <ScanLine className="size-4" aria-hidden />
              Scanner
            </Button>
          }
        >
          Votre enseignant affiche le code de présence. Scannez-le pour être marqué présent.
        </Banner>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Absences non justifiées"
          value={formatHours(totaux.nonJustifiees)}
          tone={totaux.nonJustifiees > 0 ? 'bad' : 'ok'}
          icon={<Clock className="size-4" aria-hidden />}
          hint="Comptées pour l'alerte aux parents."
        />
        <Stat
          label="Justifications en attente"
          value={formatHours(totaux.enAttente)}
          tone={totaux.enAttente > 0 ? 'warn' : 'neutral'}
          icon={<CalendarClock className="size-4" aria-hidden />}
          hint="Encore comptées tant que la décision n'est pas prise."
        />
        <Stat
          label="Absences justifiées"
          value={formatHours(totaux.justifiees)}
          tone="ok"
          icon={<CheckCircle2 className="size-4" aria-hidden />}
          hint="Comptées à part, hors alerte."
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <SectionTitle hint="Heures d'absence pour la période en cours.">Par matière</SectionTitle>
          <Card>
            <DataTable
              className="px-2 py-1 sm:px-3"
              columns={[
                { key: 'matiere', label: 'Matière', strong: true },
                {
                  key: 'nonJustifiees',
                  label: 'Non justifiées',
                  align: 'right',
                  render: (row) => (
                    <span className={row.nonJustifiees > 0 ? 'font-semibold text-bad' : 'text-faint'}>
                      {formatHours(row.nonJustifiees)}
                    </span>
                  ),
                },
                {
                  key: 'justifiees',
                  label: 'Justifiées',
                  align: 'right',
                  render: (row) => (
                    <span className={row.justifiees > 0 ? 'text-ok' : 'text-faint'}>
                      {formatHours(row.justifiees)}
                    </span>
                  ),
                },
                {
                  key: 'seances',
                  label: 'Séances',
                  align: 'right',
                  hideOnMobile: true,
                  render: (row) => <span className="text-faint">{row.seances}</span>,
                },
              ]}
              rows={totaux.parMatiere}
              getKey={(row) => row.matiereId}
              empty="Aucune absence sur la période"
              emptyIcon={<CheckCircle2 className="size-5" />}
              dense
            />
          </Card>

          <div className="mt-4">
            <Button as={Link} to="/etudiant/seances" variant="secondary" className="w-full sm:w-auto">
              Voir toutes mes séances
            </Button>
          </div>
        </div>

        <div className="lg:col-span-2">
          <SectionTitle>Messages de début de cours</SectionTitle>
          <Card>
            <CardHeader
              title="Notifications"
              subtitle="Envoyées au pointage d'arrivée de l'enseignant."
              icon={<Bell className="size-4" aria-hidden />}
            />
            <CardBody flush>
              {notifications.length === 0 ? (
                <p className="px-5 py-8 text-center text-[13px] text-faint">
                  Aucun message pour le moment.
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {notifications.slice(0, 8).map((notification) => (
                    <li key={notification.id} className="px-4 py-3 sm:px-5">
                      <p className="text-[13.5px] font-medium text-ink">{notification.titre}</p>
                      <p className="mt-0.5 text-[12.5px] text-soft">{notification.corps}</p>
                      <p className="mt-1 text-[11px] text-faint">{formatAgo(notification.at)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <p className="mt-3 text-[12px] leading-relaxed text-faint">
            Les notifications demandent une connexion. Hors ligne, les messages déjà reçus restent
            visibles ici.
          </p>
        </div>
      </div>

      {parametres?.semestres?.length > 1 && (
        <p className="mt-6 text-center text-[12px] text-faint">
          Semestres : {parametres.semestres.map((s) => s.nom).join(' · ')}
          <Badge tone="neutral" className="ml-2">
            période déduite de la date de chaque séance
          </Badge>
        </p>
      )}
    </>
  )
}
