import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  analyzeSession,
  collectSessionFiles,
  decodeSessionFile,
  summarize,
  DEFAULTS,
} from './analyze-clearing-fit.ts'
import type { AnalyzeOptions } from './analyze-clearing-fit.ts'

const OPTIONS: AnalyzeOptions = {
  ...DEFAULTS,
  windowTokens: 1_000,
  triggerRatio: 0.4,
  keep: 15,
  prices: { hit: 0.007, miss: 0.22 },
  minRemainingCalls: 100,
}

function toolResult(seq: number, chars: number): string {
  return JSON.stringify({
    type: 'tool/result',
    seq,
    time: 1_000 + seq,
    surfaceOp: 'append',
    data: { message: { content: [{ content: [{ type: 'text', text: 'x'.repeat(chars) }] }] } },
  })
}

function assistantMessage(seq: number, chars: number): string {
  return JSON.stringify({
    type: 'assistant/message',
    seq,
    time: 1_000 + seq,
    surfaceOp: 'append',
    data: { message: { content: [{ type: 'text', text: 'y'.repeat(chars) }] } },
  })
}

function usage(seq: number, cacheRead: number, input = 10): string {
  return JSON.stringify({
    type: 'assistant/chunk',
    seq,
    time: 1_000 + seq,
    data: { chunk: { type: 'usage', usage: { inputTokens: input, outputTokens: 5, cacheReadTokens: cacheRead } } },
  })
}

/** One large session: 40 tool results x 200 chars, then 150 cached calls. */
function monsterLog(): string {
  const lines: string[] = [
    JSON.stringify({ type: 'session', version: 0, id: 'monster' }),
  ]
  let seq = 0
  for (let i = 0; i < 40; i += 1) {
    lines.push(toolResult(seq, 200)); seq += 1
    lines.push(assistantMessage(seq, 5)); seq += 1
  }
  lines.push(usage(seq, 1500)); seq += 1
  for (let i = 0; i < 150; i += 1) {
    lines.push(usage(seq, 1500)); seq += 1
  }
  return lines.join('\n') + '\n'
}

/** One small session that never crosses the trigger. */
function smallLog(cacheRead: number): string {
  return [
    JSON.stringify({ type: 'session', version: 0, id: 'small' }),
    toolResult(0, 100),
    usage(1, cacheRead),
  ].join('\n') + '\n'
}

describe('analyzeSession', () => {
  it('measures context, tool share, and calls after the trigger crossing', () => {
    const stats = analyzeSession('monster', monsterLog(), OPTIONS)
    // 40 * 200 + 40 * 5 = 8200 chars -> 2050 tokens; trigger at 400 tokens.
    expect(stats.maxContextTokens).toBe(2050)
    expect(stats.toolResultsAtMax).toBe(40)
    expect(stats.toolShareAtMax).toBeCloseTo(8000 / 8200, 2)
    // clearable = 2000 * (40 - 15) / 40 = 1250
    expect(stats.clearableTokens).toBe(1250)
    // The 8th tool result crosses the 400-token trigger, so every usage
    // chunk (all 151) lands after the crossing.
    expect(stats.calls).toBe(151)
    expect(stats.callsAfterTrigger).toBe(151)
    expect(stats.cacheReadTokens).toBe(151 * 1500)
  })

  it('counts compaction events', () => {
    const log = monsterLog()
      + JSON.stringify({ type: 'compaction/prune', seq: 900, time: 1, data: {} }) + '\n'
      + JSON.stringify({ type: 'compaction/summary', seq: 901, time: 2, data: {} }) + '\n'
    const stats = analyzeSession('monster', log, OPTIONS)
    expect(stats.pruneEvents).toBe(1)
    expect(stats.summaryEvents).toBe(1)
  })
})

describe('summarize', () => {
  it('recommends ENABLE when net-positive sessions dominate cache spend', () => {
    const stats = [
      analyzeSession('monster', monsterLog(), OPTIONS),
      analyzeSession('small-1', smallLog(1_000), OPTIONS),
      analyzeSession('small-2', smallLog(1_000), OPTIONS),
    ]
    const report = summarize(stats, OPTIONS)
    const monster = report.topSessions[0]
    expect(monster.id).toBe('monster')
    expect(monster.eligible).toBe(true)
    expect(monster.netPositive).toBe(true)
    expect(monster.paybackCalls).toBeLessThan(monster.callsAfterTrigger)
    expect(report.eligibleCacheShare).toBeGreaterThan(0.9)
    expect(report.enable).toBe(true)
    expect(report.suggestedClearAtLeast).toBeGreaterThanOrEqual(50_000)
  })

  it('recommends HOLD when no session crosses the trigger', () => {
    const stats = [
      analyzeSession('small-1', smallLog(5_000), OPTIONS),
      analyzeSession('small-2', smallLog(5_000), OPTIONS),
    ]
    const report = summarize(stats, OPTIONS)
    expect(report.enable).toBe(false)
    expect(report.eligibleCacheShare).toBe(0)
    expect(report.reasons.join(' ')).toContain('trigger')
  })
})

describe('log file decoding', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clearing-fit-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('collects and decodes both plain and zstd session logs', () => {
    const plain = join(dir, 'proj--', 'session-a')
    const packed = join(dir, 'proj--', 'session-b')
    mkdirSync(plain, { recursive: true })
    mkdirSync(packed, { recursive: true })
    writeFileSync(join(plain, 'session.jsonl'), smallLog(100))
    writeFileSync(join(packed, 'session.jsonl.zstd'), zstdCompressSync(Buffer.from(monsterLog())))

    const files = collectSessionFiles(dir)
    expect(files).toHaveLength(2)
    const decoded = files.map((f) => decodeSessionFile(f))
    expect(decoded.some((d) => d.includes('"small"'))).toBe(true)
    expect(decoded.some((d) => d.includes('"monster"'))).toBe(true)
  })
})
