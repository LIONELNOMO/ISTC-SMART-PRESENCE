import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ChevronsUpDown, KeyRound, LogOut, MoreHorizontal, Moon, Sun } from 'lucide-react'

import { cn, initials } from '../../lib/utils.js'
import { applyTheme, readTheme } from '../../lib/device.js'
import { useSession } from '../../lib/session.jsx'
import { Badge, Button, Divider, IconButton } from '../ui/primitives.jsx'
import { Modal } from '../ui/overlays.jsx'
import { NetworkPill } from './NetworkBar.jsx'
import { LogoMark, LogoNom } from './Logo.jsx'
import { LogoIstc } from './LogoIstc.jsx'
import {
  ESPACES,
  MAX_ONGLETS_MOBILE,
  espaceDuChemin,
  espacesDisponibles,
} from '../../app/navigation.js'

/**
 * Trois dispositions, une seule coquille :
 *
 *   < 768 px   téléphone  — barre du bas, en-tête compact
 *   768–1279   tablette   — rail d'icônes à gauche, pas de barre du bas
 *   ≥ 1280 px  ordinateur — barre latérale complète avec libellés
 *
 * Les espaces du secrétariat et de l'administration doivent être confortables
 * sur ordinateur (§10) : c'est la disposition large qui les sert.
 */

/* ------------------------------------------------------------------ *
 *  Thème
 * ------------------------------------------------------------------ */

function ThemeToggle() {
  const [theme, setTheme] = useState(() => readTheme())
  useEffect(() => applyTheme(theme), [theme])
  return (
    <IconButton
      label={theme === 'dark' ? 'Passer en clair' : 'Passer en sombre'}
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      {theme === 'dark' ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </IconButton>
  )
}

/* ------------------------------------------------------------------ *
 *  Menu du compte
 * ------------------------------------------------------------------ */

function AccountMenu() {
  const { moi, deconnecter, espace, setEspace } = useSession()
  const [ouvert, setOuvert] = useState(false)
  const navigate = useNavigate()
  const espaces = espacesDisponibles(moi?.roles ?? [])

  if (!moi) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className="flex max-w-[52vw] items-center gap-2 rounded-xl border border-line bg-surface-2 px-2 py-1.5 text-left transition-colors hover:bg-surface-3 sm:max-w-none"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-[11px] font-bold text-brand-text">
          {initials(moi.nom, moi.prenom)}
        </span>
        <span className="hidden min-w-0 xl:block">
          <span className="block max-w-[150px] truncate text-[13px] font-semibold text-ink">
            {moi.label}
          </span>
          <span className="block truncate text-[11px] text-faint">
            {ESPACES[espace]?.label ?? 'Espace'}
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-faint" aria-hidden />
      </button>

      <Modal open={ouvert} onClose={() => setOuvert(false)} title="Mon compte" size="sm">
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-ink">{moi.label}</p>
            <p className="font-mono text-[12px] text-faint">{moi.login}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {moi.roles.map((role) => (
                <Badge key={role} tone="brand">
                  {ESPACES[role]?.label ?? role}
                </Badge>
              ))}
            </div>
          </div>

          {espaces.length > 1 && (
            <>
              <Divider label="Changer d'espace" />
              <div className="grid gap-2">
                {espaces.map((item) => {
                  const Icone = item.icone
                  const actif = item.cle === espace
                  return (
                    <button
                      key={item.cle}
                      type="button"
                      onClick={async () => {
                        await setEspace(item.cle)
                        setOuvert(false)
                        navigate(item.racine)
                      }}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                        actif
                          ? 'border-brand/40 bg-brand-soft'
                          : 'border-line bg-surface-2 hover:bg-surface-3',
                      )}
                    >
                      <Icone
                        className={cn('size-4 shrink-0', actif ? 'text-brand-text' : 'text-faint')}
                        aria-hidden
                      />
                      <span
                        className={cn(
                          'min-w-0 truncate text-sm font-medium',
                          actif ? 'text-brand-text' : 'text-ink',
                        )}
                      >
                        {item.titre}
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <Divider />
          <div className="grid gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setOuvert(false)
                navigate('/compte')
              }}
            >
              <KeyRound className="size-4" aria-hidden />
              Changer mon mot de passe
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                setOuvert(false)
                await deconnecter()
                navigate('/connexion')
              }}
            >
              <LogOut className="size-4" aria-hidden />
              Se déconnecter
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-faint">
            La déconnexion efface toutes les données de cet appareil : listes, séances et file
            d'attente.
          </p>
        </div>
      </Modal>
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Barre latérale — rail dès la tablette, complète sur ordinateur
 * ------------------------------------------------------------------ */

/**
 * Barre latérale. Rail d'icônes dès la tablette, libellés à partir de `xl`.
 *
 * Parti pris « institutionnel » : fond plein plutôt que translucide, filet
 * vertical cuivré sur l'onglet actif plutôt qu'une pastille pleine, libellés en
 * petites capitales pour le nom de l'espace. L'œil suit une colonne, pas une
 * succession de blocs colorés.
 */
function Sidebar({ espace }) {
  if (!espace) return null

  return (
    <aside className="hidden shrink-0 border-r border-line bg-surface md:flex md:w-[76px] md:flex-col xl:w-[248px]">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-4 xl:px-5">
        <LogoMark taille={34} arrondi="rounded-lg" />
        <div className="hidden min-w-0 xl:block">
          <LogoNom taille="text-[13px]" className="block truncate leading-tight" />
          <p className="mt-0.5 truncate text-[10.5px] text-faint">Chaque présence compte.</p>
        </div>
      </div>

      <div className="hidden px-5 pb-1 pt-5 xl:block">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">
          {espace.titre}
        </p>
      </div>

      <nav className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-6 xl:mt-1 xl:px-3">
        {espace.ecrans.map((ecran) => {
          const Ic = ecran.icone
          return (
            <NavLink
              key={ecran.to}
              to={ecran.to}
              end={ecran.exact}
              title={ecran.label}
              className={({ isActive }) =>
                cn(
                  'relative flex items-center gap-3 rounded-md text-[13.5px] font-medium transition-colors',
                  'justify-center px-0 py-2.5 xl:justify-start xl:px-3',
                  isActive
                    ? 'bg-brand-soft text-brand-text'
                    : 'text-soft hover:bg-surface-3 hover:text-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* Filet cuivré : repère l'onglet actif sans pavé de couleur. */}
                  {isActive && (
                    <span
                      className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-accent"
                      aria-hidden
                    />
                  )}
                  <Ic
                    className={cn(
                      'size-[18px] shrink-0',
                      isActive ? 'text-accent-text' : 'text-faint',
                    )}
                    aria-hidden
                  />
                  <span className="hidden truncate xl:inline">{ecran.label}</span>
                </>
              )}
            </NavLink>
          )
        })}
      </nav>

      <div className="border-t border-line px-2.5 py-3 xl:px-3">
        <NetworkPill className="w-full justify-center" compact />
        <span className="sr-only">État de la synchronisation</span>
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------------ *
 *  Barre du bas — téléphone seulement
 * ------------------------------------------------------------------ */

function BottomNav({ espace }) {
  const [ouvert, setOuvert] = useState(false)
  const location = useLocation()
  if (!espace) return null

  const visibles = espace.ecrans.slice(0, MAX_ONGLETS_MOBILE)
  const reste = espace.ecrans.slice(MAX_ONGLETS_MOBILE)
  const resteActif = reste.some(
    (ecran) => location.pathname === ecran.to || location.pathname.startsWith(`${ecran.to}/`),
  )
  const colonnes = visibles.length + (reste.length ? 1 : 0)

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-md safe-bottom md:hidden">
        <ul
          className="mx-auto grid max-w-lg"
          style={{ gridTemplateColumns: `repeat(${colonnes}, minmax(0,1fr))` }}
        >
          {visibles.map((ecran) => {
            const Ic = ecran.icone
            return (
              <li key={ecran.to} className="min-w-0">
                <NavLink
                  to={ecran.to}
                  end={ecran.exact}
                  className={({ isActive }) =>
                    cn(
                      'flex min-h-[56px] flex-col items-center justify-center gap-1 px-0.5 pb-1 pt-1.5 text-[10px] font-semibold transition-colors',
                      isActive ? 'text-brand-text' : 'text-faint',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={cn(
                          'flex h-7 w-11 items-center justify-center rounded-lg transition-colors',
                          isActive && 'bg-brand-soft',
                        )}
                      >
                        <Ic className="size-[18px]" aria-hidden />
                      </span>
                      <span className="w-full truncate px-0.5 text-center leading-tight">
                        {ecran.label}
                      </span>
                    </>
                  )}
                </NavLink>
              </li>
            )
          })}
          {reste.length > 0 && (
            <li className="min-w-0">
              <button
                type="button"
                onClick={() => setOuvert(true)}
                className={cn(
                  'flex min-h-[56px] w-full flex-col items-center justify-center gap-1 px-0.5 pb-1 pt-1.5 text-[10px] font-semibold transition-colors',
                  resteActif ? 'text-brand-text' : 'text-faint',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-11 items-center justify-center rounded-lg',
                    resteActif && 'bg-brand-soft',
                  )}
                >
                  <MoreHorizontal className="size-[18px]" aria-hidden />
                </span>
                Plus
              </button>
            </li>
          )}
        </ul>
      </nav>

      <Modal open={ouvert} onClose={() => setOuvert(false)} title={espace.titre} size="sm">
        <ul className="space-y-2">
          {reste.map((ecran) => {
            const Ic = ecran.icone
            return (
              <li key={ecran.to}>
                <Link
                  to={ecran.to}
                  onClick={() => setOuvert(false)}
                  className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3 transition-colors hover:bg-surface-3"
                >
                  <Ic className="size-4 shrink-0 text-faint" aria-hidden />
                  <span className="min-w-0 truncate text-sm font-medium text-ink">{ecran.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </Modal>
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Coquille
 * ------------------------------------------------------------------ */

export function AppShell({ children }) {
  const location = useLocation()
  const { espace: espaceCourant } = useSession()
  const espace = espaceDuChemin(location.pathname) ?? ESPACES[espaceCourant] ?? null

  return (
    <div className="flex min-h-dvh bg-canvas">
      <Sidebar espace={espace} />

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* En-tête sur fond plein : il se lit comme une barre d'outils, pas
            comme un voile posé sur le contenu. */}
        <header className="sticky top-0 z-30 border-b border-line bg-surface safe-top">
          <div className="flex h-14 items-center justify-between gap-2 gouttiere sm:gap-3">
            <div className="flex min-w-0 items-center gap-2.5 md:hidden">
              <LogoMark taille={30} arrondi="rounded-lg" />
              <span className="min-w-0 truncate text-[13px] font-bold leading-tight text-ink">
                {espace?.titre ?? 'Présences'}
              </span>
            </div>
            <div className="hidden min-w-0 md:block md:flex-1">
              <p className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-faint xl:hidden">
                {espace?.titre ?? 'Présences'}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <NetworkPill compact className="md:hidden" />
              <NetworkPill className="hidden md:inline-flex xl:hidden" compact />
              <ThemeToggle />
              <AccountMenu />
            </div>
          </div>
        </header>

        {/* Emblème de l'établissement en fond de page, sur tous les écrans.
            Il respire lentement et reste derrière le contenu. */}
        <LogoIstc className="page-filigrane" taille={420} aria-hidden />

        <main className="relative z-10 mx-auto w-full max-w-[1400px] flex-1 gouttiere pb-24 pt-5 md:pb-12 lg:pt-7 xl:px-10">
          {children}
        </main>
      </div>

      <BottomNav espace={espace} />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  En-tête de page
 * ------------------------------------------------------------------ */

/**
 * En-tête de page.
 *
 * Sur grand écran, un filet horizontal sépare le titre du contenu : la page a
 * un en-tête franc, comme un document. Sur téléphone, ce filet disparaît pour
 * ne pas manger de hauteur.
 */
export function PageHeader({ title, subtitle, actions, className, children, surtitre }) {
  return (
    <div className={cn('mb-5 lg:mb-6 lg:border-b lg:border-line lg:pb-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-[min(100%,20rem)]">
          {surtitre && (
            <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-accent-text">
              {surtitre}
            </p>
          )}
          <h1 className="titre-fluide font-bold tracking-tight text-ink">{title}</h1>
          {subtitle && (
            <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-faint sm:text-[13.5px]">
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:w-full">{actions}</div>
        )}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}
