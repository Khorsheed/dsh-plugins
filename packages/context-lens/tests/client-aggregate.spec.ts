/**
 * The client aggregation layer's spec: turn resolution (the turn action's
 * closingMessageId match + latest fallback), the category aggregation behind
 * the stacked bar, and the lane reduction behind the timing tab (bucket sums,
 * inter-lane gaps folded into other, per-tool and per-scope splits).
 */
import { describe, expect, it } from 'vitest'
import type { CapturedRequest, TimingLane, TurnListItem } from '../src/types.ts'
import {
  aggregateCategories, cachePct, fmtDur, fmtK, fmtSpan, inputTotal, latestTurnSeq, resolveTurnSeq, summarizeLanes, summaryText,
} from '../src/client/aggregate.ts'

const turn = (over: Partial<TurnListItem>): TurnListItem => ({
  sessionId: 's1',
  turnSeq: 1,
  query: 'q',
  startedAt: 1_000,
  requestCount: 1,
  scopeCount: 1,
  failedScopeCount: 0,
  totalInputTokens: 100,
  totalOutputTokens: 10,
  ...over,
})

describe('resolveTurnSeq', () => {
  const turns = [
    turn({ turnSeq: 1, closingMessageId: 'm-a' }),
    turn({ turnSeq: 2, closingMessageId: 'm-b' }),
    turn({ turnSeq: 3 }),
  ]

  it('matches the turn whose closingMessageId is the message', () => {
    expect(resolveTurnSeq(turns, 'm-b')).toBe(2)
    expect(resolveTurnSeq(turns, 'm-a')).toBe(1)
  })

  it('falls back to the latest turn when no turn closes with the message', () => {
    expect(resolveTurnSeq(turns, 'm-unknown')).toBe(3)
    expect(resolveTurnSeq(turns, undefined)).toBe(3)
    expect(latestTurnSeq(turns)).toBe(3)
  })

  it('returns undefined for a session with no captured turns', () => {
    expect(resolveTurnSeq([], 'm-a')).toBeUndefined()
    expect(latestTurnSeq([])).toBeUndefined()
  })
})

const requestFixture = (): CapturedRequest => ({
  seq: 7,
  scopeId: 'main',
  sessionId: 's1',
  startedAt: 1_000,
  status: 'ok',
  config: { provider: 'deepseek', model: 'deepseek-chat', maxTokens: 131_072 },
  usage: { inputTokens: 2_000, outputTokens: 300, cacheReadTokens: 8_000 },
  timing: { totalMs: 4_200 },
  responseSummary: { kind: 'tool', name: 'read', hint: 'a.ts' },
  segments: {
    system: [
      { index: 0, category: 'system', source: 'identity', preview: 'p', full: 'a'.repeat(100), chars: 100, freshness: 'history' },
      { index: 0, category: 'system', source: 'tools', preview: 'p', full: 'b'.repeat(50), chars: 50, freshness: 'history' },
    ],
    tools: [
      { name: 'read', description: 'd', parameters: '{}', chars: 40, added: false },
      { name: 'write', description: 'd', parameters: '{}', chars: 60, added: true },
    ],
    history: [
      { index: 1, category: 'user', source: 'user', preview: 'p', full: 'c'.repeat(30), chars: 30, freshness: 'history' },
    ],
    added: [
      { index: 2, category: 'assistant', source: 'model', toolCalls: ['read'], preview: 'p', full: '{"text":"x"}', chars: 70, durationMs: 900, freshness: 'new' },
      { index: 3, category: 'tool-result', source: 'read', preview: 'p', full: 'd'.repeat(20), chars: 20, freshness: 'new' },
    ],
  },
})

describe('aggregateCategories', () => {
  it('aggregates the four segments by category, tools as 工具定义, chars desc', () => {
    const cats = aggregateCategories(requestFixture())
    const byCategory = new Map(cats.map(cat => [cat.category, cat]))
    expect(byCategory.get('system')).toMatchObject({ count: 2, chars: 150 })
    expect(byCategory.get('tool-definition')).toMatchObject({ count: 2, chars: 100 })
    expect(byCategory.get('assistant')).toMatchObject({ count: 1, chars: 70 })
    expect(byCategory.get('user')).toMatchObject({ count: 1, chars: 30 })
    expect(byCategory.get('tool-result')).toMatchObject({ count: 1, chars: 20 })
    expect(cats[0]?.category).toBe('system')
  })

  it('treats cache reads as disjoint input (the host usage contract)', () => {
    const usage = requestFixture().usage
    expect(usage === undefined ? 0 : inputTotal(usage)).toBe(10_000)
    expect(usage === undefined ? null : cachePct(usage)).toBe(80)
  })
})

const lane = (over: Partial<TimingLane>): TimingLane => ({
  kind: 'text',
  requestSeq: 1,
  scopeId: 'main',
  startedAt: 0,
  durationMs: 0,
  ...over,
})

describe('summarizeLanes', () => {
  // Two main-scope requests back to back, one subagent request between them;
  // a 2s gap before the second main request (inter-lane overhead → other).
  const lanes: TimingLane[] = [
    lane({ kind: 'wait', requestSeq: 1, startedAt: 0, durationMs: 500 }),
    lane({ kind: 'reasoning', requestSeq: 1, startedAt: 500, durationMs: 1_000 }),
    lane({ kind: 'tool-args', requestSeq: 1, startedAt: 1_500, durationMs: 300, tool: 'read' }),
    lane({ kind: 'tool-exec', requestSeq: 1, startedAt: 1_800, durationMs: 700, tool: 'read' }),
    lane({ kind: 'wait', requestSeq: 2, scopeId: 'child-1', startedAt: 2_500, durationMs: 200 }),
    lane({ kind: 'text', requestSeq: 2, scopeId: 'child-1', startedAt: 2_700, durationMs: 400 }),
    lane({ kind: 'text', requestSeq: 3, startedAt: 5_000, durationMs: 900 }),
  ]

  it('sums buckets across the turn and folds inter-lane gaps into other', () => {
    const summary = summarizeLanes(lanes)
    expect(summary.buckets.wait).toBe(700)
    expect(summary.buckets.reasoning).toBe(1_000)
    expect(summary.buckets['tool-args']).toBe(300)
    expect(summary.buckets.text).toBe(1_300)
    expect(summary.buckets['tool-exec']).toBe(700)
    // Gaps: 2500 - 2500 (none) and 5000 - 3100 = 1900.
    expect(summary.buckets.other).toBe(1_900)
    expect(summary.t0).toBe(0)
    expect(summary.t1).toBe(5_900)
  })

  it('aggregates per tool: exec lanes are calls+duration, tool-args lanes are argument time', () => {
    const summary = summarizeLanes(lanes)
    expect(summary.tools).toHaveLength(1)
    expect(summary.tools[0]).toMatchObject({ tool: 'read', calls: 1, execMs: 700, argsMs: 300 })
  })

  it('filters exactly by scope (the chips apply to the timing tab too)', () => {
    const sub = summarizeLanes(lanes, 'child-1')
    expect(sub.buckets.wait).toBe(200)
    expect(sub.buckets.text).toBe(400)
    expect(sub.requests.map(row => row.requestSeq)).toEqual([2])
    const main = summarizeLanes(lanes, 'main')
    expect(main.requests.map(row => row.requestSeq)).toEqual([1, 3])
  })

  it('groups lanes per request with wall span and per-kind sums', () => {
    const summary = summarizeLanes(lanes)
    const first = summary.requests[0]
    expect(first).toMatchObject({ requestSeq: 1, startedAt: 0, endedAt: 2_500 })
    expect(first?.byKind['tool-exec']).toBe(700)
  })

  it('is empty for a turn with no lanes', () => {
    const summary = summarizeLanes([])
    expect(summary.buckets.other).toBe(0)
    expect(summary.requests).toHaveLength(0)
    expect(summary.tools).toHaveLength(0)
  })
})

describe('formatting', () => {
  it('formats counts, durations and spans the design way', () => {
    expect(fmtK(999)).toBe('999')
    expect(fmtK(12_340)).toBe('12.3k')
    expect(fmtDur(400)).toBe('0.4s')
    expect(fmtDur(4_200)).toBe('4.2s')
    expect(fmtSpan(4_200)).toBe('4.2s')
    expect(fmtSpan(65_000)).toBe('1m 5.0s')
  })
})

describe('summaryText', () => {
  it('renders the tool case as name:hint, the text case localized, none as a dash', () => {
    expect(summaryText({ kind: 'tool', name: 'read', hint: 'a.ts' }, '直接回答')).toBe('read:a.ts')
    expect(summaryText({ kind: 'tool', name: 'read' }, '直接回答')).toBe('read')
    expect(summaryText({ kind: 'tool', name: 'read', hint: 'a.ts', more: 2 }, '直接回答')).toBe('read:a.ts +2')
    expect(summaryText({ kind: 'text' }, '直接回答')).toBe('直接回答')
    expect(summaryText({ kind: 'text' }, 'Direct answer')).toBe('Direct answer')
    expect(summaryText({ kind: 'none' }, '直接回答')).toBe('—')
  })
})
