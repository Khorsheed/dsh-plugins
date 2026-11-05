import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { NovelSurfaceProps } from './contract.ts'
import css from './codex.module.css'

/** One fixed card-header menu: details first, destructive actions through the shared delete preview. */
export function NodeActions({ node, name, openCard, del, t }: {
  readonly node: string
  readonly name: string
  readonly openCard: (cardId: string, heading: string) => void
  readonly del: (node: string) => ReactNode
  readonly t: NovelSurfaceProps['t']
}): ReactNode {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent): void => {
      if (event.target instanceof Node && root.current?.contains(event.target) !== true) setOpen(false)
    }
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', key) }
  }, [open])
  return (
    <span className={css.nodeActions} ref={root}>
      <button type="button" className={css.ghost} aria-label={t('action.more')} aria-expanded={open} onClick={() => { setOpen(value => !value) }}>⋯</button>
      {open && (
        <span className={css.nodeMenu}>
          <button type="button" onClick={() => { setOpen(false); openCard(node, name) }}>{t('codex.details')}</button>
          {del(node)}
        </span>
      )}
    </span>
  )
}
