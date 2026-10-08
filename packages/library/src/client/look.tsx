/**
 * The library's visual identity pieces (M4): a project's color and glyph,
 * and a book's generated cover. A project's color rides the `--pc` custom
 * property (set by `data-color` in the stylesheet), so every surface under it
 * — its card, its header band, its books' covers and its path — inherits one
 * hue without passing it around.
 *
 * @module @khorsheed/dsh-library/client/look
 */
import type { ReactNode } from 'react'
import type { LibraryColor, LibraryIcon, LibraryProject } from '../types.ts'
import { TEMPLATE_LOOK } from '../types.ts'
import css from './LibraryPane.module.css'

/** A project's color, with the template default for projects made before M4. */
export function colorOf(project: Pick<LibraryProject, 'color' | 'template'>): LibraryColor {
  return project.color ?? TEMPLATE_LOOK[project.template].color
}

/** A project's icon, with the template default. */
export function iconOf(project: Pick<LibraryProject, 'icon' | 'template'>): LibraryIcon {
  return project.icon ?? TEMPLATE_LOOK[project.template].icon
}

/** The 24×24 strokes of each preset icon. */
const GLYPHS: Readonly<Record<LibraryIcon, ReactNode>> = {
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  brain: <><path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5 3 3 0 0 0 2 5v1a3 3 0 0 0 6 0V5a3 3 0 0 0-3-1z" /><path d="M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 5 3 3 0 0 1-2 5v1a3 3 0 0 1-6 0" /></>,
  book: <><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19V5" /></>,
  flask: <><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" /></>,
  atom: <><circle cx="12" cy="12" r="1.5" /><ellipse cx="12" cy="12" rx="9" ry="4" /><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)" /><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(120 12 12)" /></>,
  leaf: <><path d="M5 19c0-8 6-14 15-14 0 9-6 15-14 15" /><path d="M5 19 13 11" /></>,
  pen: <><path d="M4 20l4-1 11-11-3-3L5 16z" /><path d="M14 6l3 3" /></>,
  music: <><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>,
  scale: <><path d="M12 3v18M5 7h14M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z" /></>,
  chart: <><path d="M4 20V4M4 20h16" /><path d="M8 16v-4M12 16V8M16 16v-6" /></>,
  code: <><path d="M8 7l-5 5 5 5M16 7l5 5-5 5" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></>,
}

/** A project's glyph tile (white strokes on its color). */
export function ProjectGlyph({ icon, size = 34 }: { icon: LibraryIcon; size?: number }): ReactNode {
  return (
    <span className={css.glyph} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 24 24">{GLYPHS[icon]}</svg>
    </span>
  )
}

/** Just the glyph's strokes, for pickers. */
export function GlyphStrokes({ icon }: { icon: LibraryIcon }): ReactNode {
  return <svg viewBox="0 0 24 24" className={css.glyphStrokes} aria-hidden="true">{GLYPHS[icon]}</svg>
}

/**
 * A cover's abbreviation: the coach's, else derived — CJK titles keep their
 * first two characters plus any number (剑桥雅思 5 → 剑5), Latin titles their
 * capitalized initials plus any number (Principles of Neural Science → PNS).
 */
export function shortOf(book: { readonly title: string; readonly short?: string | undefined }): string {
  if (book.short !== undefined && book.short !== '') return book.short
  const number = /\d+/.exec(book.title)?.[0] ?? ''
  if (/[\p{Script=Han}]/u.test(book.title)) return `${book.title.replace(/[\s\d（(].*$/, '').slice(0, 1)}${number || book.title.slice(1, 2)}`
  const initials = book.title.split(/\s+/).filter(word => /^[A-Z]/.test(word)).map(word => word[0]).join('')
  return `${initials.slice(0, 4)}${number}`.slice(0, 5) || book.title.slice(0, 3)
}

/** A generated cover: the project's hue (shaded per shelf position), the abbreviation, the kind. */
export function Cover({ book, shade = 0, size = 'shelf', kindLabel }: {
  book: { readonly title: string; readonly short?: string | undefined; readonly edition?: string | undefined }
  shade?: number
  size?: 'shelf' | 'mini' | 'badge'
  kindLabel?: string | undefined
}): ReactNode {
  return (
    <span className={css.cover} data-size={size} data-shade={String(shade % 3)} aria-hidden={size !== 'shelf'}>
      {size !== 'mini' && (
        <span className={css.coverHead}>
          <span className={css.coverShort}>{shortOf(book)}</span>
          {size === 'shelf' && kindLabel !== undefined && <span className={css.coverKind}>{kindLabel}</span>}
        </span>
      )}
      {size === 'shelf' && <span className={css.coverTitle}>{book.edition === undefined ? book.title : `${book.title} · ${book.edition}`}</span>}
    </span>
  )
}

/** A circular progress ring in the project's color. */
export function Ring({ percent }: { percent: number }): ReactNode {
  return (
    <span className={css.ring} style={{ ['--pct' as string]: `${Math.max(0, Math.min(100, percent))}%` }} role="img" aria-label={`${percent}%`}>
      <span>{percent}%</span>
    </span>
  )
}
