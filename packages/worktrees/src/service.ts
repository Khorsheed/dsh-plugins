/**
 * The worktrees service core. `ctx.worktrees` exposes this; the Remote
 * service is a thin adapter that resolves the calling session's cwd and
 * delegates here — no logic is copied. Every query is a git read; the
 * service stays stateless (the registry is `git worktree list` itself).
 *
 * Scope rule: all commands run inside the resolved repository toplevel, and
 * every client-supplied path is validated as a repo-relative path before any
 * diff or file read, so the surface never escapes the session's repository.
 *
 * @module @khorsheed/dsh-worktrees
 */
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, sep } from 'node:path'
import {
  entryAt, git, gitAllowFailure, mergeCounts, parseLogWithFiles, parseNameStatus, parsePorcelain, parseWorktreeList,
  repoToplevel, type ChangedFile, type LogRow,
} from './git.ts'

/** Read cap for the content view (guards rendering against monster files). */
export const MAX_CONTENT_BYTES = 2 * 1024 * 1024

/** Additions/deletions of one segment. */
export interface LineCounts {
  additions: number
  deletions: number
}

/** The badge + drawer summary for one session's repository/worktree. */
export interface SessionSummary {
  /** Whether the session cwd is inside a git repository at all. */
  isRepo: boolean
  /** Repository toplevel path ('' when not a repo). */
  repo: string
  /** Repository directory basename ('' when not a repo). */
  repoName: string
  /** Worktree branch name, or null when detached (also null when not a repo). */
  branch: string | null
  /** Whether the session's worktree IS the primary (main) checkout. */
  isMain: boolean
  /** Short HEAD sha ('' when not a repo). */
  head: string
  /** Commits on the branch not in the base (0 when base missing / not a repo). */
  ahead: number
  /** Commits in the base not on the branch (0 when base missing / not a repo). */
  behind: number
  /** Uncommitted changed-file count (git status --porcelain rows; 0 when not a repo). */
  dirty: number
  /** Uncommitted segment line counts (working tree vs HEAD). */
  uncommitted: LineCounts
  /** Committed segment line counts (base...HEAD). */
  committed: LineCounts
  /** The resolved base ref ('' when the configured base does not exist locally). */
  baseRef: string
}

/**
 * The badge's own display gate: composition-level config, identical for every
 * session, served over the Remote so the browser half can read it (the web
 * boot composes client entries without config — `loader.create({ name })` in
 * client-web's boot carries none — so the plugin config only ever reaches the
 * host half, and this payload is the honest channel). An empty
 * `visiblePresets` keeps the badge unconditionally visible (the zero-change
 * default).
 */
export interface BadgeConfig {
  /**
   * Agent-preset ids the session-header badge stays visible for. Empty means
   * no gate; a non-empty list hides the badge in sessions whose preset id is
   * outside it, while sessions with NO preset projection stay visible
   * (fail-open: the gate hides dev chrome, it never breaks deployments
   * without presets).
   */
  visiblePresets: string[]
}

/** One worktree of the repository, as shown to the model by the tool. */
export interface WorktreeInfo {
  /** Absolute worktree path. */
  path: string
  /** Bare branch name (null when detached). */
  branch: string | null
  /** Whether this is the primary (main) checkout. */
  isMain: boolean
  /** Uncommitted changed-file count (0 when clean). */
  dirty: number
  /** Clean AND its branch is merged into the base (a cleanup candidate). */
  stale: boolean
}

/** Both change segments for the drawer's file tree. */
export interface ChangesResult {
  /** Working-tree changes vs HEAD (includes untracked `??`). */
  uncommitted: readonly ChangedFile[]
  /** Committed changes of the branch vs the base (three-dot range). */
  committed: readonly ChangedFile[]
}

/** One commit in the branch's own log (`base..HEAD`). */
export interface CommitInfo extends LogRow {
  /** The commit's changed-file count (commits-list row metadata). */
  files: number
}

/** Files of one commit, plus its message body. */
export interface CommitFilesResult {
  sha: string
  files: readonly ChangedFile[]
  /** The commit message body (everything after the subject line). */
  body: string
}

/** Diff request for one file of one segment. */
export interface FileDiffRequest {
  /** Repo-relative path (validated host-side). */
  path: string
  /** Which diff the request addresses (selects the git range/commit). */
  segment: 'uncommitted' | 'committed' | 'commit'
  /** Commit sha for the `commit` segment. */
  commit?: string
}

/** Unified diff text, or null when the file has no diff in that segment. */
export interface FileDiffResult {
  diff: string | null
}

/** Content read request for one repo-relative path. */
export interface ReadFileRequest {
  path: string
}

/** Content read for one file at one commit (the commits mode's content view). */
export interface ReadFileAtCommitRequest {
  path: string
  commit: string
}

/** The file's current working-tree content. */
export interface ReadFileResult {
  content: string
  /**
   * Best-effort hint that an HTML document contains scripts (a `<script` tag,
   * an inline event handler, or a `javascript:` target). The preview's static
   * tier reads it to warn instead of showing a silently inert page; it is
   * never a trust decision (proposal preview-kernel §D2).
   */
  htmlScripted?: boolean
}

/** Whether a path names an HTML document (`.html`/`.htm`/`.xhtml`). */
export function isHtmlPath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  const ext = path.slice(dot).toLowerCase()
  return ext === '.html' || ext === '.htm' || ext === '.xhtml'
}

/** Best-effort script hint for an HTML document; see {@link ReadFileResult.htmlScripted}. */
export function isScriptedHtml(content: string): boolean {
  return /<script\b/i.test(content)
    || /\bon[a-z]+\s*=/i.test(content)
    || /javascript:/i.test(content)
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

/** An inline image preview read (base64 data URL + MIME). */
export interface LocalImageResult {
  /** base64 data URL (`data:<mime>;base64,<...>`). */
  dataUrl: string
  /** The image's content type. */
  mime: string
}

/** Read a repo-relative file as an inline image (the repo browser's data plane). */
export interface ReadRepoImageRequest {
  path: string
}

/** Read an absolute local file as an inline image (the local-browser data plane). */
export interface ReadLocalImageRequest {
  path: string
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

/** Local file preview read result. */
export interface ReadLocalFileResult {
  /** UTF-8 content, or null when the file is binary / not text-decodable. */
  content: string | null
  /** Whether the full file was read (false when truncated at the cap). */
  complete: boolean
  /** File size in bytes. */
  size: number
}

/** Thrown for client-supplied paths that escape the repository. */
export class UnsafePathError extends Error {
  constructor(path: string) {
    super(`worktrees: path escapes the repository: ${path}`)
    this.name = 'UnsafePathError'
  }
}

/**
 * Validate a client-supplied path as repo-relative: not absolute, no `..`
 * segments after normalization, and no traversal through symlinked dirs is
 * attempted (the check is lexical — sufficient for a display surface).
 * @param path - the candidate path.
 * @returns the normalized repo-relative path.
 * @throws {UnsafePathError} when the path escapes.
 */
export function assertSafePath(path: string): string {
  if (path === '') throw new UnsafePathError(path)
  if (isAbsolute(path)) throw new UnsafePathError(path)
  const segments = path.split('/').filter(segment => segment !== '' && segment !== '.')
  if (segments.some(segment => segment === '..')) throw new UnsafePathError(path)
  return segments.join('/')
}

/** Thrown for client-supplied local paths that fail the absolute-path rules. */
export class UnsafeLocalPathError extends Error {
  constructor(path: string) {
    super(`worktrees: invalid local path: ${path}`)
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

/**
 * The worktrees service. One instance per plugin mount; holds only the
 * configured base ref (no mutable state).
 */
export class WorktreesService {
  /**
   * @param baseRef - branch the committed segment is measured against
   *   (defaults to `main` at the plugin config).
   */
  constructor(private readonly baseRef: string) {}

  /**
   * Per-session active worktree override: session id → worktree path. When a
   * session has an override the Remote data face points the badge/drawer at
   * that worktree instead of the session's static `header.cwd`. In-memory only
   * for v1 (a session must re-switch after a host restart).
   */
  private readonly activeWorktrees = new Map<string, string>()

  /** The session's active worktree override, or undefined when unset. */
  activeWorktreeOf(sessionId: string): string | undefined {
    return this.activeWorktrees.get(sessionId)
  }

  /** Set the session's active worktree override. */
  setActiveWorktree(sessionId: string, path: string): void {
    this.activeWorktrees.set(sessionId, path)
  }

  /** Clear the session's active worktree override (falls back to header.cwd). */
  clearActiveWorktree(sessionId: string): void {
    this.activeWorktrees.delete(sessionId)
  }

  /** Resolve the repository toplevel, or null when not a repo. */
  private async repoOf(cwd: string): Promise<string | null> {
    return await repoToplevel(cwd)
  }

  /** Count commits in one range; 0 when the range is empty or unresolvable. */
  private async countRange(repo: string, range: string): Promise<number> {
    try {
      const out = (await git(repo, ['rev-list', '--count', range])).trim()
      const count = Number(out)
      return Number.isFinite(count) ? count : 0
    } catch {
      return 0
    }
  }

  /** Whether the base ref resolves to a commit locally. */
  private async hasBase(repo: string): Promise<boolean> {
    if (this.baseRef === '') return false
    try {
      await git(repo, ['rev-parse', '--verify', '--quiet', `${this.baseRef}^{commit}`])
      return true
    } catch {
      return false
    }
  }

  /** Sum numstat counts for one range ('' range → 0,0). */
  private async segmentCounts(repo: string, range: string): Promise<LineCounts> {
    if (range === '') return { additions: 0, deletions: 0 }
    try {
      const out = await git(repo, ['diff', '--numstat', range])
      let additions = 0
      let deletions = 0
      for (const line of out.split('\n')) {
        const parts = line.split('\t')
        if (parts.length < 3) continue
        const add = Number(parts[0])
        const del = Number(parts[1])
        if (Number.isFinite(add)) additions += add
        if (Number.isFinite(del)) deletions += del
      }
      return { additions, deletions }
    } catch {
      return { additions: 0, deletions: 0 }
    }
  }

  /**
   * The badge/drawer summary for one session cwd.
   * @param cwd - session working directory.
   * @returns the summary (isRepo false when cwd is not in a git work tree).
   */
  async summary(cwd: string): Promise<SessionSummary> {
    const empty: SessionSummary = {
      isRepo: false, repo: '', repoName: '', branch: null, isMain: false, head: '',
      ahead: 0, behind: 0, dirty: 0, uncommitted: { additions: 0, deletions: 0 },
      committed: { additions: 0, deletions: 0 }, baseRef: this.baseRef,
    }
    if (cwd === '') return empty
    const repo = await this.repoOf(cwd)
    if (repo === null) return empty

    const entries = parseWorktreeList(await git(repo, ['worktree', 'list', '--porcelain']))
    const entry = entryAt(entries, repo)
    const branch = entry?.branch === null || entry?.branch === undefined
      ? null
      : entry.branch.replace(/^refs\/heads\//, '')
    const head = (entry?.head ?? '').slice(0, 12)
    const isMain = entry?.isMain ?? true

    const hasBase = await this.hasBase(repo)
    const baseRange = hasBase ? `${this.baseRef}...HEAD` : ''
    const [ahead, behind, uncommitted, committed] = await Promise.all([
      hasBase ? this.countRange(repo, `${this.baseRef}..HEAD`) : Promise.resolve(0),
      hasBase ? this.countRange(repo, `HEAD..${this.baseRef}`) : Promise.resolve(0),
      this.segmentCounts(repo, hasBase ? 'HEAD' : ''),
      this.segmentCounts(repo, baseRange),
    ])

    // dirty = uncommitted changed-file count (git status --porcelain rows).
    let dirtyCount = 0
    try {
      const status = await git(repo, ['status', '--porcelain'])
      dirtyCount = status.split('\n').filter(line => line.trim() !== '').length
    } catch {
      /* not a repo (already handled) or transient failure — keep 0 */
    }

    return {
      isRepo: true, repo, repoName: repo.split(sep).pop() ?? repo, branch, isMain, head,
      ahead, behind, dirty: dirtyCount, uncommitted, committed, baseRef: hasBase ? this.baseRef : '',
    }
  }

  /**
   * Both change segments for one session cwd.
   * @param cwd - session working directory.
   * @returns uncommitted (status vs HEAD) and committed (base...HEAD) files.
   */
  async changes(cwd: string): Promise<ChangesResult> {
    const repo = await this.repoOf(cwd)
    if (repo === null) return { uncommitted: [], committed: [] }
    const hasBase = await this.hasBase(repo)
    const [uncommittedStatus, uncommittedNumstat, committedStatus, committedNumstat] = await Promise.all([
      git(repo, ['status', '--porcelain']),
      git(repo, ['diff', '--numstat', 'HEAD', '--']),
      hasBase ? git(repo, ['diff', '--name-status', `${this.baseRef}...HEAD`]) : Promise.resolve(''),
      hasBase ? git(repo, ['diff', '--numstat', `${this.baseRef}...HEAD`]) : Promise.resolve(''),
    ])
    const uncommitted = mergeCounts(parsePorcelain(uncommittedStatus), uncommittedNumstat)
    const committed = mergeCounts(parseNameStatus(committedStatus), committedNumstat)
    // Untracked files never appear in `git diff HEAD` numstat, so they carry
    // null counts. A new file's whole content is "added", so additions = its
    // line count and deletions = 0 — `git diff --no-index` vs /dev/null reports
    // that. Bound the work to a sane number of untracked files.
    const untracked = uncommitted.filter(file => file.status === '??')
    await Promise.all(untracked.slice(0, 200).map(async file => {
      try {
        const num = await gitAllowFailure(repo, ['diff', '--no-index', '--numstat', '/dev/null', file.path])
        const m = num.match(/^(\d+)\t(\d+)/)
        if (m !== null) {
          file.additions = Number(m[1])
          file.deletions = Number(m[2])
        }
      } catch { /* binary/unreadable — leave null */ }
    }))
    return { uncommitted, committed }
  }

  /**
   * The repository's committed (tracked) file list — files actually in git,
   * not local untracked/ignored ones.
   * @param cwd - session working directory.
   * @returns repo-relative paths.
   */
  async repoFiles(cwd: string): Promise<string[]> {
    const repo = await this.repoOf(cwd)
    if (repo === null) return []
    const out = await git(repo, ['ls-files'])
    return out.split('\n').filter(line => line !== '')
  }

  /**
   * The branch's own commit log (`base..HEAD`).
   * @param cwd - session working directory.
   * @returns the commits, newest first.
   */
  async commitLog(cwd: string): Promise<CommitInfo[]> {
    const repo = await this.repoOf(cwd)
    if (repo === null) return []
    // The repository commit log for THIS checkout — its whole history (HEAD),
    // not just the commits ahead of base, so it stays useful after the branch
    // is merged/caught up. One NUL-separated record per commit: the short
    // format + `%D` decorations (branches/tags) on the first line, then the
    // commit's file names to count for the list row.
    const out = await git(repo, ['log', '--format=%x00%h%x1f%s%x1f%an%x1f%at%x1f%D', '--name-only', '-n', '200', 'HEAD'])
    return parseLogWithFiles(out)
  }

  /**
   * One commit's changed files (name-status only; counts require a per-commit
   * numstat pass the tree does not need).
   * @param cwd - session working directory.
   * @param sha - full or short commit sha.
   * @returns the commit's files.
   */
  async commitFiles(cwd: string, sha: string): Promise<CommitFilesResult> {
    const repo = await this.repoOf(cwd)
    if (repo === null) return { sha, files: [], body: '' }
    // Merge the status letters with real numstat counts, so the commit's file
    // list can show meaningful add/del instead of a blank or +0 −0; fetch the
    // message body separately (it is multi-line, so the list format keeps only
    // the subject).
    const [statusOut, numstatOut, bodyOut] = await Promise.all([
      git(repo, ['show', '--format=', '--name-status', sha]),
      git(repo, ['show', '--format=', '--numstat', sha]),
      git(repo, ['show', '--format=%b', '--no-patch', sha]),
    ])
    return { sha, files: mergeCounts(parseNameStatus(statusOut), numstatOut), body: bodyOut.trim() }
  }

  /**
   * One file's unified diff in one segment.
   * @param cwd - session working directory.
   * @param path - repo-relative path.
   * @param segment - uncommitted (HEAD), committed (base...HEAD), or commit
   *   (one commit's own diff for the path, when `commit` is given).
   * @param commit - required for `commit` segment; ignored otherwise.
   * @returns the diff text, or null when the file has no diff there.
   */
  async fileDiff(
    cwd: string,
    path: string,
    segment: 'uncommitted' | 'committed' | 'commit',
    commit?: string,
  ): Promise<FileDiffResult> {
    const repo = await this.repoOf(cwd)
    if (repo === null) return { diff: null }
    const safe = assertSafePath(path)
    if (segment === 'committed' && !(await this.hasBase(repo))) return { diff: null }
    if (segment === 'commit' && (commit === undefined || commit === '')) return { diff: null }
    try {
      let out: string
      if (segment === 'commit') {
        out = await git(repo, ['show', '--format=', commit as string, '--', safe])
      } else {
        const range = segment === 'committed' ? `${this.baseRef}...HEAD` : 'HEAD'
        out = await git(repo, ['diff', range, '--', safe])
      }
      return { diff: out === '' ? null : out }
    } catch {
      return { diff: null }
    }
  }

  /**
   * A file's content at one commit (`git show <commit>:<path>`) — the commits
   * mode's content view, so "内容" shows the file as it was at the selected
   * commit rather than hanging on a skipped working-tree read.
   * @param cwd - session working directory.
   * @param path - repo-relative path.
   * @param commit - the commit to read the blob from.
   * @returns the content at that commit.
   */
  async readFileAtCommit(cwd: string, path: string, commit: string): Promise<ReadFileResult> {
    const repo = await this.repoOf(cwd)
    if (repo === null) throw new Error('worktrees: not a git repository')
    const safe = assertSafePath(path)
    const content = await git(repo, ['show', `${commit}:${safe}`])
    if (content.length > MAX_CONTENT_BYTES) {
      throw new Error(`worktrees: file exceeds ${MAX_CONTENT_BYTES} bytes — preview truncated`)
    }
    return {
      content,
      ...(isHtmlPath(path) && isScriptedHtml(content) ? { htmlScripted: true } : {}),
    }
  }

  /**
   * The file's current working-tree content.
   * @param cwd - session working directory.
   * @param path - repo-relative path.
   * @returns the content (UTF-8; capped at {@link MAX_CONTENT_BYTES}).
   */
  async readFile(cwd: string, path: string): Promise<ReadFileResult> {
    const repo = await this.repoOf(cwd)
    if (repo === null) throw new Error('worktrees: not a git repository')
    const safe = assertSafePath(path)
    const buffer = await readFile(join(repo, ...safe.split('/')))
    if (buffer.byteLength > MAX_CONTENT_BYTES) {
      throw new Error(`worktrees: file exceeds ${MAX_CONTENT_BYTES} bytes — preview truncated`)
    }
    const content = buffer.toString('utf8')
    return {
      content,
      ...(isHtmlPath(path) && isScriptedHtml(content) ? { htmlScripted: true } : {}),
    }
  }

  /**
   * Read a repo-relative file as an inline image (the repo browser's data
   * plane). Reads the working-tree bytes and encodes them as a base64 data
   * URL so the client can render the image directly. Callers must gate by
   * {@link isImagePath}; a non-image path still returns a data URL with the
   * MIME guessed from its extension.
   * @param cwd - session working directory.
   * @param path - repo-relative path.
   * @returns a base64 data URL plus the content type.
   */
  async readRepoImage(cwd: string, path: string): Promise<LocalImageResult> {
    const repo = await this.repoOf(cwd)
    if (repo === null) throw new Error('worktrees: not a git repository')
    const safe = assertSafePath(path)
    const buffer = await readFile(join(repo, ...safe.split('/')))
    if (buffer.byteLength > MAX_CONTENT_BYTES) {
      throw new Error(`worktrees: file exceeds ${MAX_CONTENT_BYTES} bytes — preview truncated`)
    }
    const mime = imageMimeOf(path) ?? 'application/octet-stream'
    return { dataUrl: `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`, mime }
  }

  /**
   * List one local directory as a plain file-system view — the git-agnostic
   * browser's data plane. Unlike the git data face, no repository is involved:
   * the caller browses any absolute local path (including untracked, ignored,
   * and git-external files). Directories come first, then files, both
   * alpha-sorted; sizes/mtimes degrade to null on stat failure (e.g. a broken
   * symlink) rather than failing the whole listing.
   * @param path - absolute local directory path.
   * @returns the canonical path, its parent, and the sorted entries.
   */
  async listLocalDirectory(path: string): Promise<ListLocalDirectoryResult> {
    const safe = assertSafeLocalPath(path)
    const canonical = await realpath(safe).catch(() => safe)
    const info = await stat(canonical).catch(() => null)
    if (info === null || !info.isDirectory()) {
      throw new Error(`worktrees: not a directory: ${path}`)
    }
    const names = await readdir(canonical)
    const entries: LocalFileEntry[] = []
    for (const name of names) {
      const full = join(canonical, name)
      const entryStat = await stat(full).catch(() => null)
      if (entryStat === null) {
        entries.push({ name, isDir: false, size: null, mtime: null })
        continue
      }
      entries.push({
        name,
        isDir: entryStat.isDirectory(),
        size: entryStat.isDirectory() ? null : entryStat.size,
        mtime: Math.floor(entryStat.mtimeMs / 1000),
      })
    }
    entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, 'en'))
    return { path: canonical, parent: dirname(canonical), entries }
  }

  /** Fraction of NUL/control bytes above which a preview is treated as binary. */
  private static readonly BINARY_THRESHOLD = 0.02

  /**
   * Read one local file for preview — the git-agnostic browser's content
   * plane. Reads at most {@link MAX_CONTENT_BYTES}; reports `complete: false`
   * when the file is larger. Binary detection: if the decoded text's
   * NUL/control-byte ratio exceeds the threshold, content is null and the
   * client shows a non-text placeholder.
   * @param path - absolute local file path.
   * @returns the preview content (or null for binary) plus size/completeness.
   */
  async readLocalFile(path: string): Promise<ReadLocalFileResult> {
    const safe = assertSafeLocalPath(path)
    const canonical = await realpath(safe).catch(() => safe)
    const info = await stat(canonical).catch(() => null)
    if (info === null || info.isDirectory()) {
      throw new Error(`worktrees: not a file: ${path}`)
    }
    const handle = await readFile(canonical)
    const complete = handle.byteLength <= MAX_CONTENT_BYTES
    const buffer = handle.subarray(0, MAX_CONTENT_BYTES)
    const text = buffer.toString('utf8')
    let controls = 0
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      if (code === 0 || (code < 9) || (code > 13 && code < 32)) controls++
    }
    const binary = text.length > 0 && controls / text.length > WorktreesService.BINARY_THRESHOLD
    return { content: binary ? null : text, complete, size: info.size }
  }

  /**
   * Read one local file as an inline image — the git-agnostic browser's image
   * plane. Reads the bytes and encodes them as a base64 data URL so the client
   * can render the image directly. The path is absolute and independent of any
   * session workspace; callers gate by {@link isImagePath}.
   * @param path - absolute local file path.
   * @returns a base64 data URL plus the content type.
   */
  async readLocalImage(path: string): Promise<LocalImageResult> {
    const safe = assertSafeLocalPath(path)
    const canonical = await realpath(safe).catch(() => safe)
    const info = await stat(canonical).catch(() => null)
    if (info === null || info.isDirectory()) {
      throw new Error(`worktrees: not a file: ${path}`)
    }
    const buffer = await readFile(canonical)
    if (buffer.byteLength > MAX_CONTENT_BYTES) {
      throw new Error(`worktrees: file exceeds ${MAX_CONTENT_BYTES} bytes — preview truncated`)
    }
    const mime = imageMimeOf(path) ?? 'application/octet-stream'
    return { dataUrl: `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`, mime }
  }

  /** Uncommitted changed-file count in one worktree (0 when clean/transient). */
  private async dirtyOf(path: string): Promise<number> {
    try {
      const out = await git(path, ['status', '--porcelain'])
      return out.split('\n').filter(line => line.trim() !== '').length
    } catch {
      return 0
    }
  }

  /** Whether a (bare) branch is fully merged into the base ref. */
  private async branchMerged(repo: string, branchName: string): Promise<boolean> {
    if (this.baseRef === '') return false
    try {
      await git(repo, ['merge-base', '--is-ancestor', branchName, this.baseRef])
      return true
    } catch {
      return false
    }
  }

  /** Normalize a worktree path for comparison (drop trailing slashes). */
  private static normPath(path: string): string {
    return path.replace(/\/+$/, '')
  }

  /**
   * The canonical (symlink-resolved) path of a worktree. `git worktree list`
   * emits real paths (e.g. `/private/var/...` on macOS where `/var` is a
   * symlink), so a user-supplied path must be canonicalized before matching or
   * it will not line up with the parsed entries. Falls back to resolving the
   * parent + basename when `path` does not exist yet (a brand-new worktree).
   */
  private async canonicalPath(path: string): Promise<string> {
    try {
      return await realpath(path)
    } catch {
      const parent = dirname(path)
      const base = basename(path)
      try {
        return join(await realpath(parent), base)
      } catch {
        return path
      }
    }
  }

  /** Enumerate a repository's worktrees with dirty + stale computed. */
  private async worktreeInfos(repo: string): Promise<WorktreeInfo[]> {
    const entries = parseWorktreeList(await git(repo, ['worktree', 'list', '--porcelain']))
    const infos: WorktreeInfo[] = []
    for (const entry of entries) {
      const branchName = entry.branch === null || entry.branch === undefined
        ? null
        : entry.branch.replace(/^refs\/heads\//, '')
      const dirty = await this.dirtyOf(entry.path)
      const stale = dirty === 0
        && branchName !== null
        && branchName !== this.baseRef
        && (await this.branchMerged(repo, branchName))
      infos.push({ path: entry.path, branch: branchName, isMain: entry.isMain, dirty, stale })
    }
    return infos
  }

  /**
   * All worktrees of the session's repository, with dirty/stale hints — the
   * `list` action of the model-facing tool.
   * @param cwd - session working directory.
   * @returns the worktrees (main first, then linked).
   */
  async listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
    const repo = await this.repoOf(cwd)
    if (repo === null) return []
    return await this.worktreeInfos(repo)
  }

  /**
   * Point the session's badge/drawer at another worktree — the `switch` action.
   * @param sessionId - the calling session.
   * @param cwd - session working directory (the base repo).
   * @param path - the target worktree path.
   * @returns the target worktree's info.
   * @throws when `path` is not a worktree of the repository.
   */
  async switchWorktree(sessionId: string, cwd: string, path: string): Promise<WorktreeInfo> {
    const repo = await this.repoOf(cwd)
    if (repo === null) throw new Error('worktrees: not a git repository')
    const entries = parseWorktreeList(await git(repo, ['worktree', 'list', '--porcelain']))
    const entry = entryAt(entries, await this.canonicalPath(path))
    if (entry === undefined) throw new Error(`worktrees: no worktree at ${path}`)
    this.setActiveWorktree(sessionId, entry.path)
    const infos = await this.worktreeInfos(repo)
    const info = infos.find(candidate => WorktreesService.normPath(candidate.path) === WorktreesService.normPath(entry.path))
    if (info === undefined) throw new Error(`worktrees: no worktree at ${path}`)
    return info
  }

  /**
   * Create a git worktree (or adopt an existing one at `path`) and switch the
   * session to it — the `create` action.
   * @param sessionId - the calling session.
   * @param cwd - session working directory (the base repo).
   * @param path - directory for the new worktree.
   * @param branch - optional branch to create (`git worktree add -b <branch>`).
   * @returns the new worktree's info.
   */
  async createWorktree(sessionId: string, cwd: string, path: string, branch: string | undefined): Promise<WorktreeInfo> {
    const repo = await this.repoOf(cwd)
    if (repo === null) throw new Error('worktrees: not a git repository')
    const entries = parseWorktreeList(await git(repo, ['worktree', 'list', '--porcelain']))
    const existing = entryAt(entries, await this.canonicalPath(path))
    if (existing === undefined) {
      const args = branch === undefined || branch === ''
        ? ['worktree', 'add', path]
        : ['worktree', 'add', '-b', branch, path]
      await git(repo, args)
    }
    // After the add the directory exists, so canonicalPath resolves it fully.
    const created = await this.canonicalPath(path)
    this.setActiveWorktree(sessionId, created)
    const infos = await this.worktreeInfos(repo)
    const info = infos.find(candidate => WorktreesService.normPath(candidate.path) === WorktreesService.normPath(created))
    if (info === undefined) throw new Error(`worktrees: could not resolve worktree at ${path}`)
    return info
  }

  /**
   * Removes a linked worktree — the `remove` action. Gated: the caller must
   * confirm (`confirm === true`), the main worktree is never removed, and a
   * worktree with uncommitted changes is refused (the model cleans it first).
   * @param sessionId - the calling session.
   * @param cwd - session working directory (the base repo).
   * @param path - the worktree to remove.
   * @param confirm - explicit human/caller confirmation.
   * @returns the main worktree path to switch back to.
   * @throws on any guard failure.
   */
  async removeWorktree(sessionId: string, cwd: string, path: string, confirm: boolean): Promise<{ switchedTo: string }> {
    if (confirm !== true) throw new Error('worktrees: confirm must be true to remove a worktree')
    const repo = await this.repoOf(cwd)
    if (repo === null) throw new Error('worktrees: not a git repository')
    const entries = parseWorktreeList(await git(repo, ['worktree', 'list', '--porcelain']))
    const canonical = await this.canonicalPath(path)
    const entry = entryAt(entries, canonical)
    if (entry === undefined) throw new Error(`worktrees: no worktree at ${path}`)
    if (entry.isMain || WorktreesService.normPath(entry.path) === WorktreesService.normPath(repo)) {
      throw new Error('worktrees: cannot remove the main worktree')
    }
    const dirty = await this.dirtyOf(entry.path)
    if (dirty > 0) throw new Error(`worktrees: worktree at ${path} has ${dirty} uncommitted change(s)`)
    await git(repo, ['worktree', 'remove', entry.path])
    if (WorktreesService.normPath(this.activeWorktrees.get(sessionId) ?? '') === WorktreesService.normPath(entry.path)) {
      this.clearActiveWorktree(sessionId)
    }
    return { switchedTo: repo }
  }
}
