/**
 * Browser-half configuration of the context-guard plugin. The runner hands
 * the plugin its validated entry config through the apply second parameter;
 * this module supplies the defaults and clamps, so a composition that does
 * not pass config still renders with the documented values and out-of-range
 * input lands inside the legal bounds.
 *
 * Once the settings surface is composed, these values arrive through the
 * `context-guard` settings section instead: the composition entry becomes the
 * section's base layer, and the settings card overrides it per field. The
 * fallback path here only serves deployments without the settings surface.
 */

/**
 * Deployment-tunable guard behavior.
 *
 * The guard is a reminder: when the context OCCUPANCY (the same
 * `projectedTokens / contextWindow` number the composer's context ring shows)
 * crosses `thresholdRatio`, the compact button appears. The official
 * compaction engine auto-compacts at 80% of the window on its own; the real
 * provider rejection wall is `window − maxTokens` (the request reserves
 * output), so a request can fail before occupancy alone reaches 80% — set a
 * lower threshold for an earlier reminder. The field tunes ONLY when the
 * button appears; real compaction timing (compaction-basic's own config) is
 * never affected.
 */
export interface ContextGuardConfig {
  /**
   * Context occupancy fraction at which the button appears (clamped to
   * (0, 1]; default 0.8, matching compaction-basic's default pressure
   * threshold).
   */
  thresholdRatio: number
}

/** Bounds of the deployment-tunable number (clamped in resolveConfig). */
const THRESHOLD_RATIO_MIN = 0.01
const THRESHOLD_RATIO_MAX = 1

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Normalize the entry config into the full {@link ContextGuardConfig}: every
 * omitted field takes its documented default and every numeric field is
 * clamped into its legal range.
 * @param config - the unvalidated entry config, when the runner passes one.
 * @returns the effective guard behavior.
 */
export function resolveConfig(config: Partial<ContextGuardConfig> | undefined): ContextGuardConfig {
  return {
    thresholdRatio: clamp(
      config?.thresholdRatio ?? 0.8,
      THRESHOLD_RATIO_MIN,
      THRESHOLD_RATIO_MAX,
    ),
  }
}
