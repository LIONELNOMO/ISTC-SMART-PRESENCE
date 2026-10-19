import { forwardRef, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Eye, EyeOff, Upload } from 'lucide-react'

import { cn } from '../../lib/utils.js'

/* ------------------------------------------------------------------ *
 *  Enveloppe de champ
 * ------------------------------------------------------------------ */

export function Field({ label, hint, error, required, children, className, htmlFor }) {
  return (
    <div className={cn('min-w-0', className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="mb-1.5 flex items-baseline gap-1 text-[13px] font-medium text-soft"
        >
          {label}
          {required && (
            <span className="text-bad" aria-label="obligatoire">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1.5 text-[12px] font-medium text-bad">{error}</p>
      ) : (
        hint && <p className="mt-1.5 text-[12px] leading-snug text-faint">{hint}</p>
      )}
    </div>
  )
}

const CONTROL =
  'w-full rounded-xl border bg-surface-2 px-3.5 text-sm text-ink placeholder:text-faint/70 ' +
  'transition-[border-color,box-shadow,background-color] duration-150 ' +
  'focus:outline-none focus:border-brand-ring focus:ring-[3px] focus:ring-brand/20 ' +
  'disabled:cursor-not-allowed disabled:opacity-55'

/* ------------------------------------------------------------------ *
 *  Saisies
 * ------------------------------------------------------------------ */

export const Input = forwardRef(function Input({ className, invalid, ...props }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL, 'h-11', invalid ? 'border-bad' : 'border-line', className)}
      {...props}
    />
  )
})

export const Textarea = forwardRef(function Textarea({ className, invalid, rows = 3, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL, 'resize-y py-2.5 leading-relaxed', invalid ? 'border-bad' : 'border-line', className)}
      {...props}
    />
  )
})

export const Select = forwardRef(function Select({ className, invalid, children, ...props }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          CONTROL,
          'h-11 appearance-none pr-10',
          invalid ? 'border-bad' : 'border-line',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint"
        aria-hidden
      />
    </div>
  )
})

export function PasswordInput({ className, ...props }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        className={cn('pr-11', className)}
        autoComplete="current-password"
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-faint transition-colors hover:bg-surface-3 hover:text-soft"
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  )
}

/**
 * Saisie du code de séance — 6 caractères (§4).
 * La normalisation est faite par `normalizeSessionCode`, côté appelant.
 */
export const CodeInput = forwardRef(function CodeInput({ className, invalid, ...props }, ref) {
  return (
    <Input
      ref={ref}
      inputMode="text"
      autoCapitalize="characters"
      autoComplete="off"
      spellCheck={false}
      maxLength={6}
      invalid={invalid}
      className={cn(
        'h-14 text-center font-mono text-2xl font-bold uppercase tracking-[0.35em]',
        className,
      )}
      {...props}
    />
  )
})

/* ------------------------------------------------------------------ *
 *  Interrupteur et case à cocher
 * ------------------------------------------------------------------ */

export function Switch({ checked, onChange, label, hint, disabled, className, id }) {
  const generated = useId()
  const inputId = id ?? generated
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <button
        id={inputId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors duration-200',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring',
          checked ? 'border-brand bg-brand' : 'border-line-strong bg-surface-3',
          disabled && 'opacity-50',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-[18px] rounded-full bg-white shadow transition-[left] duration-200 ease-out',
            checked ? 'left-[22px]' : 'left-0.5',
          )}
        />
      </button>
      {(label || hint) && (
        <label htmlFor={inputId} className="min-w-0 cursor-pointer select-none">
          {label && <span className="block text-sm font-medium text-ink">{label}</span>}
          {hint && <span className="mt-0.5 block text-[12px] leading-snug text-faint">{hint}</span>}
        </label>
      )}
    </div>
  )
}

/** Case à cocher pour la liste des présents (§5). Grande cible tactile. */
export function CheckRow({ checked, onChange, title, subtitle, right, disabled, className }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      aria-pressed={checked}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring',
        checked
          ? 'border-ok/40 bg-ok-soft'
          : 'border-line bg-surface-2 hover:border-line-strong hover:bg-surface-3',
        disabled && 'pointer-events-none opacity-55',
        className,
      )}
    >
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors',
          checked ? 'border-ok bg-ok text-white' : 'border-line-strong bg-surface',
        )}
        aria-hidden
      >
        {checked && <Check className="size-4" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm font-medium', checked ? 'text-ok' : 'text-ink')}>
          {title}
        </span>
        {subtitle && <span className="block truncate text-[12px] text-faint">{subtitle}</span>}
      </span>
      {right}
    </button>
  )
}

/* ------------------------------------------------------------------ *
 *  Contrôle segmenté
 * ------------------------------------------------------------------ */

export function Segmented({ value, onChange, options, className, size = 'md' }) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex max-w-full gap-1 rounded-xl border border-line bg-surface-2 p-1 bande-defilante',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative shrink-0 rounded-lg font-medium transition-all duration-150',
              size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-3.5 py-1.5 text-[13px]',
              active
                ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]'
                : 'text-faint hover:text-soft',
            )}
          >
            {option.label}
            {option.count !== undefined && option.count !== null && (
              <span
                className={cn(
                  'ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                  active ? 'bg-brand-soft text-brand-text' : 'bg-surface-3 text-faint',
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Fichier
 * ------------------------------------------------------------------ */

/**
 * Sélecteur de fichier. L'attribut `accept` est une commodité d'interface : le
 * contrôle qui compte est fait sur le CONTENU du fichier, dans `files.js` et
 * `tabular.js` (§13.7).
 */
export function FileInput({ accept, onFile, label = 'Choisir un fichier', hint, disabled, className }) {
  const ref = useRef(null)
  const [nom, setNom] = useState(null)

  return (
    <div className={className}>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0]
          setNom(file?.name ?? null)
          if (file) onFile?.(file)
          // On remet à zéro pour permettre de redéposer le même fichier.
          event.target.value = ''
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => ref.current?.click()}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl border border-dashed border-line-strong bg-surface-2 px-4 py-4 text-left transition-colors',
          'hover:border-brand-ring hover:bg-surface-3 disabled:pointer-events-none disabled:opacity-55',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring',
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-text">
          <Upload className="size-4" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">{nom ?? label}</span>
          {hint && <span className="mt-0.5 block text-[12px] text-faint">{hint}</span>}
        </span>
      </button>
    </div>
  )
}
