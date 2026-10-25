/**
 * Package-owned icons matching the official outline-icon conventions (16×16
 * viewBox, `stroke="currentColor"` geometry) for glyphs ui-primitives does not
 * ship — the supplement pattern message-tools and canvas established. Glyphs
 * upstream does ship come from the generated icons.tsx
 * (scripts/sync-icon-artwork.mts), which never touches this file.
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

/** A padlock — a locked roadmap node. */
export const IconLockOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <rect x="3.2" y="7" width="9.6" height="6.6" rx="1.4" stroke="currentColor" />
    <path d="M5.2 7V5.2C5.2 3.6 6.4 2.4 8 2.4C9.6 2.4 10.8 3.6 10.8 5.2V7" stroke="currentColor" />
  </svg>
)

/** A camera — photo provenance on a vocab entry. */
export const IconCameraOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M2 5.2C2 4.65 2.45 4.2 3 4.2H4.8L5.7 2.6H10.3L11.2 4.2H13C13.55 4.2 14 4.65 14 5.2V12C14 12.55 13.55 13 13 13H3C2.45 13 2 12.55 2 12V5.2Z" stroke="currentColor" strokeLinejoin="round" />
    <circle cx="8" cy="8.6" r="2.5" stroke="currentColor" />
  </svg>
)

/** Spark cards — the vocab book. */
export const IconCardsOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <rect x="4.4" y="4.4" width="9.2" height="9.2" rx="1.4" stroke="currentColor" />
    <path d="M11.6 4.4V3.6C11.6 2.85 11.05 2.3 10.3 2.3H3.6C2.85 2.3 2.3 2.85 2.3 3.6V10.3C2.3 11.05 2.85 11.6 3.6 11.6H4.4" stroke="currentColor" />
  </svg>
)

/** A pencil — editing a project. */
export const IconPenOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M2.5 13.5 3.2 10.6 10.8 3a1.4 1.4 0 0 1 2 0l.2.2a1.4 1.4 0 0 1 0 2L5.4 12.8 2.5 13.5ZM9.6 4.2l2.2 2.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** A page with lines — an article resource. */
export const IconArticleOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M4 1.8H9.6L12.5 4.7V14.2H4V1.8Z" stroke="currentColor" strokeLinejoin="round" />
    <path d="M9.4 2V4.9H12.4" stroke="currentColor" strokeLinejoin="round" />
    <path d="M6 8H10.5M6 10.6H10.5" stroke="currentColor" strokeLinecap="round" />
  </svg>
)

/** A box — a repo resource. */
export const IconRepoOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M2.3 5.2 8 2.3 13.7 5.2V10.8L8 13.7 2.3 10.8V5.2Z" stroke="currentColor" strokeLinejoin="round" />
    <path d="M2.3 5.2 8 8.1 13.7 5.2M8 8.1V13.7" stroke="currentColor" strokeLinejoin="round" />
  </svg>
)

/** A gear — a tool resource. */
export const IconToolOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <circle cx="8" cy="8" r="2.3" stroke="currentColor" />
    <path d="M8 2.3V4.3M8 11.7V13.7M2.3 8H4.3M11.7 8H13.7M3.9 3.9 5.3 5.3M10.7 10.7 12.1 12.1M12.1 3.9 10.7 5.3M5.3 10.7 3.9 12.1" stroke="currentColor" strokeLinecap="round" />
  </svg>
)

/** A graduation cap — a course resource. */
export const IconCourseOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M8 3.2 14.8 6.2 8 9.2 1.2 6.2 8 3.2Z" stroke="currentColor" strokeLinejoin="round" />
    <path d="M4.4 7.6V10.7C4.4 11.8 6 12.7 8 12.7 10 12.7 11.6 11.8 11.6 10.7V7.6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14.8 6.2V9.8" stroke="currentColor" strokeLinecap="round" />
  </svg>
)

/** A chip — a hardware resource. */
export const IconHardwareOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <rect x="4.4" y="4.4" width="7.2" height="7.2" rx="1.2" stroke="currentColor" />
    <path d="M6.4 2V4.4M9.6 2V4.4M6.4 11.6V14M9.6 11.6V14M2 6.4H4.4M2 9.6H4.4M11.6 6.4H14M11.6 9.6H14" stroke="currentColor" strokeLinecap="round" />
  </svg>
)

/** A speech bubble — ask the coach about a question. */
export const IconChatOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M3 3.5C3 2.9 3.4 2.5 4 2.5H12C12.6 2.5 13 2.9 13 3.5V9.5C13 10.1 12.6 10.5 12 10.5H7L4.5 13V10.5H4C3.4 10.5 3 10.1 3 9.5V3.5Z" stroke="currentColor" strokeLinejoin="round" />
  </svg>
)

/** A flag — report a broken question. */
export const IconFlagOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M4 14V2.5M4 3H12L10.5 6L12 9H4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
