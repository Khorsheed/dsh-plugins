import type { AgentScopeOverview, TimingLane, TurnTiming } from '../types.ts'

/** Partition one agent's elapsed time. Concurrent spans share their overlap, never double-count it. */
export function scopeTiming(timing: TurnTiming, scope: AgentScopeOverview) {
  const lanes = timing.lanes.filter(
    (l) => l.scopeId === scope.scopeId && l.durationMs > 0,
  )
  const start =
    scope.kind === 'main'
      ? (timing.startedAt ?? scope.startedAt)
      : scope.startedAt
  const end =
    scope.kind === 'main'
      ? start + timing.totalMs
      : (scope.endedAt ??
        Math.max(start, ...lanes.map((l) => l.startedAt + l.durationMs)))
  const points = [
    ...new Set([
      start,
      end,
      ...lanes.flatMap((l) => [
        Math.max(start, l.startedAt),
        Math.min(end, l.startedAt + l.durationMs),
      ]),
    ]),
  ]
    .filter((t) => t >= start && t <= end)
    .sort((a, b) => a - b)
  const amounts = new Map<TimingLane, number>()
  let gaps = 0,
    overlap = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!
    const active = lanes.filter(
      (l) => l.startedAt < b && l.startedAt + l.durationMs > a,
    )
    if (!active.length) gaps += b - a
    if (active.length > 1) overlap += b - a
    for (const lane of active)
      amounts.set(lane, (amounts.get(lane) ?? 0) + (b - a) / active.length)
  }
  const tools = new Map<
    string,
    {
      tool: string
      calls: number
      errors: number
      think: number
      args: number
      exec: number
      total: number
    }
  >()
  const get = (tool: string) => {
    let row = tools.get(tool)
    if (!row) {
      row = { tool, calls: 0, errors: 0, think: 0, args: 0, exec: 0, total: 0 }
      tools.set(tool, row)
    }
    return row
  }
  const non = {
    wait: new Map<number, number>(),
    text: new Map<number, number>(),
    direct: new Map<number, number>(),
    slack: new Map<number, number>(),
  }
  const put = (key: keyof typeof non, seq: number, ms: number) =>
    non[key].set(seq, (non[key].get(seq) ?? 0) + ms)
  let model = 0,
    exec = 0,
    think = 0
  for (const request of scope.requests) {
    const rs = lanes.filter((l) => l.requestSeq === request.seq)
    const args = rs.filter(
      (l) => l.kind === 'tool-args' && l.tool !== undefined,
    )
    const executions = rs.filter(
      (l) => l.kind === 'tool-exec' && l.tool !== undefined,
    )
    const calls = args.length ? args : executions
    for (const call of calls) get(call.tool!).calls++
    for (const lane of rs) {
      const ms = amounts.get(lane) ?? 0
      if (lane.kind === 'tool-exec') {
        exec += ms
        if (lane.tool) {
          const row = get(lane.tool)
          row.exec += ms
          if (lane.isError) row.errors++
        }
      } else {
        model += ms
        if (lane.kind === 'reasoning') {
          think += ms
          if (calls.length)
            for (const call of calls) get(call.tool!).think += ms / calls.length
          else put('direct', request.seq, ms)
        } else if (lane.kind === 'tool-args' && lane.tool)
          get(lane.tool).args += ms
        else
          put(
            lane.kind === 'wait'
              ? 'wait'
              : lane.kind === 'text'
                ? 'text'
                : 'slack',
            request.seq,
            ms,
          )
      }
    }
  }
  for (const row of tools.values()) row.total = row.think + row.args + row.exec
  return {
    total: Math.max(0, end - start),
    model,
    exec,
    think,
    gaps,
    overlap,
    tools: [...tools.values()],
    non,
  }
}
