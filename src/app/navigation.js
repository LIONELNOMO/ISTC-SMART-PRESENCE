import {
  BadgeCheck,
  BarChart3,
  CalendarClock,
  CalendarPlus,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Coins,
  Database,
  BookUser,
  FileWarning,
  GraduationCap,
  History,
  LayoutDashboard,
  ListChecks,
  ScanLine,
  Settings,
  ShieldAlert,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react'

/**
 * Écrans par rôle — transcription directe du §10 du cahier des charges.
 * `racine` est l'écran d'arrivée après la connexion.
 */
export const ESPACES = {
  etudiant: {
    cle: 'etudiant',
    label: 'Étudiant',
    titre: 'Mon espace',
    racine: '/etudiant',
    couleur: 'brand',
    icone: GraduationCap,
    ecrans: [
      { to: '/etudiant', label: 'Accueil', icone: LayoutDashboard, exact: true },
      { to: '/etudiant/scanner', label: 'Scanner', icone: ScanLine },
      { to: '/etudiant/seances', label: 'Mes séances', icone: CalendarClock },
      { to: '/compte', label: 'Mon profil', icone: UserCog },
    ],
  },
  enseignant: {
    cle: 'enseignant',
    label: 'Enseignant',
    titre: 'Espace enseignant',
    racine: '/enseignant',
    couleur: 'info',
    icone: ClipboardList,
    ecrans: [
      { to: '/enseignant', label: 'Pointage', icone: ScanLine, exact: true },
      { to: '/enseignant/seance', label: 'Séance en cours', icone: ListChecks },
      { to: '/enseignant/releve', label: 'Relevé', icone: ClipboardList },
      { to: '/enseignant/appel', label: "Faire l'appel", icone: ClipboardCheck },
      { to: '/enseignant/heures', label: 'Mes heures', icone: Clock },
      { to: '/enseignant/fiches', label: 'Historique de paiement', icone: Wallet },
      { to: '/compte', label: 'Mon profil', icone: UserCog },
    ],
  },
  secretaire: {
    cle: 'secretaire',
    label: 'Secrétaire',
    titre: 'Secrétariat',
    racine: '/secretariat',
    couleur: 'ok',
    icone: BadgeCheck,
    ecrans: [
      { to: '/secretariat', label: 'Pointage', icone: BadgeCheck, exact: true },
      { to: '/secretariat/seances', label: 'Séances du jour', icone: CalendarClock },
      { to: '/secretariat/anterieure', label: 'Séance antérieure', icone: CalendarPlus },
      { to: '/secretariat/a-pointer', label: 'Relevés à pointer', icone: ClipboardCheck },
      { to: '/secretariat/rh', label: 'Création des fiches de paie', icone: BarChart3 },
      { to: '/compte', label: 'Mon profil', icone: UserCog },
    ],
  },
  chef: {
    cle: 'chef',
    label: 'Chef de département',
    titre: 'Département',
    racine: '/departement',
    couleur: 'warn',
    icone: FileWarning,
    ecrans: [
      { to: '/departement', label: 'Justifications', icone: FileWarning, exact: true },
      { to: '/departement/affectations', label: 'Affectations', icone: BookUser },
      { to: '/departement/presences', label: 'Présences', icone: Users },
      { to: '/departement/alertes', label: 'Alertes', icone: ShieldAlert },
      { to: '/compte', label: 'Mon profil', icone: UserCog },
    ],
  },
  administration: {
    cle: 'administration',
    label: 'Administration',
    titre: 'Administration',
    racine: '/administration',
    couleur: 'brand',
    icone: LayoutDashboard,
    ecrans: [
      { to: '/administration', label: 'Tableau de bord', icone: LayoutDashboard, exact: true },
      { to: '/administration/heures', label: 'Heures et coûts', icone: Coins },
      { to: '/administration/fiches', label: 'Fiches de paie', icone: Wallet },
      { to: '/administration/referentiel', label: 'Référentiel', icone: Database },
      { to: '/administration/taux', label: 'Taux horaires', icone: BarChart3 },
      { to: '/administration/alertes', label: 'Étudiants en alerte', icone: ShieldAlert },
      { to: '/administration/parametres', label: 'Paramètres', icone: Settings },
      { to: '/administration/historique', label: 'Historique', icone: History },
      { to: '/compte', label: 'Mon profil', icone: UserCog },
    ],
  },
}

export const ORDRE_ESPACES = ['administration', 'secretaire', 'enseignant', 'chef', 'etudiant']

/** Espaces accessibles à un porteur de rôles. */
export function espacesDisponibles(roles = []) {
  return ORDRE_ESPACES.filter((cle) => roles.includes(cle)).map((cle) => ESPACES[cle])
}

/** Espace correspondant à un chemin, pour garder la barre cohérente. */
export function espaceDuChemin(pathname) {
  return (
    Object.values(ESPACES).find(
      (espace) => pathname === espace.racine || pathname.startsWith(`${espace.racine}/`),
    ) ?? null
  )
}

/** Nombre maximal d'onglets affichés dans la barre du bas, avant « Plus ». */
export const MAX_ONGLETS_MOBILE = 4
