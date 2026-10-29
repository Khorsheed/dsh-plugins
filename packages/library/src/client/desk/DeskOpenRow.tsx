/**
 * The room's row for a project / book a member bound there (`desk-row.ts`):
 * who bound what, and one door — 打开 → — to it in this room's library tab.
 * A coordinator's row seen arriving opens the library on it by itself; a
 * member's bound only its own session, so it never takes the front.
 *
 * @module @khorsheed/dsh-library/client/desk
 */
import { useEffect, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '../locales.ts'
import { shouldFollow, type DeskRowData } from './desk-row.ts'
import css from './DeskRow.module.css'

/** What the row reaches outside its own node. */
export interface DeskOpenRowFace {
  /** Show the library tab on this book (or, without one, the project). */
  openBook: (projectId: string, resourceId?: string) => void
}

/** The props the keyed chat-node slot composes for this row. */
export interface DeskOpenRowProps extends DeskOpenRowFace {
  readonly node: { readonly data: DeskRowData }
  readonly sessionId?: string
  readonly t: TranslateNS<'library'>
  /** False in a settled reply: only the running card (or the row's own node) follows. */
  readonly follow?: boolean
  /** Inside the member's own card: the card already says who, so the row names only the book. */
  readonly own?: boolean
}

/**
 * Render one library desk event.
 * @param props - the node, the face, the copy.
 */
export function DeskOpenRow({ node, sessionId, t, openBook, follow = true, own = false }: DeskOpenRowProps): ReactNode {
  const row = node.data
  useEffect(() => {
    // Only the coordinator's bind moves the room's sidebar.
    if (!follow || row.role !== 'coordinator' || !shouldFollow(sessionId ?? '', row)) return
    openBook(row.projectId, row.resourceId)
  }, [row, sessionId, follow, openBook])
  const target = row.resourceTitle === undefined
    ? t('deskrow.project', { project: row.projectName })
    : t('deskrow.book', { book: row.resourceTitle })
  const said = own ? t('deskrow.boundOwn', { target }) : t('deskrow.bound', { member: row.member, target })
  return (
    <div className={css.row} data-desk-role={row.role}>
      <span className={css.kind}>{t('tab.label')}</span>
      <span className={css.name} title={said}>{said}</span>
      {row.role === 'member' && <span className={css.note}>{t('deskrow.memberOnly')}</span>}
      <button type="button" className={css.open} onClick={() => { openBook(row.projectId, row.resourceId) }}>
        {t('deskrow.open')}
      </button>
    </div>
  )
}
