/**
 * Boundary node ('room-event' keyed renderer): one dim
 * compaction-marker-style line per member join/leave, plus the human's own
 * dispatch messages (the room composer appends journal events for
 * @-messages, so without these lines the human's words never appear in the
 * flow; bare messages are ordinary user/message turns of the main agent).
 */
import type { ReactNode } from 'react'
import type { RoomEventViewProps } from './slots.ts'
import css from './RoomEventView.module.css'

/** The boundary/dispatch dim line. */
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
    case 'dispatch':
      text = t('event.dispatch', { targets: (data.targets ?? []).join(' @'), text: data.text ?? '' })
      break
  }
  return <div className={css.row}>{text}</div>
}
