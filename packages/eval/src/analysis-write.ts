/**
 * The NARROW WRITE into one experiment's `analysis/` directory — the analysis
 * draft's door, and deliberately a small one (I5·T39 · G16; T73).
 *
 * Step 8 ends with the agent writing an analysis of the bundle. The session's
 * workspace is not where that analysis belongs, so the `write` tool hit the
 * sandbox and the only way through was a human approving an escalation to
 * `danger-full-access` — the whole machine opened so a model could save one
 * markdown file. The size of the grant had nothing to do with the size of the
 * act, so the act got its own door.
 *
 * Before T73 the door opened into the session's bound dataset repository
 * (`docs/`, and a set's `plans/`, `conditions/`, `analysis/`). That put an
 * evaluation's own records into a checkout several agents share. The dataset
 * repository is read-only input now, and the door opens into the one place an
 * analysis belongs: `$DSH_HOME/state/eval/experiments/<id>/analysis/`. The
 * whitelist is that one prefix, hardcoded here and not configurable.
 *
 * Every refusal names the path it refused and the prefix it would have taken,
 * verbatim, because "denied" without either is how an agent starts guessing
 * at paths.
 * @module @khorsheed/dsh-eval
 */
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

/** Thrown when a write is outside the door — refused with the path and the door. */
export class EvalWriteRefused extends Error {}

/** The experiment-relative prefix this verb may write under, for a refusal to quote. */
export const ANALYSIS_WRITE_PREFIX = 'analysis/<path>'

/** One accepted write target. */
export interface AnalysisWriteTarget {
  /** The path as the caller gave it, normalized to experiment-relative POSIX form (`analysis/…`). */
  relativePath: string
  /** The absolute path on disk. */
  path: string
}

/** What one accepted write did. */
export interface AnalysisWriteResult extends AnalysisWriteTarget {
  experimentId: string
  /** Bytes written (UTF-8). */
  bytes: number
  /** True when the file did not exist before this call. */
  created: boolean
}

/** The refusal every out-of-bounds path gets, with the door quoted verbatim. */
function outside(path: string, why: string): EvalWriteRefused {
  return new EvalWriteRefused(
    `${JSON.stringify(path)} is not a path this verb may write: ${why}. `
    + `Allowed, and nothing else: ${ANALYSIS_WRITE_PREFIX} — relative to the experiment directory. `
    + 'The dataset repository is never writable here. Re-issue the same text at an allowed path; nothing was written.',
  )
}

/**
 * Check one requested path against the door.
 *
 * String checks BEFORE any filesystem call — `..`, an absolute path and a
 * prefix that is not `analysis/` are refused without touching the disk, so a
 * probe cannot learn what exists by watching which refusals are slower. The
 * filesystem is consulted only to confirm that a path which already passed
 * does not leave `analysis/` through a symlink.
 * @param experimentDir - the experiment directory (absolute).
 * @param requested - the experiment-relative path the caller asked for.
 * @returns the accepted target.
 * @throws {@link EvalWriteRefused} on anything outside the door.
 */
export async function resolveAnalysisWrite(experimentDir: string, requested: string): Promise<AnalysisWriteTarget> {
  const raw = requested.trim()
  if (raw === '') throw outside(requested, 'it is empty')
  if (isAbsolute(raw) || raw.startsWith('~')) {
    throw outside(requested, 'it is an absolute path, and this verb takes a path relative to the experiment directory')
  }
  const segments = raw.split(/[\\/]+/).filter(part => part !== '' && part !== '.')
  if (segments.includes('..')) throw outside(requested, 'it contains ".."')
  if (segments[0] !== 'analysis') {
    throw outside(requested, `${segments[0] ?? ''}/ is not the analysis directory`)
  }
  if (segments.length < 2) throw outside(requested, 'it names no file under analysis/')

  const relativePath = segments.join('/')
  const root = resolve(experimentDir, 'analysis')
  const path = resolve(experimentDir, relativePath)
  const rootReal = await realpath(root).catch(() => root)
  // The same check again, against REAL paths: a directory under analysis/
  // could be a symlink out of it, and a string that passed above would then
  // write anywhere.
  const anchorReal = await realpath(await deepestExisting(dirname(path))).catch(() => null)
  if (anchorReal !== null && anchorReal !== rootReal && !anchorReal.startsWith(rootReal + sep)) {
    throw outside(requested, 'it resolves outside analysis/ (a symlinked directory on the way)')
  }
  const inside = relative(root, path)
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    throw outside(requested, 'it resolves outside analysis/')
  }
  return { relativePath, path }
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
 * @param experiment - the experiment's id and directory.
 * @param requested - the experiment-relative path (`analysis/…`).
 * @param content - the file's text (UTF-8); an empty body is refused.
 * @param options - `overwrite` allows replacing an existing file.
 * @returns what was written.
 * @throws {@link EvalWriteRefused} outside the door, or on an unpermitted overwrite.
 */
export async function writeAnalysisFile(
  experiment: { id: string; dir: string },
  requested: string,
  content: string,
  options: { overwrite?: boolean } = {},
): Promise<AnalysisWriteResult> {
  if (content === '') {
    throw new EvalWriteRefused(
      `refusing to write an empty file at ${JSON.stringify(requested)} — an empty analysis is not an analysis, `
      + 'and a file created by accident is harder to notice than a call that failed.',
    )
  }
  const target = await resolveAnalysisWrite(experiment.dir, requested)
  let created = true
  try {
    await stat(target.path)
    created = false
  } catch {
    // Absent is the ordinary case.
  }
  if (!created && options.overwrite !== true) {
    throw new EvalWriteRefused(
      `${target.relativePath} already exists in experiment ${experiment.id} — pass overwrite to replace it, or pick another name. `
      + 'Nothing was written.',
    )
  }
  await mkdir(dirname(target.path), { recursive: true })
  await writeFile(target.path, content, 'utf8')
  return { ...target, experimentId: experiment.id, bytes: Buffer.byteLength(content, 'utf8'), created }
}
