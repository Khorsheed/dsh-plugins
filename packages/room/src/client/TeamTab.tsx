/**
 * The team view as a right-sidebar page (kind `room-team`), opened from the
 * members tab. A `member` navigation param selects and reveals that member;
 * every navigation (revision bump) reveals again.
 */
import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RoomStore } from './room-store.ts'
import { TeamView } from './TeamView.tsx'

export const ROOM_TEAM_KIND = 'room-team'
export const ROOM_TEAM_TAB_ID = '@khorsheed/dsh-room/team'
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap { 'room-team': { readonly member?: string } }
}

/** What the team page needs injected. */
export interface RoomTeamInjected {
  readonly roomStore: RoomStore
  readonly openSession: (sessionId: SessionId) => void
}

type Props = PropsRuntime<'sidebar.right.pane.tab'> & InjectFace<RoomTeamInjected> & PropsLocale<'room'>

/** The sidebar page body. */
export function RoomTeamTab({ sessionId, roomStore, openSession, useTabInfo, t }: Props): ReactNode {
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  useEffect(() => { void roomStore.refresh(sessionId) }, [roomStore, sessionId])
  const { tab } = useTabInfo()
  const params = tab.navigation.params as { readonly member?: unknown } | undefined
  const member = typeof params?.member === 'string' ? params.member : undefined
  if (state === undefined) return null
  return (
    <TeamView
      state={state}
      focus={member === undefined ? undefined : { member, revision: tab.navigation.revision }}
      openSession={openSession}
      t={t as never}
    />
  )
}
