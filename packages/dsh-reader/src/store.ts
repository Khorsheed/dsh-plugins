/**
 * The host-side state store: one version-guarded JSON document over the
 * mounted filesystem, holding the source list and, per source, the raw
 * payload of its last fetch plus that fetch's metadata.
 *
 * Deliberately the same shape as the side-chat store, and for the same two
 * reasons it encodes:
 *
 * - the filesystem is captured through **deferred** injection
 *   (`ctx.inject(['fs'], …)`) rather than an apply-time `ctx.get`. An
 *   apply-time probe races the fs service's own mount order and silently
 *   memory-only-degrades forever (a real shipped bug, the 3080 persistence
 *   incident), while a package-level `inject = ['fs']` would pend the whole
 *   plugin on a composition that has no filesystem at all.
 * - a missing document reads as empty; a **corrupt** one refuses rather than
 *   being overwritten, so a hand-edited file stays visible until its owner
 *   fixes it instead of being silently destroyed by the next refresh.
 *
 * Nothing here parses a feed. The document stores raw payloads, and the
 * browser half — the only side with a DOM parser — turns them into entries.
 *
 * @module @khorsheed/dsh-reader/store
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FsError, type FsTarget, type FsVersion } from '@deepseek-ai/dsh-fs'
import {
  MAX_BODY_CHARS_PER_SOURCE,
  MAX_TOTAL_BODY_CHARS,
  STATE_ROOT_SEGMENT,
  type ReaderSource,
  type ReaderStateDoc,
} from './types.ts'

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
  readonly version: FsVersion | null
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
  return {
    id,
    kind,
    url,
    enabled: record.enabled !== false,
    addedAt: typeof record.addedAt === 'string' ? record.addedAt : new Date(0).toISOString(),
    ...(typeof record.label === 'string' ? { label: record.label } : {}),
    ...(typeof record.fetchedAt === 'string' ? { fetchedAt: record.fetchedAt } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
    ...(record.truncated === true ? { truncated: true } : {}),
    ...(typeof record.raw === 'string' ? { raw: record.raw } : {}),
  }
}

/**
 * Trim raw payloads to the document's budgets, oldest fetch first.
 *
 * Entities rather than bytes because the payload arrives as text; the caps in
 * `types.ts` are sized for that. A single oversize payload is truncated to the
 * per-source cap and flagged, which is the same "incomplete, say so" contract
 * the fetch seam's own truncation uses.
 *
 * @param doc - the document to bound.
 * @returns the document and whether anything was cut.
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

/** The store: owns the document, the version token, and the fs seam. */
export class ReaderStore {
  private fs: Context['fs'] | undefined
  private fsReadyListener: (() => void) | undefined
  private readonly stateRoot: string

  /**
   * @param ctx - owning context; the fs seam is captured by deferred injection.
   * @param config - optional state-root override.
   */
  constructor(ctx: Context, config: { stateRoot?: string } = {}) {
    this.stateRoot = resolveReaderStateRoot(config.stateRoot)
    // Deferred, never an apply-time probe — see the module note.
    ctx.inject(['fs'], (fsCtx) => {
      this.fs = fsCtx.get('fs') as Context['fs'] | undefined
      this.fsReadyListener?.()
    })
  }

  /** Register the fs-arrival hook (fires at most once, when fs first mounts). */
  onFsReady(listener: () => void): void {
    this.fsReadyListener = listener
  }

  /** Whether persistence is available; without it the service runs memory-only. */
  get available(): boolean {
    return this.fs !== undefined
  }

  /** The state-file target under the state root. */
  private async target(): Promise<FsTarget> {
    if (this.fs === undefined) throw new ReaderStoreError('reader: no filesystem is mounted', 'io')
    return this.fs.resolve(join(this.stateRoot, READER_STATE_FILE_NAME))
  }

  /**
   * Read the document tolerantly.
   *
   * @returns the document and its freshness token; a missing file reads as empty.
   * @throws ReaderStoreError when the file exists but does not parse.
   */
  async read(): Promise<ReaderStoreRead> {
    if (this.fs === undefined) return { doc: emptyStateDoc(), version: null }
    let target: FsTarget
    try {
      target = await this.target()
    } catch (error) {
      if (error instanceof FsError) return { doc: emptyStateDoc(), version: null }
      throw error
    }
    const info = await this.fs.stat(target)
    if (info === undefined || info.type !== 'file') return { doc: emptyStateDoc(), version: null }
    try {
      return { doc: normalizeStateDoc(JSON.parse(await this.fs.readText(target))), version: info.version }
    } catch (error) {
      if (error instanceof FsError) throw error
      // Refuse rather than clobber: the file is the user's subscriptions.
      throw new ReaderStoreError(
        `reader: ${target.displayPath} does not parse — fix or remove it by hand`,
        'corrupt',
      )
    }
  }

  /**
   * Write the document under the version guard from the last read.
   *
   * @param doc - the document to publish.
   * @param version - the token from the last read (`null` for the first write).
   * @returns the new freshness token.
   */
  async write(doc: ReaderStateDoc, version: FsVersion | null): Promise<FsVersion> {
    if (this.fs === undefined) throw new ReaderStoreError('reader: no filesystem is mounted', 'io')
    const receipt = await this.fs.writeText(
      await this.target(),
      serializeStateDoc(doc),
      version === null ? { kind: 'createIfAbsent' } : { kind: 'replaceIfVersion', version },
    )
    return receipt.version
  }

  /**
   * Read-modify-write with the one stale-version retry the guard requires.
   *
   * @param mutate - pure function from the current document to the next one.
   * @returns the document that ended up on disk.
   */
  async update(mutate: (doc: ReaderStateDoc) => ReaderStateDoc): Promise<ReaderStateDoc> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { doc, version } = await this.read()
      const next = boundPayloads(mutate(doc)).doc
      try {
        await this.write(next, version)
        return next
      } catch (error) {
        // A concurrent writer moved the version between our read and write.
        // One retry is the contract; a second failure is a real io problem.
        if (attempt === 1 || !isStaleVersion(error)) throw error
      }
    }
    /* v8 ignore next -- the loop either returns or throws */
    throw new ReaderStoreError('reader: could not commit after a stale-version retry', 'io')
  }
}

/** Whether an fs failure is the stale-version guard firing. */
function isStaleVersion(error: unknown): boolean {
  return error instanceof FsError && (error as { code?: string }).code === 'FS_STALE_VERSION'
}
