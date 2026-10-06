/**
 * Package-owned icons matching the official outline-icon conventions (16×16
 * viewBox, `stroke="currentColor"` geometry) for the glyphs this package needs
 * — the same supplement pattern message-tools and canvas established
 * (icons-local.tsx), hand-authored rather than generated because several of
 * these glyphs have no upstream counterpart at all.
 *
 * @module @khorsheed/dsh-library/client
 */

/** Shared props for every product icon component (mirrors the upstream IconProps). */
export interface IconProps {
  /** Square edge in px; defaults to the glyph's own drawn size. */
  size?: number | undefined
  /** Extra class for layout placement; color rides currentColor. */
  className?: string | undefined
}

/** A book — the library's own glyph. */
export const IconBookOutlineMedium = ({ size = 14, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M2.5 12.5V3.2C2.5 2.5 3.1 2 3.8 2H13.5V11.5H4C3.2 11.5 2.5 12.2 2.5 13C2.5 13.8 3.2 14.5 4 14.5H13.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" transform="translate(0,-0.5)" />
  </svg>
)

/** A check mark — a done roadmap node. */
export const IconCheckOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.5}>
    <path d="M3.4 8.6 6.6 11.8 12.6 4.6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** A play triangle — the current roadmap node. */
export const IconPlayOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M5 3.2 12.4 8 5 12.8V3.2Z" stroke="currentColor" strokeLinejoin="round" />
  </svg>
)

/** A padlock — a locked roadmap node. */
export const IconLockOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <rect x="3.2" y="7" width="9.6" height="6.6" rx="1.4" stroke="currentColor" />
    <path d="M5.2 7V5.2C5.2 3.6 6.4 2.4 8 2.4C9.6 2.4 10.8 3.6 10.8 5.2V7" stroke="currentColor" />
  </svg>
)

/** A plus — new project / add book. */
export const IconPlusOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M8 2V14M2 8H14" stroke="currentColor" strokeLinecap="round" />
  </svg>
)

/** A left chevron — back. */
export const IconChevronLeftOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M10 3 5.4 8 10 13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** A circular arrow — regenerate the roadmap. */
export const IconRefreshOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M13.5 8C13.5 11.04 11.04 13.5 8 13.5C4.96 13.5 2.5 11.04 2.5 8C2.5 4.96 4.96 2.5 8 2.5C10.05 2.5 11.85 3.55 12.85 5.1M13.5 2V5.2H10.3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** A magnifier — the search box. */
export const IconSearchOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <circle cx="7.2" cy="7.2" r="4.7" stroke="currentColor" />
    <path d="M10.6 10.6 13.5 13.5" stroke="currentColor" strokeLinecap="round" />
  </svg>
)

/** An upload arrow — the drop zone. */
export const IconUploadOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M8 10.5V2.5M4.8 5.5 8 2.3 11.2 5.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2.5 11V13C2.5 13.55 2.95 14 3.5 14H12.5C13.05 14 13.5 13.55 13.5 13V11" stroke="currentColor" strokeLinecap="round" />
  </svg>
)

/** A camera — photo provenance on a vocab entry. */
export const IconCameraOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M2 5.2C2 4.65 2.45 4.2 3 4.2H4.8L5.7 2.6H10.3L11.2 4.2H13C13.55 4.2 14 4.65 14 5.2V12C14 12.55 13.55 13 13 13H3C2.45 13 2 12.55 2 12V5.2Z" stroke="currentColor" strokeLinejoin="round" />
    <circle cx="8" cy="8.6" r="2.5" stroke="currentColor" />
  </svg>
)

/** A trash can — delete. */
export const IconTrashOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M1.8 3.4H14.2" stroke="currentColor" strokeLinecap="round" />
    <path d="M5.4 3.4V2.3C5.4 1.85 5.75 1.5 6.2 1.5H9.8C10.25 1.5 10.6 1.85 10.6 2.3V3.4" stroke="currentColor" />
    <path d="M3 3.4 3.6 12.9C3.65 13.55 4.2 14 4.85 14H11.15C11.8 14 12.35 13.55 12.4 12.9L13 3.4" stroke="currentColor" strokeLinejoin="round" />
    <path d="M6.4 6.4V11.2M9.6 6.4V11.2" stroke="currentColor" strokeLinecap="round" />
  </svg>
)

/** Spark cards — the vocab book. */
export const IconCardsOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <rect x="4.4" y="4.4" width="9.2" height="9.2" rx="1.4" stroke="currentColor" />
    <path d="M11.6 4.4V3.6C11.6 2.85 11.05 2.3 10.3 2.3H3.6C2.85 2.3 2.3 2.85 2.3 3.6V10.3C2.3 11.05 2.85 11.6 3.6 11.6H4.4" stroke="currentColor" />
  </svg>
)
