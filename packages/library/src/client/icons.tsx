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

/** An info ⓘ — an on-demand hint beside a section title. */
export const IconInfoOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <circle cx="8" cy="8" r="6.2" stroke="currentColor" />
    <path d="M8 7.2V11.4" stroke="currentColor" strokeLinecap="round" />
    <circle cx="8" cy="4.9" r="0.55" fill="currentColor" stroke="none" />
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

/** A sparkle — the CTA card and quiz-created events. */
export const IconSparkleOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M8 2 9.5 6.5 14 8 9.5 9.5 8 14 6.5 9.5 2 8 6.5 6.5Z" stroke="currentColor" strokeLinejoin="round" />
  </svg>
)

/** Spark cards — the vocab book. */
export const IconCardsOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <rect x="4.4" y="4.4" width="9.2" height="9.2" rx="1.4" stroke="currentColor" />
    <path d="M11.6 4.4V3.6C11.6 2.85 11.05 2.3 10.3 2.3H3.6C2.85 2.3 2.3 2.85 2.3 3.6V10.3C2.3 11.05 2.85 11.6 3.6 11.6H4.4" stroke="currentColor" />
  </svg>
)

export const IconChevronDownOutlineMedium = ({ size = 12, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** A pencil — editing a project. */
export const IconPenOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M2.5 13.5 3.2 10.6 10.8 3a1.4 1.4 0 0 1 2 0l.2.2a1.4 1.4 0 0 1 0 2L5.4 12.8 2.5 13.5ZM9.6 4.2l2.2 2.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** A chain link — the add-link gesture (and a shelf resource's fallback glyph). */
export const IconLinkOutlineMedium = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1.3}>
    <path d="M6.6 9.4 9.4 6.6" stroke="currentColor" strokeLinecap="round" />
    <path d="M7.7 4.6 10 2.3C11.1 1.2 12.9 1.2 14 2.3 15.1 3.4 15.1 5.2 14 6.3L11.7 8.6" stroke="currentColor" strokeLinecap="round" />
    <path d="M8.3 11.4 6 13.7C4.9 14.8 3.1 14.8 2 13.7 0.9 12.6 0.9 10.8 2 9.7L4.3 7.4" stroke="currentColor" strokeLinecap="round" />
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
