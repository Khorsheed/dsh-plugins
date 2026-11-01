/**
 * The canvas rows inside a room member's card (room's `room.member.attachment`
 * on the reply and `room.run.attachment` on the running card, keyed by this
 * package's name, the desk events' owner): what the turn opened — one row
 * each, as the room-level node (`DeskOpenRow`) — and what it wrote, folded
 * into one line per canvas (`DeskWroteRow`). Inside the card the member goes
 * unnamed; only the live running card follows.
 *
 * Owner props are structural: the room package is not a dependency.
 * @module @khorsheed/dsh-canvas/client
 */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { DeskOpenRow, type DeskOpenRowFace } from './DeskOpenRow.tsx'
import { DeskWroteRow, type DeskWroteRowFace } from './DeskWroteRow.tsx'
import { deskRowOf } from './desk-row.ts'
import { deskWriteOf, foldWrites, type DeskWrite } from './desk-write.ts'

/** One attachment as the room hands it over. */
interface AttachmentLike {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

/** The room seat's owner props, as these rows read them. */
export interface DeskAttachmentProps extends DeskOpenRowFace, DeskWroteRowFace {
  readonly sessionId: string
  readonly attachments: readonly AttachmentLike[]
  readonly live: boolean
  readonly t: TranslateNS<'canvas'>
}

/**
 * Render a turn's canvas desk events inside the member's card.
 * @param props - the turn's events of this owner, whether the card is live, the face, the copy.
 */
export function DeskAttachment({ sessionId, attachments, live, t, openCanvas, go, addCanvas }: DeskAttachmentProps): ReactNode {
  const opened = attachments.flatMap(attachment => {
    const row = attachment.type === 'room/desk-opened' ? deskRowOf(attachment) : null
    return row === null ? [] : [row]
  })
  const writes = attachments.flatMap((attachment): DeskWrite[] => {
    const write = deskWriteOf(attachment)
    return write === null ? [] : [write]
  })
  return (
    <>
      {opened.map(row => (
        <DeskOpenRow key={row.seq} node={{ data: row }} sessionId={sessionId} t={t} follow={live} own openCanvas={openCanvas} addCanvas={addCanvas} />
      ))}
      {foldWrites(writes).map(group => (
        <DeskWroteRow key={group.canvasId} group={group} sessionId={sessionId} t={t} follow={live} own go={go} addCanvas={addCanvas} />
      ))}
    </>
  )
}
