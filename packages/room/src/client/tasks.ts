/**
 * Pure projections the task page and the composer's task capsule share:
 * which tasks need the human, a task's subtask tree (who handed what to
 * whom, from each delivery's `parent`), and the time segments its rows and
 * swimlanes draw.
 */
import type { RoomDelivery, RoomJob, RoomRelay, RoomState } from '../types.ts'

/** One stretch of a delivery's life on the timeline. */
export interface TaskSegment {
  /** queue = waiting to start, held = a finished report waiting to be handed over, exec = running. */
  readonly kind: 'queue' | 'held' | 'exec'
  readonly from: number
  readonly to: number
}

/** A delivery placed in its task's tree. */
export interface SubtaskNode {
  readonly delivery: RoomDelivery
  readonly children: readonly SubtaskNode[]
}

/** The list filters, in order. */
export const TASK_FILTERS = ['running', 'attention', 'done', 'all'] as const
export type TaskFilter = typeof TASK_FILTERS[number]

/** Completed tasks shown by default; older ones stay in the log. */
export const DONE_SHOWN = 20

const OPEN: ReadonlySet<RoomDelivery['status']> = new Set(['queued', 'running', 'held'])

/** Whether a delivery is still open (queued, running or a held report). */
export function isOpenDelivery(row: RoomDelivery): boolean {
  return OPEN.has(row.status)
}

/** Relays waiting for the human's confirmation. */
export function pendingRelays(state: RoomState): readonly RoomRelay[] {
  return state.relays.filter(relay => relay.state === 'pending')
}

/** How many things wait on the human: deliveries with an unknown outcome, held relays, and members' tool approvals. */
export function attentionCount(state: RoomState): number {
  return (state.deliveries ?? []).filter(row => row.status === 'uncertain').length + pendingRelays(state).length + (state.approvals?.length ?? 0) + (state.questions?.length ?? 0)
}

/** Whether a task needs the human: an uncertain delivery, or a relay held inside it. */
export function needsAttention(state: RoomState, job: RoomJob): boolean {
  return job.status === 'attention' || pendingRelays(state).some(relay => relay.intent?.task === job.id)
}

/** The tasks a filter shows (`running` includes those needing attention, as both are open). */
export function filterJobs(state: RoomState, filter: TaskFilter): readonly RoomJob[] {
  const jobs = state.jobs ?? []
  switch (filter) {
    case 'running': return jobs.filter(job => job.status === 'running' || needsAttention(state, job))
    case 'attention': return jobs.filter(job => needsAttention(state, job))
    case 'done': return jobs.filter(job => job.status === 'done' || job.status === 'stopped').slice(0, DONE_SHOWN)
    case 'all': return jobs.slice(0, DONE_SHOWN + jobs.filter(job => job.status !== 'done' && job.status !== 'stopped').length)
  }
}

/** A task's deliveries, in dispatch order. */
export function jobDeliveries(state: RoomState, job: RoomJob): readonly RoomDelivery[] {
  const ids = new Set(job.deliveries)
  return (state.deliveries ?? []).filter(row => ids.has(row.id))
}

/**
 * The task's subtask tree: work handed out (reports travel back up the tree
 * and are not nodes), each delivery under the delivery whose round sent it.
 * A delivery whose sender is outside the task — the human, or a round of
 * another task — is a root.
 */
export function subtaskTree(state: RoomState, job: RoomJob): readonly SubtaskNode[] {
  const rows = jobDeliveries(state, job).filter(row => row.origin !== 'report')
  const ids = new Set(rows.map(row => row.id))
  const children = new Map<string | undefined, RoomDelivery[]>()
  for (const row of rows) {
    const parent = row.parent !== undefined && ids.has(row.parent) ? row.parent : undefined
    children.set(parent, [...children.get(parent) ?? [], row])
  }
  const build = (parent: string | undefined, seen: ReadonlySet<string>): SubtaskNode[] =>
    (children.get(parent) ?? []).filter(row => !seen.has(row.id))
      .map(row => ({ delivery: row, children: build(row.id, new Set([...seen, row.id])) }))
  return build(undefined, new Set())
}

/** A delivery's time segments up to `now` for the open edges. */
export function segmentsOf(row: RoomDelivery, now: number): readonly TaskSegment[] {
  const segments: TaskSegment[] = []
  const end = row.endedAt ?? (isOpenDelivery(row) ? now : row.startedAt ?? row.queuedAt)
  const started = row.startedAt ?? (row.status === 'queued' || row.status === 'held' ? now : end)
  if (row.heldAt !== undefined) {
    const released = row.releasedAt ?? Math.min(started, now)
    if (row.heldAt > row.queuedAt) segments.push({ kind: 'queue', from: row.queuedAt, to: row.heldAt })
    segments.push({ kind: 'held', from: row.heldAt, to: released })
    if (started > released) segments.push({ kind: 'queue', from: released, to: started })
  } else if (started > row.queuedAt) {
    segments.push({ kind: 'queue', from: row.queuedAt, to: started })
  }
  if (row.startedAt !== undefined && end > row.startedAt) segments.push({ kind: 'exec', from: row.startedAt, to: end })
  return segments
}

/** How long a task has taken: to its last settlement, or until now while open. */
export function jobElapsed(job: RoomJob, now: number): number {
  return Math.max(0, (job.endedAt ?? now) - job.startedAt)
}

/** The members still working on a task (running), by id, in first-start order. */
export function runningMembers(state: RoomState, job: RoomJob): readonly string[] {
  return [...new Set(jobDeliveries(state, job).filter(row => row.status === 'running').map(row => row.memberId))]
}
