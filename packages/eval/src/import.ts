/**
 * IMPORT experiments from a registered dataset repository (T73).
 *
 * Before T73 a plan lived in the dataset repository beside its conditions.
 * Those plans are history worth keeping — runs point at them — so this verb
 * brings them over as deployment-level experiments without changing a byte:
 *
 * - the plan is read with `git show` at `<id>@<ref>` (never from a working
 *   copy, never by checking anything out) and written VERBATIM, so its
 *   `planSha` still equals what old runs recorded and the lab list pairs them;
 * - the experiment pins the plan's own `dataset.commit` when it has one, else
 *   the commit the ref resolves to;
 * - every condition the plan names (players and judges) goes into the
 *   deployment's library. An identical hash is the same condition and is
 *   left alone; the same id with different content REFUSES the whole import
 *   with the differences listed — two subjects under one name is exactly what
 *   a comparison must never silently absorb.
 *
 * Everything is checked before anything is written: a refused import writes
 * nothing at all. Importing the same plan at the same commit twice is a no-op
 * the report names.
 * @module
 */
import { access, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { createHash } from 'node:crypto'
import { hashConditionDocument } from './hash.ts'
import { diffConditionDocuments } from './read.ts'
import { PLAN_SCHEMA_ID } from './schema.ts'
import { conditionLibraryDir, createExperiment, listExperimentRecords } from './experiment-store.ts'
import type { DatasetsRegistryFace } from './faces.ts'

/** Thrown when an import cannot proceed; nothing was written. */
export class EvalImportRefused extends Error {}

/** The registry reads an import needs. */
export type ImportRegistryFace = Pick<DatasetsRegistryFace, 'resolveRegistryCommit' | 'registryListFiles' | 'registryShowFile'>

/** One plan brought over (or found already there). */
export interface ImportedExperiment {
  experimentId: string
  name: string
  /** The plan's repo-relative path at the ref. */
  path: string
  /** The commit the experiment pins. */
  commit: string
  /** The conditions it names, players then judges. */
  conditions: string[]
  /** False when an experiment with these exact plan bytes from this path already existed. */
  created: boolean
}

/** What one import did. */
export interface ImportReport {
  /** `<id>@<ref>` as given. */
  from: string
  /** The full commit the ref resolved to. */
  refCommit: string
  experiments: ImportedExperiment[]
  /** Plan-shaped files that were not imported, and why. */
  skipped: Array<{ path: string; reason: string }>
  /** Conditions written into the library by this import. */
  conditionsAdded: string[]
  /** Conditions the library already held with the identical hash. */
  conditionsSame: string[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** `<id>@<ref>` → its halves. */
export function parseImportSource(from: string): { registry: string; ref: string } {
  const at = from.indexOf('@')
  const registry = at <= 0 ? '' : from.slice(0, at).trim()
  const ref = at <= 0 ? '' : from.slice(at + 1).trim()
  if (registry === '' || ref === '') {
    throw new EvalImportRefused(`--from takes <registration id>@<ref> (e.g. dataseek-eval@main), not ${JSON.stringify(from)}`)
  }
  return { registry, ref }
}

/** The plan's conditions, players then judges, de-duplicated. */
function conditionIdsOf(plan: Record<string, unknown>): string[] {
  const players = Array.isArray(plan['conditions']) ? plan['conditions'] : []
  const judge = isPlainObject(plan['judge']) && Array.isArray(plan['judge']['conditions']) ? plan['judge']['conditions'] : []
  return [...new Set([...players, ...judge].filter((id): id is string => typeof id === 'string'))]
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** One condition to bring into the library, read at the ref. */
interface PendingCondition {
  id: string
  bytes: Buffer
  document: unknown
  lock: Buffer | undefined
  /** Which plan asked for it first, for the refusal. */
  source: string
}

/**
 * Import plans from `<id>@<ref>` as experiments.
 * @param face - the registry reads.
 * @param stateRoot - the eval state root.
 * @param input.from - `<registration id>@<ref>`.
 * @param input.plan - only the plan whose file stem or repo-relative path is this.
 * @param input.now - epoch ms for the new experiments.
 * @throws {@link EvalImportRefused} when the source cannot be read, nothing matches, or a condition conflicts.
 */
export async function importExperiments(
  face: ImportRegistryFace,
  stateRoot: string,
  input: { from: string; plan?: string; now?: number },
): Promise<ImportReport> {
  const { registry, ref } = parseImportSource(input.from)
  let refCommit: string
  try {
    refCommit = await face.resolveRegistryCommit(registry, ref)
  } catch (error) {
    throw new EvalImportRefused(`cannot resolve ${input.from}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const files = await face.registryListFiles(registry, refCommit, 'datasets')
  const planFiles = files.filter(path => /^datasets\/[^/]+\/plans\/[^/]+\.json$/.test(path) && !path.endsWith('.template.json'))
  const wanted = input.plan === undefined || input.plan.trim() === '' ? undefined : input.plan.trim()
  const selected = wanted === undefined
    ? planFiles
    : planFiles.filter(path => path === wanted || posix.basename(path, '.json') === wanted)
  if (selected.length === 0) {
    throw new EvalImportRefused(
      wanted === undefined
        ? `${input.from} holds no plan (datasets/<set>/plans/*.json)`
        : `${input.from} holds no plan named ${JSON.stringify(wanted)}; plans there:\n${planFiles.map(path => `  - ${path}`).join('\n')}`,
    )
  }

  const skipped: ImportReport['skipped'] = []
  const plans: Array<{ path: string; set: string; bytes: Buffer; plan: Record<string, unknown>; commit: string; conditions: string[] }> = []
  const pending = new Map<string, PendingCondition>()
  for (const path of selected) {
    const bytes = await face.registryShowFile(registry, refCommit, path)
    if (bytes === undefined) {
      skipped.push({ path, reason: 'not readable at this commit' })
      continue
    }
    let plan: unknown
    try {
      plan = JSON.parse(bytes.toString('utf8'))
    } catch {
      skipped.push({ path, reason: 'not valid JSON' })
      continue
    }
    if (!isPlainObject(plan) || plan['schema'] !== PLAN_SCHEMA_ID) {
      skipped.push({ path, reason: `not a ${PLAN_SCHEMA_ID} document` })
      continue
    }
    const set = path.split('/')[1] as string
    const dataset = isPlainObject(plan['dataset']) ? plan['dataset'] : {}
    const own = typeof dataset['commit'] === 'string' && dataset['commit'] !== '' ? dataset['commit'] : undefined
    let commit = refCommit
    if (own !== undefined) {
      try {
        commit = await face.resolveRegistryCommit(registry, own)
      } catch {
        throw new EvalImportRefused(`${path} pins dataset.commit ${own}, which ${registry} does not hold`)
      }
    }
    const conditions = conditionIdsOf(plan)
    for (const id of conditions) {
      if (pending.has(id)) continue
      const declaration = `datasets/${set}/conditions/${id}.json`
      const conditionBytes = await face.registryShowFile(registry, refCommit, declaration)
      if (conditionBytes === undefined) {
        throw new EvalImportRefused(`${path} names condition ${id}, but ${declaration} is not at ${input.from}; nothing was imported`)
      }
      let document: unknown
      try {
        document = JSON.parse(conditionBytes.toString('utf8'))
      } catch {
        throw new EvalImportRefused(`${declaration} at ${input.from} is not valid JSON; nothing was imported`)
      }
      const lock = await face.registryShowFile(registry, refCommit, `datasets/${set}/conditions/${id}.lock.json`)
      pending.set(id, { id, bytes: conditionBytes, document, lock, source: declaration })
    }
    plans.push({ path, set, bytes, plan, commit, conditions })
  }

  // Check every condition against the library BEFORE writing anything.
  const library = conditionLibraryDir(stateRoot)
  const conflicts: string[] = []
  const conditionsAdded: string[] = []
  const conditionsSame: string[] = []
  for (const condition of pending.values()) {
    const target = join(library, `${condition.id}.json`)
    let existing: unknown
    try {
      existing = JSON.parse(await readFile(target, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        conditionsAdded.push(condition.id)
        continue
      }
      conflicts.push(`  - ${condition.id}: the library's declaration cannot be read (${error instanceof Error ? error.message : String(error)})`)
      continue
    }
    if (hashConditionDocument(existing) === hashConditionDocument(condition.document)) {
      conditionsSame.push(condition.id)
      continue
    }
    const { differences } = diffConditionDocuments(existing, condition.document)
    conflicts.push(
      `  - ${condition.id} (${condition.source}):\n`
      + differences.map(diff => `      ${diff.path}: library ${JSON.stringify(diff.a)} ≠ imported ${JSON.stringify(diff.b)}`).join('\n'),
    )
  }
  if (conflicts.length > 0) {
    throw new EvalImportRefused(
      `condition id conflict: the library already holds a different condition under the same id, and two subjects `
      + `under one name do not compare. Nothing was imported.\n${conflicts.join('\n')}\n`
      + 'Rename one side (a new id for the imported condition in the dataset repository, or retire the library one) and import again.',
    )
  }

  await mkdir(library, { recursive: true })
  for (const id of conditionsAdded) {
    const condition = pending.get(id) as PendingCondition
    await writeFile(join(library, `${id}.json`), condition.bytes, { flag: 'wx' })
    const lockPath = join(library, `${id}.lock.json`)
    if (condition.lock !== undefined && !await exists(lockPath)) await writeFile(lockPath, condition.lock, { flag: 'wx' })
  }

  const { records } = await listExperimentRecords(stateRoot)
  const experiments: ImportedExperiment[] = []
  for (const entry of plans) {
    const name = typeof entry.plan['name'] === 'string' && entry.plan['name'] !== ''
      ? entry.plan['name']
      : posix.basename(entry.path, '.json')
    const digest = sha256(entry.bytes)
    let already: string | undefined
    for (const record of records) {
      if (record.meta.source?.path !== entry.path || record.meta.dataset.registry !== registry || record.meta.dataset.commit !== entry.commit) continue
      const bytes = await readFile(record.planPath).catch(() => undefined)
      if (bytes !== undefined && sha256(bytes) === digest) {
        already = record.id
        break
      }
    }
    if (already !== undefined) {
      experiments.push({ experimentId: already, name, path: entry.path, commit: entry.commit, conditions: entry.conditions, created: false })
      continue
    }
    const record = await createExperiment(stateRoot, {
      name,
      dataset: { registry, set: entry.set, commit: entry.commit },
      plan: entry.bytes,
      source: { from: input.from, path: entry.path },
      ...(input.now === undefined ? {} : { now: input.now }),
    })
    experiments.push({ experimentId: record.id, name, path: entry.path, commit: entry.commit, conditions: entry.conditions, created: true })
  }
  return { from: input.from, refCommit, experiments, skipped, conditionsAdded, conditionsSame }
}
