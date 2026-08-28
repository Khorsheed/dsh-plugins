/**
 * Managed worktree views: the whole-layer consumption path. One `git worktree
 * add --detach <commit>` per cache key (repo, commit, sorted layers) under the
 * managed root, sparse-checkout-limited to the requested layer directories so
 * the whitelist is a MECHANISM (the worktree physically contains only the
 * allowed layers), deduplicated machine-wide per key, and `git worktree
 * lock`-ed against accidental pruning. The registry is `git worktree list` —
 * the plugin stays stateless; cleanup is `pruneManagedWorktrees`.
 *
 * Consumers treat the returned path as an ordinary read-only directory
 * (container `:ro` mounts, direct script reads); they never delete it — the
 * worktree is a shared cache across consumers.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, rmdirSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { datasetDir } from './dataset.ts'
import { git, listWorktrees, resolveCommit } from './git.ts'

/** How long a same-key creation lock may be held before it counts as stale. */
export const LOCK_STALE_MS = 120_000
/** Bound on waiting for a same-key creation lock. */
export const LOCK_TIMEOUT_MS = 60_000
/** Poll interval while waiting for a same-key creation lock. */
const LOCK_POLL_MS = 25

function shortHash(text: string, length: number): string {
  return createHash('sha256').update(text).digest('hex').slice(0, length)
}

/**
 * The managed directory for one cache key.
 * @param root - managed worktree root.
 * @param repoReal - realpath of the repository.
 * @param commit - pinned commit sha.
 * @param layers - the layer set (sorted internally).
 * @returns the worktree directory (whether or not it exists yet).
 */
export function worktreeDirFor(
  root: string,
  repoReal: string,
  commit: string,
  layers: readonly string[],
  registerPatterns: readonly string[] = [],
): string {
  const repoHash = shortHash(repoReal, 16)
  const layersHash = shortHash([...layers].sort().join('\n') + '\0' + [...registerPatterns].sort().join('\n'), 12)
  return join(root, repoHash, `${commit}-${layersHash}`)
}

/** Sleep helper for the lock spin. */
async function sleep(ms: number): Promise<void> {
  await new Promise(resolvePromise => { setTimeout(resolvePromise, ms) })
}

/**
 * Serialize same-key worktree creation with a lock directory under the
 * managed root (mkdir is atomic on POSIX and Windows alike, so this works
 * across processes). A lock older than {@link LOCK_STALE_MS} belongs to a
 * crashed creator and is broken.
 */
async function withCreationLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const lockDir = `${dir}.lock`
  await mkdir(dirname(lockDir), { recursive: true })
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    try {
      mkdirSync(lockDir)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > LOCK_STALE_MS) {
          rmSync(lockDir, { recursive: true, force: true })
          continue
        }
      } catch {
        continue // lock vanished between stat and rm — retry the mkdir
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for the worktree creation lock ${lockDir}`)
      }
      await sleep(LOCK_POLL_MS)
    }
  }
  try {
    return await fn()
  } finally {
    rmSync(lockDir, { recursive: true, force: true })
  }
}

/** A managed-worktree acquisition result. */
export interface ManagedWorktree {
  /** The worktree directory — an ordinary directory, the path IS the interface. */
  path: string
  commit: string
  layers: string[]
  /** True when an existing worktree served the request (cache hit). */
  reused: boolean
}

/**
 * Sparse-checkout patterns limiting a worktree to one dataset's layer
 * directories, at BOTH levels: non-cone gitignore syntax — `*` matches one
 * path segment, so the item-level pattern covers every item's directory for
 * that layer, and the dataset-level pattern covers the shared layer directory
 * of the same name. Nothing else materializes.
 * @param datasetId - the dataset whose layers are exposed.
 * @param layers - the allowed layers.
 * @returns the sparse-checkout patterns.
 */
export function layerSparsePatterns(datasetId: string, layers: readonly string[]): string[] {
  return [...layers].sort().flatMap(layer => [
    `/${datasetDir(datasetId)}/items/*/${layer}/`,
    `/${datasetDir(datasetId)}/${layer}/`,
  ])
}

/**
 * Acquire the managed worktree for (repo, commit, layers), creating it on a
 * cache miss. Same-key concurrent creators serialize on the creation lock;
 * the second one reuses the finished directory.
 * @param repo - repository path.
 * @param commit - pinned commit (a ref is resolved first).
 * @param datasetId - the dataset the layers belong to.
 * @param layers - allowed layers (sorted inside the cache key).
 * @param root - managed worktree root.
 * @returns the worktree path plus acquisition metadata.
 */
export async function ensureWorktree(
  repo: string,
  commit: string,
  datasetId: string,
  layers: readonly string[],
  root: string,
  /** Register-mapped file patterns (repo-relative, non-cone gitignore syntax) of the allowed layers. */
  registerPatterns: readonly string[] = [],
): Promise<ManagedWorktree> {
  // Canonicalize BOTH sides of the cache key: a symlinked path (macOS
  // /var → /private/var) must not fork the cache, and git itself registers
  // worktrees by their realpath.
  const repoReal = realpathSync(repo)
  mkdirSync(root, { recursive: true })
  const rootReal = realpathSync(root)
  const sha = await resolveCommit(repo, commit)
  const sortedLayers = [...new Set(layers)].sort()
  const sortedRegister = [...new Set(registerPatterns)].sort()
  const dir = worktreeDirFor(rootReal, repoReal, sha, sortedLayers, sortedRegister)
  return await withCreationLock(dir, async () => {
    if (existsSync(join(dir, '.git'))) {
      return { path: dir, commit: sha, layers: sortedLayers, reused: true }
    }
    rmSync(dir, { recursive: true, force: true }) // a partial earlier creation
    await mkdir(dirname(dir), { recursive: true })
    try {
      await git(repo, ['worktree', 'add', '--detach', dir, sha])
      // Sparse-checkout AFTER the add: `set` prunes the working tree down to
      // the allowed layer directories, physically removing everything else.
      await git(dir, ['sparse-checkout', 'set', '--no-cone',
        ...layerSparsePatterns(datasetId, sortedLayers), ...sortedRegister])
      await git(repo, ['worktree', 'lock', dir])
    } catch (error) {
      await git(repo, ['worktree', 'remove', '--force', dir]).catch(() => undefined)
      rmSync(dir, { recursive: true, force: true })
      throw error
    }
    return { path: dir, commit: sha, layers: sortedLayers, reused: false }
  })
}

/**
 * Whether `dir` sits inside the managed root (path-prefix check on
 * separators, so `/root2` does not match root `/root`).
 */
function underRoot(root: string, dir: string): boolean {
  const rootReal = resolve(root)
  return dir === rootReal || dir.startsWith(`${rootReal}${sep}`)
}

/**
 * Remove every managed worktree of one repository: unlock, `git worktree
 * remove`, then the builtin `git worktree prune` for stale administrative
 * entries, and finally the now-empty hash directories. Only worktrees under
 * the managed root are touched — a consumer's own checkouts never are.
 * @param repo - repository path.
 * @param root - managed worktree root.
 * @returns the removed worktree paths.
 */
export async function pruneManagedWorktrees(repo: string, root: string): Promise<string[]> {
  const removed: string[] = []
  if (!existsSync(root)) return removed
  const rootReal = realpathSync(root)
  const entries = await listWorktrees(repo)
  for (const entry of entries) {
    if (!underRoot(rootReal, entry.path)) continue
    if (!entry.prunable) {
      if (entry.locked) await git(repo, ['worktree', 'unlock', entry.path]).catch(() => undefined)
      await git(repo, ['worktree', 'remove', '--force', entry.path])
    }
    removed.push(entry.path)
  }
  await git(repo, ['worktree', 'prune'])
  // Drop emptied per-repo hash directories.
  if (existsSync(root)) {
    for (const hashDir of readdirSync(root)) {
      const dir = join(root, hashDir)
      try {
        for (const leftover of readdirSync(dir)) {
          const path = join(dir, leftover)
          if (!existsSync(path)) rmSync(path, { recursive: true, force: true }) // stale entry git already forgot
        }
        rmdirSync(dir)
      } catch {
        // Not empty (or not a directory): keep it.
      }
    }
  }
  return removed
}

/**
 * Structural integrity check of the managed root for the invariant companion:
 * every entry must be a per-repo hash directory of `<commit>-<layersHash>`
 * worktree directories (or transient `.lock` dirs), each holding a `.git`
 * file. Anything else means foreign or corrupt state under the managed root.
 * @param root - managed worktree root.
 * @returns the first violation found, or undefined when the root is sound.
 */
export function checkManagedRootIntegrity(root: string): string | undefined {
  if (!existsSync(root)) return undefined
  for (const repoHash of readdirSync(root)) {
    const repoDir = join(root, repoHash)
    if (!/^[0-9a-f]{16}$/.test(repoHash) || !statSync(repoDir).isDirectory()) {
      return `${repoDir} is not a per-repo hash directory`
    }
    for (const entry of readdirSync(repoDir)) {
      if (entry.endsWith('.lock')) continue // transient creation lock
      const dir = join(repoDir, entry)
      if (!/^[0-9a-f]{40}-[0-9a-f]{12}$/.test(entry) || !statSync(dir).isDirectory()) {
        return `${dir} does not match the <commit>-<layersHash> worktree shape`
      }
      if (!existsSync(join(dir, '.git'))) {
        return `${dir} has no .git file — a partial or corrupt managed worktree`
      }
    }
  }
  return undefined
}
