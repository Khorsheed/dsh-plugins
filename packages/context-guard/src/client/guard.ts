/**
 * Pure guard decision math: whether the next request's prompt-plus-output
 * budget is about to overflow the model's context window, mirroring the
 * provider-side rejection rule (`prompt + max_tokens > context_length`).
 *
 * The numerator rides the official `contextPressure` projection so it answers
 * for the NEXT request rather than the last one: `projectedTokens` is the
 * provider-reported prompt sample carried forward over the surface's signed
 * movement since (compaction included), with the bare sample as the fallback
 * for logs whose projection predates that field. The occupancy is the SAME
 * number the composer's context ring shows — the guard is a reminder on top
 * of that ring, not a second figure.
 */

/** The three guard states: nothing to show, about to overflow, already over. */
export type GuardLevel = 'ok' | 'warning' | 'overdue'

/** Inputs to the guard decision; both come from the session's contextPressure projection plus config. */
export interface GuardInput {
  /** Current projected context tokens (projectedTokens ?? pressureTokens). */
  projectedTokens: number
  /** The routed model's advertised context window; absent until a route reports one. */
  contextWindow: number | undefined
  /** The occupancy fraction at which the guard turns on (clamped (0, 1] by config). */
  thresholdRatio: number
}

/** One guard reading: the level plus the occupancy figure behind it. */
export interface GuardReading {
  level: GuardLevel
  /** `projectedTokens / contextWindow`, rounded, clamped to 0–100 — the same occupancy the context ring shows. */
  percent: number
  /** The routed model's advertised context window. */
  contextWindow: number
}

/**
 * Decide the guard level for one request budget.
 *
 * `overdue` means the occupancy already reached the whole window — the
 * provider will have rejected requests before this point, so it is a
 * defensive floor rather than a reachable state.
 *
 * @param input - the projection figures plus config.
 * @returns the reading, or null when either the window or the context is unknown.
 */
export function guardReading(input: GuardInput): GuardReading | null {
  const { contextWindow, projectedTokens, thresholdRatio } = input
  if (contextWindow === undefined || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return null
  }
  if (!Number.isFinite(projectedTokens) || projectedTokens < 0) return null
  const ratio = projectedTokens / contextWindow
  const level: GuardLevel = ratio >= 1
    ? 'overdue'
    : ratio >= thresholdRatio
      ? 'warning'
      : 'ok'
  return {
    level,
    percent: Math.min(100, Math.round(ratio * 100)),
    contextWindow,
  }
}
