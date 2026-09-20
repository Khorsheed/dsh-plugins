/**
 * The capture state store: per-site allow records in `state.json`.
 *
 * v1's permission model is gesture-gated: the only caller path is an explicit
 * user click (the reader's 「渲染抓取」), which IS the approval. What persists
 * here is the record of that approval — which hosts have been rendered, when
 * first, when last, how often — so a future non-interactive caller can be
 * gated on "this site was approved before" without re-deriving it. The record
 * gates nothing today; it is written after the FIRST SUCCESSFUL render of a
 * host (a failed render approves nothing).
 *
 * The persistence contract mirrors the sibling packages' stores:
 *
 * - state lives under `$DSH_HOME/state/dsh-capture` (deployment state, never
 *   the package directory), written with plain `node:fs` — NOT `ctx.fs`, the
 *   session-fenced sandboxed filesystem, which refuses writes outside the
 *   workspace;
 * - writes are atomic (temporary file + rename) and best-effort: an
 *   unwritable root degrades to memory-only rather than failing a render;
 * - a missing document reads as empty; a CORRUPT one reads as empty in memory
 *   but is never overwritten — a hand-edited file stays untouched until its
 *   owner fixes it.
 *
 * @module @khorsheed/dsh-capture/store
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CAPTURE_STORAGE_VERSION,
  MAX_SITE_RECORDS,
  STATE_ROOT_SEGMENT,
  type CaptureSiteRecord,
  type CaptureStateDoc,
} from './types.ts'

/** The empty durable document. */
export function emptyCaptureStateDoc(): CaptureStateDoc {
  return { version: CAPTURE_STORAGE_VERSION, sites: {} }
}

/**
 * Where the capture state lives: `config.stateRoot`, else
 * `$DSH_HOME/state/dsh-capture`, else `<cwd>/.dsh-capture` (bare runtimes).
 */
export function resolveCaptureStateRoot(configured: string | undefined): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return join(home, 'state', STATE_ROOT_SEGMENT)
  return join(process.cwd(), `.${STATE_ROOT_SEGMENT}`)
}

/** Parse a persisted document; unknown versions and shapes read as corrupt. */
export function parseCaptureStateDoc(text: string): CaptureStateDoc | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const doc = value as Partial<CaptureStateDoc>
  if (doc.version !== CAPTURE_STORAGE_VERSION || typeof doc.sites !== 'object' || doc.sites === null) return undefined
  const sites: Record<string, CaptureSiteRecord> = {}
  for (const [host, record] of Object.entries(doc.sites)) {
    if (typeof record !== 'object' || record === null) return undefined
    const r = record as Partial<CaptureSiteRecord>
    if (typeof r.firstAllowedAt !== 'string' || typeof r.lastRenderAt !== 'string' || typeof r.renders !== 'number') {
      return undefined
    }
    sites[host] = { firstAllowedAt: r.firstAllowedAt, lastRenderAt: r.lastRenderAt, renders: r.renders }
  }
  return { version: CAPTURE_STORAGE_VERSION, sites }
}

/** Serialize the durable document (deterministic key order, one trailing newline). */
export function serializeCaptureStateDoc(doc: CaptureStateDoc): string {
  const sites = Object.fromEntries(Object.entries(doc.sites).sort(([a], [b]) => a.localeCompare(b)))
  return `${JSON.stringify({ ...doc, sites }, null, 2)}\n`
}

/** Whether one hostname is safe as a state-record key (guards prototype keys). */
export function isRecordableHost(host: string): boolean {
  return host.length > 0 && host.length <= 253 && !['__proto__', 'constructor', 'prototype'].includes(host)
}

/**
 * The store. Reads once at construction; writes through on every record.
 * Persistence failure never propagates into a render's outcome.
 */
export class CaptureStore {
  /** The parsed document; diverges from disk only while a write is in flight. */
  private doc: CaptureStateDoc
  /** Writes are skipped forever once the on-disk document proved corrupt. */
  private readonly writable: boolean
  /** A warning sink for corrupt/unwritable state; silent by default. */
  private readonly warn: (message: string) => void

  constructor(
    readonly stateRoot: string,
    options: { warn?: (message: string) => void } = {},
  ) {
    this.warn = options.warn ?? (() => undefined)
    const file = this.file
    let text: string | undefined
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      text = undefined // missing (or unreadable) reads as empty
    }
    if (text === undefined) {
      this.doc = emptyCaptureStateDoc()
      this.writable = true
      return
    }
    const parsed = parseCaptureStateDoc(text)
    if (parsed === undefined) {
      this.doc = emptyCaptureStateDoc()
      this.writable = false
      this.warn(`dsh-capture: ${file} is not a readable state document — leaving it untouched`)
      return
    }
    this.doc = parsed
    this.writable = true
  }

  /** The state document's path. */
  get file(): string {
    return join(this.stateRoot, 'state.json')
  }

  /** A copy of one host's allow record, when one exists. */
  site(host: string): CaptureSiteRecord | undefined {
    // `hasOwn`: a plain JSON.parse'd object reads `__proto__` through the chain.
    if (!Object.hasOwn(this.doc.sites, host)) return undefined
    const record = this.doc.sites[host]
    return record === undefined ? undefined : { ...record }
  }

  /**
   * Record one successful render of `host` at `at` (ISO-8601). The first
   * record of a host is its allow record; later renders refresh it.
   */
  recordRender(host: string, at: string): void {
    if (!isRecordableHost(host)) return
    const existing = this.doc.sites[host]
    this.doc.sites[host] = {
      firstAllowedAt: existing?.firstAllowedAt ?? at,
      lastRenderAt: at,
      renders: (existing?.renders ?? 0) + 1,
    }
    this.prune()
    this.persist()
  }

  /** Keep the record table bounded: least-recently-rendered hosts go first. */
  private prune(): void {
    const hosts = Object.keys(this.doc.sites)
    if (hosts.length <= MAX_SITE_RECORDS) return
    hosts
      .sort((a, b) => this.doc.sites[a]!.lastRenderAt.localeCompare(this.doc.sites[b]!.lastRenderAt))
      .slice(0, hosts.length - MAX_SITE_RECORDS)
      .forEach((host) => {
        delete this.doc.sites[host]
      })
  }

  /** Atomic write; failure degrades to memory-only (the render already succeeded). */
  private persist(): void {
    if (!this.writable) return
    try {
      mkdirSync(this.stateRoot, { recursive: true })
      const temporary = `${this.file}.${process.pid}.tmp`
      writeFileSync(temporary, serializeCaptureStateDoc(this.doc))
      renameSync(temporary, this.file)
    } catch (error) {
      this.warn(`dsh-capture: cannot persist ${this.file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
