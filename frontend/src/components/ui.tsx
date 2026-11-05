import { AnimatePresence, motion } from 'framer-motion'
import { Check, Copy, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../lib/store'
import { useI18n } from '../i18n'

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity=".2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function IconButton({ children, onClick, title, className = '', disabled = false }: {
  children: ReactNode; onClick?: () => void; title?: string; className?: string; disabled?: boolean
}) {
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}
      className={`btn btn-quiet !p-1.5 ${className}`}>{children}</button>
  )
}

// Escape closes only the topmost modal; body scroll is locked while any modal is open.
const modalClosers: Array<() => void> = []
let scrollLockCount = 0
let savedOverflow = ''

export function Modal({ open, onClose, title, children, footer, wide = false }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean
}) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const closer = () => closeRef.current()
    modalClosers.push(closer)
    if (scrollLockCount++ === 0) {
      savedOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalClosers[modalClosers.length - 1] === closer) {
        e.preventDefault()
        e.stopPropagation()
        closer()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      const i = modalClosers.indexOf(closer)
      if (i >= 0) modalClosers.splice(i, 1)
      if (--scrollLockCount === 0) document.body.style.overflow = savedOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm" onClick={onClose} />
          <motion.div initial={{ opacity: 0, y: 18, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: .98 }} transition={{ duration: .2 }}
            className={`card relative z-10 w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[88vh] flex flex-col`}>
            <div className="flex items-center justify-between px-5 py-4 border-b divider">
              <h3 className="font-semibold text-base">{title}</h3>
              <IconButton onClick={onClose} title="Close"><X size={17} /></IconButton>
            </div>
            <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
            {footer && <div className="px-5 py-3 border-t divider flex justify-end gap-2">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  return (
    <div className="fixed bottom-5 right-4 z-[60] flex flex-col gap-2 items-end pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} initial={{ opacity: 0, x: 24, scale: .96 }} animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24 }} className="card pointer-events-auto px-3.5 py-2.5 text-sm flex items-center gap-2 max-w-sm">
            <span className={`w-1.5 h-1.5 rounded-full ${t.kind === 'error' ? 'bg-danger' : t.kind === 'ok' ? 'bg-positive' : 'bg-brand'}`} />
            <span className="flex-1">{t.text}</span>
            <button onClick={() => dismiss(t.id)} className="text-muted hover:text-ink"><X size={14} /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function CopyButton({ value, label, className = '' }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const { t } = useI18n()
  const copy = async () => {
    try { await navigator.clipboard.writeText(value) } catch { /* clipboard unavailable */ }
    setCopied(true); setTimeout(() => setCopied(false), 1600)
  }
  return (
    <button type="button" onClick={copy} className={`btn btn-ghost !py-1.5 !px-2.5 text-xs ${className}`}>
      {copied ? <Check size={13} /> : <Copy size={13} />}{label || (copied ? t('common.copied') : t('common.copy'))}
    </button>
  )
}

export function Empty({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center px-4">
      {icon && <div className="p-3 rounded-2xl bg-brand/10 text-brand mb-1">{icon}</div>}
      <div className="font-medium text-sm">{title}</div>
      {hint && <div className="text-xs text-muted max-w-sm">{hint}</div>}
    </div>
  )
}

export function ConfirmDialog({ open, title, message, onConfirm, onCancel, confirmLabel }: {
  open: boolean; title: string; message: string; onConfirm: () => void; onCancel: () => void; confirmLabel?: string
}) {
  const { t } = useI18n()
  return (
    <Modal open={open} onClose={onCancel} title={title}
      footer={<>
        <button className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="btn btn-primary" onClick={onConfirm}>{confirmLabel || t('common.confirm')}</button>
      </>}>
      <p className="text-sm leading-relaxed text-muted">{message}</p>
    </Modal>
  )
}

export function SectionTitle({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h2 className="text-lg font-semibold tracking-tight">{children}</h2>
      {extra}
    </div>
  )
}

export function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-positive' : 'bg-danger'}`} />
}
