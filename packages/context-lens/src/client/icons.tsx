/**
 * The package's icons, inlined in the sidechat convention: the two host lines
 * share no icon export name, so the artwork here is pure SVG with no host
 * runtime identity, identical on every line. The context-lens glyph is a
 * stacked-list sheet with a probe dot — the four-segment breakdown read at a
 * glance.
 *
 * @module @khorsheed/dsh-context-lens/client
 */

/** Shared props for every product icon component (mirrors the upstream IconProps). */
export interface IconProps {
  /** Square edge in px; defaults to the glyph's own drawn size. */
  size?: number | undefined
  /** Extra class for layout placement; color rides currentColor. */
  className?: string | undefined
}

/** The context-lens glyph: a stacked breakdown sheet. */
export const IconRequestInspectorOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.2}>
    <rect x="2.5" y="1.5" width="11" height="13" rx="2" stroke="currentColor" />
    <path d="M5 5.2H11" stroke="currentColor" />
    <path d="M5 8H11" stroke="currentColor" />
    <path d="M5 10.8H8.6" stroke="currentColor" />
    <circle cx="11.2" cy="11.2" r="1.7" fill="currentColor" stroke="none" />
  </svg>
)

/** The turn switcher's affordance chevron. */
export const IconChevronDownOutlineMedium = ({ size = 14, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6" stroke="currentColor" />
  </svg>
)

/** The 定位到最新 turn glyph: an arrow landing on the bottom line. */
export const IconArrowDownToLineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M8 2.5V10.5M8 10.5L4.5 7M8 10.5L11.5 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 13.5H13" stroke="currentColor" strokeLinecap="round" />
  </svg>
)
