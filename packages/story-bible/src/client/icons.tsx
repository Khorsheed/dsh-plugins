/**
 * The surface's icons: pure inline SVG (stroke currentColor, no host runtime
 * identity — the same artifact shape canvas's sync-icon-artwork generator
 * emits), so the bundle reads identically on every host line.
 *
 * @module @khorsheed/dsh-story-bible/client
 */

/** Shared props for every icon component (mirrors the upstream IconProps). */
export interface IconProps {
  /** Square edge in px; defaults to the glyph's own drawn size. */
  size?: number | undefined
  /** Extra class for layout placement; color rides currentColor. */
  className?: string | undefined
}

export const IconBookOutlineMedium = ({ size = 20, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M2.5 3C2.5 2.44772 2.94772 2 3.5 2H13.5V11.5H4C3.17157 11.5 2.5 12.1716 2.5 13V3Z" stroke="currentColor" />
    <path d="M2.5 13C2.5 13.8284 3.17157 14.5 4 14.5H13.5V11.5" stroke="currentColor" />
    <path d="M5.5 5H10.5" stroke="currentColor" />
  </svg>
)

export const IconBulbOutlineMedium = ({ size = 20, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M8 1.5C5.51472 1.5 3.5 3.51472 3.5 6C3.5 7.65685 4.60715 9.0794 6.02539 9.71289C6.34277 9.85059 6.5 10.1602 6.5 10.5V11.5H9.5V10.5C9.5 10.1602 9.65723 9.85059 9.97461 9.71289C11.3929 9.0794 12.5 7.65685 12.5 6C12.5 3.51472 10.4853 1.5 8 1.5Z" stroke="currentColor" />
    <path d="M6.5 13.5H9.5" stroke="currentColor" />
  </svg>
)

export const IconCheckOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4" stroke="currentColor" />
  </svg>
)

export const IconCloseOutlineMedium = ({ size = 14, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M3.5 3.5L12.5 12.5M12.5 3.5L3.5 12.5" stroke="currentColor" />
  </svg>
)

export const IconChevronLeftOutlineMedium = ({ size = 14, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M10 4L5.29289 8.70711C4.90237 9.09763 4.90237 9.7308 5.29289 10.1213L10 14.8284" stroke="currentColor" />
  </svg>
)

export const IconChevronRightOutlineMedium = ({ size = 14, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M6 4L10.7071 8.70711C11.0976 9.09763 11.0976 9.7308 10.7071 10.1213L6 14.8284" stroke="currentColor" />
  </svg>
)

export const IconPlusOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M8 2.5V13.5M2.5 8H13.5" stroke="currentColor" />
  </svg>
)

export const IconPenOutlineMedium = ({ size = 14, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M9.5 3.5L12.5 6.5L5.5 13.5H2.5V10.5L9.5 3.5Z" stroke="currentColor" />
    <path d="M8.5 4.5L11.5 7.5" stroke="currentColor" />
  </svg>
)

export const IconExternalOutlineMedium = ({ size = 14, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M6.5 3.5H3.5V12.5H12.5V9.5" stroke="currentColor" />
    <path d="M9.5 2.5H13.5V6.5M13 3L7.5 8.5" stroke="currentColor" />
  </svg>
)

export const IconRefreshOutlineMedium = ({ size = 14, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M13.5 8C13.5 11.0376 11.0376 13.5 8 13.5C4.96243 13.5 2.5 11.0376 2.5 8C2.5 4.96243 4.96243 2.5 8 2.5C10.1 2.5 11.9 3.6 12.8 5.3" stroke="currentColor" />
    <path d="M13.2 2.5V5.5H10.2" stroke="currentColor" />
  </svg>
)
