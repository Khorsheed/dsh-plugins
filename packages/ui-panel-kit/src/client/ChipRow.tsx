/**
 * Filter chips — ONE chip style per the spec: selected is an accent-tinted
 * fill with accent text, unselected is a hairline outline. Optional count and
 * colour dot. The row scrolls sideways instead of wrapping, so a panel's
 * filter row is always exactly one row tall.
 *
 * Selection policy stays with the caller: `value` may be one id (single
 * choice) or several (independent toggles), and `onSelect` reports the
 * pressed chip — the caller decides whether that replaces or toggles.
 * "Manage categories"-style entries belong in the header's ⋯ menu, not here.
 *
 * `tools` is the row's own icon buttons (mark all seen, a filter toggle):
 * pinned at the row's end, outside the sideways scroll, so they never slide
 * away with the chips — a consumer used to hand-build that wrapper.
 *
 * @module @khorsheed/dsh-client-ui-panel-kit/client
 */
import type { CSSProperties, ReactNode } from 'react'
import css from './ChipRow.module.css'

/** One chip. */
export interface Chip<Id extends string = string> {
  readonly id: Id
  readonly label: ReactNode
  /** A trailing count (e.g. cards in this category). */
  readonly count?: number | undefined
  /** A leading dot colour (a category's own colour). */
  readonly color?: string | undefined
}

export interface ChipRowProps<Id extends string = string> {
  readonly chips: readonly Chip<Id>[]
  /** Selected id, or ids for independent toggles. */
  readonly value: Id | readonly Id[]
  readonly onSelect: (id: Id) => void
  /** The group's accessible name. */
  readonly label: string
  /** Icon buttons pinned at the row's end, outside the chips' scroll. */
  readonly tools?: ReactNode
  /** On the row, or on the row-plus-tools wrapper when `tools` is given. */
  readonly className?: string | undefined
}

/** A one-row, sideways-scrolling chip group. */
export function ChipRow<Id extends string>({ chips, value, onSelect, label, tools, className }: ChipRowProps<Id>) {
  const selected = new Set<string>(typeof value === 'string' ? [value] : value)
  const outer = (base: string | undefined) => className ? `${base ?? ""} ${className}` : base
  const row = <div role="group" aria-label={label} className={tools === undefined ? outer(css.row) : css.row}>
    {chips.map(chip => <button key={chip.id} type="button" className={css.chip} aria-pressed={selected.has(chip.id)} onClick={() => { onSelect(chip.id) }}>
      {chip.color !== undefined && <span className={css.dot} style={{ '--chip-dot': chip.color } as CSSProperties} aria-hidden="true" />}
      <span>{chip.label}</span>
      {chip.count !== undefined && <span className={css.count}>{chip.count}</span>}
    </button>)}
  </div>
  if (tools === undefined) return row
  return <div className={outer(css.withTools)}>{row}<div className={css.tools}>{tools}</div></div>
}
