/**
 * The scope's own copy of a preset: where it is, what it hashes to, and the
 * one thing its composition may not contain.
 *
 * A condition's `preset` is measured through the evaluation instance's own
 * capability catalog, which resolves a preset id through the INSTANCE's
 * roster roots. The sub-dsh resolves it through the scoped home's — and on
 * the container path the scoped home is all there is, because a cell's unit
 * bind-mounts exactly that directory and nothing else. T32b's guard settled
 * the disagreement by forbidding the scope a copy of its own, which left the
 * preset reachable only on the host: inside a unit the roster's roots named a
 * path that does not exist and the sub-dsh refused to start (`preset
 * "eval-lean" not found`).
 *
 * The copy is how both are satisfied at once, and this module is what makes
 * it checkable:
 *
 * - **Where.** `<scoped home>/.agent-presets/<id>` — the roster's own derived
 *   user root, which is `<scope>/…` on the host and `/creds/dsh/…` inside the
 *   unit. One directory, because the unit binds the scope; one resolution
 *   rule instead of two.
 * - **Why a measurement taken elsewhere still describes it.** The canonical
 *   capability face carries no filesystem path — a skill enters as name,
 *   source channel and body digest, a tool as name, channel and parameter
 *   schema. Two byte-identical preset directories in two places therefore
 *   hash alike, which T32's own machine run measured from the other side:
 *   the same content under a different preset id produced the same digest.
 *   So byte-equality is what transfers the measurement, and the provisioning
 *   that made the copy is what reports it.
 * - **What the subject may not contain.** An absolute filesystem path. A
 *   preset used as a factor is read from three directories (the deployment's
 *   root, the scope, the unit's mount point), so an absolute path is wrong in
 *   at least two of them — silently, since `skill-filesystem` resolves a
 *   missing root to an empty one rather than to an error.
 *
 * The digest this module takes covers EVERY file, `SKILL.md` included, which
 * is what separates it from `home.sha`: the home hash takes config-suffixed
 * files by design, so a skill body edit moves nothing it records. That is the
 * edit a capability face exists to see, and this is how the readiness gate
 * and `validate` see it without a live catalog.
 * @module @khorsheed/dsh-eval
 */
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import yaml from 'js-yaml'

/** The preset root a harness home derives (the agent-preset roster's rule). */
export const USER_PRESET_DIR = '.agent-presets'

/** The file that makes a directory a preset (the roster's rule). */
export const PRESET_COMPOSITION_FILE = 'agent.cordis.yml'

/**
 * Where one scope keeps its own copy of a preset.
 * @param homeDir - the harness scoped home.
 * @param preset - the preset id.
 * @returns the directory, whether or not it exists.
 */
export function scopePresetDir(homeDir: string, preset: string): string {
  return join(homeDir, USER_PRESET_DIR, preset)
}

/** The digest of one preset directory, and how many files it covered. */
export interface PresetTreeHash {
  /** sha256 hex over the files' `<relPath>\0<content>\0` stream, sorted by relPath. */
  sha: string
  /** How many files were hashed. */
  files: number
}

/**
 * Hash one preset directory, every file of it.
 *
 * Returns `undefined` rather than throwing for every shape that is not a
 * plain tree of regular files — a missing directory, a symlink anywhere
 * inside it, a socket. A symlink is refused rather than followed for the same
 * reason the home hash skips one: it does not survive the bind mount into a
 * unit, so a preset half of which is a link is not the subject the unit runs.
 * Every caller turns absence into a stated refusal, never into a guess.
 * @param dir - the preset directory.
 * @returns the digest, or undefined when the directory is not hashable.
 */
export async function hashPresetTree(dir: string): Promise<PresetTreeHash | undefined> {
  const included: string[] = []
  const walk = async (absDir: string, rel: string): Promise<boolean> => {
    let entries
    try {
      entries = await readdir(absDir, { withFileTypes: true })
    } catch {
      return false
    }
    for (const entry of entries) {
      const relChild = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) return false
      if (entry.isDirectory()) {
        if (!await walk(join(absDir, entry.name), relChild)) return false
        continue
      }
      included.push(relChild)
    }
    return true
  }
  if (!await walk(dir, '')) return undefined
  const hash = createHash('sha256')
  for (const rel of [...included].sort()) {
    hash.update(`${rel}\0`)
    hash.update(await readFile(join(dir, rel)))
    hash.update('\0')
  }
  return { sha: hash.digest('hex'), files: included.length }
}

/**
 * A YAML schema that keeps `!!js` expressions as their SOURCE TEXT.
 *
 * Those expressions are the loader's to evaluate, never this reader's —
 * evaluating one here would run preset text as code inside the orchestrator.
 * Keeping the source is what lets the scan below see an absolute path written
 * inside one.
 */
const EXPRESSION_SCHEMA = yaml.DEFAULT_SCHEMA.extend(
  (['scalar', 'sequence', 'mapping'] as const).map(kind => new yaml.Type('tag:yaml.org,2002:js', {
    kind,
    construct: (data: unknown) => ({ __jsExpr: typeof data === 'string' ? data : '' }),
  })),
)

/** A quoted absolute path inside an expression's source text. */
const QUOTED_ABSOLUTE_RE = /(['"])(\/[^'"\n]*)\1/g

/**
 * Every absolute filesystem path a preset composition names.
 *
 * The form that travels is the loader's own expression, which the shipped
 * `cordis` preset uses for exactly this reason:
 *
 * ```yaml
 * customSkillDirs:
 *   - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"
 * ```
 *
 * `baseUrl` is the composition's own directory, so the root resolves wherever
 * the preset is installed — the deployment's root, a scope's copy, or the
 * unit's mount point.
 *
 * Unparsable YAML reports NO findings. The loader decides whether a
 * composition loads; refusing a preset because this reader could not parse it
 * would be this module overruling it, and a preset that will not load is
 * already refused by `snapshotFor`.
 * @param text - the `agent.cordis.yml` content.
 * @returns the offending literals, in document order, deduplicated.
 */
export function compositionAbsolutePaths(text: string): string[] {
  let document: unknown
  try {
    document = yaml.load(text, { schema: EXPRESSION_SCHEMA })
  } catch {
    return []
  }
  const found: string[] = []
  const add = (value: string): void => {
    if (!found.includes(value)) found.push(value)
  }
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      if (isAbsolute(value) || value.startsWith('file:///')) add(value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (typeof value !== 'object' || value === null) return
    const expression = (value as Record<string, unknown>)['__jsExpr']
    if (typeof expression === 'string') {
      for (const match of expression.matchAll(QUOTED_ABSOLUTE_RE)) {
        const literal = match[2]
        if (literal !== undefined) add(literal)
      }
      return
    }
    for (const item of Object.values(value as Record<string, unknown>)) walk(item)
  }
  walk(document)
  return found
}

/**
 * Why one scope's preset copy cannot be a measured subject, or undefined when
 * it can.
 *
 * Read at the MEASURING end, where a wrong digest would otherwise be minted.
 * The provisioning that wrote the copy refuses the same two shapes at the
 * writing end; both checks exist because either end alone leaves one way in
 * (a copy someone placed by hand, a deployment whose preset was edited after
 * it was copied).
 * @param dir - the scope's copy of the preset directory.
 * @returns the refusal reason, or undefined when the copy is usable.
 */
export async function scopePresetProblem(dir: string): Promise<string | undefined> {
  let composition: string
  try {
    composition = await readFile(join(dir, PRESET_COMPOSITION_FILE), 'utf8')
  } catch {
    return `${dir} holds no ${PRESET_COMPOSITION_FILE}, so it is not a preset the sub-dsh can compose`
  }
  const offenders = compositionAbsolutePaths(composition)
  if (offenders.length > 0) {
    return `the preset composition names absolute path(s) ${offenders.map(path => JSON.stringify(path)).join(', ')}`
      + ' — this copy is read from a different directory on the host and inside a unit, so an absolute path is wrong in at least one of them.'
      + ' Use the loader expression the shipped `cordis` preset uses:'
      + ' !!js "process.getBuiltinModule(\'node:url\').fileURLToPath(new URL(\'skills/\', baseUrl))"'
  }
  return undefined
}
