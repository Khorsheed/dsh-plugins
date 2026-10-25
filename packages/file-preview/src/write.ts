/**
 * The save core: write one edited text file back through the host fs face.
 *
 * The write goes through `ctx.fs` like every read here, so a sandboxing or
 * remote backend fences and publishes it the way it does the agent's own
 * writes. The freshness guard is the fs face's own version token: the content
 * check against `base` and the version-guarded `writeText` together mean an
 * agent write landing at any point after the edit began answers `conflict`.
 *
 * @module @khorsheed/dsh-file-preview
 */

import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { isBinaryPath, isHtmlPath, isImagePath, readErrorMessage } from './read-surface.ts'
import type { FilePreviewWrite } from './types.ts'

/** The fs members the save path consumes. */
export type FilePreviewWriteFs = Pick<FileSystem, 'resolve' | 'stat' | 'readBytes' | 'writeText'>

/** Inputs of the save core: an fs face, the path anchor, and the read caps. */
export interface FilePreviewWriteCore {
  readonly fs: FilePreviewWriteFs
  /** The path anchor relative display paths resolve against (the session cwd). */
  readonly cwd: string | undefined
  /** The text read cap — a file beyond it was only ever shown as a window. */
  readonly maxReadBytes: number
  /** The HTML read cap. */
  readonly htmlMaxReadBytes: number
}

/** Fatal UTF-8 decoder: a file that does not decode losslessly is not saved.
 * It strips a leading BOM exactly like the read's decoder, so `base` compares
 * equal; the save puts the BOM back. */
const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

/** Whether an fs failure carries one of the host's stable codes. */
function fsCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

/**
 * Write an edited text file back. Only an existing regular file a text edit
 * can round-trip is written — not an image or binary extension, within the
 * read cap, lossless UTF-8. With a `base` the current content must still
 * equal it, and the write itself is guarded by the version the check read.
 * @param core - fs face, anchor, and caps.
 * @param path - the display path the read used.
 * @param content - the full new text.
 * @param base - the text the edit started from, or null to overwrite.
 * @param signal - cooperative cancellation from the calling UI request.
 * @returns whether the write landed, or why not.
 */
export async function writeFilePreview(
  core: FilePreviewWriteCore,
  path: string,
  content: string,
  base: string | null,
  signal?: AbortSignal,
): Promise<FilePreviewWrite> {
  if (typeof path !== 'string' || path.length === 0) {
    return { ok: false, reason: 'error', message: 'file preview requires a non-empty path' }
  }
  if (isImagePath(path) || isBinaryPath(path)) return { ok: false, reason: 'unsupported' }
  const cap = isHtmlPath(path) ? core.htmlMaxReadBytes : core.maxReadBytes
  if (new TextEncoder().encode(content).byteLength > cap) return { ok: false, reason: 'unsupported' }
  try {
    const options: { cwd?: string; signal?: AbortSignal } = {}
    if (core.cwd !== undefined) options.cwd = core.cwd
    if (signal !== undefined) options.signal = signal
    const target = await core.fs.resolve(path, options)
    const info = await core.fs.stat(target, signal)
    if (info === undefined || info.type !== 'file') return { ok: false, reason: 'missing' }
    if (info.size !== undefined && info.size > cap) return { ok: false, reason: 'unsupported' }
    let current: string
    let bom: boolean
    try {
      const bytes = await core.fs.readBytes(target, signal, cap)
      bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      current = strictUtf8.decode(bytes)
    } catch (error) {
      if (error instanceof TypeError || fsCode(error) === 'FS_TOO_LARGE') return { ok: false, reason: 'unsupported' }
      throw error
    }
    if (base !== null && current !== base) return { ok: false, reason: 'conflict' }
    await core.fs.writeText(target, bom ? `\uFEFF${content}` : content, { kind: 'replaceIfVersion', version: info.version }, signal)
    return { ok: true }
  } catch (error) {
    const code = fsCode(error)
    if (code === 'FS_STALE_VERSION') return { ok: false, reason: 'conflict' }
    if (code === 'FS_NOT_FOUND') return { ok: false, reason: 'missing' }
    return { ok: false, reason: 'error', message: readErrorMessage(error) }
  }
}
