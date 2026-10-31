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
  /** External-CLI ratios by harness name (`kimi`, `codex`, …); absent = follow {@link thresholdRatio}. */
  harnessThresholds: Readonly<Record<string, number>>
  /** Per-member ratios by member session id; the name and harness label the card's list. */
  memberThresholds: Readonly<Record<string, MemberThreshold>>
}

/** One member's own reminder ratio. */
export interface MemberThreshold {
  readonly ratio: number
  readonly name?: string
  readonly harness?: string
}

/** Bounds of the deployment-tunable number (clamped in resolveConfig). */
const THRESHOLD_RATIO_MIN = 0.01
const THRESHOLD_RATIO_MAX = 1

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Unwrap one maybe-Volatile config field. rc.1 resolves volatile-marked
 * Config fields into live references (`{ get() }`); 0.1.5 passes the plain
 * value. The schema's volatile marker is probed per line (see
 * ../settings.ts), so BOTH shapes arrive depending on the host line.
 */
function unwrapVolatile<T>(value: T | { get(): T } | undefined): T | undefined {
  if (value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    return (value as { get(): T }).get()
  }
  return value as T | undefined
}

/**
 * Normalize the entry config into the full {@link ContextGuardConfig}: every
 * omitted field takes its documented default and every numeric field is
 * clamped into its legal range.
 * @param config - the unvalidated entry config, when the runner passes one.
 * @returns the effective guard behavior.
 */
export function resolveConfig(config: Partial<ContextGuardConfig> | undefined): ContextGuardConfig {
  const ratio = unwrapVolatile(config?.thresholdRatio)
  return {
    thresholdRatio: clamp(
      typeof ratio === 'number' ? ratio : 0.8,
      THRESHOLD_RATIO_MIN,
      THRESHOLD_RATIO_MAX,
    ),
    harnessThresholds: ratios(unwrapVolatile(config?.harnessThresholds)),
    memberThresholds: members(unwrapVolatile(config?.memberThresholds)),
  }
}

/** A ratio, clamped; undefined when it is not a number. */
function ratioOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, THRESHOLD_RATIO_MIN, THRESHOLD_RATIO_MAX) : undefined
}

function ratios(value: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (value === null || typeof value !== 'object') return out
  for (const [key, entry] of Object.entries(value)) {
    const ratio = ratioOf(entry)
    if (ratio !== undefined) out[key] = ratio
  }
  return out
}

function members(value: unknown): Record<string, MemberThreshold> {
  const out: Record<string, MemberThreshold> = {}
  if (value === null || typeof value !== 'object') return out
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || typeof entry !== 'object') continue
    const { ratio, name, harness } = entry as Record<string, unknown>
    const clamped = ratioOf(ratio)
    if (clamped === undefined) continue
    out[key] = { ratio: clamped, ...typeof name === 'string' ? { name } : {}, ...typeof harness === 'string' ? { harness } : {} }
  }
  return out
}

/**
 * A CLI member's effective reminder ratio: its own, else its CLI's, else the
 * global one.
 * @param config - the resolved section.
 * @param member - the member session id and its harness.
 * @returns the ratio and which layer it came from.
 */
export function memberThresholdOf(config: ContextGuardConfig, member: { readonly childSessionId: string; readonly harness?: string | undefined }): { ratio: number; from: 'member' | 'harness' | 'global' } {
  const own = config.memberThresholds[member.childSessionId]
  if (own !== undefined) return { ratio: own.ratio, from: 'member' }
  const harness = member.harness === undefined ? undefined : config.harnessThresholds[member.harness]
  if (harness !== undefined) return { ratio: harness, from: 'harness' }
  return { ratio: config.thresholdRatio, from: 'global' }
}
