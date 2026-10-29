/**
 * The game rows inside a room member's card (room's `room.member.attachment`
 * on the reply and `room.run.attachment` on the running card, keyed by this
 * package's name, the desk events' owner): what the turn opened, one row
 * each, as the room-level node (`DeskOpenRow`). Inside the card the member
 * goes unnamed; only the live running card follows.
 *
 * Owner props are structural: the room package is not a dependency.
 * @module @khorsheed/dsh-game/client
 */
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { DeskOpenRow, type DeskOpenRowFace } from './DeskOpenRow.tsx'
import { deskRowOf } from './desk-row.ts'

/** One attachment as the room hands it over. */
interface AttachmentLike {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

/** The room seat's owner props, as these rows read them. */
export interface DeskAttachmentProps extends DeskOpenRowFace {
  readonly sessionId: string
  readonly attachments: readonly AttachmentLike[]
  readonly live: boolean
  readonly t: PropsLocale<'game'>['t']
}

/**
 * Render a turn's game desk events inside the member's card.
 * @param props - the turn's events of this owner, whether the card is live, the face, the copy.
 */
export function DeskAttachment({ sessionId, attachments, live, t, openProject }: DeskAttachmentProps): ReactNode {
  // `room/desk-wrote` has no game row yet: only the opens render.
  const opened = attachments.flatMap(attachment => {
    const row = deskRowOf(attachment)
    return row === null ? [] : [row]
  })
  return (
    <>
      {opened.map(row => (
        <DeskOpenRow key={row.seq} node={{ data: row }} sessionId={sessionId} t={t} follow={live} own openProject={openProject} />
      ))}
    </>
  )
}
