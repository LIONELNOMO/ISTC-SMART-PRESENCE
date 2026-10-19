import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { LogIn, WifiOff } from 'lucide-react'

import { useSession } from '../lib/session.jsx'
import { safeRedirect } from '../lib/safe-redirect.js'

/*
 * `__LOCAL__` est remplacé par le littéral `true`/`false` à la compilation
 * (vite.config.js → define). En production il vaut `false`, donc tout le bloc
 * de démonstration — bouton et mot de passe de test compris — est retiré du
 * bundle par le tree-shaking, et non pas seulement caché à l'affichage.
 */
const EST_LOCAL = __LOCAL__
import { Button } from '../components/ui/primitives.jsx'
import { Banner } from '../components/ui/surfaces.jsx'
import { Field, Input, PasswordInput } from '../components/ui/forms.jsx'
import { ModeAvionBouton } from '../components/app/NetworkBar.jsx'
import { PanneauMarque } from '../components/app/PanneauMarque.jsx'
import { LogoMark, LogoNom, Marque } from '../components/app/Logo.jsx'
import { LogoIstc } from '../components/app/LogoIstc.jsx'

/**
 * Une seule page de connexion pour les cinq rôles (§2).
 *
 * Deux mises en page, un seul formulaire :
 *   < 1024 px  la marque au-dessus, le formulaire en dessous — inchangé
 *   ≥ 1024 px  deux colonnes : panneau de présentation à gauche, formulaire à
 *              droite, chacun sur toute la hauteur
 *
 * §13.2 « Énumération de comptes » : le serveur renvoie le même message pour un
 * compte inconnu et pour un mot de passe faux. Cet écran se contente de
 * l'afficher, sans rien préciser de plus.
 */
export function Connexion() {
  const { pret, moi, connecter, enLigne, erreurSession, effacerErreurSession } =
    useSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [identifiant, setIdentifiant] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [erreur, setErreur] = useState(null)
  const [envoi, setEnvoi] = useState(false)
  const [demoEnCours, setDemoEnCours] = useState(false)
  const [demoFaite, setDemoFaite] = useState(false)

  useEffect(() => {
    if (erreurSession) {
      setErreur(erreurSession)
      effacerErreurSession()
    }
  }, [erreurSession, effacerErreurSession])

  if (!pret) return null
  if (moi) return <Navigate to={safeRedirect(params.get('suite'))} replace />

  const soumettre = async (event) => {
    event.preventDefault()
    setErreur(null)
    setEnvoi(true)
    const reponse = await connecter(identifiant.trim(), motDePasse)
    setEnvoi(false)
    if (!reponse.ok) {
      setErreur(reponse.message)
      setMotDePasse('')
      return
    }
    // §13.6 « Redirection ouverte » : la destination est filtrée.
    navigate(safeRedirect(params.get('suite')), { replace: true })
  }

  // Développement local uniquement : crée les comptes de démonstration.
  // Import dynamique, pour que ce code ne parte pas dans le bundle de production.
  const chargerDemo = async () => {
    setErreur(null)
    setDemoEnCours(true)
    const { installerDemo } = await import('../lib/serveur.js')
    const reponse = await installerDemo()
    setDemoEnCours(false)
    if (reponse.error) {
      setErreur(reponse.error.message)
      return
    }
    setDemoFaite(true)
    setIdentifiant('237699000001') // l'administration, prête à être connectée
  }

  const formulaire = (
    <form onSubmit={soumettre} className="space-y-4">
      <Field
        label="Identifiant"
        htmlFor="identifiant"
        required
        hint="Matricule pour un étudiant, numéro de téléphone pour les autres rôles."
      >
        <Input
          id="identifiant"
          value={identifiant}
          onChange={(event) => setIdentifiant(event.target.value)}
          autoComplete="username"
          autoCapitalize="characters"
          spellCheck={false}
          required
          maxLength={40}
          placeholder="INF1001 ou 237699000000"
        />
      </Field>

      <Field label="Mot de passe" htmlFor="motDePasse" required>
        <PasswordInput
          id="motDePasse"
          value={motDePasse}
          onChange={(event) => setMotDePasse(event.target.value)}
          required
          maxLength={128}
        />
      </Field>

      {erreur && <Banner tone="bad">{erreur}</Banner>}

      <Button type="submit" size="lg" className="w-full" loading={envoi} disabled={!enLigne}>
        <LogIn className="size-4" aria-hidden />
        Se connecter
      </Button>
    </form>
  )

  const avertissementReseau = !enLigne && (
    <Banner tone="warn" title="Aucune connexion" icon={<WifiOff className="size-[18px]" />}>
      La première connexion sur un appareil demande du réseau. Une fois connecté, votre session
      reste ouverte hors ligne.
    </Banner>
  )

  const noteComptes = (
    <p className="text-[12px] leading-relaxed text-faint">
      Les comptes sont créés par l'administration : il n'y a pas d'inscription libre. Mot de passe
      oublié ? L'administration le réinitialise et vous remet un mot de passe provisoire.
    </p>
  )

  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(26rem,0.95fr)] xl:grid-cols-[minmax(0,1.15fr)_minmax(28rem,0.85fr)]">
      {/* Grand écran : panneau de présentation. Absent du DOM en dessous de lg. */}
      <PanneauMarque />

      {/* Colonne du formulaire — c'est elle, seule, qu'on voit sur téléphone. */}
      <main className="relative flex min-h-dvh flex-col justify-center gouttiere py-10 lg:px-12 xl:px-16">
        {/* Filigrane de l'établissement, sur téléphone et tablette seulement :
            sur grand écran, le panneau de gauche porte déjà son identité. */}
        <LogoIstc className="filigrane-colonne lg:hidden" taille={320} aria-hidden />
        {/*
          Pas de `z-index` ici, volontairement : il créerait un contexte
          d'empilement qui isolerait l'emblème du filigrane, et le mode de
          fusion `multiply` ne verrait plus que le fond de page. L'ordre du DOM
          suffit — le filigrane est déclaré avant, il passe donc dessous.
        */}
        <div className="relative mx-auto w-full max-w-md">
          {/* Marque complète sur téléphone, en-tête sobre sur grand écran :
              le panneau de gauche porte déjà l'identité. */}
          {/* Sur téléphone, l'établissement se présente avant son application :
              son emblème, puis la marque du logiciel. */}
          <div className="mb-7 text-center lg:hidden">
            <div className="mb-5 flex flex-col items-center gap-2.5">
              {/* Ni cadre ni fond : le blanc du JPEG est fondu dans la page,
                  si bien que le filigrane se voit à travers l'emblème. */}
              <LogoIstc taille={132} className="logo-detoure" />
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-accent-text">
                Institut Supérieur des Technologies et de Commerce
              </p>
            </div>
            <span className="mx-auto mb-5 block h-px w-16 bg-line-strong" aria-hidden />
            <Marque className="mb-6" />
          </div>
          <div className="mb-8 hidden items-center gap-2.5 lg:flex">
            <LogoMark taille={34} arrondi="rounded-lg" />
            <LogoNom taille="text-[15px]" />
          </div>

          <h1 className="titre-fluide font-bold tracking-tight text-ink max-lg:text-center">
            Connexion
          </h1>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-faint max-lg:text-center">
            Accédez à votre espace personnel.
          </p>

          <div className="mt-6 space-y-5">
            {avertissementReseau}
            {formulaire}
            <div className="border-t border-line pt-4">{noteComptes}</div>
            {EST_LOCAL && (
              <div className="rounded-card border border-dashed border-line bg-surface-2 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
                  Développement local
                </p>
                {demoFaite ? (
                  <Banner tone="ok" className="mt-2">
                    Comptes de démonstration créés. Connectez-vous avec un identifiant du
                    tableau (ex. <strong>237699000001</strong>) et le mot de passe{' '}
                    <strong>Presences2026!</strong>.
                  </Banner>
                ) : (
                  <>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
                      La base locale est vide. Chargez l'établissement fictif pour obtenir les
                      comptes de test (mot de passe commun : <strong>Presences2026!</strong>).
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-3 w-full"
                      loading={demoEnCours}
                      onClick={chargerDemo}
                    >
                      Charger le jeu de démonstration
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-center">
            <ModeAvionBouton />
          </div>
        </div>
      </main>
    </div>
  )
}
