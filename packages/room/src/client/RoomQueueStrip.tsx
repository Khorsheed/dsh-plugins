/**
 * The room session's queue strip — a read-only echo of the official
 * QueueDock (harness ui-conversation queue/QueueDock.tsx), whose
 * `conversation.input.dock` seat hides with the InputBar fallback under the
 * composer takeover. The queue itself is NOT re-implemented: a bare message
 * sent while the main agent's turn runs goes through the official input
 * machine's `submit()`, whose busy admission enqueues exactly as the
 * official bar's does — this strip only makes the queued rows visible again
 * (count header + previews; one item renders its preview directly).
 * Read-only by design: per-row mutations (edit/remove/steer) stay with the
 * hidden official dock.
 */
import { useId, useState, type ReactNode } from 'react'
import { IconChevronDownOutlineMedium, IconChevronUpOutlineMedium, IconQueueOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RoomComposerProps } from './slots.ts'
import css from './RoomQueueStrip.module.css'

/** One queued message, pre-selected by the composer from the inbox projection (the legacy snapshot queue on 0.1.5). */
export interface RoomQueueItem {
  readonly id: string
  readonly preview: string
}

/** Props: the still-queued rows plus the room locale seat. */
export interface RoomQueueStripProps {
  readonly items: readonly RoomQueueItem[]
  readonly t: RoomComposerProps['t']
}

export function RoomQueueStrip({ items, t }: RoomQueueStripProps): ReactNode {
  const [collapsed, setCollapsed] = useState(true)
  const listId = useId()
  if (items.length === 0) return null

  // Single-item strip: no count header, the row itself carries the glyph
  // (the official QueueDock's single-item posture).
  if (items.length === 1) {
    return (
      <div className={css.root} data-testid="room-queue-strip">
        <div className={css.header} role="status">
          <span className={css.lead} aria-hidden><IconQueueOutlineMedium /></span>
          <span className={css.preview}>{items[0]!.preview}</span>
        </div>
      </div>
    )
  }

  return (
    <div className={css.root} data-testid="room-queue-strip">
      <button
        type="button"
        className={css.header}
        aria-controls={listId}
        aria-expanded={!collapsed}
        onClick={() => { setCollapsed(v => !v) }}
      >
        <span className={css.lead} aria-hidden><IconQueueOutlineMedium /></span>
        <span className={css.count}>{t('queue.count', { n: items.length })}</span>
        <span className={css.chevron} aria-hidden>
          {collapsed ? <IconChevronUpOutlineMedium /> : <IconChevronDownOutlineMedium />}
        </span>
      </button>
      {!collapsed && (
        <ul id={listId} className={css.list}>
          {items.map(item => (
            <li key={item.id} className={css.row}>
              <span className={css.preview}>{item.preview}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
