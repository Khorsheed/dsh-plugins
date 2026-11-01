/** Kimi's compaction as its wire records it (shape probed against kimi 2.1.1). */
import { describe, expect, it } from 'vitest'
import { kimiContextTokens, readKimiCompaction } from '../src/kimi-compaction.ts'

const line = (row: object): string => JSON.stringify(row)
const BEFORE = [
  line({ type: 'turn.prompt', input: [{ type: 'text', text: '记住 4271' }] }),
  line({ type: 'usage.record', usage: { inputOther: 864, output: 29, inputCacheRead: 18944 }, usageScope: 'turn' }),
  line({ type: 'token_counting.turn_recorded', turnId: 0, tokens: 19837 }),
]
const COMPACTION = [
  line({ type: 'full_compaction.begin', source: 'manual' }),
  line({ type: 'llm.request', kind: 'compaction', modelAlias: 'kimi-code/k3' }),
  line({ type: 'usage.record', usage: { inputOther: 1103, output: 154, inputCacheRead: 19712 }, usageScope: 'session' }),
  line({ type: 'context.apply_compaction', summary: '用户要求记住数字 4271。', contextSummary: '前言\n用户要求记住数字 4271。', keptUserMessageCount: 3 }),
  line({ type: 'token_counting.rebased', tokens: 22085, measured: false }),
]

describe('kimi compaction reading', () => {
  it('reads a completed compaction: summary, its own spend, occupancy before and after', () => {
    const text = [...BEFORE, ...COMPACTION, line({ type: 'full_compaction.complete' })].join('\n')
    expect(readKimiCompaction(text, BEFORE.length)).toEqual({
      done: true, outcome: 'completed', source: 'manual', model: 'kimi-code/k3',
      summary: '用户要求记住数字 4271。', contextSummary: '前言\n用户要求记住数字 4271。', keptUserMessages: 3, beforeTokens: 19837, afterTokens: 22085,
      usage: { inputTokens: 1103, outputTokens: 154, cacheReadTokens: 19712 },
    })
  })

  it('is not done until the wire says so (a prompt sent now would be dropped)', () => {
    expect(readKimiCompaction([...BEFORE].join('\n'), BEFORE.length)).toEqual({ done: false })
    expect(readKimiCompaction([...BEFORE, ...COMPACTION].join('\n'), BEFORE.length)).toMatchObject({ done: false, summary: '用户要求记住数字 4271。' })
  })

  it('reports a failed or cancelled compaction, and an automatic one', () => {
    expect(readKimiCompaction([...BEFORE, COMPACTION[0], line({ type: 'compaction.failed', message: 'too large' })].join('\n'), BEFORE.length))
      .toMatchObject({ done: true, outcome: 'failed', error: 'too large' })
    expect(readKimiCompaction([...BEFORE, COMPACTION[0], line({ type: 'full_compaction.cancel' })].join('\n'), BEFORE.length))
      .toMatchObject({ done: true, outcome: 'cancelled' })
    expect(readKimiCompaction([...BEFORE, line({ type: 'full_compaction.begin', source: 'threshold' }), line({ type: 'full_compaction.complete' })].join('\n'), BEFORE.length))
      .toMatchObject({ done: true, source: 'auto' })
  })

  it('the context occupancy is the latest token count', () => {
    expect(kimiContextTokens([...BEFORE, ...COMPACTION].join('\n'))).toBe(22085)
    expect(kimiContextTokens('')).toBeUndefined()
  })
})
