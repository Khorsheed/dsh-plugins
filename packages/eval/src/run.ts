/**
 * The run loop v0 — the executing half of the orchestrator, stages one and
 * two, host directories instead of containers. Reads a plan, snapshots the
 * dataset, generates and writes the run template, expands and orders the
 * matrix, creates the mission run, then drives every cell: materialize the
 * item's visible layer into a per-cell directory, delegate each stage's
 * byte-exact prompt through the local-agent facade, collect the stage
 * outputs, submit + transition along the generated state machine, archive,
 * and export the bundle.
 *
 * What v0 deliberately does not do (later I2 tasks): no judge (T9), no
 * report (T10), no probes/script verdicts, no containers (I3).
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
import type { DelegationResult, DatasetsFace, LocalAgentFace, MissionFace } from './faces.ts'
import { conditionDiagnostics, validatePlan, type EvalDiagnostic, type PlanValidation } from './validate.ts'
import { generateTemplateFromManifest, stageStateName, type GeneratedTemplate } from './template.ts'
import { loadManifest, type SuiteManifest } from './manifest.ts'
import { expandMatrix, orderCells, type EvalCell } from './matrix.ts'

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
  /** Bundle export directory. Default `<dataset repo>/exports/` (decision 11). */
  exportsDir?: string
  /**
   * Infrastructure-retry budget per cell. Named `plan.retry.infrastructure`
   * in the task brief; dataseek.plan/1 (additionalProperties: false) cannot
   * carry the field yet, so it rides the run options until a protocol
   * revision adds it. Default 1.
   */
  retryInfrastructure?: number
  /** Caller tag for mission writes. Default `eval-orchestrator`. */
  by?: string
  /** Injected clock (epoch ms) for deterministic tests. */
  now?: number
  /** Progress sink (the slash wrapper prints these lines). */
  log?: (message: string) => void
  /** Root for the per-cell directories. Default `$DSH_HOME/state/eval`. */
  stateRoot?: string
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
}

/** The run report (the slash/CLI answer and the run.json summary source). */
export interface RunReport {
  runId: string
  dryRun: boolean
  meta: Record<string, unknown>
  /** Cells in execution order. */
  cells: RunCellReport[]
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
  declaredModel: string | null
  provider: string
}

/** Per-cell mutable state carried across infrastructure retries. */
interface CellState {
  childSessionIds: string[]
  promptShas: Record<string, string>
  spentMs: number
}

/** One attempt's execution of one cell (materialize → delegate → submit → archive). */
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
  writeFileSync(join(cellDir, 'materialization.json'), `${JSON.stringify(materialization, null, 2)}\n`, 'utf8')
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
    let run: Awaited<ReturnType<LocalAgentFace['start']>>
    try {
      const delegationOptions = { label: `${env.runId}/${missionId} ${stageId}`, signal: controller.signal, cwd: cellDir }
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
    await mission.annotate(missionId, 'orchestrator', {
      kind: 'delegation',
      stage: stageId,
      round,
      childSessionId: run.id,
      promptSha,
      startedAt,
      durationMs,
      usage: null, // the local-agent family records usage with T11's settled event
      model: { declared: env.condition.declaredModel, observed: null }, // observed read back lands with T11
    }, { runId: env.runId, by: env.by })
    if (timedOut) {
      throw new InfrastructureFailure(`stage ${stageId} delegation exceeded the cell's ${Math.round(env.budgetMs / 60_000)}min active budget — cancelled (${run.id})`)
    }
    if (result.stopReason !== 'completed') {
      throw new InfrastructureFailure(`stage ${stageId} delegation ended with stopReason ${JSON.stringify(result.stopReason)}${result.diagnostic !== undefined ? `: ${result.diagnostic}` : ''}`)
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

  // Archive: copy the cell directory into the attempt's run-data
  // archive/workspace/ before leaving archived (decision 10); verdicts/ is
  // empty until the judge lands (T9), so the default run STOPS at archived.
  const current = mission.get(missionId, env.runId)
  const attemptDataDir = join(faces.mission.dataDir, 'runs', env.runId, 'data', missionId, `attempt-${current.mission.currentAttempt}`)
  const archiveDir = join(attemptDataDir, 'archive')
  mkdirSync(join(archiveDir, 'verdicts'), { recursive: true })
  cpSync(cellDir, join(archiveDir, 'workspace'), { recursive: true })
  await mission.addArtifact(missionId, { path: 'archive', kind: 'archive' }, { runId: env.runId, by: env.by })
  await mission.transition(missionId, 'archived', { runId: env.runId, by: env.by })

  if (env.finalize) {
    try {
      await mission.transition(missionId, 'releasable', { runId: env.runId, by: env.by })
      await mission.transition(missionId, 'released', { runId: env.runId, by: env.by })
    } catch (error) {
      // The archive gate refused (verdicts/ empty — no judge yet): the cell
      // stays at archived and the refusal is recorded, not bypassed.
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
    expectedNs?: string[]
  }
  const planSha = sha256(Buffer.from(canonicalJson(plan), 'utf8'))
  const budgetMs = plan.budget.activeMinutes * 60_000
  const retryLimit = Math.max(0, options.retryInfrastructure ?? 1)

  // ── Manifest + template + matrix (works for a dry run with no faces). ──
  const { manifest } = await loadManifest(join(datasetRoot, 'manifest.yml'))
  const cells = expandMatrix({ dataset: { items: plan.dataset.items }, conditions: plan.conditions, reps: plan.reps })
  const ordered = orderCells(cells, plan.order.seed, plan.order.interleave)
  const template = generateTemplateFromManifest(manifest, {
    stages: plan.stages,
    missions: cells.map(cell => ({ id: cell.missionId, title: cell.title, labels: { ...cell.labels } })),
    ...(manifest.suiteId !== undefined ? { name: `${manifest.suiteId}-v1` } : {}),
  })

  // ── Conditions: fresh hash, lock integrity, model declaration. ────────
  const conditions: ResolvedCondition[] = []
  const conditionWarnings: EvalDiagnostic[] = []
  for (const resolution of validation.conditions) {
    const document = JSON.parse(await readFile(join(datasetRoot, 'conditions', `${resolution.id}.json`), 'utf8'))
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
      declaredModel: (document['model'] as { declared: string | null } | undefined)?.declared ?? null,
      provider: '',
    })
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
        ...(conditionWarnings.length > 0 ? { warnings: conditionWarnings } : {}),
      },
      template,
      cells: [],
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
    const document = JSON.parse(await readFile(join(datasetRoot, 'conditions', `${condition.id}.json`), 'utf8')) as {
      harness: { name: string; drive: string }
    }
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

  // ── Snapshot (the pin lives in run.meta). ─────────────────────────────
  const snapshot = await faces.datasets.snapshot({ repo: expandHome(plan.dataset.repo) }, plan.dataset.id, plan.dataset.commit ?? undefined)

  const startedAt = now()
  const meta: Record<string, unknown> = {
    datasetId: plan.dataset.id,
    commit: snapshot.commit,
    planSha,
    planPath: planAbs,
    evalVersion: await evalVersion(),
    snapshot: { repo: snapshot.repoPath, commit: snapshot.commit, datasetId: snapshot.datasetId },
    conditions: conditions.map(condition => ({ id: condition.id, sha: condition.sha })),
    order: { seed: plan.order.seed, sequence: ordered.map(cell => cell.missionId) },
    concurrency: options.concurrency ?? 1,
    budget: { activeMinutes: plan.budget.activeMinutes, turns: plan.budget.turns },
    ...(plan.expectedNs !== undefined ? { expectedNs: plan.expectedNs } : {}),
    startedAt,
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

  // ── The pool: ordered cells, `concurrency` workers. ───────────────────
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, ordered.length))
  const reports = new Map<string, RunCellReport>()
  let nextCell = 0
  const worker = async (): Promise<void> => {
    while (nextCell < ordered.length) {
      const cell = ordered[nextCell] as EvalCell
      nextCell += 1
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
      }))
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  // ── Bundle export (decision 11): visible layer only. ─────────────────
  const outDir = options.exportsDir ?? join(snapshot.repoPath, 'exports')
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
    template,
    ...(bundleDir !== undefined ? { bundleDir } : {}),
    ...(exportError !== undefined ? { exportError } : {}),
  }
}
