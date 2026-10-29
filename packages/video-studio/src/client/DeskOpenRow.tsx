/**
 * The room's row for a project a member opened there (`desk-row.ts`): what
 * was opened, and one door — 打开 → — to it in this room's 剪辑 panel. A row
 * seen arriving follows by itself only when the coordinator opened it (the
 * room's panel moves to it); a member's never takes the front.
 *
 * @module @khorsheed/dsh-video-studio/client/DeskOpenRow
 */
import { useEffect, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'
import { shouldFollow, type DeskRowData } from './desk-row.ts'
import css from './DeskRow.module.css'

/** What the row reaches outside its own node. */
export interface DeskOpenRowFace {
  /** Show the 剪辑 tab of this session with the project open. */
  openProject: (sessionId: string, projectId: string) => void
}

/** The props the keyed chat-node slot composes for this row. */
export interface DeskOpenRowProps extends DeskOpenRowFace {
  readonly node: { readonly data: DeskRowData }
  readonly sessionId?: string
  readonly t: TranslateNS<'videoStudio'>
  /** False in a settled reply: only the running card (or the row's own node) follows. */
  readonly follow?: boolean
  /** Inside the member's own card: the card already says who, so the row names only the project. */
  readonly own?: boolean
}

/**
 * Render one video-studio desk event.
 * @param props - the node, the face, the copy.
 */
export function DeskOpenRow({ node, sessionId = '', t, openProject, follow = true, own = false }: DeskOpenRowProps): ReactNode {
  const row = node.data
  useEffect(() => {
    if (!follow || row.role !== 'coordinator' || !shouldFollow(sessionId, row)) return
    openProject(sessionId, row.projectId)
  }, [row, sessionId, follow, openProject])
  const said = own
    ? t(row.created ? 'deskrow.created' : 'deskrow.switched', { title: row.title })
    : t(row.created ? 'deskrow.memberCreated' : 'deskrow.memberSwitched', { member: row.member, title: row.title })
  return (
    <div className={css.row} data-desk-role={row.role}>
      <span className={css.kind}>{t('deskrow.kind')}</span>
      <span className={css.name} title={said}>{said}</span>
      <button type="button" className={css.open} onClick={() => { openProject(sessionId, row.projectId) }}>
        {t('deskrow.open')}
      </button>
    </div>
  )
}
