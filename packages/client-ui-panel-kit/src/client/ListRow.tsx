/**
 * A list row: leading icon, a title in the primary colour (names are never
 * grey), an optional meta note, and an optional trailing element (a date, a
 * chevron, a count). Selection is an accent-tinted fill, not a grey one.
 *
 * Renders a button when it is actionable (`onSelect`), a plain row otherwise.
 *
 * @module @khorsheed/dsh-client-ui-panel-kit/client
 */
import type { ReactNode } from 'react'
import css from './ListRow.module.css'

export interface ListRowProps {
  readonly title: ReactNode
  readonly icon?: ReactNode
  /** A short secondary line or note beside the title. */
  readonly meta?: ReactNode
  /** Right-aligned element: a date, a chevron. */
  readonly trailing?: ReactNode
  readonly selected?: boolean | undefined
  readonly onSelect?: (() => void) | undefined
  /** Native tooltip, e.g. the full path behind a truncated name. */
  readonly hint?: string | undefined
  readonly className?: string | undefined
}

/** One row of a panel list. */
export function ListRow({ title, icon, meta, trailing, selected = false, onSelect, hint, className }: ListRowProps) {
  const body = <>
    {icon !== undefined && <span className={css.icon} aria-hidden="true">{icon}</span>}
    <span className={css.text}>
      <span className={css.title}>{title}</span>
      {meta !== undefined && <span className={css.meta}>{meta}</span>}
    </span>
    {trailing !== undefined && <span className={css.trailing}>{trailing}</span>}
  </>
  const classes = className ? `${css.row} ${className}` : css.row
  return onSelect
    ? <button type="button" className={classes} data-selected={selected ? 'true' : 'false'} aria-current={selected ? 'true' : undefined} title={hint} onClick={onSelect}>{body}</button>
    : <div className={classes} data-selected={selected ? 'true' : 'false'} title={hint}>{body}</div>
}
