/**
 * The room's row for a canvas a member opened there (`desk-row.ts`): who did
 * what, and one door — 打开 → — to it in this room's sidebar. Following is
 * the destination follower's call (`deskDestinationsOf`): a coordinator's
 * live open shows in the sidebar, a member's goes on the canvas strip beside
 * the one being read, marked fresh.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '../locales.ts'
import type { DeskRowData } from './desk-row.ts'
import { DestinationCard, type Destination } from '@khorsheed/dsh-client-ui-agent-nav/src/client/index.ts'

/** What the row reaches outside its own node. */
export interface DeskOpenRowFace {
  /** Show the canvas tab with this canvas open. */
  openCanvas: (canvasId: string) => void
  /** Put the canvas on the strip without showing it. */
  addCanvas: (canvasId: string) => void
}

/** The props the keyed chat-node slot composes for this row. */
export interface DeskOpenRowProps extends DeskOpenRowFace {
  readonly node: { readonly data: DeskRowData }
  readonly sessionId?: string
  readonly t: TranslateNS<'canvas'>
  /** Kept for the seats that pass it; following is the destination follower's (`deskDestinationsOf`), not the row's. */
  readonly follow?: boolean
  /** Inside the member's own card: the card already says who, so the row names only the canvas. */
  readonly own?: boolean
}

/**
 * Render one canvas desk event.
 * @param props - the node, the face, the copy.
 */
export function DeskOpenRow({ node, t, openCanvas, own = false }: DeskOpenRowProps): ReactNode {
  const row = node.data
  const did = own
    ? t(row.created ? 'openrow.created' : 'openrow.switched', { title: row.title })
    : t(row.created ? 'deskrow.created' : 'deskrow.switched', { member: row.member, title: row.title })
  // A member's open went beside the canvas being read: the line says so.
  const said = row.role === 'member' ? `${did} · ${t('deskrow.beside')}` : did
  const destination: Destination = { id: `desk:${row.canvasId}:${row.seq}`, kind: 'canvas', params: { canvasId: row.canvasId }, label: said }
  return (
    <DestinationCard
      copy={{ kind: t('openrow.kind'), running: said, failed: said, open: t('openrow.open') }}
      model={{ state: 'done', text: said, destination }}
      go={() => { openCanvas(row.canvasId) }}
    />
  )
}
