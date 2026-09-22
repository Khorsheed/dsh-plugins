import { declaredEffort, effortEvidence, frozenConfigurationOptions, requireEffortAdmission } from './frozen-configuration.ts'
import type { DelegationConfiguration } from './faces.ts'
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
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, hashConditionDocument } from './hash.ts'
import type {
  CapabilityCatalogFace,
  DelegationProgress, DelegationResult, DelegationToolCalls, DelegationUsage,
  DatasetsFace, LabAcquireSpec, LabFace, LabUnitInfo, LocalAgentFace, MissionFace,
} from './faces.ts'
import { conditionDiagnostics, expandHome, validatePlan, type EvalDiagnostic, type LockedCapabilities, type PlanValidation } from './validate.ts'
import { generateTemplateFromManifest, stageStateName, type GeneratedTemplate } from './template.ts'
import { loadManifest, type SuiteManifest } from './manifest.ts'
import { expandMatrix, orderCells, type EvalCell } from './matrix.ts'
import { awaitObservedModel, DEFAULT_READBACK_WAIT_MS } from './readback.ts'
import {
  checkReadiness, DEFAULT_READINESS_TIMEOUT_MS,
  type ReadinessRecord, type ReadinessSubject, type ReadinessUnit,
} from './readiness.ts'
import {
  buildDeidentifyRules, deidentify, llmDraftCriteria, mergeReplacements,
  pickRubricPath, runJudgeSamples, runProbes,
  DEFAULT_JUDGE_SAMPLES, JUDGE_MATERIAL_FILES,
  type DeidentifyRule, type ReplacementCount, type ResolvedJudge, type RubricCriterion,
} from './judge.ts'
import { hostProbeExecutor, unitProbeExecutor, type ProbeExecutor } from './probe-exec.ts'
import { checkUnitEgress } from './egress.ts'
import type { EgressCheckDecl } from './unit.ts'
import {
  acquireSpecFor, checkCredentialsDir, claudeScopeDiagnostics, conditionOwnedComponents, describeAcquireSpec, egressCheckAbsentNote, planUnitDiagnostics,
  environmentClassComponents, planUnitOf, resolveCellUnit, unitUid,
  type CellUnitPlan, type CredentialsCheck,
} from './unit.ts'
import { buildRubricWeightTable, writeRubricWeightTable } from './weights.ts'
import { recordExportNoteOn } from './export-note.ts'
import { writeEvalReport } from './report.ts'

/** Thrown when a run is REFUSED before anything executes (data problems, missing services). */
export class EvalRunRefused extends Error {
  readonly diagnostics: EvalDiagnostic[]
  constructor(message: string, diagnostics: EvalDiagnostic[] = []) {
    super(message)
    this.name = 'EvalRunRefused'
    this.diagnostics = diagnostics
  }
}

/** An infrastructure-class cell failure: spawn failure, facade error, timeout (decision 8). */
class InfrastructureFailure extends Error {}

/** A cell's output failed the contract (schema violation, missing files): no retry (decision 7). */
class SubmissionRejected extends Error {
  readonly violations: string[]
  readonly stage: string
  constructor(stage: string, violations: string[]) {
    super(violations.join('; '))
    this.name = 'SubmissionRejected'
    this.stage = stage
    this.violations = violations
  }
}

/** Declared model ≠ observed model (frozen decision 5): the run is misattributed — fail loud. */
class MisattributedRun extends Error {}

/**
 * The run was cancelled from outside (the job's `cancel`, which is the ONLY
 * cancellation entry — see {@link RunOptions.signal}). Distinct from an
 * infrastructure failure on purpose: a cancelled cell is NOT retried, and it
 * is left exactly where the cancel found it, so `finalize` classifies it
 * `interrupted` — the category T23 added for precisely this shape.
 */
class RunCancelled extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RunCancelled'
  }
}

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
   * `<dataset repo>/exports/` (decision 11).
   */
  exportsDir?: string
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
function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

let evalVersionCache: string | undefined

/** `dsh-eval` version: package version + repo HEAD short sha (version only when git is unavailable). */
export async function evalVersion(): Promise<string> {
  if (evalVersionCache !== undefined) return evalVersionCache
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string }
  const version = typeof packageJson.version === 'string' ? packageJson.version : '0.0.0'
  const shortSha = await new Promise<string>((resolvePromise) => {
    execFile('git', ['rev-parse', '--short', 'HEAD'], { cwd: fileURLToPath(new URL('../..', import.meta.url)) }, (error, stdout) => {
      resolvePromise(error === null ? stdout.trim() : '')
    })
  })
  evalVersionCache = shortSha !== '' ? `${version}+${shortSha}` : version
  return evalVersionCache
}

/** Default cell-directory root: `$DSH_HOME/state/eval` (decision 3). */
export function defaultStateRoot(): string | undefined {
  const home = process.env['DSH_HOME']
  return home !== undefined && home !== '' ? join(home, 'state/eval') : undefined
}

interface ResolvedCondition {
  declaredEffort: string | null
  id: string
  sha: string
  harnessName: string
  declaredModel: string | null
  provider: string
  /**
   * The condition's named harness scope, when it declares one: every round of
   * every cell of this condition runs against `<homesRoot>/<harness>@<scope>`
   * instead of the harness's default scoped home. Absent means the default
   * one — what every condition written before the field asks for.
   */
  scope?: string
  /**
   * The condition's declared preset — the agent composition its environment
   * runs under — or null for none. Only a harness whose composition this
   * family provisions may name one (validate refuses the rest), so in
   * practice this is the sub-dsh's sub-profile roster.
   */
  preset: string | null
  /**
   * The capability fingerprint the condition's lock records, when provision
   * has measured one. It is the only evidence the declared `preset` was
   * actually built; a condition that declares a preset without it is a
   * subject whose capability face nobody checked.
   */
  lockedCapabilities?: LockedCapabilities
  /** The full condition document (recorded into run.meta for the report's factor diff). */
  document: Record<string, unknown>
}

/** The judging inputs one cell needs; shared by every cell of a run. */
interface JudgeEnv {
  /** Resolved judge conditions (empty = no LLM judging this run). */
  judges: ResolvedJudge[]
  /** Samples per judge condition (decision 9: at least two). */
  samples: number
  /** The run-wide de-identification table (harness names + every declared model). */
  rules: DeidentifyRule[]
  /** `<stateRoot>/judge/<runId>` — RETAINED after the run, for review. */
  judgeDirBase: string
  /** `<stateRoot>/probes/<runId>` — removed per cell once its probes have run. */
  probeDirBase: string
  probeTimeoutMs: number
}

/** Per-cell mutable state carried across infrastructure retries. */
interface CellState {
  childSessionIds: string[]
  promptShas: Record<string, string>
  spentMs: number
}


/** What one cell needs to run inside a unit: the face, and the resolved spec. */
interface CellUnitBinding {
  lab: LabFace
  plan: CellUnitPlan
  /** The plan's egress self-check, when it declares one. */
  egressCheck?: EgressCheckDecl
}

/**
 * The host mirror marker. `lab.collect` registers what it copied as a mission
 * artifact, and the attempt's run-data directory is what the bundle carries —
 * so pointing the registration at the workspace itself would put a second
 * copy of every cell's workspace in every bundle, beside the archive that
 * already holds one. The marker is the artifact instead: one small file
 * saying where the host mirror of this unit's workspace lives, registered
 * once and re-registered (as a no-op) by every later collect.
 */
const WORKSPACE_MIRROR = 'workspace-mirror.json'

/** Where the raw per-probe verdict files are collected back to, under the attempt's run data. */
const PROBE_VERDICTS = 'probe-verdicts'

/** lab's own hash of what it copied into the unit — the proof, not the comparability number. */
const POPULATE_MANIFEST = 'populate-manifest.json'

/**
 * Lab's held units, written out as the sentence a blocked acquire needs:
 * WHICH runs are holding the ceiling and which unit each one holds.
 *
 * lab's own refusal is correct and says nothing actionable — "release a unit
 * first" leaves the reader to `docker ps`, guess which container belongs to
 * which run, and find out the hard way that a stranger's run owns three of
 * them. The list is the orchestrator's to add, not lab's: lab does not know
 * what a run is, and giving it the vocabulary to say so would be the wrong
 * half of the boundary to move.
 *
 * Never throws: this runs on a path that is ALREADY failing, and a second
 * failure here would replace a useful refusal with a useless one.
 * @param lab - the lab face to ask.
 * @returns one line naming the holders, or why they could not be named.
 */
async function describeUnitHolders(lab: LabFace): Promise<string> {
  let rows: Awaited<ReturnType<LabFace['status']>>
  try {
    rows = await lab.status()
  } catch (error) {
    return `the units holding it could not be listed: ${error instanceof Error ? error.message : String(error)}`
  }
  if (rows.length === 0) {
    return 'lab reports no held unit, so whatever holds the ceiling was not acquired through this face'
  }
  const byRun = new Map<string, string[]>()
  for (const row of rows) {
    const key = row.runId ?? ''
    const cell = row.missionId === undefined ? '' : `, cell ${row.missionId}`
    const entry = `${row.id} (${row.resource}${cell})`
    const held = byRun.get(key)
    if (held === undefined) byRun.set(key, [entry])
    else held.push(entry)
  }
  const groups = [...byRun].map(([runId, held]) =>
    `${runId === '' ? 'no run recorded' : `run ${runId}`}: ${held.join(', ')}`)
  return `the ${rows.length} unit(s) holding it — ${groups.join('; ')}.`
    + ' Release a run\'s units with `/eval finalize <runId>` (the report page\'s 回收 button walks the same gate);'
    + ' a unit no mission gates needs `dsh-lab release <unit> --force`, which is a human\'s call.'
}

/**
 * `lab.acquire`, with the one refusal a container run actually meets made
 * actionable. Everything else is re-thrown untouched — a missing image and a
 * dead daemon are not improved by a list of containers.
 * @param lab - the lab face.
 * @param spec - the acquire spec, unchanged.
 * @param where - what was being acquired, for the refusal's first clause.
 * @returns the acquired unit.
 */
async function acquireUnit(lab: LabFace, spec: LabAcquireSpec, where: string): Promise<LabUnitInfo> {
  try {
    return await lab.acquire(spec)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    // Matching on lab's own wording is a seam, and a shallow one on purpose:
    // if lab ever rewords the refusal the enrichment stops happening and the
    // raw message still reaches the reader. The alternative — a typed error
    // across the package boundary — is a contract change to a package this
    // task does not touch.
    if (!/maxconcurrentunits/i.test(reason)) throw error
    throw new Error(`${where}: ${reason}\n  ${await describeUnitHolders(lab)}`)
  }
}

/**
 * THE destroy path. Every unit this orchestrator acquires dies here and
 * nowhere else — frozen decision 12 says the destroy path is unique, and a
 * second `release` call site is how that stops being true.
 *
 * `force` appears in exactly one caller: the readiness probe unit, which is
 * bound to no mission and therefore has no gate to pass; lab requires the
 * flag precisely so that a gate-less destroy is a deliberate sentence rather
 * than a default. A cell's unit never carries it — its gate is
 * `mission.isReleasable`, and a refusal LEAVES THE CONTAINER, which is the
 * behavior a human wants when a cell needs looking at.
 * @returns whether the unit was actually destroyed.
 */
async function destroyUnit(
  faces: { lab: LabFace; mission: MissionFace },
  env: { runId: string; by: string; log: (message: string) => void; missionId?: string },
  unit: { id: string; resource: string },
  why: string,
  options: { force?: boolean } = {},
): Promise<boolean> {
  try {
    await faces.lab.release(unit.id, options.force === true ? { force: true } : undefined)
    return true
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    env.log(`unit ${unit.resource} was NOT released (${why}): ${reason}`)
    if (env.missionId !== undefined) {
      await faces.mission.annotate(env.missionId, 'orchestrator', {
        kind: 'unit-retained',
        unit: unit.id,
        resource: unit.resource,
        why,
        reason,
      }, { runId: env.runId, by: env.by }).catch(() => {})
    }
    return false
  }
}

/**
 * The failure path of lab's own recovery loop (lab README «失败恢复循环»),
 * driven from here because the orchestrator is the only thing that knows a
 * cell failed: collect whatever exists (a partial workspace is the normal
 * case), archive the scene — a crashed cell's half-finished workspace, its
 * crash output and its checkpoints are the most valuable data of the round,
 * and releasing without archiving destroys the evidence — and then take the
 * SAME gate the success path takes.
 *
 * There is no force here on purpose. A cell that never reached a releasable
 * state keeps its container, and that is exactly the container a human wants
 * to open. The cost is that a failed cell holds a unit until someone looks at
 * it; the alternative is a destroy path that can be reached by failing, which
 * is the one thing frozen decision 12 is about.
 */
async function salvageUnit(
  faces: { lab: LabFace; mission: MissionFace },
  env: { runId: string; by: string; log: (message: string) => void; missionId: string },
  unit: LabUnitInfo,
  paths: { cellDir: string; archiveDir: string },
): Promise<void> {
  try {
    await faces.lab.collect(unit.id, {
      source: unit.workspace,
      target: paths.cellDir,
      kind: 'workspace-mirror',
      artifactPath: WORKSPACE_MIRROR,
    })
  } catch (error) {
    env.log(`unit ${unit.resource}: collect after failure did not complete — ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    mkdirSync(join(paths.archiveDir, 'verdicts'), { recursive: true })
    await faces.lab.archive(unit.id, { target: paths.archiveDir, kind: 'archive', artifactPath: 'archive' })
  } catch (error) {
    env.log(`unit ${unit.resource}: archive after failure did not complete — ${error instanceof Error ? error.message : String(error)}`)
  }
  await destroyUnit(faces, env, unit, 'the cell failed')
}

/**
 * The judging phase of one cell (architecture steps 16 and 19), run once the
 * stage loop has parked the cell in its terminal stage state and BEFORE the
 * archive copy — the verdicts are part of what gets archived, and the archive
 * gate refuses an empty `verdicts/`.
 *
 * Two sources, both mechanical, both honest about absence: an item with no
 * probes writes no `script.json`, and a run with no judge conditions (or a
 * rubric with no `llm-draft` rows) writes no `llm-draft-*.json`. Nothing here
 * throws: a judging failure must not undo a cell that actually ran — it is
 * recorded in the orchestrator ns and the cell archives with fewer verdicts.
 * @returns how many verdicts each source contributed.
 */
async function judgeCell(
  faces: { datasets: DatasetsFace; mission: MissionFace; localAgent: LocalAgentFace },
  env: {
    runId: string
    by: string
    now: () => number
    log: (message: string) => void
    missionId: string
    taskId: string
    datasetId: string
    commit: string
    repo: string
    cellDir: string
    archiveDir: string
    attemptDataDir: string
    attempt: number
    parentSessionId: string
    /** The cell's own condition — the judging side needs it to mark a self-judged sample. */
    condition: { id: string; declaredModel: string | null }
    judge: JudgeEnv
    /** Set on the container path: the probes run inside this cell's unit. */
    unit?: { lab: LabFace; unitId: string }
  },
): Promise<{ script: number; llmDraft: number }> {
  const verdictsDir = join(env.archiveDir, 'verdicts')
  const counts = { script: 0, llmDraft: 0 }

  // The grading layer is read with an EXPLICIT single-layer scope and never
  // reaches the cell: this listing is how both sources find the rubric.
  let rubricPath: string | null = null
  try {
    const graded = await faces.datasets.show({ repo: env.repo, layers: ['grading'] }, env.datasetId, env.taskId, env.commit)
    rubricPath = pickRubricPath(graded.items.find(item => item.id === env.taskId)?.layers['grading'] ?? [])
  } catch (error) {
    await faces.mission.annotate(env.missionId, 'orchestrator', {
      kind: 'judge-skipped',
      reason: `the grading layer could not be listed: ${error instanceof Error ? error.message : String(error)}`,
    }, { runId: env.runId, by: env.by }).catch(() => {})
  }

  // ── script ns: the item's probes (protocol §6.7). ─────────────────────
  // Same contract either side of the seam: the executor decides only WHERE
  // the process runs. On the container path it runs in the cell's own unit,
  // against `/workspace`, writing its verdicts outside the workspace so the
  // archive stays the player's work.
  const probeDir = join(env.judge.probeDirBase, env.missionId, `attempt-${env.attempt}`)
  const executor: ProbeExecutor = env.unit === undefined
    ? hostProbeExecutor({ probeDir, cellDir: env.cellDir })
    : unitProbeExecutor({
      lab: env.unit.lab,
      unitId: env.unit.unitId,
      probeDir,
      collectDir: join(env.attemptDataDir, PROBE_VERDICTS),
      artifactPath: PROBE_VERDICTS,
    })
  try {
    const probed = await runProbes({
      datasets: faces.datasets,
      repo: env.repo,
      datasetId: env.datasetId,
      taskId: env.taskId,
      commit: env.commit,
      cellDir: env.cellDir,
      probeDir,
      rubricPath,
      timeoutMs: env.judge.probeTimeoutMs,
      executor,
    })
    if (probed.outcomes.length > 0) {
      await faces.mission.annotate(env.missionId, 'orchestrator', {
        kind: 'probes',
        where: probed.where,
        probes: probed.outcomes.map(outcome => ({
          probe: outcome.probe,
          origin: outcome.origin,
          exitCode: outcome.exitCode,
          outcome: outcome.outcome,
          ok: outcome.ok,
          verdicts: outcome.verdicts.length,
          durationMs: outcome.durationMs,
          ...(outcome.error !== undefined ? { error: outcome.error } : {}),
          ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
          ...(outcome.overwritten !== undefined ? { overwritten: outcome.overwritten } : {}),
          ...(outcome.dropped !== undefined ? { dropped: outcome.dropped } : {}),
        })),
      }, { runId: env.runId, by: env.by }).catch(() => {})
    }
    if (probed.verdicts.length > 0) {
      writeFileSync(join(verdictsDir, 'script.json'), `${JSON.stringify(probed.verdicts, null, 2)}\n`, 'utf8')
      await faces.mission.annotate(env.missionId, 'script', probed.verdicts, { runId: env.runId, by: env.by })
      counts.script = probed.verdicts.length
    }
    if (probed.outcomes.length > 0) {
      // The three states are counted separately on purpose: a cell that reads
      // "2 not applicable this round" knows two criteria went unanswered for
      // want of input, where the old "2/4 probe(s)" read as two broken probes.
      // The line is printed even with no verdicts at all — an all-skipped cell
      // is exactly the case the old counting made invisible.
      const skipped = probed.outcomes.filter(outcome => outcome.outcome === 'probe-skipped').length
      const failed = probed.outcomes.filter(outcome => outcome.outcome === 'probe-failed').length
      env.log(`cell ${env.missionId}: ${probed.verdicts.length} script verdict(s) from ${probed.outcomes.filter(o => o.ok).length}/${probed.outcomes.length} probe(s)`
        + `${failed > 0 ? `, ${failed} failed` : ''}${skipped > 0 ? `, ${skipped} not applicable this round` : ''}`)
    }
  } catch (error) {
    await faces.mission.annotate(env.missionId, 'orchestrator', {
      kind: 'probes-failed',
      error: error instanceof Error ? error.message : String(error),
    }, { runId: env.runId, by: env.by }).catch(() => {})
    env.log(`cell ${env.missionId}: probes failed — ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    // The verify layer is the answer key: it does not outlive its use, on the
    // host OR inside the unit (architecture §4).
    await executor.discard()
  }

  // ── llm-draft ns: the blind judging (decision 9). ─────────────────────
  if (env.judge.judges.length === 0 || env.judge.samples < 1) return counts
  if (rubricPath === null) {
    await faces.mission.annotate(env.missionId, 'orchestrator', {
      kind: 'judge-skipped',
      reason: `item ${env.taskId} ships no rubric in its grading layer — nothing to judge against`,
    }, { runId: env.runId, by: env.by }).catch(() => {})
    return counts
  }
  let criteria: RubricCriterion[]
  try {
    const rubric = await faces.datasets.read({ repo: env.repo, layers: ['grading'] }, {
      dataset: env.datasetId, item: env.taskId, layer: 'grading', path: rubricPath, commit: env.commit,
    })
    criteria = llmDraftCriteria(rubric.content)
  } catch (error) {
    await faces.mission.annotate(env.missionId, 'orchestrator', {
      kind: 'judge-skipped',
      reason: `the rubric ${rubricPath} could not be read or parsed: ${error instanceof Error ? error.message : String(error)}`,
    }, { runId: env.runId, by: env.by }).catch(() => {})
    return counts
  }
  if (criteria.length === 0) {
    await faces.mission.annotate(env.missionId, 'orchestrator', {
      kind: 'judge-skipped',
      reason: `rubric ${rubricPath} declares no kind: llm-draft criteria — the LLM judge has nothing to answer`,
    }, { runId: env.runId, by: env.by }).catch(() => {})
    return counts
  }

  // De-fingerprint the material. The ORIGINALS stay untouched in the cell;
  // the judge only ever sees these copies (decision 9).
  const materials: Array<{ path: string; text: string }> = []
  const tables: ReplacementCount[][] = []
  for (const rel of JUDGE_MATERIAL_FILES) {
    const source = join(env.cellDir, rel)
    if (!existsSync(source)) continue
    const cleaned = deidentify(readFileSync(source, 'utf8'), env.judge.rules)
    materials.push({ path: rel, text: cleaned.text })
    tables.push(cleaned.replacements)
  }
  if (materials.length === 0) {
    await faces.mission.annotate(env.missionId, 'orchestrator', {
      kind: 'judge-skipped',
      reason: 'the cell produced none of the judged material files',
    }, { runId: env.runId, by: env.by }).catch(() => {})
    return counts
  }
  const table = mergeReplacements(tables)
  await faces.mission.annotate(env.missionId, 'orchestrator', {
    kind: 'deidentify',
    files: materials.map(material => material.path),
    table,
    total: table.reduce((sum, row) => sum + row.count, 0),
  }, { runId: env.runId, by: env.by }).catch(() => {})

  const judged = await runJudgeSamples({
    localAgent: faces.localAgent,
    mission: faces.mission,
    missionId: env.missionId,
    runId: env.runId,
    by: env.by,
    now: env.now,
    taskId: env.taskId,
    parentSessionId: env.parentSessionId,
    cell: { condition: env.condition.id, declaredModel: env.condition.declaredModel },
    judges: env.judge.judges,
    samples: env.judge.samples,
    criteria,
    materials,
    judgeDirBase: join(env.judge.judgeDirBase, env.missionId, `attempt-${env.attempt}`),
    log: env.log,
  })
  for (const record of judged.records) {
    // One annotation per SAMPLE, carrying the sample's provenance around its
    // verdicts — the report unwraps the envelope and counts the samples.
    await faces.mission.annotate(env.missionId, 'llm-draft', {
      sample: record.sample,
      judgeCondition: record.judgeCondition,
      judgeSha: record.judgeSha,
      // Who judged, in the two words a reader needs: the condition id and the
      // model. Decision 9 stopped forbidding the overlap, so the report has to
      // be able to SAY which cells a model judged — including its own.
      judgeModel: record.judgeModel,
      selfJudged: record.selfJudged,
      promptSha: record.promptSha,
      verdicts: record.verdicts,
    }, { runId: env.runId, by: env.by })
    writeFileSync(
      join(verdictsDir, `llm-draft-${record.judgeCondition}-${record.sample}.json`),
      `${JSON.stringify(record.verdicts, null, 2)}\n`,
      'utf8',
    )
    counts.llmDraft += record.verdicts.length
  }
  env.log(`cell ${env.missionId}: ${judged.records.length}/${env.judge.judges.length * env.judge.samples} judge sample(s) landed${judged.failures.length > 0 ? `, ${judged.failures.length} dropped` : ''}`)
  return counts
}

/** One attempt's execution of one cell (materialize → delegate → submit → judge → archive). */
async function runCellOnce(
  faces: { datasets: DatasetsFace; mission: MissionFace; localAgent: LocalAgentFace },
  env: {
    runId: string
    by: string
    now: () => number
    log: (message: string) => void
    cell: EvalCell
    attempt: number
    planStages: string[]
    manifest: SuiteManifest
    datasetRoot: string
    datasetId: string
    commit: string
    repo: string
    cellDirBase: string
    budgetMs: number
    condition: ResolvedCondition
    parentSessionId: string
    finalize: boolean
    readbackWaitMs: number
    judge: JudgeEnv
    /** Set when the plan declares a `unit` segment: this cell runs in a container. */
    unit?: CellUnitBinding
    /** The run's cancellation signal (see {@link RunOptions.signal}). */
    signal?: AbortSignal
    /**
     * Where the acquired unit is published for the retry wrapper. A unit is
     * held by the ATTEMPT, and an attempt that throws must still be able to
     * archive and release it — so the handle has to outlive this frame.
     */
    held?: { unit?: LabUnitInfo }
  },
  state: CellState,
): Promise<RunCellReport> {
  const { datasets, mission, localAgent } = faces
  const missionId = env.cell.missionId

  // Per-cell working directory (decision 3).
  const cellDir = join(env.cellDirBase, missionId, `attempt-${env.attempt}`)
  mkdirSync(cellDir, { recursive: true })

  await mission.transition(missionId, 'ws-ready', { runId: env.runId, by: env.by, note: `attempt ${env.attempt}` })

  // Materialize: the item's visible layer into the cell directory, with a
  // sorted per-file sha256 manifest (the comparability invariant's input).
  const worktree = await datasets.worktreePath({ repo: env.repo }, env.datasetId, { commit: env.commit, layers: ['visible'] })
  const shown = await datasets.show({ repo: env.repo }, env.datasetId, env.cell.labels.task, env.commit)
  const item = shown.items.find(candidate => candidate.id === env.cell.labels.task)
  const visibleFiles = item?.layers['visible'] ?? []
  const materialized: Array<{ path: string; sha256: string }> = []
  for (const rel of visibleFiles) {
    const file = await datasets.read({ repo: env.repo }, { dataset: env.datasetId, item: env.cell.labels.task, layer: 'visible', path: rel, commit: env.commit })
    const bytes = Buffer.from(file.content, 'utf8')
    mkdirSync(dirname(join(cellDir, rel)), { recursive: true })
    writeFileSync(join(cellDir, rel), bytes)
    materialized.push({ path: rel, sha256: sha256(bytes) })
  }
  materialized.sort((a, b) => (a.path < b.path ? -1 : 1))
  const attemptDataDir = join(faces.mission.dataDir, 'runs', env.runId, 'data', missionId, `attempt-${env.attempt}`)
  mkdirSync(attemptDataDir, { recursive: true })

  // The comparability invariant's input, computed the SAME way on both paths.
  // It has to be: «题面一致» asks whether the cells of one item received the
  // same bytes, and two paths hashing the same bytes by two different rules
  // can only answer that within a path. The number is over the materialized
  // file set, not over the directory, so it does not depend on what else the
  // working directory happens to hold.
  const overall = createHash('sha256')
  for (const file of materialized) {
    overall.update(file.path)
    overall.update('\0')
    overall.update(file.sha256)
    overall.update('\0')
  }
  const materializationText = `${JSON.stringify({
    dataset: env.datasetId,
    task: env.cell.labels.task,
    commit: env.commit,
    layers: ['visible'],
    source: { worktree: worktree.path, reused: worktree.reused },
    files: materialized,
    sha256: overall.digest('hex'),
  }, null, 2)}\n`
  writeFileSync(join(attemptDataDir, 'materialization.json'), materializationText, 'utf8')
  await mission.addArtifact(missionId, { path: 'materialization.json', kind: 'materialization' }, { runId: env.runId, by: env.by })

  let unit: LabUnitInfo | undefined
  if (env.unit === undefined) {
    // The host path also puts the record in the cell directory — that is what
    // the child sees, and it has been there since the loop's first version.
    // The container path deliberately does not: the workspace holds the item's
    // bytes and nothing of the orchestrator's (a host path inside the unit).
    writeFileSync(join(cellDir, 'materialization.json'), materializationText, 'utf8')
  } else {
    // ── Container path, architecture steps 11 and 12. ──────────────────
    // acquire first, then populate: mounts cannot be added to a container
    // that already exists, so everything the unit will ever have is declared
    // once, and the fingerprint that describes it exists before any work does.
    unit = await acquireUnit(
      env.unit.lab,
      acquireSpecFor(env.unit.plan, { missionId, runId: env.runId }),
      `cell ${missionId} could not acquire a unit`,
    )
    if (env.held !== undefined) env.held.unit = unit
    // Between acquire and populate, for the same reason the readiness probe
    // asks before delegating: a unit that cannot reach its endpoints wastes
    // the whole cell and then reports nothing about why. The readiness gate
    // already asked this of a unit of the same class; asking again per cell
    // catches a sidecar that died mid-run, which is exactly how T29c's
    // containers ended up unreachable in the first place.
    if (env.unit.egressCheck !== undefined) {
      await checkUnitEgress(env.unit.lab, unit.id, env.unit.egressCheck, `cell ${missionId}`)
    }
    // The «环境一致» invariant's input, written by the ORCHESTRATOR the moment
    // the unit exists. lab registers the same two refs itself, but that write
    // is best-effort by design (it warns and skips), and an invariant may not
    // rest on a write that is allowed to skip — pilot A's fingerprint column
    // was blank for exactly one run, and the invariant read `unverifiable`
    // for the whole iteration.
    // What «环境一致» compares is the environment the PLAN declared, so the
    // ref carries the environment CLASS: the unit's components minus the ones
    // this condition contributed (its own credential mount, its own env
    // variable). Four harnesses in one run mount four different credential
    // directories under four different variables — comparing unit
    // fingerprints would read `violated` on a run whose environment is, in
    // every sense the comparison cares about, identical.
    const owned = conditionOwnedComponents(env.unit.plan, env.condition.document)
    const klass = unit.fingerprintComponents === undefined
      ? undefined
      : environmentClassComponents(unit.fingerprintComponents, owned)
    const envClass = klass === undefined ? undefined : env.unit.lab.fingerprintOf(klass.components)
    // The unit's OWN fingerprint stays recorded — on the cell's annotation and
    // in lab's archive manifest — because "which environment class" and "which
    // unit" are different questions and a bundle should answer both. It does
    // not go into refs: mission's refs carry `resource`, `fingerprint` and
    // `sessions`, and adding a fourth key is a mission change this task does
    // not own.
    await mission.setRefs(missionId, {
      resource: unit.resource,
      fingerprint: envClass ?? unit.fingerprint,
    }, { runId: env.runId, by: env.by })
    await mission.annotate(missionId, 'orchestrator', {
      kind: 'unit',
      unit: unit.id,
      resource: unit.resource,
      // The class is what refs carries; both are printed so a reader can see
      // the difference rather than infer it.
      fingerprint: envClass ?? unit.fingerprint,
      unitFingerprint: unit.fingerprint,
      ...(klass !== undefined ? { envExcluded: klass.excluded } : {}),
      image: env.unit.plan.image,
      workspace: unit.workspace,
      scopedHome: { container: env.unit.plan.scopedHome.container, var: env.unit.plan.scopedHome.var },
    }, { runId: env.runId, by: env.by }).catch(() => {})
    // lab hashes the tree it copies too. That number is a different claim —
    // "what went into the unit is this" — so it is kept under its own name;
    // `materialization.json` stays the orchestrator's, computed identically
    // on both paths. The workspace holds exactly the item's visible bytes: no
    // manifest, and so no host path, inside the unit.
    const populated = await env.unit.lab.populate(unit.id, { source: cellDir, target: unit.workspace })
    writeFileSync(join(attemptDataDir, POPULATE_MANIFEST), `${JSON.stringify({
      unit: unit.id,
      source: cellDir,
      target: unit.workspace,
      sha: populated.sha,
      count: populated.count,
      files: populated.files,
      note: 'lab populate: what was copied into the unit, hashed by lab\'s own rule. The comparability number is materialization.json.',
    }, null, 2)}\n`, 'utf8')
    await mission.addArtifact(missionId, { path: POPULATE_MANIFEST, kind: 'populate-manifest' }, { runId: env.runId, by: env.by })
    writeFileSync(join(attemptDataDir, WORKSPACE_MIRROR), `${JSON.stringify({
      unit: unit.id,
      resource: unit.resource,
      workspace: unit.workspace,
      hostMirror: cellDir,
      note: 'the workspace is collected here after every stage round; the sealed copy is archive/workspace',
    }, null, 2)}\n`, 'utf8')
    env.log(`cell ${missionId}: unit ${unit.resource} · ${unit.fingerprint.slice(0, 20)}… · ${populated.count} file(s) populated into ${unit.workspace}`)
  }

  // Stage loop: one delegation round per stage (fresh start in round one,
  // resume of the same child afterwards), byte-exact prompts (decision 4).
  // Entering the FIRST stage is the loop's own transition; every later stage
  // is entered by the previous iteration's submit+transition (the template's
  // exit edge), so submissions happen while the mission sits IN the stage
  // state — exactly the semantics the generated machine declares.
  let childSessionId: string | undefined
  let round = 1
  let diverted = false
  for (const [stageIndex, stageId] of env.planStages.entries()) {
    if (stageIndex === 0) {
      await mission.transition(missionId, stageStateName(env.manifest, stageId), { runId: env.runId, by: env.by })
    }

    const promptFile = await datasets.read({ repo: env.repo }, { dataset: env.datasetId, layer: 'visible', path: `prompts/${stageId}.md`, commit: env.commit })
    const taskFile = await datasets.read({ repo: env.repo }, { dataset: env.datasetId, item: env.cell.labels.task, layer: 'visible', path: 'task.md', commit: env.commit })
    const promptBytes = Buffer.concat([
      Buffer.from(promptFile.content, 'utf8'),
      Buffer.from('\n', 'utf8'),
      Buffer.from(taskFile.content, 'utf8'),
    ])
    const promptSha = sha256(promptBytes)
    state.promptShas[stageId] = promptSha

    const remainingMs = env.budgetMs - state.spentMs
    if (remainingMs <= 0) {
      throw new InfrastructureFailure(`stage ${stageId}: the cell's active-minutes budget is exhausted`)
    }
    // A cancel that arrives between rounds stops here, before a new round
    // spawns anything: the cell is left in this stage's state. Read through a
    // call, not a property test: `aborted` is a readonly property, so a
    // control-flow narrowing of it would outlive the abort that flips it.
    const runCancelled = (): boolean => env.signal?.aborted === true
    if (runCancelled()) {
      throw new RunCancelled(`stage ${stageId}: the run was cancelled before the round started`)
    }
    const startedAt = env.now()
    const controller = new AbortController()
    let timedOut = false
    let cancelled = false
    // ONE lever, two pullers: the cell's budget timer and the run's cancel.
    // Both abort the round's signal (which the delegation carries) and cancel
    // the in-flight delegation by child session id — the facade's own
    // cancellation channel. A second, different stop path is exactly what
    // this design refuses to grow.
    const stopRound = (): void => {
      controller.abort()
      if (childSessionId !== undefined) localAgent.cancel(childSessionId)
    }
    const timer = setTimeout(() => {
      timedOut = true
      stopRound()
    }, remainingMs)
    const onRunCancel = (): void => {
      cancelled = true
      stopRound()
    }
    env.signal?.addEventListener('abort', onRunCancel, { once: true })
    const releaseRoundSignal = (): void => { env.signal?.removeEventListener('abort', onRunCancel) }
    // T11 read-back: the settled progress event carries the round's observed
    // model and usage; kept here and merged with delegationOf after settle
    // (either channel may have the value the other missed).
    let admitted: DelegationConfiguration | undefined
    let settled: {
      observedEffort?: string
      observedModel?: string
      cliVersion?: string
      usage?: DelegationUsage
      toolCalls?: DelegationToolCalls
    } | undefined
    // What the record already carried before this round — a later value that
    // differs from it is this round's own observation.
    const priorObserved = childSessionId === undefined
      ? undefined
      : localAgent.delegationOf?.(childSessionId)?.observedModel
    let run: Awaited<ReturnType<LocalAgentFace['start']>>
    try {
      requireEffortAdmission(localAgent, env.condition.provider, env.condition.declaredEffort)
      const delegationOptions = {
        label: `${env.runId}/${missionId} ${stageId}`,
        signal: controller.signal,
        // Inside a unit the host cwd is meaningless, so it is NOT passed: the
        // round runs in the unit's workspace, and the one variable the target
        // carries is the in-container scoped home the provider requires (a
        // host path there would start the CLI in a directory the unit has no
        // copy of — T17 refuses the round rather than let that happen).
        ...(unit === undefined
          ? { cwd: cellDir }
          : {
            exec: {
              container: unit.resource,
              workdir: unit.workspace,
              env: { [(env.unit as CellUnitBinding).plan.scopedHome.var]: (env.unit as CellUnitBinding).plan.scopedHome.container },
            },
          }),
        // Which scoped home the round reads its credentials from — the
        // condition's own, on the host and inside a unit alike. Every round of
        // this cell repeats it, because the family anchors the scope in the
        // delegation record and refuses a resume that names another.
        ...(env.condition.scope === undefined ? {} : { scope: env.condition.scope }),
        onProgress: (event: DelegationProgress) => {
          // Only the settled kind carries the read-back; the round's own
          // event wins over a later record read (last settle = this round).
          if (event.kind !== 'settled') return
          settled = {
            ...event.observedEffort !== undefined ? { observedEffort: event.observedEffort } : {},
            ...event.observedModel !== undefined ? { observedModel: event.observedModel } : {},
            ...event.cliVersion !== undefined ? { cliVersion: event.cliVersion } : {},
            ...event.usage !== undefined ? { usage: event.usage } : {},
            ...event.toolCalls !== undefined ? { toolCalls: event.toolCalls } : {},
          }
        },
      }
      const promptBlocks = [{ type: 'text' as const, text: promptBytes.toString('utf8') }]
      // The declared model is REQUESTED, not merely compared against: the
      // first round names it and the family records it, so every later round
      // of the same cell re-requests exactly that value — which is why
      // `resume` neither takes it nor needs it. A condition that declares no
      // model asks for none and the harness's own configuration decides, the
      // behavior before this option existed.
      run = childSessionId === undefined
        ? await localAgent.start(env.parentSessionId, env.condition.provider, promptBlocks, {
          ...delegationOptions,
          ...frozenConfigurationOptions(env.condition.sha, env.condition.declaredEffort),
          ...(env.condition.declaredModel === null ? {} : { model: env.condition.declaredModel }),
        })
        : await localAgent.resume(env.parentSessionId, env.condition.provider, childSessionId, promptBlocks, delegationOptions)
      admitted = localAgent.runConfiguration?.(run)
    } catch (error) {
      clearTimeout(timer)
      releaseRoundSignal()
      const durationMs = env.now() - startedAt
      state.spentMs += durationMs
      await mission.annotate(missionId, 'orchestrator', {
        kind: 'delegation-failed',
        stage: stageId,
        round,
        ...(childSessionId !== undefined ? { childSessionId } : {}),
        promptSha,
        startedAt,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      }, { runId: env.runId, by: env.by })
      if (cancelled || runCancelled()) {
        throw new RunCancelled(`stage ${stageId}: the run was cancelled while the round was starting`)
      }
      throw new InfrastructureFailure(`stage ${stageId} delegation failed to start: ${error instanceof Error ? error.message : String(error)}`)
    }
    state.childSessionIds.push(run.id)
    childSessionId = run.id
    await mission.setRefs(missionId, { sessions: [run.id] }, { runId: env.runId, by: env.by })

    let result: DelegationResult
    try {
      result = await run.result
    } catch (error) {
      clearTimeout(timer)
      releaseRoundSignal()
      const durationMs = env.now() - startedAt
      state.spentMs += durationMs
      await mission.annotate(missionId, 'orchestrator', {
        kind: 'delegation-failed',
        stage: stageId,
        round,
        childSessionId: run.id,
        promptSha,
        startedAt,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      }, { runId: env.runId, by: env.by })
      throw new InfrastructureFailure(`stage ${stageId} delegation faulted: ${error instanceof Error ? error.message : String(error)}`)
    }
    const durationMs = env.now() - startedAt
    state.spentMs += durationMs
    clearTimeout(timer)
    releaseRoundSignal()
    // The read-back after settle: this round's own settled event wins; else
    // the delegation record, waited for because the provider merges it a beat
    // after the result resolves. A facade that delivers neither leaves null —
    // absence is recorded, never guessed. `usage` rides the settled event
    // only: a facade that clears the tracked run before its settle pass
    // records no usage here, and null is the honest answer.
    const observedModel = settled?.observedModel
      ?? await awaitObservedModel(localAgent, run.id, priorObserved, env.readbackWaitMs)
    const reasoning = effortEvidence(env.condition.declaredEffort, admitted, settled?.observedEffort ?? result.observedEffort)
    const usage = settled?.usage ?? null
    // `usage` stays an explicit null (its shape predates this field and the
    // report reads the key), but the two newer facts are OMITTED when the
    // round did not report them: absence is what "the harness counted none"
    // has to look like, and a zero would read as a round that used no tools.
    await mission.annotate(missionId, 'orchestrator', {
      kind: 'delegation',
      stage: stageId,
      round,
      childSessionId: run.id,
      promptSha,
      startedAt,
      durationMs,
      usage,
      ...settled?.toolCalls !== undefined ? { toolCalls: settled.toolCalls } : {},
      ...settled?.cliVersion !== undefined ? { cliVersion: settled.cliVersion } : {},
      // `requested` is what the round ASKED the harness for — the declared
      // model when the condition names one. It is the same value as
      // `declared` by construction today, and recorded separately because the
      // two answer different questions: what the condition claims, and what
      // this round actually put on the CLI's command line.
      requestedModel: env.condition.declaredModel,
      model: { declared: env.condition.declaredModel, observed: observedModel },
      reasoning,
      ...(admitted === undefined ? {} : { configuration: admitted }),
    }, { runId: env.runId, by: env.by })
    // The cancel is checked FIRST: when both fired, the run was cancelled
    // during the round's last budgeted second, and "the operator stopped it"
    // is the truer sentence than "it ran out of budget" — and the one that
    // decides whether the cell is retried.
    if (cancelled) {
      throw new RunCancelled(`stage ${stageId} delegation cancelled with the run (${run.id})`)
    }
    if (timedOut) {
      throw new InfrastructureFailure(`stage ${stageId} delegation exceeded the cell's ${Math.round(env.budgetMs / 60_000)}min active budget — cancelled (${run.id})`)
    }
    if (result.stopReason !== 'completed') {
      throw new InfrastructureFailure(`stage ${stageId} delegation ended with stopReason ${JSON.stringify(result.stopReason)}${result.diagnostic !== undefined ? `: ${result.diagnostic}` : ''}`)
    }
    // Declared ≠ observed is fail loud (frozen decision 5): the run is
    // misattributed and must not quietly continue. The annotation above
    // carries the mismatch for the report.
    if (reasoning.status === 'mismatch') throw new MisattributedRun(`condition ${env.condition.id}: frozen reasoning effort does not match admitted/observed configuration — this sample is not comparable`)
    if (observedModel !== null && env.condition.declaredModel !== null && observedModel !== env.condition.declaredModel) {
      throw new MisattributedRun(
        `condition ${env.condition.id} declares model ${JSON.stringify(env.condition.declaredModel)} but the delegation ran ${JSON.stringify(observedModel)} (child ${run.id}, stage ${stageId}) — the run is misattributed`,
      )
    }

    // Architecture step 14, then 15: tag the return point inside the unit,
    // bring the workspace back to the host, and only then read, validate and
    // submit. The checkpoint's ref reaches mission through lab.
    if (unit !== undefined) {
      const lab = (env.unit as CellUnitBinding).lab
      const checkpoint = await lab.checkpoint(unit.id, { name: stageId })
      await lab.collect(unit.id, {
        source: unit.workspace,
        target: cellDir,
        kind: 'workspace-mirror',
        artifactPath: WORKSPACE_MIRROR,
      })
      env.log(`cell ${missionId}: ${stageId} checkpointed at ${checkpoint.ref.slice(0, 12)} and mirrored to the host`)
    }

    // Collect the stage outputs from the cell directory (decision 7).
    const jsonPath = join(cellDir, `${stageId}.json`)
    const mdPath = join(cellDir, `${stageId}.md`)
    const missing: string[] = []
    if (!existsSync(jsonPath)) {
      missing.push(unit === undefined
        ? `${stageId}.json missing from the cell directory (a facade without the cwd option runs the child in the parent session cwd — the file would land there)`
        : `${stageId}.json missing from the unit's workspace (${unit.workspace}) after collect — the round wrote it somewhere else, or wrote nothing`)
    }
    if (!existsSync(mdPath)) missing.push(`${stageId}.md missing from the cell directory`)
    if (missing.length > 0) throw new SubmissionRejected(stageId, missing)
    const jsonText = readFileSync(jsonPath, 'utf8')
    let json: unknown
    try {
      json = JSON.parse(jsonText)
    } catch (error) {
      throw new SubmissionRejected(stageId, [`${stageId}.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`])
    }
    const mdText = readFileSync(mdPath, 'utf8')

    // The halt check (decision 7): the manifest's halt_on diverts the edge.
    const stageDecl = env.manifest.stages.find(stage => stage.id === stageId)
    const haltOn = stageDecl?.halt_on
    const nextStageId = env.planStages[stageIndex + 1]
    const halted = haltOn !== undefined && (json as Record<string, unknown>)[haltOn.field] === haltOn.equals
    const target = halted
      ? 'halted'
      : nextStageId === undefined
        ? 'judged'
        : stageStateName(env.manifest, nextStageId)
    if (halted) diverted = true

    try {
      await mission.submit(missionId, {
        runId: env.runId,
        by: env.by,
        to: target,
        json,
        files: [
          { path: `${stageId}.json`, content: jsonText },
          { path: `${stageId}.md`, content: mdText },
        ],
      })
    } catch (error) {
      // Schema violations are not retried (decision 7): submit writes
      // nothing on a refused payload; the cell stays in its current state.
      throw new SubmissionRejected(stageId, [error instanceof Error ? error.message : String(error)])
    }
    try {
      await mission.transition(missionId, target, { runId: env.runId, by: env.by })
    } catch (error) {
      throw new SubmissionRejected(stageId, [`transition to ${target} refused: ${error instanceof Error ? error.message : String(error)}`])
    }
    round += 1
    if (halted || nextStageId === undefined) break
  }

  // Judge, then archive. The order is forced by the gate: `verdicts/` must be
  // non-empty to leave `archived`, so the two mechanical sources run here,
  // before the workspace copy (architecture steps 16 and 19).
  const current = mission.get(missionId, env.runId)
  const archiveDir = join(faces.mission.dataDir, 'runs', env.runId, 'data', missionId, `attempt-${current.mission.currentAttempt}`, 'archive')
  mkdirSync(join(archiveDir, 'verdicts'), { recursive: true })
  const verdictCounts = await judgeCell(faces, {
    runId: env.runId,
    by: env.by,
    now: env.now,
    log: env.log,
    missionId,
    taskId: env.cell.labels.task,
    datasetId: env.datasetId,
    commit: env.commit,
    repo: env.repo,
    cellDir,
    archiveDir,
    attemptDataDir,
    attempt: current.mission.currentAttempt,
    parentSessionId: env.parentSessionId,
    condition: { id: env.condition.id, declaredModel: env.condition.declaredModel },
    judge: env.judge,
    ...(unit !== undefined ? { unit: { lab: (env.unit as CellUnitBinding).lab, unitId: unit.id } } : {}),
  })
  if (unit === undefined) {
    cpSync(cellDir, join(archiveDir, 'workspace'), { recursive: true })
    await mission.addArtifact(missionId, { path: 'archive', kind: 'archive' }, { runId: env.runId, by: env.by })
  } else {
    // lab exports the workspace AND the integrity manifest, and registers the
    // artifact itself. `verdicts/` is already beside it: the judging phase ran
    // first, because the archive gate refuses an empty one.
    await (env.unit as CellUnitBinding).lab.archive(unit.id, { target: archiveDir, kind: 'archive', artifactPath: 'archive' })
  }
  await mission.transition(missionId, 'archived', { runId: env.runId, by: env.by })

  const destroy = async (why: string): Promise<void> => {
    if (unit === undefined) return
    await destroyUnit(
      { lab: (env.unit as CellUnitBinding).lab, mission },
      { runId: env.runId, by: env.by, log: env.log, missionId },
      unit,
      why,
    )
    unit = undefined
    if (env.held !== undefined) delete env.held.unit
  }

  if (env.finalize) {
    try {
      await mission.transition(missionId, 'releasable', { runId: env.runId, by: env.by })
      // The gate has just said yes, and `releasable` is the ONLY state it says
      // yes in — `isReleasable` reads the current state against the template's
      // releasableStates. So the unit dies HERE, between the two transitions,
      // which is also the order architecture step 17 spells out: archive →
      // pass the gate → release. Destroying after `released` would ask the
      // gate a question it answers no to, and every container would survive.
      await destroy('the cell passed the archive gate')
      await mission.transition(missionId, 'released', { runId: env.runId, by: env.by })
    } catch (error) {
      // The archive gate refused (an empty verdicts/ — no probes and no judge
      // produced anything): the cell stays at archived and the refusal is
      // recorded, not bypassed.
      await mission.annotate(missionId, 'orchestrator', {
        kind: 'finalize-refused',
        error: error instanceof Error ? error.message : String(error),
      }, { runId: env.runId, by: env.by }).catch(() => {})
    }
  }
  // A cell that did not pass the gate — no --finalize, or a refused one —
  // still asks, and is still refused, and its container STAYS. That is the
  // correct answer for a cell nobody has looked at yet, and the reason there
  // is no force on this path.
  await destroy('the cell finished without passing the archive gate')

  const finalRecord = mission.get(missionId, env.runId)
  const finalAttempt = finalRecord.mission.attempts[finalRecord.mission.currentAttempt - 1]
  return {
    missionId,
    task: env.cell.labels.task,
    condition: env.cell.labels.condition,
    rep: Number(env.cell.labels.rep),
    attempts: finalRecord.mission.currentAttempt,
    finalState: finalAttempt?.state ?? 'unknown',
    childSessionIds: state.childSessionIds,
    promptShas: state.promptShas,
    activeMs: state.spentMs,
    verdicts: { script: verdictCounts.script, llmDraft: verdictCounts.llmDraft },
    ...(diverted ? { halted: true } : {}),
  }
}

/** Run one cell with the infrastructure-retry policy (decision 8). */
async function runCellWithRetry(
  faces: { datasets: DatasetsFace; mission: MissionFace; localAgent: LocalAgentFace },
  env: {
    runId: string
    by: string
    now: () => number
    log: (message: string) => void
    cell: EvalCell
    retryLimit: number
    planStages: string[]
    manifest: SuiteManifest
    datasetRoot: string
    datasetId: string
    commit: string
    repo: string
    cellDirBase: string
    budgetMs: number
    condition: ResolvedCondition
    parentSessionId: string
    finalize: boolean
    readbackWaitMs: number
    judge: JudgeEnv
    unit?: CellUnitBinding
    /** The run's cancellation signal (see {@link RunOptions.signal}). */
    signal?: AbortSignal
  },
): Promise<RunCellReport> {
  const { mission } = faces
  const state: CellState = { childSessionIds: [], promptShas: {}, spentMs: 0 }
  for (;;) {
    const current = mission.get(env.cell.missionId, env.runId)
    const attempt = current.mission.currentAttempt
    const held: { unit?: LabUnitInfo } = {}
    try {
      return await runCellOnce(faces, { ...env, attempt, held }, state)
    } catch (error) {
      // Whatever went wrong, the unit is salvaged before anything else is
      // decided: the retry below opens a NEW attempt and acquires a NEW unit,
      // and a held container that nobody archived is both a lost crash scene
      // and one step closer to the concurrency ceiling.
      if (held.unit !== undefined && env.unit !== undefined) {
        await salvageUnit(
          { lab: env.unit.lab, mission },
          { runId: env.runId, by: env.by, log: env.log, missionId: env.cell.missionId },
          held.unit,
          {
            cellDir: join(env.cellDirBase, env.cell.missionId, `attempt-${attempt}`),
            archiveDir: join(mission.dataDir, 'runs', env.runId, 'data', env.cell.missionId, `attempt-${attempt}`, 'archive'),
          },
        )
        delete held.unit
      }
      if (error instanceof RunCancelled) {
        // Recorded, then left alone. No retry (the operator stopped this run),
        // no transition (the cell's state IS the evidence of where it got to),
        // and the annotation is what a reader — and `finalize`'s
        // `interrupted` bucket — sees afterwards.
        const reason = error.message
        await mission.annotate(env.cell.missionId, 'orchestrator', {
          kind: 'cell-cancelled',
          reason,
          attempts: attempt,
        }, { runId: env.runId, by: env.by }).catch(() => {})
        env.log(`cell ${env.cell.missionId}: cancelled — ${reason}`)
        const after = mission.get(env.cell.missionId, env.runId)
        const attemptRecord = after.mission.attempts[after.mission.currentAttempt - 1]
        return {
          missionId: env.cell.missionId,
          task: env.cell.labels.task,
          condition: env.cell.labels.condition,
          rep: Number(env.cell.labels.rep),
          attempts: after.mission.currentAttempt,
          finalState: attemptRecord?.state ?? 'unknown',
          childSessionIds: state.childSessionIds,
          promptShas: state.promptShas,
          activeMs: state.spentMs,
          cancelled: { reason },
        }
      }
      if (error instanceof SubmissionRejected) {
        await mission.annotate(env.cell.missionId, 'orchestrator', {
          kind: 'submission-rejected',
          stage: error.stage,
          violations: error.violations,
        }, { runId: env.runId, by: env.by }).catch(() => {})
        const after = mission.get(env.cell.missionId, env.runId)
        const attemptRecord = after.mission.attempts[after.mission.currentAttempt - 1]
        env.log(`cell ${env.cell.missionId}: submission rejected — the cell stops in ${attemptRecord?.state ?? 'its current state'}`)
        return {
          missionId: env.cell.missionId,
          task: env.cell.labels.task,
          condition: env.cell.labels.condition,
          rep: Number(env.cell.labels.rep),
          attempts: after.mission.currentAttempt,
          finalState: attemptRecord?.state ?? 'unknown',
          childSessionIds: state.childSessionIds,
          promptShas: state.promptShas,
          activeMs: state.spentMs,
          rejected: { stage: error.stage, violations: error.violations },
        }
      }
      if (!(error instanceof InfrastructureFailure)) throw error
      const reason = error.message
      if (current.mission.currentAttempt - 1 >= env.retryLimit) {
        await mission.annotate(env.cell.missionId, 'orchestrator', {
          kind: 'cell-skipped',
          reason,
          attempts: current.mission.currentAttempt,
        }, { runId: env.runId, by: env.by }).catch(() => {})
        env.log(`cell ${env.cell.missionId}: infrastructure budget exhausted — skipped (${reason})`)
        const attemptRecord = current.mission.attempts[current.mission.currentAttempt - 1]
        return {
          missionId: env.cell.missionId,
          task: env.cell.labels.task,
          condition: env.cell.labels.condition,
          rep: Number(env.cell.labels.rep),
          attempts: current.mission.currentAttempt,
          finalState: attemptRecord?.state ?? 'unknown',
          childSessionIds: state.childSessionIds,
          promptShas: state.promptShas,
          activeMs: state.spentMs,
          skipped: { reason },
        }
      }
      env.log(`cell ${env.cell.missionId}: infrastructure failure — ${reason}; retrying`)
      await mission.retry(env.cell.missionId, { runId: env.runId, reason, category: 'infrastructure', by: env.by })
    }
  }
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
    log: (message: string) => void
  },
): Promise<string | null> {
  const scope = { repo: input.repo, layers: ['grading'] }
  const rubrics: Array<{ task: string; rubricText: string }> = []
  for (const task of [...new Set(input.tasks)]) {
    try {
      const graded = await faces.datasets.show(scope, input.datasetId, task, input.commit)
      const rubricPath = pickRubricPath(graded.items.find(item => item.id === task)?.layers['grading'] ?? [])
      if (rubricPath === null) continue
      const rubric = await faces.datasets.read(scope, {
        dataset: input.datasetId, item: task, layer: 'grading', path: rubricPath, commit: input.commit,
      })
      rubrics.push({ task, rubricText: rubric.content })
    } catch (error) {
      input.log(`rubric weights: task ${task} skipped — ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const table = buildRubricWeightTable({ dataset: input.datasetId, commit: input.commit, rubrics })
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
  const validation: PlanValidation = await validatePlan(planPath)
  if (!validation.ok) {
    throw new EvalRunRefused(
      `plan ${planPath} has ${validation.errors.length} validation error(s) — nothing was executed`,
      validation.errors,
    )
  }
  const datasetRoot = validation.datasetRoot
  if (datasetRoot === null) {
    throw new EvalRunRefused('cannot locate the dataset root — cannot resolve manifest, conditions, or schemas')
  }
  const planAbs = resolve(planPath)
  const plan = JSON.parse(await readFile(planAbs, 'utf8')) as {
    dataset: { repo: string; id: string; commit: string | null; items: string[] }
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
  const planSha = sha256(Buffer.from(canonicalJson(plan), 'utf8'))
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
    const document = JSON.parse(await readFile(join(datasetRoot, 'conditions', `${resolution.id}.json`), 'utf8')) as Record<string, unknown>
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
    const lockPath = join(datasetRoot, 'conditions', `${resolution.id}.lock.json`)
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
    const judgePath = join(datasetRoot, 'conditions', `${judgeId}.json`)
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
  const snapshot = await faces.datasets.snapshot({ repo: expandHome(plan.dataset.repo) }, plan.dataset.id, plan.dataset.commit ?? undefined)

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
  const outDir = options.exportsDir ?? planExportsDir ?? join(snapshot.repoPath, 'exports')
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
    // `--out <dir>` left no way back to its own artifact (I5·T53). The first
    // cell carries the note; the report page scans for the newest.
    const noteCell = ordered[0]?.missionId
    if (noteCell !== undefined) {
      const recorded = await recordExportNoteOn(faces.mission, noteCell, runId, {
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
