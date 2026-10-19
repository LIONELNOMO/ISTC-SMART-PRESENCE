import { Clock, FileDown, Wallet } from 'lucide-react'

import { useProjection, useSession } from '../../lib/session.jsx'
import { fichePdfEnseignant } from '../../lib/export.js'
import { formatHours, formatMoney, libelleMatiere } from '../../lib/utils.js'
import { formatLongDate } from '../../lib/dates.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { Button } from '../../components/ui/primitives.jsx'
import { Banner, Card, CardBody, CardHeader, EmptyState, Stat } from '../../components/ui/surfaces.jsx'
import { DataTable } from '../../components/ui/data.jsx'
import { useToast } from '../../components/ui/overlays.jsx'

/**
 * Historique de paiement de l'enseignant (§7).
 *
 * L'enseignant retrouve ici les périodes qui lui ont été PAYÉES : les heures,
 * la matière, le montant, et un export PDF (logo + filigrane ISTC). C'est son
 * propre montant : il a le droit de le voir (§13.10). Un rappel indique les
 * heures pas encore payées.
 */
export function EnseignantFiches() {
  const enseignant = useProjection('enseignant')
  const { moi } = useSession()
  const toast = useToast()

  if (!enseignant) {
    return (
      <EmptyState icon={<Wallet className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer votre historique.
      </EmptyState>
    )
  }

  const fiches = enseignant.fiches ?? []
  const heuresNonPayees = enseignant.heuresNonPayees ?? 0
  const monNom = moi?.label ?? 'Enseignant'

  const imprimer = (fiche) => {
    const logoUrl = `${window.location.origin}/marque/logo-istc.jpeg`
    const resultat = fichePdfEnseignant({
      enseignant: monNom,
      etablissement: fiche.etablissement,
      parMatiere: fiche.parMatiere ?? [],
      totalHeures: fiche.totalHeures ?? 0,
      heuresPayees: fiche.heuresPayees ?? Math.floor(fiche.totalHeures ?? 0),
      logoUrl,
      periode: fiche.periode,
      avecMontants: true,
      brut: fiche.montant ?? 0,
      tauxImpot: fiche.tauxImpot ?? 0,
      impot: fiche.impot ?? 0,
      net: fiche.net ?? fiche.montant ?? 0,
    })
    if (!resultat.ok) toast.erreur('Impression', resultat.message)
  }

  return (
    <>
      <PageHeader
        title="Historique de paiement"
        subtitle="Les périodes qui vous ont été payées. Chaque fiche est exportable en PDF."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Stat
          label="Heures pas encore payées"
          value={formatHours(heuresNonPayees)}
          tone={heuresNonPayees > 0 ? 'warn' : 'ok'}
          hint="Heures terminées non encore réglées."
        />
        <Stat label="Fiches payées" value={fiches.length} tone="ok" />
      </div>

      {fiches.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState icon={<Wallet className="size-5" />} title="Aucun paiement pour l'instant">
              Dès qu'une période vous est payée, elle apparaît ici avec le détail et le montant.
            </EmptyState>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          {fiches.map((fiche) => (
            <Card key={fiche.id}>
              <CardHeader
                title={fiche.periode}
                subtitle={`Payée le ${formatLongDate(fiche.payeeLe)} · ${formatHours(fiche.totalHeures)}`}
                icon={<Clock className="size-4" aria-hidden />}
                actions={
                  <Button size="sm" onClick={() => imprimer(fiche)}>
                    <FileDown className="size-4" aria-hidden />
                    Imprimer en PDF
                  </Button>
                }
              />
              <CardBody className="space-y-3">
                <DataTable
                  seuil="lg"
                  columns={[
                    {
                      key: 'matiere',
                      label: 'Matière',
                      strong: true,
                      render: (row) => (
                        <span>
                          {libelleMatiere(row.matiere, row.matiereEn)}
                          <span className="block text-[11px] font-normal text-faint">
                            Niveau {row.niveau}
                          </span>
                        </span>
                      ),
                    },
                    { key: 'seances', label: 'Séances', align: 'right' },
                    {
                      key: 'heures',
                      label: 'Heures',
                      align: 'right',
                      render: (row) => formatHours(row.heures),
                    },
                  ]}
                  rows={(fiche.parMatiere ?? []).map((m, i) => ({ ...m, id: `${m.matiereId}-${i}` }))}
                  empty="Aucune heure"
                />
                <div className="space-y-2 rounded-xl bg-surface-2 px-4 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-soft">Heures payées</span>
                    <span className="font-medium text-ink">
                      {formatHours(fiche.heuresPayees ?? Math.floor(fiche.totalHeures ?? 0))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-soft">Brut</span>
                    <span className="font-medium text-ink">{formatMoney(fiche.montant ?? 0)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-soft">Impôt ({fiche.tauxImpot ?? 0} %)</span>
                    <span className="font-medium text-ink">− {formatMoney(fiche.impot ?? 0)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-line pt-2">
                    <span className="font-medium text-ink">Net payé</span>
                    <span className="text-lg font-bold text-ink">
                      {formatMoney(fiche.net ?? fiche.montant ?? 0)}
                    </span>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
