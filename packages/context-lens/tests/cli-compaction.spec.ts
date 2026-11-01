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
    expect(built[0]!.logIndex).toBeUndefined()
    expect(built[1]).toMatchObject({ hostTurn: 2, status: 'failed', error: 'boom', compaction: { source: 'auto', applied: false } })
    expect(built[1]!.compaction!.betweenTurns).toBeUndefined()
  })
})
