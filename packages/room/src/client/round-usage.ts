/**
 * One member round's usage as the room shows it (batch 5 S6, usage in one
 * place; user decision 2026-11-03 ②). Nothing here is stored: a round that
 * is a local-agent execution carries the core's reading (`RoomExecution.reading`,
 * attached by `getState`), and this module only picks what to show from it.
 *
 * - The CLI reported a round total (claude-code, codex): the round shows that
 *   total. The per-call sum is checked against it; a gap beyond
 *   {@link usageGapTolerance} is shown as a quiet hint next to the round.
 * - No CLI total (kimi, dsh): the round shows the per-call sum.
 * - A run from before S6 without a reading: the numbers the room stored for
 *   it back then, as written (never mixed with a reading).
 * - The member CLI ran subagents of its own (member-cli-subagents M6; user
 *   decision 2026-11-06: counted in, shown as two lines): the headline adds
 *   their per-call sum (`reading.subagentUsage`) to the member's own, and the
 *   line carries both parts. The CLI-total check compares the member's own
 *   calls only — like with like.
 *
 * A compaction's spend and context sizes are never part of a round's usage:
 * they are the compaction row's (see `RoomCompactionView`).
 * @module @khorsheed/dsh-room/client/round-usage
 */
import type { LocalAgentCompactionEvent } from '@khorsheed/dsh-local-agent/types'
import type { RoomExecution, RoomRunUsage } from '../types.ts'

/** A usage's billed total: the disjoint buckets summed (cache reads and writes included). */
export function usageTotal(usage: RoomRunUsage): number {
  const total = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) + usage.outputTokens
  return Number.isFinite(total) && total > 0 ? total : 0
}

/**
 * How far the per-call sum may drift from the CLI's total before the round
 * says so: 1% of the total, at least 50 tokens (rounding in a CLI's own
 * accounting is not worth a hint).
 * @param cliTokens - the CLI's round total.
 * @returns the tolerated absolute gap.
 */
export function usageGapTolerance(cliTokens: number): number {
  return Math.max(50, cliTokens * 0.01)
}

/** What one round's usage line shows. */
export interface RoundUsage {
  /** The headline total. */
  readonly tokens: number
  /** The buckets behind the headline, for the breakdown. */
  readonly breakdown?: RoomRunUsage
  /** Where the headline comes from: the CLI's own total, the per-call sum, or a legacy stored copy. */
  readonly source: 'cli' | 'calls' | 'stored'
  /** The per-call sum, when the headline is the CLI's total (for the breakdown). */
  readonly callTokens?: number
  /**
   * The per-call sum minus the CLI total, only when it is beyond the
   * tolerance: negative = the calls add up to less (likely CLI-internal
   * calls that never reached the stream), positive = more.
   */
  readonly gap?: number
  /** The member's own part, when subagents are counted in (the headline before they were added). */
  readonly member?: { readonly tokens: number; readonly breakdown?: RoomRunUsage }
  /**
   * The member CLI's own subagents that ran in this round: their per-call
   * sum, and how many subagents (a resumed one counts once: one session).
   */
  readonly subagents?: { readonly tokens: number; readonly breakdown: RoomRunUsage; readonly count: number }
}

function addRunUsage(a: RoomRunUsage | undefined, b: RoomRunUsage): RoomRunUsage {
  const sum = (x: number | undefined, y: number | undefined): number | undefined => x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0)
  const cacheReadTokens = sum(a?.cacheReadTokens, b.cacheReadTokens)
  const cacheWriteTokens = sum(a?.cacheWriteTokens, b.cacheWriteTokens)
  const reasoningTokens = sum(a?.reasoningTokens, b.reasoningTokens)
  return {
    inputTokens: (a?.inputTokens ?? 0) + b.inputTokens,
    outputTokens: (a?.outputTokens ?? 0) + b.outputTokens,
    ...cacheReadTokens === undefined ? {} : { cacheReadTokens },
    ...cacheWriteTokens === undefined ? {} : { cacheWriteTokens },
    ...reasoningTokens === undefined ? {} : { reasoningTokens },
  }
}

/** Add the round's subagents to the member's own line (unchanged when none carried usage). */
function withSubagents(own: RoundUsage | undefined, execution: RoomExecution): RoundUsage | undefined {
  const reading = execution.reading
  const usage = reading?.subagentUsage
  const tokens = usage === undefined ? 0 : usageTotal(usage)
  if (usage === undefined || tokens === 0) return own
  const count = new Set((reading?.subagents ?? []).map(entry => entry.sessionId)).size
  const subagents = { tokens, breakdown: usage, count }
  if (own === undefined) return { tokens, breakdown: usage, source: 'calls', member: { tokens: 0 }, subagents }
  return {
    ...own,
    tokens: own.tokens + tokens,
    breakdown: addRunUsage(own.breakdown, usage),
    member: { tokens: own.tokens, ...own.breakdown === undefined ? {} : { breakdown: own.breakdown } },
    subagents,
  }
}

/**
 * The usage one round shows.
 * @param execution - the round's run, with the core's reading when there is one.
 * @returns the usage line, or undefined when there is nothing to show.
 */
export function roundUsage(execution: RoomExecution | undefined): RoundUsage | undefined {
  if (execution === undefined) return undefined
  const reading = execution.reading
  if (reading !== undefined) return withSubagents(memberRoundUsage(reading), execution)
  const usage = execution.usage
  // Legacy rows: the billed total is the sum of the disjoint buckets when
  // they were recorded (an older record's total may leave the cache out).
  const tokens = usage === undefined ? execution.tokens : usageTotal(usage)
  if (tokens === undefined || !(tokens > 0)) return undefined
  return { tokens, ...usage === undefined ? {} : { breakdown: usage }, source: 'stored' }
}

/** The member's own round line from a reading: the CLI total (with the check), else the per-call sum. */
function memberRoundUsage(reading: NonNullable<RoomExecution['reading']>): RoundUsage | undefined {
  const cli = reading.providerReportedUsage
  const callTokens = reading.callUsage === undefined ? 0 : usageTotal(reading.callUsage)
  if (cli !== undefined && usageTotal(cli) > 0) {
    const tokens = usageTotal(cli)
    const gap = callTokens - tokens
    return {
      tokens, breakdown: cli, source: 'cli', callTokens,
      ...Math.abs(gap) > usageGapTolerance(tokens) ? { gap } : {},
    }
  }
  if (reading.callUsage !== undefined && callTokens > 0) return { tokens: callTokens, breakdown: reading.callUsage, source: 'calls' }
  return undefined
}

/** A compaction row's numbers: context sizes (never usage) and the compaction call's own spend. */
export interface CompactionNumbers {
  readonly beforeTokens?: number
  readonly afterTokens?: number
  /** The compaction call's spend, billed total. */
  readonly usage?: number
  /** The fact says the source reports neither sizes nor spend. */
  readonly unreported?: true
}

/**
 * The numbers a compaction row shows: the run's core fact through the
 * reading (the last `local-agent/compaction` in the execution), else the
 * copies a row from before S6 stored.
 * @param stored - the row's own (legacy) fields.
 * @param execution - the compaction run, with its reading when there is one.
 * @returns the numbers.
 */
export function compactionNumbers(
  stored: { readonly beforeTokens?: number; readonly afterTokens?: number; readonly usage?: RoomRunUsage },
  execution: RoomExecution | undefined,
): CompactionNumbers {
  const fact: LocalAgentCompactionEvent | undefined = execution?.reading?.compactions.at(-1)
  if (fact !== undefined) {
    const unrecorded = fact.unrecorded ?? []
    return {
      ...fact.beforeTokens === undefined ? {} : { beforeTokens: fact.beforeTokens },
      ...fact.afterTokens === undefined ? {} : { afterTokens: fact.afterTokens },
      ...fact.usage === undefined || usageTotal(fact.usage) === 0 ? {} : { usage: usageTotal(fact.usage) },
      ...unrecorded.includes('before-after') && unrecorded.includes('usage') ? { unreported: true as const } : {},
    }
  }
  return {
    ...stored.beforeTokens === undefined ? {} : { beforeTokens: stored.beforeTokens },
    ...stored.afterTokens === undefined ? {} : { afterTokens: stored.afterTokens },
    ...stored.usage === undefined || usageTotal(stored.usage) === 0 ? {} : { usage: usageTotal(stored.usage) },
  }
}
