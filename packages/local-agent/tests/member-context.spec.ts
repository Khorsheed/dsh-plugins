import { describe, expect, it } from 'vitest'
import { memberContextOf } from '../src/index.ts'

const event = (type: string, data: unknown, seq: number) => ({ type, data, seq }) as never

describe('memberContextOf', () => {
  it('reads the latest occupancy; a later completed compaction replaces it with its after-count', () => {
    expect(memberContextOf([])).toBeUndefined()
    expect(memberContextOf([
      event('local-agent/context', { provider: 'kimi-cli', usedTokens: 200_000, contextWindow: 262_144 }, 1),
      event('local-agent/compaction', { provider: 'kimi-cli', outcome: 'completed', afterTokens: 30_000, source: 'manual' }, 2),
    ])).toEqual({ provider: 'kimi-cli', usedTokens: 30_000, contextWindow: 262_144 })
  })

  it('a failed compaction changes nothing; one without an after-count leaves the occupancy unknown', () => {
    const before = event('local-agent/context', { provider: 'codex-local', usedTokens: 300_000, contextWindow: 400_000 }, 1)
    expect(memberContextOf([before, event('local-agent/compaction', { provider: 'codex-local', outcome: 'failed', source: 'manual' }, 2)]))
      .toEqual({ provider: 'codex-local', usedTokens: 300_000, contextWindow: 400_000 })
    expect(memberContextOf([before, event('local-agent/compaction', { provider: 'codex-local', outcome: 'completed', source: 'manual' }, 2)]))
      .toEqual({ provider: 'codex-local', contextWindow: 400_000 })
  })
})
