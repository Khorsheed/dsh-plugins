/**
 * Tasks (jobs): what the human asked for and everything it set in motion.
 * A task starts at a human message that led to work — at least one
 * delivery carries its id — and gathers the follow-up messages attributed to
 * it (`room/task-link`, by the composer's tag, the coordinator or the
 * decision model) and every delivery recorded under it: delegations,
 * members' sub-delegations, reports. Plain chat that dispatched nothing is
 * not a task. Pure: the host replay and the client views share it.
 * @module @khorsheed/dsh-room/jobs
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { isHumanMessage } from './deliveries.ts'
import type { RoomDelivery, RoomJob, RoomTaskLinkEvent } from './types.ts'

/** The text of a message's text blocks. */
function textOf(content: readonly { readonly type: string; readonly text?: string }[]): string {
  return content.flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n')
}

/**
 * Fold the room log into its tasks, newest first.
 * @param events - the room log.
 * @param deliveries - the replayed deliveries (their `task` already resolved).
 * @returns the tasks.
 */
export function replayJobs(events: readonly SessionEvent[], deliveries: readonly RoomDelivery[]): RoomJob[] {
  const messages = new Map<string, { id: string; time: number; text: string }>()
  const links = new Map<string, { task: string; by: RoomTaskLinkEvent['by']; probability?: number }>()
  const stopped = new Set<string>()
  const dispatchById = new Map<string, { time: number; text: string }>()
  for (const event of events) {
    if (isHumanMessage(event)) messages.set(event.data.id, { id: event.data.id, time: event.time, text: textOf(event.data.content) })
    else if (event.type === 'room/task-link') {
      links.set(event.data.message, { task: event.data.task, by: event.data.by, ...event.data.probability === undefined ? {} : { probability: event.data.probability } })
    } else if (event.type === 'room/job-stopped') stopped.add(event.data.task)
    else if (event.type === 'room/dispatch' && event.data.id !== undefined) dispatchById.set(event.data.id, { time: event.time, text: event.data.text })
  }
  const byTask = new Map<string, RoomDelivery[]>()
  for (const row of deliveries) {
    if (row.task === undefined) continue
    const list = byTask.get(row.task) ?? []
    list.push(row)
    byTask.set(row.task, list)
  }
  const roots = [...byTask.keys()]
    .map(id => ({ id, root: messages.get(id) ?? dispatchById.get(id) }))
    .filter((entry): entry is { id: string; root: { time: number; text: string } } => entry.root !== undefined)
    .sort((a, b) => a.root.time - b.root.time)
  const jobs = roots.map(({ id, root }, index): RoomJob => {
    const rows = byTask.get(id) ?? []
    const follow = [...links.entries()]
      .filter(([message, link]) => link.task === id && message !== id)
      .flatMap(([message, link]) => {
        const found = messages.get(message)
        return found === undefined ? [] : [{ ...found, by: link.by, ...link.probability === undefined ? {} : { probability: link.probability } }]
      })
    const open = rows.some(row => row.status === 'queued' || row.status === 'running' || row.status === 'held')
    const attention = rows.some(row => row.status === 'uncertain')
    const status: RoomJob['status'] = stopped.has(id) && !open ? 'stopped' : attention ? 'attention' : open ? 'running' : 'done'
    const ended = Math.max(...rows.map(row => row.endedAt ?? row.queuedAt))
    const goal = rows.find(row => row.plan !== undefined)?.plan?.goalId
    return {
      id, number: index + 1,
      // Leading @-mentions address members; the request is what follows.
      title: (root.text.replace(/^(?:@\S+\s+)+/, '').split('\n', 1)[0] ?? '').slice(0, 120),
      messages: [{ id, time: root.time, text: root.text }, ...follow].sort((a, b) => a.time - b.time),
      status, startedAt: root.time,
      ...open ? {} : { endedAt: ended },
      deliveries: rows.map(row => row.id),
      members: [...new Set(rows.map(row => row.memberId))],
      ...goal === undefined ? {} : { goalId: goal },
    }
  })
  return jobs.reverse()
}

/** Resolve the coordinator's `task` argument (`new`, a 「任务 N」 number, or a root id) against the room's tasks. */
export function resolveTaskRef(jobs: readonly RoomJob[], ref: string): string | 'new' | undefined {
  const value = ref.trim().replace(/^任务\s*/, '').replace(/^#/, '')
  if (value === 'new' || value === '新') return 'new'
  const number = Number(value)
  if (Number.isInteger(number) && number > 0) return jobs.find(job => job.number === number)?.id
  return jobs.find(job => job.id === value)?.id
}
