import { useEffect, useMemo, useState } from 'react'
import { LogIn, LogOut, QrCode, Search, UserCheck } from 'lucide-react'

import { useProjection, useSession } from '../../lib/session.jsx'
import { enqueue, synchroniser } from '../../lib/sync.js'
import { formatTime } from '../../lib/dates.js'
import { libelleMatiere } from '../../lib/utils.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { PointageQr } from '../../components/qr/PointageQr.jsx'
import { Badge, Button, CodeDisplay } from '../../components/ui/primitives.jsx'
import { Banner, Card, CardBody, CardHeader, EmptyState } from '../../components/ui/surfaces.jsx'
import { Field, Input, Select } from '../../components/ui/forms.jsx'
import { Modal, useToast } from '../../components/ui/overlays.jsx'
import { StatutSeance } from '../../components/app/SessionBits.jsx'

/**
 * Pointage au secrétariat (§4, §10).
 *
 * Deux voies, au choix : l'enseignant scanne le code affiché ici, ou la
 * secrétaire pointe elle-même depuis sa liste. Dans les deux cas, l'heure
 * retenue est celle de ce poste.
 *
 * Cet écran fonctionne sans réseau : les pointages partent dans la file d'attente
 * et la notification aux étudiants sera envoyée à la synchronisation (§9).
 */
export function SecretariatPointage() {
  const secretariat = useProjection('secretariat')
  const { enLigne } = useSession()
  const toast = useToast()

  const [recherche, setRecherche] = useState('')
  const [arrivee, setArrivee] = useState(null) // enseignant choisi pour une arrivée
  const [codeRemis, setCodeRemis] = useState(null)
  const [occupe, setOccupe] = useState(false)

  const enseignants = secretariat?.enseignants ?? []
  const seances = secretariat?.seancesDuJour ?? []

  const parEnseignant = useMemo(() => {
    const map = new Map()
    for (const seance of seances) {
      if (seance.status === 'en_cours') map.set(seance.teacherId, seance)
    }
    return map
  }, [seances])

  const filtres = useMemo(() => {
    const terme = recherche.trim().toLowerCase()
    if (!terme) return enseignants
    return enseignants.filter(
      (enseignant) =>
        enseignant.nom.toLowerCase().includes(terme) ||
        enseignant.matieres.some((m) => m.nom.toLowerCase().includes(terme)),
    )
  }, [enseignants, recherche])

  // Groupés par département (« Sans département » en dernier).
  const groupes = useMemo(() => {
    const map = new Map()
    for (const e of filtres) {
      const cle = e.departement ?? 'Sans département'
      if (!map.has(cle)) map.set(cle, [])
      map.get(cle).push(e)
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === 'Sans département') return 1
      if (b[0] === 'Sans département') return -1
      return a[0].localeCompare(b[0])
    })
  }, [filtres])

  if (!secretariat) {
    return (
      <EmptyState icon={<UserCheck className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer la liste des enseignants.
      </EmptyState>
    )
  }

  const pointerDepart = async (seance) => {
    setOccupe(true)
    const reponse = await enqueue(
      'secretariat.depart',
      { sessionId: seance.id },
      { labelPourUtilisateur: `Départ — ${seance.enseignant}` },
    )
    setOccupe(false)
    if (!reponse.ok && !reponse.enAttente) {
      toast.erreur('Pointage refusé', reponse.error?.message)
      return
    }
    toast.succes(
      'Départ enregistré',
      reponse.enAttente ? 'Il partira au retour du réseau.' : `${seance.enseignant} — ${formatTime(new Date().toISOString())}`,
    )
    await synchroniser({ silencieux: true })
  }

  return (
    <>
      <PageHeader
        title="Pointage des enseignants"
        subtitle="L'heure enregistrée est celle de ce poste, à la minute près."
      />

      {!enLigne && (
        <Banner tone="info" className="mb-4" title="Hors ligne">
          Les pointages sont enregistrés sur ce poste et partiront au retour du réseau. La
          notification « le professeur est en route » sera envoyée à ce moment-là.
        </Banner>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="Code QR de pointage"
              subtitle="À montrer à l'enseignant qui veut scanner."
              icon={<QrCode className="size-4" aria-hidden />}
            />
            <CardBody>
              <PointageQr station={secretariat.station} />
            </CardBody>
          </Card>

          {codeRemis && (
            <Card className="mt-4 border-ok/35">
              <CardHeader
                title="Code de séance à remettre"
                subtitle={codeRemis.enseignant}
              />
              <CardBody className="space-y-3">
                <CodeDisplay code={codeRemis.code} />
                <p className="text-center text-[12px] leading-relaxed text-faint">
                  Lisez ce code à l'enseignant. Il en a besoin pour valider son relevé de présences.
                  {!codeRemis.notifiee &&
                    ' La notification aux étudiants partira à la prochaine synchronisation.'}
                </p>
                <Button variant="ghost" className="w-full" onClick={() => setCodeRemis(null)}>
                  J'ai remis le code
                </Button>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="lg:col-span-3">
          <Card>
            <CardHeader
              title="Enseignants"
              subtitle={`${enseignants.length} enseignant${enseignants.length > 1 ? 's' : ''} · ${parEnseignant.size} en cours`}
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
                  placeholder="Rechercher un enseignant ou une matière"
                  className="pl-10"
                  maxLength={40}
                />
              </div>

              {groupes.map(([departement, liste]) => (
                <div key={departement}>
                  <p className="mt-1 mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-text">
                    {departement}
                  </p>
                  <ul className="divide-y divide-line">
                    {liste.map((enseignant) => {
                      const seance = parEnseignant.get(enseignant.id)
                      return (
                        <li key={enseignant.id} className="py-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-ink">{enseignant.nom}</p>
                                {seance && <StatutSeance statut="en_cours" />}
                              </div>
                              <p className="mt-0.5 text-[12px] text-faint">
                                {seance
                                  ? `${libelleMatiere(seance.matiere, seance.matiereEn)} · arrivée à ${formatTime(seance.arrivalAt)}`
                                  : enseignant.matieres
                                      .map((m) => libelleMatiere(m.nom, m.nomEn))
                                      .join(' · ') || 'Aucune matière affectée'}
                              </p>
                            </div>

                            <div className="flex shrink-0 gap-2">
                              {seance ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  loading={occupe}
                                  onClick={() => pointerDepart(seance)}
                                >
                                  <LogOut className="size-4" aria-hidden />
                                  Pointer le départ
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  loading={occupe}
                                  disabled={enseignant.matieres.length === 0}
                                  onClick={() => setArrivee(enseignant)}
                                >
                                  <LogIn className="size-4" aria-hidden />
                                  Pointer l'arrivée
                                </Button>
                              )}
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}

              {filtres.length === 0 && (
                <p className="py-6 text-center text-[13px] text-faint">Aucun enseignant trouvé.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <ModaleArrivee
        enseignant={arrivee}
        matieresPointage={secretariat?.matieresPointage ?? []}
        onClose={() => setArrivee(null)}
        onPointe={(data, enseignant) => {
          setArrivee(null)
          setCodeRemis({ code: data.code, enseignant: enseignant.nom, notifiee: data.notifiee })
          toast.succes('Arrivée enregistrée', `Code de séance : ${data.code}`)
        }}
      />
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Choix de la matière puis pointage d'arrivée
 * ------------------------------------------------------------------ */

function ModaleArrivee({ enseignant, matieresPointage = [], onClose, onPointe }) {
  const [matiereId, setMatiereId] = useState('')
  const [matiereLabel, setMatiereLabel] = useState('')
  const [rechercheMat, setRechercheMat] = useState('')
  const [niveau, setNiveau] = useState('')
  const [finPrevue, setFinPrevue] = useState('')
  // §4 : section de la séance. Le choix n'apparaît que si la filière de la
  // matière propose une section anglophone.
  const [section, setSection] = useState('francophone')
  const [matiereAnglo, setMatiereAnglo] = useState(false)
  const [erreur, setErreur] = useState(null)
  const [envoi, setEnvoi] = useState(false)

  // Matières DÉJÀ AFFECTÉES à l'enseignant : accès rapide au clic.
  const affectees = enseignant?.matieres ?? []

  // Les matières du DÉPARTEMENT de l'enseignant (le secrétariat cherche dedans).
  const matieresDuDept = useMemo(
    () => matieresPointage.filter((m) => m.departementId === enseignant?.departementId),
    [matieresPointage, enseignant],
  )

  const resultats = useMemo(() => {
    const terme = rechercheMat.trim().toLowerCase()
    if (!terme) return []
    return matieresDuDept
      .filter(
        (m) =>
          m.nom.toLowerCase().includes(terme) ||
          (m.nomEn && m.nomEn.toLowerCase().includes(terme)),
      )
      .slice(0, 15)
  }, [matieresDuDept, rechercheMat])

  // À la sélection : on fixe la matière et on pré-remplit le niveau (modifiable).
  const choisirMatiere = (m) => {
    setMatiereId(m.id)
    setMatiereLabel(`${m.nom} — ${m.classe}`)
    setRechercheMat('')
    if (m.niveau) setNiveau(String(m.niveau))
    setMatiereAnglo(Boolean(m.sectionAnglophone))
    if (!m.sectionAnglophone) setSection('francophone')
    setErreur(null)
  }

  const effacerMatiere = () => {
    setMatiereId('')
    setMatiereLabel('')
    setRechercheMat('')
    setMatiereAnglo(false)
    setSection('francophone')
  }

  // Changement d'enseignant : on repart d'un formulaire vierge.
  useEffect(() => {
    setMatiereId('')
    setMatiereLabel('')
    setRechercheMat('')
    setNiveau('')
    setFinPrevue('')
    setSection('francophone')
    setMatiereAnglo(false)
    setErreur(null)
  }, [enseignant?.id])

  const pointer = async () => {
    setErreur(null)
    if (!matiereId) {
      setErreur('Choisissez la matière enseignée.')
      return
    }
    if (!niveau) {
      setErreur('Choisissez le niveau du cours.')
      return
    }
    if (!finPrevue) {
      setErreur("Indiquez l'heure de fin prévue du cours.")
      return
    }
    setEnvoi(true)
    const reponse = await enqueue(
      'secretariat.arrivee',
      {
        teacherId: enseignant.id,
        matiereId,
        niveau: Number(niveau),
        finPrevue,
        section: matiereAnglo ? section : 'francophone',
      },
      { labelPourUtilisateur: `Arrivée — ${enseignant.nom}` },
    )
    setEnvoi(false)

    if (reponse.enAttente) {
      setErreur(
        "Hors ligne, le code de séance est produit par le serveur : il s'affichera à la synchronisation. " +
          "Vous pouvez tout de même laisser l'enseignant faire son relevé, il saisira le code ensuite.",
      )
      return
    }
    if (!reponse.ok) {
      setErreur(reponse.error?.message ?? 'Pointage refusé.')
      return
    }
    setMatiereId('')
    setMatiereLabel('')
    setRechercheMat('')
    setNiveau('')
    setFinPrevue('')
    await synchroniser({ silencieux: true })
    onPointe(reponse.data, enseignant)
  }

  return (
    <Modal
      open={Boolean(enseignant)}
      onClose={onClose}
      title="Pointer une arrivée"
      subtitle={enseignant?.nom}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={pointer} loading={envoi}>
            <LogIn className="size-4" aria-hidden />
            Pointer l'arrivée
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Matière enseignée"
          required
          htmlFor="matiere-arrivee"
          hint={
            enseignant?.departement
              ? `Recherche dans les matières du département ${enseignant.departement}.`
              : 'Recherche dans les matières.'
          }
        >
          {matiereId ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
              <span className="min-w-0 truncate text-sm text-ink">{matiereLabel}</span>
              <Button size="sm" variant="ghost" onClick={effacerMatiere}>
                Changer
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {affectees.length > 0 && (
                <div className="rounded-xl border border-line bg-surface-2 p-2.5">
                  <p className="mb-1.5 text-[12px] font-medium text-soft">
                    Matières affectées — un clic suffit
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {affectees.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => choisirMatiere(m)}
                        className="rounded-full border border-line bg-surface-1 px-3 py-1.5 text-[13px] text-ink transition-colors hover:border-accent hover:text-accent-text"
                      >
                        {m.nom}
                        <span className="ml-1 text-[11px] text-faint">· {m.classe}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[12px] text-faint">ou rechercher une autre matière :</p>
                </div>
              )}
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
                  aria-hidden
                />
                <Input
                  id="matiere-arrivee"
                  value={rechercheMat}
                  onChange={(e) => setRechercheMat(e.target.value)}
                  placeholder="Rechercher une matière…"
                  className="pl-10"
                  maxLength={60}
                  autoComplete="off"
                />
              {rechercheMat.trim() !== '' && (
                <ul className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-line bg-surface-2 shadow-card">
                  {resultats.length === 0 ? (
                    <li className="px-3 py-2.5 text-[13px] text-faint">Aucune matière trouvée.</li>
                  ) : (
                    resultats.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => choisirMatiere(m)}
                          className="flex w-full flex-col items-start px-3 py-2 text-left transition-colors hover:bg-surface-1"
                        >
                          <span className="text-sm text-ink">
                            {m.nom}
                            {m.nomEn && m.nomEn !== m.nom && (
                              <span className="text-faint"> · {m.nomEn}</span>
                            )}
                          </span>
                          <span className="text-[11px] text-faint">{m.classe}</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
              </div>
            </div>
          )}
        </Field>

        <Field
          label="Niveau"
          required
          htmlFor="niveau-arrivee"
          hint="Pré-rempli d'après la classe. C'est le niveau qui détermine la paye : corrigez-le si besoin."
        >
          <Select
            id="niveau-arrivee"
            value={niveau}
            onChange={(event) => setNiveau(event.target.value)}
          >
            <option value="">Choisir…</option>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                Niveau {n}
              </option>
            ))}
          </Select>
        </Field>

        {matiereAnglo && (
          <Field
            label="Section"
            required
            htmlFor="section-arrivee"
            hint="Cette filière a une section anglophone : les mêmes cours, affichés sous leur nom anglais."
          >
            <Select
              id="section-arrivee"
              value={section}
              onChange={(event) => setSection(event.target.value)}
            >
              <option value="francophone">Francophone</option>
              <option value="anglophone">Anglophone</option>
            </Select>
          </Field>
        )}

        <Field
          label="Fin de cours prévue"
          required
          htmlFor="fin-prevue"
          hint="Au-delà de cette heure, le temps n'est pas payé. Finir avant ne pose pas de problème."
        >
          <Input
            id="fin-prevue"
            type="time"
            value={finPrevue}
            onChange={(event) => setFinPrevue(event.target.value)}
          />
        </Field>

        <div className="flex items-start gap-2 rounded-xl bg-surface-2 px-3.5 py-3">
          <Badge tone="brand">1 séance</Badge>
          <p className="text-[12px] leading-relaxed text-faint">
            Un enseignant n'a qu'une séance ouverte à la fois. Pour un second cours, pointez d'abord
            le départ du premier.
          </p>
        </div>

        {erreur && <Banner tone="warn">{erreur}</Banner>}
      </div>
    </Modal>
  )
}
