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
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, sep } from 'node:path'
import {
  entryAt, git, mergeCounts, parseLog, parseNameStatus, parsePorcelain, parseWorktreeList,
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

/** Both change segments for the drawer's file tree. */
export interface ChangesResult {
  /** Working-tree changes vs HEAD (includes untracked `??`). */
  uncommitted: readonly ChangedFile[]
  /** Committed changes of the branch vs the base (three-dot range). */
  committed: readonly ChangedFile[]
}

/** One commit in the branch's own log (`base..HEAD`). */
export interface CommitInfo extends LogRow {}

/** Files of one commit. */
export interface CommitFilesResult {
  sha: string
  files: readonly ChangedFile[]
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
    return { uncommitted, committed }
  }

  /**
   * The repository's full file list (tracked + untracked, ignored excluded).
   * @param cwd - session working directory.
   * @returns repo-relative paths.
   */
  async repoFiles(cwd: string): Promise<string[]> {
    const repo = await this.repoOf(cwd)
    if (repo === null) return []
    const out = await git(repo, ['ls-files', '-co', '--exclude-standard'])
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
    const hasBase = await this.hasBase(repo)
    if (!hasBase) return []
    const out = await git(repo, ['log', '--format=%h%x09%s%x09%an%x09%at', `${this.baseRef}..HEAD`])
    return parseLog(out)
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
    if (repo === null) return { sha, files: [] }
    const out = await git(repo, ['show', '--format=', '--name-status', sha])
    return { sha, files: parseNameStatus(out) }
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
    return { content }
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
    return { content: buffer.toString('utf8') }
  }
}
