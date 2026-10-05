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
import { open, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, sep } from 'node:path'

/** Read cap for the content view (guards rendering against monster files). */
export const MAX_CONTENT_BYTES = 2 * 1024 * 1024

/**
 * Read at most `length` bytes of the file at `canonical`, starting at byte
 * `offset`. The window is the bound: at most `length` bytes are ever buffered,
 * no matter how large the file is. Returns the bytes read — shorter than
 * `length` when the file ends inside the window, empty at or past its end.
 */
async function readByteWindow(canonical: string, offset: number, length: number): Promise<Buffer> {
  const handle = await open(canonical, 'r')
  try {
    const buffer = Buffer.allocUnsafe(length)
    let total = 0
    while (total < length) {
      const { bytesRead } = await handle.read(buffer, total, length - total, offset + total)
      if (bytesRead === 0) break
      total += bytesRead
    }
    return buffer.subarray(0, total)
  } finally {
    await handle.close()
  }
}

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
  /** Byte offset the text window starts at (default 0). Image reads are
   * all-or-nothing and ignore it. */
  offset?: number
}

/** Filename search request (absolute root path, git-agnostic). */
export interface SearchLocalDirectoryRequest {
  /** Absolute local directory path the search roots at. */
  path: string
  /** Case-insensitive substring matched against each entry's root-relative
   * PATH, not just its basename — naming a folder surfaces its contents
   * (searching "web-eval" is how you reach the files inside web-eval/). */
  query: string
  /** Include dot-prefixed (hidden) entries; default false, mirroring the tree's
   * show-hidden toggle so a hit never names a row the tree would not render. */
  includeHidden?: boolean
}

/** One filename-search hit, addressed relative to the searched root. */
export interface SearchLocalEntry {
  /** Root-relative path ('a/b.md') — the tree's node paths one-for-one. */
  path: string
  /** Whether the hit is a directory. */
  isDir: boolean
}

/** Filename-search outcome. */
export interface SearchLocalDirectoryResult {
  /** The requested path, canonicalized (symlink-resolved). */
  path: string
  /** Matching entries, in walk order (the tree re-sorts per level anyway). */
  entries: readonly SearchLocalEntry[]
  /** True when a walk cap cut the search short (the hits are a subset). */
  truncated: boolean
}

/** Filename-search walk caps: they bound work on hostile trees (a home
 * directory carries no ignore list). Hitting any cap sets `truncated`. */
export const SEARCH_MAX_RESULTS = 200
export const SEARCH_MAX_VISITED = 50_000
export const SEARCH_MAX_DEPTH = 16

/** Directory names a filename search never descends into: dependency and VCS
 * internals dwarf everything else combined and never hold a user document. */
const SEARCH_SKIP_DIRS: ReadonlySet<string> = new Set(['node_modules', '.git'])

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
  /** Truncated text reads only: the byte offset a follow-up `readFile` call
   * starts from to continue the window (`offset` + returned byte count). */
  nextOffset?: number
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
  /** Byte offset the text window starts at (default 0). Image reads are
   * all-or-nothing and ignore it. */
  offset?: number
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
   * Search entry names below a root — the tree's filename search. Matching is a
   * case-insensitive substring on the root-relative PATH (so a folder whose
   * name matches lists its contents as hits too), and every hit reports that
   * relative path so the client can expand the ancestor chain around it. The
   * walk is bounded by
   * {@link SEARCH_MAX_RESULTS} / {@link SEARCH_MAX_VISITED} /
   * {@link SEARCH_MAX_DEPTH} (any cap hit sets `truncated`), never descends
   * into {@link SEARCH_SKIP_DIRS}, and never follows symlinks — `withFileTypes`
   * reports the link itself, not its target, so cycles are impossible by
   * construction. Unreadable directories degrade to zero hits, not a failure.
   * @param path - absolute local directory path the search roots at.
   * @param query - case-insensitive path substring.
   * @param includeHidden - include dot-prefixed entries (the tree's toggle).
   * @returns the hits plus the truncation flag.
   */
  async searchLocalDirectory(path: string, query: string, includeHidden: boolean = false): Promise<SearchLocalDirectoryResult> {
    const safe = assertSafeLocalPath(path)
    const canonical = await realpath(safe).catch(() => safe)
    const needle = query.trim().toLowerCase()
    const entries: SearchLocalEntry[] = []
    if (needle === '') return { path: canonical, entries, truncated: false }
    const info = await stat(canonical).catch(() => null)
    if (info === null || !info.isDirectory()) {
      throw new Error(`local-files: not a directory: ${path}`)
    }
    let visited = 0
    let truncated = false
    const stack: { dir: string; rel: string; depth: number }[] = [{ dir: canonical, rel: '', depth: 0 }]
    while (stack.length > 0 && !truncated) {
      const current = stack.pop() as { dir: string; rel: string; depth: number }
      const dirents = await readdir(current.dir, { withFileTypes: true }).catch(() => null)
      if (dirents === null) continue
      for (const dirent of dirents) {
        visited += 1
        if (visited > SEARCH_MAX_VISITED) { truncated = true; break }
        const name = dirent.name
        if (!includeHidden && name.startsWith('.')) continue
        const isDir = dirent.isDirectory()
        if (isDir && SEARCH_SKIP_DIRS.has(name)) continue
        const rel = current.rel === '' ? name : `${current.rel}/${name}`
        // The query matches the root-relative PATH, not just the basename:
        // a folder-name hit must surface that folder's contents (typing
        // "web-eval" is how you reach the files inside web-eval/).
        if (rel.toLowerCase().includes(needle)) {
          entries.push({ path: rel, isDir })
          if (entries.length >= SEARCH_MAX_RESULTS) { truncated = true; break }
        }
        if (isDir && current.depth < SEARCH_MAX_DEPTH) {
          stack.push({ dir: join(current.dir, name), rel, depth: current.depth + 1 })
        }
      }
    }
    return { path: canonical, entries, truncated }
  }

  /**
   * Read one local file for preview — the git-agnostic browser's content
   * plane. Mirrors the file-preview read vocabulary: the response is a single
   * kind-union (`text` / `image` / `binary` / `missing` / `too-large` /
   * `error`) so the render layer can reuse the products pane's kind-dispatch
   * logic one-for-one. The read is bounded by its window, not by the file: a
   * text read transfers at most {@link MAX_CONTENT_BYTES} + 1 bytes starting
   * at `offset` (the extra byte decides `truncated`), never the whole file;
   * `nextOffset` marks where a follow-up read continues. Binary detection: if
   * the decoded text's NUL/control-byte ratio exceeds the threshold, content
   * is omitted and the client shows a non-text placeholder. Images are
   * all-or-nothing: a stat size over the cap answers `too-large` without
   * reading, otherwise the whole image is returned as a base64 data URL in
   * the `url` field (an `<img src>` accepts it directly).
   * @param path - absolute local file path.
   * @param offset - byte offset the text window starts at (default 0);
   *   ignored for image reads.
   * @returns the kind-union preview result.
   */
  async readFile(path: string, offset: number = 0): Promise<LocalFilesRead> {
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
      if (info.size > MAX_CONTENT_BYTES) {
        return { path, kind: 'too-large', size: info.size }
      }
      const image = await readByteWindow(canonical, 0, MAX_CONTENT_BYTES + 1).catch(() => null)
      if (image === null) {
        return { path, kind: 'error', message: `local-files: cannot read: ${path}` }
      }
      // The stat said the image fits; a post-read overflow means it grew
      // between stat and read — answer too-large rather than a partial image.
      if (image.byteLength > MAX_CONTENT_BYTES) {
        return { path, kind: 'too-large', size: info.size }
      }
      const mime = imageMimeOf(path) ?? 'application/octet-stream'
      return {
        path,
        kind: 'image',
        url: `data:${mime};base64,${image.toString('base64')}`,
        size: info.size,
      }
    }
    const bytes = await readByteWindow(canonical, offset, MAX_CONTENT_BYTES + 1).catch(() => null)
    if (bytes === null) {
      return { path, kind: 'error', message: `local-files: cannot read: ${path}` }
    }
    const truncated = bytes.byteLength > MAX_CONTENT_BYTES
    const buffer = bytes.subarray(0, MAX_CONTENT_BYTES)
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
      ...(truncated ? { nextOffset: offset + buffer.byteLength } : {}),
      ...(isHtmlPath(path) && isScriptedHtml(text) ? { htmlScripted: true } : {}),
    }
  }
}
