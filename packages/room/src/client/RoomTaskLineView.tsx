/**
 * Task-advance node ('room-task-line' keyed renderer): one dim line per task
 * closed done — `✓ ada 完成了「API 定稿」── 目标进度 2/5`. The same dim
 * single-line register as the boundary rows (RoomEventView); the goal
 * progress suffix is computed live from the room store (the node's own fold
 * only carries this task) and dropped when the store has no state for the
 * session (a cold render before the first pull).
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import { taskProgress } from '../journal.ts'
import type { RoomTaskLineViewProps } from './slots.ts'
import css from './RoomTaskLineView.module.css'

/** The task-advance dim line. */
export function RoomTaskLineView({ node, sessionId, roomStore, t }: RoomTaskLineViewProps): ReactNode {
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  const data = node.data
  const progress = state === undefined ? undefined : taskProgress(state.tasks)
  return (
    <div className={css.row}>
      {t('advance.line', { member: data.member, title: data.title })}
      {progress !== undefined && progress.total > 0
        ? t('advance.progress', { done: progress.done, total: progress.total })
        : ''}
    </div>
  )
}
