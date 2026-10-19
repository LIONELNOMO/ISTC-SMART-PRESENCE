import { useState } from 'react'
import { MessageCircle, ShieldAlert } from 'lucide-react'

import { enqueue, synchroniser } from '../../lib/sync.js'
import { formatPhone } from '../../lib/whatsapp.js'
import { isAllowedExternalUrl } from '../../lib/safe-redirect.js'
import { formatHours } from '../../lib/utils.js'
import { formatStamp } from '../../lib/dates.js'
import { Badge, Button } from '../ui/primitives.jsx'
import { Banner, Card, EmptyState } from '../ui/surfaces.jsx'
import { DataTable } from '../ui/data.jsx'
import { Modal, useToast } from '../ui/overlays.jsx'
import { useSession } from '../../lib/session.jsx'

/**
 * Étudiants en alerte (§8).
 *
 *  §13.9 « Alerte envoyée au mauvais parent » : le lien wa.me est construit PAR
 *         LE SERVEUR, avec le numéro lu en base pour cet étudiant. Cet écran
 *         n'envoie qu'un identifiant et reçoit un lien tout fait.
 *  §8    L'envoi reste manuel : l'application enregistre la date et l'auteur du
 *        clic, mais ne peut pas savoir si le message a été envoyé.
 */
export function AlertesPanel({ alertes, titre = 'Étudiants en alerte' }) {
  const { enLigne } = useSession()
  const toast = useToast()
  const [prepare, setPrepare] = useState(null)
  const [occupe, setOccupe] = useState(false)

  if (!alertes) {
    return (
      <EmptyState icon={<ShieldAlert className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer la liste.
      </EmptyState>
    )
  }

  // §14 : aucune valeur par défaut pour le seuil. On le dit, au lieu d'inventer.
  if (!alertes.seuilDefini) {
    return (
      <Banner tone="info" title="Seuil d'alerte non défini">
        L'administration doit fixer un nombre d'heures d'absence non justifiées et une période (mois
        ou semestre) dans Administration → Paramètres. Aucune valeur n'est appliquée par défaut, donc
        aucun étudiant n'apparaît ici pour l'instant.
      </Banner>
    )
  }

  const contacter = async (ligne) => {
    setOccupe(true)
    const reponse = await enqueue(
      'parent.contacter',
      { studentId: ligne.studentId },
      { labelPourUtilisateur: `Contact parent — ${ligne.nom}` },
    )
    setOccupe(false)

    if (!reponse.ok) {
      toast.erreur('Impossible de préparer le message', reponse.error?.message)
      return
    }
    const { lien, message } = reponse.data
    if (!isAllowedExternalUrl(lien)) {
      toast.erreur('Lien refusé', "Le lien produit n'est pas un lien WhatsApp valide.")
      return
    }
    setPrepare({ ...ligne, lien, message })
    await synchroniser({ silencieux: true })
  }

  return (
    <>
      <Banner tone="warn" className="mb-4" title={`Seuil : ${alertes.seuil} h non justifiées par ${alertes.periode}`}>
        {alertes.etudiants.length === 0
          ? 'Aucun étudiant ne dépasse ce seuil pour le moment.'
          : `${alertes.etudiants.length} étudiant${alertes.etudiants.length > 1 ? 's' : ''} dépasse${alertes.etudiants.length > 1 ? 'nt' : ''} le seuil. Les absences justifiées ne sont pas comptées.`}
      </Banner>

      <Card>
        <DataTable
          className="px-2 py-1 sm:px-3"
          columns={[
            {
              key: 'nom',
              label: 'Étudiant',
              strong: true,
              render: (row) => (
                <span>
                  {row.nom}
                  <span className="ml-2 font-mono text-[11px] font-normal text-faint">
                    {row.matricule}
                  </span>
                </span>
              ),
            },
            { key: 'classe', label: 'Classe' },
            {
              key: 'heuresNonJustifiees',
              label: 'Absences non justifiées',
              align: 'right',
              render: (row) => (
                <span className="font-semibold text-bad">{formatHours(row.heuresNonJustifiees)}</span>
              ),
            },
            {
              key: 'parentPhone',
              label: 'Parent',
              mono: true,
              hideOnTablet: true,
              render: (row) => formatPhone(row.parentPhone),
            },
            {
              key: 'dernierContactAt',
              label: 'Dernier contact',
              render: (row) =>
                row.dernierContactAt ? (
                  <span className="text-[12px] text-faint">
                    {formatStamp(row.dernierContactAt)}
                    {row.dernierContactPar ? ` · ${row.dernierContactPar}` : ''}
                  </span>
                ) : (
                  <Badge tone="neutral">jamais</Badge>
                ),
            },
            {
              key: 'action',
              label: '',
              align: 'right',
              mobileFull: true,
              render: (row) => (
                // Sans numéro de parent, il n'y a personne à joindre : le
                // bouton est désactivé et dit pourquoi, plutôt que d'ouvrir
                // WhatsApp sur une adresse vide (§8, §13.9).
                <Button
                  size="sm"
                  variant="soft"
                  loading={occupe}
                  disabled={!enLigne || !row.parentPhone}
                  onClick={() => contacter(row)}
                  title={
                    !row.parentPhone
                      ? "Aucun numéro de parent enregistré. Complétez-le dans le Référentiel."
                      : enLigne
                        ? undefined
                        : 'Cette action demande une connexion.'
                  }
                  className="w-full sm:w-auto"
                >
                  <MessageCircle className="size-4" aria-hidden />
                  {row.parentPhone ? 'Contacter le parent' : 'Numéro manquant'}
                </Button>
              ),
            },
          ]}
          rows={alertes.etudiants}
          getKey={(row) => row.studentId}
          empty="Aucun étudiant en alerte"
          emptyIcon={<ShieldAlert className="size-5" />}
        />
      </Card>

      <p className="mt-3 text-[12px] leading-relaxed text-faint">
        {titre} — l'application ouvre WhatsApp avec un message déjà rédigé. Elle enregistre la date et
        l'auteur de chaque clic, mais ne peut pas savoir si le message a été réellement envoyé.
      </p>

      <Modal
        open={Boolean(prepare)}
        onClose={() => setPrepare(null)}
        title="Message au parent"
        subtitle={prepare ? `${prepare.nom} · ${formatPhone(prepare.parentPhone)}` : undefined}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPrepare(null)}>
              Fermer
            </Button>
            {prepare && (
              /* §13.8 : lien externe en nouvel onglet, toujours avec noopener noreferrer. */
              <Button
                as="a"
                href={prepare.lien}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setPrepare(null)}
              >
                <MessageCircle className="size-4" aria-hidden />
                Ouvrir WhatsApp
              </Button>
            )}
          </>
        }
      >
        {prepare && (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-surface-2 px-4 py-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
                Message
              </p>
              {/* Texte brut : React l'échappe, aucun HTML n'est interprété (§13.1). */}
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">
                {prepare.message}
              </p>
            </div>
            <p className="text-[12px] leading-relaxed text-faint">
              Le numéro et le message viennent du serveur. Le lien ouvre WhatsApp dans un nouvel
              onglet ; l'envoi reste à votre main.
            </p>
          </div>
        )}
      </Modal>
    </>
  )
}
