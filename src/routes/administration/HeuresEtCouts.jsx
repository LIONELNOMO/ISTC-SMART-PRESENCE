import { useMemo, useState } from 'react'
import { Coins } from 'lucide-react'

import { useProjection } from '../../lib/session.jsx'
import { formatHours, formatMoney, libelleMatiere, sum } from '../../lib/utils.js'
import { dayKey, formatDate, formatTime, startOfMonth, startOfWeek } from '../../lib/dates.js'
import { BoutonExport } from '../../components/app/BoutonExport.jsx'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { Badge } from '../../components/ui/primitives.jsx'
import {
  Banner,
  Card,
  CardHeader,
  EmptyState,
  SectionTitle,
  Stat,
} from '../../components/ui/surfaces.jsx'
import { Field, Input, Segmented } from '../../components/ui/forms.jsx'
import { DataTable, TotalRow } from '../../components/ui/data.jsx'
import { StatutSeance, ViaBadge } from '../../components/app/SessionBits.jsx'
import { useToast } from '../../components/ui/overlays.jsx'

const PERIODES = [
  { value: 'jour', label: "Aujourd'hui" },
  { value: 'semaine', label: 'Semaine' },
  { value: 'mois', label: 'Mois' },
  { value: 'tout', label: 'Tout' },
  { value: 'personnalise', label: 'Dates' },
]

const STATUT_LISIBLE = {
  terminee: 'Terminée',
  en_cours: 'En cours',
  incomplete: 'Incomplète',
}

const AXES = [
  { value: 'parEnseignant', label: 'Enseignant' },
  { value: 'parMatiere', label: 'Matière' },
  { value: 'parFiliere', label: 'Filière' },
  { value: 'parNiveau', label: 'Niveau' },
  { value: 'parJour', label: 'Jour' },
]

/**
 * Heures et coûts (§7, §10) : détail par période, enseignant, matière, filière,
 * niveau, et export CSV.
 *
 * §13.7 « Export trop large » : l'export est réservé à ce rôle, et chaque cellule
 * passe par la neutralisation des formules de `tabular.js`.
 */
export function AdminHeuresEtCouts() {
  const administration = useProjection('administration')
  const toast = useToast()

  const [periode, setPeriode] = useState('mois')
  const [axe, setAxe] = useState('parEnseignant')
  const [debut, setDebut] = useState('')
  const [fin, setFin] = useState('')

  const bornes = useMemo(() => {
    const now = new Date()
    if (periode === 'jour') return { from: dayKey(now), to: dayKey(now) }
    if (periode === 'semaine') return { from: dayKey(startOfWeek(now)), to: dayKey(now) }
    if (periode === 'mois') return { from: dayKey(startOfMonth(now)), to: dayKey(now) }
    if (periode === 'personnalise') return { from: debut || null, to: fin || null }
    return { from: null, to: null }
  }, [periode, debut, fin])

  const seances = useMemo(() => {
    const toutes = administration?.heuresEtCouts?.seances ?? []
    return toutes.filter((seance) => {
      if (bornes.from && seance.day < bornes.from) return false
      if (bornes.to && seance.day > bornes.to) return false
      return true
    })
  }, [administration, bornes])

  const terminees = useMemo(() => seances.filter((s) => s.status === 'terminee'), [seances])

  const agrege = useMemo(() => {
    const clefs = {
      parEnseignant: (s) => [s.teacherId, s.enseignant],
      parMatiere: (s) => [s.matiereId, `${s.matiere} — ${s.classe}`],
      parFiliere: (s) => [s.filiereId, s.classe.split(' · ')[0]],
      parNiveau: (s) => [s.niveau, `Niveau ${s.niveau}`],
      parJour: (s) => [s.day, formatDate(s.day)],
    }
    const pick = clefs[axe]
    const map = new Map()
    for (const seance of terminees) {
      const [key, libelle] = pick(seance)
      if (!map.has(key)) map.set(key, { key, libelle, heures: 0, seances: 0, montant: 0, incomplet: false })
      const ligne = map.get(key)
      ligne.heures += seance.heuresPayees
      ligne.seances += 1
      if (seance.montant === null) ligne.incomplet = true
      else ligne.montant += seance.montant
    }
    return [...map.values()].sort((a, b) => b.heures - a.heures)
  }, [terminees, axe])

  if (!administration) {
    return (
      <EmptyState icon={<Coins className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer les heures et les coûts.
      </EmptyState>
    )
  }

  const monnaie = administration.parametres.monnaie
  const totalHeures = sum(terminees, (s) => s.heuresPayees)
  const totalMontant = sum(terminees, (s) => s.montant ?? 0)
  const sansTaux = terminees.filter((s) => s.montant === null)

  /**
   * Contenu du rapport, calculé au moment de l'export : ce sont exactement les
   * séances affichées, filtres de période compris.
   */
  const rapport = () => {
    const libellePeriode = PERIODES.find((p) => p.value === periode)?.label ?? ''
    const bornesLisibles = bornes.from
      ? `du ${formatDate(bornes.from)} au ${formatDate(bornes.to ?? bornes.from)}`
      : 'toutes périodes'

    return {
      titre: 'Heures et coûts',
      nomFichier: `heures-et-couts-${bornes.from ? `${bornes.from}_${bornes.to ?? ''}` : 'tout'}`,
      etablissement: administration.parametres.etablissement,
      meta: [
        `Période : ${libellePeriode} · ${bornesLisibles}`,
        `${terminees.length} séance${terminees.length > 1 ? 's' : ''} comptée${terminees.length > 1 ? 's' : ''} · ${formatHours(totalHeures)} · ${formatMoney(totalMontant, monnaie)}`,
        sansTaux.length > 0
          ? `Attention : ${sansTaux.length} séance${sansTaux.length > 1 ? 's' : ''} sans taux applicable, non comptée${sansTaux.length > 1 ? 's' : ''} dans le total`
          : null,
      ].filter(Boolean),
      colonnes: [
        { key: 'day', label: 'Jour', value: (row) => formatDate(row.day) },
        { key: 'enseignant', label: 'Enseignant' },
        { key: 'matiere', label: 'Matière' },
        { key: 'classe', label: 'Classe' },
        { key: 'niveau', label: 'Niveau', numerique: true },
        { key: 'arrivee', label: 'Arrivée', value: (row) => formatTime(row.arrivalAt) },
        { key: 'depart', label: 'Départ', value: (row) => formatTime(row.departureAt) },
        { key: 'releve', label: 'Relevé', value: (row) => formatTime(row.releveAt) },
        {
          key: 'heures',
          label: 'Heures payées',
          numerique: true,
          value: (row) => String(row.heuresPayees).replace('.', ','),
        },
        {
          key: 'taux',
          label: `Taux (${monnaie})`,
          numerique: true,
          value: (row) => row.taux ?? '',
        },
        {
          key: 'montant',
          label: `Coût (${monnaie})`,
          numerique: true,
          value: (row) => row.montant ?? '',
        },
        { key: 'statut', label: 'État', value: (row) => STATUT_LISIBLE[row.status] ?? row.status },
        {
          key: 'saisieManuelle',
          label: 'Départ saisi après coup',
          value: (row) => (row.departManuel ? 'oui' : 'non'),
        },
      ],
      lignes: terminees,
    }
  }

  return (
    <>
      <PageHeader
        title="Heures et coûts"
        subtitle="Seules les séances terminées sont comptées."
        actions={
          <BoutonExport rapport={rapport} desactive={terminees.length === 0} />
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <Segmented value={periode} onChange={setPeriode} options={PERIODES} />
          {periode === 'personnalise' && (
            <div className="flex items-end gap-2">
              <Field label="Du" htmlFor="debut">
                <Input
                  id="debut"
                  type="date"
                  value={debut}
                  onChange={(event) => setDebut(event.target.value)}
                  className="h-10 w-[150px]"
                />
              </Field>
              <Field label="Au" htmlFor="fin">
                <Input
                  id="fin"
                  type="date"
                  value={fin}
                  onChange={(event) => setFin(event.target.value)}
                  className="h-10 w-[150px]"
                />
              </Field>
            </div>
          )}
        </div>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Heures comptées" value={formatHours(totalHeures)} tone="brand" />
        <Stat
          label="Coût total"
          value={formatMoney(totalMontant, monnaie)}
          tone="ok"
          hint={sansTaux.length > 0 ? `${sansTaux.length} séance(s) sans taux` : undefined}
        />
        <Stat label="Séances" value={terminees.length} />
        <Stat
          label="Coût moyen par heure"
          value={totalHeures > 0 ? formatMoney(totalMontant / totalHeures, monnaie) : '—'}
          hint="Indicatif, hors séances sans taux."
        />
      </div>

      {sansTaux.length > 0 && (
        <Banner tone="warn" className="mt-4" title="Coût incomplet">
          {sansTaux.length} séance{sansTaux.length > 1 ? 's' : ''} n'a{sansTaux.length > 1 ? 'ont' : ''} aucun taux applicable à sa date. Leur coût
          reste vide et n'entre pas dans le total.
        </Banner>
      )}

      <div className="mt-6">
        <SectionTitle actions={<Segmented value={axe} onChange={setAxe} options={AXES} size="sm" />}>
          Répartition
        </SectionTitle>
        <Card>
          <DataTable
            className="px-2 py-1 sm:px-3"
            columns={[
              { key: 'libelle', label: 'Libellé', strong: true },
              {
                key: 'seances',
                label: 'Séances',
                align: 'right',
                render: (row) => <span className="text-faint">{row.seances}</span>,
              },
              {
                key: 'heures',
                label: 'Heures',
                align: 'right',
                render: (row) => <span className="font-semibold">{formatHours(row.heures)}</span>,
              },
              {
                key: 'montant',
                label: 'Coût',
                align: 'right',
                render: (row) => (
                  <span className="font-semibold text-ok">
                    {formatMoney(row.montant, monnaie)}
                    {row.incomplet && (
                      <Badge tone="warn" className="ml-2">
                        incomplet
                      </Badge>
                    )}
                  </span>
                ),
              },
            ]}
            rows={agrege}
            getKey={(row) => String(row.key)}
            empty="Aucune séance comptée sur la période"
            dense
            footer={
              <TotalRow
                cells={[
                  { value: 'Total' },
                  { value: terminees.length, align: 'right' },
                  { value: formatHours(totalHeures), align: 'right' },
                  { value: formatMoney(totalMontant, monnaie), align: 'right' },
                ]}
              />
            }
          />
        </Card>
      </div>

      <div className="mt-6">
        <SectionTitle hint="Les trois heures de chaque séance, et le taux appliqué à sa date.">
          Détail des séances
        </SectionTitle>
        <Card>
          <CardHeader
            title={`${seances.length} séance${seances.length > 1 ? 's' : ''} sur la période`}
            subtitle="Les séances en cours et incomplètes sont affichées sans coût."
          />
          <DataTable
            className="px-2 py-1 sm:px-3"
            columns={[
              {
                key: 'day',
                label: 'Jour',
                render: (row) => <span className="whitespace-nowrap">{formatDate(row.day)}</span>,
              },
              { key: 'enseignant', label: 'Enseignant', strong: true },
              {
                key: 'matiere',
                label: 'Matière',
                render: (row) => (
                  <span>
                    {libelleMatiere(row.matiere, row.matiereEn)}
                    <span className="block text-[11px] text-faint">{row.classe}</span>
                  </span>
                ),
              },
              {
                key: 'arrivalAt',
                label: 'Arrivée',
                mono: true,
                hideOnTablet: true,
                render: (row) => formatTime(row.arrivalAt),
              },
              {
                key: 'departureAt',
                label: 'Départ',
                mono: true,
                hideOnTablet: true,
                render: (row) =>
                  row.departureAt ? formatTime(row.departureAt) : <span className="font-sans text-bad">—</span>,
              },
              {
                key: 'releveAt',
                label: 'Relevé',
                mono: true,
                hideOnTablet: true,
                render: (row) =>
                  row.releveAt ? formatTime(row.releveAt) : <span className="font-sans text-bad">—</span>,
              },
              {
                key: 'heuresPayees',
                label: 'Heures',
                align: 'right',
                render: (row) =>
                  row.status === 'terminee' ? (
                    <span className="font-semibold">{formatHours(row.heuresPayees)}</span>
                  ) : (
                    <span className="text-faint">—</span>
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
                key: 'montant',
                label: 'Coût',
                align: 'right',
                render: (row) =>
                  row.status !== 'terminee' ? (
                    <span className="text-faint">—</span>
                  ) : row.montant === null ? (
                    <Badge tone="warn">sans taux</Badge>
                  ) : (
                    <span className="font-semibold text-ok">{formatMoney(row.montant, monnaie)}</span>
                  ),
              },
              {
                key: 'status',
                label: 'État',
                render: (row) => (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <StatutSeance statut={row.status} />
                    {row.declareEnseignant && <ViaBadge via="declare" />}
                    {row.departManuel && <ViaBadge via="saisie_manuelle" />}
                  </span>
                ),
              },
            ]}
            rows={seances}
            empty="Aucune séance sur la période"
            dense
            seuil="lg"
          />
        </Card>
      </div>
    </>
  )
}
