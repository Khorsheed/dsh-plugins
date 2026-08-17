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
 * The guard answers the question "would the NEXT request fit?" The provider
 * rejects a request when its prompt plus its output budget (`max_tokens`)
 * exceeds the model's context window, so the plugin adds the configured
 * `maxTokens` output budget to the current projected context and shows the
 * compact button once that sum crosses `thresholdRatio` of the window —
 * BEFORE the official 80%-of-context auto-compaction fires, while a manual
 * compaction (whose own summarization call must also fit) can still run.
 *
 * These two fields tune ONLY when the compact button appears. The official
 * compaction engine (compaction-basic) reads its own `thresholdRatio` /
 * `maxTokens` config and never touches this section — real compaction timing
 * is not affected by these knobs.
 */
export interface ContextGuardConfig {
  /**
   * Fraction of the model's context window at which context + maxTokens is
   * considered "about to overflow" (clamped to (0, 1]; default 0.8, matching
   * compaction-basic's default pressure threshold).
   */
  thresholdRatio: number
  /**
   * The output budget the next request reserves, in tokens (clamped to
   * >= 1; default 256000, the deepseek adapter's default output cap — the
   * reservation every MAIN loop request makes). The guard models this
   * main-request budget, not the compaction summarizer's: the summarizer
   * reserves only its own 8192-token cap, so it keeps fitting long after
   * the main request is rejected. Set this to your model's configured max
   * output — a larger cap makes the guard appear earlier, exactly at the
   * point where a real request would start being rejected.
   */
  maxTokens: number
}

/** Bounds of the deployment-tunable numbers (clamped in resolveConfig). */
const THRESHOLD_RATIO_MIN = 0.01
const THRESHOLD_RATIO_MAX = 1
const MAX_TOKENS_MIN = 1

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
    maxTokens: clamp(config?.maxTokens ?? 256_000, MAX_TOKENS_MIN, Number.MAX_SAFE_INTEGER),
  }
}
