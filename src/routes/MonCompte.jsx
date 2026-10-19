import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, ShieldCheck, UserCog } from 'lucide-react'

import { useSession } from '../lib/session.jsx'
import { enqueue, synchroniser } from '../lib/sync.js'
import { passwordProblem, PASSWORD_MIN } from '../lib/crypto.js'
import { ESPACES, espacesDisponibles } from '../app/navigation.js'
import { PageHeader } from '../components/app/AppShell.jsx'
import { Badge, Button } from '../components/ui/primitives.jsx'
import { Banner, Card, CardBody, CardHeader } from '../components/ui/surfaces.jsx'
import { Field, Input, PasswordInput } from '../components/ui/forms.jsx'
import { KeyValue } from '../components/ui/data.jsx'
import { useToast } from '../components/ui/overlays.jsx'

export function MonCompte() {
  const { moi, changerMonMotDePasse, roles } = useSession()
  const navigate = useNavigate()
  const toast = useToast()

  const [actuel, setActuel] = useState('')
  const [nouveau, setNouveau] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [erreur, setErreur] = useState(null)
  const [envoi, setEnvoi] = useState(false)

  // Profil
  const [prenom, setPrenom] = useState(moi?.prenom ?? '')
  const [nom, setNom] = useState(moi?.nom ?? '')
  const [telephone, setTelephone] = useState(moi?.telephone ?? '')
  const [erreurProfil, setErreurProfil] = useState(null)
  const [envoiProfil, setEnvoiProfil] = useState(false)

  const impose = Boolean(moi?.mustChangePassword)
  const estEtudiant = (moi?.roles ?? []).includes('etudiant')

  const enregistrerProfil = async (event) => {
    event.preventDefault()
    setErreurProfil(null)
    if (!prenom.trim() || !nom.trim()) {
      setErreurProfil('Le prénom et le nom sont obligatoires.')
      return
    }
    setEnvoiProfil(true)
    const reponse = await enqueue(
      'compte.profil',
      { prenom: prenom.trim(), nom: nom.trim(), telephone: telephone.trim() || undefined },
      { labelPourUtilisateur: 'Mise à jour du profil' },
    )
    setEnvoiProfil(false)
    if (!reponse.ok && !reponse.enAttente) {
      setErreurProfil(reponse.error?.message ?? 'Mise à jour refusée.')
      return
    }
    await synchroniser({ silencieux: true })
    toast.succes(
      'Profil mis à jour',
      reponse.data?.identifiantChange
        ? 'Votre identifiant de connexion a aussi changé.'
        : 'Vos informations ont été enregistrées.',
    )
  }

  const soumettre = async (event) => {
    event.preventDefault()
    setErreur(null)

    if (nouveau !== confirmation) {
      setErreur('Les deux mots de passe ne correspondent pas.')
      return
    }
    const probleme = passwordProblem(nouveau)
    if (probleme) {
      setErreur(probleme)
      return
    }

    setEnvoi(true)
    const reponse = await changerMonMotDePasse(actuel, nouveau)
    setEnvoi(false)

    if (!reponse.ok) {
      setErreur(reponse.message)
      return
    }

    toast.succes(
      'Mot de passe changé',
      'Vos autres sessions ont été fermées. Cet appareil reste connecté.',
    )
    setActuel('')
    setNouveau('')
    setConfirmation('')
    const premier = espacesDisponibles(roles)[0]
    navigate(premier?.racine ?? '/')
  }

  return (
    <>
      <PageHeader
        title="Mon profil"
        subtitle="Vos informations et votre mot de passe."
      />

      {impose && (
        <Banner
          tone="warn"
          title="Changement de mot de passe obligatoire"
          className="mb-4"
          icon={<ShieldCheck className="size-[18px]" />}
        >
          Votre compte utilise encore un mot de passe provisoire. Choisissez-en un nouveau pour
          accéder à votre espace.
        </Banner>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Mes informations"
            subtitle="Modifiez votre identité."
            icon={<UserCog className="size-4" aria-hidden />}
          />
          <CardBody>
            <form onSubmit={enregistrerProfil} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Prénom" required htmlFor="prenom">
                  <Input
                    id="prenom"
                    value={prenom}
                    onChange={(event) => setPrenom(event.target.value)}
                    maxLength={80}
                    required
                  />
                </Field>
                <Field label="Nom" required htmlFor="nom">
                  <Input
                    id="nom"
                    value={nom}
                    onChange={(event) => setNom(event.target.value)}
                    maxLength={80}
                    required
                  />
                </Field>
              </div>

              <Field
                label="Téléphone"
                htmlFor="telephone"
                hint={
                  estEtudiant
                    ? 'Facultatif.'
                    : "C'est aussi votre identifiant de connexion : le changer change votre identifiant."
                }
              >
                <Input
                  id="telephone"
                  type="tel"
                  value={telephone}
                  onChange={(event) => setTelephone(event.target.value)}
                  inputMode="numeric"
                  maxLength={20}
                  placeholder="237600000000"
                />
              </Field>

              <KeyValue
                columns={1}
                items={[
                  { label: 'Identifiant de connexion actuel', value: moi?.login ?? '—', mono: true },
                ]}
              />

              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
                  Rôles
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(moi?.roles ?? []).map((role) => (
                    <Badge key={role} tone="brand">
                      {ESPACES[role]?.label ?? role}
                    </Badge>
                  ))}
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-faint">
                  Vos rôles sont fixés par l'administration et ne se changent pas ici.
                </p>
              </div>

              {erreurProfil && <Banner tone="warn">{erreurProfil}</Banner>}

              <Button type="submit" className="w-full" loading={envoiProfil}>
                Enregistrer mes informations
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Changer mon mot de passe"
            subtitle="Le mot de passe actuel est exigé, et vos autres sessions seront fermées."
            icon={<KeyRound className="size-4" aria-hidden />}
          />
          <CardBody>
            <form onSubmit={soumettre} className="space-y-4">
              <Field label="Mot de passe actuel" required htmlFor="actuel">
                <PasswordInput
                  id="actuel"
                  value={actuel}
                  onChange={(event) => setActuel(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Nouveau mot de passe"
                  required
                  htmlFor="nouveau"
                  hint={`${PASSWORD_MIN} caractères minimum.`}
                >
                  <PasswordInput
                    id="nouveau"
                    value={nouveau}
                    onChange={(event) => setNouveau(event.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </Field>
                <Field label="Confirmation" required htmlFor="confirmation">
                  <PasswordInput
                    id="confirmation"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </Field>
              </div>

              {erreur && <Banner tone="bad">{erreur}</Banner>}

              <Button type="submit" loading={envoi} className="w-full sm:w-auto">
                Enregistrer le nouveau mot de passe
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  )
}
