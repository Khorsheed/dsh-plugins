/**
 * Browser-half configuration of the message-timeline plugin. The runner hands
 * the plugin its validated entry config through the apply second parameter;
 * this module supplies the defaults and clamps, so a composition that does not
 * pass config still renders with the documented values and out-of-range input
 * lands inside the legal bounds.
 */

/** Deployment-tunable rail behavior. */
export interface TimelineConfig {
  /** Master switch: false hides the toggle and the rail entirely. */
  enabled: boolean
  /** Count steering messages (user text admitted mid-turn) as rows. */
  includeSteering: boolean
  /**
   * Preferred timeline panel width in px (clamped 120–640; long text
   * ellipsizes). The panel's right edge never crosses the message flow: the
   * width is capped by the scrollport's left gutter, so a narrow column
   * shrinks the panel automatically, and a gutter too small for
   * {@link PANEL_WIDTH_MIN} hides the panel entirely.
   */
  panelWidth: number
  /**
   * History pages to prefetch when the rail opens (50 events each); older
   * pages load on demand when the rail or the panel is scrolled to its top.
   */
  initialPages: number
}

/** Bounds of the deployment-tunable numbers (clamped in resolveConfig). */
export const PANEL_WIDTH_MIN = 120
export const PANEL_WIDTH_MAX = 640
const INITIAL_PAGES_MIN = 1
const INITIAL_PAGES_MAX = 20

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Normalize the entry config into the full {@link TimelineConfig}: every
 * omitted field takes its documented default and every numeric field is
 * clamped into its legal range.
 * @param config - the unvalidated entry config, when the runner passes one.
 * @returns the effective rail behavior.
 */
export function resolveConfig(config: Partial<TimelineConfig> | undefined): TimelineConfig {
  return {
    enabled: config?.enabled ?? true,
    includeSteering: config?.includeSteering ?? true,
    panelWidth: clamp(config?.panelWidth ?? 360, PANEL_WIDTH_MIN, PANEL_WIDTH_MAX),
    initialPages: clamp(config?.initialPages ?? 5, INITIAL_PAGES_MIN, INITIAL_PAGES_MAX),
  }
}
