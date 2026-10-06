/**
 * A retained master/detail surface: container width changes presentation,
 * never ownership. Wide, the two sit side by side; at or below
 * {@link PANEL_COMPACT_MAX} the detail replaces the master while it is open,
 * with a back gesture returning to the retained master.
 *
 * The back gesture is a full-width row above the detail by default. A detail
 * that has its own title bar (the shared content pane) sets `backInDetail` and
 * reads {@link useAdaptiveSplitBack} instead, so the narrow detail spends one
 * row on chrome rather than two.
 *
 * Moved here from ui-content-preview (panel-responsive-spec P1): it is panel
 * layout, not preview rendering.
 *
 * @module @khorsheed/dsh-client-ui-panel-kit/client
 */
import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { PANEL_COMPACT_MAX } from './tokens.ts'
import css from './AdaptiveSplit.module.css'

export interface AdaptiveSplitProps {
  readonly master: ReactNode
  readonly detail: ReactNode
  readonly detailOpen: boolean
  readonly onBack: () => void
  readonly backLabel: string
  readonly masterWidth?: number
  readonly divider?: ReactNode
  /** Narrow threshold in px, inclusive (default {@link PANEL_COMPACT_MAX}). */
  readonly breakpoint?: number
  /** The detail renders the back control itself, via {@link useAdaptiveSplitBack}. */
  readonly backInDetail?: boolean
}

/** What a detail needs to draw the split's back control in its own header. */
export interface AdaptiveSplitBack {
  readonly onBack: () => void
  readonly backLabel: string
  /** Attach to the back button: the split moves focus there when the detail opens. */
  readonly backRef: RefObject<HTMLButtonElement>
}

const AdaptiveSplitBackContext = createContext<AdaptiveSplitBack | undefined>(undefined)

/**
 * The enclosing split's back control, when the detail is expected to draw it:
 * defined only inside a `backInDetail` split that is narrow with its detail open.
 * @returns the back handler, its label and the focus ref; undefined otherwise.
 */
export function useAdaptiveSplitBack(): AdaptiveSplitBack | undefined {
  return useContext(AdaptiveSplitBackContext)
}

/** A retained master/detail surface. */
export function AdaptiveSplit({ master, detail, detailOpen, onBack, backLabel, masterWidth = 300, divider, breakpoint = PANEL_COMPACT_MAX, backInDetail = false }: AdaptiveSplitProps) {
  const root = useRef<HTMLDivElement>(null)
  const masterRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const update = (width: number) => { if (width > 0) setNarrow(width <= breakpoint) }
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
  const delegated = backInDetail && narrow && detailOpen
  const backValue = useMemo<AdaptiveSplitBack | undefined>(
    () => delegated ? { onBack, backLabel, backRef: back } : undefined,
    [delegated, onBack, backLabel],
  )
  return <div ref={root} className={css.root} data-adaptive-split={narrow ? 'narrow' : 'wide'} style={{ '--adaptive-master-width': `${masterWidth}px` } as CSSProperties}>
    <div ref={masterRef} className={css.master} hidden={narrow && detailOpen} onFocusCapture={event => { previousFocus.current = event.target }}>{master}</div>
    <div className={css.divider} hidden={narrow || divider === undefined}>{divider}</div>
    <div ref={detailRef} className={css.detail} hidden={narrow && !detailOpen}>
      {!backInDetail && <button ref={back} type="button" className={css.back} hidden={!narrow} onClick={onBack} aria-label={backLabel}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m14 6-6 6 6 6"/></svg><span>{backLabel}</span></button>}
      <AdaptiveSplitBackContext.Provider value={backValue}>{detail}</AdaptiveSplitBackContext.Provider>
    </div>
  </div>
}
