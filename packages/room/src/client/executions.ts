import type { RoomExecution, RoomState } from '../types.ts'

export interface ExecutionRow {
  sessionTotal?: boolean
  id: string
  member: string
  childSessionId?: string
  title: string
  status: 'queued' | 'running' | 'done' | 'cancelled' | 'failed' | 'uncertain' | 'submitted' | 'accepted' | 'settled'
  provider?: string
  model?: string
  effort?: string
  tokens?: number
  startedAt?: number
  elapsedMs?: number
  error?: string
  execution?: RoomExecution
}

/** One row per delivery/attempt, not one row per persistent member session. */
export function executionRows(state: RoomState): ExecutionRow[] {
  const coordinator = state.members.find(member => state.coordinator === undefined ? member.kind === 'main-agent' : member.id === state.coordinator.memberId)
  const history = new Map<string, RoomExecution>((state.executions ?? state.runs.map(run => ({ ...run, id: run.runId ?? `${run.member}:${run.startedAt}` }))).map(run => [run.id, run]))
  const rows: ExecutionRow[] = []
  for (const delivery of state.deliveries ?? []) {
    const execution = history.get(delivery.id)
    history.delete(delivery.id)
    const member = state.members.find(member => member.id === delivery.memberId)
    if ((coordinator !== undefined && delivery.memberId === coordinator.id) || delivery.origin === 'report') continue
    const task = delivery.plan?.goalId === state.plan?.id ? state.plan?.tasks.find(task => task.id === delivery.plan?.taskId) : undefined
    const attempt = task?.attempts.find(attempt => attempt.id === delivery.plan?.attemptId)
    const terminal = delivery.status === 'done' && attempt !== undefined
      ? attempt.status === 'accepted' ? 'accepted' : attempt.status === 'submitted' ? 'submitted' : 'done'
      : delivery.status
    // A held report is waiting in its recipient's inbox: queued as far as the dock is concerned.
    const status = execution?.state === 'failed' && delivery.status === 'running' ? 'uncertain' : terminal === 'held' ? 'queued' : terminal
    const title = task?.title ?? delivery.text
    rows.push({ title: title.replace(/\s+/g, ' ').trim(),
      ...member?.provider === undefined ? {} : { provider: member.provider },
      ...execution,
      // Execution identity is immutable; delivery/review state is authoritative.
      id: delivery.id, status, member: member?.name ?? execution?.member ?? delivery.memberId,
      ...execution === undefined ? {} : { execution },
      ...execution?.childSessionId !== undefined || member?.childSessionId === undefined ? {} : { childSessionId: member.childSessionId },
      ...delivery.error === undefined ? {} : { error: delivery.error },
    })
  }
  for (const execution of history.values()) {
    const member = state.members.find(member => member.id === execution.memberId || (execution.memberId === undefined && member.name === execution.member))
    if (coordinator !== undefined && member === coordinator) continue
    rows.push({ ...execution, execution, title: execution.member,
      status: execution.state, member: member?.name ?? execution.member,
      ...execution.childSessionId !== undefined || member?.childSessionId === undefined ? {} : { childSessionId: member.childSessionId },
    })
  }
  return rows.reverse()
}
