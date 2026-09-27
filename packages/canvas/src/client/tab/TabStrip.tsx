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
 * callbacks out. The 画布 ▾ tail is passed as a node because it is the canvas
 * switcher's own dropdown, not this strip's business.
 *
 * The strip scrolls sideways instead of shrinking rows: a tab whose title is
 * squeezed to four characters identifies nothing. The menu sits OUTSIDE the
 * scroll box, not sticky inside it — a control that can be scrolled away is
 * not a control (the category strip above the board follows the same rule),
 * and the scroll box's `overflow` clipped the tail's dropdown to a sliver the
 * one time the menu was asked for (the 新画布 "dead click"). The frame owns
 * the bottom rule instead, so the active row still paints its cover over it.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { ReactNode } from 'react'
import { IconCloseFillRegular, IconLightOutlineMedium } from '../icons.tsx'
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
  /** The row's tail: the 画布 ▾ menu that puts new rows on the strip. */
  readonly tail?: ReactNode
}

/** The canvas surface's tab strip. */
export function TabStrip({ t, rows, active, onSelect, onClose, tail }: TabStripProps): ReactNode {
  return (
    <div className={css.stripFrame}>
      <div className={css.strip} role="tablist">
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
              <IconLightOutlineMedium size={12} />
              <span className={css.labelText}>{row.label}</span>
            </button>
            <button
              type="button"
              className={css.close}
              title={t('strip.close')}
              aria-label={t('strip.close')}
              onClick={() => { onClose(row.id) }}
            >
              {/* The host dock's own close: Regular weight at 14 (TabPanel.tsx).
                The Fill artwork's cross spans only 9/16 of its box, so at the
                rows' 12px it read smaller than every outline glyph beside it —
                14 is the size the host chose for the same glyph. */}
            <IconCloseFillRegular size={14} />
            </button>
          </span>
        ))}
      </div>
      {tail !== undefined && <span className={css.tail}>{tail}</span>}
    </div>
  )
}
