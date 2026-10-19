import { useMemo, useState } from 'react'
import { CalendarPlus, CheckCircle2, Search, X } from 'lucide-react'

import { useProjection } from '../../lib/session.jsx'
import { enqueue, synchroniser } from '../../lib/sync.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { Button } from '../../components/ui/primitives.jsx'
import { Banner, Card, CardBody, CardHeader, EmptyState } from '../../components/ui/surfaces.jsx'
import { Field, Input, Select } from '../../components/ui/forms.jsx'
import { useToast } from '../../components/ui/overlays.jsx'

/**
 * Saisie d'une séance pour un jour passé (§13.5).
 *
 * Sert aux cas où le pointage n'a pas pu se faire sur le moment : coupure de
 * courant, secrétaire absente… On enregistre que l'enseignant a fait cours ce
 * jour-là et ses heures. AUCUNE présence d'étudiant n'est générée.
 *
 * Antidatage encadré : réservé au secrétariat, limité à 30 jours, refusé dans
 * le futur. Le serveur revérifie tout.
 */
export function SecretariatSeanceAnterieure() {
  const secretariat = useProjection('secretariat')
  const toast = useToast()

  const [teacherId, setTeacherId] = useState('')
  const [recherche, setRecherche] = useState('')
  const [matiereId, setMatiereId] = useState('')
  const [matiereLabel, setMatiereLabel] = useState('')
  const [rechercheMat, setRechercheMat] = useState('')
  const [niveau, setNiveau] = useState('')
  // §4 : section de la séance (choix affiché seulement si la filière en a une).
  const [section, setSection] = useState('francophone')
  const [matiereAnglo, setMatiereAnglo] = useState(false)
  const [jour, setJour] = useState('')
  const [heureArrivee, setHeureArrivee] = useState('')
  const [heureDepart, setHeureDepart] = useState('')
  const [motif, setMotif] = useState('')
  const [erreur, setErreur] = useState(null)
  const [envoi, setEnvoi] = useState(false)

  const enseignants = secretariat?.enseignants ?? []
  const enseignant = enseignants.find((e) => e.id === teacherId) ?? null
  const affectees = enseignant?.matieres ?? []
  const matieresPointage = secretariat?.matieresPointage ?? []

  // Matières du département de l'enseignant (recherche libre).
  const matieresDuDept = useMemo(
    () => matieresPointage.filter((m) => m.departementId === enseignant?.departementId),
    [matieresPointage, enseignant],
  )
  const resultatsMat = useMemo(() => {
    const terme = rechercheMat.trim().toLowerCase()
    if (!terme) return []
    return matieresDuDept
      .filter(
        (m) =>
          m.nom.toLowerCase().includes(terme) || (m.nomEn && m.nomEn.toLowerCase().includes(terme)),
      )
      .slice(0, 15)
  }, [matieresDuDept, rechercheMat])

  // Bornes de la date : entre il y a 30 jours et aujourd'hui.
  const { minJour, maxJour } = useMemo(() => {
    const today = new Date()
    const il30 = new Date(today.getTime() - 30 * 24 * 3600 * 1000)
    const iso = (d) => d.toISOString().slice(0, 10)
    return { minJour: iso(il30), maxJour: iso(today) }
  }, [])

  // Liste filtrée par la recherche (nom ou matière).
  const filtresEnseignants = useMemo(() => {
    const terme = recherche.trim().toLowerCase()
    if (!terme) return enseignants
    return enseignants.filter(
      (e) =>
        e.nom.toLowerCase().includes(terme) ||
        (e.matieres ?? []).some((m) => m.nom.toLowerCase().includes(terme)),
    )
  }, [enseignants, recherche])

  const effacerMatiere = () => {
    setMatiereId('')
    setMatiereLabel('')
    setRechercheMat('')
    setMatiereAnglo(false)
    setSection('francophone')
  }

  const choisirEnseignant = (id) => {
    setTeacherId(id)
    effacerMatiere()
    setNiveau('')
  }

  const changerEnseignant = () => {
    setTeacherId('')
    setRecherche('')
    effacerMatiere()
    setNiveau('')
  }

  const choisirMatiere = (m) => {
    setMatiereId(m.id)
    setMatiereLabel(`${m.nom} — ${m.classe}`)
    setRechercheMat('')
    if (m.niveau) setNiveau(String(m.niveau))
    setMatiereAnglo(Boolean(m.sectionAnglophone))
    if (!m.sectionAnglophone) setSection('francophone')
    setErreur(null)
  }

  if (!secretariat) {
    return (
      <EmptyState icon={<CalendarPlus className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer la liste des enseignants.
      </EmptyState>
    )
  }

  const enregistrer = async () => {
    setErreur(null)
    if (!teacherId) return setErreur("Choisissez l'enseignant.")
    if (!matiereId) return setErreur('Choisissez la matière.')
    if (!niveau) return setErreur('Choisissez le niveau.')
    if (!jour) return setErreur('Indiquez le jour du cours.')
    if (!heureArrivee || !heureDepart) return setErreur("Indiquez l'heure d'arrivée et de départ.")
    if (heureDepart <= heureArrivee) return setErreur("Le départ doit être après l'arrivée.")

    setEnvoi(true)
    const reponse = await enqueue(
      'secretariat.seance_anterieure',
      {
        teacherId,
        matiereId,
        niveau: Number(niveau),
        jour,
        heureArrivee,
        heureDepart,
        motif: motif.trim() || undefined,
        section: matiereAnglo ? section : 'francophone',
      },
      { labelPourUtilisateur: `Séance antérieure — ${enseignant?.nom ?? ''}` },
    )
    setEnvoi(false)

    if (!reponse.ok && !reponse.enAttente) {
      setErreur(reponse.error?.message ?? 'Enregistrement refusé.')
      return
    }
    toast.succes('Séance enregistrée', 'Les heures ont été ajoutées à cet enseignant.')
    // On remet le formulaire à zéro, enseignant gardé pour enchaîner.
    setMatiereId('')
    setMatiereLabel('')
    setRechercheMat('')
    setNiveau('')
    setJour('')
    setHeureArrivee('')
    setHeureDepart('')
    setMotif('')
    await synchroniser({ silencieux: true })
  }

  return (
    <>
      <PageHeader
        title="Séance antérieure"
        subtitle="Enregistrer un cours qui n'a pas pu être pointé sur le moment (coupure, absence…)."
      />

      <div className="mx-auto max-w-2xl">
        <Banner tone="info" className="mb-4" title="À utiliser seulement en rattrapage">
          Cette saisie ajoute des heures pour un jour passé (jusqu'à 30 jours). Elle ne compte que
          les heures de l'enseignant — aucune présence d'étudiant n'est enregistrée. Chaque saisie
          est tracée dans l'historique.
        </Banner>

        <Card>
          <CardHeader
            title="Détails de la séance"
            icon={<CalendarPlus className="size-4" aria-hidden />}
          />
          <CardBody className="space-y-4">
            <Field label="Enseignant" required htmlFor="sa-enseignant">
              {enseignant ? (
                // Enseignant choisi : on l'affiche avec un bouton pour changer.
                <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-3.5 py-2.5">
                  <span className="min-w-0 truncate text-sm font-medium text-ink">
                    {enseignant.nom}
                  </span>
                  <button
                    type="button"
                    onClick={changerEnseignant}
                    className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-accent-text hover:underline"
                  >
                    <X className="size-3.5" aria-hidden />
                    Changer
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
                      aria-hidden
                    />
                    <Input
                      id="sa-enseignant"
                      value={recherche}
                      onChange={(e) => setRecherche(e.target.value)}
                      placeholder="Rechercher un enseignant ou une matière"
                      className="pl-10"
                      maxLength={40}
                      autoComplete="off"
                    />
                  </div>
                  {recherche.trim() && (
                    <ul className="mt-2 max-h-56 divide-y divide-line overflow-auto rounded-xl border border-line">
                      {filtresEnseignants.map((e) => (
                        <li key={e.id}>
                          <button
                            type="button"
                            onClick={() => choisirEnseignant(e.id)}
                            className="block w-full px-3.5 py-2.5 text-left text-sm text-ink transition-colors hover:bg-surface-2"
                          >
                            {e.nom}
                            <span className="mt-0.5 block truncate text-[12px] text-faint">
                              {(e.matieres ?? []).map((m) => m.nom).join(' · ') || 'Aucune matière'}
                            </span>
                          </button>
                        </li>
                      ))}
                      {filtresEnseignants.length === 0 && (
                        <li className="px-3.5 py-3 text-[13px] text-faint">Aucun enseignant trouvé.</li>
                      )}
                    </ul>
                  )}
                </>
              )}
            </Field>

            <Field
              label="Matière enseignée"
              required
              htmlFor="sa-matiere"
              hint={
                enseignant?.departement
                  ? `Recherche dans les matières du département ${enseignant.departement}.`
                  : undefined
              }
            >
              {!teacherId ? (
                <p className="rounded-xl border border-dashed border-line px-3 py-2.5 text-[13px] text-faint">
                  Choisissez d'abord l'enseignant.
                </p>
              ) : matiereId ? (
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
                      id="sa-matiere"
                      value={rechercheMat}
                      onChange={(e) => setRechercheMat(e.target.value)}
                      placeholder="Rechercher une matière…"
                      className="pl-10"
                      maxLength={60}
                      autoComplete="off"
                    />
                    {rechercheMat.trim() !== '' && (
                      <ul className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-line bg-surface-2 shadow-card">
                        {resultatsMat.length === 0 ? (
                          <li className="px-3 py-2.5 text-[13px] text-faint">
                            Aucune matière trouvée.
                          </li>
                        ) : (
                          resultatsMat.map((m) => (
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
              htmlFor="sa-niveau"
              hint="Pré-rempli d'après la classe. C'est lui qui détermine la paye."
            >
              <Select id="sa-niveau" value={niveau} onChange={(e) => setNiveau(e.target.value)}>
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
                htmlFor="sa-section"
                hint="Cette filière a une section anglophone : mêmes cours, noms en anglais."
              >
                <Select id="sa-section" value={section} onChange={(e) => setSection(e.target.value)}>
                  <option value="francophone">Francophone</option>
                  <option value="anglophone">Anglophone</option>
                </Select>
              </Field>
            )}

            <Field label="Jour du cours" required htmlFor="sa-jour" hint="Entre il y a 30 jours et aujourd'hui.">
              <Input
                id="sa-jour"
                type="date"
                value={jour}
                min={minJour}
                max={maxJour}
                onChange={(e) => setJour(e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Heure d'arrivée" required htmlFor="sa-arrivee">
                <Input
                  id="sa-arrivee"
                  type="time"
                  value={heureArrivee}
                  onChange={(e) => setHeureArrivee(e.target.value)}
                />
              </Field>
              <Field label="Heure de départ" required htmlFor="sa-depart">
                <Input
                  id="sa-depart"
                  type="time"
                  value={heureDepart}
                  onChange={(e) => setHeureDepart(e.target.value)}
                />
              </Field>
            </div>

            <Field label="Motif (facultatif)" htmlFor="sa-motif" hint="Ex. coupure de courant, secrétariat fermé.">
              <Input
                id="sa-motif"
                value={motif}
                onChange={(e) => setMotif(e.target.value)}
                maxLength={300}
                placeholder="Raison de la saisie a posteriori"
              />
            </Field>

            {erreur && <Banner tone="warn">{erreur}</Banner>}

            <Button className="w-full" onClick={enregistrer} loading={envoi}>
              <CheckCircle2 className="size-4" aria-hidden />
              Enregistrer la séance
            </Button>
          </CardBody>
        </Card>
      </div>
    </>
  )
}
