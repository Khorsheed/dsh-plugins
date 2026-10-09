/**
 * The package's icons, inlined in the sidechat convention: the two host lines
 * share no icon export name, so the artwork here is pure SVG with no host
 * runtime identity, identical on every line. The request-inspector glyph is a
 * stacked-list sheet with a probe dot — the four-segment breakdown read at a
 * glance.
 *
 * @module @khorsheed/dsh-request-inspector/client
 */

/** Shared props for every product icon component (mirrors the upstream IconProps). */
export interface IconProps {
  /** Square edge in px; defaults to the glyph's own drawn size. */
  size?: number | undefined
  /** Extra class for layout placement; color rides currentColor. */
  className?: string | undefined
}

/** The request-inspector glyph: a stacked breakdown sheet. */
export const IconRequestInspectorOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.2}>
    <rect x="2.5" y="1.5" width="11" height="13" rx="2" stroke="currentColor" />
    <path d="M5 5.2H11" stroke="currentColor" />
    <path d="M5 8H11" stroke="currentColor" />
    <path d="M5 10.8H8.6" stroke="currentColor" />
    <circle cx="11.2" cy="11.2" r="1.7" fill="currentColor" stroke="none" />
  </svg>
)
