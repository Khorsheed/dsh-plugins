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

/**
 * One line under a note: a conclusion a discussion reached, or the reader's
 * own addition. Written by the model only when the reader asks for it.
 */
export interface ReaderNoteReply {
  readonly by: 'agent' | 'user'
  readonly text: string
  /** The conversation it came from, so the reader can go back to it. */
  readonly sessionId?: string
  /** Set when the reader rewrote a line the model wrote. */
  readonly editedFrom?: 'agent'
  readonly at: string
}

/** One note: an excerpt and, optionally, what the reader thought of it. */
export interface ReaderNote {
  /** `n1`, `n2`… per article, never reused — the model cites notes by it. */
  readonly id: string
  readonly anchor: ReaderNoteAnchor
  readonly comment?: string
  /** Conclusions and additions, oldest first. */
  readonly replies?: readonly ReaderNoteReply[]
  readonly createdAt: string
  readonly updatedAt: string
}

/** One point of a discussion note, with the paragraph it points back to. */
export interface ReaderDiscussionPoint {
  readonly text: string
  /** ¶ number (1-based), when the point cites the article. */
  readonly para?: number
}

/**
 * A discussion note: what one conversation about the article came to.
 *
 * `check` is a 「让Agent考考我」 round — not an exam: no score, no retake; its
 * points are what the reader had not yet got right, each with the explanation.
 */
export interface ReaderDiscussion {
  /** `d1`, `d2`… per article, never reused. */
  readonly id: string
  readonly kind: 'discussion' | 'check'
  readonly sessionId?: string
  readonly title: string
  readonly points: readonly ReaderDiscussionPoint[]
  /** One line for what went fine (「其余 2 题讲到位了」). */
  readonly aside?: string
  readonly createdAt: string
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
  /** Discussion notes, newest first. */
  readonly discussions?: readonly ReaderDiscussion[]
  /** The next note number; ids are never reused, so a deleted n3 stays deleted. */
  readonly nextNote: number
  /** The next discussion number, never reused either. */
  readonly nextDiscussion?: number
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

/** A discussion note's input, before bounding. */
export interface ReaderDiscussionInput extends ReaderEntryIdentity {
  readonly kind: 'discussion' | 'check'
  readonly sessionId?: string
  /** The discussion note's own short title (`title` is the article's). */
  readonly heading?: string
  readonly points: readonly ReaderDiscussionPoint[]
  readonly aside?: string
}
