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

/** Public session-list projection; members are deduplicated against durable Room executions. */
export interface BackgroundSession {
  id: string
  parentId?: string
  origin?: string
  displayTitle?: string
  running?: boolean
  projectionValues?: {
    tokenUsage?: { uncachedInputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
    subagentTiming?: { settledMs: number; active?: { since: number; through: number } }
  }
}
export interface BackgroundSessionsStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): { byId: Readonly<Record<string, BackgroundSession>> }
}
export function descendantRows(sessions: Readonly<Record<string, BackgroundSession>>, root: string, state: RoomState, now: number, active: readonly string[] = []): ExecutionRow[] {
  const known = new Set<string | undefined>([...state.members.map(member => member.childSessionId), ...(state.executions ?? []).map(run => run.childSessionId)])
  const representedRunning = new Set(executionRows(state).filter(row => row.status === 'running').map(row => row.childSessionId))
  const coordinatorChild = state.members.find(member => state.coordinator === undefined ? member.kind === 'main-agent' : member.id === state.coordinator.memberId)?.childSessionId
  const result: ExecutionRow[] = []
  const seen = new Set([root])
  const visit = (parent: string): void => {
    for (const child of Object.values(sessions)) {
      if (child.parentId !== parent || child.origin !== 'subagent' || seen.has(child.id)) continue
      seen.add(child.id)
      const running = child.running === true || active.includes(child.id)
      // Direct follow-ups in a member's own composer bypass Room dispatch.
      // Keep that live session visible without duplicating an active Room execution.
      if (child.id !== coordinatorChild && (!known.has(child.id) || (running && !representedRunning.has(child.id)))) {
        const timing = child.projectionValues?.subagentTiming
        const usage = child.projectionValues?.tokenUsage
        const elapsedMs = timing === undefined ? undefined : timing.settledMs + (timing.active === undefined ? 0 : Math.max(0, (running ? now : timing.active.through) - timing.active.since))
        const tokens = usage === undefined ? undefined : usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
        result.push({ id: `session:${child.id}`, member: child.displayTitle || child.id, title: child.displayTitle || child.id, childSessionId: child.id,
          status: running ? 'running' : 'settled', sessionTotal: true,
          ...elapsedMs === undefined ? {} : { elapsedMs },
          ...tokens === undefined || !Number.isFinite(tokens) ? {} : { tokens },
        })
      }
      visit(child.id)
    }
  }
  visit(root)
  return result
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
    const status = execution?.state === 'failed' && delivery.status === 'running' ? 'uncertain' : terminal
    const title = task?.title ?? state.tasks.find(task => task.deliveryId === delivery.id)?.title ?? delivery.text
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
    rows.push({ ...execution, execution, title: state.tasks.find(task => task.deliveryId === execution.runId)?.title ?? execution.member,
      status: execution.state, member: member?.name ?? execution.member,
      ...execution.childSessionId !== undefined || member?.childSessionId === undefined ? {} : { childSessionId: member.childSessionId },
    })
  }
  return rows.reverse()
}
