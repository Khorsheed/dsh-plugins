import { describe, expect, it } from 'vitest'
import { localAgentToolTimingMeta } from '../src/tool-timing.ts'

describe('localAgentToolTimingMeta', () => {
  it('keeps a complete execution interval separate from mirror write times', () => {
    expect(localAgentToolTimingMeta('kimi-cli', { startedAt: 100, endedAt: 1350, source: 'provider' })).toEqual({
      localAgentTiming: {
        version: 1,
        provider: 'kimi-cli',
        startedAt: 100,
        endedAt: 1350,
        source: 'provider',
      },
    })
  })

  it('omits incomplete and invalid intervals', () => {
    expect(localAgentToolTimingMeta('codex-local', { startedAt: 100, source: 'observed' })).toBeUndefined()
    expect(localAgentToolTimingMeta('codex-local', { startedAt: 100, endedAt: 99, source: 'observed' })).toBeUndefined()
    expect(localAgentToolTimingMeta('codex-local', { startedAt: -1, endedAt: 1, source: 'observed' })).toBeUndefined()
    expect(localAgentToolTimingMeta('codex-local', { startedAt: 1, endedAt: Number.NaN, source: 'observed' })).toBeUndefined()
  })
})
