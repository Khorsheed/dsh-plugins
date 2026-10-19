/**
 * The notes' wire and storage shapes (see `notes.ts` for the store). Kept in a
 * module of their own so the Remote face, the browser half and the `./types`
 * subpath can name them without pulling in the store's `node:` imports.
 *
 * @module @khorsheed/dsh-reader/notes-types
 */

/**
 * Where a note sits in the article.
 *
 * `quote` is the source of truth: it is the ORIGINAL text, whichever view the
 * reader selected in. `block` (0-based top-level block, the reading position's
 * own unit) and `start` (characters into that block's original text) are
 * hints that make finding it again cheap; when a refetch changed the article
 * they may be wrong, and the quote is searched for instead.
 */
export interface ReaderNoteAnchor {
  readonly block: number
  readonly start?: number
  readonly quote: string
  /** The translated text, when the selection was made in the translated view. */
  readonly translated?: string
}

/** One note: an excerpt and, optionally, what the reader thought of it. */
export interface ReaderNote {
  /** `n1`, `n2`… per article, never reused — the model cites notes by it. */
  readonly id: string
  readonly anchor: ReaderNoteAnchor
  readonly comment?: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** One conversation that discussed the article. */
export interface ReaderEntrySession {
  readonly sessionId: string
  readonly title?: string
  readonly lastAt: string
}

/** Everything the reader authored about one article. */
export interface ReaderEntryNotes {
  readonly entryId: string
  readonly title: string
  readonly url?: string
  /** The source's display label (the feed's name, or the site). */
  readonly source?: string
  readonly notes: readonly ReaderNote[]
  readonly sessions: readonly ReaderEntrySession[]
  /** The next note number; ids are never reused, so a deleted n3 stays deleted. */
  readonly nextNote: number
  readonly updatedAt: string
}

/** One snapshot's index row (the text itself is a file of its own). */
export interface ReaderSnapshotRecord {
  readonly file: string
  readonly chars: number
  readonly capturedAt: string
}

/** The notes document. */
export interface ReaderNotesDoc {
  readonly version: 1
  readonly entries: Readonly<Record<string, ReaderEntryNotes>>
  readonly snapshots: Readonly<Record<string, ReaderSnapshotRecord>>
}

/** One article's text as the browser rendered it, for the model. */
export interface ReaderEntrySnapshot {
  readonly entryId: string
  readonly title: string
  readonly url?: string
  readonly source?: string
  /** One string per top-level block; ¶n is `paragraphs[n - 1]`. */
  readonly paragraphs: readonly string[]
  readonly truncated?: boolean
  readonly capturedAt: string
}

/** What a note write answers. */
export type ReaderNoteOutcome = 'ok' | 'not-found' | 'empty' | 'full'

/** The article identity every write carries, so a note never lands on a nameless entry. */
export interface ReaderEntryIdentity {
  readonly entryId: string
  readonly title: string
  readonly url?: string
  readonly source?: string
}

/** A note's input as the browser sends it, before bounding. */
export interface ReaderNoteInput extends ReaderEntryIdentity {
  readonly block: number
  readonly start?: number
  readonly quote: string
  readonly translated?: string
  readonly comment?: string
}
