/**
 * Whole-layer materialization by `git archive` (T73): a dataset's allowed
 * layers at one commit, extracted into a content-addressed, read-only
 * directory under the materialized root —
 * `<root>/<repoKey>/<sha>/<set>/<layers-key>/`.
 *
 * It replaces the managed-worktree view. A worktree is registered in the
 * repository's shared `.git` (and locked there), so every materialization
 * wrote shared state of a checkout other agents work in; `git archive` reads
 * objects only — no index, no HEAD, no worktree entry. The directory is keyed
 * by what fully determines its content (repository, commit, dataset, sorted
 * layers), so a repeat call is a cache hit and never re-extracts.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { assertSafeRelativePath, assertValidName, datasetDir, DatasetsError } from './dataset.ts'
import { archiveTo, gitCommonDir, resolveCommit } from './git.ts'

/** One materialized whole-layer view (the `worktreePath` face's return shape). */
export interface ManagedWorktree {
  /** Absolute directory holding the extracted paths (read-only). */
  path: string
  /** The commit the view was extracted from. */
  commit: string
  /** The layers the view carries, sorted. */
  layers: string[]
  /** True when the directory already existed (a cache hit). */
  reused: boolean
}

/** Where extraction stages before the atomic rename (inside the root, so rename never crosses a device). */
export const STAGING_DIR = '.staging'

/**
 * The stable key of one repository: a hash of its git common dir, so every
 * checkout and linked worktree of one repository shares one cache.
 * @param commonDir - the canonical common dir.
 * @returns 16 hex characters.
 */
export function repoKeyOf(commonDir: string): string {
  return createHash('sha256').update(commonDir).digest('hex').slice(0, 16)
}

/**
 * The directory name of one layer set: the sorted layer names joined with
 * `+` (layer names are validated names, so the key is filesystem-safe and
 * reads as what it is).
 * @param layers - the layers.
 * @returns the key.
 */
export function layersKeyOf(layers: readonly string[]): string {
  return [...new Set(layers)].sort().join('+')
}

/**
 * The repo-relative directories the given layers cover in one dataset, plus
 * any registered files, validated to stay inside that dataset.
 * @param datasetId - the dataset id.
 * @param layers - the layers (validated names).
 * @param files - the dataset's repo-relative file list at the commit.
 * @param registered - repo-relative registered files of those layers.
 * @returns the archive pathspecs, sorted and deduplicated.
 */
export function layerPaths(
  datasetId: string,
  layers: readonly string[],
  files: readonly string[],
  registered: readonly string[] = [],
): string[] {
  const base = datasetDir(datasetId)
  const out = new Set<string>()
  for (const file of files) {
    const rest = file.startsWith(`${base}/`) ? file.slice(base.length + 1) : undefined
    if (rest === undefined) continue
    const parts = rest.split('/')
    // Dataset-level layer directory: <base>/<layer>/…
    if (parts.length > 1 && layers.includes(parts[0]!)) out.add(`${base}/${parts[0]}`)
    // Item layer directory: <base>/items/<item>/<layer>/…
    if (parts[0] === 'items' && parts.length > 3 && layers.includes(parts[2]!)) {
      out.add(`${base}/items/${parts[1]}/${parts[2]}`)
    }
  }
  for (const file of registered) out.add(file)
  return [...out].sort()
}

/** Make a tree writable again (staging cleanup; the final tree stays read-only). */
function makeWritable(dir: string): void {
  if (!existsSync(dir)) return
  const walk = (path: string): void => {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return
    chmodSync(path, stat.isDirectory() ? 0o755 : 0o644)
    if (stat.isDirectory()) for (const entry of readdirSync(path)) walk(join(path, entry))
  }
  walk(dir)
}

/** Strip write bits from a tree: files 0444, directories 0555. */
function makeReadOnly(dir: string): void {
  const walk = (path: string): void => {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return
    if (stat.isDirectory()) for (const entry of readdirSync(path)) walk(join(path, entry))
    chmodSync(path, stat.isDirectory() ? 0o555 : 0o444)
  }
  walk(dir)
}

/**
 * Remove a (possibly read-only) directory tree.
 * @param dir - the directory.
 */
export function removeReadOnlyTree(dir: string): void {
  makeWritable(dir)
  rmSync(dir, { recursive: true, force: true })
}

/** Extract a tar into a directory. */
async function untar(archive: string, dest: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    execFile('tar', ['-xf', archive, '-C', dest], (error, _stdout, stderr) => {
      if (error !== null) reject(new DatasetsError(`extracting ${archive} failed: ${String(stderr).trim()}`, 'GIT_ERROR'))
      else resolvePromise()
    })
  })
}

/**
 * Materialize the given repo-relative paths of one dataset at one commit.
 *
 * The sha must be a full commit id the repository knows (an abbreviation or a
 * branch name would make the key lie about what it holds), and every path must
 * be a relative path inside `datasets/<set>/`. A present directory is a cache
 * hit; concurrent creators each stage privately and the first rename wins.
 * @param repo - a checkout, git dir, or bare repository.
 * @param sha - the full commit sha.
 * @param datasetId - the dataset (the key's `<set>` segment).
 * @param layers - the layers the view carries (the key's `<layers-key>` segment).
 * @param paths - repo-relative pathspecs to extract.
 * @param root - the materialized root.
 * @returns the view.
 */
export async function materializePaths(
  repo: string,
  sha: string,
  datasetId: string,
  layers: readonly string[],
  paths: readonly string[],
  root: string,
  viewKey?: string,
): Promise<ManagedWorktree> {
  assertValidName('dataset id', datasetId)
  for (const layer of layers) assertValidName('layer name', layer)
  // A reserved view key (leading `_`) can never equal a layers key — layer
  // names may not start with `_` — so a whole-set view never shares a cache
  // directory with a layer view.
  if (viewKey !== undefined && !/^_[a-z]+$/.test(viewKey)) {
    throw new DatasetsError(`invalid view key ${JSON.stringify(viewKey)}`, 'INVALID_NAME')
  }
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) {
    throw new DatasetsError(`materialization needs a full commit sha, got ${JSON.stringify(sha)}`, 'GIT_ERROR')
  }
  let known: string
  try {
    known = await resolveCommit(repo, sha)
  } catch {
    throw new DatasetsError(`commit ${sha} is not in the repository`, 'GIT_ERROR')
  }
  if (known !== sha) throw new DatasetsError(`commit ${sha} is not in the repository`, 'GIT_ERROR')
  const base = `${datasetDir(datasetId)}/`
  const safe = paths.map((path) => {
    if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) {
      throw new DatasetsError(`refusing to materialize an absolute path: ${JSON.stringify(path)}`, 'INVALID_NAME')
    }
    const rel = assertSafeRelativePath(path)
    if (!rel.startsWith(base)) {
      throw new DatasetsError(`refusing to materialize ${JSON.stringify(path)}: outside ${base}`, 'INVALID_NAME')
    }
    return rel
  })
  const sortedLayers = [...new Set(layers)].sort()
  const commonDir = await gitCommonDir(repo)
  const target = join(root, repoKeyOf(commonDir), sha, datasetId, viewKey ?? layersKeyOf(sortedLayers))
  if (existsSync(target)) return { path: target, commit: sha, layers: sortedLayers, reused: true }

  const stagingRoot = join(root, STAGING_DIR)
  mkdirSync(stagingRoot, { recursive: true })
  const staging = join(stagingRoot, `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const content = join(staging, 'content')
  mkdirSync(content, { recursive: true })
  try {
    if (safe.length > 0) {
      const archive = join(staging, 'layers.tar')
      await archiveTo(repo, sha, [...new Set(safe)].sort(), archive)
      await untar(archive, content)
    }
    // Lock everything below the top first; the top stays writable until the
    // rename lands, because moving a directory rewrites its own `..` entry
    // and that needs write permission on the directory being moved.
    for (const entry of readdirSync(content)) makeReadOnly(join(content, entry))
    mkdirSync(join(target, '..'), { recursive: true })
    try {
      renameSync(content, target)
    } catch (error) {
      // Another creator finished first: its directory is the same bytes.
      if (existsSync(target)) return { path: target, commit: sha, layers: sortedLayers, reused: true }
      throw error
    }
    chmodSync(target, 0o555)
    return { path: target, commit: sha, layers: sortedLayers, reused: false }
  } finally {
    removeReadOnlyTree(staging)
  }
}

/**
 * Integrity of the materialized root (the invariant companion's check): each
 * entry is `<16-hex repo key>/<sha>/<set>/<layers-key>` or the staging area.
 * A foreign entry means the cache can no longer be trusted to hold what its
 * key says.
 * @param root - the materialized root.
 * @returns a violation sentence, or undefined when the root is sound or absent.
 */
export function checkMaterializedRootIntegrity(root: string): string | undefined {
  if (!existsSync(root)) return undefined
  const dirs = (path: string): string[] | string => {
    const stat = lstatSync(path)
    if (!stat.isDirectory()) return `${path} is not a directory`
    return readdirSync(path)
  }
  const top = dirs(root)
  if (typeof top === 'string') return top
  for (const repoKey of top) {
    if (repoKey === STAGING_DIR) continue
    if (!/^[0-9a-f]{16}$/.test(repoKey)) return `unexpected entry ${join(root, repoKey)}`
    const shas = dirs(join(root, repoKey))
    if (typeof shas === 'string') return shas
    for (const sha of shas) {
      if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) return `unexpected entry ${join(root, repoKey, sha)}`
      const sets = dirs(join(root, repoKey, sha))
      if (typeof sets === 'string') return sets
      for (const set of sets) {
        const keys = dirs(join(root, repoKey, sha, set))
        if (typeof keys === 'string') return keys
        for (const key of keys) {
          const stat = lstatSync(join(root, repoKey, sha, set, key))
          if (!stat.isDirectory()) return `${join(root, repoKey, sha, set, key)} is not a directory`
        }
      }
    }
  }
  return undefined
}
