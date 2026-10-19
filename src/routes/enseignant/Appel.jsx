import { useMemo, useState } from 'react'
import { ClipboardCheck, Clock, UserCheck } from 'lucide-react'

import { useProjection } from '../../lib/session.jsx'
import { enqueue, synchroniser } from '../../lib/sync.js'
import { formatDate } from '../../lib/dates.js'
import { libelleMatiere } from '../../lib/utils.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { Badge, Button } from '../../components/ui/primitives.jsx'
import { Banner, Card, CardBody, CardHeader, EmptyState } from '../../components/ui/surfaces.jsx'
import { Field, Select } from '../../components/ui/forms.jsx'
import { useToast } from '../../components/ui/overlays.jsx'

/**
 * Appel sans secrétaire (§4).
 *
 * Quand la secrétaire est absente, l'enseignant fait lui-même l'appel : il
 * choisit sa matière, coche les présents de sa classe, et valide SANS code et
 * SANS saisir ses heures. Le secrétariat pointera ses heures ensuite — d'ici
 * là, l'appel reste « en attente de pointage ».
 */
export function EnseignantAppel() {
  const enseignant = useProjection('enseignant')
  const toast = useToast()

  const [matiereId, setMatiereId] = useState('')
  const [niveau, setNiveau] = useState('')
  // §4 : section de l'appel (affichée seulement si la filière en a une).
  const [section, setSection] = useState('francophone')
  const [presents, setPresents] = useState(() => new Set())
  const [envoi, setEnvoi] = useState(false)

  const matieres = enseignant?.matieres ?? []
  const listes = enseignant?.listes ?? []
  const declares = enseignant?.relevesDeclares ?? []

  const matiere = matieres.find((m) => m.id === matiereId) ?? null
  const etudiants = useMemo(() => {
    if (!matiere) return []
    const tous = listes.find((l) => l.classeId === matiere.classeId)?.etudiants ?? []
    // §4 : seuls les étudiants de la section choisie.
    return tous.filter((e) => (e.section ?? 'francophone') === section)
  }, [matiere, listes, section])

  if (!enseignant) {
    return (
      <EmptyState icon={<ClipboardCheck className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer vos classes.
      </EmptyState>
    )
  }

  const choisirMatiere = (id) => {
    setMatiereId(id)
    setPresents(new Set())
    const m = matieres.find((x) => x.id === id)
    if (m?.niveau) setNiveau(String(m.niveau))
    setSection('francophone')
  }

  const basculer = (id) => {
    setPresents((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toutCocher = () => setPresents(new Set(etudiants.map((e) => e.id)))
  const toutDecocher = () => setPresents(new Set())

  const valider = async () => {
    if (!matiereId) return toast.erreur('Matière', 'Choisissez la matière enseignée.')
    if (!niveau) return toast.erreur('Niveau', 'Choisissez le niveau.')
    setEnvoi(true)
    const reponse = await enqueue(
      'releve.declarer',
      {
        matiereId,
        niveau: Number(niveau),
        section: matiere?.sectionAnglophone ? section : 'francophone',
        presents: [...presents],
      },
      { labelPourUtilisateur: `Appel — ${matiere?.nom ?? ''}` },
    )
    setEnvoi(false)
    if (!reponse.ok && !reponse.enAttente) {
      toast.erreur('Appel refusé', reponse.error?.message)
      return
    }
    toast.succes(
      'Appel enregistré',
      'Le secrétariat pointera vos heures. En attendant, il apparaît « en attente ».',
    )
    setMatiereId('')
    setNiveau('')
    setPresents(new Set())
    await synchroniser({ silencieux: true })
  }

  return (
    <>
      <PageHeader
        title="Faire l'appel"
        subtitle="Secrétaire absente ? Cochez les présents vous-même. Vos heures seront pointées ensuite."
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card>
            <CardHeader
              title="Présences"
              subtitle="Sans secrétaire ni code. Les heures sont ajoutées plus tard par le secrétariat."
              icon={<UserCheck className="size-4" aria-hidden />}
            />
            <CardBody className="space-y-4">
              <Field label="Matière enseignée" required htmlFor="ap-matiere">
                <Select id="ap-matiere" value={matiereId} onChange={(e) => choisirMatiere(e.target.value)}>
                  <option value="">Choisir…</option>
                  {matieres.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nom} — {m.classe}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Niveau"
                required
                htmlFor="ap-niveau"
                hint="Pré-rempli d'après la classe. C'est lui qui détermine la paye."
              >
                <Select id="ap-niveau" value={niveau} onChange={(e) => setNiveau(e.target.value)}>
                  <option value="">Choisir…</option>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      Niveau {n}
                    </option>
                  ))}
                </Select>
              </Field>

              {matiere?.sectionAnglophone && (
                <Field
                  label="Section"
                  required
                  htmlFor="ap-section"
                  hint="Cette filière a une section anglophone : mêmes cours, noms en anglais."
                >
                  <Select id="ap-section" value={section} onChange={(e) => setSection(e.target.value)}>
                    <option value="francophone">Francophone</option>
                    <option value="anglophone">Anglophone</option>
                  </Select>
                </Field>
              )}

              {matiere && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-medium text-ink">
                      {presents.size} présent{presents.size > 1 ? 's' : ''} sur {etudiants.length}
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={toutCocher}>
                        Tout cocher
                      </Button>
                      <Button size="sm" variant="ghost" onClick={toutDecocher}>
                        Tout décocher
                      </Button>
                    </div>
                  </div>

                  {etudiants.length === 0 ? (
                    <p className="py-6 text-center text-[13px] text-faint">
                      Aucun étudiant dans cette classe.
                    </p>
                  ) : (
                    <ul className="divide-y divide-line rounded-xl border border-line">
                      {etudiants.map((e) => {
                        const coche = presents.has(e.id)
                        return (
                          <li key={e.id}>
                            <button
                              type="button"
                              onClick={() => basculer(e.id)}
                              className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2"
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm text-ink">{e.nom}</span>
                                <span className="block text-[12px] text-faint">{e.matricule}</span>
                              </span>
                              <Badge tone={coche ? 'ok' : 'neutral'}>
                                {coche ? 'Présent' : 'Absent'}
                              </Badge>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  <Button className="w-full" onClick={valider} loading={envoi}>
                    <ClipboardCheck className="size-4" aria-hidden />
                    Valider l'appel
                  </Button>
                </>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="Mes appels déclarés"
              subtitle="Statut du pointage par le secrétariat."
              icon={<Clock className="size-4" aria-hidden />}
            />
            <CardBody>
              {declares.length === 0 ? (
                <p className="py-4 text-center text-[13px] text-faint">Aucun appel déclaré.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {declares.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">
                          {libelleMatiere(d.matiere, d.matiereEn)}
                        </p>
                        <p className="text-[12px] text-faint">
                          {formatDate(d.day)} · {d.presents} présent{d.presents > 1 ? 's' : ''}
                        </p>
                      </div>
                      <Badge tone={d.pointe ? 'ok' : 'warn'}>
                        {d.pointe ? 'Pointé' : 'En attente'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
