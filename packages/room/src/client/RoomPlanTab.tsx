import { useEffect, useSyncExternalStore } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { RoomComposerInjected } from './slots.ts'
import { RoomPlanView } from './RoomPlanView.tsx'

export const ROOM_PLAN_KIND = 'room-plan'
export const ROOM_PLAN_TAB_ID = '@khorsheed/dsh-room/plan'
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap { 'room-plan': Record<string, never> }
}
type Injected = Pick<RoomComposerInjected, 'roomStore' | 'planCommand' | 'openPlanSession' | 'stopMember'>
type Props = PropsRuntime<'sidebar.right.pane.tab'> & InjectFace<Injected> & PropsLocale<'room'>

/** Uses the host's session-scoped sidebar, with the same review commands as the dock. */
export function RoomPlanTab({ sessionId, roomStore, planCommand, openPlanSession, stopMember, t }: Props) {
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  useEffect(() => { void roomStore.ensure(sessionId) }, [roomStore, sessionId])
  if (!state || !planCommand) return null
  return <RoomPlanView key={sessionId} expanded plan={state.plan} members={state.members} command={planCommand} openSession={openPlanSession} stopMember={stopMember} t={t} />
}
