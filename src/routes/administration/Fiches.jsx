import { useMemo, useState } from 'react'
import { Coins, FileDown, Search, Wallet } from 'lucide-react'

import { useProjection } from '../../lib/session.jsx'
import { enqueue, synchroniser } from '../../lib/sync.js'
import { fichePdfEnseignant } from '../../lib/export.js'
import { formatHours, formatMoney, libelleMatiere } from '../../lib/utils.js'
import { formatLongDate, dayKey } from '../../lib/dates.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { Badge, Button } from '../../components/ui/primitives.jsx'
import { Banner, Card, CardBody, CardHeader, EmptyState } from '../../components/ui/surfaces.jsx'
import { Field, Input, Select } from '../../components/ui/forms.jsx'
import { DataTable } from '../../components/ui/data.jsx'
import { Modal, useToast } from '../../components/ui/overlays.jsx'

/**
 * Fiches de paie (administration, §7).
 *
 * Les fiches transmises par le secrétariat arrivent ici, avec le coût calculé
 * par niveau (taux en vigueur × heures). L'administration peut rechercher un
 * enseignant, filtrer par département, et imprimer la fiche de paie en PDF.
 */
const STATUTS = [
  { value: 'en_attente', label: 'En attente' },
  { value: 'payee', label: 'Payées' },
  { value: 'toutes', label: 'Toutes' },
]

export function AdminFiches() {
  const administration = useProjection('administration')
  const toast = useToast()

  const [recherche, setRecherche] = useState('')
  const [departement, setDepartement] = useState('')
  const [statutFiltre, setStatutFiltre] = useState('en_attente')
  const [tauxFiche, setTauxFiche] = useState(null) // fiche dont on règle les taux
  const [paiement, setPaiement] = useState(null) // id de la fiche en cours de paiement
  const [impots, setImpots] = useState({}) // ficheId -> taux d'impôt saisi (%)

  const fiches = administration?.fiches ?? []
  const monnaie = administration?.parametres?.monnaie ?? 'FCFA'
  const etablissement = administration?.parametres?.etablissement ?? 'Établissement'

  const departements = useMemo(
    () => [...new Set(fiches.map((f) => f.departement).filter(Boolean))].sort(),
    [fiches],
  )

  const filtrees = useMemo(() => {
    const terme = recherche.trim().toLowerCase()
    return fiches.filter((f) => {
      if (statutFiltre !== 'toutes' && f.statut !== statutFiltre) return false
      if (departement && f.departement !== departement) return false
      if (terme && !f.enseignant.toLowerCase().includes(terme)) return false
      return true
    })
  }, [fiches, recherche, departement, statutFiltre])

  if (!administration) {
    return (
      <EmptyState icon={<Wallet className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer les fiches.
      </EmptyState>
    )
  }

  const imprimer = (fiche) => {
    const logoUrl = `${window.location.origin}/marque/logo-istc.jpeg`
    const brut = fiche.montant ?? 0
    const payee = fiche.statut === 'payee'
    const taux = payee ? (fiche.tauxImpot ?? 0) : Number(impots[fiche.id] ?? 0) || 0
    const impot = payee ? (fiche.impot ?? 0) : Math.round((brut * taux) / 100)
    const net = payee ? (fiche.net ?? brut) : brut - impot
    const resultat = fichePdfEnseignant({
      enseignant: fiche.enseignant,
      etablissement,
      departement: fiche.departement ?? null,
      parMatiere: fiche.parMatiere ?? [],
      heuresPayees: fiche.heuresPayees ?? Math.floor(fiche.totalHeures ?? 0),
      logoUrl,
      periode: fiche.periode,
      avecMontants: true,
      monnaie,
      brut,
      tauxImpot: taux,
      impot,
      net,
    })
    if (!resultat.ok) toast.erreur('Impression', resultat.message)
  }

  const payer = async (fiche) => {
    if (fiche.montantIncomplet) {
      toast.erreur('Taux manquants', "Définissez d'abord les taux de toutes les matières.")
      return
    }
    const tauxImpot = Math.max(0, Math.min(100, Number(impots[fiche.id] ?? 0) || 0))
    setPaiement(fiche.id)
    const reponse = await enqueue(
      'admin.payer_fiche',
      { ficheId: fiche.id, tauxImpot },
      { labelPourUtilisateur: `Paiement — ${fiche.enseignant}` },
    )
    setPaiement(null)
    if (!reponse.ok && !reponse.enAttente) {
      toast.erreur('Paiement refusé', reponse.error?.message)
      return
    }
    toast.succes('Fiche payée', `${fiche.enseignant} — ${formatMoney(fiche.montant, monnaie)}`)
    await synchroniser({ silencieux: true })
  }

  return (
    <>
      <PageHeader
        title="Fiches de paie"
        subtitle="Créées par le secrétariat. Définissez les taux, puis marquez « payé » pour régler l'enseignant."
      />

      <Card className="mb-4">
        <CardBody className="grid gap-3 sm:grid-cols-3">
          <Field label="Rechercher un enseignant" htmlFor="rech">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
                aria-hidden
              />
              <Input
                id="rech"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Nom de l'enseignant"
                className="pl-10"
                maxLength={40}
              />
            </div>
          </Field>
          <Field label="Département" htmlFor="dep">
            <Select id="dep" value={departement} onChange={(e) => setDepartement(e.target.value)}>
              <option value="">Tous les départements</option>
              {departements.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Statut" htmlFor="stat">
            <Select id="stat" value={statutFiltre} onChange={(e) => setStatutFiltre(e.target.value)}>
              {STATUTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      {filtrees.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState icon={<Wallet className="size-5" />} title="Aucune fiche">
              Quand le secrétariat crée une fiche de paie sur une période, elle apparaît ici.
            </EmptyState>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          {filtrees.map((fiche) => {
            const payee = fiche.statut === 'payee'
            const brut = fiche.montant ?? 0
            const tauxImpot = payee ? (fiche.tauxImpot ?? 0) : Number(impots[fiche.id] ?? 0) || 0
            const impot = payee ? (fiche.impot ?? 0) : Math.round((brut * tauxImpot) / 100)
            const net = payee ? (fiche.net ?? brut) : brut - impot
            return (
              <Card key={fiche.id}>
                <CardHeader
                  title={fiche.enseignant}
                  subtitle={`${fiche.departement ?? 'Sans département'} · ${fiche.periode} · ${formatHours(fiche.totalHeures)}`}
                  actions={
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={payee ? 'ok' : 'warn'}>{payee ? 'Payée' : 'En attente'}</Badge>
                      {!payee && (
                        <Button size="sm" variant="secondary" onClick={() => setTauxFiche(fiche)}>
                          <Coins className="size-4" aria-hidden />
                          Définir les taux
                        </Button>
                      )}
                      {!payee && (
                        <Button
                          size="sm"
                          onClick={() => payer(fiche)}
                          loading={paiement === fiche.id}
                          disabled={fiche.montantIncomplet}
                        >
                          <Wallet className="size-4" aria-hidden />
                          Marquer payé
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => imprimer(fiche)}>
                        <FileDown className="size-4" aria-hidden />
                        Imprimer
                      </Button>
                    </div>
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

                  {/* Résumé de paie. Les minutes ne comptent pas : heures payées = total arrondi. */}
                  <div className="space-y-2 rounded-xl bg-surface-2 px-4 py-3 text-sm">
                    <LigneResume
                      label="Heures payées"
                      valeur={`${formatHours(fiche.heuresPayees)} (minutes non comptées)`}
                    />
                    <LigneResume label="Brut" valeur={formatMoney(brut, monnaie)} />
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-soft">Taux d'impôt</span>
                      {payee ? (
                        <span className="font-medium text-ink">{tauxImpot} %</span>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            inputMode="numeric"
                            value={impots[fiche.id] ?? ''}
                            placeholder="0"
                            onChange={(e) => setImpots((v) => ({ ...v, [fiche.id]: e.target.value }))}
                            className="h-9 w-20 text-right"
                          />
                          <span className="text-soft">%</span>
                        </div>
                      )}
                    </div>
                    <LigneResume label="Impôt" valeur={`− ${formatMoney(impot, monnaie)}`} />
                    <div className="flex items-center justify-between border-t border-line pt-2">
                      <span className="font-medium text-ink">{payee ? 'Net payé' : 'Net à payer'}</span>
                      <span className="text-lg font-bold text-ink">{formatMoney(net, monnaie)}</span>
                    </div>
                  </div>

                  {payee ? (
                    <p className="text-[12px] text-faint">
                      Payée le {formatLongDate(fiche.payeeLe)} par {fiche.payeePar || '—'}.
                    </p>
                  ) : (
                    fiche.montantIncomplet && (
                      <Banner tone="warn">
                        Certaines matières n'ont pas de taux défini : le total est partiel. Définissez
                        les taux avant de marquer la fiche payée.
                      </Banner>
                    )
                  )}
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}

      <ModaleTaux
        fiche={tauxFiche}
        monnaie={monnaie}
        onClose={() => setTauxFiche(null)}
        onFait={() => {
          setTauxFiche(null)
          toast.succes('Taux enregistrés', 'La paie a été recalculée.')
        }}
        onErreur={(m) => toast.erreur('Taux', m)}
      />
    </>
  )
}

/**
 * Définition des taux horaires par niveau, depuis une fiche.
 *
 * Le taux est propre à l'enseignant de la fiche (portée « enseignant +
 * niveau ») : deux enseignants peuvent avoir des contrats différents pour le
 * même niveau. Date d'effet : aujourd'hui. Prioritaire sur le taux de niveau.
 */
function LigneResume({ label, valeur }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-soft">{label}</span>
      <span className="font-medium text-ink">{valeur}</span>
    </div>
  )
}

function ModaleTaux({ fiche, monnaie, onClose, onFait, onErreur }) {
  const [valeurs, setValeurs] = useState({})
  const [envoi, setEnvoi] = useState(false)

  // Réinitialisation à l'ouverture, pré-rempli avec le taux actuel.
  const [cle, setCle] = useState(null)
  if (fiche && cle !== fiche.id) {
    setCle(fiche.id)
    const init = {}
    for (const n of fiche.parNiveau ?? []) {
      init[n.niveau] = n.taux == null ? '' : String(n.taux)
    }
    setValeurs(init)
  }

  const niveaux = fiche?.parNiveau ?? []

  const enregistrer = async () => {
    setEnvoi(true)
    // Date d'effet = aujourd'hui : c'est le taux courant. La fiche de paie se
    // calcule au taux du jour, donc ce nouveau taux s'applique aussitôt.
    const jour = dayKey()
    let aucun = true
    for (const n of niveaux) {
      const brut = (valeurs[n.niveau] ?? '').trim()
      if (brut === '') continue
      const montant = Number(brut)
      if (!Number.isFinite(montant) || montant < 0) {
        setEnvoi(false)
        onErreur(`Taux invalide pour le niveau ${n.niveau}.`)
        return
      }
      // Inchangé : on n'enregistre pas.
      if (n.taux != null && Number(n.taux) === montant) continue
      aucun = false
      // Taux simple du niveau (le même pour tous les enseignants), effet du jour.
      const reponse = await enqueue(
        'admin.taux',
        {
          niveau: n.niveau,
          montant,
          dateEffet: jour,
        },
        { labelPourUtilisateur: `Taux niveau ${n.niveau}` },
      )
      if (!reponse.ok && !reponse.enAttente) {
        setEnvoi(false)
        onErreur(reponse.error?.message ?? 'Enregistrement refusé.')
        return
      }
    }
    setEnvoi(false)
    if (aucun) {
      onErreur('Aucun taux à enregistrer.')
      return
    }
    await synchroniser({ silencieux: true })
    onFait()
  }

  return (
    <Modal
      open={Boolean(fiche)}
      onClose={onClose}
      title="Définir les taux par niveau"
      subtitle={fiche?.enseignant}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={enregistrer} loading={envoi}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Banner tone="info">
          Le taux est défini <strong>par niveau</strong>, le même pour tous les enseignants. La
          fiche utilise le <strong>taux courant</strong> : le montant se met à jour aussitôt.
          Laissez vide un niveau pour ne pas le changer.
        </Banner>
        {niveaux.map((n) => (
          <Field key={n.niveau} label={`Niveau ${n.niveau} — taux horaire (${monnaie})`} htmlFor={`t-${n.niveau}`}>
            <Input
              id={`t-${n.niveau}`}
              type="number"
              min="0"
              inputMode="numeric"
              value={valeurs[n.niveau] ?? ''}
              onChange={(e) => setValeurs((v) => ({ ...v, [n.niveau]: e.target.value }))}
              placeholder={n.taux == null ? 'Aucun taux défini' : String(n.taux)}
            />
          </Field>
        ))}
      </div>
    </Modal>
  )
}
