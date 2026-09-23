/**
 * Thin async wrappers over the git CLI. Every repository read the plugin
 * serves comes from git objects (`git show`/`git ls-tree`) so no second copy
 * of dataset content ever materializes outside the repository and its managed
 * worktrees.
 */
import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

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

/**
 * The realpath of a repository's git COMMON dir — the identity every worktree
 * of one repository shares (`<main>/.git` for a checkout and each of its
 * linked worktrees; the repository itself when bare). Answered from any path
 * inside a work tree or a git dir.
 * @param path - a checkout, a linked worktree, a `.git` dir, or a bare repository.
 * @returns the canonical common dir.
 */
export async function gitCommonDir(path: string): Promise<string> {
  const out = (await git(path, ['rev-parse', '--git-common-dir'])).trim()
  return realpathSync(resolve(path, out))
}

/**
 * The committer date of one commit, ISO 8601 (`%cI`).
 * @param repo - repository (or git dir) path.
 * @param commit - a resolved commit sha.
 * @returns the strict ISO date.
 */
export async function commitDate(repo: string, commit: string): Promise<string> {
  return (await git(repo, ['log', '-1', '--format=%cI', commit])).trim()
}

/**
 * The repository's local branch names (`refs/heads/*`), sorted.
 * @param repo - repository (or git dir) path.
 * @returns the short branch names.
 */
export async function localBranches(repo: string): Promise<string[]> {
  const out = await git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
  return out.split('\n').map(line => line.trim()).filter(line => line !== '').sort()
}

/**
 * The branch a checkout has checked out, or undefined when detached.
 * @param checkout - a work tree path.
 * @returns the short branch name.
 */
export async function currentBranch(checkout: string): Promise<string | undefined> {
  try {
    return (await git(checkout, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim() || undefined
  } catch {
    return undefined
  }
}

/**
 * Write `git archive --format=tar <commit> -- <paths>` to a file. Reads only
 * objects: no index, no HEAD, no worktree registration — safe against a
 * checkout other agents share.
 * @param repo - repository (or git dir) path.
 * @param commit - a resolved commit sha.
 * @param paths - repo-relative paths (validated by the caller); at least one.
 * @param output - the tar file to write.
 */
export async function archiveTo(repo: string, commit: string, paths: readonly string[], output: string): Promise<void> {
  await git(repo, ['archive', '--format=tar', `--output=${output}`, commit, '--', ...paths])
}
