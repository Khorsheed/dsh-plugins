/**
 * The room's row for a project a member opened there (`desk-row.ts`): what
 * was opened, and one door — 打开 → — to it in this room's 剪辑 panel, drawn
 * by the one conversation card shell (`DestinationCard`).
 * Whether the panel follows by itself is the destination follower's call
 * (`deskDestinationsOf`): a coordinator's live open follows, a member's never
 * takes the front.
 *
 * @module @khorsheed/dsh-video-studio/client/DeskOpenRow
 */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'
import type { DeskRowData } from './desk-row.ts'
import { DestinationCard, type Destination } from '@khorsheed/dsh-client-ui-agent-nav/src/client/index.ts'
import { VIDEO_KIND } from './definition.tsx'

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
  /** Kept for the seats that pass it; following is the destination follower's (`deskDestinationsOf`), not the row's. */
  readonly follow?: boolean
  /** Inside the member's own card: the card already says who, so the row names only the project. */
  readonly own?: boolean
}

/**
 * Render one video-studio desk event.
 * @param props - the node, the face, the copy.
 */
export function DeskOpenRow({ node, sessionId = '', t, openProject, own = false }: DeskOpenRowProps): ReactNode {
  const row = node.data
  const said = own
    ? t(row.created ? 'deskrow.created' : 'deskrow.switched', { title: row.title })
    : t(row.created ? 'deskrow.memberCreated' : 'deskrow.memberSwitched', { member: row.member, title: row.title })
  const destination: Destination = { id: `desk:${row.projectId}:${row.seq}`, kind: VIDEO_KIND, params: { projectId: row.projectId }, label: said }
  return (
    <DestinationCard
      copy={{ kind: t('deskrow.kind'), running: said, failed: said, open: t('deskrow.open') }}
      model={{ state: 'done', text: said, destination }}
      go={() => { openProject(sessionId, row.projectId) }}
    />
  )
}
