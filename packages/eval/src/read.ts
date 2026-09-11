/**
 * The READ half of the orchestrator's model surface: what conditions a
 * dataset repository declares and how ready each one is, and where a run
 * stands. Both answers are assembled from data other packages own — the
 * dataset repo's `conditions/` tree and mission's run ledger — and nothing
 * here writes anything.
 *
 * The split from the tool adapters is deliberate: this module is the body
 * (pure functions over a directory and over a structural mission face), the
 * `tools.ts` adapters only translate. That keeps the readiness vocabulary in
 * one place — `resolveConditionReadiness` is the same function `validatePlan`
 * uses, so `eval_conditions` and `dsh-eval validate` can never disagree about
 * what "ready" means.
 * @module @khorsheed/dsh-eval
 */
import { statSync, type Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import type { MissionReadFace } from './faces.ts'
import { hashConditionDocument } from './hash.ts'
import { CONDITION_ID_RE, jsonEquals } from './schema.ts'
import {
  conditionDiagnostics,
  expandHome,
  resolveConditionReadiness,
  unresolvedFields,
  type ConditionResolution,
  type EvalDiagnostic,
  type LockProvisionRecord,
} from './validate.ts'

/** Thrown when a read verb cannot answer — a missing service, an unusable path. */
export class EvalReadRefused extends Error {}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

// ── conditions ──────────────────────────────────────────────────────────────

/** One condition of the registry, as the agent's planning view needs it. */
export interface ConditionSummary {
  id: string
  /** The dataset set whose `conditions/` directory declares it. */
  dataset: string
  harness: { name: string | null; version: string | null; drive: string | null }
  /** The DECLARED model (decision 5); what a run observed lives in the run's annotations. */
  model: { declared: string | null }
  /** sha256 of the declaration; null when it is unreadable or contract-violating. */
  sha: string | null
  /**
   * The lock record beside the declaration: present, does it still match, and
   * what did provision see when it wrote it? `provisioned` is null on a lock
   * written before `conditions provision` existed — nothing checked that
   * declaration against a real scoped home, and the listing says so rather
   * than leaving the column blank.
   */
  lock: {
    present: boolean
    sha: string | null
    homeSha: string | null
    matches: boolean
    provisioned: LockProvisionRecord | null
  }
  /** ready = locked, matching, and home verified; missing = no usable declaration. */
  status: ConditionResolution['status']
  /** Nullable contract fields still unresolved, as dotted paths. */
  unresolved: string[]
  /** Contract violations (these make the condition unusable) and readiness notes. */
  errors: EvalDiagnostic[]
  warnings: EvalDiagnostic[]
}

/** The `eval_conditions` answer. */
export interface ConditionsReport {
  /** The dataset repository the listing resolved against. */
  repo: string
  /** The dataset sets scanned, in order. */
  datasets: string[]
  /** Every condition found, dataset by dataset, id-sorted within each. */
  conditions: ConditionSummary[]
}

/** Dataset sets under `<repo>/datasets/` that declare a `conditions/` directory. */
async function datasetsWithConditions(repo: string): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(join(repo, 'datasets'), { withFileTypes: true })
  } catch {
    throw new EvalReadRefused(`not a dataset repository (no datasets/ directory): ${repo}`)
  }
  const found: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      await readdir(join(repo, 'datasets', entry.name, 'conditions'))
      found.push(entry.name)
    } catch {
      // A dataset set without a conditions/ directory declares no conditions.
    }
  }
  return found.sort()
}

/** The condition ids declared under one dataset set (`<id>.lock.json` is not one). */
async function conditionIds(datasetRoot: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(join(datasetRoot, 'conditions'))
  } catch {
    return []
  }
  return entries
    .filter(name => name.endsWith('.json') && !name.endsWith('.lock.json'))
    .map(name => name.slice(0, -'.json'.length))
    .sort()
}

/**
 * List the conditions a dataset repository declares, each with its hash and
 * readiness. Reads only; provisioning a condition into a real scoped home is
 * `dsh-eval conditions provision` (I4), a human/CLI act.
 * @param repo - the dataset repository root (already `~`-expanded).
 * @param only - restrict to these dataset sets; omit to scan every set that
 *   has a `conditions/` directory.
 * @throws {@link EvalReadRefused} when `repo` is not a dataset repository.
 */
export async function listConditions(repo: string, only?: readonly string[]): Promise<ConditionsReport> {
  const datasets = only !== undefined && only.length > 0 ? [...only] : await datasetsWithConditions(repo)
  const conditions: ConditionSummary[] = []
  for (const dataset of datasets) {
    const datasetRoot = join(repo, 'datasets', dataset)
    for (const id of await conditionIds(datasetRoot)) {
      const { entry, document, errors, warnings } = await resolveConditionReadiness(id, datasetRoot)
      const harness = isPlainObject(document?.['harness']) ? document['harness'] : undefined
      const model = isPlainObject(document?.['model']) ? document['model'] : undefined
      conditions.push({
        id,
        dataset,
        harness: {
          name: stringOrNull(harness?.['name']),
          version: stringOrNull(harness?.['version']),
          drive: stringOrNull(harness?.['drive']),
        },
        model: { declared: stringOrNull(model?.['declared']) },
        sha: entry.sha,
        lock: {
          present: entry.lock !== null,
          sha: entry.lock?.sha ?? null,
          homeSha: entry.lock?.homeSha ?? null,
          matches: entry.lock !== null && entry.sha !== null && entry.lock.sha === entry.sha,
          provisioned: entry.lock?.provisioned ?? null,
        },
        status: entry.status,
        unresolved: unresolvedFields(document),
        errors,
        warnings,
      })
    }
  }
  return { repo, datasets, conditions }
}

// ── condition diff ──────────────────────────────────────────────────────────

/**
 * One field two condition documents disagree on. Values are carried VERBATIM
 * (whatever JSON the documents hold); `undefined` means the field is absent
 * from that side, which is a difference like any other — `scope` absent versus
 * `scope: "eval-b"` is exactly the two-subjects case the field exists for.
 */
export interface ConditionFieldDiff {
  /** Dotted path, e.g. `model.declared`, `unit.scopedHome.container`. */
  path: string
  a?: unknown
  b?: unknown
}

/** One side of a {@link ConditionDiff}. */
export interface ConditionDiffSide {
  /** The condition id (the file stem). */
  id: string
  /** The declaration that was read (absolute). */
  path: string
  /** The condition hash; null when the document violates the contract. */
  sha: string | null
  /** Contract violations, if any — a diff of an invalid document is still shown. */
  errors: EvalDiagnostic[]
}

/** The `conditions diff` answer: what differs, and nothing else. */
export interface ConditionDiff {
  a: ConditionDiffSide
  b: ConditionDiffSide
  /** True when the two hash alike (`notes` excluded, as everywhere). */
  identical: boolean
  /**
   * The differing fields, path-sorted. Deliberately just the facts: which
   * fields differ and what each side says. No recommendation, no "this looks
   * like a single-factor pair" — deciding whether two conditions are a usable
   * comparison is the reviewer's call, and a tool that guessed it would be
   * believed.
   */
  differences: ConditionFieldDiff[]
  /** True when `notes` differs and nothing else does — a comment edit is not a factor. */
  notesOnly: boolean
}

/**
 * Flatten a document to leaf paths. Arrays are leaves: `env.keys` differing is
 * one fact a reader wants whole, not three index-keyed ones.
 */
function leaves(value: unknown, prefix: string, sink: Map<string, unknown>): void {
  if (!isPlainObject(value)) {
    sink.set(prefix, value)
    return
  }
  for (const [key, child] of Object.entries(value)) {
    leaves(child, prefix === '' ? key : `${prefix}.${key}`, sink)
  }
}

/**
 * Field-by-field difference between two condition documents. Pure; `notes` is
 * excluded from `identical` for the same reason it is excluded from the hash
 * (a comment edit is not a new factor) but IS reported as a difference, so a
 * reader is never surprised by text that changed.
 * @param a - the first document.
 * @param b - the second.
 */
export function diffConditionDocuments(a: unknown, b: unknown): { differences: ConditionFieldDiff[]; identical: boolean; notesOnly: boolean } {
  const left = new Map<string, unknown>()
  const right = new Map<string, unknown>()
  leaves(a, '', left)
  leaves(b, '', right)
  const differences: ConditionFieldDiff[] = []
  for (const path of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const hasA = left.has(path)
    const hasB = right.has(path)
    if (hasA && hasB && jsonEquals(left.get(path), right.get(path))) continue
    differences.push({
      path,
      ...(hasA ? { a: left.get(path) } : {}),
      ...(hasB ? { b: right.get(path) } : {}),
    })
  }
  const substantive = differences.filter(difference => difference.path !== 'notes')
  return {
    differences,
    identical: substantive.length === 0,
    notesOnly: substantive.length === 0 && differences.length > 0,
  }
}

/** Whether a diff argument is a path rather than a bare condition id. */
function looksLikePath(ref: string): boolean {
  return ref.includes('/') || ref.includes(sep) || ref.startsWith('~') || ref.endsWith('.json')
}

/** Load one side of a diff: a path, or a condition id resolved against the repo. */
async function loadSide(repo: string, ref: string, datasets: readonly string[]): Promise<{ side: ConditionDiffSide; document: unknown }> {
  let path: string
  let id: string
  if (looksLikePath(ref)) {
    const expanded = expandHome(ref)
    path = isAbsolute(expanded) ? expanded : resolve(expanded)
    id = (path.split(sep).pop() ?? ref).replace(/\.json$/, '')
  } else {
    if (!CONDITION_ID_RE.test(ref)) throw new EvalReadRefused(`${JSON.stringify(ref)} is neither a usable condition id nor a path`)
    const found = datasets
      .map(dataset => ({ dataset, path: join(repo, 'datasets', dataset, 'conditions', `${ref}.json`) }))
      .filter(candidate => existsSyncSafe(candidate.path))
    if (found.length === 0) {
      throw new EvalReadRefused(
        `no condition ${JSON.stringify(ref)} in ${datasets.length === 0 ? 'this repository' : datasets.join(', ')}`
        + ' — pass a path, or name the dataset set',
      )
    }
    if (found.length > 1) {
      throw new EvalReadRefused(
        `condition ${JSON.stringify(ref)} is declared by ${found.length} dataset sets (${found.map(candidate => candidate.dataset).join(', ')})`
        + ' — name the dataset set, or pass a path',
      )
    }
    path = (found[0] as { path: string }).path
    id = ref
  }
  let document: unknown
  try {
    document = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new EvalReadRefused(`cannot read condition ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const { errors } = conditionDiagnostics(document)
  return {
    document,
    side: { id, path, sha: errors.length === 0 ? hashConditionDocument(document) : null, errors },
  }
}

function existsSyncSafe(path: string): boolean {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * Diff two condition declarations field by field.
 *
 * Shows, never chooses: the answer is which fields differ and what each side
 * says. Two conditions differing in exactly one field are a single-factor
 * pair, and that is worth seeing — but whether the pair is worth RUNNING
 * depends on things no file knows, so the verb stops at the facts.
 * @param repo - the dataset repository root (already `~`-expanded).
 * @param a - a condition id or a path to a declaration.
 * @param b - the other one.
 * @param only - dataset sets an id may resolve against; omit to scan every set
 *   that declares conditions.
 * @throws {@link EvalReadRefused} when a side cannot be resolved or read.
 */
export async function diffConditions(repo: string, a: string, b: string, only?: readonly string[]): Promise<ConditionDiff> {
  const datasets = only !== undefined && only.length > 0 ? [...only] : await datasetsWithConditions(repo)
  const left = await loadSide(repo, a, datasets)
  const right = await loadSide(repo, b, datasets)
  const { differences, identical, notesOnly } = diffConditionDocuments(left.document, right.document)
  return { a: left.side, b: right.side, identical, notesOnly, differences }
}

// ── run status ──────────────────────────────────────────────────────────────

/** One cell of a run, projected for the planning agent. */
export interface RunCellStatus {
  missionId: string
  /** From the mission's labels (the matrix coordinates the orchestrator set). */
  task: string | null
  condition: string | null
  rep: number | null
  attempt: number
  state: string
  /** mission's five-bucket projection: ready / scheduled / blocked / active / done. */
  bucket: string
  /** The most recent `orchestrator` annotation: what the loop last did to this cell. */
  lastOrchestrator: { kind: string | null; at: number; attempt: number } | null
  /** How many `submission-rejected` annotations the cell has, across all attempts. */
  submissionRejected: number
}

/** The `eval_run_status` answer: run.meta digest + one row per cell. */
export interface RunStatusReport {
  runId: string
  state: string
  templateName: string | null
  createdAt: number
  /** The evaluation-relevant slice of run.meta (the rest of meta stays in the ledger). */
  meta: {
    planSha: string | null
    planPath: string | null
    evalVersion: string | null
    datasetId: string | null
    commit: string | null
    conditions: Array<{ id: string; sha: string | null; harness: string | null; model: string | null }>
    order: { seed: number | null; sequence: string[] }
    startedAt: number | null
    budget: unknown
    expectedNs: string[] | null
    /** Readiness notes the run recorded at start (a missing lock, an unresolved field). */
    warnings: EvalDiagnostic[]
  }
  buckets: Record<string, string[]>
  /** Cells holding a resource they have not released — mission's leak warning. */
  unreleased: string[]
  cells: RunCellStatus[]
}

/** Digest `run.meta.conditions`, which carries the whole declaration since T8b. */
function metaConditions(value: unknown): RunStatusReport['meta']['conditions'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!isPlainObject(entry) || typeof entry['id'] !== 'string') return []
    const document = isPlainObject(entry['condition']) ? entry['condition'] : undefined
    const harness = isPlainObject(document?.['harness']) ? document['harness'] : undefined
    const model = isPlainObject(document?.['model']) ? document['model'] : undefined
    return [{
      id: entry['id'],
      sha: stringOrNull(entry['sha']),
      harness: stringOrNull(harness?.['name']),
      model: stringOrNull(model?.['declared']),
    }]
  })
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

/**
 * Project one run: mission's own five-bucket status, plus what the
 * orchestrator's `ns` annotations say about each cell. Both sources are read
 * through the structural mission face — eval imports nothing from mission.
 * @param mission - the mission read face (`ctx.mission`).
 * @param runId - the run to project.
 */
export function runStatus(mission: MissionReadFace, runId: string): RunStatusReport {
  const status = mission.runStatus(runId)
  const meta = status.run.meta
  const order = isPlainObject(meta['order']) ? meta['order'] : undefined
  const sequence = Array.isArray(order?.['sequence'])
    ? order['sequence'].filter((id): id is string => typeof id === 'string')
    : []
  const expectedNs = Array.isArray(meta['expectedNs'])
    ? meta['expectedNs'].filter((ns): ns is string => typeof ns === 'string')
    : null
  const warnings = Array.isArray(meta['warnings'])
    ? meta['warnings'].flatMap((warning) => (
      isPlainObject(warning) && typeof warning['message'] === 'string'
        ? [{ code: typeof warning['code'] === 'string' ? warning['code'] : 'WARNING', message: warning['message'] }]
        : []
    ))
    : []

  const cells: RunCellStatus[] = status.rows.map((row) => {
    // Annotations are append-only, so the last orchestrator entry is the
    // latest one; a mission the ledger cannot resolve degrades to no
    // annotations rather than failing the whole projection.
    let record: { annotations?: ReadonlyArray<{ ns: string; attempt: number; payload: unknown; createdAt: number }> } | undefined
    try {
      record = mission.get(row.id, runId).mission
    } catch {
      record = undefined
    }
    let last: RunCellStatus['lastOrchestrator'] = null
    let rejected = 0
    for (const annotation of record?.annotations ?? []) {
      if (annotation.ns !== 'orchestrator') continue
      const kind = isPlainObject(annotation.payload) ? stringOrNull(annotation.payload['kind']) : null
      last = { kind, at: annotation.createdAt, attempt: annotation.attempt }
      if (kind === 'submission-rejected') rejected += 1
    }
    const rep = Number(row.labels['rep'])
    return {
      missionId: row.id,
      task: row.labels['task'] ?? null,
      condition: row.labels['condition'] ?? null,
      rep: Number.isFinite(rep) ? rep : null,
      attempt: row.currentAttempt,
      state: row.state,
      bucket: row.bucket,
      lastOrchestrator: last,
      submissionRejected: rejected,
    }
  })

  return {
    runId: status.run.id,
    state: status.run.state,
    templateName: status.run.templateName ?? null,
    createdAt: status.run.createdAt,
    meta: {
      planSha: stringOrNull(meta['planSha']),
      planPath: stringOrNull(meta['planPath']),
      evalVersion: stringOrNull(meta['evalVersion']),
      datasetId: stringOrNull(meta['datasetId']),
      commit: stringOrNull(meta['commit']),
      conditions: metaConditions(meta['conditions']),
      order: { seed: numberOrNull(order?.['seed']), sequence },
      startedAt: numberOrNull(meta['startedAt']),
      budget: meta['budget'] ?? null,
      expectedNs,
      warnings,
    },
    buckets: status.buckets,
    unreleased: status.unreleased,
    cells,
  }
}
