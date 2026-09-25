/**
 * Package-owned icons matching the official outline-icon conventions (16×16
 * viewBox, `fill="currentColor"` path geometry) for glyphs ui-primitives
 * does not ship.
 */

/** Props of one package-owned icon. */
export interface LocalIconProps {
  /** Rendered edge length in px (icons are authored at 16). */
  size?: number
  /** Optional composed class. */
  className?: string
}

/**
 * Undo arrow (withdraw/restore), rotate-ccw style: a near-full circle arc
 * (~290°, opening at the top) with a corner arrowhead at its left end
 * pointing the counterclockwise direction. ui-primitives ships no undo/revert
 * glyph, and its refresh glyph carries reload semantics, so this package
 * draws its own.
 * @param props - size and className.
 * @returns the icon element.
 */
export const IconUndoOutlineMedium = ({ size = 16, className }: LocalIconProps) => (
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
