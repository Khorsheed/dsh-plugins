/**
 * The 剪辑 panel's inline SVG icons, in the host's icon idiom (16×16 grid,
 * currentColor stroke 1.3 — see the quote package's generated icons.tsx).
 * IconPen's artwork is the host ui-primitives list-pen glyph (copied from
 * packages/quote/src/client/icons.tsx); the rest are hand-drawn on the same
 * grid. Pure SVG, no host runtime identity, identical on every host line.
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

export const IconPlay = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M5 3.6v8.8c0 .6.7 1 1.2.7l6.8-4.4c.5-.3.5-1 0-1.3L6.2 2.9c-.5-.3-1.2 0-1.2.7Z" fill="currentColor" />
  </svg>
)

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

export const IconPen = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M4.9375 5.90295H11.0625" stroke="currentColor" />
    <path d="M4.9375 9.02991H8.27841" stroke="currentColor" />
    <path d="M12.5 1.32617C13.3039 1.32617 14 1.95171 14 2.77637V7.61328L13 8.68164V2.77637C13 2.55186 12.8007 2.32617 12.5 2.32617H3.5C3.1993 2.32617 3 2.55186 3 2.77637V13.2246C3.00044 13.4489 3.19963 13.6738 3.5 13.6738H8.32812L7.39258 14.6738H3.5C2.69637 14.6738 2.00042 14.0489 2 13.2246V2.77637C2 1.95171 2.69613 1.32617 3.5 1.32617H12.5Z" fill="currentColor" />
    <path d="M8.97212 14.3693C9.17511 14.5723 9.37811 14.7753 9.5811 14.9783C9.67012 14.8953 9.75914 14.8123 9.84815 14.7293C11.4505 13.2352 13.0528 11.7411 14.6551 10.247C14.7441 10.164 14.8331 10.081 14.9221 9.99803C14.5989 9.6748 14.2756 9.35157 13.9524 9.02834C13.8694 9.11736 13.7864 9.20637 13.7034 9.29539C12.2093 10.8977 10.7152 12.5 9.22113 14.1023C9.13813 14.1913 9.05513 14.2803 8.97212 14.3693Z" fill="currentColor" />
    <path d="M11.6323 13.7841C11.6323 14.0395 11.6323 14.295 11.6323 14.5504C11.6812 14.5523 11.7301 14.5543 11.779 14.5562C12.659 14.5913 13.539 14.6263 14.419 14.6614C14.4679 14.6633 14.5168 14.6653 14.5657 14.6672C14.5657 14.3339 14.5657 14.0006 14.5657 13.6672C14.5168 13.6692 14.4679 13.6711 14.419 13.6731C13.539 13.7081 12.659 13.7432 11.779 13.7783C11.7301 13.7802 11.6812 13.7821 11.6323 13.7841Z" fill="currentColor" />
  </svg>
)
