import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import css from './AdaptiveSplit.module.css'

export interface AdaptiveSplitProps {
  readonly master: ReactNode
  readonly detail: ReactNode
  readonly detailOpen: boolean
  readonly onBack: () => void
  readonly backLabel: string
  readonly masterWidth?: number
  readonly divider?: ReactNode
  readonly breakpoint?: number
}

/** A retained master/detail surface: container width changes presentation, never ownership. */
export function AdaptiveSplit({ master, detail, detailOpen, onBack, backLabel, masterWidth = 300, divider, breakpoint = 560 }: AdaptiveSplitProps) {
  const root = useRef<HTMLDivElement>(null)
  const masterRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const update = (width: number) => { if (width > 0) setNarrow(width < breakpoint) }
    update(element.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => { const entry = entries[0]; if (entry) update(entry.contentRect.width) })
    observer.observe(element)
    return () => observer.disconnect()
  }, [breakpoint])
  useLayoutEffect(() => {
    if (narrow && detailOpen) {
      back.current?.focus()
    } else if (narrow && !detailOpen && detailRef.current?.contains(document.activeElement)) {
      if (previousFocus.current?.isConnected && masterRef.current?.contains(previousFocus.current)) previousFocus.current.focus()
    }
  }, [narrow, detailOpen])
  return <div ref={root} className={css.root} data-adaptive-split={narrow ? 'narrow' : 'wide'} style={{ '--adaptive-master-width': `${masterWidth}px` } as CSSProperties}>
    <div ref={masterRef} className={css.master} hidden={narrow && detailOpen} onFocusCapture={event => { previousFocus.current = event.target }}>{master}</div>
    <div className={css.divider} hidden={narrow || divider === undefined}>{divider}</div>
    <div ref={detailRef} className={css.detail} hidden={narrow && !detailOpen}>
      <button ref={back} type="button" className={css.back} hidden={!narrow} onClick={onBack} aria-label={backLabel}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m14 6-6 6 6 6"/></svg><span>{backLabel}</span></button>
      {detail}
    </div>
  </div>
}
