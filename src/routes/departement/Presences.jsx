import { useState } from 'react'
import { Users } from 'lucide-react'

import { useProjection } from '../../lib/session.jsx'
import { formatHours } from '../../lib/utils.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { Badge } from '../../components/ui/primitives.jsx'
import { Card, CardHeader, EmptyState, Stat } from '../../components/ui/surfaces.jsx'
import { Segmented } from '../../components/ui/forms.jsx'
import { DataTable } from '../../components/ui/data.jsx'

/**
 * Présences de la filière (§10) : absences par classe et par étudiant.
 *
 * §14 : le chef de département ne voit aucun coût. La projection ne contient
 * d'ailleurs ni taux ni montant.
 */
export function DepartementPresences() {
  const departement = useProjection('departement')
  const [classeId, setClasseId] = useState(null)

  const classes = departement?.presences ?? []
  const courante = classes.find((c) => c.classeId === classeId) ?? classes[0] ?? null

  if (!departement) {
    return (
      <EmptyState icon={<Users className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer les présences de votre filière.
      </EmptyState>
    )
  }

  if (!classes.length) {
    return (
      <>
        <PageHeader title="Présences de la filière" />
        <EmptyState icon={<Users className="size-5" />} title="Aucune classe">
          Aucune classe n'est rattachée à votre filière pour le moment.
        </EmptyState>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Présences de la filière"
        subtitle="Heures d'absence par étudiant, pour la période en cours."
      >
        <Segmented
          value={courante?.classeId}
          onChange={setClasseId}
          options={classes.map((classe) => ({
            value: classe.classeId,
            label: `Niveau ${classe.niveau}`,
            count: classe.effectif,
          }))}
        />
      </PageHeader>

      {courante && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Effectif" value={courante.effectif} hint={courante.classe} />
            <Stat
              label="Absences non justifiées"
              value={formatHours(courante.totalNonJustifiees)}
              tone={courante.totalNonJustifiees > 0 ? 'bad' : 'ok'}
              hint="Cumul de la classe."
            />
            <Stat
              label="Étudiants concernés"
              value={courante.etudiants.filter((e) => e.nonJustifiees > 0).length}
              tone="warn"
              hint="Au moins une heure non justifiée."
            />
          </div>

          <Card className="mt-6">
            <CardHeader title={courante.classe} subtitle={`${courante.effectif} étudiants`} />
            <DataTable
              className="px-2 py-1 sm:px-3"
              columns={[
                {
                  key: 'nom',
                  label: 'Étudiant',
                  strong: true,
                  render: (row) => (
                    <span>
                      {row.nom}
                      <span className="ml-2 font-mono text-[11px] font-normal text-faint">
                        {row.matricule}
                      </span>
                    </span>
                  ),
                },
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
                  key: 'enAttente',
                  label: 'En attente',
                  align: 'right',
                  render: (row) =>
                    row.enAttente > 0 ? (
                      <Badge tone="warn">{formatHours(row.enAttente)}</Badge>
                    ) : (
                      <span className="text-faint">—</span>
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
              ]}
              rows={courante.etudiants}
              getKey={(row) => row.studentId}
              empty="Aucun étudiant dans cette classe"
              dense
            />
          </Card>
        </>
      )}
    </>
  )
}
