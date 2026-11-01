/**
 * An external CLI member's compaction (local-agent's `local-agent/compaction`)
 * read from the member's log: one compaction request with the call's usage and
 * the summary as its output, filed under the turn it belongs to.
 */
import { describe, expect, it } from 'vitest'
import { foldLogRows, openCursor, type SessionLogRow } from '../src/log-lane.ts'

const turn = (n: number, at: number): SessionLogRow[] => [
  { type: 'turn/start', seq: at, time: at, data: { turn: n } },
  { type: 'turn/end', seq: at + 1, time: at + 10, data: { turn: n, reason: { kind: 'completed' } } },
]

describe('CLI member compactions', () => {
  it('a /compact between turns belongs to the turn that closed last; a CLI\'s own one to the turn it ran in', () => {
    const rows: SessionLogRow[] = [
      ...turn(1, 100),
      { type: 'local-agent/compaction', seq: 200, time: 300, data: {
        source: 'manual', outcome: 'completed', provider: 'kimi-cli', model: 'k3.1-pro', summary: '前情提要',
        beforeTokens: 288_536, afterTokens: 44_671, usage: { inputTokens: 266_149, outputTokens: 2_819, cacheReadTokens: 18_944 },
        startedAt: 210, endedAt: 290, boundarySeq: 199,
      } },
      { type: 'turn/start', seq: 400, time: 400, data: { turn: 2 } },
      { type: 'local-agent/compaction', seq: 401, time: 450, data: { source: 'auto', outcome: 'failed', provider: 'codex-local', error: 'boom', startedAt: 440, endedAt: 450, boundarySeq: 400 } },
      { type: 'turn/end', seq: 402, time: 500, data: { turn: 2, reason: { kind: 'completed' } } },
    ]
    const built = foldLogRows(openCursor(), rows).filter(request => request.purpose === 'compaction')
    expect(built).toHaveLength(2)
    expect(built[0]).toMatchObject({
      hostTurn: 1, status: 'ok', startedAt: 210, settledAt: 290, responseSummary: { kind: 'compaction' },
      config: { provider: 'kimi-cli', model: 'k3.1-pro' },
      usage: { inputTokens: 266_149, outputTokens: 2_819, cacheReadTokens: 18_944 },
      compaction: { applied: true, inputPartial: true, hostTurn: 1, betweenTurns: true, source: 'manual', beforeTokens: 288_536, afterTokens: 44_671 },
    })
    expect(JSON.stringify(built[0]!.response)).toContain('前情提要')
    // No request number of its own: its index sits between the requests around it.
    expect(built[0]!.logIndex).toBe(-0.5)
    expect(built[0]!.requestNumber).toBeUndefined()
    expect(built[1]).toMatchObject({ hostTurn: 2, status: 'failed', error: 'boom', compaction: { source: 'auto', applied: false } })
    expect(built[1]!.compaction!.betweenTurns).toBeUndefined()
  })

  it('its input is the member\'s folded context at that moment; a bodiless log rebuilds it by its own index', () => {
    const rows: SessionLogRow[] = [
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      { type: 'user/message', seq: 1, time: 1, surfaceOp: 'append', data: { id: 'u1', role: 'user', content: [{ type: 'text', text: '写第四章' }], source: { kind: 'user' } } },
      { type: 'assistant/message', seq: 2, time: 2, surfaceOp: 'append', data: { turn: 1, message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: '写好了' }] }, usage: { inputTokens: 10, outputTokens: 2 } } },
      { type: 'turn/end', seq: 3, time: 3, data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'local-agent/compaction', seq: 4, time: 9, data: { source: 'manual', outcome: 'completed', provider: 'kimi-cli', summary: '摘要', startedAt: 5, endedAt: 9, boundarySeq: 3 } },
    ]
    const full = foldLogRows(openCursor(), rows)
    const compaction = full.find(request => request.purpose === 'compaction')!
    expect(compaction.logIndex).toBe(0.5)
    expect(JSON.stringify(compaction.segments)).toContain('写第四章')
    expect(JSON.stringify(compaction.segments)).toContain('写好了')
    const bodiless = openCursor()
    bodiless.materialize = () => false
    expect(foldLogRows(bodiless, rows).find(request => request.purpose === 'compaction')!.bodiless).toBe(true)
    const rebuild = openCursor()
    rebuild.materialize = (_host, index) => index === 0.5
    const rebuilt = foldLogRows(rebuild, rows).filter(request => request.bodiless !== true && request.logIndex === 0.5)
    expect(rebuilt).toHaveLength(1)
    expect(rebuilt[0]!.totalChars).toBeGreaterThan(0)
  })
})
