/**
 * The room's collaboration page as one right-sidebar page (kind
 * `room-tasks`): a 任务 / 团队 switch over the task page and the team view,
 * so the two never open as separate sidebar tabs. Opened from the composer's
 * task capsule (`view` tasks, an optional `task` param opens that task) and
 * from the members tab's 团队 button (`view` team, an optional `member` param
 * reveals that member); every navigation (revision bump) applies again.
 * 「追问」 / 「＋ 新任务」 tag the main composer and, on a narrow window where
 * the sidebar covers the conversation, close this page so the composer is in
 * reach.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RoomStore } from './room-store.ts'
import type { RoomTaskTags } from './task-tag.ts'
import { TasksView, type TasksViewActions } from './TasksView.tsx'
import { TeamView } from './TeamView.tsx'
import css from './TasksTab.module.css'

export const ROOM_TASKS_KIND = 'room-tasks'
export const ROOM_TASKS_TAB_ID = '@khorsheed/dsh-room/tasks'
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap { 'room-tasks': { readonly view?: 'tasks' | 'team'; readonly task?: string; readonly member?: string } }
}

/** Below this window width the sidebar covers the conversation. */
const NARROW = '(max-width: 720px)'

/** What the task page needs injected. */
export interface RoomTasksInjected extends Omit<TasksViewActions, 'compose'> {
  readonly roomStore: RoomStore
  readonly taskTags: RoomTaskTags
  /** Keep an outside session on the member list (the team view's 加入房间成员). */
  readonly linkSession?: ((target: string, title: string) => void) | undefined
  /** Take it off the list. */
  readonly unlinkSession?: ((target: string) => void) | undefined
}

type Props = PropsRuntime<'sidebar.right.pane.tab'> & InjectFace<RoomTasksInjected> & PropsLocale<'room'>

/** The sidebar page body. */
export function RoomTasksTab({ sessionId, roomStore, taskTags, useTabInfo, linkSession, unlinkSession, t, ...actions }: Props): ReactNode {
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  useEffect(() => { void roomStore.refresh(sessionId) }, [roomStore, sessionId])
  const { tab } = useTabInfo()
  const params = tab.navigation.params as { readonly view?: unknown; readonly task?: unknown; readonly member?: unknown } | undefined
  const task = typeof params?.task === 'string' ? params.task : undefined
  const member = typeof params?.member === 'string' ? params.member : undefined
  const asked = params?.view === 'team' ? 'team' : 'tasks'
  // The switch is the human's between navigations; a navigation sets it again.
  const [view, setView] = useState<'tasks' | 'team'>(asked)
  useEffect(() => { setView(asked) }, [asked, tab.navigation.revision])
  if (state === undefined) return null
  const compose = (tag: { readonly task: string; readonly label: string }): void => {
    taskTags.set(sessionId, tag)
    if (typeof window !== 'undefined' && window.matchMedia?.(NARROW).matches === true) tab.actions.close()
  }
  return (
    <div className={css.page}>
      <div className={css.switch} role="tablist" aria-label={t('collab.title')}>
        {(['tasks', 'team'] as const).map(entry => (
          <button key={entry} type="button" role="tab" className={css.switchTab} aria-selected={view === entry} onClick={() => { setView(entry) }}>
            {t(entry === 'tasks' ? 'job.title' : 'team.title')}
          </button>
        ))}
      </div>
      <div className={css.body} role="tabpanel">
        {view === 'tasks'
          ? <TasksView state={state} focus={task === undefined ? undefined : { task, revision: tab.navigation.revision }} compose={compose} {...actions} t={t as never} />
          : <TeamView state={state} focus={member === undefined ? undefined : { member, revision: tab.navigation.revision }} openSession={(id: SessionId) => { actions.openSession?.(id) }} linkSession={linkSession} unlinkSession={unlinkSession} t={t as never} />}
      </div>
    </div>
  )
}
