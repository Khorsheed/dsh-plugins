/**
 * Pure guard decision math: whether the next request's prompt-plus-output
 * budget is about to overflow the model's context window, mirroring the
 * provider-side rejection rule (`prompt + max_tokens > context_length`).
 *
 * The numerator rides the official `contextPressure` projection so it answers
 * for the NEXT request rather than the last one: `projectedTokens` is the
 * provider-reported prompt sample carried forward over the surface's signed
 * movement since (compaction included), with the bare sample as the fallback
 * for logs whose projection predates that field. Adding the configured
 * `maxTokens` output budget turns "how full is the context now" into "how
 * full will the next request be" — the figure the official pre-step pressure
 * check (context vs 80% of the window) deliberately does not include.
 */

/** The three guard states: nothing to show, about to overflow, already over. */
export type GuardLevel = 'ok' | 'warning' | 'overdue'

/** Inputs to the guard decision; all three come from the session's contextPressure projection plus config. */
export interface GuardInput {
  /** Current projected context tokens (projectedTokens ?? pressureTokens). */
  projectedTokens: number
  /** The routed model's advertised context window; absent until a route reports one. */
  contextWindow: number | undefined
  /** The output budget the next request reserves. */
  maxTokens: number
  /** The window fraction at which the guard turns on (clamped (0, 1] by config). */
  thresholdRatio: number
}

/** One guard reading: the level plus the occupancy figures behind it. */
export interface GuardReading {
  level: GuardLevel
  /** `(projectedTokens + maxTokens) / contextWindow`, rounded, clamped to 0–100. */
  percent: number
  /** `projectedTokens + maxTokens` — the budget the next request needs. */
  budgetTokens: number
  /** The routed model's advertised context window. */
  contextWindow: number
}

/**
 * Decide the guard level for one request budget.
 *
 * `overdue` means the next request's budget already exceeds the window, so the
 * provider rejects the main loop's requests from here on. The compaction
 * summarization call reserves only its own small output cap (8192 by default),
 * so a manual `/compact` can still run and is the required next step — click
 * it now rather than waiting for the next send to fail.
 *
 * @param input - the projection figures plus config.
 * @returns the reading, or null when either the window or the context is unknown.
 */
export function guardReading(input: GuardInput): GuardReading | null {
  const { contextWindow, projectedTokens, maxTokens } = input
  if (contextWindow === undefined || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return null
  }
  if (!Number.isFinite(projectedTokens) || projectedTokens < 0) return null
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return null
  const budgetTokens = projectedTokens + maxTokens
  const ratio = budgetTokens / contextWindow
  const level: GuardLevel = ratio >= 1
    ? 'overdue'
    : ratio >= input.thresholdRatio
      ? 'warning'
      : 'ok'
  return {
    level,
    percent: Math.min(100, Math.round(ratio * 100)),
    budgetTokens,
    contextWindow,
  }
}
