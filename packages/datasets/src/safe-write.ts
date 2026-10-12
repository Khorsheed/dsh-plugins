/**
 * The repository write boundary of the datasets service. Every working-tree
 * write (`putItem`, the skeleton gestures, `importItem`) and every
 * enumeration-anchored source read goes through here, and containment is
 * decided on REAL paths and FILE IDENTITY, not strings:
 *
 * - the root is realpathed once per operation;
 * - parent directories are created by walking component by component with
 *   `lstat` — a symlinked (or non-directory) component refuses BEFORE any
 *   `mkdir` follows it, so a failed write creates nothing outside the root;
 * - the temp file is created with `O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW`:
 *   a pre-placed file or symlink at the candidate name is NEVER opened for
 *   writing (EEXIST/ELOOP bumps the counter, bounded, then a coded refusal) —
 *   an operation that errors must not have written outside first;
 * - the write itself is that temp file plus an atomic rename, and every
 *   re-check afterwards compares IDENTITY (dev+ino from the create's fd), not
 *   paths: the temp must still be the file this operation created and the
 *   parent directory must still be the directory that was checked — a
 *   real-directory rename-swap fools a path-string comparison, not an inode;
 * - cleanup deletes only what this operation provably owns: the temp file,
 *   or the post-rename target, each removed only while an `lstat` still shows
 *   a plain file with the create's identity — a foreign replacement is left
 *   alone, and the refusal is still coded;
 * - source reads open with `O_NOFOLLOW` (a symlink substituted for the file
 *   fails AT the open), confirm the opened fd is a regular file via `fstat`
 *   (a path lookup answers about the path, the fd answers about the file),
 *   and re-verify containment before any byte is read.
 */
import { constants } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { lstat, mkdir, open, realpath, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { DatasetsError } from './dataset.ts'

/** Unique temp suffixes within one process (two faces may write the same path concurrently). */
let tempCounter = 0

/** How many candidate temp names one operation tries before refusing coded (a pre-placement can only force refusal, never a write). */
const TEMP_NAME_ATTEMPTS = 32

/** The fields that identify one filesystem object across renames (and across path swaps). */
interface FileIdentity {
  dev: number
  ino: number
}

/**
 * The audit points the guard hook sees: `beforeCreate` (containment checked,
 * the temp not yet created — the service's dispose check), `beforeCommit`
 * (the temp written and closed, the pre-rename verification next — the seam a
 * test substitutes a swap through), and `afterRename` (the rename done, the
 * post-rename verification next). `path` is the target at `beforeCreate` /
 * `afterRename`, the temp file at `beforeCommit`.
 */
export type WriteBoundaryGuard = (point: 'beforeCreate' | 'beforeCommit' | 'afterRename', path: string) => void

/** Is `candidate` the root itself or a descendant? Both sides must already be real paths. */
function inside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`)
}

function sameIdentity(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino
}

/** The identity of the plain file at `path`, or undefined when it is missing, a symlink, or not a regular file. */
async function plainFileIdentity(path: string): Promise<FileIdentity | undefined> {
  const st = await lstat(path).catch(() => undefined)
  if (st === undefined || st.isSymbolicLink() || !st.isFile()) return undefined
  return { dev: st.dev, ino: st.ino }
}

/** The identity of the directory at `path` (resolved), or undefined when it is gone. */
async function dirIdentity(path: string): Promise<FileIdentity | undefined> {
  const st = await stat(path).catch(() => undefined)
  return st === undefined ? undefined : { dev: st.dev, ino: st.ino }
}

/**
 * Remove `path` only while it is provably the file this operation created:
 * an `lstat` must still show a plain file with the create's identity. A
 * foreign replacement — or a symlink — is left alone; failure never deletes
 * files it does not own.
 */
async function removeIfOurs(path: string, identity: FileIdentity): Promise<void> {
  const now = await plainFileIdentity(path)
  if (now !== undefined && sameIdentity(now, identity)) await rm(path, { force: true })
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
 * Create the temp file for one write, exclusively and without following
 * links: `O_EXCL` means a name that exists is never opened for writing,
 * `O_NOFOLLOW` means a pre-placed symlink fails as ELOOP. Each collision
 * bumps the counter; the namespace is bounded, so a full pre-placement
 * forces a coded refusal — never a write through somebody else's file.
 * @param target - the final path the temp sits beside.
 * @param rel - the root-relative target (for the refusal message).
 * @returns the temp path, its open handle, and its identity from the fd.
 */
async function createTempExclusive(
  target: string, rel: string,
): Promise<{ temporary: string; handle: FileHandle; identity: FileIdentity }> {
  for (let attempt = 0; attempt < TEMP_NAME_ATTEMPTS; attempt++) {
    const temporary = `${target}.${process.pid}.${tempCounter++}.tmp`
    let handle: FileHandle
    try {
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      // A pre-placed file or symlink at the candidate name: never opened —
      // try the next name.
      if (code === 'EEXIST' || code === 'ELOOP') continue
      throw error
    }
    const st = await handle.stat()
    return { temporary, handle, identity: { dev: st.dev, ino: st.ino } }
  }
  throw new DatasetsError(
    `refusing to write ${rel}: every temp-file name is already taken (a pre-placed temp namespace can only force this refusal, never a write)`,
    'PATH_ESCAPE',
  )
}

/**
 * Write one file inside the root, atomically (exclusive temp + rename), with
 * realpath containment verified at the boundary and IDENTITY re-verified
 * after the write. A refusal writes nothing outside the root and deletes
 * nothing it does not own.
 * @param root - the repository toplevel (realpathed here, once per call).
 * @param rel - the root-relative target path.
 * @param content - the bytes.
 * @param options - `keepExisting` leaves an existing file alone (skeleton
 *   semantics); `guard` runs at the audit points (beforeCreate / beforeCommit
 *   / afterRename) — the service's dispose check, and the seam a test
 *   substitutes a swap through.
 * @returns whether the file was written.
 */
export async function writeFileWithinRoot(
  root: string,
  rel: string,
  content: string | Buffer,
  options: { keepExisting?: boolean; guard?: WriteBoundaryGuard } = {},
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
  // The parent as a filesystem object: a rename-swap keeps the path string
  // but changes the inode, which is what the re-checks compare.
  const parentIdentity = await dirIdentity(parent)
  if (parentIdentity === undefined) {
    throw new DatasetsError(`refusing to write outside the repository: ${rel}`, 'PATH_ESCAPE')
  }
  options.guard?.('beforeCreate', target)
  const created = await createTempExclusive(target, rel)
  try {
    await created.handle.writeFile(content)
  } catch (error) {
    await created.handle.close().catch(() => undefined)
    await removeIfOurs(created.temporary, created.identity)
    throw error
  }
  await created.handle.close()
  options.guard?.('beforeCommit', created.temporary)
  // Pre-rename verification, by identity: the temp must still be the file
  // this operation created (not a foreign replacement), and the parent must
  // still be the directory that was checked (not a rename- or symlink-swap).
  const tempNow = await plainFileIdentity(created.temporary)
  const parentNow = await dirIdentity(parent)
  if (tempNow === undefined || !sameIdentity(tempNow, created.identity)
    || parentNow === undefined || !sameIdentity(parentNow, parentIdentity)) {
    // Cleanup deletes only what is provably ours; a foreign file stays.
    await removeIfOurs(created.temporary, created.identity)
    throw new DatasetsError(`refusing to write outside the repository: ${rel}`, 'PATH_ESCAPE')
  }
  try {
    await rename(created.temporary, target)
  } catch {
    // The boundary moved under the rename (the temp was swapped away); the
    // conditional cleanup still removes only what is provably ours.
    await removeIfOurs(created.temporary, created.identity)
    throw new DatasetsError(`refusing to write outside the repository: ${rel}`, 'PATH_ESCAPE')
  }
  options.guard?.('afterRename', target)
  // Post-rename verification: the target IS the file we wrote, and the parent
  // is still the checked directory. A foreign file at the target is left
  // alone; only our own bytes are ever removed.
  const landed = await plainFileIdentity(target)
  const parentAfter = await dirIdentity(parent)
  if (landed === undefined || !sameIdentity(landed, created.identity)
    || parentAfter === undefined || !sameIdentity(parentAfter, parentIdentity)) {
    await removeIfOurs(target, created.identity)
    throw new DatasetsError(`refusing to write outside the repository: ${rel}`, 'PATH_ESCAPE')
  }
  return true
}

/**
 * Read one enumerated source file, gaplessly against substitution: the open
 * carries `O_NOFOLLOW` (a symlink swapped in for the final component fails AT
 * the open), the opened fd must be a regular file (fstat — the fd answers
 * about the file, not the path), and the resolved path must still sit under
 * the enumerated root before any byte is read (a swapped intermediate
 * component; a race here can only refuse, never read the wrong file).
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
    const opened = await handle.stat()
    if (!opened.isFile()) {
      throw new DatasetsError(`refusing to read ${rel}: not a regular file (substituted)`, 'PATH_ESCAPE')
    }
    if (!inside(base, await realpath(target))) {
      throw new DatasetsError(`refusing to read ${rel}: substituted with a path outside the source directory`, 'PATH_ESCAPE')
    }
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}
