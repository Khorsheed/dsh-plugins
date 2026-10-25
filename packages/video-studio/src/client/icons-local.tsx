/**
 * The 剪辑 panel's hand-drawn icons for glyphs ui-primitives does not ship, in
 * the host's icon idiom (16×16 grid, currentColor stroke 1.3). Play and the
 * pen come from the generated icons.tsx (scripts/sync-icon-artwork.mts), which
 * never touches this file. Pure SVG, identical on every host line.
 *
 * @module @khorsheed/dsh-video-studio/client
 */

/** Shared props for every product icon component (mirrors the upstream IconProps). */
export interface IconProps {
  /** Square edge in px; defaults to the glyph's own drawn size. */
  size?: number | undefined
  /** Extra class for layout placement; color rides currentColor. */
  className?: string | undefined
}

export const IconCut = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <circle cx="3.8" cy="3.8" r="2" stroke="currentColor" />
    <circle cx="3.8" cy="12.2" r="2" stroke="currentColor" />
    <path d="M5.5 5.2 13.2 12.6M5.5 10.8 13.2 3.4" stroke="currentColor" />
  </svg>
)

export const IconRestore = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M6.8 3.2 3.2 6.8l3.6 3.6" stroke="currentColor" />
    <path d="M3.8 6.8h5.7a3.75 3.75 0 0 1 0 7.5H7" stroke="currentColor" />
  </svg>
)
