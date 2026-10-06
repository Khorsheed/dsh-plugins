/**
 * The 题集 table's ⋯ menu (T101): a quiet icon trigger over the host's `Menu`,
 * so the rows, the danger styling and the Escape / outside-click / focus
 * return are the host's own rather than a hand-rolled popover. The canvas
 * carries the same shape (`packages/canvas/src/client/more-menu.tsx`); a
 * plugin never imports a sibling, so this is a copy kept in step by hand.
 *
 * @module @khorsheed/dsh-datasets/client
 */
import { useState, type ReactNode } from 'react'
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconEllipsisOutlineMedium } from './icons.tsx'

/**
 * A ⋯ trigger and its rows.
 * @param props.label - the trigger's accessible name and tooltip.
 * @param props.items - the rows (a `danger` row renders in the error colour).
 * @param props.onSelect - called with the picked row's id; the menu closes itself.
 * @param props.className - the trigger's class.
 */
export function MoreMenu({ label, items, onSelect, className }: {
  readonly label: string
  readonly items: readonly MenuEntry[]
  readonly onSelect: (id: string) => void
  readonly className?: string | undefined
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      portal
      align="end"
      dense
      items={items}
      onSelect={(id) => {
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
          <IconEllipsisOutlineMedium size={16} />
        </button>
      )}
    />
  )
}
