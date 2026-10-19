import { useMemo, useState } from 'react'
import { Check, Eye, FileText, FileWarning, X } from 'lucide-react'

import { useProjection, useSession } from '../../lib/session.jsx'
import { enqueue, synchroniser } from '../../lib/sync.js'
import { formatHours } from '../../lib/utils.js'
import { formatDate, formatStamp } from '../../lib/dates.js'
import { downloadJustificatif, isDisplayableImage } from '../../lib/files.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { Button } from '../../components/ui/primitives.jsx'
import { Banner, Card, CardBody, EmptyState, Stat } from '../../components/ui/surfaces.jsx'
import { Field, Segmented, Textarea } from '../../components/ui/forms.jsx'
import { KeyValue } from '../../components/ui/data.jsx'
import { Modal, useToast } from '../../components/ui/overlays.jsx'
import { EtatJustification } from '../../components/app/SessionBits.jsx'

/**
 * Justifications à traiter (§6, §10).
 *
 * Seul le chef de département de la filière décide. Le serveur vérifie que
 * chaque demande appartient bien à sa filière (§13.3) et historise chaque
 * décision (§13.4 « Décision sans trace »).
 */
export function DepartementJustifications() {
  const departement = useProjection('departement')
  const { enLigne } = useSession()
  const toast = useToast()

  const [filtre, setFiltre] = useState('en_attente')
  const [examen, setExamen] = useState(null)

  const demandes = departement?.justifications ?? []

  const compte = useMemo(
    () => ({
      en_attente: demandes.filter((d) => d.state === 'en_attente').length,
      acceptee: demandes.filter((d) => d.state === 'acceptee').length,
      refusee: demandes.filter((d) => d.state === 'refusee').length,
      toutes: demandes.length,
    }),
    [demandes],
  )

  const visibles = filtre === 'toutes' ? demandes : demandes.filter((d) => d.state === filtre)

  if (!departement) {
    return (
      <EmptyState icon={<FileWarning className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer les demandes de votre filière.
      </EmptyState>
    )
  }

  if (!departement.filieres?.length) {
    return (
      <Banner tone="warn" title="Aucune filière rattachée">
        Votre compte n'est chef de département d'aucune filière. L'administration doit vous rattacher
        à une filière.
      </Banner>
    )
  }

  return (
    <>
      <PageHeader
        title="Justifications à traiter"
        subtitle={departement.filieres.map((f) => f.nom).join(' · ')}
      >
        <Segmented
          value={filtre}
          onChange={setFiltre}
          options={[
            { value: 'en_attente', label: 'À traiter', count: compte.en_attente },
            { value: 'acceptee', label: 'Acceptées', count: compte.acceptee },
            { value: 'refusee', label: 'Refusées', count: compte.refusee },
            { value: 'toutes', label: 'Toutes', count: compte.toutes },
          ]}
        />
      </PageHeader>

      {!enLigne && (
        <Banner tone="warn" className="mb-4" title="Hors ligne">
          Les décisions demandent une connexion : elles modifient le calcul des absences de
          l'étudiant.
        </Banner>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="À traiter" value={compte.en_attente} tone={compte.en_attente > 0 ? 'warn' : 'ok'} />
        <Stat label="Acceptées" value={compte.acceptee} tone="ok" />
        <Stat label="Refusées" value={compte.refusee} tone="bad" />
      </div>

      <div className="mt-6 space-y-3">
        {visibles.length === 0 ? (
          <EmptyState icon={<Check className="size-5" />} title="Rien à traiter">
            Les demandes des étudiants de votre filière apparaîtront ici.
          </EmptyState>
        ) : (
          visibles.map((demande) => (
            <Card key={demande.id}>
              <CardBody>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[15px] font-semibold text-ink">{demande.etudiant}</h3>
                      <EtatJustification etat={demande.state} />
                      {demande.directe && (
                        <span className="text-[11px] font-medium text-faint">
                          justifiée directement
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[13px] text-faint">
                      {demande.classe} · {demande.matricule}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {demande.piece && (
                      <Button size="sm" variant="secondary" onClick={() => setExamen({ ...demande, vue: true })}>
                        <Eye className="size-4" aria-hidden />
                        Justificatif
                      </Button>
                    )}
                    {demande.state === 'en_attente' && (
                      <Button size="sm" disabled={!enLigne} onClick={() => setExamen(demande)}>
                        Décider
                      </Button>
                    )}
                  </div>
                </div>

                <KeyValue
                  className="mt-4"
                  columns={3}
                  items={[
                    { label: 'Séance', value: demande.matiere },
                    { label: 'Date', value: formatDate(demande.seanceDu) },
                    { label: 'Heures', value: formatHours(demande.heures) },
                    { label: 'Demande déposée', value: formatStamp(demande.createdAt), tone: 'faint' },
                    demande.decidedAt
                      ? {
                          label: 'Décision',
                          value: `${formatStamp(demande.decidedAt)} · ${demande.decidedByLabel ?? ''}`,
                          tone: 'faint',
                        }
                      : null,
                  ]}
                />

                <p className="mt-3 rounded-lg bg-surface-2 px-3.5 py-2.5 text-[13px] leading-relaxed text-soft">
                  {demande.motif}
                </p>

                {demande.commentaire && (
                  <p className="mt-2 text-[12.5px] leading-relaxed text-faint">
                    Votre commentaire : {demande.commentaire}
                  </p>
                )}
              </CardBody>
            </Card>
          ))
        )}
      </div>

      <ModaleDecision
        demande={examen}
        onClose={() => setExamen(null)}
        onDecide={(decision) => {
          setExamen(null)
          toast.succes(
            decision === 'acceptee' ? 'Absence justifiée' : 'Demande refusée',
            decision === 'acceptee'
              ? "L'absence sort du calcul du seuil d'alerte."
              : "L'absence reste comptée comme non justifiée.",
          )
        }}
      />
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Décision
 * ------------------------------------------------------------------ */

function ModaleDecision({ demande, onClose, onDecide }) {
  const [commentaire, setCommentaire] = useState('')
  const [erreur, setErreur] = useState(null)
  const [envoi, setEnvoi] = useState(null)

  const decider = async (decision) => {
    setErreur(null)
    setEnvoi(decision)
    const reponse = await enqueue(
      'justification.decider',
      {
        justificationId: demande.id,
        decision,
        commentaire: commentaire.trim() || null,
      },
      { labelPourUtilisateur: `Décision — ${demande.etudiant}` },
    )
    setEnvoi(null)

    if (!reponse.ok) {
      setErreur(reponse.error?.message ?? 'Décision impossible.')
      return
    }
    setCommentaire('')
    await synchroniser({ silencieux: true })
    onDecide(decision)
  }

  const seulementConsultation = demande?.vue

  return (
    <Modal
      open={Boolean(demande)}
      onClose={onClose}
      title={seulementConsultation ? 'Justificatif' : 'Décider de la justification'}
      subtitle={demande ? `${demande.etudiant} · ${demande.matiere}` : undefined}
      footer={
        seulementConsultation ? (
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
        ) : (
          <>
            <Button
              variant="danger"
              onClick={() => decider('refusee')}
              loading={envoi === 'refusee'}
            >
              <X className="size-4" aria-hidden />
              Refuser
            </Button>
            <Button
              variant="success"
              onClick={() => decider('acceptee')}
              loading={envoi === 'acceptee'}
            >
              <Check className="size-4" aria-hidden />
              Accepter
            </Button>
          </>
        )
      }
    >
      {demande && (
        <div className="space-y-4">
          <p className="rounded-xl bg-surface-2 px-3.5 py-3 text-[13px] leading-relaxed text-soft">
            {demande.motif}
          </p>

          {demande.piece && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">
                Justificatif joint
              </p>
              {isDisplayableImage(demande.piece) ? (
                <img
                  src={demande.piece.dataUrl}
                  alt="Justificatif"
                  className="max-h-72 w-full rounded-xl border border-line object-contain bg-surface-2"
                />
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3">
                  <FileText className="size-5 shrink-0 text-faint" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[12px] text-ink">{demande.piece.name}</p>
                    <p className="text-[11px] text-faint">
                      Un PDF n'est jamais affiché dans l'application : il se télécharge.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => downloadJustificatif(demande.piece)}
                  >
                    Télécharger
                  </Button>
                </div>
              )}
            </div>
          )}

          {!seulementConsultation && (
            <Field label="Commentaire (facultatif)" htmlFor="commentaire">
              <Textarea
                id="commentaire"
                value={commentaire}
                onChange={(event) => setCommentaire(event.target.value)}
                rows={3}
                maxLength={300}
                placeholder="Visible par l'étudiant."
              />
            </Field>
          )}

          {erreur && <Banner tone="bad">{erreur}</Banner>}

          {!seulementConsultation && (
            <p className="text-[12px] leading-relaxed text-faint">
              Votre décision est enregistrée dans l'historique avec votre nom et la date. Une absence
              acceptée passe dans les heures justifiées et sort du calcul du seuil d'alerte.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
