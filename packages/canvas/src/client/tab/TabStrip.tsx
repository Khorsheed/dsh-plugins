/**
 * The canvas surface's own tab strip (round-3 review, item ⑥).
 *
 * Before this row existed, "open a card" added a tab to the HOST dock — one
 * level UP from the board the card came from, so the strip of open things and
 * the thing being looked at lived in two different chrome layers and the dock
 * said 画布 for every one of them. Inside this surface a tab is a row here,
 * and since scheme B (2026-09-27) a row is one CANVAS: a card opens inside its
 * canvas's row, behind the detail's breadcrumb, so the strip never fills with
 * look-alike card rows that hide which canvas each came from.
 *
 * The rows are resolved by the caller (`labelOf` has to read the canvas list),
 * so this component holds no state and fetches nothing: `rows` in, two
 * callbacks out. The ＋ tail is passed as a node because it is the canvas
 * switcher's own dropdown, not this strip's business. The scroll box is only
 * as wide as its rows, so the ＋ follows the last one like the dock's ＋ does.
 *
 * The rows are underlined, not tabbed: the host's dock chips sit right above
 * this strip, and a second row of filled tabs read as tabs stacked on tabs
 * (2026-09-28 review). An underline marks the showing canvas one level
 * quieter than the dock, and the rows carry no glyph — the dock chip already
 * says 画布, and the sun that used to lead each row is the host's light-theme
 * icon, not a canvas.
 *
 * The strip scrolls sideways instead of shrinking rows: a tab whose title is
 * squeezed to four characters identifies nothing. The menu sits OUTSIDE the
 * scroll box, not sticky inside it — a control that can be scrolled away is
 * not a control (the category strip above the board follows the same rule),
 * and the scroll box's `overflow` clipped the tail's dropdown to a sliver the
 * one time the menu was asked for (the 新画布 "dead click"). The frame owns
 * the bottom rule instead, so the active row still paints its cover over it.
 *
 * The scroll box draws NO scrollbar (2026-09-28 review: a bar showed under two
 * short tabs, a sub-pixel overflow of the content-wide box made visible by
 * macOS's always-show-scrollbars setting). It still scrolls: a vertical wheel
 * turns sideways, a trackpad swipes as it always did, and the showing row is
 * scrolled into view whenever it changes.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { IconCloseOutlineMedium } from '../icons.tsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '../locales.ts'
import css from './tab-strip.module.css'

/** One strip row, already resolved to the words it shows. */
export interface StripTab {
  readonly id: string
  /** The row's text: the canvas's title. */
  readonly label: string
}

/** What the strip's rows answer to. */
export interface TabStripProps {
  readonly t: TranslateNS<'canvas'>
  readonly rows: readonly StripTab[]
  /** The showing row's id, or `''` when the strip is empty. */
  readonly active: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
  /** The row's tail: the ＋ menu that puts new rows on the strip. */
  readonly tail?: ReactNode
}

/** The canvas surface's tab strip. */
export function TabStrip({ t, rows, active, onSelect, onClose, tail }: TabStripProps): ReactNode {
  const stripRef = useRef<HTMLDivElement | null>(null)

  // A mouse wheel only scrolls vertically; the strip has nothing to scroll that
  // way, so its vertical delta moves the rows sideways. Native listener: React's
  // wheel handler is passive and cannot keep the page from scrolling too.
  useEffect(() => {
    const strip = stripRef.current
    if (strip === null) return
    const onWheel = (event: WheelEvent): void => {
      if (strip.scrollWidth <= strip.clientWidth) return
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      strip.scrollLeft += event.deltaY
      event.preventDefault()
    }
    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => { strip.removeEventListener('wheel', onWheel) }
  }, [])

  // With no scrollbar to hint at hidden rows, the showing one is always brought
  // into view (an ＋ opened far right, a tab picked from the menu).
  useEffect(() => {
    const row = stripRef.current?.querySelector('[data-active]')
    if (row instanceof HTMLElement && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [active, rows.length])

  return (
    <div className={css.stripFrame}>
      <div ref={stripRef} className={css.strip} role="tablist">
        {rows.map(row => (
          <span key={row.id} className={css.tab} data-active={row.id === active || undefined}>
            <button
              type="button"
              role="tab"
              className={css.label}
              aria-selected={row.id === active}
              title={row.label}
              onClick={() => { onSelect(row.id) }}
            >
              <span className={css.labelText}>{row.label}</span>
            </button>
            <button
              type="button"
              className={css.close}
              title={t('strip.close')}
              aria-label={t('strip.close')}
              onClick={() => { onClose(row.id) }}
            >
              {/* The Outline cross spans 11/16 of its box — the Fill one only
                9/16, which read as a speck beside the row's text (2026-09-28
                review). Outline is the close the host uses almost everywhere. */}
              <IconCloseOutlineMedium size={14} />
            </button>
          </span>
        ))}
      </div>
      {tail !== undefined && <span className={css.tail}>{tail}</span>}
    </div>
  )
}
