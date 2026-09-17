/**
 * The NARROW WRITE into the session's bound dataset repository working tree —
 * the analysis draft's door, and deliberately a small one (I5·T39 · G16).
 *
 * Step 8 ends with the agent writing an analysis of the bundle, and that
 * analysis belongs in the dataset repository beside the plan and the
 * conditions it is about. The session's workspace is not that repository, so
 * the `write` tool hit the sandbox and the only way through was a human
 * approving an escalation to `danger-full-access` — the whole machine opened
 * so a model could save one markdown file. The size of the grant had nothing
 * to do with the size of the act.
 *
 * So this is the act, with its own door. It writes ONE text file, into ONE
 * repository (the session's binding — never a path an agent picked), under a
 * whitelist of prefixes that is hardcoded HERE and not configurable: the
 * pass-through areas of the repository, where nothing withheld lives.
 *
 * What the whitelist covers and why:
 *
 * - `docs/…` — the repository's own documentation. Outside `datasets/`
 *   entirely, so no dataset layer, no rubric and no oracle can be reached
 *   through it. This is where the walkthrough's analysis draft went.
 * - `datasets/<set>/plans/…` and `datasets/<set>/conditions/…` — the
 *   pass-through files `eval_plan_draft` already writes. Named so that a
 *   hand-fixed plan does not need a second mechanism; the drafting verb is
 *   still the right way to make one, and it validates what it writes.
 * - `datasets/<set>/analysis/…` — per-experiment analysis drafts, for a
 *   repository that would rather keep them beside the set than in `docs/`.
 *
 * What it can NEVER reach is the material: `datasets/<set>/items/…` is not on
 * the list, so no layer of any item — `answers/oracle`, `rubric.yml`,
 * `standards.yml`, the题面 itself — is writable through this verb, whatever
 * the binding's whitelist admits for READING. An evaluation's subject matter
 * is not something the subject's own drafting agent edits.
 *
 * Every refusal names the path it refused and the prefixes it would have
 * taken, verbatim, because "denied" without either is how an agent starts
 * guessing at paths.
 * @module @khorsheed/dsh-eval
 */
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Thrown when a write is outside the door — refused with the path and the door. */
export class EvalWriteRefused extends Error {}

/** The sub-directories of a dataset set this verb may write into. */
export const REPO_WRITE_SET_DIRS: readonly string[] = ['plans', 'conditions', 'analysis']

/** The repository-relative prefixes this verb may write under, for a refusal to quote. */
export const REPO_WRITE_PREFIXES: readonly string[] = [
  'docs/<path>',
  ...REPO_WRITE_SET_DIRS.map(dir => `datasets/<set>/${dir}/<path>`),
]

/** One accepted write target: the file, and the dataset set it belongs to (if any). */
export interface RepoWriteTarget {
  /** The path as the caller gave it, normalized to repository-relative POSIX form. */
  relativePath: string
  /** The absolute path on disk. */
  path: string
  /** The dataset set the path belongs to, or null for a repository-level file. */
  dataset: string | null
}

/** What one accepted write did. */
export interface RepoWriteResult extends RepoWriteTarget {
  repo: string
  /** Bytes written (UTF-8). */
  bytes: number
  /** True when the file did not exist before this call. */
  created: boolean
}

/** The refusal every out-of-bounds path gets, with the door quoted verbatim. */
function outside(path: string, why: string): EvalWriteRefused {
  return new EvalWriteRefused(
    `${JSON.stringify(path)} is not a path this session may write: ${why}. `
    + `Allowed, and nothing else: ${REPO_WRITE_PREFIXES.join(', ')} — relative to the bound dataset repository. `
    + 'The item material (datasets/<set>/items/…) is never writable here, whatever the binding admits for reading. '
    + 'Re-issue the same text at an allowed path; nothing was written.',
  )
}

/**
 * Check one requested path against the door.
 *
 * String checks BEFORE any filesystem call — `..`, an absolute path and a
 * prefix that is not on the list are refused without touching the disk, so a
 * probe cannot learn what exists by watching which refusals are slower. The
 * filesystem is consulted only to confirm that a path which already passed
 * does not leave the repository through a symlink.
 * @param repo - the resolved repository (the session's binding).
 * @param requested - the repository-relative path the caller asked for.
 * @param allowedDatasets - the binding's dataset whitelist, or undefined for all.
 * @returns the accepted target.
 * @throws {@link EvalWriteRefused} on anything outside the door.
 */
export async function resolveRepoWrite(
  repo: string,
  requested: string,
  allowedDatasets?: readonly string[],
): Promise<RepoWriteTarget> {
  const raw = requested.trim()
  if (raw === '') throw outside(requested, 'it is empty')
  if (isAbsolute(raw) || raw.startsWith('~')) {
    throw outside(requested, 'it is an absolute path, and this verb takes a path relative to the repository')
  }
  const segments = raw.split(/[\\/]+/).filter(part => part !== '' && part !== '.')
  if (segments.includes('..')) throw outside(requested, 'it contains ".."')
  if (segments.length < 2) throw outside(requested, 'it names no file under one of the allowed directories')

  let dataset: string | null = null
  if (segments[0] === 'docs') {
    // Repository documentation: anything below it, any depth.
  } else if (segments[0] === 'datasets') {
    const set = segments[1]
    const area = segments[2]
    if (set === undefined || area === undefined || segments.length < 4) {
      throw outside(requested, 'a path under datasets/ must name a set, one of its allowed directories, and a file')
    }
    if (!REPO_WRITE_SET_DIRS.includes(area)) {
      throw outside(requested, `datasets/${set}/${area}/ is not one of the writable directories of a set`)
    }
    if (allowedDatasets !== undefined && !allowedDatasets.includes(set)) {
      throw outside(requested, `dataset set ${JSON.stringify(set)} is outside this session's binding (${allowedDatasets.join(', ')})`)
    }
    dataset = set
  } else {
    throw outside(requested, `${segments[0]}/ is not one of the writable areas of a dataset repository`)
  }

  const relativePath = segments.join('/')
  const path = resolve(repo, relativePath)
  const repoReal = await realpath(repo).catch(() => resolve(repo))
  // The same check again, against REAL paths: `docs` could be a symlink out of
  // the repository, and a string that passed above would then write anywhere.
  const anchorReal = await realpath(await deepestExisting(dirname(path))).catch(() => null)
  if (anchorReal !== null && anchorReal !== repoReal && !anchorReal.startsWith(repoReal + sep)) {
    throw outside(requested, 'it resolves outside the repository (a symlinked directory on the way)')
  }
  const inside = relative(repoReal, resolve(repoReal, relativePath))
  if (inside.startsWith('..') || isAbsolute(inside)) {
    throw outside(requested, 'it resolves outside the repository')
  }
  return { relativePath, path, dataset }
}

/** The nearest existing ancestor of a path — what `realpath` can actually be asked about. */
async function deepestExisting(dir: string): Promise<string> {
  let current = dir
  for (;;) {
    try {
      await stat(current)
      return current
    } catch {
      const parent = dirname(current)
      if (parent === current) return current
      current = parent
    }
  }
}

/**
 * Write one text file through the door.
 *
 * Nothing is overwritten unless the caller said so. An analysis draft gets
 * revised and a flag is the honest way to say "yes, replace the one I wrote";
 * a silent overwrite is how a second agent's draft disappears.
 * @param repo - the resolved repository (the session's binding).
 * @param requested - the repository-relative path.
 * @param content - the file's text (UTF-8); an empty body is refused.
 * @param options - `overwrite` allows replacing an existing file.
 * @returns what was written.
 * @throws {@link EvalWriteRefused} outside the door, or on an unpermitted overwrite.
 */
export async function writeRepoFile(
  repo: string,
  requested: string,
  content: string,
  options: { overwrite?: boolean } = {},
): Promise<RepoWriteResult> {
  if (content === '') {
    throw new EvalWriteRefused(
      `refusing to write an empty file at ${JSON.stringify(requested)} — an empty analysis is not an analysis, `
      + 'and a file created by accident is harder to notice than a call that failed.',
    )
  }
  const target = await resolveRepoWrite(repo, requested, undefined)
  return await writeResolved(repo, target, content, options)
}

/**
 * {@link writeRepoFile} for a caller that already resolved the target —
 * the service, which resolves the binding's dataset whitelist as part of the
 * same scope lookup every other verb uses.
 * @param repo - the resolved repository.
 * @param target - the accepted target.
 * @param content - the file's text.
 * @param options - `overwrite` allows replacing an existing file.
 */
export async function writeResolved(
  repo: string,
  target: RepoWriteTarget,
  content: string,
  options: { overwrite?: boolean } = {},
): Promise<RepoWriteResult> {
  let created = true
  try {
    await stat(target.path)
    created = false
  } catch {
    // Absent is the ordinary case.
  }
  if (!created && options.overwrite !== true) {
    throw new EvalWriteRefused(
      `${target.relativePath} already exists in ${repo} — pass overwrite to replace it, or pick another name. `
      + 'Nothing was written.',
    )
  }
  await mkdir(dirname(target.path), { recursive: true })
  await writeFile(target.path, content, 'utf8')
  return { ...target, repo, bytes: Buffer.byteLength(content, 'utf8'), created }
}

/** The repository-relative directory a run's analysis drafts belong in, by dataset set. */
export function analysisDirOf(dataset: string): string {
  return join('datasets', dataset, 'analysis')
}
