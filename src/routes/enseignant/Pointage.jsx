import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Clock3, LogIn, LogOut, ScanLine, WifiOff } from 'lucide-react'

import { useProjection, useSession } from '../../lib/session.jsx'
import { enqueue, synchroniser } from '../../lib/sync.js'
import { parsePointageQr } from '../../lib/qr-codes.js'
import { formatTime } from '../../lib/dates.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { AvisEnseignant } from '../../components/app/AvisEnseignant.jsx'
import { QrScanner } from '../../components/qr/QrScanner.jsx'
import { Badge, Button, CodeDisplay } from '../../components/ui/primitives.jsx'
import { Banner, Card, CardBody, CardHeader, EmptyState } from '../../components/ui/surfaces.jsx'
import { Field, Select } from '../../components/ui/forms.jsx'
import { useToast } from '../../components/ui/overlays.jsx'
import { StatutSeance } from '../../components/app/SessionBits.jsx'

/**
 * Pointage de l'enseignant (§4, §10).
 *
 * Le scan du code affiché par la secrétaire DEMANDE UNE CONNEXION : la fenêtre
 * de 60 secondes ne peut être vérifiée que contre l'heure du serveur. Sans
 * réseau, le §4 prévoit que la secrétaire pointe elle-même, et l'écran le dit.
 */
export function EnseignantPointage() {
  const { enLigne } = useSession()
  const enseignant = useProjection('enseignant')
  const toast = useToast()

  const [matiereId, setMatiereId] = useState('')
  const [occupe, setOccupe] = useState(false)
  const [dernier, setDernier] = useState(null)
  const [erreur, setErreur] = useState(null)

  const ouverte = enseignant?.seanceEnCours ?? null
  const matieres = enseignant?.matieres ?? []
  const sens = ouverte ? 'depart' : 'arrivee'

  const traiter = useCallback(
    async (texte) => {
      if (occupe) return
      setErreur(null)

      const parsed = parsePointageQr(texte)
      if (!parsed) {
        setErreur(
          "Ce code n'est pas un code de pointage du secrétariat. Vérifiez que vous visez bien l'écran de la secrétaire.",
        )
        return
      }

      if (sens === 'arrivee' && !matiereId) {
        setErreur('Choisissez d’abord la matière que vous venez enseigner.')
        return
      }

      setOccupe(true)
      const reponse = await enqueue(
        'pointage.scan',
        { qr: texte, matiereId: sens === 'arrivee' ? matiereId : null },
        { labelPourUtilisateur: sens === 'arrivee' ? "Pointage d'arrivée" : 'Pointage de départ' },
      )
      setOccupe(false)

      if (!reponse.ok) {
        setErreur(reponse.error?.message ?? 'Pointage refusé.')
        return
      }

      await synchroniser({ silencieux: true })
      setDernier({ ...reponse.data, at: new Date().toISOString() })
      toast.succes(
        reponse.data.sens === 'arrivee' ? 'Arrivée enregistrée' : 'Départ enregistré',
        reponse.data.sens === 'arrivee'
          ? 'Votre code de séance est affiché à l’écran.'
          : 'Votre séance est clôturée côté secrétariat.',
      )
    },
    [matiereId, occupe, sens, toast],
  )

  if (!enseignant) {
    return (
      <EmptyState icon={<ScanLine className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer vos matières.
      </EmptyState>
    )
  }

  return (
    <>
      <PageHeader
        title="Pointage au secrétariat"
        subtitle="Scannez le code affiché par la secrétaire pour enregistrer votre arrivée ou votre départ."
      />

      <AvisEnseignant avis={enseignant?.avis ?? []} />

      {!enLigne && (
        <Banner
          tone="warn"
          className="mb-4"
          title="Le scan de pointage demande une connexion"
          icon={<WifiOff className="size-[18px]" />}
        >
          Le code du secrétariat change toutes les 60 secondes et seul le serveur peut vérifier cette
          fenêtre : un scan accepté hors ligne laisserait passer une photo du code. Demandez à la
          secrétaire de pointer votre arrivée depuis son poste — elle vous remettra le code de
          séance, et vous pourrez faire votre relevé hors ligne.
        </Banner>
      )}

      {ouverte && (
        <Card className="mb-4 border-warn/35 bg-warn-soft/35">
          <CardBody>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[15px] font-semibold text-ink">{ouverte.matiere}</h2>
                  <StatutSeance statut={ouverte.status} />
                </div>
                <p className="mt-0.5 text-[13px] text-faint">
                  {ouverte.classe} · arrivée pointée à{' '}
                  <span className="font-mono font-semibold text-soft">
                    {formatTime(ouverte.arrivalAt)}
                  </span>
                </p>
              </div>
              <Button as={Link} to="/enseignant/seance" variant="secondary" size="sm">
                Séance en cours
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3 space-y-4">
          {sens === 'arrivee' && (
            <Card>
              <CardHeader
                title="Matière que vous venez enseigner"
                subtitle="Obligatoire pour un pointage d'arrivée."
                icon={<LogIn className="size-4" aria-hidden />}
              />
              <CardBody>
                <Field label="Matière" required htmlFor="matiere">
                  <Select
                    id="matiere"
                    value={matiereId}
                    onChange={(event) => setMatiereId(event.target.value)}
                  >
                    <option value="">Choisir une matière…</option>
                    {matieres.map((matiere) => (
                      <option key={matiere.id} value={matiere.id}>
                        {matiere.nom} — {matiere.classe}
                      </option>
                    ))}
                  </Select>
                </Field>
                {matieres.length === 0 && (
                  <p className="mt-2 text-[12px] text-bad">
                    Aucune matière ne vous est affectée. Contactez l'administration.
                  </p>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader
              title={sens === 'arrivee' ? "Scanner pour pointer l'arrivée" : 'Scanner pour pointer le départ'}
              subtitle="Code QR de pointage affiché sur l'écran de la secrétaire."
              icon={
                sens === 'arrivee' ? (
                  <LogIn className="size-4" aria-hidden />
                ) : (
                  <LogOut className="size-4" aria-hidden />
                )
              }
              actions={<Badge tone={sens === 'arrivee' ? 'ok' : 'warn'}>{sens === 'arrivee' ? 'Arrivée' : 'Départ'}</Badge>}
            />
            <CardBody>
              <QrScanner
                onScan={traiter}
                active={enLigne}
                hauteur={320}
                consigne={
                  sens === 'arrivee'
                    ? 'Code de pointage du secrétariat'
                    : 'Code de pointage — départ'
                }
              />
              {!enLigne && (
                <p className="mt-3 text-center text-[13px] text-faint">
                  Caméra désactivée hors ligne : ce pointage ne pourrait pas être vérifié.
                </p>
              )}
              {erreur && (
                <Banner tone="bad" className="mt-3">
                  {erreur}
                </Banner>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {dernier?.code ? (
            <Card className="border-ok/35">
              <CardHeader
                title="Votre code de séance"
                subtitle="À saisir pour valider votre relevé de présences."
                icon={<Clock3 className="size-4" aria-hidden />}
              />
              <CardBody className="space-y-4">
                <CodeDisplay code={dernier.code} />
                <p className="text-center text-[12px] leading-relaxed text-faint">
                  Ce code ne vaut que pour cette séance. Il est aussi affiché sur l'écran de la
                  secrétaire.
                </p>
                <Button as={Link} to="/enseignant/seance" className="w-full">
                  Ouvrir le relevé de présences
                </Button>
              </CardBody>
            </Card>
          ) : ouverte?.code ? (
            <Card>
              <CardHeader title="Code de séance en cours" />
              <CardBody className="space-y-3">
                <CodeDisplay code={ouverte.code} />
                <p className="text-center text-[12px] text-faint">
                  Séance ouverte à {formatTime(ouverte.arrivalAt)}.
                </p>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Déroulement" />
              <CardBody>
                <ol className="space-y-3 text-[13px] leading-relaxed text-faint">
                  {[
                    'Vous passez au secrétariat et scannez le code affiché.',
                    'L’application vous remet un code de séance à 6 caractères.',
                    'Les étudiants de la classe reçoivent la notification de début de cours.',
                    'En fin de cours, vous relevez les présences et saisissez ce code.',
                    'Vous repassez au secrétariat pour pointer votre départ.',
                  ].map((etape, index) => (
                    <li key={etape} className="flex gap-3">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-bold text-soft">
                        {index + 1}
                      </span>
                      <span>{etape}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-4 border-t border-line pt-3 text-[12px] leading-relaxed text-faint">
                  Les heures payées vont de votre arrivée à votre départ pointés au secrétariat.
                  L'heure du relevé ne les allonge jamais.
                </p>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
