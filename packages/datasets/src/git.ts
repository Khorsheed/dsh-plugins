/**
 * Thin async wrappers over the git CLI. Every repository read the plugin
 * serves comes from git objects (`git show`/`git ls-tree`) so no second copy
 * of dataset content ever materializes outside the repository and its managed
 * worktrees.
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
 * @param cwd - working directory (the repository for repo-scoped commands).
 * @param args - git arguments.
 * @param binary - return a Buffer instead of utf8 text.
 * @returns stdout.
 */
export async function git(cwd: string, args: readonly string[], binary?: false): Promise<string>
export async function git(cwd: string, args: readonly string[], binary: true): Promise<Buffer>
export async function git(cwd: string, args: readonly string[], binary = false): Promise<string | Buffer> {
  return await new Promise((resolvePromise, reject) => {
    execFile('git', [...args], {
      cwd,
      maxBuffer: 256 * 1024 * 1024,
      encoding: binary ? 'buffer' : 'utf8',
    }, (error, stdout, stderr) => {
      if (error !== null) {
        const exitCode = typeof error.code === 'number' ? error.code : null
        reject(new GitError(args, cwd, String(stderr), exitCode))
        return
      }
      resolvePromise(stdout as string | Buffer)
    })
  })
}

/**
 * Resolve a ref to a full commit sha.
 * @param repo - repository path.
 * @param ref - any git revision (default HEAD).
 * @returns the resolved commit sha.
 */
export async function resolveCommit(repo: string, ref = 'HEAD'): Promise<string> {
  return (await git(repo, ['rev-parse', '--verify', `${ref}^{commit}`])).trim()
}

/**
 * Assert `repo` is inside a git work tree and return its absolute toplevel.
 * @param repo - candidate repository path.
 * @returns the repository toplevel (symlinks resolved by git).
 */
export async function repoToplevel(repo: string): Promise<string> {
  return (await git(repo, ['rev-parse', '--show-toplevel'])).trim()
}

/**
 * Read one file's content from a git object — `git show <commit>:<path>`.
 * The single-file read path: no checkout, no copy.
 * @param repo - repository path.
 * @param commit - commit to read from.
 * @param path - repo-relative file path (validated by the caller).
 * @returns the file content, or undefined when the path does not exist at that commit.
 */
export async function showFile(repo: string, commit: string, path: string): Promise<string | undefined> {
  try {
    return await git(repo, ['show', `${commit}:${path}`])
  } catch (error) {
    if (error instanceof GitError && /does not exist|exists on disk, but not in|bad revision|Not a valid object name/i.test(error.stderr)) {
      return undefined
    }
    throw error
  }
}

/**
 * List files under a repo-relative prefix at a commit — `git ls-tree -r -z`.
 * @param repo - repository path.
 * @param commit - commit to list.
 * @param prefix - repo-relative directory prefix ('' for the whole tree).
 * @returns repo-relative file paths (empty when the prefix matches nothing).
 */
export async function listFiles(repo: string, commit: string, prefix: string): Promise<string[]> {
  const args = ['ls-tree', '-r', '-z', '--name-only', commit]
  if (prefix !== '') args.push('--', prefix.endsWith('/') ? prefix : `${prefix}/`)
  let out: string
  try {
    out = await git(repo, args)
  } catch (error) {
    if (error instanceof GitError && /Not a valid object name|bad revision/i.test(error.stderr)) return []
    throw error
  }
  return out.split('\0').filter(entry => entry !== '')
}

/** One parsed `git worktree list --porcelain` entry. */
export interface WorktreeEntry {
  path: string
  head: string
  detached: boolean
  locked: boolean
  /** Absent administrative entries (prunable, directory gone). */
  prunable: boolean
}

/**
 * Parse `git worktree list --porcelain` output.
 * @param repo - repository path.
 * @returns the registered worktrees (including the main one).
 */
export async function listWorktrees(repo: string): Promise<WorktreeEntry[]> {
  const out = await git(repo, ['worktree', 'list', '--porcelain'])
  const entries: WorktreeEntry[] = []
  let current: Partial<WorktreeEntry> | undefined
  const flush = (): void => {
    if (current?.path !== undefined) {
      entries.push({
        path: current.path,
        head: current.head ?? '',
        detached: current.detached ?? false,
        locked: current.locked ?? false,
        prunable: current.prunable ?? false,
      })
    }
    current = undefined
  }
  for (const line of out.split('\n')) {
    if (line === '') {
      flush()
    } else if (line.startsWith('worktree ')) {
      flush()
      current = { path: line.slice('worktree '.length) }
    } else if (current !== undefined) {
      if (line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length)
      else if (line === 'detached') current.detached = true
      else if (line.startsWith('locked')) current.locked = true
      else if (line.startsWith('prunable')) current.prunable = true
    }
  }
  flush()
  return entries
}
