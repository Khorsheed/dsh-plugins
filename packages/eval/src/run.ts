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
 * Since I2·T9 the loop also JUDGES: once a cell reaches its terminal stage
 * state it runs the item's probes (script ns) and delegates the blind LLM
 * judging (llm-draft ns) through the judge conditions the plan names, so the
 * archive gate's non-empty `verdicts/` requirement can actually be met and
 * `--finalize` reaches `released`. What the loop still does not do: containers
 * (I3 hands probe execution to `lab.verify`) and `human-final` (a person's
 * act, written from the judge bench).
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
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, hashConditionDocument } from './hash.ts'
import type { DelegationProgress, DelegationResult, DelegationUsage, DatasetsFace, LocalAgentFace, MissionFace } from './faces.ts'
import { conditionDiagnostics, validatePlan, type EvalDiagnostic, type PlanValidation } from './validate.ts'
import { generateTemplateFromManifest, stageStateName, type GeneratedTemplate } from './template.ts'
import { loadManifest, type SuiteManifest } from './manifest.ts'
import { expandMatrix, orderCells, type EvalCell } from './matrix.ts'
import { awaitObservedModel, DEFAULT_READBACK_WAIT_MS } from './readback.ts'
import {
  checkReadiness, DEFAULT_READINESS_TIMEOUT_MS,
  type ReadinessRecord, type ReadinessSubject,
} from './readiness.ts'
import {
  buildDeidentifyRules, deidentify, discardProbeDir, llmDraftCriteria, mergeReplacements,
  pickRubricPath, runJudgeSamples, runProbes,
  DEFAULT_JUDGE_SAMPLES, JUDGE_MATERIAL_FILES,
  type DeidentifyRule, type ReplacementCount, type ResolvedJudge, type RubricCriterion,
} from './judge.ts'

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
   * After archiving, attempt archived → releasable → released. The archive
   * gate's file-check requires a NON-EMPTY verdicts/ directory, which v0
   * (no judge yet) cannot fill — so the default run stops at `archived`.
   */
  finalize?: boolean
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

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
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
  id: string
  sha: string
  harnessName: string
  declaredModel: string | null
  provider: string
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
    attempt: number
    parentSessionId: string
    judge: JudgeEnv
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
  const probeDir = join(env.judge.probeDirBase, env.missionId, `attempt-${env.attempt}`)
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
    })
    if (probed.outcomes.length > 0) {
      await faces.mission.annotate(env.missionId, 'orchestrator', {
        kind: 'probes',
        probes: probed.outcomes.map(outcome => ({
          probe: outcome.probe,
          exitCode: outcome.exitCode,
          ok: outcome.ok,
          verdicts: outcome.verdicts.length,
          durationMs: outcome.durationMs,
          ...(outcome.error !== undefined ? { error: outcome.error } : {}),
        })),
      }, { runId: env.runId, by: env.by }).catch(() => {})
    }
    if (probed.verdicts.length > 0) {
      writeFileSync(join(verdictsDir, 'script.json'), `${JSON.stringify(probed.verdicts, null, 2)}\n`, 'utf8')
      await faces.mission.annotate(env.missionId, 'script', probed.verdicts, { runId: env.runId, by: env.by })
      counts.script = probed.verdicts.length
      env.log(`cell ${env.missionId}: ${probed.verdicts.length} script verdict(s) from ${probed.outcomes.filter(o => o.ok).length}/${probed.outcomes.length} probe(s)`)
    }
  } catch (error) {
    await faces.mission.annotate(env.missionId, 'orchestrator', {
      kind: 'probes-failed',
      error: error instanceof Error ? error.message : String(error),
    }, { runId: env.runId, by: env.by }).catch(() => {})
    env.log(`cell ${env.missionId}: probes failed — ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    discardProbeDir(probeDir)
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
  const overall = createHash('sha256')
  for (const file of materialized) {
    overall.update(file.path)
    overall.update('\0')
    overall.update(file.sha256)
    overall.update('\0')
  }
  const materialization = {
    dataset: env.datasetId,
    task: env.cell.labels.task,
    commit: env.commit,
    layers: ['visible'],
    source: { worktree: worktree.path, reused: worktree.reused },
    files: materialized,
    sha256: overall.digest('hex'),
  }
  const materializationText = `${JSON.stringify(materialization, null, 2)}\n`
  writeFileSync(join(cellDir, 'materialization.json'), materializationText, 'utf8')
  // The artifact index points INTO the mission run-data tree (bundle export
  // copies from there), so the record lands in both places: the cell working
  // directory (what the child sees) and the attempt's run-data directory
  // (what addArtifact requires and the bundle carries).
  const attemptDataDir = join(faces.mission.dataDir, 'runs', env.runId, 'data', missionId, `attempt-${env.attempt}`)
  mkdirSync(attemptDataDir, { recursive: true })
  writeFileSync(join(attemptDataDir, 'materialization.json'), materializationText, 'utf8')
  await mission.addArtifact(missionId, { path: 'materialization.json', kind: 'materialization' }, { runId: env.runId, by: env.by })

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
    const startedAt = env.now()
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      if (childSessionId !== undefined) localAgent.cancel(childSessionId)
    }, remainingMs)
    // T11 read-back: the settled progress event carries the round's observed
    // model and usage; kept here and merged with delegationOf after settle
    // (either channel may have the value the other missed).
    let settled: { observedModel?: string; usage?: DelegationUsage } | undefined
    // What the record already carried before this round — a later value that
    // differs from it is this round's own observation.
    const priorObserved = childSessionId === undefined
      ? undefined
      : localAgent.delegationOf?.(childSessionId)?.observedModel
    let run: Awaited<ReturnType<LocalAgentFace['start']>>
    try {
      const delegationOptions = {
        label: `${env.runId}/${missionId} ${stageId}`,
        signal: controller.signal,
        cwd: cellDir,
        onProgress: (event: DelegationProgress) => {
          // Only the settled kind carries the read-back; the round's own
          // event wins over a later record read (last settle = this round).
          if (event.kind !== 'settled') return
          settled = {
            ...event.observedModel !== undefined ? { observedModel: event.observedModel } : {},
            ...event.usage !== undefined ? { usage: event.usage } : {},
          }
        },
      }
      const promptBlocks = [{ type: 'text' as const, text: promptBytes.toString('utf8') }]
      run = childSessionId === undefined
        ? await localAgent.start(env.parentSessionId, env.condition.provider, promptBlocks, delegationOptions)
        : await localAgent.resume(env.parentSessionId, env.condition.provider, childSessionId, promptBlocks, delegationOptions)
    } catch (error) {
      clearTimeout(timer)
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
    // The read-back after settle: this round's own settled event wins; else
    // the delegation record, waited for because the provider merges it a beat
    // after the result resolves. A facade that delivers neither leaves null —
    // absence is recorded, never guessed. `usage` rides the settled event
    // only: a facade that clears the tracked run before its settle pass
    // records no usage here, and null is the honest answer.
    const observedModel = settled?.observedModel
      ?? await awaitObservedModel(localAgent, run.id, priorObserved, env.readbackWaitMs)
    const usage = settled?.usage ?? null
    await mission.annotate(missionId, 'orchestrator', {
      kind: 'delegation',
      stage: stageId,
      round,
      childSessionId: run.id,
      promptSha,
      startedAt,
      durationMs,
      usage,
      model: { declared: env.condition.declaredModel, observed: observedModel },
    }, { runId: env.runId, by: env.by })
    if (timedOut) {
      throw new InfrastructureFailure(`stage ${stageId} delegation exceeded the cell's ${Math.round(env.budgetMs / 60_000)}min active budget — cancelled (${run.id})`)
    }
    if (result.stopReason !== 'completed') {
      throw new InfrastructureFailure(`stage ${stageId} delegation ended with stopReason ${JSON.stringify(result.stopReason)}${result.diagnostic !== undefined ? `: ${result.diagnostic}` : ''}`)
    }
    // Declared ≠ observed is fail loud (frozen decision 5): the run is
    // misattributed and must not quietly continue. The annotation above
    // carries the mismatch for the report.
    if (observedModel !== null && env.condition.declaredModel !== null && observedModel !== env.condition.declaredModel) {
      throw new MisattributedRun(
        `condition ${env.condition.id} declares model ${JSON.stringify(env.condition.declaredModel)} but the delegation ran ${JSON.stringify(observedModel)} (child ${run.id}, stage ${stageId}) — the run is misattributed`,
      )
    }

    // Collect the stage outputs from the cell directory (decision 7).
    const jsonPath = join(cellDir, `${stageId}.json`)
    const mdPath = join(cellDir, `${stageId}.md`)
    const missing: string[] = []
    if (!existsSync(jsonPath)) missing.push(`${stageId}.json missing from the cell directory (a facade without the cwd option runs the child in the parent session cwd — the file would land there)`)
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
    attempt: current.mission.currentAttempt,
    parentSessionId: env.parentSessionId,
    judge: env.judge,
  })
  cpSync(cellDir, join(archiveDir, 'workspace'), { recursive: true })
  await mission.addArtifact(missionId, { path: 'archive', kind: 'archive' }, { runId: env.runId, by: env.by })
  await mission.transition(missionId, 'archived', { runId: env.runId, by: env.by })

  if (env.finalize) {
    try {
      await mission.transition(missionId, 'releasable', { runId: env.runId, by: env.by })
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
  },
): Promise<RunCellReport> {
  const { mission } = faces
  const state: CellState = { childSessionIds: [], promptShas: {}, spentMs: 0 }
  for (;;) {
    const current = mission.get(env.cell.missionId, env.runId)
    try {
      return await runCellOnce(faces, { ...env, attempt: current.mission.currentAttempt }, state)
    } catch (error) {
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
  }
  const planSha = sha256(Buffer.from(canonicalJson(plan), 'utf8'))
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
    conditions.push({
      id: resolution.id,
      sha,
      harnessName: (document['harness'] as { name?: string } | undefined)?.name ?? '',
      declaredModel: (document['model'] as { declared: string | null } | undefined)?.declared ?? null,
      provider: '',
      document,
    })
  }

  // ── The judge is a condition too, and must not be a contestant. ───────
  // validate() already refuses an id that appears on both lists; this is the
  // stronger check the brief asks for — two DIFFERENT ids that name the same
  // (harness, declared model) are the same subject wearing two hats, and a
  // judge grading itself is the failure decision 9 exists to prevent.
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
    const clash = conditions.find(player => player.harnessName === harnessName && player.declaredModel === declaredModel)
    if (clash !== undefined) {
      throw new EvalRunRefused(
        `judge condition ${judgeId} is a contestant — nothing was executed`,
        [{
          code: 'JUDGE_IS_PLAYER',
          message: `${judgeId} declares (harness ${JSON.stringify(harnessName)}, model ${JSON.stringify(declaredModel)}), which is exactly player condition ${clash.id}`
            + ' — frozen decision 9: the judge must not be one of the players. Give the judge a different harness or a different declared model.',
        }],
      )
    }
    judgeDocuments.set(judgeId, document)
    judges.push({ id: judgeId, sha: hashConditionDocument(document), harnessName, declaredModel, provider: '' })
  }

  if (options.dryRun === true) {
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
  }

  // ── Readiness: one real delegation per condition, before anything. ────
  // `/<harness> status` answers a SHAPE question ("is there a credential
  // record?"); this answers the one that decides whether the run is worth
  // starting ("does a delegation on this condition complete?"). Pilot A took
  // the status answer at face value and burned six of twenty-four cells on a
  // credential that said yes and 401'd every time (G4). The probe runs
  // through the same facade, provider and cwd rule the cells use — there is
  // no back door, so what it proves is what the cells will meet.
  const readinessBase = join(stateRoot, 'readiness', `${planSha.slice(0, 12)}-${now()}`)
  const readiness = await checkReadiness({
    localAgent: faces.localAgent,
    conditions: conditions.map((condition): ReadinessSubject => ({
      id: condition.id,
      harnessName: condition.harnessName,
      declaredModel: condition.declaredModel,
      provider: condition.provider,
    })),
    parentSessionId: options.parentSessionId,
    probeDirBase: readinessBase,
    timeoutMs: options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS,
    readbackWaitMs: options.readbackWaitMs ?? DEFAULT_READBACK_WAIT_MS,
    now,
    log,
  })
  const failedReadiness = new Map(readiness.filter(record => !record.ok).map(record => [record.condition, record]))
  if (failedReadiness.size > 0 && options.ignoreReadiness !== true) {
    throw new EvalRunRefused(
      `${failedReadiness.size} of ${readiness.length} condition(s) failed the pre-run readiness check — nothing was executed`
      + ' (fix the condition, or re-run with --ignore-readiness to start anyway and record its cells as skipped)',
      [...failedReadiness.values()].map(record => ({
        code: 'READINESS_FAILED',
        message: `${record.condition} (harness ${record.harness}): ${record.reason ?? 'unknown'}`,
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
    budget: { activeMinutes: plan.budget.activeMinutes, turns: plan.budget.turns },
    judge: { conditions: judges.map(judge => ({ id: judge.id, sha: judge.sha })), samples: judgeSamples },
    ...(plan.expectedNs !== undefined ? { expectedNs: plan.expectedNs } : {}),
    startedAt,
    subset,
    readiness,
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
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, ordered.length))
  const reports = new Map<string, RunCellReport>()
  let nextCell = 0
  const worker = async (): Promise<void> => {
    while (nextCell < ordered.length) {
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
        finalize: options.finalize === true,
        readbackWaitMs: options.readbackWaitMs ?? DEFAULT_READBACK_WAIT_MS,
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

  // ── Bundle export (decision 11): visible layer only. ─────────────────
  const outDir = options.exportsDir ?? planExportsDir ?? join(snapshot.repoPath, 'exports')
  let bundleDir: string | undefined
  let exportError: string | undefined
  try {
    const exported = faces.mission.exportRun({
      runId,
      outDir,
      layers: [{ name: 'visible', guarded: false }],
      snapshotDir: datasetRoot,
      snapshot: { repo: snapshot.repoPath, commit: snapshot.commit, dataset: plan.dataset.id },
      now: now(),
    })
    bundleDir = exported.bundleDir
    log(`bundle exported: ${exported.bundleDir} (${exported.files} files)`)
  } catch (error) {
    exportError = error instanceof Error ? error.message : String(error)
    log(`export failed: ${exportError}`)
  }

  return {
    runId,
    dryRun: false,
    meta,
    cells: ordered.map(cell => reports.get(cell.missionId) as RunCellReport),
    readiness,
    subset,
    template,
    ...(bundleDir !== undefined ? { bundleDir } : {}),
    ...(exportError !== undefined ? { exportError } : {}),
  }
}
