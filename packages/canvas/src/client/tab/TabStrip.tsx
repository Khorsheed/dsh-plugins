/**
 * The canvas surface's own tab strip (round-3 review, item ⑥).
 *
 * Before this row existed, "open a card" added a tab to the HOST dock — one
 * level UP from the board the card came from, so the strip of open things and
 * the thing being looked at lived in two different chrome layers and the dock
 * said 画布 for every one of them. Inside this surface a tab is a row here: a
 * board, a card of it, and that card's unsaved draft are three rows of one
 * strip, and the row says which canvas it belongs to.
 *
 * The rows are resolved by the caller (`labelOf` has to read the canvas list),
 * so this component holds no state and fetches nothing: `rows` in, two
 * callbacks out. The ＋ tail is passed as a node because it is the canvas
 * switcher's own dropdown, not this strip's business.
 *
 * The strip scrolls sideways instead of shrinking rows: a tab whose title is
 * squeezed to four characters identifies nothing, and the ＋ at the end is
 * sticky for the same reason a control that can be scrolled away is not a
 * control (the category strip above the board follows the same rule).
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { ReactNode } from 'react'
import {
  IconCloseFillMedium, IconLightOutlineMedium, IconListPenOutlineMedium, IconPlusOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { CanvasTabRow } from '../space/selection.ts'
import type {} from '../locales.ts'
import css from './tab-strip.module.css'

/** One strip row, already resolved to the words it shows. */
export interface StripTab {
  readonly id: string
  /** Which glyph the row carries. */
  readonly kind: CanvasTabRow['kind']
  /** The row's text: a canvas title, or the card's / draft's heading. */
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
  /** The row's tail: the ＋ panel that puts new rows on the strip. */
  readonly tail?: ReactNode
}

/** The glyph that tells a board row from a card row from a draft at a glance. */
function glyphOf(kind: CanvasTabRow['kind']): ReactNode {
  if (kind === 'board') return <IconLightOutlineMedium size={12} />
  if (kind === 'draft') return <IconPlusOutlineMedium size={12} />
  return <IconListPenOutlineMedium size={12} />
}

/** The canvas surface's tab strip. */
export function TabStrip({ t, rows, active, onSelect, onClose, tail }: TabStripProps): ReactNode {
  return (
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
            {glyphOf(row.kind)}
            <span className={css.labelText}>{row.label}</span>
          </button>
          <button
            type="button"
            className={css.close}
            title={t('strip.close')}
            aria-label={t('strip.close')}
            onClick={() => { onClose(row.id) }}
          >
            <IconCloseFillMedium size={12} />
          </button>
        </span>
      ))}
      {tail !== undefined && <span className={css.tail}>{tail}</span>}
    </div>
  )
}
