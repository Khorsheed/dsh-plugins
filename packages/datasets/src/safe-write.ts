/**
 * The repository write boundary of the datasets service. Every working-tree
 * write (`putItem`, the skeleton gestures, `importItem`) and every
 * enumeration-anchored source read goes through here, and containment is
 * decided on REAL paths, not strings:
 *
 * - the root is realpathed once per operation;
 * - parent directories are created by walking component by component with
 *   `lstat` — a symlinked (or non-directory) component refuses BEFORE any
 *   `mkdir` follows it, so a failed write creates nothing outside the root;
 * - the write itself is a temp file in the SAME directory plus a rename (the
 *   repo's atomic-write pattern), with the parent's realpath re-verified
 *   after the temp write and the target's after the rename — a directory
 *   swapped for a symlink in either window fails the write coded and the
 *   escaped artifact is removed, so a refusal leaves nothing outside;
 * - source reads open with `O_NOFOLLOW` (a symlink substituted for the file
 *   fails AT the open, not after it) and re-verify the resolved path against
 *   the enumerated root before any byte is read.
 */
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { DatasetsError } from './dataset.ts'

/** Unique temp suffixes within one process (two faces may write the same path concurrently). */
let tempCounter = 0

/** Is `candidate` the root itself or a descendant? Both sides must already be real paths. */
function inside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`)
}

/**
 * Create the missing directories between `root` and `dir`, one component at
 * a time. A single-level `mkdir` never traverses a symlink, so nothing is
 * ever created outside the root; an existing component that is a symlink or
 * not a directory refuses coded.
 * @param root - the realpathed root.
 * @param dir - the target directory (lexically under root).
 */
async function ensureDirWithinRoot(root: string, dir: string): Promise<void> {
  const rel = relative(root, dir)
  if (rel === '') return
  let current = root
  for (const segment of rel.split(sep)) {
    current = join(current, segment)
    const st = await lstat(current).catch(() => undefined)
    if (st === undefined) {
      try {
        await mkdir(current)
      } catch (error) {
        // A concurrent writer created it first: re-verify rather than fail.
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const again = await lstat(current)
        if (again.isSymbolicLink() || !again.isDirectory()) {
          throw new DatasetsError(`refusing to write through ${relative(root, current)}: not a plain directory`, 'PATH_ESCAPE')
        }
      }
      continue
    }
    if (st.isSymbolicLink() || !st.isDirectory()) {
      throw new DatasetsError(`refusing to write through ${relative(root, current)}: not a plain directory`, 'PATH_ESCAPE')
    }
  }
}

/**
 * Write one file inside the root, atomically (temp file + rename), with
 * realpath containment verified at the boundary and re-verified after the
 * write. A refusal writes NOTHING outside the root.
 * @param root - the repository toplevel (realpathed here, once per call).
 * @param rel - the root-relative target path.
 * @param content - the bytes.
 * @param options - `keepExisting` leaves an existing file alone (skeleton
 *   semantics); `guard` runs after the containment checks, immediately
 *   before the temp write — the service's dispose check, and the seam a
 *   test substitutes a directory swap through.
 * @returns whether the file was written.
 */
export async function writeFileWithinRoot(
  root: string,
  rel: string,
  content: string | Buffer,
  options: { keepExisting?: boolean; guard?: () => void } = {},
): Promise<boolean> {
  const base = await realpath(root)
  const target = resolve(base, rel)
  if (!inside(base, target)) {
    throw new DatasetsError(`refusing to write outside the repository: ${rel}`, 'INVALID_NAME')
  }
  // The final path is never followed through a symlink — one lstat, before
  // anything is created. `keepExisting` keeps today's early return for plain
  // existing files; a symlink refuses either way (dangling included, where
  // existsSync would have answered false and the write would have escaped).
  const existing = await lstat(target).catch(() => undefined)
  if (existing?.isSymbolicLink()) {
    throw new DatasetsError(`refusing to write through the symlink ${rel}`, 'PATH_ESCAPE')
  }
  if (options.keepExisting === true && existing !== undefined) return false
  const parent = dirname(target)
  await ensureDirWithinRoot(base, parent)
  const checkedParent = await realpath(parent)
  if (!inside(base, checkedParent)) {
    throw new DatasetsError(`refusing to write outside the repository: ${rel}`, 'PATH_ESCAPE')
  }
  options.guard?.()
  const temporary = `${target}.${process.pid}.${tempCounter++}.tmp`
  await writeFile(temporary, content)
  // TOCTOU, first window: the parent was swapped between the check and the
  // temp write — the temp landed wherever the swap pointed. Remove it there
  // and refuse: nothing outside survives a failed write.
  if (await realpath(parent).catch(() => '') !== checkedParent) {
    await rm(temporary, { force: true })
    throw new DatasetsError(`refusing to write outside the repository: ${rel}`, 'PATH_ESCAPE')
  }
  await rename(temporary, target)
  // TOCTOU, second window: a swap between the last check and the rename.
  // The rename already landed wherever the parent resolves to now; remove
  // what we wrote and refuse.
  if (await realpath(target).catch(() => '') !== target) {
    await rm(target, { force: true })
    throw new DatasetsError(`refusing to write outside the repository: ${rel}`, 'PATH_ESCAPE')
  }
  return true
}

/**
 * Read one enumerated source file, gaplessly against substitution: the open
 * carries `O_NOFOLLOW` (a symlink swapped in for the final component fails AT
 * the open), and the resolved path must still sit under the enumerated root
 * before any byte is read (a swapped intermediate component).
 * @param root - the enumerated source directory (realpathed here).
 * @param rel - the enumerated root-relative path.
 * @returns the file's bytes.
 */
export async function readFileWithinRoot(root: string, rel: string): Promise<Buffer> {
  const base = await realpath(root)
  const target = resolve(base, rel)
  if (!inside(base, target)) {
    throw new DatasetsError(`refusing to read outside the source directory: ${rel}`, 'INVALID_NAME')
  }
  let handle
  try {
    handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new DatasetsError(`refusing to read ${rel}: substituted by a symlink`, 'PATH_ESCAPE')
    }
    throw error
  }
  try {
    if (!inside(base, await realpath(target))) {
      throw new DatasetsError(`refusing to read ${rel}: substituted with a path outside the source directory`, 'PATH_ESCAPE')
    }
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}
