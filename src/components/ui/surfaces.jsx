import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from 'lucide-react'

import { cn } from '../../lib/utils.js'

/* ------------------------------------------------------------------ *
 *  Carte
 * ------------------------------------------------------------------ */

export function Card({ className, children, as: Tag = 'section', ...props }) {
  return (
    <Tag
      className={cn(
        'rounded-card border border-line bg-surface shadow-card',
        'transition-shadow duration-200',
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  )
}

/**
 * En-tête de carte. Le titre est en petites capitales espacées, posé sur un
 * fond très légèrement teinté : il se lit comme l'intitulé d'une rubrique, et
 * ne concurrence pas le titre de la page.
 */
export function CardHeader({ title, subtitle, actions, icon, className }) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-2 px-4 py-3 sm:px-5',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <span className="shrink-0 text-accent-text">{icon}</span>}
        <div className="min-w-0">
          <h2 className="truncate text-[11.5px] font-semibold uppercase tracking-[0.1em] text-soft">
            {title}
          </h2>
          {subtitle && <p className="mt-1 text-[12.5px] leading-snug text-faint">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

export function CardBody({ className, children, flush = false }) {
  return <div className={cn(flush ? '' : 'px-4 py-4 sm:px-5', className)}>{children}</div>
}

export function CardFooter({ className, children }) {
  return (
    <footer
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2/60 px-4 py-3 sm:px-5',
        className,
      )}
    >
      {children}
    </footer>
  )
}

/* ------------------------------------------------------------------ *
 *  Titre de section
 * ------------------------------------------------------------------ */

export function SectionTitle({ children, hint, actions, className }) {
  return (
    <div className={cn('mb-3.5 flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <span className="mb-2 block h-[2px] w-7 rounded-full bg-accent" aria-hidden />
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-soft">
          {children}
        </h3>
        {hint && <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-faint">{hint}</p>}
      </div>
      {actions}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Chiffre clé
 * ------------------------------------------------------------------ */

const STAT_TONES = {
  neutral: 'text-ink',
  brand: 'text-accent-text',
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  info: 'text-info',
}

/** Position, taille et rythme de chaque bulle. Fixes : elles ne sautillent pas. */
const BULLES = [
  { left: '14%', size: 9, duree: '17s', retard: '0s', bas: '-14px' },
  { left: '34%', size: 5, duree: '21s', retard: '2.5s', bas: '-10px' },
  { left: '58%', size: 12, duree: '19s', retard: '5s', bas: '-18px' },
  { left: '78%', size: 6, duree: '23s', retard: '1.2s', bas: '-10px' },
]

/**
 * Chiffre clé.
 *
 * Le libellé est au-dessus en petites capitales, le chiffre en dessous, grand
 * et en chiffres tabulaires — une colonne de ces cartes s'aligne donc au pixel.
 *
 * Décor : une corolle en filigrane en haut à droite, et quelques bulles qui
 * dérivent lentement. Le tout à moins de 6 % d'opacité, en cuivre uniquement.
 * L'état ne colore plus de filet : il tient dans la couleur du chiffre et dans
 * une pastille discrète à côté du libellé.
 */
export function Stat({
  label,
  value,
  unit,
  hint,
  tone = 'neutral',
  icon,
  className,
  footer,
  decor = true,
}) {
  return (
    <div
      className={cn(
        'relative isolate overflow-hidden rounded-card border border-line bg-surface px-4 py-4 shadow-card',
        className,
      )}
    >
      {decor && (
        <span className="stat-decor" aria-hidden>
          <span className="stat-petales" />
          <span className="stat-coeur" />
          {BULLES.map((bulle) => (
            <span
              key={bulle.left}
              className="stat-bulle"
              style={{
                left: bulle.left,
                bottom: bulle.bas,
                width: bulle.size,
                height: bulle.size,
                '--duree': bulle.duree,
                '--retard': bulle.retard,
              }}
            />
          ))}
        </span>
      )}

      <div className="relative z-10">
        <div className="flex items-start justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">
            {tone !== 'neutral' && (
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  tone === 'ok' && 'bg-ok',
                  tone === 'warn' && 'bg-warn',
                  tone === 'bad' && 'bg-bad',
                  tone === 'info' && 'bg-info',
                  tone === 'brand' && 'bg-accent',
                )}
                aria-hidden
              />
            )}
            {label}
          </p>
          {icon && <span className="shrink-0 text-faint/60">{icon}</span>}
        </div>

        <p className={cn('mt-2.5 flex items-baseline gap-1.5 font-bold', STAT_TONES[tone])}>
          <span className="text-[30px] leading-none tracking-tight tabular-nums">{value}</span>
          {unit && <span className="text-[13px] font-semibold text-faint">{unit}</span>}
        </p>

        {hint && <p className="mt-2 text-[11.5px] leading-snug text-faint">{hint}</p>}
        {footer && <div className="mt-3">{footer}</div>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Bandeau d'information
 * ------------------------------------------------------------------ */

const BANNER_TONES = {
  info: { box: 'border-info/30 bg-info-soft text-info', Icon: Info },
  ok: { box: 'border-ok/30 bg-ok-soft text-ok', Icon: CheckCircle2 },
  warn: { box: 'border-warn/35 bg-warn-soft text-warn', Icon: AlertTriangle },
  bad: { box: 'border-bad/30 bg-bad-soft text-bad', Icon: OctagonAlert },
}

export function Banner({ tone = 'info', title, children, className, actions, icon }) {
  const { box, Icon } = BANNER_TONES[tone] ?? BANNER_TONES.info
  return (
    <div className={cn('rounded-xl border px-4 py-3', box, className)} role="status">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">{icon ?? <Icon className="size-[18px]" aria-hidden />}</span>
        <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={cn(title && 'mt-0.5', 'text-current/90')}>{children}</div>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Vide
 * ------------------------------------------------------------------ */

export function EmptyState({ icon, title, children, action, className }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line px-6 py-12 text-center',
        className,
      )}
    >
      {icon && (
        <span className="flex size-11 items-center justify-center rounded-xl bg-surface-2 text-faint">
          {icon}
        </span>
      )}
      <div>
        <p className="text-sm font-semibold text-ink">{title}</p>
        {children && <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-faint">{children}</p>}
      </div>
      {action}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Barre de proportion
 * ------------------------------------------------------------------ */

const METER_TONES = {
  brand: 'bg-brand',
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  info: 'bg-info',
}

export function Meter({ value, max = 100, tone = 'brand', className, label }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div className={className}>
      {label && (
        <div className="mb-1 flex items-baseline justify-between text-[12px] text-faint">
          <span>{label}</span>
          <span className="font-semibold tabular-nums text-soft">
            {value} / {max}
          </span>
        </div>
      )}
      <div
        className="h-2 overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-500 ease-out', METER_TONES[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/** Petit graphique en barres, pour les heures par jour. */
export function BarRow({ rows, format = (v) => v, tone = 'brand', className, emptyLabel = 'Aucune donnée' }) {
  if (!rows?.length) {
    return <p className={cn('py-6 text-center text-[13px] text-faint', className)}>{emptyLabel}</p>
  }
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <ul className={cn('space-y-2.5', className)}>
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="truncate text-[13px] text-soft">{row.label}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div
                className={cn('h-full rounded-full', METER_TONES[tone])}
                style={{ width: `${(row.value / max) * 100}%` }}
              />
            </div>
          </div>
          <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">
            {format(row.value)}
          </span>
        </li>
      ))}
    </ul>
  )
}
