/**
 * Segmented switching as underline tabs — the same treatment as the mobile
 * panel tabs (bold active label, 2.5px accent underline), so a panel's own
 * view switch (board / links / draft, preview / source) reads as one family
 * with the tab strip above it instead of a grey box beneath it.
 *
 * `trailing` puts the row's own controls (a ⋯ menu, a layout toggle) on the
 * SAME row, sharing the tabs' one bottom rule — a consumer that sets them
 * beside the tablist itself ends up drawing a second divider. On a coarse
 * pointer the row grows to 44px (the touch target); the text size stays
 * `--dsh-panel-text-body`.
 *
 * @module @khorsheed/dsh-client-ui-panel-kit/client
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import css from './UnderlineTabs.module.css'

/** One tab. */
export interface UnderlineTab<Id extends string = string> {
  readonly id: Id
  readonly label: ReactNode
  readonly disabled?: boolean | undefined
  /**
   * A count or dot beside the label (e.g. chapters waiting on the person).
   * Rendered next to the label, not inside it: the accent underline spans the
   * label only, and the badge keeps its own weight and colour on the selected
   * tab. Folding it into `label` puts it under the underline and in bold.
   */
  readonly badge?: ReactNode
}

export interface UnderlineTabsProps<Id extends string = string> {
  readonly tabs: readonly UnderlineTab<Id>[]
  readonly value: Id
  readonly onChange: (id: Id) => void
  /** The tablist's accessible name. */
  readonly label: string
  /** Controls at the row's end (⋯, a layout toggle), on the tabs' baseline. */
  readonly trailing?: ReactNode
  /** On the tablist, or on the tabs-plus-trailing row when `trailing` is given. */
  readonly className?: string | undefined
}

/**
 * Next enabled index walking from `from` by `step`, wrapping; `from` when
 * every other tab is disabled.
 */
function walk(tabs: readonly UnderlineTab[], from: number, step: 1 | -1): number {
  for (let i = 1; i <= tabs.length; i++) {
    const next = (from + step * i + tabs.length * i) % tabs.length
    if (!tabs[next]?.disabled) return next
  }
  return from
}

/** A row of underline tabs with roving focus (arrows, Home, End). */
export function UnderlineTabs<Id extends string>({ tabs, value, onChange, label, trailing, className }: UnderlineTabsProps<Id>) {
  const list = useRef<HTMLDivElement>(null)
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex(tab => tab.id === value)
    const enabled = tabs.map((tab, i) => tab.disabled ? -1 : i).filter(i => i >= 0)
    const target = event.key === 'ArrowRight' ? walk(tabs, index, 1)
      : event.key === 'ArrowLeft' ? walk(tabs, index, -1)
        : event.key === 'Home' ? enabled[0]
          : event.key === 'End' ? enabled[enabled.length - 1] : undefined
    const tab = target === undefined ? undefined : tabs[target]
    if (!tab || target === undefined) return
    event.preventDefault()
    onChange(tab.id)
    list.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[target]?.focus()
  }
  const outer = (base: string | undefined) => className ? `${base ?? ""} ${className}` : base
  const tablist = <div ref={list} role="tablist" aria-label={label} className={trailing === undefined ? outer(css.tabs) : css.tabs} onKeyDown={keyDown}>
    {tabs.map(tab => {
      const selected = tab.id === value
      return <button key={tab.id} type="button" role="tab" className={css.tab} aria-selected={selected} tabIndex={selected ? 0 : -1}
        disabled={tab.disabled} onClick={() => { onChange(tab.id) }}><span className={css.label}>{tab.label}</span>
        {tab.badge !== undefined && tab.badge !== null && tab.badge !== false && <span className={css.badge}>{tab.badge}</span>}</button>
    })}
  </div>
  if (trailing === undefined) return tablist
  return <div className={outer(css.bar)}>{tablist}<div className={css.trailing}>{trailing}</div></div>
}
