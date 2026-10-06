/**
 * T99 · deleting a dataset repository from disk — the registration's 「删除」
 * and the organizing result's 「放弃」.
 *
 * The browser names a registration or a proposal by id, never a path: the
 * directory is derived here from the record's git common dir, and every rule
 * below is checked again at the moment of deletion. A directory is deleted
 * only when ALL of these hold; otherwise the plan says the files stay where
 * they are, and why:
 *
 * - it lies strictly inside the datasets home (`$DSH_HOME/datasets`), both
 *   taken as realpaths — a repository the person registered from elsewhere
 *   is theirs, and only the record goes;
 * - no component from the home down to the directory is a symlink (the
 *   realpath of the directory equals the directory), and a work tree's
 *   `.git` is a real directory, not a link or a gitfile;
 * - git, asked from the directory, answers the same common dir and (for a
 *   work tree) names the directory itself as the toplevel — it is the
 *   registered repository's root, not a folder inside it or another repository;
 * - the repository has no other checkout outside the directory, except the
 *   legacy managed worktrees under this plugin's own state root.
 *
 * Deletion first renames the directory to a hidden sibling inside the home
 * (one atomic step on one filesystem), then the caller drops the record, then
 * the renamed tree goes; a failure after the rename leaves a hidden leftover,
 * never a half-deleted repository still registered.
 * @module @khorsheed/dsh-datasets
 */
import { existsSync, lstatSync, realpathSync, renameSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { git, gitCommonDir, repoToplevel } from './git.ts'
import { removeReadOnlyTree, repoKeyOf } from './materialize.ts'

/** Why a repository's files stay on disk. */
export type KeepReason =
  /** Not inside the datasets home: a repository the person keeps elsewhere. */
  | 'outside-home'
  /** A symlink sits on the way from the home to the repository, or the repository is one. */
  | 'symlink'
  /** The directory is not the registered repository's root (git disagrees, or `.git` is not a directory). */
  | 'not-repo-root'
  /** The repository has checkouts outside its directory that would be left dangling. */
  | 'other-checkouts'
  /** The directory is gone already: nothing to delete. */
  | 'missing'
  /** (proposals) The repository is registered: discarding a proposal never deletes a registered repository. */
  | 'registered'

/** What a removal would do to the disk. */
export interface RemovalPlan {
  /** The repository directory: the work tree root, or the bare repository. */
  path: string
  /** `delete`: the directory goes; `keep`: only the record goes, the files stay where they are. */
  files: 'delete' | 'keep'
  /** Why the files stay (only with `keep`). */
  keepReason?: KeepReason
  /** With `other-checkouts`: the checkouts outside the directory. */
  otherCheckouts?: string[]
  /** Plugin state that goes with a delete (materialized views, legacy managed worktrees). */
  state: string[]
}

/** Where the plugin's own state lives. */
export interface RemovalRoots {
  /** The datasets home: the only place a repository directory may be deleted from. */
  datasetsHome: string
  /** The materialized-view root (`<stateRoot>/materialized`). */
  materializedRoot: string
  /** The plugin state root (`<stateRoot>`); legacy managed worktrees live under `worktrees/`. */
  stateRoot: string
}

/** Whether `child` is strictly inside `parent` (both absolute, both canonical). */
export function isStrictlyInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** The directory a common dir belongs to: `<root>/.git` → `<root>`; a bare repository is its own directory. */
export function repositoryDirOf(commonDir: string): string {
  return basename(commonDir) === '.git' ? dirname(commonDir) : commonDir
}

/** The realpath of a directory, or undefined when it does not exist. */
function realOrUndefined(path: string): string | undefined {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

/** Whether any component strictly below `base` down to `target` is a symlink (both canonical-prefixed). */
function symlinkOnTheWay(base: string, target: string): boolean {
  const parts = relative(base, target).split(sep).filter(part => part !== '')
  let at = base
  for (const part of parts) {
    at = join(at, part)
    try {
      if (lstatSync(at).isSymbolicLink()) return true
    } catch {
      return false
    }
  }
  return false
}

/** Every checkout git knows for the repository, with prunable (vanished) ones left out. */
async function checkoutsOf(commonDir: string): Promise<string[]> {
  let out: string
  try {
    out = await git(commonDir, ['worktree', 'list', '--porcelain'])
  } catch {
    return []
  }
  const paths: string[] = []
  for (const block of out.split('\n\n')) {
    const lines = block.split('\n')
    const head = lines.find(line => line.startsWith('worktree '))
    if (head === undefined || lines.some(line => line === 'bare')) continue
    const path = head.slice('worktree '.length)
    if (existsSync(path)) paths.push(realOrUndefined(path) ?? path)
  }
  return paths
}

/**
 * Plan the removal of one repository's directory, checking every rule in the
 * module comment. Reads only; never writes.
 * @param commonDir - the record's git common dir (from the registry or the proposal, never the client).
 * @param roots - the datasets home and the plugin's state roots.
 * @returns what a removal would do.
 */
export async function planRepoRemoval(commonDir: string, roots: RemovalRoots): Promise<RemovalPlan> {
  const path = repositoryDirOf(commonDir)
  const keep = (keepReason: KeepReason, extra: Partial<RemovalPlan> = {}): RemovalPlan =>
    ({ path, files: 'keep', keepReason, state: [], ...extra })

  const home = realOrUndefined(roots.datasetsHome)
  if (home === undefined || !isStrictlyInside(home, path)) {
    // The record's path is canonical, so a lexical check against the real
    // home is exact; a repository registered through a link into the home
    // was canonicalized OUT of it and is kept, as it should be.
    return keep('outside-home')
  }
  if (!existsSync(path) && !symlinkOnTheWay(home, path)) return keep('missing')
  if (symlinkOnTheWay(home, path) || realOrUndefined(path) !== path) return keep('symlink')
  if (!lstatSync(path).isDirectory()) return keep('not-repo-root')
  const bare = path === commonDir
  if (!bare) {
    let dotGit
    try {
      dotGit = lstatSync(join(path, '.git'))
    } catch {
      return keep('not-repo-root')
    }
    if (!dotGit.isDirectory() || dotGit.isSymbolicLink()) return keep('not-repo-root')
  }
  try {
    if (await gitCommonDir(path) !== commonDir) return keep('not-repo-root')
    if (!bare && realOrUndefined(await repoToplevel(path)) !== path) return keep('not-repo-root')
  } catch {
    return keep('not-repo-root')
  }

  const state: string[] = []
  const managedRoot = realOrUndefined(join(roots.stateRoot, 'worktrees'))
  const others: string[] = []
  for (const checkout of await checkoutsOf(commonDir)) {
    if (checkout === path || isStrictlyInside(path, checkout)) continue
    if (managedRoot !== undefined && isStrictlyInside(managedRoot, checkout) && !symlinkOnTheWay(managedRoot, checkout)) {
      state.push(checkout)
      continue
    }
    others.push(checkout)
  }
  if (others.length > 0) return keep('other-checkouts', { otherCheckouts: others.sort() })

  const materialized = join(roots.materializedRoot, repoKeyOf(commonDir))
  if (existsSync(materialized) && !lstatSync(materialized).isSymbolicLink()) state.push(materialized)
  return { path, files: 'delete', state: state.sort() }
}

/**
 * Move a planned repository out of the way: an atomic rename to a hidden
 * sibling inside the datasets home. The caller then drops the record and
 * calls {@link finishRemoval}.
 * @param plan - a `delete` plan, freshly computed.
 * @returns the renamed directory.
 */
export function stageRemoval(plan: RemovalPlan): string {
  if (plan.files !== 'delete') throw new Error(`refusing to stage a ${plan.files} plan`)
  const staged = join(dirname(plan.path), `.removing-${basename(plan.path)}-${process.pid}-${Date.now()}`)
  renameSync(plan.path, staged)
  return staged
}

/**
 * Delete the staged directory and the plugin state the plan named. Never
 * follows a symlink: each tree is removed with links unlinked, not walked.
 * @param staged - what {@link stageRemoval} returned.
 * @param plan - the same plan.
 */
export function finishRemoval(staged: string, plan: RemovalPlan): void {
  removeReadOnlyTree(staged)
  for (const path of plan.state) removeReadOnlyTree(path)
}
