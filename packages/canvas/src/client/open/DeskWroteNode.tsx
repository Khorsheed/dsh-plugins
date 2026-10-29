/**
 * A lone write line in the room's conversation: a `room/desk-wrote` that names
 * no run (or a room whose cards do not seat it). It names the member.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { DeskWroteRow, type DeskWroteRowFace } from './DeskWroteRow.tsx'
import { foldWrites, type DeskWrite } from './desk-write.ts'

export interface DeskWroteNodeProps extends DeskWroteRowFace {
  readonly node: { readonly data: DeskWrite }
  readonly sessionId?: string
  readonly t: TranslateNS<'canvas'>
}

/** Render one lone write event. */
export function DeskWroteNode({ node, sessionId, t, openCanvas, openCard, addCanvas }: DeskWroteNodeProps): ReactNode {
  const [group] = foldWrites([node.data])
  if (group === undefined) return null
  return <DeskWroteRow group={group} sessionId={sessionId ?? ''} t={t} follow own={false} openCanvas={openCanvas} openCard={openCard} addCanvas={addCanvas} />
}
