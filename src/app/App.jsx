import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useSession } from '../lib/session.jsx'
import { AppShell } from '../components/app/AppShell.jsx'
import { Spinner } from '../components/ui/primitives.jsx'
import { LogoMark } from '../components/app/Logo.jsx'
import { ESPACES, espacesDisponibles } from './navigation.js'

import { Connexion } from '../routes/Connexion.jsx'
import { ChoixEspace } from '../routes/ChoixEspace.jsx'
import { MonCompte } from '../routes/MonCompte.jsx'


/**
 * Chargement différé par espace.
 *
 * Exigence du §11 : « L'application reste fluide sur un téléphone Android
 * d'entrée de gamme et une connexion lente. » Un étudiant ne télécharge donc pas
 * les écrans de l'administration, ni la bibliothèque de lecture de codes QR tant
 * qu'il n'ouvre pas le scanner.
 */
const EtudiantAccueil = lazy(() =>
  import('../routes/etudiant/Accueil.jsx').then((m) => ({ default: m.EtudiantAccueil })),
)
const EtudiantScanner = lazy(() =>
  import('../routes/etudiant/Scanner.jsx').then((m) => ({ default: m.EtudiantScanner })),
)
const EtudiantSeances = lazy(() =>
  import('../routes/etudiant/Seances.jsx').then((m) => ({ default: m.EtudiantSeances })),
)

const EnseignantPointage = lazy(() =>
  import('../routes/enseignant/Pointage.jsx').then((m) => ({ default: m.EnseignantPointage })),
)
const EnseignantFiches = lazy(() =>
  import('../routes/enseignant/Fiches.jsx').then((m) => ({ default: m.EnseignantFiches })),
)
const EnseignantAppel = lazy(() =>
  import('../routes/enseignant/Appel.jsx').then((m) => ({ default: m.EnseignantAppel })),
)
const EnseignantSeance = lazy(() =>
  import('../routes/enseignant/SeanceEnCours.jsx').then((m) => ({ default: m.EnseignantSeance })),
)
const EnseignantReleve = lazy(() =>
  import('../routes/enseignant/Releve.jsx').then((m) => ({ default: m.EnseignantReleve })),
)
const EnseignantHeures = lazy(() =>
  import('../routes/enseignant/Heures.jsx').then((m) => ({ default: m.EnseignantHeures })),
)

const SecretariatPointage = lazy(() =>
  import('../routes/secretariat/Pointage.jsx').then((m) => ({ default: m.SecretariatPointage })),
)
const SecretariatSeances = lazy(() =>
  import('../routes/secretariat/SeancesDuJour.jsx').then((m) => ({ default: m.SecretariatSeances })),
)
const SecretariatRH = lazy(() =>
  import('../routes/secretariat/RH.jsx').then((m) => ({ default: m.SecretariatRH })),
)
const SecretariatSeanceAnterieure = lazy(() =>
  import('../routes/secretariat/SeanceAnterieure.jsx').then((m) => ({
    default: m.SecretariatSeanceAnterieure,
  })),
)
const SecretariatAPointer = lazy(() =>
  import('../routes/secretariat/APointer.jsx').then((m) => ({ default: m.SecretariatAPointer })),
)

const DepartementJustifications = lazy(() =>
  import('../routes/departement/Justifications.jsx').then((m) => ({
    default: m.DepartementJustifications,
  })),
)
const DepartementAffectations = lazy(() =>
  import('../routes/departement/Affectations.jsx').then((m) => ({
    default: m.DepartementAffectations,
  })),
)
const DepartementPresences = lazy(() =>
  import('../routes/departement/Presences.jsx').then((m) => ({ default: m.DepartementPresences })),
)
const DepartementAlertes = lazy(() =>
  import('../routes/departement/Alertes.jsx').then((m) => ({ default: m.DepartementAlertes })),
)

const AdminTableauDeBord = lazy(() =>
  import('../routes/administration/TableauDeBord.jsx').then((m) => ({ default: m.AdminTableauDeBord })),
)
const AdminHeuresEtCouts = lazy(() =>
  import('../routes/administration/HeuresEtCouts.jsx').then((m) => ({ default: m.AdminHeuresEtCouts })),
)
const AdminFiches = lazy(() =>
  import('../routes/administration/Fiches.jsx').then((m) => ({ default: m.AdminFiches })),
)
const AdminReferentiel = lazy(() =>
  import('../routes/administration/Referentiel.jsx').then((m) => ({ default: m.AdminReferentiel })),
)
const AdminTaux = lazy(() =>
  import('../routes/administration/Taux.jsx').then((m) => ({ default: m.AdminTaux })),
)
const AdminAlertes = lazy(() =>
  import('../routes/administration/Alertes.jsx').then((m) => ({ default: m.AdminAlertes })),
)
const AdminParametres = lazy(() =>
  import('../routes/administration/Parametres.jsx').then((m) => ({ default: m.AdminParametres })),
)
const AdminHistorique = lazy(() =>
  import('../routes/administration/Historique.jsx').then((m) => ({ default: m.AdminHistorique })),
)

function Chargement({ plein = true }) {
  return (
    <div
      className={
        plein
          ? 'flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-6'
          : 'flex min-h-[50vh] flex-col items-center justify-center gap-3'
      }
    >
      {plein && <LogoMark taille={56} arrondi="rounded-2xl" />}
      <Spinner />
      <p className="text-[13px] text-faint">Chargement…</p>
    </div>
  )
}

/**
 * Garde de navigation.
 *
 * §13.3 « Contrôle fait seulement dans l'interface » : cette garde sert au
 * confort de navigation, PAS à la sécurité. Chaque appel au serveur revérifie la
 * session, le rôle et le périmètre, et les projections ne contiennent de toute
 * façon que ce que le rôle a le droit de voir.
 */
function Protege({ role, children }) {
  const { pret, moi, roles, espace } = useSession()
  const location = useLocation()

  if (!pret) return <Chargement />
  if (!moi) return <Navigate to={`/connexion?suite=${encodeURIComponent(location.pathname)}`} replace />

  // §13.2 « Mot de passe faible ou par défaut » : changement imposé avant tout.
  if (moi.mustChangePassword && location.pathname !== '/compte') {
    return <Navigate to="/compte" replace />
  }

  if (role && !roles.includes(role)) {
    const disponibles = espacesDisponibles(roles)
    return <Navigate to={disponibles[0]?.racine ?? '/espaces'} replace />
  }

  if (!role && !espace) return <Navigate to="/espaces" replace />

  return (
    <AppShell>
      <Suspense fallback={<Chargement plein={false} />}>{children}</Suspense>
    </AppShell>
  )
}

/** Redirige vers l'espace du rôle après la connexion (§2). */
function Accueil() {
  const { pret, moi, roles, espace } = useSession()
  if (!pret) return <Chargement />
  if (!moi) return <Navigate to="/connexion" replace />
  if (moi.mustChangePassword) return <Navigate to="/compte" replace />

  const disponibles = espacesDisponibles(roles)
  if (espace && ESPACES[espace]) return <Navigate to={ESPACES[espace].racine} replace />
  if (disponibles.length === 1) return <Navigate to={disponibles[0].racine} replace />
  return <Navigate to="/espaces" replace />
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Accueil />} />
      <Route path="/connexion" element={<Connexion />} />
      <Route path="/espaces" element={<ChoixEspace />} />
      <Route
        path="/compte"
        element={
          <Protege>
            <MonCompte />
          </Protege>
        }
      />

      {/* Étudiant */}
      <Route path="/etudiant" element={<Protege role="etudiant"><EtudiantAccueil /></Protege>} />
      <Route path="/etudiant/scanner" element={<Protege role="etudiant"><EtudiantScanner /></Protege>} />
      <Route path="/etudiant/seances" element={<Protege role="etudiant"><EtudiantSeances /></Protege>} />

      {/* Enseignant */}
      <Route path="/enseignant" element={<Protege role="enseignant"><EnseignantPointage /></Protege>} />
      <Route path="/enseignant/seance" element={<Protege role="enseignant"><EnseignantSeance /></Protege>} />
      <Route path="/enseignant/releve" element={<Protege role="enseignant"><EnseignantReleve /></Protege>} />
      <Route path="/enseignant/heures" element={<Protege role="enseignant"><EnseignantHeures /></Protege>} />
      <Route path="/enseignant/fiches" element={<Protege role="enseignant"><EnseignantFiches /></Protege>} />
      <Route path="/enseignant/appel" element={<Protege role="enseignant"><EnseignantAppel /></Protege>} />

      {/* Secrétariat */}
      <Route path="/secretariat" element={<Protege role="secretaire"><SecretariatPointage /></Protege>} />
      <Route path="/secretariat/seances" element={<Protege role="secretaire"><SecretariatSeances /></Protege>} />
      <Route path="/secretariat/rh" element={<Protege role="secretaire"><SecretariatRH /></Protege>} />
      <Route path="/secretariat/anterieure" element={<Protege role="secretaire"><SecretariatSeanceAnterieure /></Protege>} />
      <Route path="/secretariat/a-pointer" element={<Protege role="secretaire"><SecretariatAPointer /></Protege>} />

      {/* Chef de département */}
      <Route path="/departement" element={<Protege role="chef"><DepartementJustifications /></Protege>} />
      <Route path="/departement/affectations" element={<Protege role="chef"><DepartementAffectations /></Protege>} />
      <Route path="/departement/presences" element={<Protege role="chef"><DepartementPresences /></Protege>} />
      <Route path="/departement/alertes" element={<Protege role="chef"><DepartementAlertes /></Protege>} />

      {/* Administration */}
      <Route path="/administration" element={<Protege role="administration"><AdminTableauDeBord /></Protege>} />
      <Route path="/administration/heures" element={<Protege role="administration"><AdminHeuresEtCouts /></Protege>} />
      <Route path="/administration/fiches" element={<Protege role="administration"><AdminFiches /></Protege>} />
      <Route path="/administration/referentiel" element={<Protege role="administration"><AdminReferentiel /></Protege>} />
      <Route path="/administration/taux" element={<Protege role="administration"><AdminTaux /></Protege>} />
      <Route path="/administration/alertes" element={<Protege role="administration"><AdminAlertes /></Protege>} />
      <Route path="/administration/parametres" element={<Protege role="administration"><AdminParametres /></Protege>} />
      <Route path="/administration/historique" element={<Protege role="administration"><AdminHistorique /></Protege>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
