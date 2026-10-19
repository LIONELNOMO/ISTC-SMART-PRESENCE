import { useMemo, useState } from 'react'
import { CalendarClock, FileText, Paperclip, Send } from 'lucide-react'

import { useProjection, useSession } from '../../lib/session.jsx'
import { enqueue, synchroniser } from '../../lib/sync.js'
import { formatHours } from '../../lib/utils.js'
import { formatDate, formatTime } from '../../lib/dates.js'
import { prepareJustificatif, MAX_JUSTIFICATIF_BYTES } from '../../lib/files.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { Badge, Button } from '../../components/ui/primitives.jsx'
import { Banner, Card, EmptyState } from '../../components/ui/surfaces.jsx'
import { Field, FileInput, Segmented, Textarea } from '../../components/ui/forms.jsx'
import { DataTable } from '../../components/ui/data.jsx'
import { Modal, useToast } from '../../components/ui/overlays.jsx'
import { EtatJustification, EtatPresence, StatutSeance } from '../../components/app/SessionBits.jsx'

/**
 * « Mes séances » (§10) : la liste des séances avec leur état, et la demande de
 * justification (§6).
 */
export function EtudiantSeances() {
  const etudiant = useProjection('etudiant')
  const { enLigne } = useSession()
  const toast = useToast()

  const [filtre, setFiltre] = useState('toutes')
  const [demande, setDemande] = useState(null)

  const absencesParSeance = useMemo(
    () => new Map((etudiant?.absences ?? []).map((a) => [a.sessionId, a])),
    [etudiant],
  )

  const lignes = useMemo(() => {
    const toutes = etudiant?.seances ?? []
    if (filtre === 'absences') return toutes.filter((s) => s.presence === 'absent')
    if (filtre === 'presences') return toutes.filter((s) => s.presence === 'present')
    return toutes
  }, [etudiant, filtre])

  if (!etudiant) {
    return (
      <EmptyState icon={<CalendarClock className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer vos séances.
      </EmptyState>
    )
  }

  const compte = {
    toutes: etudiant.seances.length,
    absences: etudiant.seances.filter((s) => s.presence === 'absent').length,
    presences: etudiant.seances.filter((s) => s.presence === 'present').length,
  }

  return (
    <>
      <PageHeader
        title="Mes séances"
        subtitle="Seules les séances terminées produisent des heures d'absence."
      >
        <Segmented
          value={filtre}
          onChange={setFiltre}
          options={[
            { value: 'toutes', label: 'Toutes', count: compte.toutes },
            { value: 'absences', label: 'Absences', count: compte.absences },
            { value: 'presences', label: 'Présences', count: compte.presences },
          ]}
        />
      </PageHeader>

      <Card>
        <DataTable
          className="px-2 py-1 sm:px-3"
          columns={[
            {
              key: 'matiere',
              label: 'Matière',
              strong: true,
              render: (row) => (
                <span>
                  {row.matiere}
                  <span className="ml-2 text-[12px] font-normal text-faint">
                    {formatDate(row.arrivalAt)} · {formatTime(row.arrivalAt)}
                  </span>
                </span>
              ),
            },
            {
              key: 'statutSeance',
              label: 'Séance',
              render: (row) => <StatutSeance statut={row.statutSeance} />,
            },
            {
              key: 'presence',
              label: 'Ma présence',
              render: (row) => <EtatPresence etat={row.presence} />,
            },
            {
              key: 'heures',
              label: 'Durée',
              align: 'right',
              render: (row) => (
                <span className="text-faint">
                  {row.statutSeance === 'terminee' ? formatHours(row.heures) : '—'}
                </span>
              ),
            },
            {
              key: 'justification',
              label: 'Justification',
              render: (row) => {
                const absence = absencesParSeance.get(row.sessionId)
                if (!absence) return <span className="text-faint">—</span>
                if (absence.justification) {
                  return <EtatJustification etat={absence.justification.state} />
                }
                return (
                  <Button
                    size="sm"
                    variant="soft"
                    disabled={!enLigne}
                    onClick={() => setDemande(absence)}
                    title={enLigne ? undefined : 'Cette action demande une connexion.'}
                  >
                    Demander
                  </Button>
                )
              },
            },
          ]}
          rows={lignes}
          getKey={(row) => row.sessionId}
          empty="Aucune séance"
          emptyIcon={<CalendarClock className="size-5" />}
        />
      </Card>

      {(etudiant.absences ?? []).some((a) => a.justification) && (
        <div className="mt-6">
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-faint">
            Décisions reçues
          </h2>
          <ul className="space-y-2">
            {etudiant.absences
              .filter((a) => a.justification)
              .map((absence) => (
                <li
                  key={absence.sessionId}
                  className="rounded-xl border border-line bg-surface px-4 py-3 shadow-card"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">
                        {absence.matiere}
                        <span className="ml-2 text-[12px] font-normal text-faint">
                          {formatDate(absence.arrivalAt)} · {formatHours(absence.heures)}
                        </span>
                      </p>
                      <p className="mt-1 text-[13px] leading-relaxed text-soft">
                        Motif déclaré : {absence.justification.motif}
                      </p>
                      {absence.justification.commentaire && (
                        <p className="mt-1 text-[13px] leading-relaxed text-faint">
                          Réponse : {absence.justification.commentaire}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <EtatJustification etat={absence.justification.state} />
                      {absence.justification.decidedByLabel && (
                        <p className="mt-1 text-[11px] text-faint">
                          {absence.justification.decidedByLabel}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
          </ul>
        </div>
      )}

      <DemandeJustification
        absence={demande}
        onClose={() => setDemande(null)}
        onEnvoye={() => {
          setDemande(null)
          toast.succes('Demande envoyée', 'Votre chef de département la verra dans sa file.')
          synchroniser({ silencieux: true })
        }}
      />
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Demande de justification
 * ------------------------------------------------------------------ */

function DemandeJustification({ absence, onClose, onEnvoye }) {
  const [motif, setMotif] = useState('')
  const [piece, setPiece] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [envoi, setEnvoi] = useState(false)
  const toast = useToast()

  const choisirFichier = async (file) => {
    setErreur(null)
    // §13.7 : contrôle du type sur le contenu, taille bornée, EXIF retiré.
    const prepare = await prepareJustificatif(file)
    if (prepare.error) {
      setErreur(prepare.error)
      setPiece(null)
      return
    }
    setPiece(prepare)
  }

  const envoyer = async () => {
    setErreur(null)
    if (motif.trim().length < 4) {
      setErreur('Indiquez un motif (au moins 4 caractères).')
      return
    }
    setEnvoi(true)
    const reponse = await enqueue(
      'justification.demander',
      {
        sessionId: absence.sessionId,
        motif: motif.trim(),
        piece: piece
          ? {
              id: piece.id,
              name: piece.name,
              type: piece.type,
              size: piece.size,
              dataUrl: piece.dataUrl,
              exifStripped: piece.exifStripped,
            }
          : null,
      },
      { labelPourUtilisateur: 'Demande de justification' },
    )
    setEnvoi(false)

    if (!reponse.ok) {
      setErreur(reponse.error?.message ?? 'Envoi impossible.')
      return
    }
    setMotif('')
    setPiece(null)
    onEnvoye()
  }

  return (
    <Modal
      open={Boolean(absence)}
      onClose={onClose}
      title="Demander une justification"
      subtitle={
        absence
          ? `${absence.matiere} · ${formatDate(absence.arrivalAt)} · ${formatHours(absence.heures)} d'absence`
          : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={envoyer} loading={envoi}>
            <Send className="size-4" aria-hidden />
            Envoyer la demande
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Motif" required htmlFor="motif">
          <Textarea
            id="motif"
            value={motif}
            onChange={(event) => setMotif(event.target.value)}
            maxLength={500}
            rows={4}
            placeholder="Expliquez la raison de votre absence."
          />
        </Field>

        <Field
          label="Justificatif (facultatif)"
          hint={`Photo JPEG ou PNG, ou PDF. ${MAX_JUSTIFICATIF_BYTES / 1024 / 1024} Mo au maximum.`}
        >
          <FileInput
            accept="image/jpeg,image/png,application/pdf"
            onFile={choisirFichier}
            label="Joindre une photo ou un PDF"
            hint="Le fichier est vérifié sur son contenu, pas sur son extension."
          />
        </Field>

        {piece && (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ok-soft text-ok">
              {piece.type === 'application/pdf' ? (
                <FileText className="size-4" aria-hidden />
              ) : (
                <Paperclip className="size-4" aria-hidden />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[12px] text-ink">{piece.name}</p>
              <p className="text-[11px] text-faint">
                {(piece.size / 1024).toFixed(0)} Ko
                {piece.exifStripped && ' · métadonnées retirées'}
              </p>
            </div>
            {piece.exifStripped && <Badge tone="ok">sans EXIF</Badge>}
          </div>
        )}

        {erreur && <Banner tone="bad">{erreur}</Banner>}

        <p className="text-[12px] leading-relaxed text-faint">
          Seul le chef de département de votre filière décide si l'absence est justifiée. Tant que la
          décision n'est pas prise, l'absence reste comptée.
        </p>
      </div>
    </Modal>
  )
}
