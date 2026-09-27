/**
 * Package-owned icons matching the official outline-icon conventions (16×16
 * viewBox, `stroke="currentColor"` geometry) for glyphs ui-primitives does not
 * ship — the same supplement pattern message-tools established.
 *
 * @module @khorsheed/dsh-canvas/client
 */

/** Props of one package-owned icon. */
export interface LocalIconProps {
  /** Rendered edge length in px (icons are authored at 16). */
  size?: number
  /** Optional composed class. */
  className?: string
}

/**
 * Eraser: a tilted block with its corner lifted, plus the ground line it works
 * on. ui-primitives ships no eraser, and the pad's 橡皮 button carried words
 * only while its neighbours all had glyphs.
 * @param props - size and className.
 * @returns the icon element.
 */
export const IconEraserOutline16 = ({ size = 16, className }: LocalIconProps) => (
  <svg
    width={size}
    height={size}
    className={className}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.4}
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* The block, tilted: lifted corner top-right, working corner bottom-left. */}
    <path d="M6.9 2.9 L13.1 9.1 L8.6 13.6 L2.4 7.4 Z" />
    {/* The wear line across the block's middle. */}
    <path d="M4.6 9.6 L10.8 3.4" />
    {/* The ground the eraser stands on. */}
    <path d="M2 13.6 H14" />
  </svg>
)

/**
 * Undo arrow (撤一笔), rotate-ccw style: a near-full circle arc with a corner
 * arrowhead at its left end. ui-primitives' refresh glyph carries reload
 * semantics, so the pad draws its own — the same shape message-tools drew for
 * the same reason.
 * @param props - size and className.
 * @returns the icon element.
 */
export const IconUndoOutline16 = ({ size = 16, className }: LocalIconProps) => (
  <svg
    width={size}
    height={size}
    className={className}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.4}
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Arc: from the left end the long way around the bottom to ~11 o'clock. */}
    <path d="M2.2 8.7 A5.8 5.8 0 1 0 5.9 3.3 L2.6 6.6" />
    {/* Corner arrowhead at the top-left, pointing down the counterclockwise tangent. */}
    <path d="M2.6 2.4 V6.6 H6.2" fill="none" />
  </svg>
)

/**
 * Picture: a frame with a sun and a hill, the block editor's 「＋ 图片」.
 * ui-primitives ships no image glyph, and the add bar's pair should match.
 * @param props - size and className.
 * @returns the icon element.
 */
export const IconImageOutline16 = ({ size = 16, className }: LocalIconProps) => (
  <svg
    width={size}
    height={size}
    className={className}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.3}
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <circle cx="5.8" cy="6.3" r="1.1" />
    <path d="M2.5 11.5 L6.4 8.4 L9 10.4 L11 8.8 L13.6 11" />
  </svg>
)
