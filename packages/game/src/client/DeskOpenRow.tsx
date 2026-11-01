/**
 * The room's row for a game project a member opened there (`desk-row.ts`):
 * who opened what, and one door — 打开 → — to it in this room's sidebar, drawn
 * as the one conversation card (`@khorsheed/dsh-client-ui-agent-nav`'s
 * `DestinationCard`): the game only hands the line and the door.
 * Whether the sidebar follows by itself is the destination follower's call
 * (`deskDestinationsOf`): a coordinator's live open follows, a member's never
 * takes the foreground.
 * @module @khorsheed/dsh-game/client
 */
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
import type { DeskRowData } from './desk-row.ts'
import { DestinationCard, type Destination } from '@khorsheed/dsh-client-ui-agent-nav/src/client/index.ts'

/** What the row reaches outside its own node. */
export interface DeskOpenRowFace {
  /** Show the game tab on this project in that (room) session's sidebar, binding the room to it when it shows another. */
  openProject: (sessionId: string, projectId: string, place?: Readonly<Record<string, unknown>>) => void
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
  const destination: Destination = { id: `desk:${row.projectId}:${row.seq}`, kind: 'game', params: { projectId: row.projectId, view: 'play' }, label: said }
  return (
    <DestinationCard
      copy={{ kind: t('desk.kind'), running: said, failed: said, open: t('desk.open') }}
      model={{ state: 'done', text: said, destination }}
      go={sessionId === undefined ? undefined : () => { openProject(sessionId, row.projectId) }}
    />
  )
}
