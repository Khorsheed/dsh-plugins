/**
 * Package-owned icons for glyphs ui-primitives no longer ships, kept in the
 * official outline conventions (16×16 viewBox, `stroke="currentColor"`) — the
 * supplement pattern canvas and message-tools use. The generator
 * (scripts/sync-icon-artwork.mts) never touches this file.
 *
 * @module @khorsheed/dsh-room/client
 */

/** Props of one package-owned icon. */
export interface LocalIconProps {
  /** Rendered edge length in px (icons are authored at 16). */
  size?: number
  /** Optional composed class. */
  className?: string
}

/**
 * Request detail: a sheet with three lines and a dot, the speech's 「这一轮的请求明细」
 * control. ui-primitives dropped `IconRequestDetailOutlineMedium` in
 * 0.2.1-rc.1, so the artwork the speech already shipped (0.1.7-rc.1,
 * unchanged) lives here instead.
 * @param props - size and className.
 * @returns the icon element.
 */
export const IconRequestDetailOutline16 = ({ size = 16, className }: LocalIconProps) => (
  <svg
    width={size}
    height={size}
    className={className}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.2}
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect x="2.5" y="1.5" width="11" height="13" rx="2" />
    <path d="M5 5.2H11" />
    <path d="M5 8H11" />
    <path d="M5 10.8H8.6" />
    <circle cx="11.2" cy="11.2" r="1.7" fill="currentColor" stroke="none" />
  </svg>
)
