/**
 * Thin async wrappers over the git CLI plus the parser half of the data
 * plane: every piece of worktree status the plugin serves comes from git
 * metadata (`git worktree list`, `status --porcelain`, `diff --numstat`,
 * `log`) so there is no second source of truth to drift. All commands run
 * with `cwd` set to the repository toplevel — paths produced by git are
 * repo-relative and validated by the service before any file read.
 *
 * @module @khorsheed/dsh-worktrees
 */
import { execFile } from 'node:child_process'

/** One failed git invocation, stderr preserved for diagnostics. */
export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly cwd: string,
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(`git ${args.join(' ')} failed in ${cwd}${exitCode === null ? '' : ` (exit ${exitCode})`}: ${stderr.trim()}`)
    this.name = 'GitError'
  }
}

/**
 * Run one git command in `cwd`.
 * @param cwd - working directory (normally the repository toplevel).
 * @param args - git arguments.
 * @returns stdout (utf8).
 */
export async function git(cwd: string, args: readonly string[]): Promise<string> {
  // `core.quotePath=false` makes git emit raw (UTF-8) paths instead of
  // C-quoted + octal-escaped ones. Without it any non-ASCII or space-containing
  // path comes back as `"dir/\346\225\207..."` and the path parsers then split
  // the leading `"` onto the first path segment. The paths parsed here are
  // returned verbatim to the UI, so keep them human-readable.
  return await new Promise((resolvePromise, reject) => {
    execFile('git', ['-c', 'core.quotePath=false', ...args], { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error !== null) {
        const exitCode = typeof error.code === 'number' ? error.code : null
        reject(new GitError(['-c', 'core.quotePath=false', ...args], cwd, String(stderr), exitCode))
        return
      }
      resolvePromise(stdout as string)
    })
  })
}

/**
 * Run one git command, returning stdout even on a non-zero exit (e.g.
 * `git diff --no-index` exits 1 when the files differ — which is the success
 * case for computing a new file's line count). `git()` rejects on non-zero;
 * this one only tolerates it.
 * @param cwd - working directory.
 * @param args - git arguments.
 * @returns stdout (utf8), regardless of exit code.
 */
export async function gitAllowFailure(cwd: string, args: readonly string[]): Promise<string> {
  return await new Promise((resolvePromise) => {
    execFile('git', ['-c', 'core.quotePath=false', ...args], { cwd, maxBuffer: 64 * 1024 * 1024 }, (_error, stdout) => {
      resolvePromise(stdout as string)
    })
  })
}

/**
 * Resolve the repository toplevel of `cwd` (symlinks resolved by git), or
 * `null` when `cwd` is not inside a git work tree.
 * @param cwd - candidate directory.
 * @returns the toplevel, or null when not a repository.
 */
export async function repoToplevel(cwd: string): Promise<string | null> {
  try {
    const out = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
    return out === '' ? null : out
  } catch {
    return null
  }
}

/** One entry of `git worktree list --porcelain`. */
export interface WorktreeEntry {
  /** Absolute worktree path. */
  path: string
  /** Full branch ref (`refs/heads/<name>`), or null when detached. */
  branch: string | null
  /** Full commit sha at the worktree HEAD. */
  head: string
  /** Whether this is the primary (main) working tree — git lists it first. */
  isMain: boolean
}

/**
 * Parse `git worktree list --porcelain` output into entries. The main
 * checkout is always the first entry; linked worktrees follow.
 * @param output - raw porcelain output.
 * @returns the parsed entries in order.
 */
export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let current: Partial<WorktreeEntry> | null = null
  for (const line of output.split('\n')) {
    if (line === '') {
      if (current !== null) entries.push(current as WorktreeEntry)
      current = null
      continue
    }
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), branch: null, head: '', isMain: false }
    } else if (line.startsWith('branch ')) {
      if (current !== null) current.branch = line.slice('branch '.length)
    } else if (line.startsWith('HEAD ')) {
      if (current !== null) current.head = line.slice('HEAD '.length)
    }
    // `bare`, `detached`, `prunable`, `locked` markers are ignored.
  }
  if (current !== null) entries.push(current as WorktreeEntry)
  return entries.map((entry, index) => ({ ...entry, isMain: index === 0 }))
}

/** The worktree entry whose path equals `path`, or undefined. */
export function entryAt(entries: readonly WorktreeEntry[], path: string): WorktreeEntry | undefined {
  const normalized = path.replace(/\/+$/, '')
  return entries.find(entry => entry.path.replace(/\/+$/, '') === normalized)
}

/** One changed file: status letter plus diff line counts (null when no diff exists, e.g. untracked). */
export interface ChangedFile {
  path: string
  status: 'A' | 'M' | 'D' | 'R' | '??'
  additions: number | null
  deletions: number | null
}

/** Parse a `git status --porcelain` line into (status, path[, origPath]). */
function parsePorcelainLine(line: string): { status: string; path: string; orig?: string } {
  // Rename/copy form: `XY orig -> new` (v1 spelling).
  const arrow = line.indexOf(' -> ')
  if (arrow >= 0) {
    const head = line.slice(0, arrow)
    const status = head.slice(0, 2)
    return { status, path: line.slice(arrow + 4), orig: head.slice(3) }
  }
  return { status: line.slice(0, 2), path: line.slice(3) }
}

/** Map a porcelain status pair to our status letter. */
function porcelainStatus(pair: string): ChangedFile['status'] {
  if (pair === '??') return '??'
  const letters = pair.replace(/\s/g, '')
  const primary = letters[letters.length - 1] ?? 'M'
  if (primary === 'A' || primary === 'M' || primary === 'D' || primary === 'R') return primary
  // Staged-only changes (XY where Y is '.'), unmerged (U), and any other
  // letter collapse to a modification for display purposes.
  const staged = letters[0]
  if (staged === 'A') return 'A'
  if (staged === 'D') return 'D'
  if (staged === 'R') return 'R'
  return 'M'
}

/**
 * Parse `git status --porcelain` (no --branch) into changed files. Renames
 * report the NEW path. Untracked (`??`) entries carry no diff counts.
 * @param output - raw porcelain output.
 * @returns the changed files.
 */
export function parsePorcelain(output: string): ChangedFile[] {
  const files: ChangedFile[] = []
  for (const line of output.split('\n')) {
    if (line.trim() === '') continue
    const { status, path } = parsePorcelainLine(line)
    files.push({ path, status: porcelainStatus(status), additions: null, deletions: null })
  }
  return files
}

/** Parse one `git diff --numstat` line into counts plus path. */
function parseNumstatLine(line: string): { additions: number; deletions: number; path: string } | null {
  if (line.trim() === '') return null
  const parts = line.split('\t')
  if (parts.length < 3) return null
  const add = Number(parts[0])
  const del = Number(parts[1])
  if (!Number.isFinite(add) || !Number.isFinite(del)) return null
  // Binary files report `-` for both counts; the rest after the tab is the
  // path (may itself contain tabs — join everything past the counts).
  return { additions: Number.isNaN(add) ? 0 : add, deletions: Number.isNaN(del) ? 0 : del, path: parts.slice(2).join('\t') }
}

/** Merge numstat counts into a status-derived file list by path. */
export function mergeCounts(files: ChangedFile[], numstat: string): ChangedFile[] {
  const byPath = new Map<string, { additions: number; deletions: number }>()
  for (const line of numstat.split('\n')) {
    const parsed = parseNumstatLine(line)
    if (parsed !== null) byPath.set(parsed.path, { additions: parsed.additions, deletions: parsed.deletions })
  }
  return files.map(file => {
    const counts = byPath.get(file.path)
    return counts === undefined ? file : { ...file, additions: counts.additions, deletions: counts.deletions }
  })
}

/**
 * Parse `git diff --name-status` output into changed files (no counts).
 * @param output - raw name-status output.
 * @returns the changed files, status mapped to our letter set.
 */
export function parseNameStatus(output: string): ChangedFile[] {
  const files: ChangedFile[] = []
  for (const line of output.split('\n')) {
    if (line.trim() === '') continue
    const parts = line.split('\t')
    if (parts.length < 2) continue
    const raw = (parts[0] ?? 'M').replace(/\d+$/, '')
    let status: ChangedFile['status'] = 'M'
    if (raw === 'A') status = 'A'
    else if (raw === 'D') status = 'D'
    else if (raw === 'R' || raw === 'C') status = 'R'
    // Rename/copy carries the destination as the last column.
    const path = parts[parts.length - 1] ?? ''
    files.push({ path, status, additions: null, deletions: null })
  }
  return files
}

/** A short-format log row. */
export interface LogRow {
  sha: string
  subject: string
  author: string
  time: number
  /** Branch/tag decorations (`%D`), e.g. `HEAD -> main, origin/main`. */
  branches: string
}

/** A short-format log row with its file count (for the commits list). */
export interface LogRowWithFiles extends LogRow {
  files: number
}

/**
 * Parse `git log --format=%x00<h>%x1f<s>%x1f<a>%x1f<t>%x1f<D> --name-only <range>`
 * output: one NUL-separated record per commit — the format fields on the
 * first line, then the commit's file paths (one per line) to count.
 * @param output - raw log output.
 * @returns the rows with their file counts (commit order, newest first).
 */
export function parseLogWithFiles(output: string): LogRowWithFiles[] {
  const rows: LogRowWithFiles[] = []
  for (const record of output.split('\x00')) {
    const lines = record.split('\n')
    const header = lines[0]?.split('\x1f')
    if (header === undefined || header.length < 4) continue
    const files = lines.slice(1).filter(line => line.trim() !== '').length
    rows.push({
      sha: header[0] ?? '',
      subject: header[1] ?? '',
      author: header[2] ?? '',
      time: Number(header[3]) || 0,
      branches: header[4] ?? '',
      files,
    })
  }
  return rows
}

/**
 * Parse `git log --format=%h%x09%s%x09%an%x09%at <range>` output into rows.
 * @param output - raw log output.
 * @returns the rows in commit order (newest first).
 */
export function parseLog(output: string): LogRow[] {
  const rows: LogRow[] = []
  for (const line of output.split('\n')) {
    if (line.trim() === '') continue
    const parts = line.split('\t')
    if (parts.length < 4) continue
    rows.push({
      sha: parts[0] ?? '',
      subject: parts[1] ?? '',
      author: parts[2] ?? '',
      time: Number(parts[3]) || 0,
      branches: '',
    })
  }
  return rows
}
