import { useMemo, useState } from 'react'
import { AlertTriangle, History, Lock, Search } from 'lucide-react'

import { useProjection } from '../../lib/session.jsx'
import { BoutonExport } from '../../components/app/BoutonExport.jsx'
import { formatStamp } from '../../lib/dates.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { Badge } from '../../components/ui/primitives.jsx'
import { Banner, Card, CardHeader, EmptyState } from '../../components/ui/surfaces.jsx'
import { Input, Segmented } from '../../components/ui/forms.jsx'
import { DataTable } from '../../components/ui/data.jsx'
import { useToast } from '../../components/ui/overlays.jsx'

const ENTITES = [
  { value: 'tout', label: 'Tout' },
  { value: 'seance', label: 'Séances' },
  { value: 'releve', label: 'Relevés' },
  { value: 'justification', label: 'Justifications' },
  { value: 'taux', label: 'Taux' },
  { value: 'parametre', label: 'Paramètres' },
  { value: 'compte', label: 'Comptes' },
  { value: 'referentiel', label: 'Référentiel' },
  { value: 'alerte', label: 'Alertes' },
]

/**
 * Historique (§11, §13.12).
 *
 * Toute modification d'une séance, d'un relevé, d'une justification, d'un taux ou
 * d'un paramètre est enregistrée avec l'auteur, la date, l'ancienne valeur et la
 * nouvelle. L'historique est en AJOUT SEUL : il n'existe aucune route de
 * modification ni de suppression, et les hooks de la base refusent toute
 * écriture autre qu'un ajout.
 */
export function AdminHistorique() {
  const administration = useProjection('administration')
  const toast = useToast()
  const [vue, setVue] = useState('historique')
  const [entite, setEntite] = useState('tout')
  const [recherche, setRecherche] = useState('')

  const historique = administration?.historique ?? []
  const anomalies = administration?.anomalies ?? []

  const lignes = useMemo(() => {
    const terme = recherche.trim().toLowerCase()
    return historique.filter((ligne) => {
      if (entite !== 'tout' && ligne.entity !== entite) return false
      if (!terme) return true
      return (
        (ligne.action ?? '').toLowerCase().includes(terme) ||
        (ligne.authorLabel ?? '').toLowerCase().includes(terme) ||
        (ligne.note ?? '').toLowerCase().includes(terme) ||
        (ligne.field ?? '').toLowerCase().includes(terme)
      )
    })
  }, [historique, entite, recherche])

  if (!administration) {
    return (
      <EmptyState icon={<History className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer l'historique.
      </EmptyState>
    )
  }

  /**
   * Contenu du rapport. Les deux vues n'ont pas les mêmes colonnes : on exporte
   * ce que l'écran montre, filtre et recherche compris.
   */
  const rapport = () => {
    if (vue === 'anomalies') {
      return {
        titre: 'Anomalies signalées',
        nomFichier: `anomalies-${new Date().toISOString().slice(0, 10)}`,
        etablissement: administration.parametres?.etablissement,
        meta: [`${anomalies.length} anomalie${anomalies.length > 1 ? 's' : ''}`],
        colonnes: [
          { key: 'at', label: 'Date', value: (row) => formatStamp(row.at) },
          { key: 'titre', label: 'Anomalie' },
          { key: 'kind', label: 'Type', value: (row) => row.kind.replaceAll('_', ' ') },
          { key: 'severity', label: 'Gravité' },
          { key: 'detail', label: 'Détail' },
        ],
        lignes: anomalies,
      }
    }

    return {
      titre: 'Historique des modifications',
      nomFichier: `historique-${new Date().toISOString().slice(0, 10)}`,
      etablissement: administration.parametres?.etablissement,
      meta: [
        entite !== 'tout' ? `Objet : ${ENTITES.find((e) => e.value === entite)?.label}` : null,
        recherche.trim() ? `Recherche : « ${recherche.trim()} »` : null,
        `${lignes.length} entrée${lignes.length > 1 ? 's' : ''}`,
        'Journal en ajout seul : aucune entrée ne peut être modifiée ni supprimée.',
      ].filter(Boolean),
      colonnes: [
        { key: 'at', label: 'Date', value: (row) => formatStamp(row.at) },
        { key: 'entity', label: 'Objet' },
        { key: 'action', label: 'Action', value: (row) => row.action.replaceAll('_', ' ') },
        { key: 'authorLabel', label: 'Auteur' },
        { key: 'field', label: 'Champ' },
        { key: 'before', label: 'Ancienne valeur', value: (row) => formatValeur(row.before) },
        { key: 'after', label: 'Nouvelle valeur', value: (row) => formatValeur(row.after) },
        { key: 'note', label: 'Précision' },
      ],
      lignes,
    }
  }

  return (
    <>
      <PageHeader
        title="Historique"
        subtitle="Toutes les modifications, avec leur auteur et leur date."
        actions={
          <BoutonExport rapport={rapport} desactive={lignes.length === 0} />
        }
      >
        <Segmented
          value={vue}
          onChange={setVue}
          options={[
            { value: 'historique', label: 'Historique', count: historique.length },
            { value: 'anomalies', label: 'Anomalies', count: anomalies.length },
          ]}
        />
      </PageHeader>

      {vue === 'historique' ? (
        <>
          <Banner tone="info" className="mb-4" title="Journal en ajout seul" icon={<Lock className="size-[18px]" />}>
            Une entrée d'historique ne peut être ni modifiée ni supprimée, y compris par un
            administrateur. La base refuse toute écriture autre qu'un ajout.
          </Banner>

          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Segmented value={entite} onChange={setEntite} options={ENTITES} size="sm" className="min-w-0" />
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
                aria-hidden
              />
              <Input
                value={recherche}
                onChange={(event) => setRecherche(event.target.value)}
                placeholder="Rechercher une action, un auteur, un motif"
                className="h-10 pl-10"
                maxLength={60}
              />
            </div>
          </div>

          <Card>
            <CardHeader
              title={`${lignes.length} entrée${lignes.length > 1 ? 's' : ''}`}
              subtitle="Les 300 dernières modifications."
              icon={<History className="size-4" aria-hidden />}
            />
            <DataTable
              className="px-2 py-1 sm:px-3"
              columns={[
                {
                  key: 'at',
                  label: 'Date',
                  render: (row) => (
                    <span className="whitespace-nowrap font-mono text-[12px]">{formatStamp(row.at)}</span>
                  ),
                },
                {
                  key: 'action',
                  label: 'Action',
                  strong: true,
                  render: (row) => (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {row.action.replaceAll('_', ' ')}
                      {row.flagged && (
                        <Badge tone="warn">
                          <AlertTriangle className="size-3" aria-hidden />
                          signalé
                        </Badge>
                      )}
                    </span>
                  ),
                },
                {
                  key: 'entity',
                  label: 'Objet',
                  render: (row) => <Badge tone="neutral">{row.entity}</Badge>,
                },
                {
                  key: 'authorLabel',
                  label: 'Auteur',
                  render: (row) => row.authorLabel ?? <span className="text-faint">—</span>,
                },
                {
                  key: 'field',
                  label: 'Champ',
                  hideOnTablet: true,
                  render: (row) =>
                    row.field ? (
                      <span className="font-mono text-[12px]">{row.field}</span>
                    ) : (
                      <span className="text-faint">—</span>
                    ),
                },
                {
                  key: 'valeurs',
                  label: 'Avant → après',
                  hideOnTablet: true,
                  render: (row) =>
                    row.before === null && row.after === null ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <span className="text-[12px]">
                        <span className="text-bad">{formatValeur(row.before)}</span>
                        <span className="mx-1 text-faint">→</span>
                        <span className="text-ok">{formatValeur(row.after)}</span>
                      </span>
                    ),
                },
                {
                  key: 'note',
                  label: 'Précision',
                  render: (row) =>
                    row.note ? (
                      <span className="text-[12px] text-faint">{row.note}</span>
                    ) : (
                      <span className="text-faint">—</span>
                    ),
                },
              ]}
              rows={lignes}
              empty="Aucune entrée"
              emptyIcon={<History className="size-5" />}
              dense
            />
          </Card>
        </>
      ) : (
        <>
          <Banner tone="warn" className="mb-4" title="Ce que l'application surveille">
            Départs saisis après coup, écarts entre scans et liste cochée, deux comptes sur un même
            appareil, codes QR refusés, séances sans taux applicable, essais bloqués pour trop
            d'erreurs.
          </Banner>

          <Card>
            <CardHeader
              title={`${anomalies.length} anomalie${anomalies.length > 1 ? 's' : ''}`}
              icon={<AlertTriangle className="size-4" aria-hidden />}
            />
            <DataTable
              className="px-2 py-1 sm:px-3"
              columns={[
                {
                  key: 'at',
                  label: 'Date',
                  render: (row) => (
                    <span className="whitespace-nowrap font-mono text-[12px]">{formatStamp(row.at)}</span>
                  ),
                },
                { key: 'titre', label: 'Anomalie', strong: true },
                {
                  key: 'kind',
                  label: 'Type',
                  render: (row) => <Badge tone="neutral">{row.kind.replaceAll('_', ' ')}</Badge>,
                },
                {
                  key: 'severity',
                  label: 'Gravité',
                  render: (row) => (
                    <Badge
                      tone={
                        row.severity === 'grave' ? 'bad' : row.severity === 'attention' ? 'warn' : 'neutral'
                      }
                    >
                      {row.severity}
                    </Badge>
                  ),
                },
                {
                  key: 'detail',
                  label: 'Détail',
                  render: (row) => (
                    <span className="text-[12px] text-faint">{row.detail ?? '—'}</span>
                  ),
                },
              ]}
              rows={anomalies}
              empty="Aucune anomalie signalée"
              emptyIcon={<AlertTriangle className="size-5" />}
              dense
            />
          </Card>
        </>
      )}
    </>
  )
}

/** Les valeurs sensibles arrivent déjà masquées par `audit.js`. */
function formatValeur(valeur) {
  if (valeur === null || valeur === undefined) return '—'
  if (typeof valeur === 'object') return JSON.stringify(valeur).slice(0, 80)
  return String(valeur).slice(0, 80)
}
