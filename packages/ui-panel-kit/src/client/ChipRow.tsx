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
  readonly className?: string | undefined
}

/** A one-row, sideways-scrolling chip group. */
export function ChipRow<Id extends string>({ chips, value, onSelect, label, className }: ChipRowProps<Id>) {
  const selected = new Set<string>(typeof value === 'string' ? [value] : value)
  return <div role="group" aria-label={label} className={className ? `${css.row} ${className}` : css.row}>
    {chips.map(chip => <button key={chip.id} type="button" className={css.chip} aria-pressed={selected.has(chip.id)} onClick={() => { onSelect(chip.id) }}>
      {chip.color !== undefined && <span className={css.dot} style={{ '--chip-dot': chip.color } as CSSProperties} aria-hidden="true" />}
      <span>{chip.label}</span>
      {chip.count !== undefined && <span className={css.count}>{chip.count}</span>}
    </button>)}
  </div>
}
