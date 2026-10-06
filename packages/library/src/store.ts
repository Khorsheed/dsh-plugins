/**
 * The host-side state store: a version-guarded index (`state.json`) plus one
 * directory per project under `$DSH_HOME/state/dsh-library/`:
 *
 * ```
 * state.json                       # version-guarded index (project list)
 * projects/<projectId>/
 *   project.json                   # { id, name, domain?, createdAt }
 *   books/<bookId>/book.json       # metadata + toc; bodies externalized …
 *   books/<bookId>/chapters/<n>.html
 *   roadmap.json
 *   vocab.jsonl                    # append-only
 *   quizzes/<quizId>.json
 *   attempts.jsonl                 # append-only
 *   events.jsonl                   # append-only audit trail (book/roadmap/quiz/attempt/node)
 * ```
 *
 * The write discipline is the mission store's (the in-repo precedent for
 * shared JSON state): every mutation funnels through a per-scope lock → read →
 * modify → temp-write → atomic rename; the two JSONL ledgers are append-only
 * (an `O_APPEND` write under the same lock); ids are path segments and pass
 * the safe-alphabet check before they join a path. The lock is hand-rolled
 * (exclusive-create of a `.lock` file carrying `{pid, at}`; a dead or ancient
 * owner is reclaimed) — no dependency, replaceable without touching the data
 * model.
 *
 * **Why plain `node:fs` and not `ctx.fs`** — the reader's lesson: `ctx.fs` is
 * the session-fenced sandbox, and a workspace-write session refuses writes to
 * `$DSH_HOME/state`; this state belongs to the DEPLOYMENT.
 *
 * An unwritable root degrades reads to empty and refuses writes with
 * `storage-unavailable` — a composition must never fail for lack of a disk.
 *
 * @module @khorsheed/dsh-library/store
 */
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import {
  isLibraryId,
  libraryErrorMessage,
  LIBRARY_EVENT_TYPES,
  LIBRARY_STATE_VERSION,
  STATE_ROOT_SEGMENT,
  type LibraryAttempt,
  type LibraryBook,
  type LibraryEvent,
  type LibraryEventType,
  type LibraryProject,
  type LibraryQuiz,
  type LibraryRoadmap,
  type LibraryVocabEntry,
} from './types.ts'

/** A store failure that the service maps onto a refusal. */
export class LibraryStoreError extends Error {
  constructor(message: string, readonly kind: 'io' | 'corrupt' | 'unavailable') {
    super(message)
    this.name = 'LibraryStoreError'
  }
}

/* ------------------------------------------------------------------ ids */

/** Assert an id is usable as a path segment (no traversal, no separators). */
export function assertLibraryId(id: string, what: string): void {
  if (!isLibraryId(id)) {
    throw new LibraryStoreError(
      `library: ${what} ${JSON.stringify(id)} is not a usable id (allowed: letters, digits, '.', '_', '-')`,
      'io',
    )
  }
}

/** Mint a store id: a readable prefix plus time-and-random uniqueness. */
export function mintLibraryId(prefix: string): string {
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${stamp}${rand}`
}

/* ------------------------------------------------------------------ lock */

/** A held lock; `release` is idempotent. */
export interface LibraryLock {
  release(): void
}

const LOCK_TIMEOUT_MS = 10_000
const LOCK_STALE_MS = 60_000
/** A lock file younger than this but not yet parseable is a writer mid-create — wait, don't reclaim. */
const LOCK_GRACE_MS = 5_000

async function sleep(ms: number): Promise<void> {
  await new Promise(resolvePromise => { setTimeout(resolvePromise, ms) })
}

function lockIsStale(lockPath: string): boolean {
  let raw: string
  try {
    raw = readFileSync(lockPath, 'utf8')
  } catch {
    return false // vanished between checks, or unreadable — let the create retry decide
  }
  let pid: number | undefined
  let at: number | undefined
  try {
    const info = JSON.parse(raw) as { pid?: unknown; at?: unknown }
    if (typeof info.pid === 'number') pid = info.pid
    if (typeof info.at === 'number') at = info.at
  } catch {
    // Half-written lock (create and write are two syscalls): young → wait.
    try {
      return Date.now() - statSync(lockPath).mtimeMs > LOCK_GRACE_MS
    } catch {
      return false
    }
  }
  if (at !== undefined && Date.now() - at > LOCK_STALE_MS) return true
  if (pid === undefined) return false
  try {
    process.kill(pid, 0)
    return false // owner alive
  } catch {
    return true // ESRCH: owner is dead, the lock is orphaned
  }
}

/** Acquire the lock file, waiting out live owners and reclaiming stale ones. */
export async function acquireLibraryLock(lockPath: string): Promise<LibraryLock> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx')
      try {
        writeFileSync(fd, `${JSON.stringify({ pid: process.pid, at: Date.now() })}\n`)
      } finally {
        closeSync(fd)
      }
      let released = false
      return {
        release() {
          if (released) return
          released = true
          try {
            unlinkSync(lockPath)
          } catch {
            // Already reclaimed as stale — nothing to do.
          }
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'EEXIST') throw error
      if (lockIsStale(lockPath)) {
        try {
          unlinkSync(lockPath)
        } catch {
          // Someone else reclaimed it first — loop around.
        }
        continue
      }
      if (Date.now() > deadline) {
        throw new LibraryStoreError(`library: timed out waiting for the lock ${lockPath}`, 'io')
      }
      await sleep(15 + Math.random() * 35)
    }
  }
}

/* ------------------------------------------------------- the index shape */

/** `state.json`: the version-guarded index of projects. */
export interface LibraryIndexDoc {
  readonly version: number
  readonly projects: readonly LibraryProject[]
}

/** The empty index. */
export function emptyLibraryIndex(): LibraryIndexDoc {
  return { version: LIBRARY_STATE_VERSION, projects: [] }
}

/** Coerce a parsed value into an index, dropping unrecognizable rows. */
export function normalizeLibraryIndex(value: unknown): LibraryIndexDoc {
  if (typeof value !== 'object' || value === null) return emptyLibraryIndex()
  const record = value as Record<string, unknown>
  if (record.version !== LIBRARY_STATE_VERSION) return emptyLibraryIndex()
  const projects = Array.isArray(record.projects) ? record.projects : []
  const seen = new Set<string>()
  return {
    version: LIBRARY_STATE_VERSION,
    projects: projects.flatMap(item => {
      const project = normalizeProject(item)
      if (project === undefined || seen.has(project.id)) return []
      seen.add(project.id)
      return [project]
    }),
  }
}

/** One project, when it carries the fields that make it one. */
export function normalizeProject(value: unknown): LibraryProject | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' && isLibraryId(record.id) ? record.id : undefined
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (id === undefined || name === '') return undefined
  return {
    id,
    name: name.slice(0, 200),
    ...(typeof record.domain === 'string' && record.domain.trim() !== ''
      ? { domain: record.domain.trim().slice(0, 200) }
      : {}),
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString(),
  }
}

/** One book's metadata, when it carries the fields that make it one. */
export function normalizeBook(value: unknown): LibraryBook | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' && isLibraryId(record.id) ? record.id : undefined
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const format = record.format === 'epub' || record.format === 'md' ? record.format : undefined
  if (id === undefined || title === '' || format === undefined) return undefined
  const sourceRecord = (typeof record.source === 'object' && record.source !== null ? record.source : {}) as Record<string, unknown>
  const toc = Array.isArray(record.toc) ? record.toc : []
  return {
    id,
    title: title.slice(0, 300),
    ...(typeof record.author === 'string' && record.author.trim() !== '' ? { author: record.author.trim().slice(0, 200) } : {}),
    source: {
      kind: sourceRecord.kind === 'url' ? 'url' : 'upload',
      ref: typeof sourceRecord.ref === 'string' ? sourceRecord.ref.slice(0, 500) : '',
    },
    format,
    toc: toc.flatMap(item => {
      if (typeof item !== 'object' || item === null) return []
      const entry = item as Record<string, unknown>
      const n = typeof entry.n === 'number' && Number.isInteger(entry.n) && entry.n > 0 ? entry.n : undefined
      const entryTitle = typeof entry.title === 'string' ? entry.title.trim() : ''
      if (n === undefined) return []
      return [{
        n,
        title: entryTitle.slice(0, 300),
        chars: typeof entry.chars === 'number' && Number.isFinite(entry.chars) ? Math.max(0, Math.floor(entry.chars)) : 0,
      }]
    }),
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString(),
  }
}

/** One roadmap, when it parses; node-level validation lives in the service. */
export function normalizeRoadmap(value: unknown): LibraryRoadmap | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const bookId = typeof record.bookId === 'string' && isLibraryId(record.bookId) ? record.bookId : undefined
  if (bookId === undefined || !Array.isArray(record.nodes)) return undefined
  const nodes: LibraryRoadmap['nodes'][number][] = []
  for (const item of record.nodes as unknown[]) {
    if (typeof item !== 'object' || item === null) return undefined
    const node = item as Record<string, unknown>
    const id = typeof node.id === 'string' && isLibraryId(node.id) ? node.id : undefined
    const title = typeof node.title === 'string' ? node.title.trim() : ''
    const state = node.state === 'locked' || node.state === 'current' || node.state === 'done' ? node.state : undefined
    if (id === undefined || title === '' || state === undefined) return undefined
    const stats = (typeof node.quizStats === 'object' && node.quizStats !== null ? node.quizStats : undefined) as Record<string, unknown> | undefined
    // The kind predates stored roadmaps: a node without one is a quiz node
    // (v0.1.0 wrote only those), so the read-back defaults rather than
    // dropping the roadmap.
    const kind = node.kind === 'read' ? 'read' as const : 'quiz' as const
    nodes.push({
      id,
      title: title.slice(0, 300),
      kind,
      goals: Array.isArray(node.goals) ? (node.goals as unknown[]).filter((g): g is string => typeof g === 'string').map(g => g.slice(0, 300)) : [],
      dependsOn: Array.isArray(node.dependsOn) ? (node.dependsOn as unknown[]).filter((d): d is string => typeof d === 'string') : [],
      chapterRanges: Array.isArray(node.chapterRanges)
        ? (node.chapterRanges as unknown[]).flatMap(range => {
          if (typeof range !== 'object' || range === null) return []
          const r = range as Record<string, unknown>
          return typeof r.from === 'number' && typeof r.to === 'number' ? [{ from: r.from, to: r.to }] : []
        })
        : [],
      state,
      // A read node never holds a quiz ledger (the store normalizes it away,
      // the service refuses to write one).
      ...(stats === undefined || kind === 'read' ? {} : {
        quizStats: {
          attempts: typeof stats.attempts === 'number' ? stats.attempts : 0,
          ...(typeof stats.lastRatio === 'number' ? { lastRatio: stats.lastRatio } : {}),
          ...(typeof stats.bestRatio === 'number' ? { bestRatio: stats.bestRatio } : {}),
        },
      }),
    })
  }
  return {
    bookId,
    nodes,
    ...(typeof record.passRatio === 'number' && record.passRatio > 0 && record.passRatio <= 1 ? { passRatio: record.passRatio } : {}),
    generatedAt: typeof record.generatedAt === 'string' ? record.generatedAt : new Date(0).toISOString(),
  }
}

/** One vocab entry (one vocab.jsonl line), when it parses. */
export function normalizeVocabEntry(value: unknown): LibraryVocabEntry | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' && isLibraryId(record.id) ? record.id : undefined
  const kind = record.kind === 'vocab' || record.kind === 'keypoint' ? record.kind : undefined
  const term = typeof record.term === 'string' ? record.term.trim() : ''
  const note = typeof record.note === 'string' ? record.note.trim() : ''
  const chapterRef = typeof record.chapterRef === 'string' ? record.chapterRef.trim() : ''
  if (id === undefined || kind === undefined || term === '' || note === '' || chapterRef === '') return undefined
  const source = (typeof record.source === 'object' && record.source !== null ? record.source : {}) as Record<string, unknown>
  const mastery = (typeof record.mastery === 'object' && record.mastery !== null ? record.mastery : {}) as Record<string, unknown>
  const box = typeof mastery.box === 'number' && Number.isInteger(mastery.box) ? Math.min(Math.max(mastery.box, 0), 5) : 0
  return {
    id,
    kind,
    term: term.slice(0, 300),
    note: note.slice(0, 2000),
    ...(typeof record.context === 'string' && record.context.trim() !== '' ? { context: record.context.slice(0, 2000) } : {}),
    chapterRef: chapterRef.slice(0, 100),
    source: {
      kind: source.kind === 'photo' || source.kind === 'model' ? source.kind : 'manual',
      ...(typeof source.attachmentId === 'string' && source.attachmentId !== '' ? { attachmentId: source.attachmentId } : {}),
      ...(typeof source.mediaType === 'string' && source.mediaType !== '' ? { mediaType: source.mediaType } : {}),
      ...(typeof source.bytes === 'number' && Number.isFinite(source.bytes) ? { bytes: source.bytes } : {}),
      ...(typeof source.width === 'number' && Number.isFinite(source.width) ? { width: source.width } : {}),
      ...(typeof source.height === 'number' && Number.isFinite(source.height) ? { height: source.height } : {}),
    },
    mastery: {
      box,
      dueAt: typeof mastery.dueAt === 'string' ? mastery.dueAt : new Date(0).toISOString(),
      streak: typeof mastery.streak === 'number' && Number.isInteger(mastery.streak) ? Math.max(0, mastery.streak) : 0,
    },
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString(),
  }
}

/** One quiz, when it parses; the evidence gate itself lives in the service. */
export function normalizeQuiz(value: unknown): LibraryQuiz | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' && isLibraryId(record.id) ? record.id : undefined
  if (id === undefined || !Array.isArray(record.questions)) return undefined
  const scope = (typeof record.scope === 'object' && record.scope !== null ? record.scope : undefined) as Record<string, unknown> | undefined
  const bookId = typeof scope?.bookId === 'string' && isLibraryId(scope.bookId) ? scope.bookId : undefined
  if (bookId === undefined) return undefined
  const questions: LibraryQuiz['questions'][number][] = []
  for (const item of record.questions as unknown[]) {
    if (typeof item !== 'object' || item === null) return undefined
    const q = item as Record<string, unknown>
    const qid = typeof q.id === 'string' && q.id !== '' ? q.id : undefined
    const kind = q.kind === 'choice' || q.kind === 'fill' || q.kind === 'free' ? q.kind : undefined
    if (qid === undefined || kind === undefined || typeof q.prompt !== 'string') return undefined
    questions.push({
      id: qid,
      kind,
      prompt: q.prompt,
      ...(Array.isArray(q.options) ? { options: (q.options as unknown[]).filter((o): o is string => typeof o === 'string') } : {}),
      chapterRef: typeof q.chapterRef === 'string' ? q.chapterRef : '',
      evidence: typeof q.evidence === 'string' ? q.evidence : '',
      answer: typeof q.answer === 'string' ? q.answer : '',
      ...(Array.isArray(q.vocabIds) ? { vocabIds: (q.vocabIds as unknown[]).filter((v): v is string => typeof v === 'string') } : {}),
    })
  }
  return {
    id,
    scope: {
      bookId,
      ...(scope !== undefined && typeof scope.nodeId === 'string' && isLibraryId(scope.nodeId) ? { nodeId: scope.nodeId } : {}),
    },
    questions,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString(),
  }
}

/** One attempt (one attempts.jsonl line), when it parses. */
export function normalizeAttempt(value: unknown): LibraryAttempt | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' && isLibraryId(record.id) ? record.id : undefined
  const quizId = typeof record.quizId === 'string' && isLibraryId(record.quizId) ? record.quizId : undefined
  const ratio = typeof record.ratio === 'number' && Number.isFinite(record.ratio) ? record.ratio : undefined
  if (id === undefined || quizId === undefined || ratio === undefined || !Array.isArray(record.verdicts)) return undefined
  const verdicts: LibraryAttempt['verdicts'][number][] = []
  for (const item of record.verdicts as unknown[]) {
    if (typeof item !== 'object' || item === null) return undefined
    const v = item as Record<string, unknown>
    if (typeof v.task !== 'string' || typeof v.criterion !== 'string' || typeof v.pass !== 'boolean') return undefined
    if (typeof v.evidence !== 'string') return undefined
    verdicts.push({
      task: v.task,
      criterion: v.criterion,
      pass: v.pass,
      ...(typeof v.ratio === 'number' && Number.isFinite(v.ratio) ? { ratio: v.ratio } : {}),
      evidence: v.evidence,
      by: v.by === 'self' || v.by === 'user' ? v.by : 'llm',
    })
  }
  return {
    id,
    quizId,
    verdicts,
    ratio,
    at: typeof record.at === 'string' ? record.at : new Date(0).toISOString(),
  }
}

/** One audit event (one events.jsonl line), when it parses. */
export function normalizeEvent(value: unknown): LibraryEvent | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const type = typeof record.type === 'string' && (LIBRARY_EVENT_TYPES as readonly string[]).includes(record.type)
    ? record.type as LibraryEventType
    : undefined
  if (type === undefined) return undefined
  return {
    at: typeof record.at === 'string' ? record.at : new Date(0).toISOString(),
    type,
    ...(typeof record.id === 'string' && record.id !== '' ? { id: record.id } : {}),
    ...(typeof record.title === 'string' && record.title !== '' ? { title: record.title.slice(0, 300) } : {}),
    ...(typeof record.count === 'number' && Number.isFinite(record.count) ? { count: Math.floor(record.count) } : {}),
    ...(typeof record.count2 === 'number' && Number.isFinite(record.count2) ? { count2: Math.floor(record.count2) } : {}),
    ...(typeof record.ratio === 'number' && Number.isFinite(record.ratio) ? { ratio: record.ratio } : {}),
  }
}

/* ----------------------------------------------------------------- store */

/**
 * The native-fs library store. Reads never lock (a read observes one committed
 * revision, never a partial one — writes are atomic renames); writes serialize
 * on a per-project lock (`projects/<id>.lock`), the index on its own.
 */
export class LibraryStore {
  private readonly stateRoot: string
  /** Set once the root has proven unwritable; reads then degrade to empty. */
  private unwritable: string | undefined

  /**
   * @param config - optional state-root override (tests, deployments that keep
   *   state elsewhere).
   */
  constructor(config: { stateRoot?: string } = {}) {
    this.stateRoot = resolveLibraryStateRoot(config.stateRoot)
  }

  /** The state root (diagnostics and tests). */
  get root(): string {
    return this.stateRoot
  }

  /** Why persistence is unavailable, when it is. */
  get unavailableReason(): string | undefined {
    return this.unwritable
  }

  /**
   * Whether persistence is available — probed by creating the root, because a
   * read-only deployment is only knowable by trying.
   */
  get available(): boolean {
    if (this.unwritable !== undefined) return false
    try {
      mkdirSync(this.stateRoot, { recursive: true })
      return true
    } catch (error) {
      this.unwritable = `${this.stateRoot}: ${libraryErrorMessage(error)}`
      return false
    }
  }

  private get indexFile(): string {
    return join(this.stateRoot, 'state.json')
  }

  private get projectsDir(): string {
    return join(this.stateRoot, 'projects')
  }

  /** One project's directory. */
  projectDir(projectId: string): string {
    assertLibraryId(projectId, 'project id')
    return join(this.projectsDir, projectId)
  }

  private projectFile(projectId: string): string {
    return join(this.projectDir(projectId), 'project.json')
  }

  private roadmapFile(projectId: string): string {
    return join(this.projectDir(projectId), 'roadmap.json')
  }

  private vocabFile(projectId: string): string {
    return join(this.projectDir(projectId), 'vocab.jsonl')
  }

  private attemptsFile(projectId: string): string {
    return join(this.projectDir(projectId), 'attempts.jsonl')
  }

  private eventsFile(projectId: string): string {
    return join(this.projectDir(projectId), 'events.jsonl')
  }

  private quizFile(projectId: string, quizId: string): string {
    assertLibraryId(quizId, 'quiz id')
    return join(this.projectDir(projectId), 'quizzes', `${quizId}.json`)
  }

  private bookFile(projectId: string, bookId: string): string {
    assertLibraryId(bookId, 'book id')
    return join(this.projectDir(projectId), 'books', bookId, 'book.json')
  }

  private chapterFile(projectId: string, bookId: string, n: number): string {
    assertLibraryId(bookId, 'book id')
    return join(this.projectDir(projectId), 'books', bookId, 'chapters', `${n}.html`)
  }

  /** The per-project lock's path. */
  private projectLock(projectId: string): string {
    assertLibraryId(projectId, 'project id')
    return join(this.projectsDir, `${projectId}.lock`)
  }

  /** Serialize under the scope's lock: read-modify-write as one critical section. */
  async withProjectLock<T>(projectId: string, fn: () => Promise<T> | T): Promise<T> {
    if (!this.available) throw new LibraryStoreError('library: no writable state root', 'unavailable')
    mkdirSync(this.projectsDir, { recursive: true })
    const lock = await acquireLibraryLock(this.projectLock(projectId))
    try {
      return await fn()
    } finally {
      lock.release()
    }
  }

  /** The index's own lock (project create/delete). */
  async withIndexLock<T>(fn: () => Promise<T> | T): Promise<T> {
    if (!this.available) throw new LibraryStoreError('library: no writable state root', 'unavailable')
    mkdirSync(this.stateRoot, { recursive: true })
    const lock = await acquireLibraryLock(`${this.indexFile}.lock`)
    try {
      return await fn()
    } finally {
      lock.release()
    }
  }

  /* ------------------------------------------------------------ low level */

  /**
   * Read and normalize one JSON document.
   *
   * @returns undefined when the file is absent; throws `corrupt` when it
   *   exists but does not parse (a hand-edited file stays visible rather than
   *   being silently clobbered).
   */
  private readJsonFile<T>(file: string, normalize: (value: unknown) => T | undefined): T | undefined {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return undefined
      throw new LibraryStoreError(`library: ${file} could not be read — ${libraryErrorMessage(error)}`, 'io')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new LibraryStoreError(`library: ${file} does not parse — fix or remove it by hand`, 'corrupt')
    }
    const doc = normalize(parsed)
    if (doc === undefined) {
      throw new LibraryStoreError(`library: ${file} holds no usable document — fix or remove it by hand`, 'corrupt')
    }
    return doc
  }

  /** Write one document atomically (temp file + rename). */
  private writeJsonFile(file: string, value: unknown): void {
    mkdirSync(dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    try {
      writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`)
      renameSync(temporary, file)
    } catch (error) {
      rmSync(temporary, { force: true })
      throw new LibraryStoreError(`library: ${file} could not be written — ${libraryErrorMessage(error)}`, 'io')
    }
  }

  /** Write one chapter body atomically (the externalized big artifact). */
  private writeTextFile(file: string, text: string): void {
    mkdirSync(dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    try {
      writeFileSync(temporary, text)
      renameSync(temporary, file)
    } catch (error) {
      rmSync(temporary, { force: true })
      throw new LibraryStoreError(`library: ${file} could not be written — ${libraryErrorMessage(error)}`, 'io')
    }
  }

  /** Append lines to one JSONL ledger (append-only: never a rewrite). */
  private appendJsonlFile(file: string, values: readonly unknown[]): void {
    if (values.length === 0) return
    mkdirSync(dirname(file), { recursive: true })
    const lines = values.map(value => `${JSON.stringify(value)}\n`).join('')
    try {
      writeFileSync(file, lines, { flag: 'a' })
    } catch (error) {
      throw new LibraryStoreError(`library: ${file} could not be appended — ${libraryErrorMessage(error)}`, 'io')
    }
  }

  /** Read one JSONL ledger tolerantly: unparseable lines drop, never fail the read. */
  private readJsonlFile<T>(file: string, normalize: (value: unknown) => T | undefined): T[] {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return []
      throw new LibraryStoreError(`library: ${file} could not be read — ${libraryErrorMessage(error)}`, 'io')
    }
    const out: T[] = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      try {
        const value = normalize(JSON.parse(trimmed))
        if (value !== undefined) out.push(value)
      } catch {
        // A torn line (a crash mid-append) is skipped — the ledger is a log.
      }
    }
    return out
  }

  /* --------------------------------------------------------------- reads */

  /** The index; absent reads as empty, an unavailable root as empty. */
  readIndex(): LibraryIndexDoc {
    if (!this.available) return emptyLibraryIndex()
    const doc = this.readJsonFile(this.indexFile, value => normalizeLibraryIndex(value))
    return doc ?? emptyLibraryIndex()
  }

  /** One project's record; undefined when absent. */
  readProject(projectId: string): LibraryProject | undefined {
    return this.readJsonFile(this.projectFile(projectId), normalizeProject)
  }

  /** One project's roadmap; undefined when none was written. */
  readRoadmap(projectId: string): LibraryRoadmap | undefined {
    return this.readJsonFile(this.roadmapFile(projectId), normalizeRoadmap)
  }

  /** One book's metadata; undefined when absent. */
  readBook(projectId: string, bookId: string): LibraryBook | undefined {
    return this.readJsonFile(this.bookFile(projectId, bookId), normalizeBook)
  }

  /** Every book of one project, in shelving (directory-name) order. */
  listBooks(projectId: string): LibraryBook[] {
    const dir = join(this.projectDir(projectId), 'books')
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
      .flatMap(bookId => {
        const book = this.readBook(projectId, bookId)
        return book === undefined ? [] : [book]
      })
  }

  /** A chapter's body; undefined when absent. */
  readChapter(projectId: string, bookId: string, n: number): string | undefined {
    try {
      return readFileSync(this.chapterFile(projectId, bookId, n), 'utf8')
    } catch {
      return undefined
    }
  }

  /** The whole vocab book (the JSONL ledger, tolerant per line). */
  readVocab(projectId: string): LibraryVocabEntry[] {
    return this.readJsonlFile(this.vocabFile(projectId), normalizeVocabEntry)
  }

  /** Every attempt (the JSONL ledger, tolerant per line). */
  readAttempts(projectId: string): LibraryAttempt[] {
    return this.readJsonlFile(this.attemptsFile(projectId), normalizeAttempt)
  }

  /** The audit ledger (the JSONL ledger, tolerant per line), oldest first. */
  readEvents(projectId: string): LibraryEvent[] {
    return this.readJsonlFile(this.eventsFile(projectId), normalizeEvent)
  }

  /** One quiz; undefined when absent. */
  readQuiz(projectId: string, quizId: string): LibraryQuiz | undefined {
    return this.readJsonFile(this.quizFile(projectId, quizId), normalizeQuiz)
  }

  /** Every quiz of one project, by id. */
  listQuizzes(projectId: string): LibraryQuiz[] {
    const dir = join(this.projectDir(projectId), 'quizzes')
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(name => name.endsWith('.json'))
      .sort()
      .flatMap(name => {
        const quiz = this.readQuiz(projectId, name.slice(0, -'.json'.length))
        return quiz === undefined ? [] : [quiz]
      })
  }

  /* --------------------------------------------------------------- writes */

  /** Write the index (call inside `withIndexLock`). */
  writeIndex(doc: LibraryIndexDoc): void {
    this.writeJsonFile(this.indexFile, doc)
  }

  /** Write one project's record (call inside `withProjectLock`). */
  writeProject(project: LibraryProject): void {
    this.writeJsonFile(this.projectFile(project.id), project)
  }

  /**
   * Write one book: its metadata and every chapter body. Chapter files are
   * written first (a metadata row must never point at a missing body); a
   * mid-write failure leaves whole older chapters beside a partial new set,
   * which the next storeBook of the same id fully replaces.
   */
  writeBook(projectId: string, book: LibraryBook, chapters: readonly { readonly n: number; readonly html: string }[]): void {
    for (const chapter of chapters) {
      if (!Number.isInteger(chapter.n) || chapter.n <= 0) {
        throw new LibraryStoreError(`library: chapter number ${String(chapter.n)} is not a positive integer`, 'io')
      }
      this.writeTextFile(this.chapterFile(projectId, book.id, chapter.n), chapter.html)
    }
    this.writeJsonFile(this.bookFile(projectId, book.id), book)
  }

  /** Write one project's roadmap (call inside `withProjectLock`). */
  writeRoadmap(projectId: string, roadmap: LibraryRoadmap): void {
    this.writeJsonFile(this.roadmapFile(projectId), roadmap)
  }

  /** Append vocab entries (call inside `withProjectLock`). */
  appendVocab(projectId: string, entries: readonly LibraryVocabEntry[]): void {
    this.appendJsonlFile(this.vocabFile(projectId), entries)
  }

  /**
   * Rewrite the vocab book whole — the ONE exception to append-only, because a
   * mastery update is a rewrite of an existing line. The temp+rename keeps the
   * swap atomic; the project lock serializes it against appends.
   */
  rewriteVocab(projectId: string, entries: readonly LibraryVocabEntry[]): void {
    const file = this.vocabFile(projectId)
    mkdirSync(dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    try {
      writeFileSync(temporary, entries.map(entry => `${JSON.stringify(entry)}\n`).join(''))
      renameSync(temporary, file)
    } catch (error) {
      rmSync(temporary, { force: true })
      throw new LibraryStoreError(`library: ${file} could not be rewritten — ${libraryErrorMessage(error)}`, 'io')
    }
  }

  /** Append one attempt (call inside `withProjectLock`). */
  appendAttempt(projectId: string, attempt: LibraryAttempt): void {
    this.appendJsonlFile(this.attemptsFile(projectId), [attempt])
  }

  /** Append audit events (call inside `withProjectLock`). */
  appendEvents(projectId: string, events: readonly LibraryEvent[]): void {
    this.appendJsonlFile(this.eventsFile(projectId), events)
  }

  /** Write one quiz (call inside `withProjectLock`). */
  writeQuiz(quiz: LibraryQuiz, projectId: string): void {
    this.writeJsonFile(this.quizFile(projectId, quiz.id), quiz)
  }

  /** Remove one project's whole directory (books, ledgers, quizzes). */
  removeProject(projectId: string): void {
    rmSync(this.projectDir(projectId), { recursive: true, force: true })
    rmSync(this.projectLock(projectId), { force: true })
  }
}

/**
 * Resolve the state root: an explicit config value wins, then
 * `$DSH_HOME/state/dsh-library`, then `<cwd>/.dsh-library`.
 */
export function resolveLibraryStateRoot(configured: string | undefined): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return join(home, 'state', STATE_ROOT_SEGMENT)
  return join(process.cwd(), `.${STATE_ROOT_SEGMENT}`)
}
