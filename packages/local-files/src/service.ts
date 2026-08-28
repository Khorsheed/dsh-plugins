/**
 * The local-files service core: a git-agnostic file-system browser data face.
 * `ctx.localFiles` exposes this; the Remote service is a thin adapter that
 * delegates here. Every method browses an ABSOLUTE local path (the user's own
 * machine — file-preview trust model), independent of any git repository:
 * untracked, ignored, and git-external files all appear. The service stays
 * stateless.
 *
 * @module @khorsheed/dsh-local-files
 */
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, sep } from 'node:path'

/** Read cap for the content view (guards rendering against monster files). */
export const MAX_CONTENT_BYTES = 2 * 1024 * 1024

/** MIME types this plugin previews inline as images. */
const IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
}

/** Whether a path (by extension) is an image this plugin previews inline. */
export function isImagePath(path: string): boolean {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  return ext in IMAGE_EXTENSIONS
}

/** MIME for a recognized image path, or null when not a known image. */
export function imageMimeOf(path: string): string | null {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTENSIONS[ext] ?? null
}

/** Whether a path names an HTML document (`.html`/`.htm`). */
export function isHtmlPath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  const ext = path.slice(dot).toLowerCase()
  return ext === '.html' || ext === '.htm'
}

/** Best-effort hint that an HTML document contains scripts (`<script` tags,
 * inline event handlers, or `javascript:` targets). A hint for default-mode
 * selection and warning — never a trust decision. */
export function isScriptedHtml(content: string): boolean {
  return /<script\b/i.test(content)
    || /\bon[a-z]+\s*=/i.test(content)
    || /javascript:/i.test(content)
}

/** Local-directory listing request (absolute path, git-agnostic). */
export interface ListLocalDirectoryRequest {
  /** Absolute local directory path to list. */
  path: string
}

/** One entry in a local directory listing. */
export interface LocalFileEntry {
  /** Entry name (basename; '' only for the synthetic root). */
  name: string
  /** Whether this entry is a directory (vs a file). */
  isDir: boolean
  /** File size in bytes (null for directories / unreadable). */
  size: number | null
  /** Modified time as epoch seconds (null when unreadable). */
  mtime: number | null
}

/** A local directory listing (git-agnostic file-system view). */
export interface ListLocalDirectoryResult {
  /** The requested path, canonicalized (symlink-resolved). */
  path: string
  /** The parent directory path ('' at the filesystem root). */
  parent: string
  /** Directory entries, directories first then files, both alpha-sorted. */
  entries: readonly LocalFileEntry[]
}

/** Local file content read request (absolute path, git-agnostic). */
export interface ReadLocalFileRequest {
  /** Absolute local file path to preview. */
  path: string
}

/** Local file read outcome classification (mirrors file-preview's vocabulary). */
export type LocalFilesReadKind = 'text' | 'image' | 'binary' | 'missing' | 'too-large' | 'error'

/** One `readFile` response; exactly one of the content arms is populated.
 * Mirrors `FilePreviewRead` so the render layer reuses the same kind dispatch. */
export interface LocalFilesRead {
  /** The requested absolute path. */
  path: string
  /** Outcome classification; `text`/`image` carry a renderable value, `error` carries message. */
  kind: LocalFilesReadKind
  /** Text content for `text` reads, capped by {@link MAX_CONTENT_BYTES}. */
  content?: string
  /** Base64 data URL for `image` reads (an `<img src>` accepts it directly). */
  url?: string
  /** Whether `content` was truncated to the byte cap. */
  truncated?: boolean
  /** HTML files only: best-effort hint the document contains scripts. */
  htmlScripted?: boolean
  /** Byte size of the file when the backend reported one. */
  size?: number
  /** Human-readable failure detail for `error` reads. */
  message?: string
}

/** Read one local file for preview (the local-files data plane). */
export interface ReadLocalFileRequest {
  /** Absolute local file path to preview. */
  path: string
}

/** Thrown for client-supplied local paths that fail the absolute-path rules. */
export class UnsafeLocalPathError extends Error {
  constructor(path: string) {
    super(`local-files: invalid local path: ${path}`)
    this.name = 'UnsafeLocalPathError'
  }
}

/**
 * Validate a client-supplied local path for the git-agnostic browser: must be
 * absolute, and must not traverse upward (`..`) after normalization. The check
 * is lexical — the browser surface is the user's own machine (file-preview
 * trust model), so the guard exists to reject malformed/traversal shapes, not
 * to jail browsing to a subtree.
 * @param path - the candidate absolute path.
 * @returns the normalized absolute path.
 * @throws {UnsafeLocalPathError} when the path escapes the absolute rule.
 */
export function assertSafeLocalPath(path: string): string {
  if (path === '' || !isAbsolute(path)) throw new UnsafeLocalPathError(path)
  const segments = path.split(sep).filter(segment => segment !== '' && segment !== '.')
  if (segments.some(segment => segment === '..')) throw new UnsafeLocalPathError(path)
  return `${sep}${segments.join(sep)}`
}

/** Fraction of NUL/control bytes above which a preview is treated as binary. */
const BINARY_THRESHOLD = 0.02

/** The local-files service. One instance per plugin mount; holds no mutable state. */
export class LocalFilesService {
  /**
   * List one local directory as a plain file-system view — the git-agnostic
   * browser's data plane. No repository is involved: the caller browses any
   * absolute local path (including untracked, ignored, and git-external
   * files). Directories come first, then files, both alpha-sorted; sizes/mtimes
   * degrade to null on stat failure rather than failing the whole listing.
   * @param path - absolute local directory path.
   * @returns the canonical path, its parent, and the sorted entries.
   */
  async listLocalDirectory(path: string): Promise<ListLocalDirectoryResult> {
    const safe = assertSafeLocalPath(path)
    const canonical = await realpath(safe).catch(() => safe)
    const info = await stat(canonical).catch(() => null)
    if (info === null || !info.isDirectory()) {
      throw new Error(`local-files: not a directory: ${path}`)
    }
    const names = await readdir(canonical)
    // Stat each entry in parallel: the workspace root often holds many
    // children (node_modules, .git, source dirs), and the previous serial
    // `await stat` loop made the first paint wait on N round-trips.
    const entries = await Promise.all(names.map(async (name): Promise<LocalFileEntry> => {
      const full = join(canonical, name)
      const entryStat = await stat(full).catch(() => null)
      if (entryStat === null) {
        return { name, isDir: false, size: null, mtime: null }
      }
      return {
        name,
        isDir: entryStat.isDirectory(),
        size: entryStat.isDirectory() ? null : entryStat.size,
        mtime: Math.floor(entryStat.mtimeMs / 1000),
      }
    }))
    entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, 'en'))
    return { path: canonical, parent: dirname(canonical), entries }
  }

  /**
   * Read one local file for preview — the git-agnostic browser's content
   * plane. Mirrors the file-preview read vocabulary: the response is a single
   * kind-union (`text` / `image` / `binary` / `missing` / `too-large` /
   * `error`) so the render layer can reuse the products pane's kind-dispatch
   * logic one-for-one. Reads at most {@link MAX_CONTENT_BYTES} and reports
   * `truncated` when the file is larger. Binary detection: if the decoded
   * text's NUL/control-byte ratio exceeds the threshold, content is omitted
   * and the client shows a non-text placeholder. Images are returned as a
   * base64 data URL in the `url` field (an `<img src>` accepts it directly).
   * @param path - absolute local file path.
   * @returns the kind-union preview result.
   */
  async readFile(path: string): Promise<LocalFilesRead> {
    const safe = assertSafeLocalPath(path)
    const canonical = await realpath(safe).catch(() => safe)
    const info = await stat(canonical).catch(() => null)
    if (info === null) {
      return { path, kind: 'missing' }
    }
    if (info.isDirectory()) {
      return { path, kind: 'missing' }
    }
    if (imageMimeOf(path) !== null) {
      const handle = await readFile(canonical).catch(() => null)
      if (handle === null) {
        return { path, kind: 'error', message: `local-files: cannot read: ${path}` }
      }
      if (handle.byteLength > MAX_CONTENT_BYTES) {
        return { path, kind: 'too-large', size: info.size }
      }
      const mime = imageMimeOf(path) ?? 'application/octet-stream'
      return {
        path,
        kind: 'image',
        url: `data:${mime};base64,${Buffer.from(handle).toString('base64')}`,
        size: info.size,
      }
    }
    const handle = await readFile(canonical).catch(() => null)
    if (handle === null) {
      return { path, kind: 'error', message: `local-files: cannot read: ${path}` }
    }
    const truncated = handle.byteLength > MAX_CONTENT_BYTES
    const buffer = handle.subarray(0, MAX_CONTENT_BYTES)
    const text = buffer.toString('utf8')
    let controls = 0
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      if (code === 0 || (code < 9) || (code > 13 && code < 32)) controls++
    }
    const binary = text.length > 0 && controls / text.length > BINARY_THRESHOLD
    if (binary) {
      return { path, kind: 'binary', size: info.size }
    }
    return {
      path,
      kind: 'text',
      content: text,
      truncated,
      size: info.size,
      ...(isHtmlPath(path) && isScriptedHtml(text) ? { htmlScripted: true } : {}),
    }
  }
}
