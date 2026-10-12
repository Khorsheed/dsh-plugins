/**
 * The segmented switch of the reference design (`segCtl`): the header's
 * Token/耗时 mini switch and the footer's 结构化/原始 JSON/wire body view
 * switch. A disabled option renders dim with its hint as the tooltip (the
 * wire-body enhancement seat).
 *
 * @module @khorsheed/dsh-context-lens/client
 */
import type { ReactNode } from 'react'
import css from './SegCtl.module.css'

/** One segment of the switch. */
export interface SegCtlOption<Id extends string = string> {
  readonly id: Id
  readonly label: ReactNode
  /** Disabled options render dim and never fire (the wire-body seat). */
  readonly disabled?: boolean | undefined
  /** Tooltip on a disabled option. */
  readonly hint?: string | undefined
  /** A small trailing tag (the `≥0.1.2` marker). */
  readonly tag?: string | undefined
}

export interface SegCtlProps<Id extends string = string> {
  readonly options: readonly SegCtlOption<Id>[]
  readonly value: Id
  readonly onChange: (id: Id) => void
  /** The group's accessible name. */
  readonly label: string
  /** The header's compact variant. */
  readonly mini?: boolean | undefined
}

/** The pill segmented control. */
export function SegCtl<Id extends string>({ options, value, onChange, label, mini = false }: SegCtlProps<Id>) {
  return (
    <div className={mini ? css.mini : css.root} role="group" aria-label={label}>
      {options.map(option => {
        const selected = option.id === value
        if (option.disabled === true) {
          return (
            <button
              key={option.id}
              type="button"
              className={css.dim}
              disabled
              title={option.hint}
            >
              {option.label}
              {option.tag !== undefined && <span className={css.tag}>{option.tag}</span>}
            </button>
          )
        }
        return (
          <button
            key={option.id}
            type="button"
            className={selected ? css.on : css.off}
            aria-pressed={selected}
            onClick={() => { onChange(option.id) }}
          >
            {option.label}
            {option.tag !== undefined && <span className={css.tag}>{option.tag}</span>}
          </button>
        )
      })}
    </div>
  )
}
