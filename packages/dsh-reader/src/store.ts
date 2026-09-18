/**
 * The host-side state store: one JSON document under the deployment's state
 * root, holding the source list and, per source, the raw payload of its last
 * fetch plus that fetch's metadata.
 *
 * **Why plain `node:fs` and not `ctx.fs`.** `ctx.fs` is the SANDBOXED
 * filesystem: every mutation is fenced by the calling session's policy, so a
 * workspace-write session refuses a write to `$DSH_HOME/state` with
 * `FS_SANDBOX_DENIED` — which is exactly what happened on the acceptance
 * instance, where a subscription failed with
 * `cannot write "…/state/dsh-reader/state.json": file access denied under
 * workspace-write mode`. That fence is correct and must stay; the mistake is
 * aiming a session-fenced capability at host-owned durable state. This
 * package's state belongs to the DEPLOYMENT, not to whichever session happened
 * to click "fetch", so it is written the way this repo's other host-state
 * packages write theirs (`packages/lab/src/state.ts`): `node:fs`, atomic
 * via a temporary file plus rename.
 *
 * The rest of the contract is unchanged and is why this file exists:
 *
 * - a missing document reads as empty, and a **corrupt** one refuses rather
 *   than being overwritten, so a hand-edited file stays visible until its
 *   owner fixes it instead of being silently destroyed by the next refresh;
 * - an unwritable root degrades to memory-only instead of taking the plugin
 *   down, because a composition must never fail for lack of a writable disk;
 * - nothing here parses a feed. The document stores raw payloads, and the
 *   browser half — the only side with a DOM parser — turns them into entries.
 *
 * @module @khorsheed/dsh-reader/store
 */
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_CACHE_POLICY,
  type ReaderCachePolicy,
  MAX_BODY_CHARS_PER_SOURCE,
  MAX_TOTAL_BODY_CHARS,
  STATE_ROOT_SEGMENT,
  type ReaderEntryAnnotation,
  type ReaderPreviewFailure,
  type ReaderPreviewFailureCode,
  type ReaderSource,
  type ReaderStateDoc,
  type ReaderTag,
} from './types.ts'

/** The failure codes the document may carry, for normalization. */
const PREVIEW_FAILURE_CODES: ReadonlySet<string> = new Set<ReaderPreviewFailureCode>([
  'blocked', 'login', 'unsupported-type', 'redirected', 'empty', 'unreachable', 'http',
])

/** How many tags one document may define (a vocabulary, not a folksonomy dump). */
export const MAX_TAGS = 200

/** How many entries may carry fetched bodies, before the newest-first eviction. */
export const MAX_CACHED_BODIES = 500

/** The state file name inside the plugin's state root. */
export const READER_STATE_FILE_NAME = 'state.json'

/** A store failure that the service maps onto a wire outcome. */
export class ReaderStoreError extends Error {
  constructor(message: string, readonly kind: 'io' | 'corrupt') {
    super(message)
    this.name = 'ReaderStoreError'
  }
}

/** A read result: the document plus the token the next write must present. */
export interface ReaderStoreRead {
  readonly doc: ReaderStateDoc
  /**
   * The document's freshness token, or `null` when there is no file yet.
   *
   * Only this process writes the reader's state, so the token exists to make a
   * same-process read-modify-write honest (an external editor between the two
   * is detected) rather than to coordinate writers.
   */
  readonly version: string | null
}

/**
 * Resolve the state root: an explicit config value wins, then
 * `$DSH_HOME/state/dsh-reader`, then `<cwd>/.dsh-reader`.
 *
 * @param configured - the plugin-provided override, if any.
 * @returns the absolute state root directory.
 */
export function resolveReaderStateRoot(configured: string | undefined): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return join(home, 'state', STATE_ROOT_SEGMENT)
  return join(process.cwd(), `.${STATE_ROOT_SEGMENT}`)
}

/** The empty document. */
export function emptyStateDoc(): ReaderStateDoc {
  return { version: 1, sources: [], refresh: { enabled: true, timeOfDay: '10:00' } }
}

/** Serialize the document (trailing newline, the repo's state-file shape). */
export function serializeStateDoc(doc: ReaderStateDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`
}

/**
 * Coerce a parsed value into a document, dropping anything unrecognizable
 * rather than trusting the file: this is user-editable state.
 *
 * @param value - the parsed JSON.
 * @returns a valid document.
 */
export function normalizeStateDoc(value: unknown): ReaderStateDoc {
  const base = emptyStateDoc()
  if (typeof value !== 'object' || value === null) return base
  const record = value as Record<string, unknown>
  const sources = Array.isArray(record.sources) ? record.sources : []
  const refresh = typeof record.refresh === 'object' && record.refresh !== null
    ? record.refresh as Record<string, unknown>
    : {}
  return {
    version: 1,
    sources: sources.flatMap(item => {
      const source = normalizeSource(item)
      return source === undefined ? [] : [source]
    }),
    refresh: {
      enabled: refresh.enabled !== false,
      timeOfDay: typeof refresh.timeOfDay === 'string' && /^\d{1,2}:\d{2}$/.test(refresh.timeOfDay)
        ? refresh.timeOfDay
        : base.refresh.timeOfDay,
    },
    ...(typeof record.lastRefreshAt === 'string' ? { lastRefreshAt: record.lastRefreshAt } : {}),
    ...(() => {
      const cache = normalizeCachePolicy(record.cache)
      return cache === undefined ? {} : { cache }
    })(),
    ...(() => {
      const tags = normalizeTags(record.tags)
      return Object.keys(tags).length > 0 ? { tags } : {}
    })(),
    ...(() => {
      const annotations = normalizeAnnotations(record.annotations)
      return Object.keys(annotations).length > 0 ? { annotations } : {}
    })(),
  }
}

/** The cache policy, coerced to something usable (absent = the default). */
function normalizeCachePolicy(value: unknown): ReaderCachePolicy | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const ttlHours = typeof record.ttlHours === 'number' && Number.isFinite(record.ttlHours) && record.ttlHours >= 0
    ? Math.min(record.ttlHours, 24 * 90)
    : DEFAULT_CACHE_POLICY.ttlHours
  const maxEntries = typeof record.maxEntries === 'number' && Number.isFinite(record.maxEntries) && record.maxEntries > 0
    ? Math.min(Math.floor(record.maxEntries), 5_000)
    : DEFAULT_CACHE_POLICY.maxEntries
  return { ttlHours, maxEntries }
}

/** The tag vocabulary, dropping anything without an id and a name. */
function normalizeTags(value: unknown): Record<string, ReaderTag> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, ReaderTag> = {}
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (id.length === 0 || name.length === 0) continue
    out[id] = {
      id,
      name: name.slice(0, 40),
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString(),
    }
    if (Object.keys(out).length >= MAX_TAGS) break
  }
  return out
}

/** The per-entry annotations, dropping entries that carry nothing. */
function normalizeAnnotations(value: unknown): Record<string, ReaderEntryAnnotation> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, ReaderEntryAnnotation> = {}
  for (const [entryId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entryId.length === 0 || typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const body = normalizeBody(record.body)
    const tagIds = Array.isArray(record.tagIds)
      ? [...new Set(record.tagIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
      : []
    const annotation: ReaderEntryAnnotation = {
      ...(body === undefined ? {} : { body }),
      ...(tagIds.length > 0 ? { tagIds } : {}),
      ...(typeof record.error === 'string' ? { error: record.error.slice(0, 500) } : {}),
      ...(typeof record.failedAt === 'string' ? { failedAt: record.failedAt } : {}),
    }
    if (annotation.body === undefined && annotation.tagIds === undefined && annotation.error === undefined) continue
    out[entryId] = annotation
  }
  return out
}

/** One cached body, when it carries the fields that make it one. */
function normalizeBody(value: unknown): ReaderEntryAnnotation['body'] {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.html !== 'string' || record.html.length === 0) return undefined
  return {
    html: record.html,
    fetchedAt: typeof record.fetchedAt === 'string' ? record.fetchedAt : new Date(0).toISOString(),
    expiresAt: typeof record.expiresAt === 'string' ? record.expiresAt : new Date(0).toISOString(),
    url: typeof record.url === 'string' ? record.url : '',
    ...(record.truncated === true ? { truncated: true } : {}),
  }
}

/** One source, or `undefined` when it lacks the fields that make it one. */
function normalizeSource(value: unknown): ReaderSource | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id : undefined
  const url = typeof record.url === 'string' ? record.url : undefined
  if (id === undefined || url === undefined) return undefined
  const kind = record.kind === 'link' ? 'link' : 'rss'
  const status = record.status === 'ok' || record.status === 'fetching' || record.status === 'error'
    ? record.status
    : undefined
  const failure = normalizePreviewFailure(record.failure)
  return {
    id,
    kind,
    url,
    label: typeof record.label === 'string' && record.label.length > 0 ? record.label : url,
    enabled: record.enabled !== false,
    addedAt: typeof record.addedAt === 'string' ? record.addedAt : new Date(0).toISOString(),
    ...(typeof record.fetchedAt === 'string' ? { fetchedAt: record.fetchedAt } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
    ...(record.truncated === true ? { truncated: true } : {}),
    ...(failure === undefined ? {} : { failure }),
    ...(typeof record.raw === 'string' ? { raw: record.raw } : {}),
    ...(typeof record.timeOfDay === 'string' ? { timeOfDay: record.timeOfDay } : {}),
  }
}

/**
 * One recorded preview failure, or `undefined` when the record is not one.
 *
 * An unknown code is dropped rather than trusted: the union is what the
 * browser switches on, and a code this build does not know would render as a
 * missing sentence instead of a diagnosis.
 *
 * @param value - the persisted field.
 * @returns the normalized failure, or `undefined`.
 */
function normalizePreviewFailure(value: unknown): ReaderPreviewFailure | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const code = record.code
  if (typeof code !== 'string' || !PREVIEW_FAILURE_CODES.has(code)) return undefined
  return {
    code: code as ReaderPreviewFailureCode,
    message: typeof record.message === 'string' ? record.message.slice(0, 500) : '',
    at: typeof record.at === 'string' ? record.at : new Date(0).toISOString(),
  }
}

/**
 * Bound the document's payload bytes without dropping a subscription.
 *
 * Newest-first: the freshest payload is the one the reader is most likely to
 * open, so it survives and the oldest bodies are the ones released. Keeping
 * every source row regardless is deliberate — a source whose body was evicted
 * still refreshes, and dropping subscriptions to save space would be a silent
 * data loss the reader never asked for.
 *
 * @param doc - the document to bound.
 * @returns the bounded document, and whether anything was released.
 */
export function boundPayloads(doc: ReaderStateDoc): { doc: ReaderStateDoc; changed: boolean } {
  let changed = false
  // Walk NEWEST first and keep what fits: the reader's most recent material is
  // what it is about to read, so the budget must evict the other end. Walking
  // oldest-first and stopping at the budget would do the opposite (it keeps the
  // stale payloads and drops what just arrived) — the order here is the point.
  const byNewest = [...doc.sources].sort((a, b) => (b.fetchedAt ?? '').localeCompare(a.fetchedAt ?? ''))
  const trimmed = new Map<string, ReaderSource>()
  let total = 0
  for (const source of byNewest) {
    const raw = source.raw
    if (raw === undefined) continue
    if (raw.length > MAX_BODY_CHARS_PER_SOURCE) {
      // Keep as much as the per-source budget allows and say it is partial:
      // dropping the whole body would lose an article the reader just added,
      // and the detail view already knows how to render a truncated body.
      trimmed.set(source.id, { ...source, raw: raw.slice(0, MAX_BODY_CHARS_PER_SOURCE), truncated: true })
      total += MAX_BODY_CHARS_PER_SOURCE
      changed = true
      continue
    }
    if (total + raw.length > MAX_TOTAL_BODY_CHARS) {
      // Over budget: this payload (and every older one) loses its body. The
      // source itself stays — dropping subscriptions to save space would be a
      // silent data loss the reader never asked for.
      const { raw: _dropped, ...withoutRaw } = source
      trimmed.set(source.id, withoutRaw)
      changed = true
      continue
    }
    total += raw.length
    trimmed.set(source.id, source)
  }
  if (!changed) return { doc, changed }
  return {
    doc: { ...doc, sources: doc.sources.map(s => trimmed.get(s.id) ?? s) },
    changed,
  }
}

/** Native-fs state store: the deployment's document, not the session's. */
export class ReaderStore {
  private readonly stateRoot: string
  private readonly file: string
  /** Set once the root has proven unwritable; the service then goes memory-only. */
  private unwritable: string | undefined

  /**
   * @param config - optional state-root override.
   */
  constructor(config: { stateRoot?: string } = {}) {
    this.stateRoot = resolveReaderStateRoot(config.stateRoot)
    this.file = join(this.stateRoot, READER_STATE_FILE_NAME)
  }

  /** The absolute path of the state file (diagnostics and tests). */
  get path(): string {
    return this.file
  }

  /** Why persistence is unavailable, when it is. */
  get unavailableReason(): string | undefined {
    return this.unwritable
  }

  /**
   * Whether persistence is available.
   *
   * Probed by creating the state root, not by asking a capability: a
   * read-only deployment (a container with no writable home) must degrade to
   * memory-only, and that is only knowable by trying.
   */
  get available(): boolean {
    if (this.unwritable !== undefined) return false
    try {
      mkdirSync(this.stateRoot, { recursive: true })
      return true
    } catch (error) {
      this.unwritable = `${this.stateRoot}: ${errorMessage(error)}`
      return false
    }
  }

  /**
   * Read the document tolerantly.
   *
   * @returns the document and its freshness token; a missing file reads as empty.
   * @throws ReaderStoreError when the file exists but does not parse.
   */
  async read(): Promise<ReaderStoreRead> {
    if (!this.available) return { doc: emptyStateDoc(), version: null }
    let text: string
    try {
      text = readFileSync(this.file, 'utf8')
    } catch (error) {
      if (isMissing(error)) return { doc: emptyStateDoc(), version: null }
      throw new ReaderStoreError(`reader: ${this.file} could not be read — ${errorMessage(error)}`, 'io')
    }
    try {
      return { doc: normalizeStateDoc(JSON.parse(text)), version: String(text.length) + ':' + String(statSync(this.file).mtimeMs) }
    } catch (error) {
      if (error instanceof ReaderStoreError) throw error
      // Refuse rather than clobber: the file is the user's subscriptions.
      throw new ReaderStoreError(
        `reader: ${this.file} does not parse — fix or remove it by hand`,
        'corrupt',
      )
    }
  }

  /**
   * Write the document atomically under the token from the last read.
   *
   * @param doc - the document to publish.
   * @param version - the token from the last read (`null` for the first write).
   * @returns the new freshness token.
   */
  async write(doc: ReaderStateDoc, version: string | null): Promise<string> {
    if (!this.available) throw new ReaderStoreError('reader: no writable state root', 'io')
    // A concurrent external edit between our read and write: refuse instead of
    // publishing over a document we never saw. Only this process writes, so a
    // mismatch means a hand edit, and the next read will surface it loudly.
    if (version !== null) {
      const current = await this.read()
      if (current.version !== version) {
        throw new ReaderStoreError(`reader: ${this.file} changed underneath this write`, 'io')
      }
    }
    const temporary = `${this.file}.${process.pid}.tmp`
    try {
      writeFileSync(temporary, serializeStateDoc(doc))
      renameSync(temporary, this.file)
    } catch (error) {
      rmSync(temporary, { force: true })
      throw new ReaderStoreError(`reader: ${this.file} could not be written — ${errorMessage(error)}`, 'io')
    }
    const text = serializeStateDoc(doc)
    return String(text.length) + ':' + String(statSync(this.file).mtimeMs)
  }

  /**
   * Read-modify-write with the one concurrent-edit retry.
   *
   * @param mutate - pure function from the current document to the next one.
   * @returns the document that ended up on disk.
   */
  async update(mutate: (doc: ReaderStateDoc) => ReaderStateDoc): Promise<ReaderStateDoc> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { doc, version } = await this.read()
      const next = boundAnnotations(boundPayloads(mutate(doc)).doc).doc
      try {
        await this.write(next, version)
        return next
      } catch (error) {
        // An external edit moved the document between our read and write.
        // One retry is the contract; a second failure is a real io problem.
        if (attempt === 1 || !(error instanceof ReaderStoreError) || error.kind !== 'io') throw error
      }
    }
    /* v8 ignore next -- the loop either returns or throws */
    throw new ReaderStoreError('reader: could not commit after a concurrent-edit retry', 'io')
  }
}

/** Whether a native fs failure is "there is no file yet". */
function isMissing(error: unknown): boolean {
  return (error as { code?: string } | undefined)?.code === 'ENOENT'
}

/** A native fs failure's message, with its code, for the wire. */
function errorMessage(error: unknown): string {
  const code = (error as { code?: string } | undefined)?.code
  const message = error instanceof Error ? error.message : String(error)
  return code === undefined ? message : `${code}: ${message}`
}

/**
 * Bound the cached article bodies without touching what the reader authored.
 *
 * Newest-first: the article just fetched is the one being read, so the budget
 * releases the older copies. Tags are NOT part of this budget — a tag is a
 * sentence the reader wrote, and losing it to make room for a cached page would
 * be the worst trade in this document.
 *
 * @param doc - the document to bound.
 * @returns the bounded document, and whether anything was released.
 */
export function boundAnnotations(doc: ReaderStateDoc): { doc: ReaderStateDoc; changed: boolean } {
  const annotations = doc.annotations
  if (annotations === undefined) return { doc, changed: false }
  const withBody = Object.entries(annotations).filter(([, entry]) => entry.body !== undefined)
  const limit = Math.max(1, doc.cache?.maxEntries ?? MAX_CACHED_BODIES)
  if (withBody.length <= limit) return { doc, changed: false }
  const keep = new Set(
    [...withBody]
      .sort((a, b) => (b[1].body?.fetchedAt ?? '').localeCompare(a[1].body?.fetchedAt ?? ''))
      .slice(0, limit)
      .map(([entryId]) => entryId),
  )
  const next: Record<string, ReaderEntryAnnotation> = {}
  for (const [entryId, entry] of Object.entries(annotations)) {
    if (entry.body === undefined || keep.has(entryId)) { next[entryId] = entry; continue }
    const { body: _released, ...rest } = entry
    if (rest.tagIds === undefined && rest.error === undefined) continue
    next[entryId] = rest
  }
  return { doc: { ...doc, annotations: next }, changed: true }
}

/**
 * Drop tags nothing references any more.
 *
 * @param doc - the document to prune.
 * @returns the pruned document, and how many tags went.
 */
export function pruneOrphanTags(doc: ReaderStateDoc): { doc: ReaderStateDoc; removed: number } {
  const annotations = doc.annotations ?? {}
  const used = new Set(Object.values(annotations).flatMap(entry => entry.tagIds ?? []))
  const tags = doc.tags ?? {}
  const kept: Record<string, ReaderTag> = {}
  let removed = 0
  for (const [id, tag] of Object.entries(tags)) {
    if (used.has(id)) kept[id] = tag
    else removed += 1
  }
  if (removed === 0) return { doc, removed }
  return { doc: { ...doc, tags: kept }, removed }
}
