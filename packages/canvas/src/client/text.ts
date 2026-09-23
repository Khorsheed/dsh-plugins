/**
 * Small shared helpers of the canvas client: the bits BoardView, CanvasTab and
 * CanvasDetailView each used to carry a private copy of. One copy, one place —
 * a fourth seat was never going to get a fourth `basenameOf`.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'

/**
 * The last path segment, separators from either platform (display only).
 * @param path - the absolute or relative path.
 * @returns its final segment.
 */
export function basenameOf(path: string): string {
  const parts = path.split(/[\\/]/).filter(segment => segment.length > 0)
  return parts[parts.length - 1] ?? path
}

/**
 * True when a promise rejection or remote failure carries a usable message.
 * @param error - whatever the `catch` caught.
 * @returns the message to show.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A relative instant in the locale's words, over the host's own bucketing
 * (`relativeTime`), so the switcher's list and the detail page's header never
 * disagree on how long ago "a moment" was.
 * @param at - epoch milliseconds.
 * @param t - the canvas namespace's translate.
 * @returns the localized "…ago" text.
 */
export function agoOf(at: number, t: TranslateNS<'canvas'>): string {
  const bucket = relativeTime(at, Date.now())
  if (bucket.unit === 'now') return t('time.now')
  if (bucket.unit === 'minutes') return t('time.minutes', { n: String(bucket.n) })
  if (bucket.unit === 'hours') return t('time.hours', { n: String(bucket.n) })
  if (bucket.unit === 'days') return t('time.days', { n: String(bucket.n) })
  if (bucket.unit === 'months') return t('time.months', { n: String(bucket.n) })
  return t('time.years', { n: String(bucket.n) })
}
