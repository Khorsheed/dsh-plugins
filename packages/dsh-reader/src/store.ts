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
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_CACHE_POLICY,
  type ReaderCachePolicy,
  MAX_BODY_CHARS_PER_SOURCE,
  MAX_TOTAL_BODY_CHARS,
  MAX_TRANSLATION_MEMORY_ENTRIES,
  STATE_ROOT_SEGMENT,
  TRANSLATION_STORAGE_VERSION,
  type ReaderEntryAnnotation,
  type ReaderEntryFetchRecord,
  type ReaderEntryTranslation,
  type ReaderPreviewFailure,
  type ReaderPreviewFailureCode,
  type ReaderRecentEntry,
  type ReaderSource,
  type ReaderStateDoc,
  type ReaderTag,
  type ReaderTranslationMemoryEntry,
  type ReaderTranslationMemoryManifest,
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
    ...(() => {
      const translationMemory = normalizeTranslationMemory(record.translationMemory)
      return translationMemory === undefined ? {} : { translationMemory }
    })(),
    ...(() => {
      const recent = normalizeRecent(record.recent)
      return recent.length > 0 ? { recent } : {}
    })(),
  }
}

/**
 * How many opened entries the recent list keeps.
 *
 * A bounded list is what makes the page useful: the question it answers is
 * "what was I just reading", and a year of history answers it worse than the
 * last hundred items. The cap is also what keeps `state.json` small, since this
 * is the one table that grows with READING rather than with sources.
 */
export const MAX_RECENT_ENTRIES = 100

/**
 * The recent list, dropping anything without the two ids and a timestamp.
 *
 * The order is the file's, which is newest-first by construction (the service
 * unshifts); a hand-edited file that disagrees still renders in its own order,
 * which is the honest reading of what is on disk.
 */
function normalizeRecent(value: unknown): ReaderRecentEntry[] {
  if (!Array.isArray(value)) return []
  const out: ReaderRecentEntry[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const entryId = typeof record.entryId === 'string' ? record.entryId.trim() : ''
    const sourceId = typeof record.sourceId === 'string' ? record.sourceId.trim() : ''
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    const readAt = typeof record.readAt === 'string' ? record.readAt : ''
    // An entry with no title is still worth keeping — the reader may have
    // opened something the feed never titled — but one with no IDs cannot be
    // reopened, and one with no timestamp cannot be ordered.
    if (entryId.length === 0 || sourceId.length === 0 || readAt.length === 0) continue
    if (seen.has(entryId)) continue
    seen.add(entryId)
    out.push({
      entryId,
      sourceId,
      title: title.slice(0, 300),
      ...(typeof record.url === 'string' && record.url.length > 0 ? { url: record.url } : {}),
      readAt,
    })
    if (out.length >= MAX_RECENT_ENTRIES) break
  }
  return out
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
  const translationBudgetChars = typeof record.translationBudgetChars === 'number'
    && Number.isFinite(record.translationBudgetChars) && record.translationBudgetChars > 0
    ? Math.min(Math.floor(record.translationBudgetChars), 1024 * 1024 * 1024)
    : undefined
  return {
    ttlHours,
    maxEntries,
    ...(translationBudgetChars === undefined ? {} : { translationBudgetChars }),
  }
}

/** A `bodies/` file name is one path segment, or it is not a name we wrote. */
function normalizeFileName(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) ? value : undefined
}

/** The global memory's manifest; kept as recorded (a version bump reads as a miss, lazily). */
function normalizeTranslationMemory(value: unknown): ReaderTranslationMemoryManifest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const file = normalizeFileName(record.file)
  if (typeof record.version !== 'number' || file === undefined) return undefined
  return {
    version: record.version,
    file,
    entries: typeof record.entries === 'number' && Number.isFinite(record.entries) ? Math.max(0, Math.floor(record.entries)) : 0,
    chars: typeof record.chars === 'number' && Number.isFinite(record.chars) ? Math.max(0, Math.floor(record.chars)) : 0,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
  }
}

/**
 * One entry's translation segment map, when it carries the fields that make it
 * one. The schema version is preserved as recorded: a mismatch is a MISS when
 * the record is served, and the record is evicted by the next write or budget
 * pass — never by the read path.
 */
function normalizeTranslation(value: unknown): ReaderEntryTranslation | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.version !== 'number') return undefined
  const pair = typeof record.pair === 'string' ? record.pair : ''
  const bodyHash = typeof record.bodyHash === 'string' ? record.bodyHash : ''
  if (pair.length === 0 || bodyHash.length === 0) return undefined
  const segments = typeof record.segments === 'object' && record.segments !== null
    ? Object.fromEntries(Object.entries(record.segments as Record<string, unknown>)
      .filter(([, target]) => typeof target === 'string') as [string, string][])
    : undefined
  const file = normalizeFileName(record.file)
  if (segments === undefined && file === undefined) return undefined
  return {
    version: record.version,
    pair,
    bodyHash,
    ...(segments !== undefined && Object.keys(segments).length > 0 ? { segments } : {}),
    ...(file === undefined ? {} : { file }),
    ...(typeof record.chars === 'number' && Number.isFinite(record.chars) ? { chars: record.chars } : {}),
    translatedAt: typeof record.translatedAt === 'string' ? record.translatedAt : new Date(0).toISOString(),
    lastUsedAt: typeof record.lastUsedAt === 'string' ? record.lastUsedAt : new Date(0).toISOString(),
  }
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
    const fetch = normalizeFetch(record.fetch)
    const translation = normalizeTranslation(record.translation)
    const failureCode = PREVIEW_FAILURE_CODES.has(String(record.failureCode))
      ? (record.failureCode as ReaderPreviewFailureCode)
      : undefined
    const annotation: ReaderEntryAnnotation = {
      ...(body === undefined ? {} : { body }),
      ...(fetch === undefined ? {} : { fetch }),
      ...(translation === undefined ? {} : { translation }),
      ...(tagIds.length > 0 ? { tagIds } : {}),
      ...(typeof record.error === 'string' ? { error: record.error.slice(0, 500) } : {}),
      ...(failureCode === undefined ? {} : { failureCode }),
      ...(typeof record.failedAt === 'string' ? { failedAt: record.failedAt } : {}),
    }
    // A `fetch` record alone is a real annotation: it is what says "the payload
    // is on disk waiting to be extracted". Dropping it here lost every stored
    // payload on the next read. A `translation` is the same kind of load-bearing:
    // it is the whole point of the translation store.
    if (annotation.body === undefined && annotation.fetch === undefined && annotation.tagIds === undefined
      && annotation.error === undefined && annotation.translation === undefined) continue
    out[entryId] = annotation
  }
  return out
}

/**
 * One in-flight or stored-raw record, when it carries the fields that make it one.
 *
 * @param value - the persisted field.
 * @returns the normalized record, or `undefined`.
 */
function normalizeFetch(value: unknown): ReaderEntryFetchRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const state = record.state === 'fetching' || record.state === 'raw' ? record.state : undefined
  if (state === undefined) return undefined
  const rawFile = typeof record.rawFile === 'string' && record.rawFile.length > 0 ? record.rawFile : undefined
  return {
    state,
    at: typeof record.at === 'string' ? record.at : new Date(0).toISOString(),
    ...(rawFile === undefined ? {} : { rawFile }),
    ...(typeof record.chars === 'number' && Number.isFinite(record.chars) ? { chars: record.chars } : {}),
    ...(typeof record.url === 'string' ? { url: record.url } : {}),
    ...(record.truncated === true ? { truncated: true } : {}),
  }
}

/** One cached body, when it carries the fields that make it one. */
function normalizeBody(value: unknown): ReaderEntryAnnotation['body'] {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const inline = typeof record.html === 'string' && record.html.length > 0
  // A large body lives in `bodies/` and the document keeps its file name: a body
  // with neither the markup nor a file is not a body.
  const file = typeof record.file === 'string' && record.file.length > 0 ? record.file : undefined
  if (!inline && file === undefined) return undefined
  return {
    ...(inline ? { html: record.html as string } : {}),
    ...(file === undefined ? {} : { file }),
    ...(typeof record.chars === 'number' && Number.isFinite(record.chars) ? { chars: record.chars } : {}),
    fetchedAt: typeof record.fetchedAt === 'string' ? record.fetchedAt : new Date(0).toISOString(),
    expiresAt: typeof record.expiresAt === 'string' ? record.expiresAt : new Date(0).toISOString(),
    url: typeof record.url === 'string' ? record.url : '',
    ...(record.truncated === true ? { truncated: true } : {}),
    // Without this the script-figure note survived exactly one read: the body is
    // normalized on EVERY load, so a field the normalizer forgets is a field the
    // document silently loses.
    ...(typeof record.scriptFigures === 'number' && Number.isFinite(record.scriptFigures)
      ? { scriptFigures: record.scriptFigures }
      : {}),
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

/** Sub-directory holding bodies too large to inline in the document. */
export const READER_BODIES_DIR = 'bodies'

/**
 * The global translation memory's file name inside `bodies/`.
 *
 * One fixed name rather than a per-key hash: the table is a single artifact,
 * rewritten whole by the (already debounced) write path, and referenced from
 * the document's `translationMemory` manifest so `pruneBodies` keeps it.
 */
export const TRANSLATION_MEMORY_FILE = 'translation-memory.json'

/** Native-fs state store: the deployment's document, not the session's. */
export class ReaderStore {
  private readonly stateRoot: string
  private readonly file: string
  private readonly bodiesDir: string
  /** Set once the root has proven unwritable; the service then goes memory-only. */
  private unwritable: string | undefined

  /**
   * @param config - optional state-root override.
   */
  constructor(config: { stateRoot?: string } = {}) {
    this.stateRoot = resolveReaderStateRoot(config.stateRoot)
    this.file = join(this.stateRoot, READER_STATE_FILE_NAME)
    this.bodiesDir = join(this.stateRoot, READER_BODIES_DIR)
  }

  /**
   * Write one body to its own file, atomically, and return the file's name.
   *
   * The name is a digest of the entry id: entry ids are URLs, and a document
   * carrying an absolute path (or a path derived from remote text) is a
   * directory-traversal waiting to happen.
   *
   * @param entryId - the entry the body belongs to.
   * @param html - the normalized body markup.
   * @returns the file name to store in the document.
   */
  writeBody(entryId: string, html: string): string {
    const name = `${bodyFileName(entryId)}.html`
    mkdirSync(this.bodiesDir, { recursive: true })
    const target = join(this.bodiesDir, name)
    const temporary = `${target}.${process.pid}.tmp`
    try {
      writeFileSync(temporary, html)
      renameSync(temporary, target)
    } catch (error) {
      rmSync(temporary, { force: true })
      throw new ReaderStoreError(`reader: ${target} could not be written — ${errorMessage(error)}`, 'io')
    }
    return name
  }

  /**
   * Write one NAMED artifact into `bodies/`, atomically.
   *
   * Unlike {@link writeBody} the name is the caller's, not a hash of an entry
   * id: the global translation memory is one fixed file, not one per entry. The
   * name is validated to a bare file name — this directory must never grow a
   * path.
   *
   * @param name - the bare file name to write.
   * @param content - the file's content.
   * @returns the name written.
   */
  writeNamedBody(name: string, content: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
      throw new ReaderStoreError(`reader: refusing to write ${name} — not a bare file name`, 'io')
    }
    mkdirSync(this.bodiesDir, { recursive: true })
    const target = join(this.bodiesDir, name)
    const temporary = `${target}.${process.pid}.tmp`
    try {
      writeFileSync(temporary, content)
      renameSync(temporary, target)
    } catch (error) {
      rmSync(temporary, { force: true })
      throw new ReaderStoreError(`reader: ${target} could not be written — ${errorMessage(error)}`, 'io')
    }
    return name
  }

  /**
   * Read one body file.
   *
   * @param name - the file name recorded in the document.
   * @returns the markup, or `undefined` when the file is gone or unreadable.
   */
  readBody(name: string): string | undefined {
    try {
      return readFileSync(join(this.bodiesDir, name), 'utf8')
    } catch {
      // A body file the reader deleted by hand is not an error: the entry simply
      // has no cache, and the next open fetches it again.
      return undefined
    }
  }

  /**
   * Delete body files the document no longer references.
   *
   * Eviction (`maxEntries`), tag edits that drop an annotation, and a hand-edited
   * document all release bodies by REMOVING them from the JSON — which would
   * otherwise leave their files on disk forever. Best-effort by design: a failed
   * sweep must never fail the commit that triggered it.
   *
   * @param doc - the document that was just written.
   * @returns how many files were removed.
   */
  pruneBodies(doc: ReaderStateDoc): number {
    const referenced = new Set<string>()
    for (const annotation of Object.values(doc.annotations ?? {})) {
      if (annotation.body?.file !== undefined) referenced.add(annotation.body.file)
      // A fetched-but-not-yet-extracted payload is referenced too: deleting it
      // would throw away a download the reader waited for.
      if (annotation.fetch?.rawFile !== undefined) referenced.add(annotation.fetch.rawFile)
      // A large translation segment map is a sidecar file like any body.
      if (annotation.translation?.file !== undefined) referenced.add(annotation.translation.file)
    }
    // The global translation memory's table is one named file in the same dir.
    if (doc.translationMemory !== undefined) referenced.add(doc.translationMemory.file)
    let names: string[]
    try {
      names = readdirSync(this.bodiesDir)
    } catch {
      return 0
    }
    let removed = 0
    for (const name of names) {
      if (referenced.has(name)) continue
      try {
        // Anything unreferenced goes, including a half-written `.tmp` from a
        // crashed process.
        rmSync(join(this.bodiesDir, name), { force: true })
        removed += 1
      } catch {
        // Leave it; the next commit sweeps again.
      }
    }
    return removed
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
        // Bodies the document no longer names are files nobody can reach: the
        // sweep runs here because this is the only place the new document is
        // known to be on disk.
        this.pruneBodies(next)
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
/** The bare file name one entry's body lives under. */
function bodyFileName(entryId: string): string {
  return createHash('sha1').update(entryId).digest('hex').slice(0, 32)
}

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
    // The reader-authored and the costly-to-rebuild fields survive a body
    // eviction: tags, the failure record, and the translation (whose rebuild
    // costs a gesture plus model work — releasing it with the page it was
    // read from would be the worst trade in this document).
    if (rest.tagIds === undefined && rest.error === undefined && rest.translation === undefined) continue
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

/** One memory entry's approximate size in characters (key + both texts + stamp). */
function memoryEntryChars(key: string, entry: ReaderTranslationMemoryEntry): number {
  return key.length + entry.source.length + entry.target.length + 24
}

/** One entry translation's size in characters, as recorded or estimated. */
function entryTranslationChars(translation: ReaderEntryTranslation): number {
  if (translation.chars !== undefined) return translation.chars
  return Object.entries(translation.segments ?? {}).reduce((sum, [hash, target]) => sum + hash.length + target.length + 2, 0)
}

/**
 * Bound the two translation tiers to their shared budget, LRU by last use.
 *
 * The eviction list is ONE ordering across the global memory and every entry's
 * segment map: a sentence remembered and a per-entry map are the same kind of
 * thing (a translation that was paid for), so the oldest lastUsedAt goes first
 * regardless of which tier holds it. Two extra rules ride the same walk,
 * because it is the only place both tiers are walked: schema-version mismatches
 * are evicted on sight (the lazy half of "version bump = miss"), and the memory
 * table answers to its own count cap even when the budget has room.
 *
 * Pure over plain records: the service wires the files, this decides.
 *
 * @param memory - the global sentence memory (table content).
 * @param annotations - the document's annotations (entry translations included).
 * @param budgetChars - the shared budget.
 * @returns the bounded records, plus WHICH keys each tier lost (the caller
 *   applies the entry evictions to the freshest document inside its commit).
 */
export function boundTranslations(
  memory: Record<string, ReaderTranslationMemoryEntry>,
  annotations: Record<string, ReaderEntryAnnotation>,
  budgetChars: number,
): {
  memory: Record<string, ReaderTranslationMemoryEntry>
  annotations: Record<string, ReaderEntryAnnotation>
  evictedMemoryKeys: string[]
  evictedEntryIds: string[]
} {
  let nextMemory = memory
  const evictedMemoryKeys: string[] = []
  // The count cap is the memory's own: 50k sentences is already several MB.
  const keysByAge = Object.keys(memory).sort((a, b) => memory[a]!.lastUsedAt.localeCompare(memory[b]!.lastUsedAt))
  if (keysByAge.length > MAX_TRANSLATION_MEMORY_ENTRIES) {
    nextMemory = { ...memory }
    for (const key of keysByAge.slice(0, keysByAge.length - MAX_TRANSLATION_MEMORY_ENTRIES)) {
      delete nextMemory[key]
      evictedMemoryKeys.push(key)
    }
  }

  // One LRU ladder across both tiers. Version-mismatched entry maps carry the
  // stale flag: they are dead weight this walk carries out first, whatever the
  // budget says.
  interface Aged { readonly at: string; readonly chars: number; readonly kind: 'memory' | 'entry'; readonly key: string; readonly stale: boolean }
  const ladder: Aged[] = []
  let total = 0
  for (const [key, entry] of Object.entries(nextMemory)) {
    const chars = memoryEntryChars(key, entry)
    total += chars
    ladder.push({ at: entry.lastUsedAt, chars, kind: 'memory', key, stale: false })
  }
  for (const [entryId, annotation] of Object.entries(annotations)) {
    const translation = annotation.translation
    if (translation === undefined) continue
    const stale = translation.version !== TRANSLATION_STORAGE_VERSION
    const chars = entryTranslationChars(translation)
    if (!stale) total += chars
    ladder.push({ at: stale ? new Date(0).toISOString() : translation.lastUsedAt, chars, kind: 'entry', key: entryId, stale })
  }
  ladder.sort((a, b) => a.at.localeCompare(b.at))

  const evictedEntryIds: string[] = []
  let nextAnnotations: Record<string, ReaderEntryAnnotation> | undefined
  for (const item of ladder) {
    // Stale records are evicted on sight; fresh ones only while over budget.
    if (!item.stale && total <= budgetChars) break
    if (item.kind === 'memory') {
      if (nextMemory === memory) nextMemory = { ...memory }
      if (nextMemory[item.key] !== undefined) {
        delete nextMemory[item.key]
        total -= item.chars
        evictedMemoryKeys.push(item.key)
      }
    } else {
      const annotation = (nextAnnotations ?? annotations)[item.key]
      if (annotation?.translation !== undefined) {
        if (nextAnnotations === undefined) nextAnnotations = { ...annotations }
        const { translation: _evicted, ...rest } = annotation
        nextAnnotations[item.key] = rest
        if (!item.stale) total -= item.chars
        evictedEntryIds.push(item.key)
      }
    }
  }
  return {
    memory: nextMemory,
    annotations: nextAnnotations ?? annotations,
    evictedMemoryKeys,
    evictedEntryIds,
  }
}

/** The table's approximate size in characters, for the document's manifest. */
export function memoryTableChars(entries: Record<string, ReaderTranslationMemoryEntry>): number {
  return Object.entries(entries).reduce((sum, [key, entry]) => sum + memoryEntryChars(key, entry), 0)
}
