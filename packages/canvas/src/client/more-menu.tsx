/**
 * The canvas's one ⋯ menu: a quiet icon trigger over the host's `Menu`, so
 * the rows, the danger styling and the Escape / outside-click / focus return
 * are the host's own rather than a third hand-rolled popover. The wrapper
 * swallows clicks because the menu often sits inside a clickable card — and a
 * portalled list still bubbles its React events through the card that holds
 * the trigger.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useState, type ReactNode } from 'react'
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconEllipsisOutlineMedium } from './icons.tsx'

/**
 * A ⋯ trigger and its rows.
 * @param props.label - the trigger's accessible name and tooltip.
 * @param props.items - the rows (a `danger` row renders in the error colour).
 * @param props.onSelect - called with the picked row's id; the menu closes itself.
 * @param props.className - the trigger's class (each seat sizes its own).
 */
export function MoreMenu({ label, items, onSelect, className }: {
  readonly label: string
  readonly items: readonly MenuEntry[]
  readonly onSelect: (id: string) => void
  readonly className?: string | undefined
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <span onClick={event => { event.stopPropagation() }}>
      <Menu
        open={open}
        portal
        align="end"
        dense
        items={items}
        onSelect={id => {
          setOpen(false)
          onSelect(id)
        }}
        onClose={() => { setOpen(false) }}
        anchor={(
          <button
            type="button"
            className={className}
            title={label}
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconEllipsisOutlineMedium size={13} />
          </button>
        )}
      />
    </span>
  )
}
