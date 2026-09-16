/**
 * One repository path reduced to the form two of them can be COMPARED in.
 *
 * Comparison is the whole purpose. Since I5·T58 the `repo` argument a model
 * tool passes may only RESTATE the session's binding, and the two spellings
 * that reach that check are written by different hands: a binding a person
 * recorded as `~/scratch/dataseek` and an argument an agent typed as
 * `/Users/…/scratch/dataseek` name one repository and must not read as two.
 *
 * Deliberately NOT a binding-store change: what the store records is I5·T62's
 * subject (the literal `~` it keeps today is what makes the git and datasets
 * read paths fail on it). This module only answers "are these the same
 * directory", which is a question with one right answer whichever form the
 * store settles on — so the check below keeps working either way.
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
 * The comparable form of one repository path: `~` expanded, absolute,
 * trailing separator dropped, and resolved through symlinks when the path
 * exists on this machine. A path that does not exist normalizes as far as it
 * can rather than throwing — refusing to compare is not an improvement on
 * comparing the text.
 * @param path - the path as written.
 * @returns the comparable form.
 */
export function normalizeRepoPath(path: string): string {
  const absolute = resolve(expandHome(path.trim()))
  try {
    return realpathSync(absolute)
  } catch {
    return absolute
  }
}

/**
 * Whether two repository paths name the same repository.
 * @param a - one path, as written.
 * @param b - the other.
 */
export function sameRepoPath(a: string, b: string): boolean {
  return normalizeRepoPath(a) === normalizeRepoPath(b)
}
