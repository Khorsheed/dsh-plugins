/**
 * The reader's notes: excerpts the reader kept from an article, the comment on
 * each, which conversations discussed the article, and the article text the
 * model reads when it does.
 *
 * Notes are what the reader OWNS, so they live on the host next to the rest of
 * the reader's state (the state-boundaries note, rule 1) — but in their own
 * file, `notes.json`, not inside `state.json`'s per-entry annotations. An
 * annotation is shaped around the body cache: `boundAnnotations` evicts by
 * body, `normalizeAnnotations` drops entries that carry nothing it knows. A
 * note must outlive every one of those (the excerpt carries its own text), and
 * keeping it out of that machinery is what makes "the body was evicted" and
 * "the note is gone" two unrelated events.
 *
 * The article text is a second, separate concern: the host never parses an
 * article (the browser half does), and a feed entry's text never reaches the
 * host at all. So the browser hands over a SNAPSHOT — the article's original
 * prose, one string per top-level block, numbered the way the pane numbers its
 * blocks — and the model reads that. Snapshots are capped and pruned; notes
 * are never pruned.
 *
 * Persistence mirrors `store.ts`: native fs at the deployment's state root,
 * atomic temp-file-and-rename writes, and an in-memory document when the root
 * is not writable. Writes are serialized through one promise chain, so two
 * gestures landing together never read the same version and lose one.
 *
 * @module @khorsheed/dsh-reader/notes
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveReaderStateRoot } from './store.ts'
import type {
  ReaderDiscussion, ReaderDiscussionInput, ReaderDiscussionPoint, ReaderEntryIdentity, ReaderEntryNotes, ReaderEntrySession,
  ReaderEntrySnapshot, ReaderNote, ReaderNoteInput, ReaderNoteOutcome, ReaderNoteReply, ReaderNotesDoc, ReaderSnapshotRecord,
} from './notes-types.ts'

export type * from './notes-types.ts'

/** The notes document's file name inside the state root. */
export const READER_NOTES_FILE_NAME = 'notes.json'

/** Where article snapshots live, inside the state root. */
export const READER_SNAPSHOTS_DIR = 'snapshots'

/** Most notes one article keeps (a cap against a runaway client, not a quota anyone reaches). */
export const MAX_NOTES_PER_ENTRY = 500

/** Most conversations one article remembers. */
export const MAX_SESSIONS_PER_ENTRY = 50

/** Snapshots kept for articles with no notes and no discussions (the most recent ones). */
export const MAX_LOOSE_SNAPSHOTS = 30

/** The cap on one snapshot's total characters (a long paper fits; a book does not). */
export const MAX_SNAPSHOT_CHARS = 400_000

/** Most lines under one note. */
export const MAX_REPLIES_PER_NOTE = 50

/** Most discussion notes one article keeps (the oldest go first). */
export const MAX_DISCUSSIONS_PER_ENTRY = 100

/** Most points in one discussion note. */
export const MAX_POINTS = 30

/** The cap on one reply or one discussion point. */
export const MAX_POINT_CHARS = 4_000

/** The cap on one excerpt. */
export const MAX_QUOTE_CHARS = 2_000

/** The cap on one comment. */
export const MAX_COMMENT_CHARS = 4_000

/** The empty document. */
export function emptyNotesDoc(): ReaderNotesDoc {
  return { version: 1, entries: {}, snapshots: {} }
}

/** A string field, trimmed and capped, or `undefined` when empty. */
function text(value: unknown, cap: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed.slice(0, cap)
}

/** A timestamp field, or the epoch when it is missing. */
function stamp(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : new Date(0).toISOString()
}

/** One note, when it carries an id and an excerpt. */
function normalizeNote(value: unknown): ReaderNote | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const id = text(record.id, 20)
  const anchor = record.anchor as Record<string, unknown> | undefined
  const quote = text(anchor?.quote, MAX_QUOTE_CHARS)
  if (id === undefined || quote === undefined) return undefined
  const block = typeof anchor?.block === 'number' && Number.isInteger(anchor.block) && anchor.block >= 0 ? anchor.block : 0
  const start = typeof anchor?.start === 'number' && Number.isInteger(anchor.start) && anchor.start >= 0 ? anchor.start : undefined
  const translated = text(anchor?.translated, MAX_QUOTE_CHARS)
  const comment = text(record.comment, MAX_COMMENT_CHARS)
  const replies = Array.isArray(record.replies)
    ? record.replies.map(normalizeReply).filter((reply): reply is ReaderNoteReply => reply !== undefined).slice(-MAX_REPLIES_PER_NOTE)
    : []
  return {
    id,
    anchor: { block, ...(start === undefined ? {} : { start }), quote, ...(translated === undefined ? {} : { translated }) },
    ...(comment === undefined ? {} : { comment }),
    ...(replies.length === 0 ? {} : { replies }),
    createdAt: stamp(record.createdAt),
    updatedAt: stamp(record.updatedAt ?? record.createdAt),
  }
}

/** One line under a note, when it has text. */
function normalizeReply(value: unknown): ReaderNoteReply | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const body = text(record.text, MAX_POINT_CHARS)
  if (body === undefined) return undefined
  const sessionId = text(record.sessionId, 200)
  return {
    by: record.by === 'agent' ? 'agent' : 'user',
    text: body,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(record.editedFrom === 'agent' ? { editedFrom: 'agent' as const } : {}),
    at: stamp(record.at),
  }
}

/** Bound a discussion's points: trimmed, capped, ¶ kept only when it is a positive integer. */
export function boundPoints(points: readonly unknown[]): ReaderDiscussionPoint[] {
  const out: ReaderDiscussionPoint[] = []
  for (const item of points) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const body = text(record.text, MAX_POINT_CHARS)
    if (body === undefined) continue
    const para = typeof record.para === 'number' && Number.isInteger(record.para) && record.para > 0 ? record.para : undefined
    out.push({ text: body, ...(para === undefined ? {} : { para }) })
    if (out.length >= MAX_POINTS) break
  }
  return out
}

/** One discussion note, when it has an id and at least one point. */
function normalizeDiscussion(value: unknown): ReaderDiscussion | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const id = text(record.id, 20)
  const points = Array.isArray(record.points) ? boundPoints(record.points) : []
  if (id === undefined || points.length === 0) return undefined
  const sessionId = text(record.sessionId, 200)
  const aside = text(record.aside, 300)
  return {
    id,
    kind: record.kind === 'check' ? 'check' : 'discussion',
    ...(sessionId === undefined ? {} : { sessionId }),
    title: text(record.title, 200) ?? '',
    points,
    ...(aside === undefined ? {} : { aside }),
    createdAt: stamp(record.createdAt),
  }
}

/** One article's notes, when it has an id and a title. */
function normalizeEntry(entryId: string, value: unknown): ReaderEntryNotes | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const title = text(record.title, 300) ?? entryId
  const notes = Array.isArray(record.notes)
    ? record.notes.map(normalizeNote).filter((note): note is ReaderNote => note !== undefined).slice(0, MAX_NOTES_PER_ENTRY)
    : []
  const sessions = Array.isArray(record.sessions)
    ? record.sessions.flatMap(item => {
      if (typeof item !== 'object' || item === null) return []
      const row = item as Record<string, unknown>
      const sessionId = text(row.sessionId, 200)
      if (sessionId === undefined) return []
      const sessionTitle = text(row.title, 200)
      return [{ sessionId, ...(sessionTitle === undefined ? {} : { title: sessionTitle }), lastAt: stamp(row.lastAt) }]
    }).slice(0, MAX_SESSIONS_PER_ENTRY)
    : []
  const discussions = Array.isArray(record.discussions)
    ? record.discussions.map(normalizeDiscussion).filter((item): item is ReaderDiscussion => item !== undefined).slice(0, MAX_DISCUSSIONS_PER_ENTRY)
    : []
  if (notes.length === 0 && sessions.length === 0 && discussions.length === 0) return undefined
  // The counters can only move forward: a hand-edited document that lowered
  // one would hand out an id that is already taken.
  const highest = notes.reduce((max, note) => Math.max(max, Number(/^n(\d+)$/.exec(note.id)?.[1] ?? 0)), 0)
  const stored = typeof record.nextNote === 'number' && Number.isInteger(record.nextNote) ? record.nextNote : 1
  const highestDiscussion = discussions.reduce((max, item) => Math.max(max, Number(/^d(\d+)$/.exec(item.id)?.[1] ?? 0)), 0)
  const storedDiscussion = typeof record.nextDiscussion === 'number' && Number.isInteger(record.nextDiscussion) ? record.nextDiscussion : 1
  const url = text(record.url, 2000)
  const source = text(record.source, 200)
  return {
    entryId,
    title,
    ...(url === undefined ? {} : { url }),
    ...(source === undefined ? {} : { source }),
    notes,
    sessions,
    ...(discussions.length === 0 ? {} : { discussions }),
    nextNote: Math.max(stored, highest + 1),
    nextDiscussion: Math.max(storedDiscussion, highestDiscussion + 1),
    updatedAt: stamp(record.updatedAt),
  }
}

/**
 * Coerce a parsed value into a notes document, dropping what it cannot read.
 *
 * @param value - the parsed file.
 * @returns the document.
 */
export function normalizeNotesDoc(value: unknown): ReaderNotesDoc {
  if (typeof value !== 'object' || value === null) return emptyNotesDoc()
  const record = value as Record<string, unknown>
  const entries: Record<string, ReaderEntryNotes> = {}
  if (typeof record.entries === 'object' && record.entries !== null) {
    for (const [entryId, entry] of Object.entries(record.entries as Record<string, unknown>)) {
      if (entryId.length === 0) continue
      const normalized = normalizeEntry(entryId, entry)
      if (normalized !== undefined) entries[entryId] = normalized
    }
  }
  const snapshots: Record<string, ReaderSnapshotRecord> = {}
  if (typeof record.snapshots === 'object' && record.snapshots !== null) {
    for (const [entryId, row] of Object.entries(record.snapshots as Record<string, unknown>)) {
      if (typeof row !== 'object' || row === null) continue
      const item = row as Record<string, unknown>
      const file = typeof item.file === 'string' && /^[0-9a-f]{32}\.json$/.test(item.file) ? item.file : undefined
      if (file === undefined) continue
      snapshots[entryId] = {
        file,
        chars: typeof item.chars === 'number' && Number.isFinite(item.chars) ? item.chars : 0,
        capturedAt: stamp(item.capturedAt),
      }
    }
  }
  return { version: 1, entries, snapshots }
}

/**
 * Bound a snapshot's paragraphs: whitespace collapsed, empty blocks kept as
 * empty strings (so ¶ numbers stay aligned with the pane's blocks), and the
 * whole capped — cut at a paragraph boundary, with the cut reported.
 *
 * @param paragraphs - the blocks' original text.
 * @returns the bounded paragraphs and whether anything was dropped.
 */
export function boundParagraphs(paragraphs: readonly unknown[]): { paragraphs: string[]; truncated: boolean } {
  const out: string[] = []
  let total = 0
  for (const raw of paragraphs) {
    const block = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : ''
    if (total + block.length > MAX_SNAPSHOT_CHARS) return { paragraphs: out, truncated: true }
    out.push(block)
    total += block.length
  }
  return { paragraphs: out, truncated: false }
}

/** The bare file name one entry's snapshot lives under. */
function snapshotFileName(entryId: string): string {
  return `${createHash('sha1').update(entryId).digest('hex').slice(0, 32)}.json`
}

/** A native fs failure's message, with its code. */
function errorMessage(error: unknown): string {
  const code = (error as { code?: string } | undefined)?.code
  const message = error instanceof Error ? error.message : String(error)
  return code === undefined ? message : `${code}: ${message}`
}

/** Write a file atomically (temp file, then rename). */
function writeAtomic(target: string, content: string): void {
  const temporary = `${target}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, content)
    renameSync(temporary, target)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw new Error(`reader: ${target} could not be written — ${errorMessage(error)}`)
  }
}

/** The entry row a write lands on: the existing one refreshed with the latest identity, or a new one. */
function entryFor(doc: ReaderNotesDoc, identity: ReaderEntryIdentity, now: string): ReaderEntryNotes {
  const existing = doc.entries[identity.entryId]
  const title = identity.title.trim().slice(0, 300) || existing?.title || identity.entryId
  const url = identity.url ?? existing?.url
  const source = identity.source ?? existing?.source
  return {
    entryId: identity.entryId,
    title,
    ...(url === undefined || url === '' ? {} : { url }),
    ...(source === undefined || source === '' ? {} : { source }),
    notes: existing?.notes ?? [],
    sessions: existing?.sessions ?? [],
    ...(existing?.discussions === undefined ? {} : { discussions: existing.discussions }),
    nextNote: existing?.nextNote ?? 1,
    nextDiscussion: existing?.nextDiscussion ?? 1,
    updatedAt: now,
  }
}

/** The document with one entry replaced (or removed, when it no longer carries anything). */
function withEntry(doc: ReaderNotesDoc, entry: ReaderEntryNotes): ReaderNotesDoc {
  const { [entry.entryId]: _previous, ...rest } = doc.entries
  return entry.notes.length === 0 && entry.sessions.length === 0 && (entry.discussions ?? []).length === 0
    ? { ...doc, entries: rest }
    : { ...doc, entries: { ...rest, [entry.entryId]: entry } }
}

/** The reader's notes store. */
export class ReaderNotesStore {
  private readonly root: string
  private readonly file: string
  private readonly snapshotsDir: string
  private unwritable: string | undefined
  /** The document of record when the root is not writable. */
  private memoryDoc: ReaderNotesDoc | undefined
  /** Snapshots kept in memory when the root is not writable. */
  private readonly memorySnapshots = new Map<string, ReaderEntrySnapshot>()
  /** The write queue: every mutation runs after the previous one settled. */
  private queue: Promise<unknown> = Promise.resolve()

  /**
   * @param config - the same state-root override the reader's main store takes.
   */
  constructor(config: { stateRoot?: string } = {}) {
    this.root = resolveReaderStateRoot(config.stateRoot)
    this.file = join(this.root, READER_NOTES_FILE_NAME)
    this.snapshotsDir = join(this.root, READER_SNAPSHOTS_DIR)
  }

  /** Whether the notes persist (false means memory-only, for this process). */
  get available(): boolean {
    if (this.unwritable !== undefined) return false
    try {
      mkdirSync(this.root, { recursive: true })
      return true
    } catch (error) {
      this.unwritable = `${this.root}: ${errorMessage(error)}`
      return false
    }
  }

  /** Read the document; a missing or unreadable file reads as empty. */
  read(): ReaderNotesDoc {
    if (!this.available) return this.memoryDoc ?? emptyNotesDoc()
    try {
      return normalizeNotesDoc(JSON.parse(readFileSync(this.file, 'utf8')))
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return emptyNotesDoc()
      // A notes file that does not parse is the reader's work: refuse to write
      // over it rather than start a fresh one on top.
      throw new Error(`reader: ${this.file} does not parse — fix or remove it by hand`)
    }
  }

  /** Run one read-modify-write after every earlier one. */
  private update<T>(mutate: (doc: ReaderNotesDoc) => { doc: ReaderNotesDoc; result: T }): Promise<T> {
    const run = this.queue.then(() => {
      const { doc, result } = mutate(this.read())
      if (this.available) {
        writeAtomic(this.file, `${JSON.stringify(doc, null, 2)}\n`)
      } else {
        this.memoryDoc = doc
      }
      return result
    })
    // A failed write must not wedge every later one behind it.
    this.queue = run.catch(() => undefined)
    return run
  }

  /** One article's notes and discussions, oldest note first. */
  entry(entryId: string): ReaderEntryNotes | undefined {
    return this.read().entries[entryId]
  }

  /** Every article that carries notes or discussions. */
  entries(): ReaderEntryNotes[] {
    return Object.values(this.read().entries)
  }

  /** How many notes each article carries (the wall's badge). */
  counts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const entry of Object.values(this.read().entries)) {
      if (entry.notes.length > 0) counts[entry.entryId] = entry.notes.length
    }
    return counts
  }

  /**
   * Keep one excerpt.
   *
   * @param input - the article, the excerpt and where it sits, and the comment.
   * @returns the new note, or why none was kept.
   */
  addNote(input: ReaderNoteInput): Promise<ReaderNote | 'empty' | 'full'> {
    const quote = input.quote.replace(/\s+/g, ' ').trim().slice(0, MAX_QUOTE_CHARS)
    if (quote.length === 0 || input.entryId.length === 0) return Promise.resolve('empty')
    return this.update<ReaderNote | 'full'>(doc => {
      const now = new Date().toISOString()
      const entry = entryFor(doc, input, now)
      if (entry.notes.length >= MAX_NOTES_PER_ENTRY) return { doc, result: 'full' as const }
      const translated = input.translated?.replace(/\s+/g, ' ').trim().slice(0, MAX_QUOTE_CHARS)
      const comment = input.comment?.trim().slice(0, MAX_COMMENT_CHARS)
      const note: ReaderNote = {
        id: `n${String(entry.nextNote)}`,
        anchor: {
          block: Number.isInteger(input.block) && input.block >= 0 ? input.block : 0,
          ...(input.start !== undefined && Number.isInteger(input.start) && input.start >= 0 ? { start: input.start } : {}),
          quote,
          ...(translated === undefined || translated === '' ? {} : { translated }),
        },
        ...(comment === undefined || comment === '' ? {} : { comment }),
        createdAt: now,
        updatedAt: now,
      }
      // Kept in article order, so the list reads the way the article does.
      const notes = [...entry.notes, note].sort((left, right) =>
        left.anchor.block - right.anchor.block || (left.anchor.start ?? 0) - (right.anchor.start ?? 0))
      return { doc: withEntry(doc, { ...entry, notes, nextNote: entry.nextNote + 1 }), result: note }
    })
  }

  /** Change (or clear) one note's comment. */
  updateNote(request: { entryId: string; noteId: string; comment: string }): Promise<ReaderNoteOutcome> {
    return this.update<ReaderNoteOutcome>(doc => {
      const entry = doc.entries[request.entryId]
      const note = entry?.notes.find(item => item.id === request.noteId)
      if (entry === undefined || note === undefined) return { doc, result: 'not-found' as const }
      const comment = request.comment.trim().slice(0, MAX_COMMENT_CHARS)
      const { comment: _old, ...rest } = note
      const next: ReaderNote = { ...rest, ...(comment === '' ? {} : { comment }), updatedAt: new Date().toISOString() }
      const notes = entry.notes.map(item => item.id === note.id ? next : item)
      return { doc: withEntry(doc, { ...entry, notes, updatedAt: next.updatedAt }), result: 'ok' as const }
    })
  }

  /** Delete one note (its id is not handed out again). */
  deleteNote(request: { entryId: string; noteId: string }): Promise<ReaderNoteOutcome> {
    return this.update<ReaderNoteOutcome>(doc => {
      const entry = doc.entries[request.entryId]
      if (entry === undefined || !entry.notes.some(item => item.id === request.noteId)) return { doc, result: 'not-found' as const }
      const notes = entry.notes.filter(item => item.id !== request.noteId)
      return { doc: withEntry(doc, { ...entry, notes, updatedAt: new Date().toISOString() }), result: 'ok' as const }
    })
  }

  /**
   * Add one line under a note: a conclusion (by the model, when the reader asked
   * for it) or the reader's own addition.
   *
   * @param request - the article, the note, the line and who wrote it.
   */
  addReply(request: { entryId: string; noteId: string; text: string; by: 'agent' | 'user'; sessionId?: string }): Promise<ReaderNoteOutcome> {
    const body = request.text.trim().slice(0, MAX_POINT_CHARS)
    if (body.length === 0) return Promise.resolve('empty')
    return this.update<ReaderNoteOutcome>(doc => {
      const entry = doc.entries[request.entryId]
      const note = entry?.notes.find(item => item.id === request.noteId)
      if (entry === undefined || note === undefined) return { doc, result: 'not-found' }
      const replies = note.replies ?? []
      if (replies.length >= MAX_REPLIES_PER_NOTE) return { doc, result: 'full' }
      const now = new Date().toISOString()
      const reply: ReaderNoteReply = {
        by: request.by,
        text: body,
        ...(request.sessionId === undefined || request.sessionId === '' ? {} : { sessionId: request.sessionId }),
        at: now,
      }
      const notes = entry.notes.map(item => item.id === note.id ? { ...item, replies: [...replies, reply], updatedAt: now } : item)
      return { doc: withEntry(doc, { ...entry, notes, updatedAt: now }), result: 'ok' }
    })
  }

  /**
   * Rewrite (or, with empty text, remove) one line under a note. A line the
   * model wrote becomes the reader's, marked as rewritten from the model's.
   */
  editReply(request: { entryId: string; noteId: string; index: number; text: string }): Promise<ReaderNoteOutcome> {
    return this.update<ReaderNoteOutcome>(doc => {
      const entry = doc.entries[request.entryId]
      const note = entry?.notes.find(item => item.id === request.noteId)
      const replies = note?.replies ?? []
      const old = replies[request.index]
      if (entry === undefined || note === undefined || old === undefined) return { doc, result: 'not-found' }
      const body = request.text.trim().slice(0, MAX_POINT_CHARS)
      const now = new Date().toISOString()
      const next: ReaderNoteReply[] = body === ''
        ? replies.filter((_, index) => index !== request.index)
        : replies.map((item, index) => index !== request.index ? item : {
          ...item,
          by: 'user' as const,
          text: body,
          ...(item.by === 'agent' || item.editedFrom === 'agent' ? { editedFrom: 'agent' as const } : {}),
          at: now,
        })
      const { replies: _old, ...rest } = note
      const notes = entry.notes.map(item => item.id === note.id ? { ...rest, ...(next.length === 0 ? {} : { replies: next }), updatedAt: now } : item)
      return { doc: withEntry(doc, { ...entry, notes, updatedAt: now }), result: 'ok' }
    })
  }

  /**
   * Keep one discussion note (newest first). The conversation it came from is
   * remembered on the article too.
   *
   * @param input - the article, the kind, the points.
   * @returns the new discussion note, or why none was kept.
   */
  addDiscussion(input: ReaderDiscussionInput): Promise<ReaderDiscussion | 'empty'> {
    const points = boundPoints(input.points)
    if (points.length === 0 || input.entryId.length === 0) return Promise.resolve('empty')
    return this.update<ReaderDiscussion>(doc => {
      const now = new Date().toISOString()
      const entry = entryFor(doc, input, now)
      const number = entry.nextDiscussion ?? 1
      const aside = input.aside?.trim().slice(0, 300)
      const sessionId = input.sessionId?.trim()
      const discussion: ReaderDiscussion = {
        id: `d${String(number)}`,
        kind: input.kind === 'check' ? 'check' : 'discussion',
        ...(sessionId === undefined || sessionId === '' ? {} : { sessionId }),
        title: input.heading?.trim().slice(0, 200) ?? '',
        points,
        ...(aside === undefined || aside === '' ? {} : { aside }),
        createdAt: now,
      }
      const sessions = sessionId === undefined || sessionId === ''
        ? entry.sessions
        : [
          entry.sessions.find(item => item.sessionId === sessionId) === undefined
            ? { sessionId, lastAt: now }
            : { ...entry.sessions.find(item => item.sessionId === sessionId)!, lastAt: now },
          ...entry.sessions.filter(item => item.sessionId !== sessionId),
        ].slice(0, MAX_SESSIONS_PER_ENTRY)
      const discussions = [discussion, ...(entry.discussions ?? [])].slice(0, MAX_DISCUSSIONS_PER_ENTRY)
      return { doc: withEntry(doc, { ...entry, sessions, discussions, nextDiscussion: number + 1 }), result: discussion }
    })
  }

  /** Delete one discussion note. */
  deleteDiscussion(request: { entryId: string; discussionId: string }): Promise<ReaderNoteOutcome> {
    return this.update<ReaderNoteOutcome>(doc => {
      const entry = doc.entries[request.entryId]
      if (entry === undefined || !(entry.discussions ?? []).some(item => item.id === request.discussionId)) return { doc, result: 'not-found' }
      const discussions = (entry.discussions ?? []).filter(item => item.id !== request.discussionId)
      return { doc: withEntry(doc, { ...entry, discussions, updatedAt: new Date().toISOString() }), result: 'ok' }
    })
  }

  /**
   * The article this conversation discussed most recently, when there is one —
   * where a model's write lands when it names no article.
   */
  sessionEntry(sessionId: string): string | undefined {
    let best: { entryId: string; at: string } | undefined
    for (const entry of Object.values(this.read().entries)) {
      const row = entry.sessions.find(item => item.sessionId === sessionId)
      if (row !== undefined && (best === undefined || row.lastAt > best.at)) best = { entryId: entry.entryId, at: row.lastAt }
    }
    return best?.entryId
  }

  /**
   * Remember that a conversation discussed this article (most recent first).
   *
   * @param request - the article and the conversation.
   */
  recordSession(request: ReaderEntryIdentity & { sessionId: string; sessionTitle?: string }): Promise<'ok' | 'empty'> {
    const sessionId = request.sessionId.trim()
    if (sessionId.length === 0 || request.entryId.length === 0) return Promise.resolve('empty')
    return this.update<'ok'>(doc => {
      const now = new Date().toISOString()
      const entry = entryFor(doc, request, now)
      const previous = entry.sessions.find(item => item.sessionId === sessionId)
      const title = request.sessionTitle?.trim().slice(0, 200) || previous?.title
      const session: ReaderEntrySession = { sessionId, ...(title === undefined || title === '' ? {} : { title }), lastAt: now }
      const sessions = [session, ...entry.sessions.filter(item => item.sessionId !== sessionId)].slice(0, MAX_SESSIONS_PER_ENTRY)
      return { doc: withEntry(doc, { ...entry, sessions }), result: 'ok' as const }
    })
  }

  /**
   * Keep the article's text for the model, replacing the previous snapshot.
   *
   * Loose snapshots (articles with no notes and no discussions) are pruned to
   * the {@link MAX_LOOSE_SNAPSHOTS} most recent; the rest are kept as long as
   * their article carries anything.
   *
   * @param request - the article and its blocks' original text.
   */
  snapshot(request: ReaderEntryIdentity & { paragraphs: readonly string[] }): Promise<'ok' | 'empty'> {
    const { paragraphs, truncated } = boundParagraphs(request.paragraphs)
    if (request.entryId.length === 0 || paragraphs.every(item => item.length === 0)) return Promise.resolve('empty')
    const snapshot: ReaderEntrySnapshot = {
      entryId: request.entryId,
      title: request.title.trim().slice(0, 300) || request.entryId,
      ...(request.url === undefined || request.url === '' ? {} : { url: request.url }),
      ...(request.source === undefined || request.source === '' ? {} : { source: request.source }),
      paragraphs,
      ...(truncated ? { truncated: true } : {}),
      capturedAt: new Date().toISOString(),
    }
    return this.update<'ok'>(doc => {
      if (!this.available) {
        this.memorySnapshots.set(snapshot.entryId, snapshot)
        return { doc, result: 'ok' as const }
      }
      mkdirSync(this.snapshotsDir, { recursive: true })
      const file = snapshotFileName(snapshot.entryId)
      writeAtomic(join(this.snapshotsDir, file), `${JSON.stringify(snapshot)}\n`)
      const chars = paragraphs.reduce((sum, item) => sum + item.length, 0)
      const snapshots: Record<string, ReaderSnapshotRecord> = {
        ...doc.snapshots,
        [snapshot.entryId]: { file, chars, capturedAt: snapshot.capturedAt },
      }
      const loose = Object.entries(snapshots)
        .filter(([entryId]) => doc.entries[entryId] === undefined)
        .sort((left, right) => right[1].capturedAt.localeCompare(left[1].capturedAt))
      for (const [entryId, row] of loose.slice(MAX_LOOSE_SNAPSHOTS)) {
        delete snapshots[entryId]
        rmSync(join(this.snapshotsDir, row.file), { force: true })
      }
      return { doc: { ...doc, snapshots }, result: 'ok' as const }
    })
  }

  /** The article's text as last captured, when there is one. */
  readSnapshot(entryId: string): ReaderEntrySnapshot | undefined {
    if (!this.available) return this.memorySnapshots.get(entryId)
    const row = this.read().snapshots[entryId]
    if (row === undefined) return undefined
    try {
      const parsed = JSON.parse(readFileSync(join(this.snapshotsDir, row.file), 'utf8')) as Record<string, unknown>
      if (!Array.isArray(parsed.paragraphs)) return undefined
      return {
        entryId,
        title: text(parsed.title, 300) ?? entryId,
        ...(typeof parsed.url === 'string' && parsed.url !== '' ? { url: parsed.url } : {}),
        ...(typeof parsed.source === 'string' && parsed.source !== '' ? { source: parsed.source } : {}),
        paragraphs: parsed.paragraphs.map(item => typeof item === 'string' ? item : ''),
        ...(parsed.truncated === true ? { truncated: true } : {}),
        capturedAt: stamp(parsed.capturedAt),
      }
    } catch {
      // A snapshot deleted by hand is no snapshot: the model is told the text is missing.
      return undefined
    }
  }

  /** Every article with a snapshot, newest capture first. */
  snapshotIds(): string[] {
    if (!this.available) return [...this.memorySnapshots.keys()].reverse()
    return Object.entries(this.read().snapshots)
      .sort((left, right) => right[1].capturedAt.localeCompare(left[1].capturedAt))
      .map(([entryId]) => entryId)
  }
}
