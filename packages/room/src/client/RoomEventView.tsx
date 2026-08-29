/**
 * Boundary node ('room-event' keyed renderer): one dim
 * compaction-marker-style line per member join/leave. The human's own
 * @-messages are NOT here — postMessage appends them as standard
 * `user/message` events, so the official user bubble carries them.
 */
import type { ReactNode } from 'react'
import type { RoomEventViewProps } from './slots.ts'
import css from './RoomEventView.module.css'

/** The boundary dim line. */
export function RoomEventView({ node, t }: RoomEventViewProps): ReactNode {
  const data = node.data
  let text: string
  switch (data.sub) {
    case 'member-added':
      text = t('event.joined', { member: data.member ?? '', provider: data.provider ?? '' })
        + (data.invitedBy === 'agent' ? t('event.joinedByAgent') : '')
      break
    case 'member-removed':
      text = t('event.left', { member: data.member ?? '' })
      break
  }
  return <div className={css.row}>{text}</div>
}
