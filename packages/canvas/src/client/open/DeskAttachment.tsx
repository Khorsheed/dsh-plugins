/**
 * The canvas row inside a room member's card (room's `room.member.attachment`
 * seat, keyed by this package's name, the desk events' owner): the same row as the room-level node
 * (`DeskOpenRow`), placed at the end of the run's card and reply instead of on
 * a line of its own. The running card follows (the coordinator's canvas opens
 * in the sidebar, a member's goes on the strip); the reply only offers the door.
 *
 * Owner props are structural: the room package is not a dependency.
 * @module @khorsheed/dsh-canvas/client
 */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { DeskOpenRow, type DeskOpenRowFace } from './DeskOpenRow.tsx'
import { deskRowOf } from './desk-row.ts'

/** The room seat's owner props, as this row reads them. */
export interface DeskAttachmentProps extends DeskOpenRowFace {
  readonly sessionId: string
  readonly attachment: { readonly owner: string; readonly seq: number; readonly time: number; readonly data: unknown }
  readonly live: boolean
  readonly t: TranslateNS<'canvas'>
}

/**
 * Render one canvas desk event inside a member's card.
 * @param props - the attachment, whether the card is live, the face, the copy.
 */
export function DeskAttachment({ sessionId, attachment, live, t, openCanvas, addCanvas }: DeskAttachmentProps): ReactNode {
  const row = deskRowOf({ type: 'room/desk-opened', seq: attachment.seq, time: attachment.time, data: attachment.data })
  if (row === null) return null
  return <DeskOpenRow node={{ data: row }} sessionId={sessionId} t={t} follow={live} own openCanvas={openCanvas} addCanvas={addCanvas} />
}
