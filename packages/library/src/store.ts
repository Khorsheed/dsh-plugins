/**
 * The host-side state store: a version-guarded index (`state.json`), the
 * session bindings (`bindings.json`), and one directory per project under
 * `$DSH_HOME/state/dsh-library/`:
 *
 * ```
 * state.json                          # version-guarded index (project list)
 * bindings.json                       # sessionId → { projectId, resourceId? }
 * projects/<projectId>/
 *   project.json                      # { id, name, template, goal?, createdAt }
 *   resources/<resourceId>.json       # shelf entries, thick (toc) and thin
 *   pages/<resourceId>.jsonl          # a thick resource's photographed pages, append-only
 *   roadmaps/<resourceId>.json        # a textbook's adopted path
 *   roadmaps/<resourceId>.draft.json  # its coach's draft, until 采用
 *   assessments/<assessmentId>.json   # quizzes and materialized practice rubrics
 *   cards.jsonl                       # knowledge cards (rewritten whole on update)
 *   attempts.jsonl                    # append-only
 *   events.jsonl                      # append-only audit trail
 * ```
 *
 * **Read-old, write-new (v5).** The v3/v4 layout — `books/<bookId>/book.json`
 * + `roadmap.json` + `pages.jsonl`, `resources.jsonl`, `quizzes/<id>.json`,
 * — is never written any more but always READ: every reader merges or
 * falls back to the legacy spot, every
 * normalize* function accepts the legacy field names (`bookId`, node `kind`,
 * cover unions, `quizId`). Legacy files stay in place (a rollback loses
 * nothing); the next write of an entity lands in the new layout. v2 roots
 * (per-book roadmaps with `chapterRanges`) still normalize on the fly, and
 * `migrateState` rewrites them into the covers shape as before.
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
  formatLocator,
  isLibraryId,
  type LibraryAcceptanceInput,
  type LibraryAcceptanceLine,
  libraryErrorMessage,
  LIBRARY_EVENT_TYPES,
  LIBRARY_COLORS,
  LIBRARY_ICONS,
  LIBRARY_RESOURCE_KINDS,
  LIBRARY_RESOURCE_ORIGINS,
  LIBRARY_STATE_VERSION,
  MAX_BOX,
  MAX_WEAKNESS,
  STATE_ROOT_SEGMENT,
  type LibraryAssessment,
  type LibraryAttachmentRef,
  type LibraryAttempt,
  type LibraryBinding,
  type LibraryCard,
  type LibraryCardSourceType,
  type LibraryEvent,
  type LibraryEventType,
  type LibraryNodeCover,
  type LibraryPage,
  type LibraryProject,
  type LibraryQuizQuestion,
  type LibraryResource,
  type LibraryResourceExtra,
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

/** Acceptance lines: bare strings pass through; { line, ref? } objects normalize. */
function acceptanceEntries(value: unknown): LibraryAcceptanceInput[] {
  if (!Array.isArray(value)) return []
  return (value as unknown[]).flatMap((entry): LibraryAcceptanceInput[] => {
    if (typeof entry === 'string') {
      const line = text(entry, 300)
      return line === undefined ? [] : [line]
    }
    const record = asRecord(entry)
    const line = text(record?.line, 300)
    if (record === undefined || line === undefined) return []
    return [{ line, ...opt('ref', text(record.ref, 100)) }]
  })
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

/**
 * Coerce a parsed value into an index. A version this store does not
 * recognize reads as empty — v2 through v5 all read tolerantly (every entity
 * normalize accepts the older shapes; `migrateState` still rewrites v2
 * chapterRanges into covers).
 */
export function normalizeLibraryIndex(value: unknown): LibraryIndexDoc {
  const record = asRecord(value)
  const version = finite(record?.version)
  if (record === undefined || version === undefined || version < 2 || version > LIBRARY_STATE_VERSION) return emptyLibraryIndex()
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
    ...opt('color', LIBRARY_COLORS.find(color => color === record.color)),
    ...opt('icon', LIBRARY_ICONS.find(icon => icon === record.icon)),
    ...opt('templateNote', text(record.templateNote, 500)),
    ...opt('goal', text(record.goal, 500)),
    createdAt: stamp(record.createdAt),
  }
}

/** One table-of-contents list, re-numbered 1-based, when any row parses. */
function tocEntries(value: unknown): LibraryResource['toc'] {
  if (!Array.isArray(value)) return undefined
  const toc = (value as unknown[]).flatMap(item => {
    const entry = asRecord(item)
    const entryTitle = text(entry?.title, 300)
    if (entryTitle === undefined) return []
    return [{ title: entryTitle, ...opt('part', text(entry?.part, 200)) }]
  })
  return toc.map((entry, index) => ({ ...entry, n: index + 1 }))
}

/** The extras strip (开始前 / 附录), when any row parses. */
function extraEntries(value: unknown): LibraryResourceExtra[] | undefined {
  if (!Array.isArray(value)) return undefined
  return (value as unknown[]).flatMap(item => {
    const extra = asRecord(item)
    const extraTitle = text(extra?.title, 200)
    if (extra === undefined || extraTitle === undefined) return []
    return [{
      title: extraTitle,
      ...opt('note', text(extra.note, 300)),
      ...opt('where', text(extra.where, 60)),
      when: extra.when === 'reference' ? 'reference' as const : 'before' as const,
    }]
  })
}

/**
 * One shelf entry, when it parses. Reads BOTH layouts: a v5
 * `resources/<id>.json` (kind may be 'book', toc/meta live at the top) and a
 * legacy one — a `books/<id>/book.json` (kind forced to 'book', book-ish
 * fields folded into meta) or a `resources.jsonl` line (a thin link).
 */
export function normalizeResource(value: unknown): LibraryResource | undefined {
  const record = asRecord(value)
  const resourceId = id(record?.id)
  const title = text(record?.title, 300)
  if (record === undefined || resourceId === undefined || title === undefined) return undefined
  // Legacy book.json: the book-ish fields sat at the top level.
  const legacyBook = Array.isArray(record.toc) || record.bookKind !== undefined
  const kind = legacyBook
    ? 'book' as const
    : LIBRARY_RESOURCE_KINDS.find(kind => kind === record.kind) ?? 'article'
  const toc = tocEntries(record.toc)
  const source = asRecord(record.tocSource)
  const metaRecord = asRecord(record.meta)
  const meta: LibraryResource['meta'] = (() => {
    const bookKind = (metaRecord?.bookKind ?? record.bookKind) === 'material' ? 'material' as const
      : (metaRecord?.bookKind ?? record.bookKind) === 'knowledge' ? 'knowledge' as const
        : undefined
    const extras = extraEntries(metaRecord?.extras ?? record.extras)
    const merged = {
      ...opt('bookKind', bookKind),
      ...opt('short', text(metaRecord?.short ?? record.short, 8)),
      ...(extras !== undefined && extras.length > 0 ? { extras } : {}),
      ...opt('author', text(metaRecord?.author ?? record.author, 200)),
      ...opt('edition', text(metaRecord?.edition ?? record.edition, 100)),
      ...opt('isbn', text(metaRecord?.isbn ?? record.isbn, 40)),
    }
    return Object.keys(merged).length === 0 ? undefined : merged
  })()
  return {
    id: resourceId,
    title,
    kind,
    ...opt('url', text(record.url, 1000)),
    ...opt('note', text(record.note, 300)),
    // Legacy addedBy: the learner's own stays theirs; the coach's reads as a pick.
    ...opt('origin', LIBRARY_RESOURCE_ORIGINS.find(origin => origin === record.origin)
      ?? (record.addedBy === 'learner' ? 'learner' as const : record.addedBy === 'coach' || legacyBook ? 'picked' as const : undefined)),
    ...(toc !== undefined && toc.length > 0 ? { toc } : {}),
    ...(toc !== undefined && toc.length > 0 ? opt('seq', positiveInt(record.seq)) : {}),
    ...(source === undefined ? {} : {
      tocSource: {
        by: source.by === 'web' || source.by === 'photo' ? source.by : 'model',
        ...opt('url', text(source.url, 1000)),
        ...opt('verifiedAt', text(source.verifiedAt, 40)),
      },
    }),
    ...(meta === undefined ? {} : { meta }),
    createdAt: stamp(record.createdAt),
  }
}

/**
 * The shelf's reading order: textbooks (thick) before thin links; textbooks
 * by `seq`, unnumbered ones after the numbered, ties by age; links by age.
 */
export function shelfOrder(a: LibraryResource, b: LibraryResource): number {
  const thickA = a.toc !== undefined && a.toc.length > 0
  const thickB = b.toc !== undefined && b.toc.length > 0
  if (thickA !== thickB) return thickA ? -1 : 1
  if (thickA) {
    const seqA = a.seq ?? Number.POSITIVE_INFINITY
    const seqB = b.seq ?? Number.POSITIVE_INFINITY
    if (seqA !== seqB) return seqA < seqB ? -1 : 1
  }
  return a.createdAt.localeCompare(b.createdAt)
}

/** A positive integer, or undefined. */
function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/** A v2/v3 chapter-ranges list, as ranges. */
function legacyRanges(value: unknown): { from: number; to: number }[] {
  return Array.isArray(value)
    ? (value as unknown[]).flatMap(range => {
      const r = asRecord(range)
      const from = finite(r?.from)
      const to = finite(r?.to)
      return from === undefined || to === undefined ? [] : [{ from, to }]
    })
    : []
}

/**
 * One node's cover, when it parses. Reads the v5 shape (`{ ref, locator? }`)
 * and every legacy union member: `{ kind: 'book', bookId, ranges }`,
 * `{ kind: 'resource', resourceId }`, `{ kind: 'url', url, title? }`,
 * `{ kind: 'topic', text }`. Provenance rides along when present.
 */
export function normalizeNodeCover(value: unknown): LibraryNodeCover | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const by: 'web' | 'model' | 'user' | undefined = record.by === 'web' || record.by === 'model' || record.by === 'user' ? record.by : undefined
  const provenance = { ...opt('by', by), ...opt('verifiedAt', text(record.verifiedAt, 40)) }
  // v5: { ref, locator?, title? }.
  const ref = text(record.ref, 1000)
  if (ref !== undefined) {
    return { ref, ...opt('locator', text(record.locator, 200)), ...opt('title', text(record.title, 300)), ...provenance }
  }
  switch (record.kind) {
    case 'book': {
      const bookId = id(record.bookId)
      if (bookId === undefined) return undefined
      const ranges = legacyRanges(record.ranges)
      return { ref: bookId, ...(ranges.length === 0 ? {} : { locator: formatLocator(ranges) }), ...provenance }
    }
    case 'resource': {
      const resourceId = id(record.resourceId)
      return resourceId === undefined ? undefined : { ref: resourceId, ...provenance }
    }
    case 'url': {
      const url = text(record.url, 1000)
      return url === undefined ? undefined : { ref: url, ...opt('title', text(record.title, 300)), ...provenance }
    }
    case 'topic': {
      const topicText = text(record.text, 300)
      return topicText === undefined ? undefined : { ref: `topic:${topicText}`, ...provenance }
    }
    default:
      return undefined
  }
}

/** One roadmap (adopted or draft), when it parses; rule checks live in the service. */
export function normalizeRoadmap(value: unknown): LibraryRoadmap | undefined {
  const record = asRecord(value)
  if (record === undefined || !Array.isArray(record.nodes)) return undefined
  // v5 names it primaryResourceId; v3/v4 roadmaps carried bookId.
  const primaryResourceId = id(record.primaryResourceId) ?? id(record.bookId)
  const nodes: RoadmapNode[] = []
  for (const item of record.nodes as unknown[]) {
    const node = asRecord(item)
    const nodeId = id(node?.id)
    const title = text(node?.title, 300)
    const state = node?.state === 'locked' || node?.state === 'current' || node?.state === 'done' ? node.state : undefined
    if (node === undefined || nodeId === undefined || title === undefined || state === undefined) return undefined
    // v5 carries `gate`; v3/v4 carried kind: quiz | read | practice.
    const gate: RoadmapNode['gate'] = node.gate === 'read' || node.gate === 'acceptance' || node.gate === 'quiz'
      ? node.gate
      : node.kind === 'read' ? 'read' : node.kind === 'practice' ? 'acceptance' : 'quiz'
    // v3+ nodes carry covers; a v2 node wraps its chapterRanges into the one
    // book cover of its book's path.
    const covers: LibraryNodeCover[] = Array.isArray(node.covers)
      ? (node.covers as unknown[]).flatMap(cover => {
        const normalized = normalizeNodeCover(cover)
        return normalized === undefined ? [] : [normalized]
      })
      : primaryResourceId !== undefined && node.chapterRanges !== undefined
        ? [{ ref: primaryResourceId, locator: formatLocator(legacyRanges(node.chapterRanges)) }]
        : []
    const stats = asRecord(node.quizStats)
    const notesRec = asRecord(node.notes)
    const notesText = text(notesRec?.text, 40000)
    // 考点: quiz-gated nodes only; a malformed entry drops out, the rest survive.
    const points = gate === 'quiz' && Array.isArray(node.points)
      ? (node.points as unknown[]).flatMap(entry => {
        const point = asRecord(entry)
        const pointId = point !== undefined ? id(point.id) : undefined
        const pointTitle = text(point?.title, 100)
        return pointId === undefined || pointTitle === undefined ? [] : [{ id: pointId, title: pointTitle }]
      })
      : undefined
    nodes.push({
      id: nodeId,
      title,
      gate,
      goals: typeof node.goals === 'string' ? strings([node.goals], 300) : strings(node.goals, 300),
      dependsOn: Array.isArray(node.dependsOn) ? (node.dependsOn as unknown[]).filter((dep): dep is string => typeof dep === 'string') : [],
      covers,
      state,
      ...(stats === undefined || gate !== 'quiz' ? {} : {
        quizStats: {
          attempts: finite(stats.attempts) ?? 0,
          ...opt('lastRatio', finite(stats.lastRatio)),
          ...opt('bestRatio', finite(stats.bestRatio)),
        },
      }),
      ...(points === undefined || points.length === 0 ? {} : { points }),
      ...(gate === 'acceptance' && Array.isArray(node.acceptance) ? { acceptance: acceptanceEntries(node.acceptance) } : {}),
      ...(notesRec === undefined || notesText === undefined ? {} : {
        notes: { text: notesText, updatedAt: stamp(notesRec.updatedAt), revisions: finite(notesRec.revisions) ?? 1 },
      }),
    })
  }
  const passRatio = finite(record.passRatio)
  return {
    ...opt('primaryResourceId', primaryResourceId),
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

/** One photographed page (one pages/<resourceId>.jsonl line), when it parses. */
export function normalizePage(value: unknown): LibraryPage | undefined {
  const record = asRecord(value)
  const pageId = id(record?.id)
  // v5 names it resourceId; v3/v4 pages carried bookId.
  const resourceId = id(record?.resourceId) ?? id(record?.bookId)
  const attachment = normalizeAttachmentRef(record?.attachment)
  if (record === undefined || pageId === undefined || resourceId === undefined || attachment === undefined) return undefined
  return {
    id: pageId,
    resourceId,
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
        return [{ sentence, ...opt('resourceId', id(context.resourceId) ?? id(context.bookId)), ...opt('pageId', id(context.pageId)), ...opt('nodeId', id(context.nodeId)) }]
      })
      : [],
    ...opt('resourceId', id(record.resourceId) ?? id(record.bookId)),
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

/**
 * Options arrive as plain strings, as { label } objects, or letter-keyed maps —
 * the stored form is always plain strings, letter prefixes ("A) ") stripped
 * (the answering UI badges the letter itself).
 */
export function normalizeQuizOptions(value: unknown): string[] | undefined {
  const letter = /^[A-Za-z][.、)）:：]\s*/
  const list: unknown[] = Array.isArray(value)
    ? value
    : (typeof value === 'object' && value !== null ? Object.values(value) : [])
  if (list.length === 0) return undefined
  const out: string[] = []
  for (const option of list) {
    if (typeof option === 'string') { out.push(option); continue }
    const label = asRecord(option)?.label
    if (typeof label === 'string') { out.push(label.replace(letter, '')); continue }
    return undefined
  }
  return out
}

function normalizeQuizQuestions(value: unknown): LibraryQuizQuestion[] | undefined {
  if (!Array.isArray(value)) return undefined
  const questions: LibraryQuizQuestion[] = []
  for (const item of value as unknown[]) {
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
      ...(() => { const options = normalizeQuizOptions(q.options); return options === undefined ? {} : { options } })(),
      answer: typeof q.answer === 'string' ? q.answer : '',
      ...opt('explanation', text(q.explanation, 2000)),
      ...opt('point', text(q.point, 60)),
      target: { kind: targetKind, ...(Array.isArray(target.cardIds) ? { cardIds: strings(target.cardIds, 100) } : {}) },
      evidence: {
        kind: evidenceKind,
        ...opt('pageId', id(evidence.pageId)),
        ...opt('url', text(evidence.url, 1000)),
        ...opt('quote', text(evidence.quote, 2000)),
      },
    })
  }
  return questions
}

function normalizeRubricLines(value: unknown): LibraryAcceptanceLine[] | undefined {
  if (!Array.isArray(value)) return undefined
  const lines: LibraryAcceptanceLine[] = []
  for (const [index, item] of (value as unknown[]).entries()) {
    const record = asRecord(item)
    const line = text(record?.line, 300)
    if (line === undefined) return undefined
    lines.push({ id: text(record?.id, 20) ?? `L${index + 1}`, line, ...opt('ref', text(record?.ref, 100)) })
  }
  return lines
}

/**
 * One assessment, when it parses. Reads BOTH shapes: a v5
 * `assessments/<id>.json` (type quiz | practice, scope.resourceId) and a
 * legacy `quizzes/<id>.json` (a quiz — scope.bookId folds into resourceId).
 */
export function normalizeAssessment(value: unknown): LibraryAssessment | undefined {
  const record = asRecord(value)
  const assessmentId = id(record?.id)
  const scope = asRecord(record?.scope)
  if (record === undefined || assessmentId === undefined || scope === undefined) return undefined
  const nodeId = id(scope.nodeId)
  const resourceId = id(scope.resourceId) ?? id(scope.bookId)
  const type = record.type === 'practice' ? 'practice' as const : 'quiz' as const
  if (type === 'practice') {
    const rubric = normalizeRubricLines(record.rubric)
    if (rubric === undefined) return undefined
    return {
      id: assessmentId,
      type,
      scope: { ...opt('nodeId', nodeId), ...opt('resourceId', resourceId) },
      rubric,
      ...opt('supersededBy', id(record.supersededBy)),
      createdAt: stamp(record.createdAt),
    }
  }
  const questions = normalizeQuizQuestions(record.questions)
  if (questions === undefined) return undefined
  return {
    id: assessmentId,
    type,
    scope: { ...opt('nodeId', nodeId), ...opt('resourceId', resourceId) },
    ...(record.focus === 'mine' || record.focus === 'book' || record.focus === 'mixed' ? { focus: record.focus } : {}),
    questions,
    ...opt('supersededBy', id(record.supersededBy)),
    createdAt: stamp(record.createdAt),
  }
}

/** One attempt (one attempts.jsonl line), when it parses. */
export function normalizeAttempt(value: unknown): LibraryAttempt | undefined {
  const record = asRecord(value)
  const attemptId = id(record?.id)
  // v5 names the assessment; a v3/v4 quiz sitting carried quizId (the same
  // entity, the same id) and a v4 acceptance sitting carried nodeId (kept as
  // the legacy key, resolved through the node's practice assessment).
  const assessmentId = id(record?.assessmentId) ?? id(record?.quizId)
  const nodeId = id(record?.nodeId)
  const ratio = finite(record?.ratio)
  if (record === undefined || attemptId === undefined || (assessmentId === undefined && nodeId === undefined) || ratio === undefined || !Array.isArray(record.verdicts)) return undefined
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
      by: v.by === 'self' || v.by === 'user' || v.by === 'auto' ? v.by : 'llm',
      ...(v.void === true ? { void: true } : {}),
    })
  }
  return { id: attemptId, ...opt('assessmentId', assessmentId), ...opt('nodeId', nodeId), verdicts, ratio, at: stamp(record.at) }
}

/** One audit event (one events.jsonl line), when it parses. */
export function normalizeEvent(value: unknown): LibraryEvent | undefined {
  const record = asRecord(value)
  // The v3/v4 'book.added' reads as 'resource.added' — the shelf unified.
  const rawType = record?.type === 'book.added' ? 'resource.added' : record?.type
  const type = typeof rawType === 'string' && (LIBRARY_EVENT_TYPES as readonly string[]).includes(rawType)
    ? rawType as LibraryEventType
    : undefined
  if (record === undefined || type === undefined) return undefined
  const count = finite(record.count)
  const count2 = finite(record.count2)
  return {
    at: stamp(record.at),
    type,
    ...opt('id', text(record.id, 200)),
    ...opt('title', text(record.title, 300)),
    ...opt('resourceId', id(record.resourceId) ?? id(record.bookId)),
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
    out.set(sessionId, { projectId, ...opt('resourceId', id(binding?.resourceId) ?? id(binding?.bookId)) })
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

  /** The v5 resource file. */
  private resourceFile(projectId: string, resourceId: string): string {
    assertLibraryId(resourceId, 'resource id')
    return join(this.projectDir(projectId), 'resources', `${resourceId}.json`)
  }

  /** The legacy per-book directory (v3/v4 layout — read-only now). */
  private legacyBookDir(projectId: string, bookId: string): string {
    assertLibraryId(bookId, 'book id')
    return join(this.projectDir(projectId), 'books', bookId)
  }

  private cardsFile(projectId: string): string {
    return join(this.projectDir(projectId), 'cards.jsonl')
  }

  /** The legacy thin-links ledger (v3/v4 layout — read-only now). */
  private legacyResourcesFile(projectId: string): string {
    return join(this.projectDir(projectId), 'resources.jsonl')
  }

  private attemptsFile(projectId: string): string {
    return join(this.projectDir(projectId), 'attempts.jsonl')
  }

  private eventsFile(projectId: string): string {
    return join(this.projectDir(projectId), 'events.jsonl')
  }

  /** The v5 assessment file. */
  private assessmentFile(projectId: string, assessmentId: string): string {
    assertLibraryId(assessmentId, 'assessment id')
    return join(this.projectDir(projectId), 'assessments', `${assessmentId}.json`)
  }

  /** The legacy quiz file (v3/v4 layout — read-only now). */
  private legacyQuizFile(projectId: string, quizId: string): string {
    assertLibraryId(quizId, 'quiz id')
    return join(this.projectDir(projectId), 'quizzes', `${quizId}.json`)
  }

  /** The v5 roadmap file, keyed by its textbook. */
  private roadmapFile(projectId: string, resourceId: string, which: 'adopted' | 'draft'): string {
    assertLibraryId(resourceId, 'resource id')
    return join(this.projectDir(projectId), 'roadmaps', which === 'adopted' ? `${resourceId}.json` : `${resourceId}.draft.json`)
  }

  /** The legacy per-book roadmap file (v3/v4 layout — read-only now). */
  private legacyRoadmapFile(projectId: string, resourceId: string, which: 'adopted' | 'draft'): string {
    return join(this.legacyBookDir(projectId, resourceId), which === 'adopted' ? 'roadmap.json' : 'roadmap.draft.json')
  }

  /** The v5 pages ledger of one thick resource. */
  private pagesFile(projectId: string, resourceId: string): string {
    assertLibraryId(resourceId, 'resource id')
    return join(this.projectDir(projectId), 'pages', `${resourceId}.jsonl`)
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

  private projectFile(projectId: string): string {
    return join(this.projectDir(projectId), 'project.json')
  }

  /**
   * One shelf entry; undefined when absent. The v5 file wins; the legacy
   * spots follow (a book's `books/<id>/book.json`, then a thin link's
   * resources.jsonl line).
   */
  readResource(projectId: string, resourceId: string): LibraryResource | undefined {
    const current = this.readJsonFile(this.resourceFile(projectId, resourceId), normalizeResource)
    if (current !== undefined) return current
    const legacyBook = this.readJsonFile(join(this.legacyBookDir(projectId, resourceId), 'book.json'), normalizeResource)
    if (legacyBook !== undefined) return legacyBook
    return this.readJsonlFile(this.legacyResourcesFile(projectId), normalizeResource).find(resource => resource.id === resourceId)
  }

  /**
   * Every shelf entry of one project, both layouts merged (a v5 file shadows
   * a legacy twin of the same id): textbooks first in study order (`seq`,
   * then age — an unnumbered legacy textbook queues behind the numbered
   * ones), then thin links oldest first.
   */
  listResources(projectId: string): LibraryResource[] {
    const byId = new Map<string, LibraryResource>()
    const legacyDir = join(this.projectDir(projectId), 'books')
    if (existsSync(legacyDir)) {
      for (const entry of readdirSync(legacyDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !isLibraryId(entry.name)) continue
        const book = this.readJsonFile(join(legacyDir, entry.name, 'book.json'), normalizeResource)
        if (book !== undefined) byId.set(book.id, book)
      }
    }
    for (const link of this.readJsonlFile(this.legacyResourcesFile(projectId), normalizeResource)) {
      byId.set(link.id, link)
    }
    const resourcesDir = join(this.projectDir(projectId), 'resources')
    if (existsSync(resourcesDir)) {
      for (const name of readdirSync(resourcesDir)) {
        if (!name.endsWith('.json') || !isLibraryId(name.slice(0, -'.json'.length))) continue
        const resource = this.readJsonFile(join(resourcesDir, name), normalizeResource)
        if (resource !== undefined) byId.set(resource.id, resource)
      }
    }
    return [...byId.values()].sort(shelfOrder)
  }

  /**
   * One textbook's adopted roadmap, or its draft. The v5 file wins; the
   * legacy book directory follows. A retired project-level path (no
   * resource) reads as absent.
   */
  readRoadmap(projectId: string, resourceId: string | undefined, which: 'adopted' | 'draft' = 'adopted'): LibraryRoadmap | undefined {
    if (resourceId === undefined) return undefined
    const current = this.readJsonFile(this.roadmapFile(projectId, resourceId, which), normalizeRoadmap)
    if (current !== undefined) return { ...current, primaryResourceId: resourceId }
    const legacy = this.readJsonFile(this.legacyRoadmapFile(projectId, resourceId, which), normalizeRoadmap)
    return legacy === undefined ? undefined : { ...legacy, primaryResourceId: resourceId }
  }

  /**
   * One thick resource's photographed pages, oldest first — both layouts
   * merged: pages recorded before the v5 write cutover stay in the legacy
   * book directory, new ones append to `pages/<id>.jsonl`.
   */
  readPages(projectId: string, resourceId: string): LibraryPage[] {
    const legacy = this.readJsonlFile(join(this.legacyBookDir(projectId, resourceId), 'pages.jsonl'), normalizePage)
    const current = this.readJsonlFile(this.pagesFile(projectId, resourceId), normalizePage)
    return [...legacy, ...current]
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

  /**
   * One assessment; undefined when absent. The v5 file wins; a legacy quiz
   * file (`quizzes/<id>.json`) reads as a type=quiz assessment.
   */
  readAssessment(projectId: string, assessmentId: string): LibraryAssessment | undefined {
    const current = this.readJsonFile(this.assessmentFile(projectId, assessmentId), normalizeAssessment)
    if (current !== undefined) return current
    return this.readJsonFile(this.legacyQuizFile(projectId, assessmentId), normalizeAssessment)
  }

  /** Every assessment of one project, oldest first, both layouts merged. */
  listAssessments(projectId: string): LibraryAssessment[] {
    const byId = new Map<string, LibraryAssessment>()
    const quizzesDir = join(this.projectDir(projectId), 'quizzes')
    if (existsSync(quizzesDir)) {
      for (const name of readdirSync(quizzesDir)) {
        if (!name.endsWith('.json') || !isLibraryId(name.slice(0, -'.json'.length))) continue
        const quiz = this.readJsonFile(join(quizzesDir, name), normalizeAssessment)
        if (quiz !== undefined) byId.set(quiz.id, quiz)
      }
    }
    const assessmentsDir = join(this.projectDir(projectId), 'assessments')
    if (existsSync(assessmentsDir)) {
      for (const name of readdirSync(assessmentsDir)) {
        if (!name.endsWith('.json') || !isLibraryId(name.slice(0, -'.json'.length))) continue
        const assessment = this.readJsonFile(join(assessmentsDir, name), normalizeAssessment)
        if (assessment !== undefined) byId.set(assessment.id, assessment)
      }
    }
    return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
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

  /** Write one shelf entry (call inside `withProjectLock`) — the v5 layout. */
  writeResource(projectId: string, resource: LibraryResource): void {
    this.writeJsonFile(this.resourceFile(projectId, resource.id), resource)
  }

  /** Write one textbook's adopted roadmap or its draft (call inside `withProjectLock`) — the v5 layout. */
  writeRoadmap(projectId: string, roadmap: LibraryRoadmap): void {
    if (roadmap.primaryResourceId === undefined) throw new LibraryStoreError('a roadmap is written under its textbook (primaryResourceId)', 'corrupt')
    this.writeJsonFile(this.roadmapFile(projectId, roadmap.primaryResourceId, roadmap.status === 'adopted' ? 'adopted' : 'draft'), roadmap)
  }

  /** Drop one textbook's draft (adopted or discarded), in BOTH layouts. */
  removeDraft(projectId: string, resourceId: string): void {
    rmSync(this.roadmapFile(projectId, resourceId, 'draft'), { force: true })
    rmSync(this.legacyRoadmapFile(projectId, resourceId, 'draft'), { force: true })
  }

  /** Append one photographed page (call inside `withProjectLock`) — the v5 layout. */
  appendPage(projectId: string, page: LibraryPage): void {
    this.appendJsonlFile(this.pagesFile(projectId, page.resourceId), [page])
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

  /** Write one assessment (call inside `withProjectLock`) — the v5 layout. */
  writeAssessment(projectId: string, assessment: LibraryAssessment): void {
    this.writeJsonFile(this.assessmentFile(projectId, assessment.id), assessment)
  }

  /**
   * Remove one shelf entry: the v5 file, its pages ledger, its roadmap files,
   * and any legacy trace (the book directory, the resources.jsonl line).
   */
  removeResource(projectId: string, resourceId: string): void {
    rmSync(this.resourceFile(projectId, resourceId), { force: true })
    rmSync(this.pagesFile(projectId, resourceId), { force: true })
    rmSync(this.roadmapFile(projectId, resourceId, 'adopted'), { force: true })
    rmSync(this.roadmapFile(projectId, resourceId, 'draft'), { force: true })
    rmSync(this.legacyBookDir(projectId, resourceId), { recursive: true, force: true })
    if (existsSync(this.legacyResourcesFile(projectId))) {
      const kept = this.readJsonlFile(this.legacyResourcesFile(projectId), normalizeResource).filter(resource => resource.id !== resourceId)
      this.writeTextFile(this.legacyResourcesFile(projectId), kept.map(resource => `${JSON.stringify(resource)}\n`).join(''))
    }
  }

  /** Remove one project's whole directory. */
  removeProject(projectId: string): void {
    rmSync(this.projectDir(projectId), { recursive: true, force: true })
    rmSync(this.projectLock(projectId), { force: true })
  }

  /**
   * v2 → covers: wrap every stored roadmap node's `chapterRanges` into a book
   * cover (the v2 paths are all per-book). Idempotent, each project's files
   * rewritten under its own lock, the index bump last — a crash midway leaves
   * the old version and the next run resumes. v1 roots were never deployed:
   * they read as empty and are NOT migrated. Reads never wait for this pass —
   * `normalizeRoadmap` wraps a v2 node on the fly.
   *
   * @returns whether a migration ran.
   */
  async migrateState(): Promise<boolean> {
    if (!this.available) return false
    let raw: string
    try {
      raw = readFileSync(this.indexFile, 'utf8')
    } catch {
      return false // no index yet — nothing to migrate
    }
    let version: unknown
    try {
      version = (JSON.parse(raw) as { version?: unknown }).version
    } catch {
      return false // a corrupt index stays a hand-fix matter, not a migration's
    }
    if (version !== 2) return false
    await this.withIndexLock(async () => {
      const index = this.readIndex()
      for (const project of index.projects) {
        await this.withProjectLock(project.id, () => {
          this.migrateProjectRoadmapsV2(project.id)
        })
      }
      this.writeIndex({ ...index, version: LIBRARY_STATE_VERSION })
    })
    return true
  }

  /** Rewrite one project's v2 book roadmaps (adopted and draft) into covers. */
  private migrateProjectRoadmapsV2(projectId: string): void {
    const dir = join(this.projectDir(projectId), 'books')
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isLibraryId(entry.name)) continue
      for (const file of ['roadmap.json', 'roadmap.draft.json']) {
        const path = join(dir, entry.name, file)
        let parsed: unknown
        try {
          parsed = JSON.parse(readFileSync(path, 'utf8'))
        } catch {
          continue // absent or corrupt — reads treat it as absent either way
        }
        const roadmap = asRecord(parsed)
        if (roadmap === undefined || !Array.isArray(roadmap.nodes)) continue
        let touched = false
        const nodes = (roadmap.nodes as unknown[]).map(item => {
          const node = asRecord(item)
          if (node === undefined || node.covers !== undefined || node.chapterRanges === undefined) return item
          touched = true
          const { chapterRanges, ...rest } = node
          return { ...rest, covers: [{ kind: 'book', bookId: entry.name, ranges: Array.isArray(chapterRanges) ? chapterRanges : [] }] }
        })
        if (touched) this.writeJsonFile(path, { ...roadmap, nodes })
      }
    }
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
