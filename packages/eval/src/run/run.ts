/**
 * The run loop v0 — the executing half of the orchestrator, stages one and
 * two, host directories instead of containers. Reads a plan, snapshots the
 * dataset, generates and writes the run template, expands and orders the
 * matrix, creates the mission run, then drives every cell: materialize the
 * item's visible layer into a per-cell directory, delegate each stage's
 * byte-exact prompt through the local-agent facade, collect the stage
 * outputs, submit + transition along the generated state machine, judge,
 * archive, and export the bundle.
 *
 * Since I3·T20 the loop also has a CONTAINER path. A plan that declares a
 * `unit` segment runs every cell inside one lab unit: acquire → populate →
 * one delegation round per stage through `exec: {container, workdir, env}` →
 * checkpoint → probes through `lab.verify` → archive → release, in the order
 * the architecture's trajectory table has spelled out since step 11. A plan
 * WITHOUT that segment takes the host path, byte for byte what it was.
 *
 * Since I2·T9 the loop also JUDGES: once a cell reaches its terminal stage
 * state it runs the item's probes (script ns) and delegates the blind LLM
 * judging (llm-draft ns) through the judge conditions the plan names, so the
 * archive gate's non-empty `verdicts/` requirement can actually be met and
 * `--finalize` reaches `released`. What the loop still does not do:
 * `human-final` (a person's act, written from the judge bench).
 *
 * Frozen decisions implemented here: 2 (exec drive only), 5 (model declared
 * recorded, observed read back once the local-agent family lands the field —
 * null until then), 6 (prompt = visible-layer bytes + one newline + task.md
 * bytes, sha recorded), 7 (timeouts and cancels belong to the orchestrator),
 * 8 (active-minutes budget per cell, not wall clock), 11 (seeded interleaved
 * order recorded in run.meta).
 * @module @khorsheed/dsh-eval
 */
import { declaredEffort, requireEffortAdmission } from '../frozen-configuration.ts'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { evalVersion } from '../eval-version.ts'
import { canonicalJson, hashConditionDocument } from '../contract/hash.ts'
import type { CapabilityCatalogFace, DatasetsFace, LabFace, LocalAgentFace, MissionFace } from '../faces.ts'
import { conditionDiagnostics, expandHome, validatePlan, type EvalDiagnostic, type PlanValidation } from '../contract/validate.ts'
import { generateTemplateFromManifest, type GeneratedTemplate } from '../contract/template.ts'
import { loadManifest } from '../contract/manifest.ts'
import { expandMatrix, orderCells, type EvalCell } from './matrix.ts'
import { awaitObservedModel, DEFAULT_READBACK_WAIT_MS } from './readback.ts'
import { checkReadiness, DEFAULT_READINESS_TIMEOUT_MS, type ReadinessRecord, type ReadinessSubject, type ReadinessUnit } from './readiness.ts'
import { buildDeidentifyRules, pickRubricPath, DEFAULT_JUDGE_SAMPLES, type ResolvedJudge } from '../judge/judge.ts'
import { checkUnitEgress } from './egress.ts'
import type { EgressCheckDecl } from './unit.ts'
import { acquireSpecFor, checkCredentialsDir, claudeScopeDiagnostics, describeAcquireSpec, egressCheckAbsentNote, planUnitDiagnostics, planUnitOf, resolveCellUnit, unitUid, type CellUnitPlan, type CredentialsCheck } from './unit.ts'
import { buildRubricWeightTable, writeRubricWeightTable } from '../judge/weights.ts'
import { recordExportNoteOn } from '../report/export-note.ts'
import { writeEvalReport } from '../report/report.ts'
import { EvalRunRefused, sha256, type ResolvedCondition } from './cell-shared.ts'
import { acquireUnit, destroyUnit } from './unit-lifecycle.ts'
import { runCellWithRetry } from './cell-once.ts'
export { EvalRunRefused } from './cell-shared.ts'

/**
 * The orchestrating instance's capability fingerprint, for `run.meta`.
 *
 * Never throws and never refuses a run: the catalog is optional, and a
 * provenance line that could stop a run would be a factor in everything but
 * name.
 * @param catalog - the optional catalog face.
 * @param log - the run log, for the one line a failure is worth.
 * @returns the recorded shape, or undefined when there is nothing to record.
 */
async function readOrchestratorCapabilities(
  catalog: CapabilityCatalogFace | undefined,
  log: (message: string) => void,
): Promise<{ sha: string; preset?: string; skills: number; tools: number } | undefined> {
  if (catalog?.snapshotFor === undefined) return undefined
  try {
    const face = await catalog.snapshotFor()
    if (typeof face.sha !== 'string' || face.sha === '') return undefined
    return {
      sha: face.sha,
      ...(typeof face.preset === 'string' ? { preset: face.preset } : {}),
      skills: face.skills.length,
      tools: face.tools.length,
    }
  } catch (error) {
    log(`orchestrator capabilities unavailable: ${error instanceof Error ? error.message : String(error)} — run.meta records none`)
    return undefined
  }
}

/** Options of the run service verb. */
export interface RunOptions {
  /**
   * The session that starts the run — the slash session. It is the run's
   * originSession and the parent of every delegation (decision 1). Required
   * for a non-dry run: outside a session there is no live parent agent.
   */
  parentSessionId?: string
  /** Concurrent cells. Default 1 (decision 9). */
  concurrency?: number
  /** Validate, generate the template, expand and order the matrix — execute nothing. */
  dryRun?: boolean
  /** Explicit run id; default is mission's timestamped default. */
  runId?: string
  /**
   * After archiving, attempt archived → releasable → released — and, on the
   * container path, destroy the cell's unit between those two transitions.
   *
   * DEFAULT TRUE since T57. It was false while v0 had no judge and could not
   * fill the `verdicts/` the archive gate requires; since T9 every cell is
   * judged before it archives, so the gate normally says yes and the old
   * default only meant one thing in practice — every cell's container
   * survived the run, and the fourth cell of a plan met `maxConcurrentUnits`
   * and could not start (T33b). A gate refusal is still recorded, never
   * forced, so defaulting this on cannot release anything the gate would not
   * have released when asked explicitly.
   *
   * {@link RunOptions.keepUnits} is how a caller asks for the old behavior.
   */
  finalize?: boolean
  /**
   * Stop every cell at `archived` and KEEP its unit — the debugging switch
   * (`--keep-units`, and the approve dialog's 保留单元 box).
   *
   * This is the same axis as {@link RunOptions.finalize} seen from the side
   * an operator actually cares about: what they want is the container still
   * there to open, and the gate walk is the thing that takes it away. It wins
   * over `finalize` when both are given, because it is the more specific ask.
   */
  keepUnits?: boolean
  /**
   * Bundle export directory. Overrides the plan's `exports`; without either,
   * the experiment directory's `exports/` (T73) — or, for an old plan run by
   * path, `<dataset repo>/exports/` (decision 11).
   */
  exportsDir?: string
  /**
   * The experiment this run belongs to (T73), resolved by the service: its id
   * is written into `run.meta.experimentId` (what the lab list pairs on
   * first), its dataset pin decides the snapshot, and its roots are what
   * validate and the run read contract files and conditions from. Absent for
   * an old plan run by path.
   */
  experiment?: RunExperiment
  /**
   * Infrastructure-retry budget per cell. Overrides the plan's
   * `retry.infrastructure` (the reviewed default); without either, 1.
   */
  retryInfrastructure?: number
  /**
   * How long to wait, after a round settles, for T11's observation to reach
   * the delegation record (default 10s). The wait exists because the
   * observation lands AFTER the run result resolves — see
   * {@link awaitObservedModel}. 0 disables it: the read-back is then whatever
   * is already there, which is what a facade predating T11 gives anyway.
   */
  readbackWaitMs?: number
  /** Caller tag for mission writes. Default `eval-orchestrator`. */
  by?: string
  /** Injected clock (epoch ms) for deterministic tests. */
  now?: number
  /** Progress sink (the slash wrapper prints these lines). */
  log?: (message: string) => void
  /**
   * Cancellation. Aborting it stops the run: every in-flight delegation is
   * cancelled through the same lever the per-cell budget timer pulls
   * (`localAgent.cancel`), no further cell is started, and each cell the
   * cancel caught is recorded — and left — mid-stage, which is what makes
   * `finalize` call it `interrupted` instead of pretending it failed.
   *
   * There is exactly ONE cancellation entry in front of this: `job_kill` on
   * the run's job. The slash command does not take a stop verb, and the run
   * loop has no second timer of its own.
   */
  signal?: AbortSignal
  /** Root for the per-cell directories. Default `$DSH_HOME/state/eval`. */
  stateRoot?: string
  /** Per-probe wall-clock cap. Default 5 minutes (probes are deterministic, not agents). */
  probeTimeoutMs?: number
  /**
   * Run only these mission ids out of the expanded matrix. The subset is
   * recorded in `run.meta.subset` — a run that covers part of its plan must
   * say so in the ledger, or the bundle looks like a full run that lost
   * cells (pilot A shrank its matrix by stopping the session, and nothing
   * recorded why).
   */
  only?: readonly string[]
  /** Cap the run at the first N cells of the seeded order. Recorded the same way. */
  maxCells?: number
  /**
   * Start even when a condition failed the pre-run readiness check. Every
   * cell of a failed condition is then recorded `cell-skipped` with the
   * reason instead of being delegated to.
   */
  ignoreReadiness?: boolean
  /** Wall-clock cap on one readiness probe. Default 2 minutes. */
  readinessTimeoutMs?: number
}

/** An experiment as the run loop needs it. */
export interface RunExperiment {
  id: string
  /** The experiment directory (absolute). */
  dir: string
  dataset: { registry: string; set: string; commit: string }
  /** The materialized dataset view at the pinned commit, and the condition library's root. */
  roots: { datasetRoot: string; conditionsRoot: string }
  /** The registered repository's git directory — what the snapshot reads. */
  repo: string
}

/** The resolved upstream faces + host paths the run loop needs. */
export interface RunDeps {
  datasets: DatasetsFace
  mission: MissionFace
  localAgent: LocalAgentFace
  /** Required only by a plan that declares a `unit` segment; the host path never touches it. */
  lab?: LabFace
  /**
   * The orchestrating instance's own capability catalog. Optional and
   * PROVENANCE ONLY: its hash is recorded in `run.meta.orchestrator`, never
   * compared and never a factor. A composition without it records no line.
   */
  capabilityCatalog?: CapabilityCatalogFace
  stateRoot: string
}

/** One cell's outcome in the run report. */
export interface RunCellReport {
  missionId: string
  task: string
  condition: string
  rep: number
  /** Mission attempts consumed (1 = no infrastructure retry). */
  attempts: number
  /** The mission's final state (`archived` by default; the halt path ends there too). */
  finalState: string
  /** Delegation child session ids, in round order. */
  childSessionIds: string[]
  /** prompt sha256 per stage id. */
  promptShas: Record<string, string>
  /** Cumulative active delegation milliseconds (the budgeted quantity). */
  activeMs: number
  /** Set when the cell was skipped (infrastructure budget exhausted). */
  skipped?: { reason: string }
  /** Set when a stage output failed the contract (cell stopped in its current state). */
  rejected?: { stage: string; violations: string[] }
  /** Set when a halt_on condition diverted the cell to `halted`. */
  halted?: boolean
  /**
   * Set when the run was cancelled while this cell was live: the cell stays
   * in the state the cancel found it in (no retry, no forced transition), so
   * `finalize` reports it `interrupted`.
   */
  cancelled?: { reason: string }
  /** Verdicts archived for this cell, by source ns (absent before the judging phase runs). */
  verdicts?: { script: number; llmDraft: number }
}

/** The subset a run actually covered — `run.meta.subset`, verbatim. */
export interface RunSubset {
  /** The `--only` mission ids, or null when the run took the whole matrix. */
  only: string[] | null
  /** The `--max-cells` cap, or null. */
  maxCells: number | null
  /** Cells the plan's matrix expands to. */
  totalCells: number
  /** Cells this run actually created. */
  selectedCells: number
}

/** The run report (the slash/CLI answer and the run.json summary source). */
export interface RunReport {
  runId: string
  dryRun: boolean
  meta: Record<string, unknown>
  /** Cells in execution order. */
  cells: RunCellReport[]
  /** One record per condition from the pre-run readiness check (empty on a dry run). */
  readiness: ReadinessRecord[]
  /** What part of the matrix this run covered. */
  subset: RunSubset
  /** The generated template (also written next to the plan as <plan>.template.json). */
  template: GeneratedTemplate
  bundleDir?: string
  exportError?: string
}

/** sha256 hex of a buffer. */
export function defaultStateRoot(): string | undefined {
  const home = process.env['DSH_HOME']
  return home !== undefined && home !== '' ? join(home, 'state/eval') : undefined
}

/**
 * Derive the bundle's rubric weight/polarity table from the GRADING layer and
 * write it into `<bundle>/report/rubric-weights.json`.
 *
 * The bundle itself carries the visible layer only, and that is right — the
 * grading layer is the answers. But a report that cannot tell a negative
 * criterion from a positive one counts a defect as one more pass (G11), and
 * without weights the weighted score — the only relief — is permanently
 * blank (G12). So the export derives the NUMBERS: task, criterion id, weight,
 * negative, kind, axis. No criterion text, no evidence pointer, no note; the
 * executable probes and the rubric itself still stay out. That is why this
 * table needs no leak gate while the layer it came from does.
 *
 * Best-effort by construction: a task whose grading layer cannot be listed or
 * read is logged and skipped, and a run never fails because its weight table
 * could not be built.
 * @param faces - the datasets face, read with an EXPLICIT single-layer scope.
 * @param input - bundle location, snapshot coordinates, and the plan's tasks.
 * @returns the written path, or null when no rubric yielded a row.
 */
async function exportRubricWeights(
  faces: { datasets: DatasetsFace },
  input: {
    bundleDir: string
    repo: string
    datasetId: string
    commit: string
    tasks: readonly string[]
    /** The plan's `stages` — recorded on the table as the scope the report scores against (T84). */
    planStages?: readonly string[] | null
    log: (message: string) => void
  },
): Promise<string | null> {
  const scope = { repo: input.repo, layers: ['grading'] }
  const rubrics: Array<{ task: string; rubricText: string; runIn: string[] | null }> = []
  for (const task of [...new Set(input.tasks)]) {
    try {
      const graded = await faces.datasets.show(scope, input.datasetId, task, input.commit)
      const item = graded.items.find(candidate => candidate.id === task)
      const rubricPath = pickRubricPath(item?.layers['grading'] ?? [])
      if (rubricPath === null) continue
      const rubric = await faces.datasets.read(scope, {
        dataset: input.datasetId, item: task, layer: 'grading', path: rubricPath, commit: input.commit,
      })
      const meta = item?.metadata
      const runIn = typeof meta === 'object' && meta !== null && Array.isArray((meta as Record<string, unknown>)['runIn'])
        ? ((meta as Record<string, unknown>)['runIn'] as unknown[]).filter((s): s is string => typeof s === 'string')
        : null
      rubrics.push({ task, rubricText: rubric.content, runIn })
    } catch (error) {
      input.log(`rubric weights: task ${task} skipped — ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const table = buildRubricWeightTable({
    dataset: input.datasetId, commit: input.commit, rubrics, planStages: input.planStages ?? null,
  })
  const written = await writeRubricWeightTable(input.bundleDir, table)
  if (written === null) input.log('rubric weights: no rubric yielded a row — no table written')
  else input.log(`rubric weights: ${table.criteria.length} criteria over ${table.tasks.length} task(s) → ${written}`)
  return written
}

/**
 * Run the plan at `planPath`. The service verb behind `/eval run` (decision
 * 12): refuses before executing anything on data or wiring problems, then
 * drives the matrix.
 * @param planPath - path to a `dataseek.plan/1` document.
 * @param options - concurrency, dry-run, finalize, export and retry knobs.
 * @param deps - the upstream faces; omitted for a dry run (the offline
 *   kernel needs no services).
 */
export async function runPlan(planPath: string, options: RunOptions = {}, deps?: Partial<RunDeps> & { stateRoot?: string }): Promise<RunReport> {
  const now = (): number => options.now ?? Date.now()
  const by = options.by ?? 'eval-orchestrator'
  const log = options.log ?? (() => {})
  // The two knobs are one axis; they collapse here so nothing downstream has
  // to remember which of them wins. `keepUnits` is the more specific ask, so
  // it beats an explicit `finalize: true` rather than fighting it.
  const passGate = options.keepUnits === true ? false : options.finalize !== false

  // ── Offline validation first: a plan with errors never executes. ──────
  const experiment = options.experiment
  const validation: PlanValidation = await validatePlan(planPath, experiment === undefined ? {} : { roots: experiment.roots })
  if (!validation.ok) {
    throw new EvalRunRefused(
      `plan ${planPath} has ${validation.errors.length} validation error(s) — nothing was executed`,
      validation.errors,
    )
  }
  const datasetRoot = validation.datasetRoot
  const conditionsRoot = validation.conditionsRoot
  if (datasetRoot === null || conditionsRoot === null) {
    throw new EvalRunRefused(
      experiment === undefined && validation.warnings.some(warning => warning.code === 'DATASET_ROOT_UNRESOLVABLE')
        ? `cannot locate the dataset root — ${validation.warnings.find(warning => warning.code === 'DATASET_ROOT_UNRESOLVABLE')?.message ?? ''}`
        : 'cannot locate the dataset root — cannot resolve manifest, conditions, or schemas',
    )
  }
  const planAbs = resolve(planPath)
  const planDocument = JSON.parse(await readFile(planAbs, 'utf8')) as {
    dataset: { repo?: string; id?: string; registry?: string; set?: string; commit: string | null; items: string[] }
    conditions: string[]
    reps: number
    stages: string[]
    budget: { activeMinutes: number; turns: number }
    order: { seed: number; interleave: boolean }
    retry?: { infrastructure?: number }
    exports?: string
    judge?: { conditions?: string[]; samples?: number }
    expectedNs?: string[]
    unit?: unknown
  }
  // One dataset id and one commit for everything below, whichever form the
  // plan's block is in: an experiment's pin wins (an imported plan keeps its
  // legacy block verbatim, and that block must not decide what is read).
  const plan = {
    ...planDocument,
    dataset: {
      ...planDocument.dataset,
      id: experiment?.dataset.set ?? planDocument.dataset.set ?? planDocument.dataset.id ?? '',
      commit: experiment?.dataset.commit ?? planDocument.dataset.commit,
    },
  }
  const planSha = sha256(Buffer.from(canonicalJson(planDocument), 'utf8'))
  // The one switch between the two paths. A plan without it is the host path,
  // byte for byte what it was before containers existed.
  const planUnit = planUnitOf(plan)
  const budgetMs = plan.budget.activeMinutes * 60_000
  // Option overrides the plan (decision 3): the plan is the reviewed default.
  const retryLimit = Math.max(0, options.retryInfrastructure ?? plan.retry?.infrastructure ?? 1)
  const planExportsDir = plan.exports !== undefined ? expandHome(plan.exports) : undefined

  // ── Manifest + template + matrix (works for a dry run with no faces). ──
  const { manifest } = await loadManifest(join(datasetRoot, 'manifest.yml'))
  const cells = expandMatrix({ dataset: { items: plan.dataset.items }, conditions: plan.conditions, reps: plan.reps })
  const fullOrder = orderCells(cells, plan.order.seed, plan.order.interleave)

  // ── The subset (--only / --max-cells): recorded, never implicit. ──────
  // A shrunk run is a legitimate thing to want (one condition is down, the
  // budget is half of what the plan assumes). What is NOT legitimate is a
  // bundle that cannot tell a deliberate subset from a run that lost cells,
  // which is what pilot A produced by stopping the session. The plan
  // contract gains no field — a subset belongs to ONE execution, not to the
  // reviewed program — so it lives in run.meta and in the report's
  // procedure section.
  let ordered = fullOrder
  if (options.only !== undefined && options.only.length > 0) {
    const wanted = new Set(options.only)
    const unknown = [...wanted].filter(id => !fullOrder.some(cell => cell.missionId === id))
    if (unknown.length > 0) {
      throw new EvalRunRefused(
        `--only names ${unknown.length} cell(s) the plan's matrix does not contain — nothing was executed`,
        unknown.map(id => ({ code: 'ONLY_UNKNOWN_CELL', message: `${id} is not one of the ${fullOrder.length} expanded cells` })),
      )
    }
    ordered = fullOrder.filter(cell => wanted.has(cell.missionId))
  }
  if (options.maxCells !== undefined) {
    if (!Number.isInteger(options.maxCells) || options.maxCells < 1) {
      throw new EvalRunRefused(`--max-cells must be a positive integer, got ${JSON.stringify(options.maxCells)}`)
    }
    ordered = ordered.slice(0, options.maxCells)
  }
  if (ordered.length === 0) {
    throw new EvalRunRefused('the subset selects no cell — nothing was executed')
  }
  const subset: RunSubset = {
    only: options.only !== undefined && options.only.length > 0 ? [...options.only] : null,
    maxCells: options.maxCells ?? null,
    totalCells: fullOrder.length,
    selectedCells: ordered.length,
  }
  // The template carries exactly the cells this run creates: a mission the
  // run will never drive would sit `pending` in the ledger forever and read
  // as an abandoned cell rather than one that was never selected.
  const selectedIds = new Set(ordered.map(cell => cell.missionId))
  const template = generateTemplateFromManifest(manifest, {
    stages: plan.stages,
    missions: cells.filter(cell => selectedIds.has(cell.missionId))
      .map(cell => ({ id: cell.missionId, title: cell.title, labels: { ...cell.labels } })),
    ...(manifest.suiteId !== undefined ? { name: `${manifest.suiteId}-v1` } : {}),
  })

  // ── Conditions: fresh hash, lock integrity, model declaration. ────────
  const conditions: ResolvedCondition[] = []
  const conditionWarnings: EvalDiagnostic[] = []
  for (const resolution of validation.conditions) {
    const document = JSON.parse(await readFile(join(conditionsRoot, 'conditions', `${resolution.id}.json`), 'utf8')) as Record<string, unknown>
    const { errors } = conditionDiagnostics(document)
    if (errors.length > 0) {
      throw new EvalRunRefused(`condition ${resolution.id} violates the contract — nothing was executed`, errors)
    }
    const sha = hashConditionDocument(document)
    // A stale lock is an integrity failure: the declaration changed after
    // locking, so the recorded sha would misattribute the run. A MISSING
    // lock is an I1-style unresolved condition — recorded as a warning and
    // the fresh hash is used (the full readiness gate lands with provision,
    // I4).
    const lockPath = join(conditionsRoot, 'conditions', `${resolution.id}.lock.json`)
    if (existsSync(lockPath)) {
      const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { sha?: string }
      if (lock.sha !== sha) {
        throw new EvalRunRefused(`condition ${resolution.id}: lock sha does not match the current condition hash — nothing was executed`, [
          { code: 'LOCK_STALE', message: `conditions/${resolution.id}.lock.json records ${String(lock.sha).slice(0, 12)}…, the declaration hashes to ${sha.slice(0, 12)}…` },
        ])
      }
    } else {
      conditionWarnings.push({ code: 'LOCK_MISSING', message: `condition ${resolution.id} has no lock — running on the fresh hash (the full readiness gate lands with provision, I4)` })
    }
    // The capability record rides validate's resolution, which already read
    // and schema-checked the lock — re-reading it here would be a second
    // opinion on the same file.
    const lockedCapabilities = resolution.lock?.capabilities
    conditions.push({
      id: resolution.id,
      sha,
      harnessName: (document['harness'] as { name?: string } | undefined)?.name ?? '',
      declaredEffort: declaredEffort(document),
      declaredModel: (document['model'] as { declared: string | null } | undefined)?.declared ?? null,
      provider: '',
      ...(typeof document['scope'] === 'string' ? { scope: document['scope'] } : {}),
      preset: typeof document['preset'] === 'string' ? document['preset'] : null,
      ...(lockedCapabilities === undefined ? {} : { lockedCapabilities }),
      document,
    })
  }

  // ── The judge is a condition too — and, since 2026-09-10, may be a
  // contestant's twin. Decision 9 used to refuse two DIFFERENT ids naming the
  // same (harness, declared model); that rule made "evaluate every model" and
  // "judge with a model" mutually exclusive, which is the corner T22 step 5
  // died in. Every public leaderboard that judges with models has the overlap
  // by construction (MT-Bench, AlpacaEval, Arena-Hard all let contestants
  // judge, and record the self-preference); the answer there is a PANEL plus
  // disclosure, not exclusion, and a benchmark that wants neither uses
  // deterministic graders instead (SWE-bench). So the refusal is gone and its
  // job moved into the record: every sample says who judged, and a cell judged
  // by its own model is marked `selfJudged` in the verdicts, in results.jsonl,
  // and in the report's comparison section.
  //
  // What is still refused lives in validate(): the same id on both lists (a
  // bookkeeping mistake, not a panel), and a judge that pins no model (without
  // one, "self-judged" is undecidable).
  const judgeIds = plan.judge?.conditions ?? []
  const judgeDocuments = new Map<string, Record<string, unknown>>()
  const judges: ResolvedJudge[] = []
  for (const judgeId of judgeIds) {
    const judgePath = join(conditionsRoot, 'conditions', `${judgeId}.json`)
    if (!existsSync(judgePath)) {
      throw new EvalRunRefused(`judge condition ${judgeId} does not exist — nothing was executed`, [
        { code: 'JUDGE_MISSING', message: `conditions/${judgeId}.json is not in the dataset` },
      ])
    }
    const document = JSON.parse(await readFile(judgePath, 'utf8')) as Record<string, unknown>
    const { errors } = conditionDiagnostics(document)
    if (errors.length > 0) {
      throw new EvalRunRefused(`judge condition ${judgeId} violates the contract — nothing was executed`, errors)
    }
    const harness = document['harness'] as { name?: string; drive?: string } | undefined
    const harnessName = harness?.name ?? ''
    const declaredModel = (document['model'] as { declared: string | null } | undefined)?.declared ?? null
    if (declaredModel === null) {
      throw new EvalRunRefused(`judge condition ${judgeId} pins no model — nothing was executed`, [{
        code: 'JUDGE_MODEL_UNDECLARED',
        message: `${judgeId} declares model.declared: null. A judge must pin its model: decision 9 now allows a judge to share a model with a player`
          + ' and marks those cells self-judged, and that marking is undecidable when the judge runs whatever its harness happens to default to.',
      }])
    }
    // Not a refusal any more, but the run says it out loud before it starts:
    // the panel overlaps the field, and the affected cells will carry the mark.
    for (const player of conditions.filter(player => player.declaredModel !== null && player.declaredModel === declaredModel)) {
      log(`judge ${judgeId}: model ${JSON.stringify(declaredModel)} is also player condition ${player.id}`
        + " — that condition's cells will be marked selfJudged for this judge (decision 9, relaxed)")
    }
    judgeDocuments.set(judgeId, document)
    judges.push({
      id: judgeId,
      sha: hashConditionDocument(document),
      harnessName,
      declaredModel,
      declaredEffort: declaredEffort(document),
      provider: '',
      ...(typeof document['scope'] === 'string' ? { scope: document['scope'] } : {}),
    })
  }

  if (options.dryRun === true) {
    // A container run's most consequential inputs are the ones nobody sees
    // until a unit exists, so the rehearsal prints them: one acquire spec per
    // condition, env NAMES only. The mount SOURCE is the instance's own
    // scoped home for that harness, which a dry run has no facade to ask —
    // the reviewable half is the target, and the source is named by shape.
    const units = planUnit === null ? undefined : conditions.map((condition) => {
      // The mount source is named by SHAPE — a dry run has no facade to ask —
      // and a condition naming a scope says which scoped home it means.
      const shape = `<scoped home of ${condition.harnessName}${condition.scope === undefined ? '' : `@${condition.scope}`}>`
      const resolved = resolveCellUnit(planUnit, condition.id, condition.document, shape)
      return resolved.ok
        ? { condition: condition.id, acquire: describeAcquireSpec(acquireSpecFor(resolved.plan)) }
        : { condition: condition.id, errors: resolved.diagnostics }
    })
    return {
      runId: options.runId ?? '(dry-run)',
      dryRun: true,
      meta: {
        ...(experiment === undefined ? {} : { experimentId: experiment.id }),
        planSha,
        planPath: planAbs,
        conditions: conditions.map(condition => ({ id: condition.id, sha: condition.sha })),
        order: { seed: plan.order.seed, sequence: ordered.map(cell => cell.missionId) },
        concurrency: options.concurrency ?? 1,
        judge: { conditions: judges.map(judge => ({ id: judge.id, sha: judge.sha })), samples: plan.judge?.samples ?? DEFAULT_JUDGE_SAMPLES },
        subset,
        ...(units !== undefined ? { units } : {}),
        ...(conditionWarnings.length > 0 ? { warnings: conditionWarnings } : {}),
      },
      template,
      cells: [],
      readiness: [],
      subset,
    }
  }

  // ── Non-dry: resolve the upstream faces and refuse honestly on gaps. ──
  const missing: string[] = []
  if (deps?.datasets === undefined) missing.push('datasets')
  if (deps?.mission === undefined) missing.push('mission')
  if (deps?.localAgent === undefined) missing.push('localAgent')
  if (missing.length > 0) {
    throw new EvalRunRefused(`the run needs the datasets, mission, and localAgent services; missing: ${missing.join(', ')}`)
  }
  const faces = { datasets: deps!.datasets as DatasetsFace, mission: deps!.mission as MissionFace, localAgent: deps!.localAgent as LocalAgentFace }

  // ── The container path's own preconditions, all refusals. ─────────────
  // Every one of these is a fact the run cannot discover later without
  // burning cells: no lab service, no credentials root, a condition that
  // never said where its scoped home is mounted, a directory nobody staged.
  const cellUnits = new Map<string, CellUnitPlan>()
  const credentials: CredentialsCheck[] = []
  if (planUnit !== null) {
    if (deps?.lab === undefined) {
      throw new EvalRunRefused(
        `plan ${planAbs} declares a unit (image ${JSON.stringify(planUnit.image)}), so the run needs the lab service — mount the dsh-lab plugin, or drop the unit segment to run on the host`,
      )
    }
    if (typeof (deps.lab as { fingerprintOf?: unknown }).fingerprintOf !== 'function') {
      // The environment class is hashed by lab's own rule, on purpose: a
      // second implementation of the canonicalization would drift, and a
      // class that no longer equals the fingerprint of a unit acquired with
      // exactly those components is worse than no class at all. So a lab
      // predating the verb is a refusal that names it, not a fallback.
      throw new EvalRunRefused(
        'the mounted lab has no fingerprintOf verb, so the environment class «环境一致» compares cannot be derived'
        + " — upgrade dsh-lab, or drop the plan's unit segment to run on the host",
      )
    }
    if (typeof faces.localAgent.homeDir !== 'function') {
      // Without it there is no way to mount the directory the read-back
      // reads, and mounting any OTHER directory fails silently: the rounds
      // run, the rollout lands somewhere nothing parses, and every
      // `model.observed` is null while the run looks healthy.
      throw new EvalRunRefused(
        'the mounted local-agent facade has no homeDir(harness), so the container path cannot mount the scoped home the delegation read-back reads'
        + " — upgrade dsh-local-agent, or drop the plan's unit segment to run on the host",
      )
    }
    if ((options.concurrency ?? 1) > 1) {
      throw new EvalRunRefused(
        `--concurrency ${options.concurrency as number} with a unit segment: the container path is serial in this line`
        + ' (one cell acquires, works and releases before the next acquires). Parallel units are I4 — run the subset you want serially, or drop --concurrency.',
      )
    }
    const uid = unitUid(planUnit.user)
    const problems: EvalDiagnostic[] = []
    for (const condition of conditions) {
      // THE fix: the mount source is the harness's own scoped home on this
      // instance — the directory `/<harness> login` writes into and the
      // directory the read-back parses. One directory, so a containerized
      // round's rollout lands where the read-back looks.
      // …and, when the condition names a scope, THAT scope's directory: two
      // conditions of one harness then mount two different scoped homes, each
      // holding its own login, and each round's rollout lands where that
      // condition's read-back looks.
      const resolved = resolveCellUnit(
        planUnit,
        condition.id,
        condition.document,
        faces.localAgent.homeDir(condition.harnessName, condition.scope),
      )
      if (!resolved.ok) {
        problems.push(...resolved.diagnostics)
        continue
      }
      cellUnits.set(condition.id, resolved.plan)
      const check = checkCredentialsDir(resolved.plan.scopedHome.host, condition.id, uid, process.getuid?.() ?? -1)
      credentials.push(check)
      if (!check.ok) problems.push({ code: 'CREDENTIALS_UNUSABLE', message: check.reason as string })
      else if (check.ownerNote !== undefined) log(`credentials ${condition.id}: ${check.ownerNote}`)
    }
    // The half the contract subset cannot state: a well-typed declaration
    // that would check nothing. Refused rather than dropped — a run that
    // believes it was checked is the failure this whole change is about.
    problems.push(...planUnitDiagnostics(plan))
    // claude's two credential stores: a condition running inside a unit must
    // own its scope, because the unit rotates the grant in the mounted file
    // while the host rotates the same grant in the keychain and the endpoint
    // invalidates the family. The judges are the host side here — one
    // delegates from the orchestrator, so it stays on the host even in a
    // container run. Refused before any unit is acquired: the damage is a
    // manual re-login, which no later step can undo.
    problems.push(...claudeScopeDiagnostics(
      conditions.map(condition => ({
        id: condition.id,
        harnessName: condition.harnessName,
        ...(condition.scope === undefined ? {} : { scope: condition.scope }),
      })),
      judges.map(judge => ({
        id: judge.id,
        harnessName: judge.harnessName,
        ...(judge.scope === undefined ? {} : { scope: judge.scope }),
      })),
    ))
    if (problems.length > 0) {
      throw new EvalRunRefused(
        `the plan's unit segment cannot be satisfied for ${problems.length} condition(s) — nothing was executed`,
        problems,
      )
    }
    const absentNote = egressCheckAbsentNote(planUnit)
    if (absentNote !== undefined) log(absentNote)
    if (passGate) {
      log('containers: each cell walks the release gate as it finishes, so its unit is destroyed there'
        + ' — the run holds one unit at a time, whatever the matrix\'s size (--keep-units stops at archived instead)')
    } else {
      // Not a refusal: stopping at `archived` is a legitimate thing to want,
      // and it is what --keep-units asks for. But it means every cell's
      // container survives the run, so it is said out loud rather than
      // discovered by hitting the concurrency ceiling three cells later.
      log('containers: --keep-units is set, so every cell stops at archived and its unit stays'
        + ' — a matrix larger than lab\'s maxConcurrentUnits cannot finish this way;'
        + ' release them with /eval finalize <runId> (the report page\'s 回收 walks the same gate) once reviewed')
    }
  }
  const lab = deps?.lab
  const stateRoot = options.stateRoot ?? defaultStateRoot()
  if (stateRoot === undefined) {
    throw new EvalRunRefused('no state root: set DSH_HOME (cells live under $DSH_HOME/state/eval/cells) or pass options.stateRoot')
  }
  if (options.parentSessionId === undefined || options.parentSessionId === '') {
    throw new EvalRunRefused('a run needs a parent session — /eval run inside the web-eval instance (the CLI is dry-run only: outside a session there is no live parent agent)')
  }

  // Harness → provider (decision 5), exec drive only (frozen decision 2).
  for (const condition of conditions) {
    const document = condition.document as { harness: { name: string; drive: string } }
    if (document.harness.drive !== 'exec') {
      throw new EvalRunRefused(`condition ${condition.id}: harness.drive must be exec (frozen decision 2), got ${JSON.stringify(document.harness.drive)}`)
    }
    const harnessEntry = faces.localAgent.get(document.harness.name)
    const provider = harnessEntry?.delegationProvider
    if (harnessEntry === undefined || provider === undefined || provider === '') {
      throw new EvalRunRefused(`condition ${condition.id}: no local-agent harness ${JSON.stringify(document.harness.name)} with a delegation provider is registered`)
    }
    condition.provider = provider
    requireEffortAdmission(faces.localAgent, provider, condition.declaredEffort)
  }
  for (const judge of judges) {
    const document = judgeDocuments.get(judge.id) as { harness: { name: string; drive: string } }
    if (document.harness.drive !== 'exec') {
      throw new EvalRunRefused(`judge condition ${judge.id}: harness.drive must be exec (frozen decision 2), got ${JSON.stringify(document.harness.drive)}`)
    }
    const provider = faces.localAgent.get(document.harness.name)?.delegationProvider
    if (provider === undefined || provider === '') {
      throw new EvalRunRefused(`judge condition ${judge.id}: no local-agent harness ${JSON.stringify(document.harness.name)} with a delegation provider is registered`)
    }
    judge.provider = provider
    requireEffortAdmission(faces.localAgent, provider, judge.declaredEffort)
  }

  // ── Readiness: one real delegation per condition, before anything. ────
  // `/<harness> status` answers a SHAPE question ("is there a credential
  // record?"); this answers the one that decides whether the run is worth
  // starting ("does a delegation on this condition complete?"). Pilot A took
  // the status answer at face value and burned six of twenty-four cells on a
  // credential that said yes and 401'd every time (G4). The probe runs
  // through the same facade, provider and cwd rule the cells use — there is
  // no back door, so what it proves is what the cells will meet.
  //
  // On the container path the probe runs INSIDE a unit built from the same
  // spec the cells get — same image, network, user, mount and scoped-home
  // variable — because a credential that works on the host proves nothing
  // about one bind-mounted into a sealed container. The probe unit is bound
  // to no mission, so nothing gates its destroy: it is the one place in this
  // file where `force` appears, and it goes through the same destroyUnit as
  // every other release.
  //
  // The JUDGE is probed too. It is the same kind of thing — a real delegation
  // that can fail on a credential that reads authenticated — and its failure
  // is dearer than a player's: a player that cannot be delegated to loses its
  // own cells, a judge that cannot be delegated to loses the whole round's
  // llm-draft verdicts. Pilot B lost both of its judge samples while the run
  // walked on to `released` with an empty namespace, which is exactly the
  // shape of failure this check exists to make impossible.
  const readinessBase = join(stateRoot, 'readiness', `${planSha.slice(0, 12)}-${now()}`)
  const readiness = await checkReadiness({
    localAgent: faces.localAgent,
    conditions: [
      ...conditions.map((condition): ReadinessSubject => ({
        id: condition.id,
        harnessName: condition.harnessName,
        declaredModel: condition.declaredModel,
        declaredEffort: condition.declaredEffort,
        sha: condition.sha,
        provider: condition.provider,
        role: 'player',
        ...(condition.scope === undefined ? {} : { scope: condition.scope }),
        preset: condition.preset,
        ...(condition.lockedCapabilities === undefined ? {} : { capabilities: condition.lockedCapabilities }),
      })),
      ...judges.map((judge): ReadinessSubject => ({
        id: judge.id,
        harnessName: judge.harnessName,
        declaredModel: judge.declaredModel,
        declaredEffort: judge.declaredEffort ?? null,
        sha: judge.sha,
        provider: judge.provider,
        role: 'judge',
        ...(judge.scope === undefined ? {} : { scope: judge.scope }),
      })),
    ],
    parentSessionId: options.parentSessionId,
    probeDirBase: readinessBase,
    timeoutMs: options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS,
    readbackWaitMs: options.readbackWaitMs ?? DEFAULT_READBACK_WAIT_MS,
    now,
    log,
    // Freshness: the lock says what the preset hashed to at provision time;
    // this asks what it hashes to now. Only the instance's own catalog can
    // answer, so a composition without one keeps the pre-T32b gate
    // (presence and agreement, no freshness).
    ...(deps?.capabilityCatalog === undefined
      ? {}
      : {
        capabilitiesNow: async (subject: ReadinessSubject): Promise<string | undefined> => {
          const preset = subject.preset ?? undefined
          if (preset === undefined || preset === null) return undefined
          const face = await (deps.capabilityCatalog as CapabilityCatalogFace).snapshotFor(preset)
          return face.sha
        },
      }),
    ...(planUnit === null || lab === undefined ? {} : {
      unitFor: async (subject: ReadinessSubject): Promise<ReadinessUnit | undefined> => {
        // The judge delegates from the orchestrator, not from a cell, and it
        // runs on the host even in a container run — so it is probed where it
        // will actually run. Declining the unit is the honest answer, not a
        // gap.
        const cellUnit = cellUnits.get(subject.id)
        if (cellUnit === undefined) return undefined
        const unit = await acquireUnit(lab, acquireSpecFor(cellUnit), `the readiness probe for ${subject.id} could not acquire a unit`)
        return {
          exec: {
            container: unit.resource,
            workdir: unit.workspace,
            env: { [cellUnit.scopedHome.var]: cellUnit.scopedHome.container },
          },
          fingerprint: unit.fingerprint,
          // The plan's own question, asked in the probe's own unit. Absent
          // declaration, absent hook — the probe then runs exactly as it did
          // before this key existed.
          ...(planUnit.egressCheck === undefined ? {} : {
            // No condition name in `where`: both consumers of this message —
            // the readiness log line and the run's diagnostic — already
            // prefix it with the condition, and saying it three times in one
            // sentence is how a message stops being read.
            checkEgress: (): Promise<void> => checkUnitEgress(
              lab,
              unit.id,
              planUnit.egressCheck as EgressCheckDecl,
              'the probe unit',
            ),
          }),
          release: async () => {
            await destroyUnit({ lab, mission: faces.mission }, { runId: '', by, log }, unit, 'the readiness probe finished', { force: true })
          },
        }
      },
    }),
  })
  const failedReadiness = new Map(readiness.filter(record => !record.ok).map(record => [record.condition, record]))
  if (failedReadiness.size > 0 && options.ignoreReadiness !== true) {
    throw new EvalRunRefused(
      `${failedReadiness.size} of ${readiness.length} condition(s) failed the pre-run readiness check — nothing was executed`
      + ' (fix the condition, or re-run with --ignore-readiness to start anyway and record its cells as skipped)',
      [...failedReadiness.values()].map(record => ({
        // An environment that cannot reach its endpoints is not a condition
        // that failed its check: the subject was never asked. The code says
        // which, so the refusal reaches whoever can fix it.
        code: record.infrastructure ?? 'READINESS_FAILED',
        message: `${record.role === 'judge' ? 'judge ' : ''}${record.condition} (harness ${record.harness}): ${record.reason ?? 'unknown'}`,
      })),
    )
  }
  if (failedReadiness.size > 0) {
    log(`--ignore-readiness: starting with ${failedReadiness.size} failed condition(s); their cells will be recorded as skipped`)
  }

  // ── Snapshot (the pin lives in run.meta). ─────────────────────────────
  const snapshot = await faces.datasets.snapshot(
    { repo: experiment?.repo ?? expandHome(plan.dataset.repo ?? '') },
    plan.dataset.id,
    plan.dataset.commit ?? undefined,
  )

  // Samples per judge condition: the plan's number, or decision 9's floor of
  // two when the plan leaves it out. A plan may legitimately say 0 ("no LLM
  // judging this run") — that is a value, not an omission.
  const judgeSamples = plan.judge?.samples ?? DEFAULT_JUDGE_SAMPLES
  // The de-identification table is run-wide: every player's declared model is
  // a fingerprint in EVERY cell's material, not just its own.
  const deidentifyRules = buildDeidentifyRules({
    models: conditions.map(condition => condition.declaredModel),
    harnesses: conditions.map(condition => condition.harnessName),
  })

  // The orchestrating instance's own capability face — PROVENANCE, not a
  // factor. It says what the apparatus could do while the run happened; the
  // report lists it and compares nothing against it, because the
  // orchestrator answers none of the dataset's questions. A composition
  // without a catalog, or a catalog that fails to answer, records nothing
  // rather than a guess.
  const orchestratorCapabilities = await readOrchestratorCapabilities(deps?.capabilityCatalog, log)

  const startedAt = now()
  const meta: Record<string, unknown> = {
    ...(experiment === undefined ? {} : { experimentId: experiment.id, registry: experiment.dataset.registry }),
    datasetId: plan.dataset.id,
    commit: snapshot.commit,
    planSha,
    planPath: planAbs,
    evalVersion: await evalVersion(),
    snapshot: { repo: snapshot.repoPath, commit: snapshot.commit, datasetId: snapshot.datasetId },
    // The full condition document rides each entry (`condition`) so the
    // report's factor diff needs nothing beyond the bundle.
    conditions: conditions.map(condition => ({ id: condition.id, sha: condition.sha, condition: condition.document })),
    order: { seed: plan.order.seed, sequence: ordered.map(cell => cell.missionId) },
    concurrency: options.concurrency ?? 1,
    // Whether this run walked the release gate per cell. It belongs in meta
    // for the same reason `subset` does: a bundle whose cells all stopped at
    // `archived` should say that it was ASKED to, rather than read as a run
    // that broke off halfway.
    finalize: passGate,
    // The stage scope this run executes (T84): the report scores and totals
    // only the rubric leaves inside it. A bundle without it scores every leaf.
    stages: plan.stages,
    budget: { activeMinutes: plan.budget.activeMinutes, turns: plan.budget.turns },
    judge: { conditions: judges.map(judge => ({ id: judge.id, sha: judge.sha })), samples: judgeSamples },
    ...(plan.expectedNs !== undefined ? { expectedNs: plan.expectedNs } : {}),
    startedAt,
    subset,
    readiness,
    ...(orchestratorCapabilities === undefined ? {} : { orchestrator: { capabilities: orchestratorCapabilities } }),
    // What every cell of this run was built from. The host credential root is
    // deliberately absent: it is an operator fact, and run.meta travels in the
    // bundle.
    ...(planUnit !== null
      ? {
        unit: {
          image: planUnit.image,
          ...(planUnit.network !== undefined ? { network: planUnit.network } : {}),
          ...(planUnit.user !== undefined ? { user: planUnit.user } : {}),
          ...(planUnit.resources !== undefined ? { resources: planUnit.resources } : {}),
          // Per condition: where its credential directory is mounted, which
          // variable names it, and — when it runs against a named harness
          // scope — that scope's NAME. The host path stays out (an operator
          // fact; run.meta travels in the bundle), and the scope name is what
          // makes two cells of one harness legible as two directories.
          scopedHomes: [...cellUnits.values()].map(cellUnit => ({
            condition: cellUnit.conditionId,
            container: cellUnit.scopedHome.container,
            var: cellUnit.scopedHome.var,
            ...(cellUnit.scope === undefined ? {} : { scope: cellUnit.scope }),
          })),
        },
      }
      : {}),
    ...(conditionWarnings.length > 0 ? { warnings: conditionWarnings } : {}),
  }

  // The generated template lands beside the plan (architecture step 7):
  // its relative schema paths (../schemas/…) resolve from there, exactly as
  // the hand-written templates/bench-v1.json resolves them.
  const templatePath = join(dirname(planAbs), `${basename(planAbs).replace(/\.json$/, '')}.template.json`)
  mkdirSync(dirname(templatePath), { recursive: true })
  writeFileSync(templatePath, `${JSON.stringify(template, null, 2)}\n`, 'utf8')

  const created = await faces.mission.runCreate({
    templatePath,
    ...(options.runId !== undefined ? { runId: options.runId } : {}),
    meta,
    ...(options.parentSessionId !== undefined ? { originSession: options.parentSessionId } : {}),
    by,
    now: startedAt,
  })
  const runId = created.run.id
  for (const lintError of created.lint.errors) log(`lint error: ${lintError}`)
  log(`run ${runId} created (${ordered.length} cell(s), concurrency ${options.concurrency ?? 1})`)

  // Cell anchors (decision: every cell carries its identity in the
  // orchestrator ns — the bundle's mission ids are lossy, the annotation is
  // not): one write per cell BEFORE any work, so even a skipped cell is
  // attributable.
  for (const cell of ordered) {
    const condition = conditions.find(entry => entry.id === cell.labels.condition) as ResolvedCondition
    await faces.mission.annotate(cell.missionId, 'orchestrator', {
      kind: 'cell',
      task: cell.labels.task,
      condition: condition.id,
      conditionSha: condition.sha,
      rep: Number(cell.labels.rep),
    }, { runId, by })
    // The readiness verdict rides each cell too, not only run.meta: the
    // bundle carries per-mission annotations, and a reader asking why a cell
    // was skipped should find the answer on the cell.
    const record = readiness.find(entry => entry.condition === condition.id)
    if (record !== undefined) await faces.mission.annotate(cell.missionId, 'orchestrator', record, { runId, by })
  }

  // ── The pool: ordered cells, `concurrency` workers. ───────────────────
  const concurrency = planUnit !== null ? 1 : Math.max(1, Math.min(options.concurrency ?? 1, ordered.length))
  const reports = new Map<string, RunCellReport>()
  let nextCell = 0
  const worker = async (): Promise<void> => {
    while (nextCell < ordered.length) {
      // A cancelled run starts no further cell. The cells already running
      // stop through the same signal inside their stage rounds; the ones
      // never started keep their `pending` state, which is `not-started` to
      // `finalize` — a different fact from `interrupted`, and the honest one.
      if (options.signal?.aborted === true) break
      const cell = ordered[nextCell] as EvalCell
      nextCell += 1
      // A cell whose condition failed readiness is not delegated to: the run
      // only got here because of --ignore-readiness, and the cell records
      // WHY it produced nothing rather than producing a delegation failure
      // that looks like an infrastructure blip.
      const failure = failedReadiness.get(cell.labels.condition)
      if (failure !== undefined) {
        const reason = `condition ${failure.condition} failed the pre-run readiness check (${failure.reason ?? 'unknown'})`
          + ' and the run was started with --ignore-readiness'
        await faces.mission.annotate(cell.missionId, 'orchestrator', {
          kind: 'cell-skipped',
          reason,
          attempts: 1,
        }, { runId, by }).catch(() => {})
        log(`cell ${cell.missionId}: skipped — ${reason}`)
        const record = faces.mission.get(cell.missionId, runId)
        reports.set(cell.missionId, {
          missionId: cell.missionId,
          task: cell.labels.task,
          condition: cell.labels.condition,
          rep: Number(cell.labels.rep),
          attempts: record.mission.currentAttempt,
          finalState: record.mission.attempts[record.mission.currentAttempt - 1]?.state ?? 'unknown',
          childSessionIds: [],
          promptShas: {},
          activeMs: 0,
          skipped: { reason },
        })
        continue
      }
      const cellUnit = cellUnits.get(cell.labels.condition)
      reports.set(cell.missionId, await runCellWithRetry(faces, {
        runId,
        by,
        now,
        log,
        cell,
        retryLimit,
        planStages: plan.stages,
        manifest,
        datasetRoot,
        datasetId: plan.dataset.id,
        commit: snapshot.commit,
        repo: snapshot.repoPath,
        cellDirBase: join(stateRoot, 'cells', runId),
        budgetMs,
        condition: conditions.find(condition => condition.id === cell.labels.condition) as ResolvedCondition,
        parentSessionId: options.parentSessionId as string,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        finalize: passGate,
        readbackWaitMs: options.readbackWaitMs ?? DEFAULT_READBACK_WAIT_MS,
        ...(cellUnit !== undefined && lab !== undefined
          ? { unit: { lab, plan: cellUnit, ...(planUnit?.egressCheck === undefined ? {} : { egressCheck: planUnit.egressCheck }) } }
          : {}),
        judge: {
          judges,
          samples: judgeSamples,
          rules: deidentifyRules,
          // Retained after the run: a disputed verdict is re-read from the
          // prompt and material the judge actually saw (task constraint).
          judgeDirBase: join(stateRoot, 'judge', runId),
          probeDirBase: join(stateRoot, 'probes', runId),
          probeTimeoutMs: options.probeTimeoutMs ?? 300_000,
        },
      }))
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  if (options.signal?.aborted === true) {
    // The bundle is still exported below: a cancelled run's cells are
    // evidence, and the export is how a reader reaches them. `meta.cancelled`
    // is what says the matrix is short on purpose.
    meta['cancelled'] = true
    log(`run ${runId} cancelled — ${reports.size} of ${ordered.length} cell(s) reached a state; the rest stay pending`)
  }

  // ── Bundle export (decision 11): visible layer only. ─────────────────
  const outDir = options.exportsDir ?? planExportsDir
    ?? (experiment === undefined ? join(snapshot.repoPath, 'exports') : join(experiment.dir, 'exports'))
  let bundleDir: string | undefined
  let exportError: string | undefined
  try {
    const exportedAt = now()
    const exported = faces.mission.exportRun({
      runId,
      outDir,
      layers: [{ name: 'visible', guarded: false }],
      snapshotDir: datasetRoot,
      snapshot: { repo: snapshot.repoPath, commit: snapshot.commit, dataset: plan.dataset.id },
      now: exportedAt,
    })
    bundleDir = exported.bundleDir
    log(`bundle exported: ${exported.bundleDir} (${exported.files} files)`)
    await exportRubricWeights(faces, {
      bundleDir: exported.bundleDir,
      repo: snapshot.repoPath,
      datasetId: plan.dataset.id,
      commit: snapshot.commit,
      tasks: plan.dataset.items,
      planStages: plan.stages,
      log,
    })
    // The REPORT, into the bundle, by the same function `dsh-eval report`
    // calls. It used to be a command line the reader had to go and run after
    // the run had already finished, and the walkthrough duly ran it (I5·T39 ·
    // G15); the bundle a run leaves behind now carries its own summary.md.
    // Best-effort: a report that cannot be rendered does not unexport a bundle.
    let summaryPath: string | null = null
    let reportError: string | null = null
    try {
      const written = await writeEvalReport(exported.bundleDir)
      summaryPath = written.summaryPath
      log(`report written: ${written.summaryPath} (${written.rowCount} verdict row(s))`)
    } catch (error) {
      reportError = error instanceof Error ? error.message : String(error)
      log(`report not written: ${reportError} — run \`dsh-eval report ${exported.bundleDir}\` by hand`)
    }
    // WHERE it went, on the run itself. `run.meta` names the plan and the
    // repository and the bundle is under neither, so a run started with
    // `--out <dir>` left no way back to its own artifact (I5·T53). Since T89
    // the note is run-level; the first cell is only the older-mission fallback.
    {
      const recorded = await recordExportNoteOn(faces.mission, ordered[0]?.missionId, runId, {
        outDir,
        bundleDir: exported.bundleDir,
        exportedAt,
        layers: ['visible'],
        snapshotDir: datasetRoot,
        snapshot: { repo: snapshot.repoPath, commit: snapshot.commit, dataset: plan.dataset.id },
        summaryPath,
        reportError,
      }, by)
      if (!recorded.recorded) log(`export note not recorded: ${recorded.reason ?? 'unknown'}`)
    }
  } catch (error) {
    exportError = error instanceof Error ? error.message : String(error)
    log(`export failed: ${exportError}`)
  }

  return {
    runId,
    dryRun: false,
    meta,
    // A cancelled run stops mid-matrix, so the cells it never started have no
    // report — and a hole in this array would reach every reader as an
    // `undefined` cell. They are omitted instead; their missions stay
    // `pending` in the ledger, which is where "never started" belongs.
    cells: ordered
      .map(cell => reports.get(cell.missionId))
      .filter((cell): cell is RunCellReport => cell !== undefined),
    readiness,
    subset,
    template,
    ...(bundleDir !== undefined ? { bundleDir } : {}),
    ...(exportError !== undefined ? { exportError } : {}),
  }
}
