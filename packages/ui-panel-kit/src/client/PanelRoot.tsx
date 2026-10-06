/**
 * The panel root: declares the `dsh-panel` size container so a plugin's CSS
 * can write `@container dsh-panel (max-width: 560px)`, and measures the same
 * width for the components that switch STRUCTURE (not just style) when the
 * panel is compact — the header's overflow menu, for one.
 *
 * @module @khorsheed/dsh-client-ui-panel-kit/client
 */
import { createContext, useContext, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from 'react'
import { PANEL_COMPACT_MAX } from './tokens.ts'
import css from './PanelRoot.module.css'

/**
 * Track whether an element is at or below the compact width. Zero widths
 * (a hidden or not-yet-laid-out panel) keep the previous answer rather than
 * flipping to compact and back.
 * @param ref - the element to observe.
 * @param max - compact threshold in px, inclusive (default {@link PANEL_COMPACT_MAX}).
 * @returns true while the element's width is at most `max`.
 */
export function usePanelCompact(ref: RefObject<HTMLElement | null>, max: number = PANEL_COMPACT_MAX): boolean {
  const [compact, setCompact] = useState(false)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const update = (width: number) => { if (width > 0) setCompact(width <= max) }
    update(element.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => { const entry = entries[0]; if (entry) update(entry.contentRect.width) })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, max])
  return compact
}

/** The nearest {@link PanelRoot}'s compact state; undefined outside one. */
const PanelCompactContext = createContext<boolean | undefined>(undefined)

/**
 * Read the enclosing panel's compact state.
 * @returns true/false inside a {@link PanelRoot}; undefined outside one.
 */
export function usePanelCompactContext(): boolean | undefined {
  return useContext(PanelCompactContext)
}

export interface PanelRootProps extends HTMLAttributes<HTMLDivElement> {
  readonly children?: ReactNode
}

/**
 * A panel's outermost box. Fills its host column, declares the container,
 * and exposes `data-panel-compact` for selectors that cannot use a container
 * query (a portalled child, a test).
 */
export function PanelRoot({ children, className, ...rest }: PanelRootProps) {
  const ref = useRef<HTMLDivElement>(null)
  const compact = usePanelCompact(ref)
  return <div {...rest} ref={ref} className={className ? `${css.root} ${className}` : css.root} data-panel-compact={compact ? 'true' : 'false'}>
    <PanelCompactContext.Provider value={compact}>{children}</PanelCompactContext.Provider>
  </div>
}
