import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Banknote,
  Clock,
  Coins,
  PenLine,
  RadioTower,
  Settings,
  TriangleAlert,
} from 'lucide-react'

import { useDerniereLecture, useProjection } from '../../lib/session.jsx'
import { formatHours, formatMoney } from '../../lib/utils.js'
import { formatAgo, formatDate, formatStamp } from '../../lib/dates.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { Badge, Button } from '../../components/ui/primitives.jsx'
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
import { SeanceCard, StatutSeance } from '../../components/app/SessionBits.jsx'
import { AvisAdmin } from '../../components/app/AvisAdmin.jsx'

/**
 * Tableau de bord de l'administration (§7, §10).
 *
 * Heures et coûts du jour, séances en cours, séances incomplètes. Le suivi est
 * en temps réel quand le secrétariat est connecté ; l'écran affiche l'heure de la
 * dernière donnée reçue.
 */
export function AdminTableauDeBord() {
  const administration = useProjection('administration')
  const derniere = useDerniereLecture()

  if (!administration) {
    return (
      <EmptyState icon={<Coins className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer le tableau de bord.
      </EmptyState>
    )
  }

  const { tableauDeBord, parametres, anomalies } = administration
  const monnaie = parametres.monnaie
  const manquants = parametres.manquants ?? []
  const anomaliesRecentes = (anomalies ?? []).slice(0, 6)

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        subtitle={parametres.etablissement}
        actions={
          <Badge tone={derniere ? 'ok' : 'neutral'} dot>
            <RadioTower className="size-3" aria-hidden />
            Dernière donnée {formatAgo(derniere)}
          </Badge>
        }
      />

      <AvisAdmin fiches={administration?.fiches ?? []} />

      {manquants.length > 0 && (
        <Banner
          tone="warn"
          className="mb-4"
          title="Réglages à compléter"
          actions={
            <Button as={Link} to="/administration/parametres" size="sm" variant="secondary">
              <Settings className="size-4" aria-hidden />
              Paramètres
            </Button>
          }
        >
          {manquants.join(' · ')}. Tant que ces valeurs sont vides, l'application ne devine rien :
          les semestres ne sont pas déduits et aucun étudiant n'entre en alerte.
        </Banner>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Heures du jour"
          value={formatHours(tableauDeBord.jour.totaux.heures)}
          tone="brand"
          icon={<Clock className="size-4" aria-hidden />}
          hint={`${tableauDeBord.jour.totaux.seances} séance${tableauDeBord.jour.totaux.seances > 1 ? 's' : ''} comptée${tableauDeBord.jour.totaux.seances > 1 ? 's' : ''}`}
        />
        <Stat
          label="Coût du jour"
          value={formatMoney(tableauDeBord.jour.totaux.montant, monnaie)}
          tone="ok"
          icon={<Banknote className="size-4" aria-hidden />}
          hint={
            tableauDeBord.jour.totaux.montantIncomplet
              ? 'Incomplet : des séances sont sans taux applicable.'
              : 'Somme des séances terminées aujourd’hui.'
          }
        />
        <Stat
          label="Séances en cours"
          value={tableauDeBord.enCours.length}
          tone="warn"
          icon={<RadioTower className="size-4" aria-hidden />}
          hint="Affichées dès le pointage d'arrivée, sans coût."
        />
        <Stat
          label="Séances incomplètes"
          value={tableauDeBord.incompletes.length}
          tone={tableauDeBord.incompletes.length > 0 ? 'bad' : 'neutral'}
          icon={<TriangleAlert className="size-4" aria-hidden />}
          hint="Non comptées dans les heures ni les coûts."
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Semaine"
          value={formatHours(tableauDeBord.semaine.totaux.heures)}
          hint={formatMoney(tableauDeBord.semaine.totaux.montant, monnaie)}
        />
        <Stat
          label="Mois"
          value={formatHours(tableauDeBord.mois.totaux.heures)}
          hint={formatMoney(tableauDeBord.mois.totaux.montant, monnaie)}
        />
        <Stat
          label="Heures saisies après coup"
          value={tableauDeBord.saisiesManuelles.length}
          tone={tableauDeBord.saisiesManuelles.length > 0 ? 'warn' : 'neutral'}
          icon={<PenLine className="size-4" aria-hidden />}
          hint="Départs enregistrés par le secrétariat après le cours."
        />
      </div>

      {tableauDeBord.sansTaux.length > 0 && (
        <Banner
          tone="bad"
          className="mt-4"
          title={`${tableauDeBord.sansTaux.length} séance${tableauDeBord.sansTaux.length > 1 ? 's' : ''} sans taux applicable`}
          actions={
            <Button as={Link} to="/administration/taux" size="sm" variant="secondary">
              Taux horaires
            </Button>
          }
        >
          Leur coût reste vide. Créez un taux pour le niveau ou l'enseignant concerné : les séances
          déjà faites prendront le taux en vigueur à leur date.
        </Banner>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <SectionTitle hint="Elles apparaissent dès le pointage d'arrivée du secrétariat.">
            Séances en cours
          </SectionTitle>
          {tableauDeBord.enCours.length === 0 ? (
            <EmptyState icon={<RadioTower className="size-5" />} title="Aucune séance en cours">
              Dès qu'une arrivée est pointée, la séance apparaît ici.
            </EmptyState>
          ) : (
            <div className="space-y-3">
              {tableauDeBord.enCours.map((seance) => (
                <SeanceCard key={seance.id} seance={seance} />
              ))}
            </div>
          )}

          {tableauDeBord.incompletes.length > 0 && (
            <>
              <SectionTitle className="mt-6" hint="Il leur manque un départ ou un relevé validé.">
                Séances incomplètes
              </SectionTitle>
              <div className="space-y-3">
                {tableauDeBord.incompletes.slice(0, 6).map((seance) => (
                  <SeanceCard key={seance.id} seance={seance} />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="space-y-4 lg:col-span-2">
          <div>
            <SectionTitle>Heures par jour</SectionTitle>
            <Card>
              <CardBody>
                <BarRow
                  rows={tableauDeBord.jour.parJour.slice(0, 10).map((row) => ({
                    key: row.day,
                    label: formatDate(row.day),
                    value: row.heures,
                  }))}
                  format={(value) => formatHours(value)}
                  emptyLabel="Aucune séance comptée aujourd'hui"
                />
              </CardBody>
            </Card>
          </div>

          <div>
            <SectionTitle>Anomalies</SectionTitle>
            <Card>
              <CardHeader
                title="À surveiller"
                subtitle="Départs saisis après coup, écarts de relevé, essais bloqués."
                icon={<AlertTriangle className="size-4" aria-hidden />}
                actions={
                  <Button as={Link} to="/administration/historique" size="sm" variant="ghost">
                    Tout voir
                  </Button>
                }
              />
              <CardBody flush>
                {anomaliesRecentes.length === 0 ? (
                  <p className="px-5 py-8 text-center text-[13px] text-faint">
                    Aucune anomalie signalée.
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {anomaliesRecentes.map((anomalie) => (
                      <li key={anomalie.id} className="px-4 py-3 sm:px-5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium text-ink">{anomalie.titre}</p>
                            {anomalie.detail && (
                              <p className="mt-0.5 text-[12px] leading-snug text-faint">
                                {anomalie.detail}
                              </p>
                            )}
                            <p className="mt-1 text-[11px] text-faint">{formatStamp(anomalie.at)}</p>
                          </div>
                          <Badge
                            tone={
                              anomalie.severity === 'grave'
                                ? 'bad'
                                : anomalie.severity === 'attention'
                                  ? 'warn'
                                  : 'neutral'
                            }
                          >
                            {anomalie.severity}
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      </div>

      {tableauDeBord.saisiesManuelles.length > 0 && (
        <div className="mt-8">
          <SectionTitle hint="Chaque saisie est conservée dans l'historique avec son motif.">
            Heures saisies après coup par le secrétariat
          </SectionTitle>
          <div className="space-y-3">
            {tableauDeBord.saisiesManuelles.slice(0, 5).map((seance) => (
              <SeanceCard key={seance.id} seance={seance} actions={<StatutSeance statut={seance.status} />} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}
