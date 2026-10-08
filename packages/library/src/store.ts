/**
 * The host-side state store: a version-guarded index (`state.json`), the
 * session bindings (`bindings.json`), and one directory per project under
 * `$DSH_HOME/state/dsh-library/`:
 *
 * ```
 * state.json                       # version-guarded index (project list)
 * bindings.json                    # sessionId → { projectId, bookId? }
 * projects/<projectId>/
 *   project.json                   # { id, name, template, goal?, createdAt }
 *   books/<bookId>/book.json       # registered metadata + toc (no bodies)
 *   books/<bookId>/roadmap.json    # the adopted path
 *   books/<bookId>/roadmap.draft.json  # the coach's draft, until 采用
 *   books/<bookId>/pages.jsonl     # photographed pages, append-only
 *   cards.jsonl                    # knowledge cards (rewritten whole on update)
 *   quizzes/<quizId>.json
 *   attempts.jsonl                 # append-only
 *   events.jsonl                   # append-only audit trail
 * ```
 *
 * The write discipline is the mission store's (the in-repo precedent for
 * shared JSON state): every mutation funnels through a per-scope lock → read →
 * modify → temp-write → atomic rename; the JSONL ledgers are append-only
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
  MAX_BOX,
  MAX_WEAKNESS,
  STATE_ROOT_SEGMENT,
  type LibraryAttachmentRef,
  type LibraryAttempt,
  type LibraryBinding,
  type LibraryBook,
  type LibraryCard,
  type LibraryCardSourceType,
  type LibraryEvent,
  type LibraryEventType,
  type LibraryPage,
  type LibraryProject,
  type LibraryQuiz,
  type LibraryQuizQuestion,
  type LibraryRoadmap,
  type RoadmapNode,
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

/* ------------------------------------------------- normalization helpers */

type Rec = Record<string, unknown>

function asRecord(value: unknown): Rec | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Rec : undefined
}

/** A trimmed, length-capped string, or undefined when absent / empty. */
function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed.slice(0, max)
}

function id(value: unknown): string | undefined {
  return typeof value === 'string' && isLibraryId(value) ? value : undefined
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stamp(value: unknown): string {
  return typeof value === 'string' ? value : new Date(0).toISOString()
}

function strings(value: unknown, max: number): string[] {
  return Array.isArray(value) ? value.flatMap(item => { const s = text(item, max); return s === undefined ? [] : [s] }) : []
}

/** Spread `{ [key]: value }` only when value is defined. */
function opt<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }
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

/** Coerce a parsed value into an index; another schema version reads as empty. */
export function normalizeLibraryIndex(value: unknown): LibraryIndexDoc {
  const record = asRecord(value)
  if (record === undefined || record.version !== LIBRARY_STATE_VERSION) return emptyLibraryIndex()
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
  const record = asRecord(value)
  const projectId = id(record?.id)
  const name = text(record?.name, 200)
  if (record === undefined || projectId === undefined || name === undefined) return undefined
  const template = record.template === 'language' || record.template === 'custom' ? record.template : 'subject'
  return {
    id: projectId,
    name,
    template,
    ...opt('templateNote', text(record.templateNote, 500)),
    ...opt('goal', text(record.goal, 500)),
    createdAt: stamp(record.createdAt),
  }
}

/** One book's metadata, when it carries the fields that make it one. */
export function normalizeBook(value: unknown): LibraryBook | undefined {
  const record = asRecord(value)
  const bookId = id(record?.id)
  const title = text(record?.title, 300)
  if (record === undefined || bookId === undefined || title === undefined) return undefined
  const source = asRecord(record.tocSource) ?? {}
  const toc = Array.isArray(record.toc) ? record.toc : []
  return {
    id: bookId,
    title,
    ...opt('author', text(record.author, 200)),
    ...opt('edition', text(record.edition, 100)),
    ...opt('isbn', text(record.isbn, 40)),
    bookKind: record.bookKind === 'material' ? 'material' : 'knowledge',
    toc: toc.flatMap((item, index) => {
      const entry = asRecord(item)
      const entryTitle = text(entry?.title, 300)
      if (entryTitle === undefined) return []
      return [{ n: index + 1, title: entryTitle, ...opt('part', text(entry?.part, 200)) }]
    }),
    tocSource: {
      by: source.by === 'web' || source.by === 'photo' ? source.by : 'model',
      ...opt('url', text(source.url, 1000)),
      ...opt('verifiedAt', text(source.verifiedAt, 40)),
    },
    createdAt: stamp(record.createdAt),
  }
}

/** One roadmap (adopted or draft), when it parses; rule checks live in the service. */
export function normalizeRoadmap(value: unknown): LibraryRoadmap | undefined {
  const record = asRecord(value)
  const bookId = id(record?.bookId)
  if (record === undefined || bookId === undefined || !Array.isArray(record.nodes)) return undefined
  const nodes: RoadmapNode[] = []
  for (const item of record.nodes as unknown[]) {
    const node = asRecord(item)
    const nodeId = id(node?.id)
    const title = text(node?.title, 300)
    const state = node?.state === 'locked' || node?.state === 'current' || node?.state === 'done' ? node.state : undefined
    if (node === undefined || nodeId === undefined || title === undefined || state === undefined) return undefined
    const kind = node.kind === 'read' ? 'read' as const : 'quiz' as const
    const stats = asRecord(node.quizStats)
    nodes.push({
      id: nodeId,
      title,
      kind,
      goals: typeof node.goals === 'string' ? strings([node.goals], 300) : strings(node.goals, 300),
      dependsOn: Array.isArray(node.dependsOn) ? (node.dependsOn as unknown[]).filter((dep): dep is string => typeof dep === 'string') : [],
      chapterRanges: Array.isArray(node.chapterRanges)
        ? (node.chapterRanges as unknown[]).flatMap(range => {
          const r = asRecord(range)
          const from = finite(r?.from)
          const to = finite(r?.to)
          return from === undefined || to === undefined ? [] : [{ from, to }]
        })
        : [],
      state,
      ...(stats === undefined || kind === 'read' ? {} : {
        quizStats: {
          attempts: finite(stats.attempts) ?? 0,
          ...opt('lastRatio', finite(stats.lastRatio)),
          ...opt('bestRatio', finite(stats.bestRatio)),
        },
      }),
    })
  }
  const passRatio = finite(record.passRatio)
  return {
    bookId,
    status: record.status === 'adopted' ? 'adopted' : 'draft',
    nodes,
    ...(passRatio !== undefined && passRatio > 0 && passRatio <= 1 ? { passRatio } : {}),
    ...opt('note', text(record.note, 300)),
    generatedAt: stamp(record.generatedAt),
    ...opt('adoptedAt', text(record.adoptedAt, 40)),
  }
}

/** An attachment reference, when every durable field is present. */
export function normalizeAttachmentRef(value: unknown): LibraryAttachmentRef | undefined {
  const record = asRecord(value)
  const attachmentId = text(record?.attachmentId, 200)
  const mediaType = text(record?.mediaType, 100)
  const bytes = finite(record?.bytes)
  const width = finite(record?.width)
  const height = finite(record?.height)
  if (attachmentId === undefined || mediaType === undefined || bytes === undefined || width === undefined || height === undefined) return undefined
  return { attachmentId, mediaType, bytes, width, height }
}

/** One photographed page (one pages.jsonl line), when it parses. */
export function normalizePage(value: unknown): LibraryPage | undefined {
  const record = asRecord(value)
  const pageId = id(record?.id)
  const bookId = id(record?.bookId)
  const attachment = normalizeAttachmentRef(record?.attachment)
  if (record === undefined || pageId === undefined || bookId === undefined || attachment === undefined) return undefined
  return {
    id: pageId,
    bookId,
    ...opt('nodeId', id(record.nodeId)),
    ...opt('label', text(record.label, 60)),
    attachment,
    text: typeof record.text === 'string' ? record.text.slice(0, 20_000) : '',
    marks: Array.isArray(record.marks)
      ? (record.marks as unknown[]).flatMap(item => {
        const mark = asRecord(item)
        const markText = text(mark?.text, 300)
        if (mark === undefined || markText === undefined) return []
        return [{
          text: markText,
          ...opt('sentence', text(mark.sentence, 1000)),
          ...opt('handNote', text(mark.handNote, 300)),
          ...opt('gloss', text(mark.gloss, 1000)),
          ...(mark.uncertain === true ? { uncertain: true } : {}),
        }]
      })
      : [],
    cardIds: strings(record.cardIds, 100),
    at: stamp(record.at),
  }
}

const CARD_SOURCE_TYPES: readonly LibraryCardSourceType[] = ['photo', 'chat', 'quiz', 'manual']

/** One knowledge card (one cards.jsonl line), when it parses. */
export function normalizeCard(value: unknown): LibraryCard | undefined {
  const record = asRecord(value)
  const cardId = id(record?.id)
  const term = text(record?.term, 300)
  const gloss = text(record?.gloss, 2000)
  if (record === undefined || cardId === undefined || term === undefined || gloss === undefined) return undefined
  const mastery = asRecord(record.mastery) ?? {}
  const box = finite(mastery.box)
  const weakness = finite(record.weakness) ?? 0
  return {
    id: cardId,
    kind: record.kind === 'word' ? 'word' : 'concept',
    term,
    aliases: strings(record.aliases, 300),
    gloss,
    ...opt('userGloss', text(record.userGloss, 1000)),
    contexts: Array.isArray(record.contexts)
      ? (record.contexts as unknown[]).flatMap(item => {
        const context = asRecord(item)
        const sentence = text(context?.sentence, 1000)
        if (context === undefined || sentence === undefined) return []
        return [{ sentence, ...opt('bookId', id(context.bookId)), ...opt('pageId', id(context.pageId)), ...opt('nodeId', id(context.nodeId)) }]
      })
      : [],
    ...opt('bookId', id(record.bookId)),
    sources: Array.isArray(record.sources)
      ? (record.sources as unknown[]).flatMap(item => {
        const source = asRecord(item)
        const type = CARD_SOURCE_TYPES.find(candidate => candidate === source?.type)
        if (source === undefined || type === undefined) return []
        return [{
          type,
          ...opt('ref', text(source.ref, 200)),
          ...opt('note', text(source.note, 300)),
          ...(source.weakened === true ? { weakened: true } : {}),
          at: stamp(source.at),
        }]
      })
      : [],
    weakness: Math.min(Math.max(Math.round(weakness), 0), MAX_WEAKNESS),
    mastery: {
      box: box === undefined ? 0 : Math.min(Math.max(Math.round(box), 0), MAX_BOX),
      dueAt: stamp(mastery.dueAt),
      streak: Math.max(0, Math.round(finite(mastery.streak) ?? 0)),
    },
    status: record.status === 'mastered' || record.status === 'deleted' ? record.status : 'active',
    createdAt: stamp(record.createdAt),
    updatedAt: stamp(record.updatedAt ?? record.createdAt),
  }
}

/** One quiz, when it parses; the two-axis checks live in the service. */
export function normalizeQuiz(value: unknown): LibraryQuiz | undefined {
  const record = asRecord(value)
  const quizId = id(record?.id)
  const scope = asRecord(record?.scope)
  const bookId = id(scope?.bookId)
  if (record === undefined || quizId === undefined || bookId === undefined || !Array.isArray(record.questions)) return undefined
  const questions: LibraryQuizQuestion[] = []
  for (const item of record.questions as unknown[]) {
    const q = asRecord(item)
    const qid = text(q?.id, 60)
    const kind = q?.kind === 'choice' || q?.kind === 'fill' || q?.kind === 'free' ? q.kind : undefined
    const target = asRecord(q?.target)
    const evidence = asRecord(q?.evidence)
    if (q === undefined || qid === undefined || kind === undefined || typeof q.prompt !== 'string' || target === undefined || evidence === undefined) {
      return undefined
    }
    const targetKind = target.kind === 'marked' || target.kind === 'asked' || target.kind === 'missed' ? target.kind : 'topic'
    const evidenceKind = evidence.kind === 'photo' || evidence.kind === 'web' ? evidence.kind : 'knowledge'
    questions.push({
      id: qid,
      kind,
      prompt: q.prompt,
      ...(Array.isArray(q.options) ? { options: (q.options as unknown[]).filter((o): o is string => typeof o === 'string') } : {}),
      answer: typeof q.answer === 'string' ? q.answer : '',
      ...opt('explanation', text(q.explanation, 2000)),
      target: { kind: targetKind, ...(Array.isArray(target.cardIds) ? { cardIds: strings(target.cardIds, 100) } : {}) },
      evidence: {
        kind: evidenceKind,
        ...opt('pageId', id(evidence.pageId)),
        ...opt('url', text(evidence.url, 1000)),
        ...opt('quote', text(evidence.quote, 2000)),
      },
    })
  }
  return {
    id: quizId,
    scope: { bookId, ...opt('nodeId', id(scope?.nodeId)) },
    questions,
    createdAt: stamp(record.createdAt),
  }
}

/** One attempt (one attempts.jsonl line), when it parses. */
export function normalizeAttempt(value: unknown): LibraryAttempt | undefined {
  const record = asRecord(value)
  const attemptId = id(record?.id)
  const quizId = id(record?.quizId)
  const ratio = finite(record?.ratio)
  if (record === undefined || attemptId === undefined || quizId === undefined || ratio === undefined || !Array.isArray(record.verdicts)) return undefined
  const verdicts: LibraryAttempt['verdicts'][number][] = []
  for (const item of record.verdicts as unknown[]) {
    const v = asRecord(item)
    if (v === undefined || typeof v.task !== 'string' || typeof v.criterion !== 'string' || typeof v.pass !== 'boolean' || typeof v.evidence !== 'string') {
      return undefined
    }
    verdicts.push({
      task: v.task,
      criterion: v.criterion,
      pass: v.pass,
      ...opt('ratio', finite(v.ratio)),
      evidence: v.evidence,
      by: v.by === 'self' || v.by === 'user' ? v.by : 'llm',
      ...(v.void === true ? { void: true } : {}),
    })
  }
  return { id: attemptId, quizId, verdicts, ratio, at: stamp(record.at) }
}

/** One audit event (one events.jsonl line), when it parses. */
export function normalizeEvent(value: unknown): LibraryEvent | undefined {
  const record = asRecord(value)
  const type = typeof record?.type === 'string' && (LIBRARY_EVENT_TYPES as readonly string[]).includes(record.type)
    ? record.type as LibraryEventType
    : undefined
  if (record === undefined || type === undefined) return undefined
  const count = finite(record.count)
  const count2 = finite(record.count2)
  return {
    at: stamp(record.at),
    type,
    ...opt('id', text(record.id, 200)),
    ...opt('title', text(record.title, 300)),
    ...opt('bookId', id(record.bookId)),
    ...opt('source', CARD_SOURCE_TYPES.find(candidate => candidate === record.source)),
    ...opt('session', text(record.session, 200)),
    ...(Array.isArray(record.ids) ? { ids: strings(record.ids, 100) } : {}),
    ...opt('count', count === undefined ? undefined : Math.floor(count)),
    ...opt('count2', count2 === undefined ? undefined : Math.floor(count2)),
    ...opt('ratio', finite(record.ratio)),
  }
}

/** The bindings map, dropping rows that do not parse. */
export function normalizeBindings(value: unknown): Map<string, LibraryBinding> {
  const out = new Map<string, LibraryBinding>()
  const record = asRecord(value)
  if (record === undefined) return out
  for (const [sessionId, raw] of Object.entries(record)) {
    const binding = asRecord(raw)
    const projectId = id(binding?.projectId)
    if (sessionId === '' || projectId === undefined) continue
    out.set(sessionId, { projectId, ...opt('bookId', id(binding?.bookId)) })
  }
  return out
}

/* ----------------------------------------------------------------- store */

/**
 * The native-fs library store. Reads never lock (a read observes one committed
 * revision, never a partial one — writes are atomic renames); writes serialize
 * on a per-project lock (`projects/<id>.lock`), the index and the bindings on
 * their own.
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

  private get bindingsFile(): string {
    return join(this.stateRoot, 'bindings.json')
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

  private bookDir(projectId: string, bookId: string): string {
    assertLibraryId(bookId, 'book id')
    return join(this.projectDir(projectId), 'books', bookId)
  }

  private cardsFile(projectId: string): string {
    return join(this.projectDir(projectId), 'cards.jsonl')
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
    return await this.withRootLock(this.indexFile, fn)
  }

  /** The bindings' own lock. */
  async withBindingsLock<T>(fn: () => Promise<T> | T): Promise<T> {
    return await this.withRootLock(this.bindingsFile, fn)
  }

  private async withRootLock<T>(file: string, fn: () => Promise<T> | T): Promise<T> {
    if (!this.available) throw new LibraryStoreError('library: no writable state root', 'unavailable')
    mkdirSync(this.stateRoot, { recursive: true })
    const lock = await acquireLibraryLock(`${file}.lock`)
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
    let raw: string
    try {
      raw = readFileSync(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return undefined
      throw new LibraryStoreError(`library: ${file} could not be read — ${libraryErrorMessage(error)}`, 'io')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
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
    this.writeTextFile(file, `${JSON.stringify(value, null, 2)}\n`)
  }

  /** Write one text file atomically. */
  private writeTextFile(file: string, body: string): void {
    mkdirSync(dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    try {
      writeFileSync(temporary, body)
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
    let raw: string
    try {
      raw = readFileSync(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return []
      throw new LibraryStoreError(`library: ${file} could not be read — ${libraryErrorMessage(error)}`, 'io')
    }
    const out: T[] = []
    for (const line of raw.split('\n')) {
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
    return this.readJsonFile(this.indexFile, value => normalizeLibraryIndex(value)) ?? emptyLibraryIndex()
  }

  /** The session bindings; absent or unreadable reads as empty. */
  readBindings(): Map<string, LibraryBinding> {
    if (!this.available) return new Map()
    try {
      return normalizeBindings(JSON.parse(readFileSync(this.bindingsFile, 'utf8')))
    } catch {
      return new Map()
    }
  }

  /** One project's record; undefined when absent. */
  readProject(projectId: string): LibraryProject | undefined {
    return this.readJsonFile(this.projectFile(projectId), normalizeProject)
  }

  /** One book's metadata; undefined when absent. */
  readBook(projectId: string, bookId: string): LibraryBook | undefined {
    return this.readJsonFile(join(this.bookDir(projectId, bookId), 'book.json'), normalizeBook)
  }

  /** Every book of one project, oldest first. */
  listBooks(projectId: string): LibraryBook[] {
    const dir = join(this.projectDir(projectId), 'books')
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && isLibraryId(entry.name))
      .flatMap(entry => {
        const book = this.readBook(projectId, entry.name)
        return book === undefined ? [] : [book]
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /** One book's adopted roadmap, or its draft. */
  readRoadmap(projectId: string, bookId: string, which: 'adopted' | 'draft' = 'adopted'): LibraryRoadmap | undefined {
    const file = which === 'adopted' ? 'roadmap.json' : 'roadmap.draft.json'
    return this.readJsonFile(join(this.bookDir(projectId, bookId), file), normalizeRoadmap)
  }

  /** One book's photographed pages, oldest first. */
  readPages(projectId: string, bookId: string): LibraryPage[] {
    return this.readJsonlFile(join(this.bookDir(projectId, bookId), 'pages.jsonl'), normalizePage)
  }

  /** Every knowledge card of one project (deleted ones included — callers filter). */
  readCards(projectId: string): LibraryCard[] {
    return this.readJsonlFile(this.cardsFile(projectId), normalizeCard)
  }

  /** Every attempt (the JSONL ledger, tolerant per line). */
  readAttempts(projectId: string): LibraryAttempt[] {
    return this.readJsonlFile(this.attemptsFile(projectId), normalizeAttempt)
  }

  /** The audit ledger, oldest first. */
  readEvents(projectId: string): LibraryEvent[] {
    return this.readJsonlFile(this.eventsFile(projectId), normalizeEvent)
  }

  /** One quiz; undefined when absent. */
  readQuiz(projectId: string, quizId: string): LibraryQuiz | undefined {
    return this.readJsonFile(this.quizFile(projectId, quizId), normalizeQuiz)
  }

  /** Every quiz of one project, oldest first. */
  listQuizzes(projectId: string): LibraryQuiz[] {
    const dir = join(this.projectDir(projectId), 'quizzes')
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(name => name.endsWith('.json') && isLibraryId(name.slice(0, -'.json'.length)))
      .flatMap(name => {
        const quiz = this.readQuiz(projectId, name.slice(0, -'.json'.length))
        return quiz === undefined ? [] : [quiz]
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /* --------------------------------------------------------------- writes */

  /** Write the index (call inside `withIndexLock`). */
  writeIndex(doc: LibraryIndexDoc): void {
    this.writeJsonFile(this.indexFile, doc)
  }

  /** Write the bindings (call inside `withBindingsLock`). */
  writeBindings(bindings: ReadonlyMap<string, LibraryBinding>): void {
    this.writeJsonFile(this.bindingsFile, Object.fromEntries(bindings))
  }

  /** Write one project's record (call inside `withProjectLock`). */
  writeProject(project: LibraryProject): void {
    this.writeJsonFile(this.projectFile(project.id), project)
  }

  /** Write one book's metadata (call inside `withProjectLock`). */
  writeBook(projectId: string, book: LibraryBook): void {
    this.writeJsonFile(join(this.bookDir(projectId, book.id), 'book.json'), book)
  }

  /** Write one book's adopted roadmap or its draft (call inside `withProjectLock`). */
  writeRoadmap(projectId: string, roadmap: LibraryRoadmap): void {
    const file = roadmap.status === 'adopted' ? 'roadmap.json' : 'roadmap.draft.json'
    this.writeJsonFile(join(this.bookDir(projectId, roadmap.bookId), file), roadmap)
  }

  /** Drop one book's draft (adopted or discarded). */
  removeDraft(projectId: string, bookId: string): void {
    rmSync(join(this.bookDir(projectId, bookId), 'roadmap.draft.json'), { force: true })
  }

  /** Append one photographed page (call inside `withProjectLock`). */
  appendPage(projectId: string, page: LibraryPage): void {
    this.appendJsonlFile(join(this.bookDir(projectId, page.bookId), 'pages.jsonl'), [page])
  }

  /**
   * Rewrite the cards whole — a merge or a mastery move rewrites an existing
   * line. The temp+rename keeps the swap atomic; the project lock serializes it.
   */
  writeCards(projectId: string, cards: readonly LibraryCard[]): void {
    this.writeTextFile(this.cardsFile(projectId), cards.map(card => `${JSON.stringify(card)}\n`).join(''))
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
  writeQuiz(projectId: string, quiz: LibraryQuiz): void {
    this.writeJsonFile(this.quizFile(projectId, quiz.id), quiz)
  }

  /** Remove one book's directory (metadata, roadmaps, pages). */
  removeBook(projectId: string, bookId: string): void {
    rmSync(this.bookDir(projectId, bookId), { recursive: true, force: true })
  }

  /** Remove one project's whole directory. */
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
