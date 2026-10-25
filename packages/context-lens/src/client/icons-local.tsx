/**
 * Package-owned icons for glyphs ui-primitives does not ship — the canvas /
 * message-tools supplement pattern; upstream glyphs come from the generated
 * icons.tsx (scripts/sync-icon-artwork.mts), which never touches this file.
 * The context-lens glyph is a stacked-list sheet with a probe dot — the
 * four-segment breakdown read at a glance.
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
