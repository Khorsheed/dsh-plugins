/**
 * The task page as a right-sidebar page (kind `room-tasks`), opened from the
 * composer's task capsule. A `task` navigation param opens that task; every
 * navigation (revision bump) opens it again. 「追问」 / 「＋ 新任务」 tag the
 * main composer and, on a narrow window where the sidebar covers the
 * conversation, close this page so the composer is in reach.
 */
import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { RoomStore } from './room-store.ts'
import type { RoomTaskTags } from './task-tag.ts'
import { TasksView, type TasksViewActions } from './TasksView.tsx'

export const ROOM_TASKS_KIND = 'room-tasks'
export const ROOM_TASKS_TAB_ID = '@khorsheed/dsh-room/tasks'
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap { 'room-tasks': { readonly task?: string } }
}

/** Below this window width the sidebar covers the conversation. */
const NARROW = '(max-width: 720px)'

/** What the task page needs injected. */
export interface RoomTasksInjected extends Omit<TasksViewActions, 'compose'> {
  readonly roomStore: RoomStore
  readonly taskTags: RoomTaskTags
}

type Props = PropsRuntime<'sidebar.right.pane.tab'> & InjectFace<RoomTasksInjected> & PropsLocale<'room'>

/** The sidebar page body. */
export function RoomTasksTab({ sessionId, roomStore, taskTags, useTabInfo, t, ...actions }: Props): ReactNode {
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  useEffect(() => { void roomStore.refresh(sessionId) }, [roomStore, sessionId])
  const { tab } = useTabInfo()
  const params = tab.navigation.params as { readonly task?: unknown } | undefined
  const task = typeof params?.task === 'string' ? params.task : undefined
  if (state === undefined) return null
  const compose = (tag: { readonly task: string; readonly label: string }): void => {
    taskTags.set(sessionId, tag)
    if (typeof window !== 'undefined' && window.matchMedia?.(NARROW).matches === true) tab.actions.close()
  }
  return (
    <TasksView
      state={state}
      focus={task === undefined ? undefined : { task, revision: tab.navigation.revision }}
      compose={compose}
      {...actions}
      t={t as never}
    />
  )
}
