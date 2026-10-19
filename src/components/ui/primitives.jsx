import { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'

import { cn } from '../../lib/utils.js'
import { isAllowedExternalUrl } from '../../lib/safe-redirect.js'

/* ------------------------------------------------------------------ *
 *  Bouton
 * ------------------------------------------------------------------ */

const BUTTON_BASE =
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold ' +
  'transition-[transform,background-color,border-color,box-shadow,color] duration-150 ease-[cubic-bezier(.22,1,.36,1)] ' +
  'active:scale-[.98] disabled:pointer-events-none disabled:opacity-45 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring'

/**
 * `text-on-brand` s'inverse avec le thème : le bouton principal est brun foncé
 * en clair (texte crème) et orange clair en sombre (texte brun foncé). Un
 * `text-white` figé serait illisible dans le second cas.
 */
const BUTTON_VARIANTS = {
  primary: 'bg-brand text-on-brand hover:brightness-[1.15] active:brightness-95',
  secondary:
    'bg-surface text-ink border border-line-strong hover:bg-surface-2 hover:border-line-strong',
  ghost: 'text-soft hover:bg-surface-3 hover:text-ink',
  outline: 'border border-line-strong text-ink hover:bg-surface-2',
  danger: 'bg-bad text-white hover:brightness-110',
  success: 'bg-ok text-white hover:brightness-110',
  soft: 'bg-brand-soft text-brand-text hover:brightness-[0.97] border border-transparent',
  accent: 'bg-accent-soft text-accent-text border border-accent/25 hover:brightness-[0.97]',
}

const BUTTON_SIZES = {
  sm: 'h-9 px-3 text-[13px]',
  md: 'h-11 px-4 text-sm',
  lg: 'h-13 px-6 text-[15px]',
  icon: 'h-10 w-10',
  'icon-sm': 'h-8 w-8',
}

export const Button = forwardRef(function Button(
  {
    as: Tag = 'button',
    variant = 'primary',
    size = 'md',
    className,
    children,
    loading = false,
    disabled,
    type = 'button',
    ...props
  },
  ref,
) {
  const estBouton = Tag === 'button'
  return (
    <Tag
      ref={ref}
      type={estBouton ? type : undefined}
      disabled={estBouton ? disabled || loading : undefined}
      aria-disabled={!estBouton && (disabled || loading) ? true : undefined}
      aria-busy={loading || undefined}
      className={cn(
        BUTTON_BASE,
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        !estBouton && (disabled || loading) && 'pointer-events-none opacity-45',
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </Tag>
  )
})

export const IconButton = forwardRef(function IconButton(
  { label, size = 'icon', variant = 'ghost', className, ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      aria-label={label}
      title={label}
      size={size}
      variant={variant}
      className={cn('rounded-lg', className)}
      {...props}
    />
  )
})

/* ------------------------------------------------------------------ *
 *  Badge et pastille
 * ------------------------------------------------------------------ */

const BADGE_TONES = {
  neutral: 'bg-surface-3 text-soft ring-line',
  brand: 'bg-brand-soft text-brand-text ring-brand/20',
  accent: 'bg-accent-soft text-accent-text ring-accent/25',
  ok: 'bg-ok-soft text-ok ring-ok/25',
  warn: 'bg-warn-soft text-warn ring-warn/25',
  bad: 'bg-bad-soft text-bad ring-bad/25',
  info: 'bg-info-soft text-info ring-info/25',
}

export function Badge({ tone = 'neutral', className, children, dot = false, ...props }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.04em] leading-none ring-1 ring-inset',
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  )
}

/** Pastille de comptage, pour la file d'attente. */
export function Count({ value, tone = 'brand', className }) {
  if (!value) return null
  return (
    <span
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
        tone === 'brand' ? 'bg-brand text-white' : 'bg-bad text-white',
        className,
      )}
    >
      {value > 99 ? '99+' : value}
    </span>
  )
}

/* ------------------------------------------------------------------ *
 *  Chargement
 * ------------------------------------------------------------------ */

export function Spinner({ className }) {
  return <Loader2 className={cn('size-5 animate-spin text-faint', className)} aria-hidden />
}

export function Skeleton({ className }) {
  return <div className={cn('shimmer rounded-lg', className)} aria-hidden />
}

export function LoadingBlock({ label = 'Chargement…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-faint">
      <Spinner />
      {label}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Lien externe
 * ------------------------------------------------------------------ */

/**
 * §13.8 « Onglet détourné » : rel="noopener noreferrer" systématique.
 * §13.8 « Lien javascript: » : seules les adresses de la liste blanche passent.
 * Le seul lien externe de l'application est wa.me (§8).
 */
export function ExternalLink({ href, children, className, ...props }) {
  if (!isAllowedExternalUrl(href)) {
    return (
      <span className={cn('text-faint', className)} title="Adresse refusée">
        {children}
      </span>
    )
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('underline decoration-dotted underline-offset-4', className)}
      {...props}
    >
      {children}
    </a>
  )
}

/* ------------------------------------------------------------------ *
 *  Divers
 * ------------------------------------------------------------------ */

export function Kbd({ children }) {
  return (
    <kbd className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-soft">
      {children}
    </kbd>
  )
}

export function Divider({ className, label }) {
  if (label) {
    return (
      <div className={cn('flex items-center gap-3', className)}>
        <span className="h-px flex-1 bg-line" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">{label}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
    )
  }
  return <hr className={cn('border-0 border-t border-line', className)} />
}

export function Avatar({ initials, className, tone = 'brand' }) {
  return (
    <span
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold',
        tone === 'brand' ? 'bg-brand-soft text-brand-text' : 'bg-surface-3 text-soft',
        className,
      )}
      aria-hidden
    >
      {initials}
    </span>
  )
}

/** Gros code à 6 caractères — code de séance (§4). */
export function CodeDisplay({ code, className, label }) {
  const chars = String(code ?? '').split('')
  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      {label && (
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">{label}</span>
      )}
      <div className="flex gap-1.5">
        {chars.map((char, index) => (
          <span
            key={`${char}-${index}`}
            className="flex size-11 items-center justify-center rounded-xl border border-line-strong bg-surface-2 font-mono text-xl font-bold text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.06)] sm:size-12 sm:text-2xl"
          >
            {char}
          </span>
        ))}
      </div>
    </div>
  )
}
