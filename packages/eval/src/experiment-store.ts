/**
 * EXPERIMENTS as deployment-level objects (T73).
 *
 * An experiment used to be a plan file inside a dataset repository's working
 * copy — `datasets/<set>/plans/<name>.json`, with its conditions beside it
 * and its analysis written wherever the agent could reach. That put the
 * evaluation's own records into a checkout several agents share, and tied
 * "which repository" to a per-session binding a person had to remember to
 * make. Now the dataset repository is read-only input, pinned as
 * `{registry, set, commit}`, and everything the evaluation itself produces
 * lives under the deployment's state root:
 *
 *     $DSH_HOME/state/eval/
 *       experiments/<expId>/plan.json      the plan, verbatim
 *                          /meta.json      name, origin, the dataset pin
 *                          /analysis/      eval_analysis_write's only door
 *                          /exports/       the default bundle location
 *       conditions/<id>.json               the condition library
 *       conditions/<id>.lock.json
 *
 * The library sits at `<stateRoot>/conditions/` on purpose: every condition
 * reader already resolves `<root>/conditions/<id>.json`, so the state root IS
 * the library's root and the readiness rules stay one implementation.
 * @module
 */
import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

/** The meta document's schema id. */
export const EXPERIMENT_META_SCHEMA = 'dsh.eval.experiment/1'

/**
 * An experiment id: `<slug>-<yyyymmdd>-<4 hex>`. Checked on every read so an
 * id is never a path: it cannot hold a separator or a dot-dot.
 */
export const EXPERIMENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

/** A dataset pinned the way an experiment pins it. */
export interface ExperimentDataset {
  /** The registration id (`/datasets` registry). */
  registry: string
  /** The dataset set inside that repository. */
  set: string
  /** The full commit sha every contract file is read at. */
  commit: string
}

/** `meta.json`. */
export interface ExperimentMeta {
  schema: typeof EXPERIMENT_META_SCHEMA
  experimentId: string
  /** The display name — the plan's `name`, or its file stem on import. */
  name: string
  /** The session that drafted it; null for an import or a CLI draft. */
  originSession: string | null
  /** ISO 8601. */
  createdAt: string
  dataset: ExperimentDataset
  /** Where an imported plan came from (`<id>@<ref>` and its repo-relative path); absent for a draft. */
  source?: { from: string; path: string }
}

/** One experiment as read back from disk. */
export interface ExperimentRecord {
  id: string
  /** The experiment directory (absolute). */
  dir: string
  /** `<dir>/plan.json`. */
  planPath: string
  meta: ExperimentMeta
}

/** Thrown when an experiment cannot be read, or cannot be created as asked. */
export class EvalExperimentError extends Error {}

/** `<stateRoot>/experiments`. */
export function experimentsRoot(stateRoot: string): string {
  return join(stateRoot, 'experiments')
}

/**
 * The directory whose `conditions/` child is the condition library — the
 * state root itself (see the module note).
 */
export function conditionLibraryRoot(stateRoot: string): string {
  return stateRoot
}

/** `<stateRoot>/conditions`. */
export function conditionLibraryDir(stateRoot: string): string {
  return join(conditionLibraryRoot(stateRoot), 'conditions')
}

/** A name reduced to the id's slug part: lower-case, `[a-z0-9-]`, at most 40 characters. */
export function experimentSlug(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
  return slug === '' ? 'experiment' : slug
}

/**
 * Mint an id: `<slug(name)>-<yyyymmdd>-<4 hex>` (UTC date). The date makes a
 * listing sortable by eye and the random tail makes two drafts of one name on
 * one day distinct; {@link createExperiment} retries on the (unlikely)
 * collision rather than trusting the tail.
 * @param name - the experiment name.
 * @param now - epoch ms.
 */
export function mintExperimentId(name: string, now: number = Date.now()): string {
  const date = new Date(now).toISOString().slice(0, 10).replace(/-/g, '')
  return `${experimentSlug(name)}-${date}-${randomBytes(2).toString('hex')}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse a meta document, or say what is wrong with it. */
function metaOf(value: unknown, id: string): ExperimentMeta {
  if (!isPlainObject(value)) throw new EvalExperimentError(`experiment ${id}: meta.json is not an object`)
  const dataset = value['dataset']
  if (
    !isPlainObject(dataset)
    || typeof dataset['registry'] !== 'string' || typeof dataset['set'] !== 'string' || typeof dataset['commit'] !== 'string'
  ) {
    throw new EvalExperimentError(`experiment ${id}: meta.json has no {registry, set, commit} dataset pin`)
  }
  if (value['experimentId'] !== id) {
    throw new EvalExperimentError(`experiment ${id}: meta.json names experimentId ${JSON.stringify(value['experimentId'])}`)
  }
  const source = isPlainObject(value['source']) && typeof value['source']['from'] === 'string' && typeof value['source']['path'] === 'string'
    ? { from: value['source']['from'], path: value['source']['path'] }
    : undefined
  return {
    schema: EXPERIMENT_META_SCHEMA,
    experimentId: id,
    name: typeof value['name'] === 'string' ? value['name'] : id,
    originSession: typeof value['originSession'] === 'string' ? value['originSession'] : null,
    createdAt: typeof value['createdAt'] === 'string' ? value['createdAt'] : '',
    dataset: { registry: dataset['registry'], set: dataset['set'], commit: dataset['commit'] },
    ...(source === undefined ? {} : { source }),
  }
}

/**
 * Read one experiment.
 * @param stateRoot - the eval state root.
 * @param id - the experiment id.
 * @throws {@link EvalExperimentError} when the id is malformed or nothing usable is there.
 */
export async function readExperiment(stateRoot: string, id: string): Promise<ExperimentRecord> {
  if (!EXPERIMENT_ID_RE.test(id)) throw new EvalExperimentError(`${JSON.stringify(id)} is not an experiment id`)
  const dir = join(experimentsRoot(stateRoot), id)
  let text: string
  try {
    text = await readFile(join(dir, 'meta.json'), 'utf8')
  } catch {
    throw new EvalExperimentError(`no experiment ${JSON.stringify(id)} in this deployment`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new EvalExperimentError(`experiment ${id}: meta.json is not valid JSON`)
  }
  return { id, dir, planPath: join(dir, 'plan.json'), meta: metaOf(parsed, id) }
}

/**
 * Every readable experiment, newest first. A directory whose meta cannot be
 * read is skipped and named in `problems` — one broken directory must not
 * empty the lab list.
 */
export async function listExperimentRecords(stateRoot: string): Promise<{ records: ExperimentRecord[]; problems: string[] }> {
  let names: string[]
  try {
    const entries = await readdir(experimentsRoot(stateRoot), { withFileTypes: true })
    names = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => entry.name)
  } catch {
    return { records: [], problems: [] }
  }
  const records: ExperimentRecord[] = []
  const problems: string[] = []
  for (const name of names) {
    try {
      records.push(await readExperiment(stateRoot, name))
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error))
    }
  }
  records.sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt) || a.id.localeCompare(b.id))
  return { records, problems }
}

/**
 * The experiment id a plan path belongs to, when it is some experiment's
 * `plan.json` under this state root; undefined for any other path (an old
 * plan in a dataset repository).
 */
export function experimentIdOfPlanPath(stateRoot: string, planPath: string): string | undefined {
  const rel = relative(experimentsRoot(stateRoot), resolve(planPath))
  const parts = rel.split(sep)
  if (parts.length !== 2 || parts[1] !== 'plan.json' || !EXPERIMENT_ID_RE.test(parts[0] as string)) return undefined
  return parts[0]
}

/** What {@link createExperiment} writes. */
export interface CreateExperimentInput {
  name: string
  originSession?: string | null
  dataset: ExperimentDataset
  /** The plan's exact bytes — a draft's serialization, or an imported file verbatim. */
  plan: Buffer | string
  source?: { from: string; path: string }
  /** Epoch ms; the id's date and `createdAt`. */
  now?: number
}

/**
 * Create one experiment directory ATOMICALLY and read it back.
 *
 * Everything is written into a hidden temp directory first and renamed into
 * place in one step, so a lister never sees a half-written experiment and a
 * crash leaves only a dot-directory the lister skips. The read-back is the
 * confirmation the callers report: the plan's bytes as they now read from the
 * final path must equal what was asked for, or the call fails.
 * @throws {@link EvalExperimentError} when the directory cannot be created or does not read back.
 */
export async function createExperiment(stateRoot: string, input: CreateExperimentInput): Promise<ExperimentRecord> {
  const now = input.now ?? Date.now()
  const root = experimentsRoot(stateRoot)
  await mkdir(root, { recursive: true })
  const bytes = typeof input.plan === 'string' ? Buffer.from(input.plan, 'utf8') : input.plan
  const temp = join(root, `.tmp-${process.pid}-${randomBytes(4).toString('hex')}`)
  let id: string | undefined
  try {
    for (let attempt = 0; attempt < 8 && id === undefined; attempt += 1) {
      const candidate = mintExperimentId(input.name, now)
      const meta: ExperimentMeta = {
        schema: EXPERIMENT_META_SCHEMA,
        experimentId: candidate,
        name: input.name,
        originSession: input.originSession ?? null,
        createdAt: new Date(now).toISOString(),
        dataset: { ...input.dataset },
        ...(input.source === undefined ? {} : { source: { ...input.source } }),
      }
      await rm(temp, { recursive: true, force: true })
      await mkdir(join(temp, 'analysis'), { recursive: true })
      await mkdir(join(temp, 'exports'), { recursive: true })
      await writeFile(join(temp, 'plan.json'), bytes)
      await writeFile(join(temp, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
      try {
        await rename(temp, join(root, candidate))
        id = candidate
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EEXIST' && code !== 'ENOTEMPTY') throw error
      }
    }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
  if (id === undefined) throw new EvalExperimentError(`could not mint a free experiment id for ${JSON.stringify(input.name)}`)
  const record = await readExperiment(stateRoot, id)
  const written = await readFile(record.planPath)
  if (!written.equals(bytes)) {
    throw new EvalExperimentError(`experiment ${id}: plan.json does not read back as written`)
  }
  return record
}
