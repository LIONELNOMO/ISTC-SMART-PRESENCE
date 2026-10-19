import { useState } from 'react'
import { ClipboardList, Clock } from 'lucide-react'

import { useProjection } from '../../lib/session.jsx'
import { enqueue, synchroniser } from '../../lib/sync.js'
import { formatDate } from '../../lib/dates.js'
import { libelleMatiere } from '../../lib/utils.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { Badge, Button } from '../../components/ui/primitives.jsx'
import { Banner, Card, CardBody, EmptyState } from '../../components/ui/surfaces.jsx'
import { Field, Input } from '../../components/ui/forms.jsx'
import { Modal, useToast } from '../../components/ui/overlays.jsx'

/**
 * Relevés déclarés par les enseignants, en attente de pointage (§4).
 *
 * Un enseignant a fait l'appel sans secrétaire : ses présences sont prises,
 * mais ses heures ne le sont pas. La secrétaire lui attribue ici une arrivée
 * et un départ, ce qui crée la séance complète.
 */
export function SecretariatAPointer() {
  const secretariat = useProjection('secretariat')
  const toast = useToast()
  const [cible, setCible] = useState(null)

  if (!secretariat) {
    return (
      <EmptyState icon={<ClipboardList className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer les relevés.
      </EmptyState>
    )
  }

  const declares = secretariat.declaresEnAttente ?? []

  return (
    <>
      <PageHeader
        title="Relevés à pointer"
        subtitle="Appels faits par les enseignants en votre absence. Attribuez-leur leurs heures."
      />

      {declares.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState icon={<ClipboardList className="size-5" />} title="Rien à pointer">
              Quand un enseignant fait l'appel sans vous, il apparaît ici pour que vous ajoutiez ses
              heures.
            </EmptyState>
          </CardBody>
        </Card>
      ) : (
        <ul className="space-y-3">
          {declares.map((d) => (
            <li key={d.id}>
              <Card>
                <CardBody className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                      {d.enseignant}
                      <Badge tone="warn">À pointer</Badge>
                    </p>
                    <p className="mt-0.5 text-[12px] text-faint">
                      {libelleMatiere(d.matiere, d.matiereEn)} · niveau {d.niveau} · {formatDate(d.day)} · {d.presents} présent
                      {d.presents > 1 ? 's' : ''}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => setCible(d)}>
                    <Clock className="size-4" aria-hidden />
                    Pointer les heures
                  </Button>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ModalePointage
        declare={cible}
        onClose={() => setCible(null)}
        onFait={() => {
          setCible(null)
          toast.succes('Heures pointées', "L'enseignant a été prévenu.")
        }}
      />
    </>
  )
}

function ModalePointage({ declare, onClose, onFait }) {
  const [heureArrivee, setHeureArrivee] = useState('')
  const [heureDepart, setHeureDepart] = useState('')
  const [erreur, setErreur] = useState(null)
  const [envoi, setEnvoi] = useState(false)

  const pointer = async () => {
    setErreur(null)
    if (!heureArrivee || !heureDepart) return setErreur("Indiquez l'arrivée et le départ.")
    if (heureDepart <= heureArrivee) return setErreur("Le départ doit être après l'arrivée.")
    setEnvoi(true)
    const reponse = await enqueue(
      'secretariat.pointer_declare',
      { declareId: declare.id, heureArrivee, heureDepart },
      { labelPourUtilisateur: `Pointage — ${declare.enseignant}` },
    )
    setEnvoi(false)
    if (!reponse.ok && !reponse.enAttente) {
      setErreur(reponse.error?.message ?? 'Pointage refusé.')
      return
    }
    setHeureArrivee('')
    setHeureDepart('')
    await synchroniser({ silencieux: true })
    onFait()
  }

  return (
    <Modal
      open={Boolean(declare)}
      onClose={onClose}
      title="Pointer les heures"
      subtitle={declare ? `${declare.enseignant} — ${formatDate(declare.day)}` : ''}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={pointer} loading={envoi}>
            <Clock className="size-4" aria-hidden />
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Banner tone="info">
          L'appel ({declare?.presents ?? 0} présent{(declare?.presents ?? 0) > 1 ? 's' : ''}) a déjà
          été fait par l'enseignant. Vous ajoutez seulement ses heures.
        </Banner>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Arrivée" required htmlFor="pt-arrivee">
            <Input
              id="pt-arrivee"
              type="time"
              value={heureArrivee}
              onChange={(e) => setHeureArrivee(e.target.value)}
            />
          </Field>
          <Field label="Départ" required htmlFor="pt-depart">
            <Input
              id="pt-depart"
              type="time"
              value={heureDepart}
              onChange={(e) => setHeureDepart(e.target.value)}
            />
          </Field>
        </div>
        {erreur && <Banner tone="warn">{erreur}</Banner>}
      </div>
    </Modal>
  )
}
