/**
 * The panel type tokens: one custom property per role, always read with the
 * desktop value as its fallback.
 *
 * Nothing in this kit DEFINES these properties. A panel without
 * `@khorsheed/dsh-mobile` reads the fallbacks below and looks exactly as it
 * did; the mobile package raises them under `html[data-dsh-mobile]` on touch
 * screens. Plugins therefore never depend on mobile, and a font-size tune is
 * one edit in mobile's stylesheet rather than one per plugin.
 *
 * Layout density is a separate axis: it follows the panel's own width through
 * the `dsh-panel` container (see {@link PANEL_COMPACT_MAX}), mobile or not.
 *
 * @module @khorsheed/dsh-client-ui-panel-kit/client
 */

/** Panel width (px, inclusive) at or below which the compact layout applies. */
export const PANEL_COMPACT_MAX = 560

/** The container name {@link PanelRoot} declares, for `@container dsh-panel (…)` rules. */
export const PANEL_CONTAINER = 'dsh-panel'

/** Custom property name per role, with its desktop default. */
export const PANEL_TOKENS = {
  /** Panel title, card title, file name (the component sets weight 600). */
  title: { name: '--dsh-panel-text-title', fallback: '14px' },
  /** List rows, body text, button labels. */
  body: { name: '--dsh-panel-text-body', fallback: '13px' },
  /** Time, counts, paths, word totals. */
  meta: { name: '--dsh-panel-text-meta', fallback: '12px' },
  /** Long-form reading areas (markdown preview, article body). */
  reading: { name: '--dsh-panel-text-reading', fallback: '14px' },
  /** Line height of the reading area. */
  readingLineHeight: { name: '--dsh-panel-reading-line-height', fallback: '1.65' },
} as const

/** One of the token roles in {@link PANEL_TOKENS}. */
export type PanelTokenRole = keyof typeof PANEL_TOKENS

/**
 * The `var()` expression for a role, fallback included — the only way a
 * panel should spell these sizes, in inline styles and CSS alike.
 * @param role - the token role.
 * @returns e.g. `var(--dsh-panel-text-body, 13px)`.
 */
export function panelVar(role: PanelTokenRole): string {
  const token = PANEL_TOKENS[role]
  return `var(${token.name}, ${token.fallback})`
}
