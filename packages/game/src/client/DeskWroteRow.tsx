/**
 * The room's line for what a member wrote on the room's game project
 * (`desk-row.ts`'s `room/desk-wrote`): a version published, variants offered.
 * The one conversation card (`@khorsheed/dsh-client-ui-agent-nav`), its door
 * the place the write can be seen. Whether the sidebar follows by itself is
 * the destination follower's call (`deskDestinationsOf`).
 * @module @khorsheed/dsh-game/client
 */
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
import type { DeskWroteData } from './desk-row.ts'
import type { DeskOpenRowFace } from './DeskOpenRow.tsx'
import { DestinationCard, type Destination } from '@khorsheed/dsh-client-ui-agent-nav/src/client/index.ts'

/** The props the keyed chat-node slot composes for this line. */
export interface DeskWroteRowProps extends DeskOpenRowFace {
  readonly node: { readonly data: DeskWroteData }
  readonly sessionId?: string
  readonly t: PropsLocale<'game'>['t']
  /** Inside the member's own card: the card already says who. */
  readonly own?: boolean
}

/** Render one game desk write. */
export function DeskWroteRow({ node, sessionId, t, openProject, own = false }: DeskWroteRowProps): ReactNode {
  const write = node.data
  const key = write.what === 'propose' ? (own ? 'desk.ownProposed' : 'desk.proposed') : (own ? 'desk.ownPublished' : 'desk.published')
  const said = t(key, { member: write.member, label: write.label })
  const destination: Destination = { id: `desk:${write.projectId}:${write.seq}`, kind: 'game', params: { ...write.place, projectId: write.projectId }, label: said }
  return (
    <DestinationCard
      copy={{ kind: t('desk.kind'), running: said, failed: said, open: t('card.open') }}
      model={{ state: 'done', text: said, destination }}
      go={sessionId === undefined ? undefined : () => { openProject(sessionId, write.projectId, write.place) }}
    />
  )
}
