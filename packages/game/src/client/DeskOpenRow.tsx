/**
 * The room's row for a game project a member opened there (`desk-row.ts`):
 * who opened what, and one door — 打开 → — to it in this room's sidebar.
 * Whether the sidebar follows by itself is the destination follower's call
 * (`deskDestinationsOf`): a coordinator's live open follows, a member's never
 * takes the foreground.
 * @module @khorsheed/dsh-game/client
 */
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
import type { DeskRowData } from './desk-row.ts'
import css from './DeskRow.module.css'

/** What the row reaches outside its own node. */
export interface DeskOpenRowFace {
  /** Show the game tab on this project in that (room) session's sidebar, binding the room to it when it shows another. */
  openProject: (sessionId: string, projectId: string) => void
}

/** The props the keyed chat-node slot composes for this row. */
export interface DeskOpenRowProps extends DeskOpenRowFace {
  readonly node: { readonly data: DeskRowData }
  readonly sessionId?: string
  readonly t: PropsLocale<'game'>['t']
  /** Kept for the seats that pass it; following is the destination follower's (`deskDestinationsOf`), not the row's. */
  readonly follow?: boolean
  /** Inside the member's own card: the card already says who, so the row names only the project. */
  readonly own?: boolean
}

/**
 * Render one game desk event.
 * @param props - the node, the face, the copy.
 */
export function DeskOpenRow({ node, sessionId, t, openProject, own = false }: DeskOpenRowProps): ReactNode {
  const row = node.data
  const said = own
    ? t(row.created ? 'desk.ownCreated' : 'desk.ownSwitched', { title: row.title })
    : t(row.created ? 'desk.created' : 'desk.switched', { member: row.member, title: row.title })
  return (
    <div className={css.row} data-desk-role={row.role}>
      <span className={css.kind}>{t('desk.kind')}</span>
      <span className={css.name} title={said}>{said}</span>
      {sessionId !== undefined && (
        <button type="button" className={css.open} onClick={() => { openProject(sessionId, row.projectId) }}>
          {t('desk.open')}
        </button>
      )}
    </div>
  )
}
