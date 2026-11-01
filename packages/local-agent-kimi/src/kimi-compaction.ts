/**
 * Kimi's context compaction as its wire records it (kimi 2.1.1, probed
 * 2026-10-30): `/compact` returns at once ("runs in the background"), then
 *
 *   full_compaction.begin { source: 'manual' | … }
 *   llm.request { kind: 'compaction', modelAlias }
 *   usage.record { usageScope: 'session', usage }      — the call's own spend
 *   context.apply_compaction { summary }
 *   token_counting.rebased { tokens }                   — occupancy after
 *   full_compaction.complete {}                          (or .cancel / compaction.failed)
 *
 * The occupancy before is the latest `token_counting.*` count ahead of the
 * begin. A prompt sent before `.complete` is dropped silently by kimi, which
 * is why the driver holds the member's queue until this reads `done`.
 * @module @khorsheed/dsh-local-agent-kimi/kimi-compaction
 */
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { usageFromWire } from './session-view.ts'

/** What one compaction left in the wire, read from a line offset on. */
export interface KimiCompactionReading {
  /** The compaction ended (completed, cancelled or failed). */
  readonly done: boolean
  readonly outcome?: 'completed' | 'failed' | 'cancelled'
  readonly source?: 'manual' | 'auto'
  readonly summary?: string
  /** The text kimi puts in the context in place of the history (the summary with its preamble and recovery note). */
  readonly contextSummary?: string
  /** User messages kimi kept verbatim (the rest became the summary). */
  readonly keptUserMessages?: number
  readonly usage?: TokenUsage
  readonly beforeTokens?: number
  readonly afterTokens?: number
  readonly model?: string
  readonly error?: string
}

/** Parse the wire's JSONL lines, skipping malformed ones. */
function rows(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    try { out.push(JSON.parse(line) as Record<string, unknown>) } catch { /* a torn last line */ }
  }
  return out
}

/** The occupancy a token-counting record states, when it states one. */
function tokensOf(row: Record<string, unknown>): number | undefined {
  return typeof row['tokens'] === 'number' && Number.isFinite(row['tokens']) ? row['tokens'] : undefined
}

/**
 * The context occupancy the wire last counted (the compaction's "before").
 * @param text - the whole wire log.
 * @returns the latest `token_counting.*` count, or undefined.
 */
export function kimiContextTokens(text: string): number | undefined {
  let latest: number | undefined
  for (const row of rows(text)) {
    if (typeof row['type'] === 'string' && row['type'].startsWith('token_counting.')) latest = tokensOf(row) ?? latest
  }
  return latest
}

/**
 * Read the compaction that began after `fromLine` (the wire's line count when
 * `/compact` went out).
 * @param text - the whole wire log.
 * @param fromLine - wire lines that predate the compaction.
 * @returns what it recorded so far; `done` once it ended.
 */
export function readKimiCompaction(text: string, fromLine: number): KimiCompactionReading {
  const lines = text.split('\n')
  const tail = rows(lines.slice(fromLine).join('\n'))
  const begin = tail.findIndex(row => row['type'] === 'full_compaction.begin')
  if (begin < 0) return { done: false }
  let reading: { -readonly [K in keyof KimiCompactionReading]: KimiCompactionReading[K] } = { done: false }
  const source = tail[begin]!['source']
  reading.source = source === 'manual' ? 'manual' : 'auto'
  const before = kimiContextTokens(lines.slice(0, fromLine).join('\n'))
  if (before !== undefined) reading.beforeTokens = before
  for (const row of tail.slice(begin + 1)) {
    switch (row['type']) {
      case 'llm.request':
        if (row['kind'] === 'compaction' && typeof row['modelAlias'] === 'string') reading.model = row['modelAlias']
        break
      case 'usage.record': {
        if (row['usageScope'] !== 'session') break
        const usage = usageFromWire(row['usage'])
        if (usage !== undefined) reading.usage = usage
        break
      }
      case 'context.apply_compaction':
        if (typeof row['summary'] === 'string' && row['summary'].trim() !== '') reading.summary = row['summary']
        if (typeof row['contextSummary'] === 'string' && row['contextSummary'].trim() !== '') reading.contextSummary = row['contextSummary']
        if (typeof row['keptUserMessageCount'] === 'number' && Number.isFinite(row['keptUserMessageCount'])) reading.keptUserMessages = row['keptUserMessageCount']
        break
      case 'token_counting.rebased': {
        const after = tokensOf(row)
        if (after !== undefined) reading.afterTokens = after
        break
      }
      case 'full_compaction.complete':
        return { ...reading, done: true, outcome: 'completed' }
      case 'full_compaction.cancel':
        return { ...reading, done: true, outcome: 'cancelled' }
      case 'compaction.failed':
      case 'compaction.unable':
        reading = { ...reading, done: true, outcome: 'failed', ...typeof row['message'] === 'string' ? { error: row['message'] } : {} }
        return reading
      default:
        break
    }
  }
  return reading
}
