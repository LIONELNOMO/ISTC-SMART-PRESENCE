import { useState } from 'react'
import { Link } from 'react-router-dom'
import { EyeOff, QrCode, Users } from 'lucide-react'

import { useProjection } from '../../lib/session.jsx'
import { enqueue, synchroniser } from '../../lib/sync.js'
import { buildPresenceQr } from '../../lib/qr-codes.js'
import { formatTime } from '../../lib/dates.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { QrImage } from '../../components/qr/QrImage.jsx'
import { Badge, Button, CodeDisplay } from '../../components/ui/primitives.jsx'
import { Banner, Card, CardBody, CardHeader, EmptyState } from '../../components/ui/surfaces.jsx'
import { KeyValue } from '../../components/ui/data.jsx'
import { useToast } from '../../components/ui/overlays.jsx'
import { StatutSeance } from '../../components/app/SessionBits.jsx'
import { ListeAppel } from './ListeAppel.jsx'

/**
 * Séance en cours (§10) : code QR de présence, liste à cocher, compteur de
 * présents, validation par le code de séance.
 *
 * Le code QR de présence est produit sur le téléphone, sans réseau (§5). Il
 * contient le jeton secret de la séance : un scan sans ce jeton est refusé par le
 * serveur (§13.4).
 */
export function EnseignantSeance() {
  const enseignant = useProjection('enseignant')
  const toast = useToast()
  const [afficheQr, setAfficheQr] = useState(false)
  const [occupe, setOccupe] = useState(false)

  const seance = enseignant?.seanceEnCours ?? null

  if (!seance) {
    return (
      <>
        <PageHeader title="Séance en cours" />
        <EmptyState icon={<Users className="size-5" />} title="Aucune séance ouverte">
          Votre arrivée doit être pointée au secrétariat pour ouvrir une séance. Si vous avez déjà
          fait cours, saisissez votre relevé depuis l'écran « Relevé ».
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button as={Link} to="/enseignant" variant="secondary" size="sm">
              Aller au pointage
            </Button>
            <Button as={Link} to="/enseignant/releve" variant="ghost" size="sm">
              Relevé après le cours
            </Button>
          </div>
        </EmptyState>
      </>
    )
  }

  const releveOuvert = Boolean(seance.rollOpenedAt && !seance.rollClosedAt)
  const qr = buildPresenceQr({ sessionId: seance.id, scanToken: seance.scanToken })

  const basculerReleve = async (ouvrir) => {
    setOccupe(true)
    const reponse = await enqueue(
      ouvrir ? 'releve.ouvrir' : 'releve.fermer',
      { sessionId: seance.id },
      { labelPourUtilisateur: ouvrir ? 'Ouverture du relevé' : 'Fermeture du relevé' },
    )
    setOccupe(false)
    if (!reponse.ok && !reponse.enAttente) {
      toast.erreur('Action refusée', reponse.error?.message)
      return
    }
    setAfficheQr(ouvrir)
    await synchroniser({ silencieux: true })
  }

  return (
    <>
      <PageHeader
        title={seance.matiere}
        subtitle={`${seance.classe} · arrivée pointée à ${formatTime(seance.arrivalAt)}`}
        actions={<StatutSeance statut={seance.status} />}
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="Code QR de présence"
              subtitle="Les étudiants de la classe le scannent avec leur application."
              icon={<QrCode className="size-4" aria-hidden />}
              actions={
                <Badge tone={releveOuvert ? 'ok' : 'neutral'} dot>
                  {releveOuvert ? 'Relevé ouvert' : 'Relevé fermé'}
                </Badge>
              }
            />
            <CardBody className="space-y-4">
              {afficheQr && releveOuvert ? (
                <>
                  <div className="flex justify-center">
                    <QrImage value={qr} size={248} label="Code de présence de la séance" />
                  </div>
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => setAfficheQr(false)}
                  >
                    <EyeOff className="size-4" aria-hidden />
                    Masquer le code
                  </Button>
                </>
              ) : (
                <div className="space-y-3">
                  <p className="text-[13px] leading-relaxed text-faint">
                    Le code reste identique pendant toute la séance. Un scan n'est accepté que
                    pendant que le relevé est ouvert, avec 5 minutes de tolérance pour les écarts
                    d'horloge.
                  </p>
                  <Button
                    size="lg"
                    className="w-full"
                    loading={occupe}
                    onClick={async () => {
                      if (!releveOuvert) await basculerReleve(true)
                      setAfficheQr(true)
                    }}
                  >
                    <QrCode className="size-4" aria-hidden />
                    Afficher le code de présence
                  </Button>
                </div>
              )}

              {releveOuvert && (
                <Button
                  variant="outline"
                  className="w-full"
                  loading={occupe}
                  onClick={() => basculerReleve(false)}
                >
                  Fermer le relevé aux scans
                </Button>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Rappel de la séance" />
            <CardBody className="space-y-4">
              <KeyValue
                columns={2}
                items={[
                  { label: 'Arrivée', value: formatTime(seance.arrivalAt), mono: true },
                  {
                    label: 'Départ',
                    value: 'à pointer au secrétariat',
                    tone: 'faint',
                  },
                  { label: 'Effectif', value: `${seance.effectif} étudiants` },
                  {
                    label: 'Ouverture du relevé',
                    value: seance.rollOpenedAt ? formatTime(seance.rollOpenedAt) : '—',
                    mono: Boolean(seance.rollOpenedAt),
                  },
                ]}
              />
              <div className="border-t border-line pt-4">
                <CodeDisplay code={seance.code} label="Code de séance" />
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="lg:col-span-3">
          <ListeAppel seance={seance} onValide={() => toast.info('Relevé enregistré')} />

          <Banner tone="info" className="mt-4" title="Et le départ ?">
            La séance ne sera comptée dans vos heures qu'une fois votre départ pointé au secrétariat.
            Les heures payées vont de l'arrivée au départ : l'heure du relevé ne les allonge pas.
          </Banner>
        </div>
      </div>
    </>
  )
}
