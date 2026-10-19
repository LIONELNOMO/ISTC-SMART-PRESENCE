import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'

import { cn } from '../../lib/utils.js'
import { randomId } from '../../lib/crypto.js'
import { Button, IconButton } from './primitives.jsx'

/* ------------------------------------------------------------------ *
 *  Fenêtre modale
 * ------------------------------------------------------------------ */

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', className }) {
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'animate-in relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-pop sm:rounded-card',
          sizes[size],
          className,
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] leading-snug text-faint">{subtitle}</p>}
          </div>
          <IconButton label="Fermer" onClick={onClose} size="icon-sm">
            <X className="size-4" aria-hidden />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2/60 px-5 py-3.5 safe-bottom max-[420px]:*:flex-1">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* ------------------------------------------------------------------ *
 *  Confirmation
 * ------------------------------------------------------------------ */

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  tone = 'primary',
  loading = false,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-soft">{children}</p>
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 *  Notifications éphémères
 * ------------------------------------------------------------------ */

const ToastContext = createContext(null)

const TOAST_TONES = {
  ok: { box: 'border-ok/35 bg-ok-soft text-ok', Icon: CheckCircle2 },
  bad: { box: 'border-bad/35 bg-bad-soft text-bad', Icon: XCircle },
  warn: { box: 'border-warn/40 bg-warn-soft text-warn', Icon: AlertTriangle },
  info: { box: 'border-info/35 bg-info-soft text-info', Icon: Info },
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const remove = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (toast) => {
      const id = randomId()
      const duration = toast.duration ?? (toast.tone === 'bad' ? 7000 : 4000)
      setToasts((list) => [...list.slice(-3), { id, ...toast }])
      if (duration > 0) setTimeout(() => remove(id), duration)
      return id
    },
    [remove],
  )

  const api = useMemo(
    () => ({
      toast: push,
      succes: (titre, detail) => push({ tone: 'ok', titre, detail }),
      erreur: (titre, detail) => push({ tone: 'bad', titre, detail }),
      attention: (titre, detail) => push({ tone: 'warn', titre, detail }),
      info: (titre, detail) => push({ tone: 'info', titre, detail }),
      fermer: remove,
    }),
    [push, remove],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-3 pb-20 sm:bottom-4 sm:right-4 sm:left-auto sm:items-end sm:pb-0"
          role="region"
          aria-live="polite"
        >
          {toasts.map((toast) => {
            const { box, Icon } = TOAST_TONES[toast.tone ?? 'info'] ?? TOAST_TONES.info
            return (
              <div
                key={toast.id}
                className={cn(
                  'animate-pop pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-pop backdrop-blur',
                  box,
                )}
              >
                <Icon className="mt-0.5 size-[18px] shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold leading-snug">{toast.titre}</p>
                  {toast.detail && (
                    <p className="mt-0.5 text-[12px] leading-relaxed text-current/85">{toast.detail}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(toast.id)}
                  aria-label="Fermer"
                  className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            )
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast doit être utilisé dans <ToastProvider>')
  return value
}
