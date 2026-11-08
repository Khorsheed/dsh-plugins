/**
 * A CLI member's background task that lost contact (member-self-started-rounds
 * M6, design C②/C①). The member's CLI harness reads its own task state and
 * says which running tasks lost their process, and why: with the previous
 * host process (`lostBecause: 'host-restart'`, a read-only scan at startup —
 * no CLI process, no model call), or because the harness took the resident
 * process away while they ran (`process-reclaimed`: the keep-alive cap, a
 * reload, a model switch — reported when it happens, through the core's
 * `localAgent/background-tasks-lost`). The room writes one
 * `room/background-task` fact per task (dedupe on its own log), which the
 * timeline shows as one amber line, and — when the delivery that started
 * the task would report — sends the dispatcher a 「失去联系」 follow-up
 * through the report gate. Human-dispatched work gets the line only.
 * @module @khorsheed/dsh-room/background-lost
 */
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { LocalAgentBackgroundTask } from '@khorsheed/dsh-local-agent/types'
import type { RoomBackgroundTaskLostBecause, RoomMember } from './types.ts'

/**
 * How far back a lost task's start may lie and still be written: a loss is
 * this restart's news, not a weeks-old task file that still says `running`
 * (Kimi rewrites it only when the session is loaded again).
 */
export const LOST_TASK_LOOKBACK_MS = 24 * 60 * 60_000

/** The reasons the room records (the harness's facts; `process-exited` is not reported by any harness yet). */
const RECORDED: ReadonlySet<string> = new Set<RoomBackgroundTaskLostBecause>(['host-restart', 'process-reclaimed'])

/** How the follow-up names what happened (the timeline's wording, client `event.lost.*`). */
const LOST_IN: Readonly<Record<RoomBackgroundTaskLostBecause, string>> = {
  'host-restart': '在宿主重启后失去联系',
  'process-reclaimed': '在进程被收回后失去联系',
  'process-exited': '在进程退出后失去联系',
}

/** The fixed text of a lost task's follow-up report (design C②, user decision 3). */
export function lostReportText(member: string, label: string, because: RoomBackgroundTaskLostBecause = 'host-restart'): string {
  return `后台任务「${label}」${LOST_IN[because]}，它可能已经结束，也可能还在跑；没有结果。需要的话请让 ${member} 核对后重做。`
}

/**
 * Tasks the harness reported lost when it took the process away, read as
 * lost whatever the task file says by now (a fresh process may already be
 * up — a reload — while the file still says `running`).
 */
export interface ReportedLoss {
  readonly taskIds: ReadonlySet<string>
  readonly because: 'process-reclaimed'
}

/**
 * The tasks of one member this room still has to record: lost (to a host
 * restart, or to a reclaim of the member's process), started within the
 * lookback, and not yet on the room's log.
 * @param events - the room log.
 * @param memberId - the member's room id.
 * @param tasks - the member's background tasks as its harness read them.
 * @param since - the oldest start that still counts (epoch ms).
 * @param reported - tasks the harness just reported lost (see {@link ReportedLoss}).
 * @returns the tasks to record (with the reason to record), in the read's order.
 */
export function lostToRecord(events: readonly SessionEvent[], memberId: string, tasks: readonly LocalAgentBackgroundTask[], since: number, reported?: ReportedLoss): LocalAgentBackgroundTask[] {
  const recorded = new Set(events.flatMap(event => event.type === 'room/background-task' && event.data.memberId === memberId ? [event.data.taskId] : []))
  return tasks
    .map(task => reported?.taskIds.has(task.id) === true && (task.state === 'running' || task.state === 'lost') ? { ...task, state: 'lost' as const, lostBecause: reported.because } : task)
    .filter(task => task.state === 'lost' && task.lostBecause !== undefined && RECORDED.has(task.lostBecause) && task.startedAt >= since && !recorded.has(task.id))
}

/**
 * Write the fact for one lost task.
 * @param room - the live room.
 * @param member - the member (its current name and id).
 * @param memberIdValue - the member's room id.
 * @param task - the lost task (`lostBecause` set, see {@link lostToRecord}).
 * @param startedByRunId - the room run whose round started it, when on record.
 */
export function recordLostTask(room: Session, member: RoomMember, memberIdValue: string, task: LocalAgentBackgroundTask, startedByRunId: string | undefined): void {
  room.append('room/background-task', {
    member: member.name, memberId: memberIdValue, taskId: task.id, label: task.label, state: 'lost', because: task.lostBecause ?? 'host-restart',
    ...startedByRunId === undefined ? {} : { startedByRunId },
  })
}
