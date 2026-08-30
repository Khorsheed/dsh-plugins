import { useEffect, useRef, type ReactNode } from 'react'
  import type { CapabilityCatalogKey } from './locales.ts'
  import css from './CapabilityCatalogCard.module.css'

/** Shared modal chrome for every content dialog in the section (tool detail,
 * skill detail, MCP manage, the two add forms): a centered overlay with a fixed
 * head (title + ×) and a scrolling body. Esc and (optionally) mask-click close
 * it — but only when it is the TOPMOST dialog in the DOM, so a stacked modal
 * (tool detail over the MCP manage modal) never collapses the one beneath it. */
export function ModalShell({ title, onClose, children, className, closeOnMask = true, t }: {
  title: string
  onClose: () => void
  children: ReactNode
  className?: string | undefined
  closeOnMask?: boolean
  t: (key: CapabilityCatalogKey) => string
}) {
  const overlayRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const me = overlayRef.current
      if (me === null) return
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
      if (dialogs[dialogs.length - 1] === me) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      ref={overlayRef}
      className={css.overlay}
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (closeOnMask && e.target === e.currentTarget) onClose() }}
    >
      <div className={className === undefined ? css.modal : `${css.modal} ${className}`}>
        <div className={css.modalHead}>
          <h3 className={css.modalTitle}>{title}</h3>
          <button type="button" className={css.modalClose} onClick={onClose} aria-label={t('detailClose')}>×</button>
        </div>
        <div className={css.modalBody}>{children}</div>
      </div>
    </div>
  )
}
