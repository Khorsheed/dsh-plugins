/**
 * Offline binding writes: append a `datasets/binding` event to a session's
 * JSONL log without booting the app (the CLI `bind`/`unbind` path).
 *
 * The layout mirrors `@deepseek-ai/dsh-session-persistence-jsonl`
 * (`<root>/<project>/<encoded-id>/session.jsonl[.zstd]`, concatenated
 * checksummed Zstandard frames — decoded frame-by-frame with a structural
 * scanner, and appending one self-contained frame is byte-compatible with
 * the backend's own batched appends).
 *
 * SAFETY: appending while the session is LIVE in a running instance races the
 * backend's in-memory sequence counter (a duplicate seq corrupts the log).
 * Only bind sessions no running instance has open — the live path is the
 * `/datasets bind` slash command.
 */
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { decodeStorageRecord } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { decodeBindingChange, validateBinding, type DatasetBinding, type DatasetsBindingChange } from './binding.ts'
import { DatasetsError } from './dataset.ts'

/** Path-safe encoding of one directory segment (mirrors the backend's). */
export function encodeSegment(raw: string): string {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch
    } else {
      out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
    }
  }
  return out
}

/** One located session log. */
export interface SessionLogLocation {
  path: string
  compressed: boolean
}

/**
 * Locate a session's log under the persistence root by scanning project
 * directories for the encoded session id (the CLI does not know the session's
 * cwd, and need not).
 * @param root - the session-persistence root (`$DSH_HOME/sessions`).
 * @param sessionId - the session to find.
 * @returns the log location, or undefined when no such session exists.
 */
export function locateSessionLog(root: string, sessionId: string): SessionLogLocation | undefined {
  if (!existsSync(root)) return undefined
  const encoded = encodeSegment(sessionId)
  for (const project of readdirSync(root)) {
    const dir = join(root, project, encoded)
    if (!existsSync(dir)) continue
    const plain = join(dir, 'session.jsonl')
    const zstd = join(dir, 'session.jsonl.zstd')
    if (existsSync(plain)) return { path: plain, compressed: false }
    if (existsSync(zstd)) return { path: zstd, compressed: true }
  }
  return undefined
}

const ZSTD_MAGIC = 0xFD2FB528

/**
 * Locate complete frames in a concatenated Zstandard stream, WITHOUT
 * decompressing (a structural port of the persistence backend's
 * `scanZstdFrames` — node:zlib's one-shot and streaming decoders both stop
 * after the first frame, so the frame walk is done by hand). A torn final
 * frame (a crash mid-append) is tolerated: only complete frames decode.
 * @param buffer - the whole session artifact.
 * @returns complete frame byte ranges.
 */
function scanZstdFrames(buffer: Buffer): { start: number; end: number }[] {
  const frames: { start: number; end: number }[] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return frames
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new DatasetsError(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`, 'SHAPE_INVALID')
    }
    offset += 4
    if (offset === buffer.length) return frames
    const descriptor = buffer.readUInt8(offset) ?? 0
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return frames
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return frames
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return frames
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return frames
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

/**
 * Decompress a concatenated-frame zstd log, frame by frame.
 */
function decompressLog(raw: Buffer, path: string): string {
  try {
    return scanZstdFrames(raw)
      .map(frame => zstdDecompressSync(raw.subarray(frame.start, frame.end)).toString('utf8'))
      .join('')
  } catch (error) {
    if (error instanceof DatasetsError) throw error
    throw new DatasetsError(`${path}: cannot decompress the session log (torn final frame? repair it with the app first) — ${String(error)}`, 'SHAPE_INVALID')
  }
}

/**
 * Read every event of a located session log (header line skipped; packed
 * chunk rows decoded back to their events).
 * @param location - the located log.
 * @returns the decoded events in log order.
 */
export async function readSessionLogEvents(location: SessionLogLocation): Promise<SessionEvent[]> {
  const raw = readFileSync(location.path)
  const text = location.compressed ? decompressLog(raw, location.path) : raw.toString('utf8')
  const events: SessionEvent[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue // tolerate a torn final line; the next seq comes from the intact prefix
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    if ((parsed as { type?: unknown }).type === 'session') continue // header line
    try {
      events.push(...decodeStorageRecord(parsed))
    } catch {
      continue // unrecognized record shape: skip rather than guess its seq span
    }
  }
  return events
}

/**
 * Read a session's current binding straight from its persisted log.
 * @param root - the session-persistence root.
 * @param sessionId - the session.
 * @returns the folded binding, or undefined when the session or binding is absent.
 */
export async function readOfflineBinding(root: string, sessionId: string): Promise<DatasetBinding | undefined> {
  const location = locateSessionLog(root, sessionId)
  if (location === undefined) return undefined
  let binding: DatasetBinding | undefined
  for (const event of await readSessionLogEvents(location)) {
    if (event.type !== 'datasets/binding') continue
    const change = decodeBindingChange(event.data)
    binding = change.binding === null ? undefined : change.binding
  }
  return binding
}

/**
 * Append a binding change to a session's persisted log (offline path). The
 * new event takes `maxSeq + 1`; see the module doc for the liveness safety
 * rule.
 * @param root - the session-persistence root.
 * @param sessionId - the session to bind.
 * @param binding - the new binding, or null to unbind.
 * @returns the seq the change was appended at.
 */
export async function appendOfflineBinding(root: string, sessionId: string, binding: DatasetBinding | null): Promise<number> {
  const location = locateSessionLog(root, sessionId)
  if (location === undefined) {
    throw new DatasetsError(`no session log for ${JSON.stringify(sessionId)} under ${root}`, 'FILE_NOT_FOUND')
  }
  const validated = binding === null ? null : validateBinding(binding)
  const change: DatasetsBindingChange = { kind: 'datasets/binding', version: 1, binding: validated }
  const events = await readSessionLogEvents(location)
  const seq = events.reduce((max, event) => Math.max(max, event.seq), -1) + 1
  const line = `${JSON.stringify({ type: 'datasets/binding', seq, time: Date.now(), data: change })}\n`
  if (location.compressed) {
    appendFileSync(location.path, zstdCompressSync(Buffer.from(line, 'utf8'), {
      params: { [constants.ZSTD_c_checksumFlag]: 1 },
    }))
  } else {
    appendFileSync(location.path, line, 'utf8')
  }
  return seq
}
