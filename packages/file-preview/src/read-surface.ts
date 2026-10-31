/**
 * The read core and the read-surface factory. The `filePreview` Remote face
 * resolves its `agent` parameter through the host's unified lookup — a lookup
 * that can wake an offline session — so a trusted server-side caller that
 * already holds an authorized session source (its events, its cwd anchor, an
 * fs face) must not reach the data through that wire. This module is the seam:
 * the Remote methods and {@link createFilePreviewReadSurface} run the SAME
 * core functions, so the surface's answers are byte-identical to the Remote
 * face's for the same session by construction.
 *
 * Authorization lives entirely with the caller: the surface reads whatever the
 * injected event reader, anchor, and fs face reach, and performs no admission
 * check of its own. The surface never constructs, resolves, or wakes a session
 * runtime object — it derives everything from the injected source plus pure
 * folds, keeps at most watermark-keyed caches scoped to the returned instance
 * ({@link FilePreviewReadSurface.dispose} drops them), and starts no
 * background work.
 *
 * @module @khorsheed/dsh-file-preview
 */

import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { BashWriteCollector, type CapturedWrite } from './bash-writes.ts'
import { foldFilePreview, foldFilePreviewByTurn, type TurnFilesByTurn } from './fold.ts'
import type { FilePreviewEntry, FilePreviewList, FilePreviewRead, FilePreviewTurnFile, FilePreviewTurnMap } from './types.ts'

/** Extensions treated as binary without reading (their text decode is meaningless). */
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.pdf', '.zip', '.gz', '.tar', '.7z', '.zstd', '.br',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.wasm', '.node', '.dylib', '.so', '.dll', '.exe', '.kext',
  '.class', '.jar', '.pyc', '.sqlite', '.db',
  '.DS_Store', '.a', '.o',
])

/** Image extensions served to the browser through an image address. */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.ico', '.svg',
])

/** MIME type per image extension for a byte read's Content-Type answer. */

/** Default byte cap for an image the preview serves (screenshots and renders run well past the text cap). */
export const IMAGE_MAX_READ_BYTES = 16 * 1024 * 1024

export const IMAGE_MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
}

/** HTML extensions served through the sandboxed render channel. */
const HTML_EXTENSIONS: ReadonlySet<string> = new Set(['.html', '.htm'])

/** NUL bytes in decoded text mark a file as binary despite a successful decode. */
function hasNulByte(content: string): boolean {
  return content.slice(0, 4096).includes('\u0000')
}

/** Shared non-fatal UTF-8 decoder for the bounded byte-window read: invalid
 * sequences become U+FFFD (a cut multi-byte character at the window edge
 * included) instead of failing the read. */
const utf8Decoder = new TextDecoder()

/** Detect a binary file from its display path extension. */
export function isBinaryPath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  return dot >= 0 && BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

/** Detect an image from its display path extension. */
export function isImagePath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  return dot >= 0 && IMAGE_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

/** Detect an HTML document from its display path extension. */
export function isHtmlPath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  return dot >= 0 && HTML_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

/** Best-effort scripted-HTML detection: any `<script>` tag, inline event
 *  handler (`on*="…"`), or `javascript:` URL marks the document as scripted.
 *  Only a hint for default-mode selection and warning — never a trust
 *  decision; the sandbox and the Tier1 CSP are the real boundary. The scan
 *  runs on the read content as delivered (a truncated read may miss markers
 *  in the tail; acceptable for a hint). */
export function isScriptedHtml(content: string): boolean {
  return /<\s*script[\s>]/i.test(content)
    || /\son[a-z]+\s*=/i.test(content)
    || /javascript:/i.test(content)
}

/** Stable error text for a failed read, without leaking backend internals. */
export function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The fs members the read path consumes — the same shape the plugin reads
 * from `ctx.fs`. Any face honoring the same contract (cwd-anchored resolution
 * with the backend's own containment and symlink handling) plugs in
 * unchanged, which is exactly how the read surface inherits the Remote path's
 * path-containment behavior: both go through the same `resolve` with the same
 * anchor.
 */
export type FilePreviewReadFs = Pick<FileSystem, 'resolve' | 'stat' | 'readByteRange' | 'readBytes'>

/** The fold cache watermark: seq of the last event (`-1` for an empty log). */
export function eventsWatermark(events: readonly SessionEvent[]): number {
  return events.length === 0 ? -1 : events[events.length - 1]!.seq
}

/** Shared inputs of the list/turn cores: an fs face, the path anchor, and the caps. */
export interface FilePreviewFoldCore {
  /** The fs face existence probes resolve and stat through. */
  readonly fs: FilePreviewReadFs
  /** The path anchor relative display paths resolve against (the session cwd). */
  readonly cwd: string | undefined
  /** Cap on returned entries (`list` only). */
  readonly maxFiles: number
}

/** Shared inputs of the read core: the fold core plus the per-kind read caps. */
export interface FilePreviewReadCore {
  /** The fs face the read resolves, stats, and reads bytes through. */
  readonly fs: FilePreviewReadFs
  /** The path anchor relative display paths resolve against (the session cwd). */
  readonly cwd: string | undefined
  /** Byte cap for a single read; larger files answer `too-large` without reading. */
  readonly maxReadBytes: number
  /** The wider byte cap HTML documents read through (the render channel). */
  readonly htmlMaxReadBytes: number
  /** Byte cap for images (served by address, not read here); default {@link IMAGE_MAX_READ_BYTES}. */
  readonly imageMaxReadBytes?: number | undefined
  /**
   * Image-address issuer: given a recorded display path, the browser-loadable
   * address for its bytes, or undefined to degrade that one read to `binary`.
   * Absent entirely, every image read degrades to `binary`.
   */
  readonly imageUrl: ((path: string) => string | undefined) | undefined
}

/** The resolve options for one anchored probe, built field-by-field so an
 *  absent anchor or signal never materializes as an explicit `undefined`
 *  (exactOptionalPropertyTypes). */
function resolveOptions(cwd: string | undefined, signal: AbortSignal | undefined): { cwd?: string; signal?: AbortSignal } {
  const options: { cwd?: string; signal?: AbortSignal } = {}
  if (cwd !== undefined) options.cwd = cwd
  if (signal !== undefined) options.signal = signal
  return options
}

/**
 * Resolve the recorded display paths against the anchor and keep only those
 * that currently exist as a regular file. The products surfaces fold the
 * session log (which is history, not disk state): a path the log wrote may
 * have been cleaned up since, and such a path is not a product to list.
 * Existence is checked fresh on every call (never cached), so a deletion that
 * lands after a fold is visible on the next fetch. Unresolvable/unstat-able
 * paths are treated as absent.
 * @param fs - the fs face the probes run through.
 * @param cwd - the anchor relative paths resolve against, or undefined.
 * @param paths - the display paths to probe.
 * @returns the subset that resolves to an existing regular file.
 */
export async function retainExistingFiles(fs: FilePreviewReadFs, cwd: string | undefined, paths: readonly string[]): Promise<ReadonlySet<string>> {
  if (paths.length === 0) return new Set()
  const existing = new Set<string>()
  for (const path of paths) {
    if (existing.has(path)) continue
    try {
      const target = await fs.resolve(path, resolveOptions(cwd, undefined))
      const info = await fs.stat(target)
      if (info?.type === 'file') existing.add(path)
    } catch {
      // Unresolvable or stat failed: the path is not present to list.
    }
  }
  return existing
}

/**
 * The `list` core: the log fold plus any bash-written files the collector
 * verified, merged so a captured path the fold already knows keeps its
 * log-derived entry, then filtered to paths that still exist on disk. This is
 * the exact body the Remote `list` runs.
 * @param core - the fs face, the path anchor, and the entry cap.
 * @param events - the session's events in ascending seq order.
 * @param captured - the collector's verified bash writes, when capture is on.
 * @returns existing first-seen files capped by `maxFiles`, with the log watermark.
 */
export async function listFilePreview(
  core: FilePreviewFoldCore,
  events: readonly SessionEvent[],
  captured: ReadonlyMap<string, CapturedWrite> | undefined,
): Promise<FilePreviewList> {
  const folded = foldFilePreview(events, core.maxFiles)
  let entries: readonly FilePreviewEntry[] = folded.entries
  if (captured !== undefined && captured.size > 0) {
    const seen = new Set(entries.map(entry => entry.path))
    const extra: FilePreviewEntry[] = []
    for (const [path, write] of captured) {
      if (seen.has(path) || entries.length + extra.length >= core.maxFiles) continue
      extra.push({ path, op: 'write', seq: write.seq, turn: write.turn, step: write.step, diffs: [] })
    }
    entries = [...entries, ...extra]
  }
  const existing = await retainExistingFiles(core.fs, core.cwd, entries.map(entry => entry.path))
  return {
    entries: entries.filter(entry => existing.has(entry.path)),
    asOfSeq: folded.asOfSeq,
    truncated: folded.truncated || entries.length >= core.maxFiles,
  }
}

/**
 * The `turnFiles` core: merge the per-turn fold with the collector's captured
 * writes by their own turn, then filter every group to paths that still exist
 * on disk (fresh per call — the fold cache is by log watermark, existence
 * moves independently). A path touched in two turns appears in BOTH turn
 * groups. This is the exact body the Remote `turnFiles` runs; the caller owns
 * the by-turn fold (and any cache of it) so the watermark discipline sits
 * next to the caller's own cache.
 * @param core - the fs face and the path anchor (`maxFiles` goes unread here).
 * @param asOfSeq - the watermark of the scanned log ({@link eventsWatermark}).
 * @param byTurn - the per-turn fold over the same events.
 * @param captured - the collector's verified bash writes, when capture is on.
 * @returns existing per-turn file groups plus the scanned watermark.
 */
export async function turnFilesFilePreview(
  core: FilePreviewFoldCore,
  asOfSeq: number,
  byTurn: TurnFilesByTurn,
  captured: ReadonlyMap<string, CapturedWrite> | undefined,
): Promise<FilePreviewTurnMap> {
  const turns: { turn: number; files: readonly FilePreviewTurnFile[] }[] = []
  // One pass over the turn keys in ascending order (turn numbers are small).
  const turnNumbers = new Set<number>(byTurn.keys())
  if (captured !== undefined) {
    for (const write of captured.values()) turnNumbers.add(write.turn)
  }
  for (const turn of [...turnNumbers].sort((a, b) => a - b)) {
    const files: FilePreviewTurnFile[] = []
    const map = byTurn.get(turn)
    if (map !== undefined) files.push(...map.values())
    if (captured !== undefined) {
      for (const [path, write] of captured) {
        if (write.turn !== turn || files.some(file => file.path === path)) continue
        files.push({ path, seq: write.seq, step: write.step })
      }
    }
    if (files.length === 0) continue
    turns.push({ turn, files: files.sort((a, b) => a.seq - b.seq) })
  }
  const existing = await retainExistingFiles(core.fs, core.cwd, turns.flatMap(group => group.files.map(file => file.path)))
  return {
    turns: turns
      .map(group => ({ turn: group.turn, files: group.files.filter(file => existing.has(file.path)) }))
      .filter(group => group.files.length > 0),
    asOfSeq,
  }
}

/**
 * The `read` core: resolve the recorded display path against the anchor and
 * serve current text content, capped per kind. The text read is a bounded
 * byte window (`readByteRange` of cap + 1 bytes), so an oversized file costs
 * the cap, never its full size; a known oversized stat still short-circuits
 * to `too-large` before any bytes move. This is the exact body the Remote
 * `read` runs.
 * @param core - the fs face, the path anchor, the caps, and the image issuer.
 * @param path - the display path recorded by the write/edit tool call.
 * @param signal - cooperative cancellation from the calling request.
 * @returns the classified read; `text` carries content, `image` carries the
 *   issued URL, other kinds carry the size or a human-readable reason.
 */
export async function readFilePreview(core: FilePreviewReadCore, path: string, signal?: AbortSignal): Promise<FilePreviewRead> {
  if (typeof path !== 'string' || path.length === 0) {
    return { path, kind: 'error', message: 'file preview requires a non-empty path' }
  }
  let target
  try {
    target = await core.fs.resolve(path, resolveOptions(core.cwd, signal))
  } catch (error) {
    return { path, kind: 'error', message: readErrorMessage(error) }
  }
  let info
  try {
    info = await core.fs.stat(target, signal)
  } catch (error) {
    return { path, kind: 'error', message: readErrorMessage(error) }
  }
  if (info === undefined || info.type !== 'file') {
    return { path, kind: 'missing' }
  }
  // HTML gets its own, wider render-channel cap; every other text read keeps
  // `maxReadBytes`. Images get the byte channel's own cap: their bytes are
  // fetched by address, never decoded here.
  const html = isHtmlPath(path)
  const cap = html ? core.htmlMaxReadBytes : isImagePath(path) ? core.imageMaxReadBytes ?? IMAGE_MAX_READ_BYTES : core.maxReadBytes
  if (info.size !== undefined && info.size > cap) {
    return { path, kind: 'too-large', size: info.size }
  }
  if (isImagePath(path)) {
    const url = core.imageUrl?.(path)
    if (url !== undefined) {
      return {
        path,
        kind: 'image',
        url,
        ...(info.size === undefined ? {} : { size: info.size }),
      }
    }
    // No address to serve bytes through: an image is binary, never decoded as text.
    return { path, kind: 'binary', ...(info.size === undefined ? {} : { size: info.size }) }
  }
  if (isBinaryPath(path)) {
    return { path, kind: 'binary', ...(info.size === undefined ? {} : { size: info.size }) }
  }
  try {
    // Bounded by the window, not the file: at most cap + 1 bytes are
    // transferred (the extra byte decides `truncated`), never the whole file.
    const bytes = await core.fs.readByteRange(target, { offset: 0, length: cap + 1 }, signal)
    const truncated = bytes.length > cap
    const content = utf8Decoder.decode(truncated ? bytes.subarray(0, cap) : bytes)
    if (hasNulByte(content)) {
      return { path, kind: 'binary', ...(info.size === undefined ? {} : { size: info.size }) }
    }
    return {
      path,
      kind: 'text',
      content,
      truncated,
      ...(html && isScriptedHtml(content) ? { htmlScripted: true } : {}),
      ...(info.size === undefined ? {} : { size: info.size }),
    }
  } catch (error) {
    return { path, kind: 'error', message: readErrorMessage(error) }
  }
}

/** Shared inputs of the image byte read: an fs face, the path anchor, and the byte cap. */
export interface FilePreviewImageBytesCore {
  /** The fs face the read resolves, stats, and reads bytes through. */
  readonly fs: FilePreviewReadFs
  /** The path anchor relative display paths resolve against (the session cwd). */
  readonly cwd: string | undefined
  /** Byte cap for the read; larger images answer `too-large` without reading. */
  readonly maxReadBytes: number
  /** The image cap, when it differs from `maxReadBytes` (default {@link IMAGE_MAX_READ_BYTES}). */
  readonly imageMaxReadBytes?: number | undefined
}

/** Outcome of an authorized image byte read (the read surface's byte channel). */
export type FilePreviewImageBytes =
  | {
    /** The bytes were read; serve them with the given MIME type. */
    readonly ok: true
    /** The display path the bytes belong to. */
    readonly path: string
    /** MIME type for the path's image extension. */
    readonly mime: string
    /** The image bytes, capped by the surface's `maxReadBytes`. */
    readonly bytes: Uint8Array
    /** Byte size when the backend reported one. */
    readonly size?: number
  }
  | {
    /** The bytes could not be served. */
    readonly ok: false
    /** The display path the read attempted. */
    readonly path: string
    /** Why: `not-image` = the path carries no image extension; `missing` = does
     * not resolve to an existing file; `too-large` = over the byte cap;
     * `error` = the backend rejected the resolve/stat/read. */
    readonly reason: 'not-image' | 'missing' | 'too-large' | 'error'
    /** Byte size when the backend reported one. */
    readonly size?: number
    /** Human-readable failure detail for `error`. */
    readonly message?: string
  }

/**
 * The authorized image byte read: the same resolution, anchor, containment,
 * and caps as {@link readFilePreview}, returning the bytes themselves instead
 * of an address — the consuming side serves them through its own
 * authenticated channel. The failure taxonomy mirrors `read` (`missing`,
 * `too-large`, `error`) plus `not-image` for a path without an image
 * extension.
 * @param core - the fs face, the path anchor, and the byte cap.
 * @param path - the display path recorded by the session.
 * @param signal - cooperative cancellation from the calling request.
 * @returns the bytes and MIME type, or the classified failure.
 */
export async function readFilePreviewImageBytes(
  core: FilePreviewImageBytesCore,
  path: string,
  signal?: AbortSignal,
): Promise<FilePreviewImageBytes> {
  if (typeof path !== 'string' || path.length === 0) {
    return { path, ok: false, reason: 'error', message: 'file preview requires a non-empty path' }
  }
  if (!isImagePath(path)) {
    return { path, ok: false, reason: 'not-image' }
  }
  let target
  try {
    target = await core.fs.resolve(path, resolveOptions(core.cwd, signal))
  } catch (error) {
    return { path, ok: false, reason: 'error', message: readErrorMessage(error) }
  }
  let info
  try {
    info = await core.fs.stat(target, signal)
  } catch (error) {
    return { path, ok: false, reason: 'error', message: readErrorMessage(error) }
  }
  if (info === undefined || info.type !== 'file') {
    return { path, ok: false, reason: 'missing' }
  }
  const cap = core.imageMaxReadBytes ?? IMAGE_MAX_READ_BYTES
  if (info.size !== undefined && info.size > cap) {
    return { path, ok: false, reason: 'too-large', size: info.size }
  }
  try {
    const bytes = await core.fs.readBytes(target, signal, cap)
    const dot = path.lastIndexOf('.')
    /* v8 ignore next -- every IMAGE_EXTENSIONS entry has a MIME mapping; the fallback guards a future extension */
    const mime = IMAGE_MIME[path.slice(dot).toLowerCase()] ?? 'application/octet-stream'
    return {
      path,
      ok: true,
      mime,
      bytes,
      ...(info.size === undefined ? {} : { size: info.size }),
    }
  } catch (error) {
    return { path, ok: false, reason: 'error', message: readErrorMessage(error) }
  }
}

/**
 * The authorized session source a read surface consumes. Every value is
 * caller-trusted: the CALLER derives what this source may reach (which
 * session's events, which anchor, which fs face) from its own authorization
 * facts — the surface performs no admission check of its own.
 */
export interface FilePreviewReadSource {
  /**
   * The session's events in ascending seq order, re-read on every call. Wrap
   * whatever lookup the caller holds — a fixed snapshot (`() => events`) or a
   * live reader (`() => readSessionEvents(sessionId)`). The log is append-only,
   * so the surface's derived caches invalidate on the last event's seq, the
   * Remote face's own watermark discipline.
   */
  readonly events: () => readonly SessionEvent[]
  /**
   * The path anchor relative display paths resolve against — the session
   * header's cwd. Path containment is the fs face's own, applied through the
   * same `resolve` call the Remote path makes, so traversal and symlink
   * behavior are identical to it.
   */
  readonly cwd?: string | undefined
  /** The fs face the surface resolves, stats, and reads through. */
  readonly fs: FilePreviewReadFs
  /**
   * Image-address issuer: given a recorded display path, return the
   * browser-loadable address the caller authorizes for its bytes (the client
   * renders `read.url` unchanged), or undefined to degrade that one read.
   * With no issuer injected, every image read degrades to `kind: 'binary'`
   * exactly as the headless Remote face does — the surface never mints the
   * legacy image route.
   */
  readonly imageUrl?: ((path: string) => string | undefined) | undefined
  /** Byte cap for a single read (default 512 KiB, as the service). */
  readonly maxReadBytes?: number
  /** The wider byte cap HTML documents read through (default 4 MiB, as the service). */
  readonly htmlMaxReadBytes?: number
  /** The image byte cap (default 16 MiB, as the service). */
  readonly imageMaxReadBytes?: number
  /** Cap on the entries `list` returns (default 500, as the service). */
  readonly maxFiles?: number
  /** Whether bash-written files (heredocs, redirects, `tee`, `sed -i`) are
   * collected from the same session events and merged into `list`/`turnFiles`
   * (default true, as the service). */
  readonly captureBashWrites?: boolean
}

/**
 * The read-only consumption surface over one authorized session source: the
 * same result shapes as the Remote `list`/`turnFiles`/`read`, plus an
 * authorized image byte read for callers that serve bytes through their own
 * channel. Pure and stateless apart from watermark-keyed caches derived from
 * the injected reader; no timers, no background work.
 */
export interface FilePreviewReadSurface {
  /** The session's written/edited files that still exist on disk, with the log watermark. */
  list(): Promise<FilePreviewList>
  /** Every turn's file mutations that still exist on disk, plus the scanned watermark. */
  turnFiles(): Promise<FilePreviewTurnMap>
  /**
   * Read the current content of one recorded file, classified exactly as the
   * Remote `read` classifies it.
   * @param path - the display path recorded by the session.
   * @param signal - cooperative cancellation.
   */
  read(path: string, signal?: AbortSignal): Promise<FilePreviewRead>
  /**
   * Read one image file's bytes with the same resolution, containment, and
   * caps as `read` — for a caller that serves the bytes through its own
   * authenticated channel.
   * @param path - the display path recorded by the session.
   * @param signal - cooperative cancellation.
   */
  readImageBytes(path: string, signal?: AbortSignal): Promise<FilePreviewImageBytes>
  /** Drop the derived caches (the by-turn fold and the bash-write captures).
   * The surface stays usable: the next call re-derives from the reader. */
  dispose(): void
}

/**
 * Build a read-only file-preview surface over an externally-authorized
 * session source. The surface runs the same core functions the Remote methods
 * run, so for the same session its answers are byte-identical to the Remote
 * face's — the bash-write merge included, rebuilt from the same events
 * through the same collector pipeline. The factory itself holds no state: the
 * caches live in the returned instance and die with {@link FilePreviewReadSurface.dispose}.
 * @param source - the caller-authorized events, anchor, fs face, and issuer.
 * @returns the read surface.
 */
export function createFilePreviewReadSurface(source: FilePreviewReadSource): FilePreviewReadSurface {
  const resolved = {
    maxReadBytes: source.maxReadBytes ?? 512 * 1024,
    htmlMaxReadBytes: source.htmlMaxReadBytes ?? 4 * 1024 * 1024,
    imageMaxReadBytes: source.imageMaxReadBytes ?? IMAGE_MAX_READ_BYTES,
    maxFiles: source.maxFiles ?? 500,
  }
  const cwd = source.cwd
  const collector = source.captureBashWrites === false
    ? undefined
    : new BashWriteCollector({ fs: source.fs, maxFiles: resolved.maxFiles })
  /** Derived caches keyed by the log watermark; `dispose` drops both. */
  let turnCache: { asOfSeq: number; byTurn: TurnFilesByTurn } | undefined
  let captureCache: { asOfSeq: number; captured: ReadonlyMap<string, CapturedWrite> | undefined } | undefined

  /** The verified bash-write captures for the current watermark (replayed on change). */
  const capturedAt = async (events: readonly SessionEvent[], asOfSeq: number): Promise<ReadonlyMap<string, CapturedWrite> | undefined> => {
    if (collector === undefined) return undefined
    if (captureCache !== undefined && captureCache.asOfSeq === asOfSeq) return captureCache.captured
    const captured = await collector.replaySnapshot(cwd, events)
    captureCache = { asOfSeq, captured }
    return captured
  }

  return {
    list: async () => {
      const events = source.events()
      const captured = await capturedAt(events, eventsWatermark(events))
      return listFilePreview({ fs: source.fs, cwd, maxFiles: resolved.maxFiles }, events, captured)
    },
    turnFiles: async () => {
      const events = source.events()
      const asOfSeq = eventsWatermark(events)
      let byTurn: TurnFilesByTurn
      if (turnCache !== undefined && turnCache.asOfSeq === asOfSeq) {
        byTurn = turnCache.byTurn
      } else {
        byTurn = foldFilePreviewByTurn(events)
        turnCache = { asOfSeq, byTurn }
      }
      const captured = await capturedAt(events, asOfSeq)
      return turnFilesFilePreview({ fs: source.fs, cwd, maxFiles: resolved.maxFiles }, asOfSeq, byTurn, captured)
    },
    read: (path, signal) => readFilePreview(
      {
        fs: source.fs,
        cwd,
        maxReadBytes: resolved.maxReadBytes,
        htmlMaxReadBytes: resolved.htmlMaxReadBytes,
        imageMaxReadBytes: resolved.imageMaxReadBytes,
        imageUrl: source.imageUrl,
      },
      path,
      signal,
    ),
    readImageBytes: (path, signal) => readFilePreviewImageBytes(
      { fs: source.fs, cwd, maxReadBytes: resolved.maxReadBytes, imageMaxReadBytes: resolved.imageMaxReadBytes },
      path,
      signal,
    ),
    dispose: () => {
      turnCache = undefined
      captureCache = undefined
    },
  }
}

export default createFilePreviewReadSurface
