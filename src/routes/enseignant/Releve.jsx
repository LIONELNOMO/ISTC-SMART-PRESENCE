import { useMemo, useState } from 'react'
import { ClipboardList, Clock3 } from 'lucide-react'

import { useProjection } from '../../lib/session.jsx'
import { formatDate, formatTime } from '../../lib/dates.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { Badge, Button } from '../../components/ui/primitives.jsx'
import { Banner, Card, CardBody, CardHeader, EmptyState } from '../../components/ui/surfaces.jsx'
import { Field, Select } from '../../components/ui/forms.jsx'
import { useToast } from '../../components/ui/overlays.jsx'
import { StatutSeance, ManqueListe } from '../../components/app/SessionBits.jsx'
import { ListeAppel } from './ListeAppel.jsx'

/**
 * Relevé après le cours (§5, §10).
 *
 * Deux cas :
 *  - l'appareil connaît la séance : on la choisit dans la liste ;
 *  - l'appareil ne la connaît pas, faute de réseau : on choisit la matière et on
 *    saisit le code de séance. Le serveur rattachera le relevé à la bonne séance
 *    à la synchronisation (§5).
 */
export function EnseignantReleve() {
  const enseignant = useProjection('enseignant')
  const parametres = useProjection('parametres')
  const toast = useToast()

  const seances = enseignant?.seancesARelever ?? []
  const matieres = enseignant?.matieres ?? []

  const [mode, setMode] = useState(seances.length ? 'seance' : 'matiere')
  const [sessionId, setSessionId] = useState(seances[0]?.id ?? '')
  const [matiereId, setMatiereId] = useState(matieres[0]?.id ?? '')

  const seanceChoisie = useMemo(() => {
    if (mode === 'seance') return seances.find((s) => s.id === sessionId) ?? null
    const matiere = matieres.find((m) => m.id === matiereId)
    if (!matiere) return null
    // Séance « virtuelle » : le serveur retrouvera la vraie grâce au code.
    return {
      id: null,
      matiereId: matiere.id,
      matiere: matiere.nom,
      classe: matiere.classe,
      classeId: matiere.classeId,
      presentsCoches: [],
      effectif: 0,
    }
  }, [mode, seances, sessionId, matieres, matiereId])

  if (!enseignant) {
    return (
      <EmptyState icon={<ClipboardList className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer vos séances.
      </EmptyState>
    )
  }

  return (
    <>
      <PageHeader
        title="Relevé après le cours"
        subtitle={`Vous disposez de ${parametres?.delaiReleveJours ?? 7} jours après le cours pour saisir un relevé.`}
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="Quelle séance ?"
              icon={<Clock3 className="size-4" aria-hidden />}
            />
            <CardBody className="space-y-4">
              <div className="flex gap-2">
                <Button
                  variant={mode === 'seance' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setMode('seance')}
                  className="flex-1"
                  disabled={seances.length === 0}
                >
                  Dans ma liste
                </Button>
                <Button
                  variant={mode === 'matiere' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setMode('matiere')}
                  className="flex-1"
                >
                  Par matière
                </Button>
              </div>

              {mode === 'seance' ? (
                seances.length === 0 ? (
                  <p className="text-[13px] leading-relaxed text-faint">
                    Aucune séance en attente de relevé n'est connue de cet appareil. Passez par
                    « Par matière » et saisissez le code remis par la secrétaire.
                  </p>
                ) : (
                  <Field label="Séance" htmlFor="seance">
                    <Select
                      id="seance"
                      value={sessionId}
                      onChange={(event) => setSessionId(event.target.value)}
                    >
                      {seances.map((seance) => (
                        <option key={seance.id} value={seance.id}>
                          {formatDate(seance.arrivalAt)} {formatTime(seance.arrivalAt)} —{' '}
                          {seance.matiere}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )
              ) : (
                <>
                  <Field label="Matière" htmlFor="matiere">
                    <Select
                      id="matiere"
                      value={matiereId}
                      onChange={(event) => setMatiereId(event.target.value)}
                    >
                      {matieres.map((matiere) => (
                        <option key={matiere.id} value={matiere.id}>
                          {matiere.nom} — {matiere.classe}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Banner tone="info">
                    Le serveur rattachera votre relevé à la séance ouverte par le secrétariat qui
                    correspond à ce code.
                  </Banner>
                </>
              )}
            </CardBody>
          </Card>

          {seances.length > 0 && (
            <Card>
              <CardHeader
                title="Séances en attente"
                subtitle="Elles ne sont pas comptées dans vos heures tant que le relevé n'est pas validé."
              />
              <CardBody flush>
                <ul className="divide-y divide-line">
                  {seances.map((seance) => (
                    <li key={seance.id} className="px-4 py-3 sm:px-5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px] font-medium text-ink">
                            {seance.matiere}
                          </p>
                          <p className="text-[12px] text-faint">
                            {formatDate(seance.arrivalAt)} · {formatTime(seance.arrivalAt)}
                            {seance.departureAt ? ` → ${formatTime(seance.departureAt)}` : ''}
                          </p>
                          <ManqueListe manque={seance.manque} className="mt-1 block" />
                        </div>
                        <div className="shrink-0 space-y-1 text-right">
                          <StatutSeance statut={seance.status} />
                          {seance.releveAt && !seance.codeOk && (
                            <Badge tone="bad" className="block">
                              code à corriger
                            </Badge>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="lg:col-span-3">
          {seanceChoisie ? (
            <ListeAppel
              seance={seanceChoisie}
              titre="Cocher les présents"
              onValide={() => toast.succes('Relevé enregistré')}
            />
          ) : (
            <EmptyState icon={<ClipboardList className="size-5" />} title="Choisissez une séance">
              Sélectionnez une séance ou une matière pour afficher la liste des étudiants.
            </EmptyState>
          )}
        </div>
      </div>
    </>
  )
}
