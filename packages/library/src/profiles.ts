/**
 * Subject profiles — what varies by a project's template, in one place, read
 * by the service, the per-turn coach context and the sidebar alike. Plain
 * data: the sidebar maps `fill` onto its judge (judge.ts), the service maps
 * `markKind` onto the cards it creates.
 *
 * A new subject is a new profile; a subject that needs its own UI can ship as
 * a companion package providing one (proposal 2026-10-19-library-point-mastery).
 *
 * @module @khorsheed/dsh-library/profiles
 */
import type { LibraryCardKind, LibraryTemplate } from './types.ts'

/** What a template changes. */
export interface LibraryProfile {
  readonly template: LibraryTemplate
  /** What a photographed mark (and a single-word miss) becomes. */
  readonly markKind: LibraryCardKind
  /** Whether knowledge points are the mastery unit (a coach note lands on a point; misses wait for 订正). */
  readonly pointsDriven: boolean
  /** How a fill-in is judged: by text or value with math folding, or by spelling (UK/US, plurals). */
  readonly fill: 'math' | 'spelling'
  /** Whether answers preview and typeset math. */
  readonly math: boolean
  /** One line for the coach's per-turn context. */
  readonly coachHint: string
}

const SUBJECT: LibraryProfile = {
  template: 'subject',
  markKind: 'concept',
  pointsDriven: true,
  fill: 'math',
  math: true,
  coachHint: 'Quiz the weak and untested points first, then the practicing ones; every question names its point; math in $…$; a fill key is a value (1/2), several blanks comma-separated.',
}

/** Every template's profile; custom follows the subject profile. */
export const LIBRARY_PROFILES: Readonly<Record<LibraryTemplate, LibraryProfile>> = {
  subject: SUBJECT,
  custom: { ...SUBJECT, template: 'custom' },
  language: {
    template: 'language',
    markKind: 'word',
    pointsDriven: false,
    fill: 'spelling',
    math: false,
    coachHint: 'The learner\'s marked words first (meaning in context, collocation, spelling); a word they miss becomes a card.',
  },
}

/** A template's profile (an unknown template reads as subject). */
export function profileOf(template: LibraryTemplate | undefined): LibraryProfile {
  return (template === undefined ? undefined : LIBRARY_PROFILES[template]) ?? SUBJECT
}
