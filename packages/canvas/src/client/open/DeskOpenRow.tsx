/**
 * The room's row for a canvas a member opened there (`desk-row.ts`): who did
 * what, and one door — 打开 → — to it in this room's sidebar. A row seen
 * arriving follows by itself: the coordinator's shows in the sidebar, a
 * member's goes on the canvas strip beside the one being read, marked fresh.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useEffect, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '../locales.ts'
import { shouldFollow, type DeskRowData } from './desk-row.ts'
import css from '../type/ProposeTypeRow.module.css'

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
  /** False in a settled reply: only the running card (or the row's own node) follows. */
  readonly follow?: boolean
  /** Inside the member's own card: the card already says who, so the row names only the canvas. */
  readonly own?: boolean
}

/**
 * Render one canvas desk event.
 * @param props - the node, the face, the copy.
 */
export function DeskOpenRow({ node, sessionId, t, openCanvas, addCanvas, follow = true, own = false }: DeskOpenRowProps): ReactNode {
  const row = node.data
  useEffect(() => {
    if (!follow || !shouldFollow(sessionId ?? '', row)) return
    if (row.role === 'coordinator') openCanvas(row.canvasId)
    else addCanvas(row.canvasId)
  }, [row, sessionId, follow, openCanvas, addCanvas])
  const said = own
    ? t(row.created ? 'openrow.created' : 'openrow.switched', { title: row.title })
    : t(row.created ? 'deskrow.created' : 'deskrow.switched', { member: row.member, title: row.title })
  return (
    <div className={css.row} data-desk-role={row.role}>
      <span className={css.kind}>{t('openrow.kind')}</span>
      <span className={css.name} title={said}>{said}</span>
      {row.role === 'member' && <span className={css.note}>{t('deskrow.beside')}</span>}
      <button type="button" className={css.open} onClick={() => { openCanvas(row.canvasId) }}>
        {t('openrow.open')}
      </button>
    </div>
  )
}
