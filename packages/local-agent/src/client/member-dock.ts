/**
 * The member dock: a unified projection-row stack rendered below the member
 * composer card. Each ambient state (token stats now; tasks / run progress
 * later) is one CONTRIBUTOR — a pure function from the projection bag to a
 * line descriptor or null — and registered contributors render in
 * registration order as separate rows sharing the official StatsLine metrics.
 * A contributor with no data returns null and its row is omitted; an all-null
 * stack renders nothing.
 *
 * Why a registry: the fallback-hiding lesson (the official dock lives inside
 * the composer-chain fallback that `overlay: true` hides on election) makes
 * self-rendered ambient state a repeating pattern in this composer — a second
 * ad-hoc row would already be a maintenance hazard, so the first refactor
 * extracts the pattern.
 * @module @khorsheed/dsh-local-agent/client/member-dock
 */

// Type-only: merges the `tokenUsage` key into SessionProjectionMap for useProjection.
import type {} from '@deepseek-ai/dsh-token-meter/client'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'

/** The locale seat contributors write copy through. */
type DockTranslate = PropsLocale<typeof NS>['t']

/** One rendered dock row. */
export interface MemberDockLine {
  /** Stable row id (the contributor's name; also the row's test hook stem). */
  id: string
  /** The fully formatted row text. */
  text: string
}

/**
 * The projection bag contributors read. Sourced from the slot kit's
 * `useProjection` seat — one entry per projection key a contributor needs
 * (`tokenUsage` now; `todos` / run progress later). An absent unit reads as
 * undefined, and the contributor drops out whole.
 */
export interface MemberDockProjections {
  /** Session token accounting (the token-meter unit's durable projection). */
  tokenUsage?: TokenUsageProjection | undefined
}

/**
 * One dock contributor: a pure function from the projection bag to a row, or
 * null when its data is absent (the row is then omitted).
 */
export type MemberDockContributor =
  (projections: MemberDockProjections, t: DockTranslate) => MemberDockLine | null

/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three
 * digits) — the official StatsLine's rule, mirrored so the member composer's
 * stats read identically.
 * @param n - token count.
 * @returns display string.
 */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/**
 * Cache-hit share of prompt-side input (cacheRead over the three disjoint
 * billing buckets), the official StatsLine's formula.
 * @param usage - the session's token-usage projection value.
 * @returns rounded integer percent, or null when no input was billed.
 */
export function cacheHitPercent(usage: TokenUsageProjection): number | null {
  const billed = usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  return billed === 0 ? null : Math.round(usage.cacheReadTokens / billed * 100)
}

/**
 * The stats contributor: the member-channel stats line (cache-hit share over
 * the three billing buckets + compact input/output totals), behavior
 * byte-identical to the pre-dock implementation — it just returns a dock line
 * now instead of rendering in place. While a run is in flight the projection
 * holds the last settled usage — exactly the desired "no live ticking".
 */
export function statsContributor(projections: MemberDockProjections, t: DockTranslate): MemberDockLine | null {
  const usage = projections.tokenUsage
  if (usage === undefined) return null
  const billed = usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  if (billed === 0 && usage.outputTokens === 0) return null
  const groups: string[] = []
  const cacheHit = cacheHitPercent(usage)
  if (cacheHit !== null) groups.push(t('member.stats.cacheHit', { percent: cacheHit }))
  groups.push(t('member.stats.tokens', { input: formatTokens(billed), output: formatTokens(usage.outputTokens) }))
  return { id: 'stats', text: groups.join(' | ') }
}

/** The registered contributors, in render order. Registration IS inclusion. */
export const MEMBER_DOCK_CONTRIBUTORS: readonly MemberDockContributor[] = [
  statsContributor,
]

/**
 * Evaluate contributors over the current projections.
 * @param projections - the projection bag from the slot kit.
 * @param t - the locale seat.
 * @param contributors - the registry; the parameter exists so tests exercise
 *   the evaluation contract (null rows omitted, registration order) without
 *   mutating the real registry.
 * @returns the rows to render, in registration order (possibly empty).
 */
export function memberDockLines(
  projections: MemberDockProjections,
  t: DockTranslate,
  contributors: readonly MemberDockContributor[] = MEMBER_DOCK_CONTRIBUTORS,
): MemberDockLine[] {
  const lines: MemberDockLine[] = []
  for (const contributor of contributors) {
    const line = contributor(projections, t)
    if (line !== null) lines.push(line)
  }
  return lines
}
