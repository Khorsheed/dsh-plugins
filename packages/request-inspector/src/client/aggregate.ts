/**
 * The client panel's pure aggregation and formatting helpers — everything the
 * views compute from the Remote payloads, in one testable module. No React,
 * no I/O, no clock.
 *
 * @module @khorsheed/dsh-request-inspector/client/aggregate
 */
import type {
  CapturedRequest, RequestUsage, SegmentCategory, TimingLane, TurnListItem,
} from '../types.ts'

/**
 * Resolve an assistant message id to its turn: the turn whose
 * `closingMessageId` matches, else the latest turn (the list arrives newest
 * last), else undefined when the session has no captured turns.
 */
export function resolveTurnSeq(turns: readonly TurnListItem[], messageId: string | undefined): number | undefined {
  if (turns.length === 0) return undefined
  if (messageId !== undefined) {
    const match = turns.find(turn => turn.closingMessageId === messageId)
    if (match !== undefined) return match.turnSeq
  }
  return turns[turns.length - 1]?.turnSeq
}

/** The latest turn's seq (the panel's default), undefined on an empty list. */
export function latestTurnSeq(turns: readonly TurnListItem[]): number | undefined {
  return turns[turns.length - 1]?.turnSeq
}

/** Total input = uncached + cache-read (the host's usage fields are disjoint). */
export function inputTotal(usage: RequestUsage): number {
  return usage.inputTokens + (usage.cacheReadTokens ?? 0)
}

/** Cache-hit percentage of the total input, one decimal; null when nothing was read. */
export function cachePct(usage: RequestUsage): number | null {
  const total = inputTotal(usage)
  if (total === 0) return null
  return Math.round(((usage.cacheReadTokens ?? 0) / total) * 1000) / 10
}

/** One row of the category stacked bar / legend. */
export interface CategoryAggregate {
  readonly category: SegmentCategory
  /** Rows (messages/sections) in the category; tool definitions count once per tool. */
  readonly count: number
  readonly chars: number
}

/**
 * One request's composition by category: the system/history/added message
 * items plus the tools segment as `tool-definition`, sorted by chars desc.
 */
export function aggregateCategories(request: CapturedRequest): CategoryAggregate[] {
  const byCategory = new Map<SegmentCategory, CategoryAggregate & { count: number; chars: number }>()
  const add = (category: SegmentCategory, chars: number): void => {
    const entry = byCategory.get(category) ?? { category, count: 0, chars: 0 }
    entry.count += 1
    entry.chars += chars
    byCategory.set(category, entry)
  }
  for (const item of [...request.segments.system, ...request.segments.history, ...request.segments.added]) {
    add(item.category, item.chars)
  }
  for (const tool of request.segments.tools) add('tool-definition', tool.chars)
  return [...byCategory.values()].sort((a, b) => b.chars - a.chars)
}

/** The timing vocabulary, in timeline order (the design's six-way split). */
export const TIMING_KINDS = ['wait', 'reasoning', 'tool-args', 'text', 'tool-exec', 'other'] as const
/** One timing bucket kind. */
export type TimingKind = (typeof TIMING_KINDS)[number]

/** Per-tool timing aggregate, derived from the lanes (tool-exec = calls/duration, tool-args = argument generation). */
export interface ToolAggregate {
  readonly tool: string
  readonly calls: number
  readonly argsMs: number
  readonly execMs: number
}

/** One request's lane sums (per kind) and wall span. */
export interface RequestLaneSummary {
  readonly requestSeq: number
  readonly scopeId: string
  readonly startedAt: number
  readonly endedAt: number
  readonly byKind: Readonly<Record<TimingKind, number>>
}

/** The timing tab's lane-derived view of (a scope of) a turn. */
export interface LaneSummary {
  /** Summed milliseconds per bucket, inter-lane gaps folded into `other`. */
  readonly buckets: Readonly<Record<TimingKind, number>>
  /** Lane count per kind (the legend's · N 次). */
  readonly counts: Readonly<Record<TimingKind, number>>
  /** First lane start; 0 when empty. */
  readonly t0: number
  /** Last lane end; 0 when empty. */
  readonly t1: number
  /** Per-tool rows, exec time desc. */
  readonly tools: readonly ToolAggregate[]
  /** Per-request rows, in time order. */
  readonly requests: readonly RequestLaneSummary[]
}

const ZERO_KINDS = (): Record<TimingKind, number> => ({
  wait: 0, reasoning: 0, 'tool-args': 0, text: 0, 'tool-exec': 0, other: 0,
})

/**
 * Reduce the turn's lanes to the timing tab's data. Lanes are strictly
 * ordered and carry their scope, so a scope filter is exact; gaps between
 * lanes (inter-request overhead) fold into `other`, the reference design's
 * 调用间隙并入其他开销. Whole-turn, the bucket sums equal the host's
 * `TurnTiming.buckets` by construction (the host sums the same lanes).
 */
export function summarizeLanes(lanes: readonly TimingLane[], scopeId?: string): LaneSummary {
  const filtered = (scopeId === undefined ? lanes : lanes.filter(lane => lane.scopeId === scopeId))
    .slice()
    .sort((a, b) => a.startedAt - b.startedAt || a.requestSeq - b.requestSeq)
  const buckets = ZERO_KINDS()
  const counts = ZERO_KINDS()
  const tools = new Map<string, { tool: string; calls: number; argsMs: number; execMs: number }>()
  const requests = new Map<number, {
    requestSeq: number; scopeId: string; startedAt: number; endedAt: number; byKind: Record<TimingKind, number>
  }>()
  let t0 = 0
  let t1 = 0
  let cursor: number | undefined
  for (const lane of filtered) {
    const end = lane.startedAt + lane.durationMs
    if (cursor === undefined) {
      t0 = lane.startedAt
    } else if (lane.startedAt > cursor) {
      // The inter-lane gap is turn overhead the host never lane-tags.
      buckets.other += lane.startedAt - cursor
    }
    cursor = cursor === undefined ? end : Math.max(cursor, end)
    t1 = Math.max(t1, end)
    buckets[lane.kind] += lane.durationMs
    counts[lane.kind] += 1
    if (lane.tool !== undefined) {
      const aggregate = tools.get(lane.tool) ?? { tool: lane.tool, calls: 0, argsMs: 0, execMs: 0 }
      if (lane.kind === 'tool-exec') {
        aggregate.calls += 1
        aggregate.execMs += lane.durationMs
      } else if (lane.kind === 'tool-args') {
        aggregate.argsMs += lane.durationMs
      }
      tools.set(lane.tool, aggregate)
    }
    const request = requests.get(lane.requestSeq) ?? {
      requestSeq: lane.requestSeq, scopeId: lane.scopeId,
      startedAt: lane.startedAt, endedAt: end, byKind: ZERO_KINDS(),
    }
    request.startedAt = Math.min(request.startedAt, lane.startedAt)
    request.endedAt = Math.max(request.endedAt, end)
    request.byKind[lane.kind] += lane.durationMs
    requests.set(lane.requestSeq, request)
  }
  return {
    buckets,
    counts,
    t0,
    t1,
    tools: [...tools.values()].sort((a, b) => b.execMs - a.execMs),
    requests: [...requests.values()].sort((a, b) => a.startedAt - b.startedAt || a.requestSeq - b.requestSeq),
  }
}

/** Thousands-separated integer (the design's fmt). */
export function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

/** Compact count: 12.3k over a thousand (the design's fmtK). */
export function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/** Wall-clock HH:MM of a timestamp (the timeline scale). */
export function fmtClock(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Row-level duration: milliseconds under a second, whole seconds above (the design's fmtDur). */
export function fmtDur(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms)}ms`
}

/** Span duration: one decimal in seconds, minutes above 60s (the design's ms()). */
export function fmtSpan(ms: number): string {
  return ms >= 60000
    ? `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`
    : `${(ms / 1000).toFixed(1)}s`
}
