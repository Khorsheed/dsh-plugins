/**
 * One repository path reduced to its canonical form — the form the binding
 * store records, every read path consumes, and two spellings are COMPARED in.
 *
 * Two jobs, one answer. Since I5·T58 the `repo` argument a model tool passes
 * may only RESTATE the session's binding, and the two spellings that reach
 * that check are written by different hands: a binding a person recorded as
 * `~/scratch/dataseek` and an argument an agent typed as
 * `/Users/…/scratch/dataseek` name one repository and must not read as two.
 * Since I5·T62 the store itself holds this form, because a bound path is
 * consumed by `git -C`, by `readdir(<repo>/datasets)`, and by containment
 * checks against a session's realpath cwd — none of which expand `~` (the
 * shell does, and no shell is in the loop when the web tab writes a binding).
 * A stored `~/x` therefore reached git as a literal directory named `~`, and
 * both tabs reported "not a git repository" about a repository that exists
 * (I5 walkthrough gap G5).
 * @module @khorsheed/dsh-datasets
 */
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Expand a leading `~` against the current user's home directory.
 * @param path - the path as its writer spelled it.
 * @returns the expanded path.
 */
export function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

/**
 * The canonical form of one repository path: `~` expanded, absolute, trailing
 * separator dropped, and resolved through symlinks when the path exists on
 * this machine. Resolving links is what keeps `/tmp` and `/private/tmp` from
 * making two names for one repository compare unequal.
 *
 * A path that does not exist normalizes as far as it can rather than throwing:
 * normalizing is not the existence check (`assertRepository` is), a binding to
 * an unmounted volume must still round-trip, and refusing to compare is not an
 * improvement on comparing the text.
 * @param path - the path as typed, passed, or read back from an old record.
 * @returns the canonical path; '' stays '' for the caller's own shape check.
 */
export function normalizeRepoPath(path: string): string {
  const trimmed = path.trim()
  if (trimmed === '') return trimmed
  const absolute = resolve(expandHome(trimmed))
  try {
    return realpathSync(absolute)
  } catch {
    return absolute
  }
}

export function sameRepoPath(a: string, b: string): boolean {
  return normalizeRepoPath(a) === normalizeRepoPath(b)
}
