import { useCallback, useState } from 'react'
import { CheckCircle2, Clock, QrCode, ShieldAlert } from 'lucide-react'

import { useProjection, useSession } from '../../lib/session.jsx'
import { enqueue } from '../../lib/sync.js'
import { deviceId } from '../../lib/device.js'
import { parsePresenceQr } from '../../lib/qr-codes.js'
import { formatTime } from '../../lib/dates.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { QrScanner } from '../../components/qr/QrScanner.jsx'
import { Button } from '../../components/ui/primitives.jsx'
import { Banner, Card, CardBody } from '../../components/ui/surfaces.jsx'
import { useToast } from '../../components/ui/overlays.jsx'

/**
 * Scanner de l'étudiant (§5, §10).
 *
 * Avec réseau : le scan part aussitôt et l'étudiant est « présent ».
 * Sans réseau : le scan est « en attente », puis devient « présent » après
 * synchronisation. C'est le serveur qui décide, pas cet écran.
 */
export function EtudiantScanner() {
  const { enLigne } = useSession()
  const etudiant = useProjection('etudiant')
  const toast = useToast()

  const [resultat, setResultat] = useState(null)
  const [occupe, setOccupe] = useState(false)

  const traiter = useCallback(
    async (texte) => {
      if (occupe) return
      // §13.1 : le contenu du QR est analysé au format strict, jamais ouvert.
      const parsed = parsePresenceQr(texte)
      if (!parsed) {
        setResultat({
          tone: 'bad',
          titre: "Ce code n'est pas un code de présence",
          detail:
            "Demandez à votre enseignant d'afficher le code de présence de la séance depuis son application.",
        })
        return
      }

      setOccupe(true)
      const reponse = await enqueue(
        'presence.scan',
        { qr: texte, deviceId: deviceId() },
        { labelPourUtilisateur: 'Scan de présence' },
      )
      setOccupe(false)

      if (reponse.enAttente) {
        setResultat({
          tone: 'warn',
          titre: 'En attente',
          detail:
            'Votre scan est enregistré sur ce téléphone. Il sera envoyé au retour du réseau, puis vous serez marqué présent.',
          at: new Date().toISOString(),
        })
        return
      }

      if (!reponse.ok) {
        setResultat({ tone: 'bad', titre: 'Scan refusé', detail: reponse.error?.message })
        toast.erreur('Scan refusé', reponse.error?.message)
        return
      }

      const statut = reponse.data?.status
      if (statut === 'present') {
        setResultat({
          tone: 'ok',
          titre: reponse.data.duplicate ? 'Déjà présent' : 'Présent',
          detail: reponse.data.duplicate
            ? 'Votre présence était déjà enregistrée pour cette séance.'
            : 'Votre présence est enregistrée sur le serveur.',
          at: new Date().toISOString(),
        })
        toast.succes('Présence enregistrée')
      } else if (statut === 'attente_seance') {
        setResultat({
          tone: 'warn',
          titre: 'En attente de la séance',
          detail:
            "Le serveur ne connaît pas encore cette séance : le secrétariat n'a pas fini de se synchroniser. Votre scan est conservé et sera rattaché automatiquement.",
          at: new Date().toISOString(),
        })
      }
    },
    [occupe, toast],
  )

  return (
    <>
      <PageHeader
        title="Scanner le code de présence"
        subtitle="Visez le code QR affiché sur le téléphone de votre enseignant."
      />

      {!enLigne && (
        <Banner tone="info" className="mb-4" title="Hors ligne">
          Le scan fonctionne sans réseau. Il restera « en attente » jusqu'à la prochaine
          synchronisation.
        </Banner>
      )}

      {!etudiant?.seanceOuverte && (
        <Banner tone="warn" className="mb-4" title="Aucun relevé ouvert à ma connaissance">
          D'après les dernières données reçues, aucun relevé n'est ouvert pour votre classe. Vous
          pouvez tout de même scanner : le serveur tranchera.
        </Banner>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <QrScanner onScan={traiter} hauteur={340} consigne="Code de présence de la séance" />
        </div>

        <div className="lg:col-span-2">
          {resultat ? (
            <Card>
              <CardBody className="space-y-4 text-center">
                <span
                  className={`mx-auto flex size-14 items-center justify-center rounded-2xl ${
                    resultat.tone === 'ok'
                      ? 'bg-ok-soft text-ok'
                      : resultat.tone === 'warn'
                        ? 'bg-warn-soft text-warn'
                        : 'bg-bad-soft text-bad'
                  }`}
                >
                  {resultat.tone === 'ok' ? (
                    <CheckCircle2 className="size-7" aria-hidden />
                  ) : resultat.tone === 'warn' ? (
                    <Clock className="size-7" aria-hidden />
                  ) : (
                    <ShieldAlert className="size-7" aria-hidden />
                  )}
                </span>
                <div>
                  <p className="text-lg font-bold text-ink">{resultat.titre}</p>
                  {resultat.at && (
                    <p className="mt-0.5 font-mono text-[12px] text-faint">
                      {formatTime(resultat.at)}
                    </p>
                  )}
                  <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-faint">
                    {resultat.detail}
                  </p>
                </div>
                <Button variant="secondary" onClick={() => setResultat(null)} className="w-full">
                  Scanner à nouveau
                </Button>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardBody className="space-y-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand-text">
                  <QrCode className="size-5" aria-hidden />
                </span>
                <h2 className="text-sm font-semibold text-ink">Comment ça marche</h2>
                <ol className="space-y-2 text-[13px] leading-relaxed text-faint">
                  <li>
                    <span className="font-semibold text-soft">1.</span> L'enseignant appuie sur
                    « Afficher le code de présence ».
                  </li>
                  <li>
                    <span className="font-semibold text-soft">2.</span> Vous visez ce code avec cet
                    écran.
                  </li>
                  <li>
                    <span className="font-semibold text-soft">3.</span> Vous voyez « Présent », ou
                    « En attente » si vous êtes hors réseau.
                  </li>
                </ol>
                <p className="border-t border-line pt-3 text-[12px] leading-relaxed text-faint">
                  Un scan n'est accepté que pour votre propre classe, pendant que le relevé est
                  ouvert. L'enseignant peut ensuite modifier la liste : sa décision l'emporte.
                </p>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
