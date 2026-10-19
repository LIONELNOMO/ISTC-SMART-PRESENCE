import { useEffect, useMemo, useState } from 'react'
import { CheckCheck, KeyRound, Users, X } from 'lucide-react'

import { useProjection, useSession } from '../../lib/session.jsx'
import { enqueue, synchroniser } from '../../lib/sync.js'
import { normalizeSessionCode, isSessionCodeShape } from '../../lib/qr-codes.js'
import { cn } from '../../lib/utils.js'
import { Badge, Button } from '../../components/ui/primitives.jsx'
import { Banner, Card, CardBody, CardHeader, Meter } from '../../components/ui/surfaces.jsx'
import { CheckRow, CodeInput, Field, Input } from '../../components/ui/forms.jsx'
import { useToast } from '../../components/ui/overlays.jsx'

/**
 * Relevé des présences (§5) : liste à cocher, compteur, et validation par le
 * code de séance.
 *
 * La liste fonctionne sans réseau, à partir des étudiants reçus dans la
 * projection (§9). Le code de séance est vérifié par le serveur, immédiatement
 * ou à la synchronisation.
 */
export function ListeAppel({ seance, onValide, titre = 'Relevé des présences' }) {
  const { enLigne } = useSession()
  const enseignant = useProjection('enseignant')
  const toast = useToast()

  const liste = useMemo(() => {
    const tous = enseignant?.listes?.find((l) => l.classeId === seance?.classeId)?.etudiants ?? []
    // §4 : on ne coche que les étudiants de la SECTION de la séance.
    const section = seance?.section ?? 'francophone'
    return tous.filter((e) => (e.section ?? 'francophone') === section)
  }, [enseignant, seance])
  const scans = useMemo(
    () => new Set(enseignant?.scansParSeance?.[seance?.id] ?? []),
    [enseignant, seance],
  )

  const [coches, setCoches] = useState(() => new Set())
  const [code, setCode] = useState('')
  const [comptePhysique, setComptePhysique] = useState('')
  const [recherche, setRecherche] = useState('')
  const [erreur, setErreur] = useState(null)
  const [envoi, setEnvoi] = useState(false)
  const [essaisRestants, setEssaisRestants] = useState(null)

  // Au premier affichage, on part des scans reçus et des coches déjà validées.
  useEffect(() => {
    if (!seance) return
    const depart = new Set(seance.presentsCoches?.length ? seance.presentsCoches : [...scans])
    setCoches(depart)
  }, [seance?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtres = useMemo(() => {
    const terme = recherche.trim().toLowerCase()
    if (!terme) return liste
    return liste.filter(
      (etudiant) =>
        etudiant.nom.toLowerCase().includes(terme) ||
        etudiant.matricule.toLowerCase().includes(terme),
    )
  }, [liste, recherche])

  if (!seance) return null

  const basculer = (id) => {
    setCoches((precedent) => {
      const suivant = new Set(precedent)
      if (suivant.has(id)) suivant.delete(id)
      else suivant.add(id)
      return suivant
    })
  }

  const valider = async () => {
    setErreur(null)
    const propre = normalizeSessionCode(code)
    if (!isSessionCodeShape(propre)) {
      setErreur('Le code de séance compte 6 caractères. Demandez-le au secrétariat.')
      return
    }

    setEnvoi(true)
    const reponse = await enqueue(
      'releve.valider',
      {
        sessionId: seance.id ?? null,
        matiereId: seance.matiereId,
        code: propre,
        presents: [...coches],
        comptePhysique: comptePhysique === '' ? null : Number(comptePhysique),
      },
      { labelPourUtilisateur: `Relevé — ${seance.matiere}` },
    )
    setEnvoi(false)

    if (reponse.enAttente) {
      toast.info(
        'Relevé en attente',
        'Le code sera vérifié par le serveur à la prochaine synchronisation.',
      )
      onValide?.({ enAttente: true })
      return
    }

    if (!reponse.ok) {
      setErreur(reponse.error?.message ?? 'Validation impossible.')
      return
    }

    // Le serveur renvoie ok:false quand le code est faux : le relevé est gardé,
    // mais la séance reste incomplète (§4).
    if (reponse.data?.ok === false) {
      setErreur(reponse.data.message)
      setEssaisRestants(reponse.data.essaisRestants ?? null)
      synchroniser({ silencieux: true })
      return
    }

    setCode('')
    setEssaisRestants(null)
    const ecarts = reponse.data?.ecarts ?? []
    if (ecarts.length) {
      toast.attention('Relevé validé, avec un écart', ecarts.map((e) => e.message).join(' '))
    } else {
      toast.succes('Relevé validé', `${reponse.data.presents}/${reponse.data.effectif} présents.`)
    }
    await synchroniser({ silencieux: true })
    onValide?.(reponse.data)
  }

  const nombreScans = scans.size

  return (
    <Card>
      <CardHeader
        title={titre}
        subtitle={`${seance.matiere} · ${seance.classe}`}
        icon={<Users className="size-4" aria-hidden />}
        actions={
          <Badge tone={coches.size === liste.length && liste.length > 0 ? 'ok' : 'brand'}>
            {coches.size} / {liste.length}
          </Badge>
        }
      />
      <CardBody className="space-y-4">
        {/* Compteur de présents (§5) */}
        <div className="rounded-xl border border-line bg-surface-2 px-4 py-3">
          <Meter
            value={coches.size}
            max={Math.max(liste.length, 1)}
            tone={coches.size === 0 ? 'bad' : 'ok'}
            label="Présents cochés"
          />
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-faint">
            <span>
              Scans reçus :{' '}
              <span className="font-semibold text-soft">{enLigne ? nombreScans : '—'}</span>
            </span>
            {!enLigne && (
              <span className="text-warn">
                Hors ligne : ce téléphone ne reçoit pas les scans en direct.
              </span>
            )}
          </div>
        </div>

        {!enLigne && (
          <Field
            label="Nombre de personnes comptées dans la salle"
            htmlFor="comptePhysique"
            hint="À la synchronisation, ce nombre sera comparé aux scans reçus. Tout écart vous sera signalé."
          >
            <Input
              id="comptePhysique"
              type="number"
              inputMode="numeric"
              min={0}
              max={500}
              value={comptePhysique}
              onChange={(event) => setComptePhysique(event.target.value)}
              className="max-w-[160px]"
              placeholder="30"
            />
          </Field>
        )}

        {/* Liste à cocher */}
        <div>
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <Input
              value={recherche}
              onChange={(event) => setRecherche(event.target.value)}
              placeholder="Rechercher un nom ou un matricule"
              className="h-10 flex-1 sm:max-w-xs"
              maxLength={40}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setCoches(new Set(liste.map((e) => e.id)))}
            >
              <CheckCheck className="size-4" aria-hidden />
              Tout cocher
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCoches(new Set())}>
              <X className="size-4" aria-hidden />
              Tout décocher
            </Button>
          </div>

          {liste.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-faint">
              Aucune liste d'étudiants reçue pour cette classe. Synchronisez l'application une fois
              en ligne.
            </p>
          ) : (
            <ul className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
              {filtres.map((etudiant) => (
                <li key={etudiant.id}>
                  <CheckRow
                    checked={coches.has(etudiant.id)}
                    onChange={() => basculer(etudiant.id)}
                    title={etudiant.nom}
                    subtitle={etudiant.matricule}
                    right={
                      scans.has(etudiant.id) ? (
                        <Badge tone="info">a scanné</Badge>
                      ) : null
                    }
                  />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[12px] leading-relaxed text-faint">
            Vous pouvez cocher ou décocher n'importe qui, y compris un étudiant qui a scanné : votre
            décision l'emporte toujours sur le scan.
          </p>
        </div>

        {/* Validation par le code de séance */}
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-brand-soft text-brand-text">
              <KeyRound className="size-4" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">Valider le relevé</p>
              <p className="text-[12px] text-faint">
                Saisissez le code de séance remis par le secrétariat.
              </p>
            </div>
          </div>

          <CodeInput
            value={code}
            onChange={(event) => setCode(normalizeSessionCode(event.target.value))}
            placeholder="______"
            invalid={Boolean(erreur)}
            aria-label="Code de séance"
          />

          {essaisRestants !== null && (
            <p
              className={cn(
                'mt-2 text-center text-[12px] font-medium',
                essaisRestants === 0 ? 'text-bad' : 'text-warn',
              )}
            >
              {essaisRestants === 0
                ? 'Trop d’essais : la validation est bloquée temporairement.'
                : `${essaisRestants} essai${essaisRestants > 1 ? 's' : ''} restant${essaisRestants > 1 ? 's' : ''} avant blocage.`}
            </p>
          )}

          {erreur && (
            <Banner tone="bad" className="mt-3">
              {erreur}
            </Banner>
          )}

          <Button onClick={valider} loading={envoi} size="lg" className="mt-3 w-full">
            Valider le relevé
          </Button>

          {!enLigne && (
            <p className="mt-2 text-center text-[12px] text-faint">
              Hors ligne, le relevé est gardé sur cet appareil et le code sera vérifié à la
              synchronisation.
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
