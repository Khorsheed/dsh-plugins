import { describe, expect, it } from 'vitest'
import { InspectorStore } from '../src/store.ts'
import { scopeTiming } from '../src/client/timing.ts'
import { fmtSpan } from '../src/client/aggregate.ts'
import type { AgentScopeOverview, TurnTiming } from '../src/types.ts'

const scope: AgentScopeOverview = {
  scopeId: 'main',
  scopeSeq: 1,
  kind: 'main',
  status: 'ok',
  config: {},
  startedAt: 0,
  endedAt: 1000,
  requests: [
    {
      seq: 1,
      scopeId: 'main',
      status: 'ok',
      startedAt: 0,
      totalChars: 0,
      responseSummary: { kind: 'tool', name: 'read' },
    },
  ],
}
function timing(lanes: TurnTiming['lanes']): TurnTiming {
  return {
    turnSeq: 1,
    totalMs: 1000,
    lanes,
    tools: [],
    buckets: {
      waitMs: 0,
      reasoningMs: 0,
      toolArgsMs: 0,
      textMs: 0,
      toolExecMs: 0,
      otherMs: 0,
    },
  }
}
const lane = (
  kind: TurnTiming['lanes'][number]['kind'],
  startedAt: number,
  durationMs: number,
  tool?: string,
) => ({
  kind,
  startedAt,
  durationMs,
  requestSeq: 1,
  scopeId: 'main',
  ...(tool ? { tool } : {}),
})

describe('elapsed-time accounting', () => {
  it('partitions model/tools/gaps and both tables with internal slack separate', () => {
    const data = scopeTiming(
      timing([
        lane('wait', 0, 100),
        lane('reasoning', 100, 200),
        lane('tool-args', 300, 100, 'read'),
        lane('other', 400, 10),
        { ...lane('tool-exec', 410, 400, 'read'), isError: true },
      ]),
      scope,
    )
    expect(data.model).toBe(410)
    expect(data.exec).toBe(400)
    expect(data.gaps).toBe(190)
    expect(data.tools[0]).toMatchObject({
      calls: 1,
      errors: 1,
      think: 200,
      args: 100,
      exec: 400,
      total: 700,
    })
    expect(data.non.slack.get(1)).toBe(10)
    expect(data.model + data.exec + data.gaps).toBe(1000)
    expect(
      data.tools.reduce((n, r) => n + r.total, 0) +
        Object.values(data.non)
          .flatMap((m) => [...m.values()])
          .reduce((a, b) => a + b, 0) +
        data.gaps,
    ).toBe(1000)
  })
  it('shares overlap, keeps repeated calls, and excludes nested agent lanes', () => {
    const data = scopeTiming(
      timing([
        lane('reasoning', 0, 100),
        lane('tool-args', 100, 50, 'read'),
        lane('tool-args', 150, 50, 'read'),
        lane('tool-exec', 200, 600, 'read'),
        lane('tool-exec', 200, 400, 'read'),
        { ...lane('wait', 200, 400), scopeId: 'child' },
      ]),
      scope,
    )
    expect(data.total).toBe(1000)
    expect(data.overlap).toBe(400)
    expect(data.tools[0]).toMatchObject({
      calls: 2,
      think: 100,
      args: 100,
      exec: 600,
      total: 800,
    })
    expect(data.gaps).toBe(200)
  })
  it('keeps pre-request gaps in the main turn, while children use their own bounds', () => {
    const fullTurn = { ...timing([lane('text', 200, 600)]), startedAt: 0 }
    const laterMain = { ...scope, startedAt: 200, endedAt: 800 }
    expect(scopeTiming(fullTurn, laterMain)).toMatchObject({ total: 1000, gaps: 400 })
    const child = { ...laterMain, kind: 'subagent' as const, scopeId: 'child' }
    const childTurn = { ...fullTurn, lanes: [{ ...lane('text', 200, 600), scopeId: 'child' }] }
    expect(scopeTiming(childTurn, child)).toMatchObject({ total: 600, gaps: 0 })
  })
  it('counts explicit failures even when execution rounds to zero milliseconds', () => {
    const data = scopeTiming(timing([{ ...lane('tool-exec', 100, 0, 'read'), isError: true }]), scope)
    expect(data.tools[0]).toMatchObject({ calls: 1, errors: 1, exec: 0 })
    expect(data.gaps).toBe(1000)
  })
  it('formats consistent tenths across minute boundaries', () => {
    expect(fmtSpan(89700)).toBe('1m 29.7s')
    expect(fmtSpan(119990)).toBe('2m 0.0s')
  })
})

describe('lens capture facts', () => {
  it('detects changed content even with stable IDs, preserves error/turn, scopes trend', () => {
    const store = new InspectorStore({}, { now: () => 1000 })
    store.turnStart('s', 1, 0)
    store.noteMessageTurn('s', 'same', 1)
    const begin = (text: string, at: number) =>
      store.beginRequest(
        {
          sessionId: 's',
          config: {},
          messages: [
            {
              id: 'same',
              role: 'tool',
              sourceKind: 'tool',
              isError: true,
              content: [{ type: 'text', text }],
            },
          ],
        },
        at,
      )!
    const first = begin('before', 10)
    store.settleRequest(first, 20)
    const second = begin('after', 30)
    store.settleRequest(second, 40)
    const view = store.getRequest('s', second.seq)!
    if ('refused' in view) throw new Error('unexpected refusal')
    expect(view.prefix).toMatchObject({
      previousSeq: first.seq,
      changed: { index: 0, before: 'before', after: 'after' },
      gapMs: 10,
    })
    expect(view.segments.history[0] ?? view.segments.added[0]).toMatchObject({
      isError: true,
      sourceTurn: 1,
    })
    expect(store.getSessionTrend('s').requests).toHaveLength(2)
    const filtered = store.getSessionTrend('s', { scopes: [] })
    expect(filtered.requests).toEqual([])
    expect(filtered.turns[0]?.requestCount).toBe(0)
    expect(JSON.stringify(store.getSessionTrend('s'))).not.toContain('before')
  })
})
