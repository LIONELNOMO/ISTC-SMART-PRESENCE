import { useMemo, useState } from 'react'
import { CalendarRange, Search, Send, Trash2, UserCheck } from 'lucide-react'

import { useProjection } from '../../lib/session.jsx'
import { ficheEnseignant } from '../../lib/serveur.js'
import { enqueue, synchroniser } from '../../lib/sync.js'
import { formatHours, libelleMatiere } from '../../lib/utils.js'
import { formatDate } from '../../lib/dates.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { Badge, Button } from '../../components/ui/primitives.jsx'
import { Banner, Card, CardBody, CardHeader, EmptyState } from '../../components/ui/surfaces.jsx'
import { Field, Input } from '../../components/ui/forms.jsx'
import { DataTable } from '../../components/ui/data.jsx'
import { useToast } from '../../components/ui/overlays.jsx'

/**
 * Création des fiches de paie (rôle GRH du secrétariat, §7).
 *
 * La secrétaire choisit un enseignant et une PÉRIODE (début → fin), prévisualise
 * les heures faites sur cette période (celles qui ne sont pas déjà sur une
 * fiche), puis crée la fiche. L'administration la paiera ensuite. Aucun montant
 * n'apparaît ici (§13.10) : la secrétaire ne voit que les heures.
 */
export function SecretariatRH() {
  const secretariat = useProjection('secretariat')
  const toast = useToast()

  const [recherche, setRecherche] = useState('')
  const [choisi, setChoisi] = useState(null)
  const [debut, setDebut] = useState('')
  const [fin, setFin] = useState('')
  const [apercu, setApercu] = useState(null) // heures calculées pour la période
  const [chargement, setChargement] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const [annulation, setAnnulation] = useState(null)

  const enseignants = secretariat?.enseignants ?? []
  const fiches = secretariat?.fiches ?? []

  const filtres = useMemo(() => {
    const terme = recherche.trim().toLowerCase()
    if (!terme) return enseignants
    return enseignants.filter((e) => e.nom.toLowerCase().includes(terme))
  }, [enseignants, recherche])

  const fichesDuChoisi = useMemo(
    () => fiches.filter((f) => f.teacherId === choisi?.id),
    [fiches, choisi],
  )

  if (!secretariat) {
    return (
      <EmptyState icon={<UserCheck className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer la liste des enseignants.
      </EmptyState>
    )
  }

  const choisir = (enseignant) => {
    setChoisi(enseignant)
    setApercu(null)
    setDebut('')
    setFin('')
  }

  const calculer = async () => {
    if (!choisi || !debut || !fin) return
    if (debut > fin) {
      toast.erreur('Période', 'La date de début doit précéder la date de fin.')
      return
    }
    setChargement(true)
    setApercu(null)
    const reponse = await ficheEnseignant(null, choisi.id, debut, fin)
    setChargement(false)
    if (reponse.error) {
      toast.erreur('Calcul impossible', reponse.error.message)
      return
    }
    setApercu(reponse.data)
  }

  const creer = async () => {
    if (!choisi || !apercu) return
    setEnvoi(true)
    const reponse = await enqueue(
      'secretariat.creer_fiche',
      { teacherId: choisi.id, debut, fin },
      { labelPourUtilisateur: `Fiche de paie — ${choisi.nom}` },
    )
    setEnvoi(false)
    if (!reponse.ok && !reponse.enAttente) {
      toast.erreur('Création refusée', reponse.error?.message)
      return
    }
    toast.succes('Fiche de paie créée', "L'administration pourra la régler.")
    setApercu(null)
    setDebut('')
    setFin('')
    await synchroniser({ silencieux: true })
  }

  const annuler = async (fiche) => {
    setAnnulation(fiche.id)
    const reponse = await enqueue(
      'secretariat.annuler_fiche',
      { ficheId: fiche.id },
      { labelPourUtilisateur: `Annulation fiche — ${fiche.enseignant}` },
    )
    setAnnulation(null)
    if (!reponse.ok && !reponse.enAttente) {
      toast.erreur('Annulation refusée', reponse.error?.message)
      return
    }
    toast.succes('Fiche annulée', 'Les séances redeviennent disponibles.')
    await synchroniser({ silencieux: true })
  }

  const totalHeures = apercu?.totalHeures ?? 0
  const lignes = (apercu?.parMatiere ?? []).map((m, i) => ({ ...m, id: `${m.matiereId}-${i}` }))

  return (
    <>
      <PageHeader
        title="Création des fiches de paie"
        subtitle="Choisissez un enseignant, définissez la période, puis créez la fiche. L'administration la paiera."
      />

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Colonne gauche : recherche + liste */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="Enseignants"
              subtitle={`${enseignants.length} au total`}
              icon={<UserCheck className="size-4" aria-hidden />}
            />
            <CardBody className="space-y-3">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
                  aria-hidden
                />
                <Input
                  value={recherche}
                  onChange={(event) => setRecherche(event.target.value)}
                  placeholder="Rechercher un enseignant"
                  className="pl-10"
                  maxLength={40}
                />
              </div>

              <ul className="divide-y divide-line">
                {filtres.map((enseignant) => (
                  <li key={enseignant.id}>
                    <button
                      type="button"
                      onClick={() => choisir(enseignant)}
                      className={`w-full px-1 py-3 text-left text-sm transition-colors hover:bg-surface-2 ${
                        choisi?.id === enseignant.id ? 'font-semibold text-accent-text' : 'text-ink'
                      }`}
                    >
                      {enseignant.nom}
                      <span className="mt-0.5 block text-[12px] font-normal text-faint">
                        {enseignant.matieres.map((m) => libelleMatiere(m.nom, m.nomEn)).join(' · ') ||
                          'Aucune matière'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              {filtres.length === 0 && (
                <p className="py-6 text-center text-[13px] text-faint">Aucun enseignant trouvé.</p>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Colonne droite : période + aperçu + création */}
        <div className="space-y-4 lg:col-span-3">
          {!choisi ? (
            <Card>
              <CardBody>
                <EmptyState icon={<CalendarRange className="size-5" />} title="Sélectionnez un enseignant">
                  Choisissez un enseignant, puis définissez la période de paie.
                </EmptyState>
              </CardBody>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader title={choisi.nom} subtitle="Période de paie" />
                <CardBody className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Du" required htmlFor="p-debut">
                      <Input
                        id="p-debut"
                        type="date"
                        value={debut}
                        onChange={(e) => setDebut(e.target.value)}
                      />
                    </Field>
                    <Field label="Au" required htmlFor="p-fin">
                      <Input id="p-fin" type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
                    </Field>
                  </div>
                  <Button onClick={calculer} loading={chargement} disabled={!debut || !fin}>
                    <CalendarRange className="size-4" aria-hidden />
                    Calculer les heures
                  </Button>
                </CardBody>
              </Card>

              {apercu && (
                <Card>
                  <CardHeader
                    title={`Heures — ${apercu.periode}`}
                    subtitle={`${formatHours(totalHeures)} → payées ${formatHours(apercu?.heuresPayees ?? Math.floor(totalHeures))} · ${apercu.totalSeances} séance${apercu.totalSeances > 1 ? 's' : ''}`}
                    actions={
                      <Button onClick={creer} loading={envoi} disabled={apercu.totalSeances === 0}>
                        <Send className="size-4" aria-hidden />
                        Créer la fiche
                      </Button>
                    }
                  />
                  <CardBody className="space-y-3">
                    {apercu.totalSeances === 0 ? (
                      <Banner tone="warn">
                        Aucune heure payable sur cette période : aucune séance terminée, ou toutes
                        sont déjà sur une autre fiche.
                      </Banner>
                    ) : (
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
                        rows={lignes}
                        empty="Aucune heure"
                      />
                    )}
                    <Banner tone="info">
                      Les montants n'apparaissent pas ici : c'est l'administration qui applique les
                      taux et règle la fiche.
                    </Banner>
                  </CardBody>
                </Card>
              )}

              {fichesDuChoisi.length > 0 && (
                <Card>
                  <CardHeader title="Fiches de cet enseignant" subtitle="Créées récemment" />
                  <CardBody>
                    <ul className="divide-y divide-line">
                      {fichesDuChoisi.map((f) => (
                        <li key={f.id} className="flex items-center justify-between gap-3 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">{f.periode}</p>
                            <p className="text-[12px] text-faint">
                              {formatHours(f.totalHeures)} · créée le {formatDate(f.creeeLe)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge tone={f.statut === 'payee' ? 'ok' : 'warn'}>
                              {f.statut === 'payee' ? 'Payée' : 'En attente'}
                            </Badge>
                            {f.statut === 'en_attente' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => annuler(f)}
                                loading={annulation === f.id}
                              >
                                <Trash2 className="size-4" aria-hidden />
                                Annuler
                              </Button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
