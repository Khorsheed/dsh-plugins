/**
 * The room's row for a project / book a member bound there (`desk-row.ts`):
 * who bound what, and one door — 打开 → — to it in this room's library tab,
 * drawn by the one conversation card shell (the library only hands the words).
 * Whether the library follows by itself is the destination follower's call
 * (`deskDestinationsOf`): a coordinator's live bind follows; a member's bound
 * only its own session, so it never takes the front.
 *
 * @module @khorsheed/dsh-library/client/desk
 */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '../locales.ts'
import type { DeskRowData } from './desk-row.ts'
import { DestinationCard, type Destination } from '@khorsheed/dsh-client-ui-agent-nav/src/client/index.ts'

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
  /** Kept for the seats that pass it; following is the destination follower's (`deskDestinationsOf`), not the row's. */
  readonly follow?: boolean
  /** Inside the member's own card: the card already says who, so the row names only the book. */
  readonly own?: boolean
}

/**
 * Render one library desk event.
 * @param props - the node, the face, the copy.
 */
export function DeskOpenRow({ node, t, openBook, own = false }: DeskOpenRowProps): ReactNode {
  const row = node.data
  const target = row.resourceTitle === undefined
    ? t('deskrow.project', { project: row.projectName })
    : t('deskrow.book', { book: row.resourceTitle })
  const bound = own ? t('deskrow.boundOwn', { target }) : t('deskrow.bound', { member: row.member, target })
  // A member bound only its own session: the line says so.
  const said = row.role === 'member' ? `${bound} · ${t('deskrow.memberOnly')}` : bound
  const destination: Destination = {
    id: `desk:${row.projectId}:${row.seq}`, kind: 'library',
    params: { projectId: row.projectId, ...(row.resourceId === undefined ? {} : { resourceId: row.resourceId }) }, label: said,
  }
  return (
    <DestinationCard
      copy={{ kind: t('tab.label'), running: said, failed: said, open: t('deskrow.open') }}
      model={{ state: 'done', text: said, destination }}
      go={() => { openBook(row.projectId, row.resourceId) }}
    />
  )
}
