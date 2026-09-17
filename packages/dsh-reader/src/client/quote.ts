/**
 * Ref-block formatting and the draft merge the conversation write needs.
 *
 * Both are pure and both are copies-with-intent from `@khorsheed/dsh-quote`:
 * this plugin must NOT depend on quote (a composition may omit it), and the
 * conversation input's `setDraft` REPLACES the whole draft, so every writer in
 * this ecosystem has to read-merge-write. Keeping the two functions here means
 * a change in quote cannot change this plugin's output, at the cost of a
 * deliberate, documented duplication.
 *
 * @module @khorsheed/dsh-reader/client/quote
 */
import type { ReaderSourceSummary } from '../types.ts'
import type { ReaderEntry } from './parse-rss.ts'

/** The provenance line every reader ref carries. */
export interface ReaderRefProvenance {
  readonly title: string
  readonly source: string
  /** Publication time, when the entry declares one. */
  readonly publishedAt?: string
  readonly author?: string
  readonly link?: string
}

/**
 * Build the provenance block for one entry.
 *
 * @param entry - the entry being quoted.
 * @param source - its source, for the label.
 * @returns the provenance.
 */
export function provenanceOf(
  entry: Pick<ReaderEntry, 'title' | 'author' | 'publishedAt' | 'link'>,
  source: Pick<ReaderSourceSummary, 'label'>,
): ReaderRefProvenance {
  return {
    title: entry.title,
    source: source.label,
    ...(entry.publishedAt !== undefined ? { publishedAt: entry.publishedAt } : {}),
    ...(entry.author !== undefined ? { author: entry.author } : {}),
    ...(entry.link !== undefined ? { link: entry.link } : {}),
  }
}

/**
 * Format a quote block: the quoted text, then an attribution line naming the
 * article, its source and its link.
 *
 * A blockquote rather than a bare paste because the reader is a citation tool:
 * what comes out of it has to stay traceable to the article it came from, even
 * after the conversation has moved on.
 *
 * @param text - the passage (or the whole entry's summary) being quoted.
 * @param provenance - where it came from.
 * @returns the markdown block to insert.
 */
export function formatReaderRef(text: string, provenance: ReaderRefProvenance): string {
  const trimmed = text.trim()
  const quoted = trimmed.length > 0 ? trimmed : provenance.title
  const quotedLines = quoted
    .split('\n')
    .map(line => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n')
  const attribution = [
    `— 《${provenance.title}》`,
    provenance.source,
    provenance.author,
    provenance.publishedAt === undefined ? undefined : formatDate(provenance.publishedAt),
  ].filter((part): part is string => part !== undefined && part.length > 0).join(' · ')
  const link = provenance.link === undefined ? '' : `\n${provenance.link}`
  return `${quotedLines}\n\n${attribution}${link}`
}

/**
 * Merge a block into the existing draft. The input's `setDraft` replaces the
 * whole value, so an appending writer has to do the read-merge itself; a
 * non-empty draft gets a blank line between the two.
 *
 * @param draft - the draft as it stands.
 * @param block - the block to append.
 * @returns the draft to write back.
 */
export function mergedDraft(draft: string, block: string): string {
  const trimmedDraft = draft.replace(/\s+$/, '')
  return trimmedDraft.length === 0 ? block : `${trimmedDraft}\n\n${block}`
}

/** A short absolute date for the attribution line. */
function formatDate(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  const year = parsed.getFullYear()
  const month = `${parsed.getMonth() + 1}`.padStart(2, '0')
  const day = `${parsed.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * A relative "when" for a card, from a timestamp and a reference instant. The
 * reference is a parameter so the formatting is testable without a clock.
 *
 * @param iso - the entry's publication timestamp.
 * @param now - the reference instant.
 * @returns a key plus its parameters, for the caller to translate.
 */
export type RelativeWhenKey = 'when.justNow' | 'when.minutes' | 'when.hours' | 'when.yesterday' | 'when.days'

/**
 * A relative "when" for a card, from a timestamp and a reference instant. The
 * reference is a parameter so the formatting is testable without a clock.
 *
 * @param iso - the entry's publication timestamp.
 * @param now - the reference instant.
 * @returns a dictionary key plus its parameters, for the caller to translate.
 */
export function relativeWhen(iso: string | undefined, now: Date): { key: RelativeWhenKey; count?: number } {
  if (iso === undefined) return { key: 'when.justNow' }
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return { key: 'when.justNow' }
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000)
  if (minutes < 1) return { key: 'when.justNow' }
  if (minutes < 60) return { key: 'when.minutes', count: minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { key: 'when.hours', count: hours }
  const days = Math.floor(hours / 24)
  if (days === 1) return { key: 'when.yesterday' }
  return { key: 'when.days', count: days }
}

/** Format an ISO timestamp as a stable absolute date (detail header, title attrs). */
export function absoluteDate(iso: string | undefined): string | undefined {
  if (iso === undefined) return undefined
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? undefined : formatDate(iso)
}
