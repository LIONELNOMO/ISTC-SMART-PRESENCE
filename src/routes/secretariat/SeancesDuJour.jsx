import { useMemo, useState } from 'react'
import { CalendarClock, PenLine } from 'lucide-react'

import { useProjection } from '../../lib/session.jsx'
import { enqueue, synchroniser } from '../../lib/sync.js'
import { isoToTimeInput, formatLongDate, formatTime } from '../../lib/dates.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { Button } from '../../components/ui/primitives.jsx'
import { Banner, EmptyState, SectionTitle, Stat } from '../../components/ui/surfaces.jsx'
import { Field, Input, Segmented, Textarea } from '../../components/ui/forms.jsx'
import { Modal, useToast } from '../../components/ui/overlays.jsx'
import { SeanceCard } from '../../components/app/SessionBits.jsx'

/**
 * Séances du jour (§10) : en cours, terminées et incomplètes, et la saisie d'un
 * départ oublié avec motif obligatoire (§4).
 */
export function SecretariatSeances() {
  const secretariat = useProjection('secretariat')
  const toast = useToast()
  const [filtre, setFiltre] = useState('toutes')
  const [departManquant, setDepartManquant] = useState(null)

  const seances = secretariat?.seancesDuJour ?? []
  const anterieures = secretariat?.incompletesAnterieures ?? []

  const compte = useMemo(
    () => ({
      toutes: seances.length,
      en_cours: seances.filter((s) => s.status === 'en_cours').length,
      terminee: seances.filter((s) => s.status === 'terminee').length,
      incomplete: seances.filter((s) => s.status === 'incomplete').length,
    }),
    [seances],
  )

  const visibles = filtre === 'toutes' ? seances : seances.filter((s) => s.status === filtre)

  if (!secretariat) {
    return (
      <EmptyState icon={<CalendarClock className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer les séances du jour.
      </EmptyState>
    )
  }

  return (
    <>
      <PageHeader title="Séances du jour" subtitle={formatLongDate(new Date().toISOString())}>
        <Segmented
          value={filtre}
          onChange={setFiltre}
          options={[
            { value: 'toutes', label: 'Toutes', count: compte.toutes },
            { value: 'en_cours', label: 'En cours', count: compte.en_cours },
            { value: 'terminee', label: 'Terminées', count: compte.terminee },
            { value: 'incomplete', label: 'Incomplètes', count: compte.incomplete },
          ]}
        />
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="En cours" value={compte.en_cours} tone="warn" hint="Enseignant encore à l'école." />
        <Stat label="Terminées" value={compte.terminee} tone="ok" hint="Comptées dans les heures." />
        <Stat
          label="Incomplètes"
          value={compte.incomplete}
          tone={compte.incomplete > 0 ? 'bad' : 'neutral'}
          hint="Il manque un départ ou un relevé validé."
        />
      </div>

      <div className="mt-6 space-y-3">
        {visibles.length === 0 ? (
          <EmptyState icon={<CalendarClock className="size-5" />} title="Aucune séance">
            Les séances apparaissent dès le pointage d'arrivée.
          </EmptyState>
        ) : (
          visibles.map((seance) => (
            <SeanceCard
              key={seance.id}
              seance={seance}
              afficherCode={seance.code}
              actions={
                !seance.departureAt ? (
                  <Button size="sm" variant="secondary" onClick={() => setDepartManquant(seance)}>
                    <PenLine className="size-4" aria-hidden />
                    Saisir le départ
                  </Button>
                ) : null
              }
            />
          ))
        )}
      </div>

      {anterieures.length > 0 && (
        <div className="mt-8">
          <SectionTitle hint="Séances des jours précédents qui ne sont pas comptées.">
            Séances incomplètes antérieures
          </SectionTitle>
          <div className="space-y-3">
            {anterieures.map((seance) => (
              <SeanceCard
                key={seance.id}
                seance={seance}
                afficherCode={seance.code}
                actions={
                  !seance.departureAt ? (
                    <Button size="sm" variant="secondary" onClick={() => setDepartManquant(seance)}>
                      <PenLine className="size-4" aria-hidden />
                      Saisir le départ
                    </Button>
                  ) : null
                }
              />
            ))}
          </div>
        </div>
      )}

      <ModaleDepartManuel
        seance={departManquant}
        onClose={() => setDepartManquant(null)}
        onEnregistre={() => {
          setDepartManquant(null)
          toast.succes(
            'Départ enregistré',
            "La saisie est conservée dans l'historique et signalée à l'administration.",
          )
        }}
      />
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Départ saisi après coup
 * ------------------------------------------------------------------ */

function ModaleDepartManuel({ seance, onClose, onEnregistre }) {
  const [heure, setHeure] = useState('')
  const [motif, setMotif] = useState('')
  const [erreur, setErreur] = useState(null)
  const [envoi, setEnvoi] = useState(false)

  const enregistrer = async () => {
    setErreur(null)
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(heure)) {
      setErreur('Saisissez une heure au format 16:30.')
      return
    }
    if (motif.trim().length < 4) {
      setErreur('Le motif est obligatoire.')
      return
    }

    setEnvoi(true)
    const reponse = await enqueue(
      'secretariat.depart_manuel',
      { sessionId: seance.id, heure, motif: motif.trim() },
      { labelPourUtilisateur: `Départ saisi — ${seance.enseignant}` },
    )
    setEnvoi(false)

    if (!reponse.ok && !reponse.enAttente) {
      setErreur(reponse.error?.message ?? 'Enregistrement impossible.')
      return
    }
    setHeure('')
    setMotif('')
    await synchroniser({ silencieux: true })
    onEnregistre()
  }

  return (
    <Modal
      open={Boolean(seance)}
      onClose={onClose}
      title="Saisir un départ oublié"
      subtitle={seance ? `${seance.enseignant} · ${seance.matiere}` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={enregistrer} loading={envoi}>
            Enregistrer le départ
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {seance && (
          <p className="rounded-xl bg-surface-2 px-3.5 py-3 text-[13px] text-soft">
            Arrivée pointée à{' '}
            <span className="font-mono font-semibold text-ink">{formatTime(seance.arrivalAt)}</span>.
            Le départ doit être postérieur, le même jour.
          </p>
        )}

        <Field label="Heure de départ" required htmlFor="heure">
          <Input
            id="heure"
            type="time"
            value={heure}
            onChange={(event) => setHeure(event.target.value)}
            min={seance ? isoToTimeInput(seance.arrivalAt) : undefined}
          />
        </Field>

        <Field
          label="Motif"
          required
          htmlFor="motif-depart"
          hint="Obligatoire. Il est conservé dans l'historique et l'administration en est prévenue."
        >
          <Textarea
            id="motif-depart"
            value={motif}
            onChange={(event) => setMotif(event.target.value)}
            rows={3}
            maxLength={300}
            placeholder="L'enseignant a quitté l'école sans repasser au secrétariat."
          />
        </Field>

        {erreur && <Banner tone="bad">{erreur}</Banner>}
      </div>
    </Modal>
  )
}
