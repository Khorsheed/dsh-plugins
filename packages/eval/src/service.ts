/**
 * The eval service face: the offline verbs the CLI shares (contract checking,
 * deterministic hashing, the bundle report) plus — since I2 — the two
 * orchestration verbs: `generateTemplate` (manifest → run template) and
 * `run` (the stage-one/two run loop). The offline surface is read-only over
 * its inputs; the run verb resolves the datasets / mission / localAgent
 * services through the host at call time and refuses loudly naming whatever
 * is missing.
 * @module @khorsheed/dsh-eval
 */
import { hashConditionDocument, hashHome, type HomeHash } from './hash.ts'
import { writeEvalReport, type ReportWrite } from './report.ts'
import { CONDITION_SCHEMA_ID } from './schema.ts'
import { conditionDiagnostics, expandHome, validatePlan, type EvalDiagnostic, type PlanValidation } from './validate.ts'
import { generateTemplate, type GeneratedTemplate, type GenerateTemplateOptions } from './template.ts'
import { runPlan, EvalRunRefused, type RunDeps, type RunOptions, type RunReport } from './run.ts'
import { finalizeRun, EvalFinalizeRefused, type FinalizeOptions, type FinalizeReport } from './finalize.ts'
import {
  EvalRunJobs,
  type EvalRunHandle,
  type EvalRunOutput,
  type EvalRunStatus,
} from './job.ts'
import {
  EvalReadRefused,
  diffConditions,
  listConditions,
  runStatus,
  type ConditionDiff,
  type ConditionsReport,
  type RunStatusReport,
} from './read.ts'
import { EvalProvisionRefused, provisionCondition, type ProvisionReport } from './provision.ts'
import type { DatasetsBindingFace, DatasetsFace, LabFace, LocalAgentFace, MissionFace, MissionFinalizeFace, MissionReadFace } from './faces.ts'

/** Thrown when a verb is handed a document that violates its contract. */
export class EvalContractError extends Error {}

/** Result of hashing one condition document. */
export interface ConditionHash {
  /** sha256 hex of the canonical condition JSON (notes excluded). */
  sha: string
  /** Unresolved fields and the like — not failures, listed for the caller. */
  warnings: EvalDiagnostic[]
}

/**
 * The eval service. The offline kernel holds no state; the run verb carries
 * an optional host accessor so the in-host plugin can probe its upstream
 * services (the CLI builds the same kernel without a host — run stays
 * dry-run-only there).
 */
export class EvalService {
  /**
   * The run-as-job layer: `/eval run` registers the run here and returns, so
   * a run outlives the turn that started it. One instance per service, so a
   * finished run's output stays readable for as long as the service lives.
   */
  private readonly jobs: EvalRunJobs

  constructor(private readonly hosts?: { get(name: string): unknown }) {
    this.jobs = new EvalRunJobs(hosts)
  }

  /** Whether a run can be started as a background job in this composition. */
  runJobsAvailable(): boolean {
    return this.jobs.available()
  }

  /**
   * Validate a plan document against `dataseek.plan/1` and resolve what it
   * references (condition declarations, locks, stage schemas). Data problems
   * come back as diagnostics, never as throws.
   */
  validatePlan(planPath: string): Promise<PlanValidation> {
    return validatePlan(expandHome(planPath))
  }

  /**
   * Hash a condition document (canonical JSON, `notes` excluded).
   * @throws {@link EvalContractError} when the document violates
   * `dataseek.condition/1` — a hash of an invalid document means nothing.
   */
  hashCondition(condition: unknown): ConditionHash {
    const { errors, warnings } = conditionDiagnostics(condition)
    if (errors.length > 0) {
      throw new EvalContractError(
        `condition violates ${CONDITION_SCHEMA_ID}:\n${errors.map(e => `  - [${e.code}] ${e.message}`).join('\n')}`,
      )
    }
    return { sha: hashConditionDocument(condition), warnings }
  }

  /**
   * Hash a scoped home's config content (deny-listed files excluded, content
   * never leaves the digest).
   * @throws Error when the directory does not exist.
   */
  hashHome(homeDir: string): Promise<HomeHash> {
    return hashHome(homeDir)
  }

  /**
   * Build the paired report for a mission export bundle: `results.jsonl`
   * (one verdict per line) and `summary.md` (the four invariants first;
   * comparison and ranking only when all four are established). Writes into
   * `<bundleDir>/report/` unless `out` names another directory.
   * @throws Error when the directory is not a bundle (no readable run.json).
   */
  report(bundleDir: string, options: { out?: string } = {}): Promise<ReportWrite> {
    return writeEvalReport(expandHome(bundleDir), options.out === undefined ? options : { out: expandHome(options.out) })
  }

  /**
   * List the conditions a dataset repository declares, with their hashes and
   * readiness (lock present and matching, scoped home verified, unresolved
   * fields). Read-only: minting a condition is a file the agent drafts, and
   * turning one into a real scoped home is `conditions provision` (I4).
   * @param options - `repo` wins; otherwise the calling session's datasets
   *   binding decides, and its dataset whitelist is honoured — which datasets
   *   an agent may see is the human's decision, not the agent's.
   * @throws {@link EvalReadRefused} when no repository can be resolved, when
   *   the path is not a dataset repository, or when `dataset` is outside the
   *   session binding's whitelist.
   */
  conditions(options: { repo?: string; dataset?: string; session?: { id: string } } = {}): Promise<ConditionsReport> {
    const scope = this.resolveRepoScope(options)
    if (scope instanceof EvalReadRefused) return Promise.reject(scope)
    return listConditions(scope.repo, scope.datasets)
  }

  /**
   * Diff two condition declarations field by field — SHOWS, never chooses.
   * Two conditions that differ in exactly one field are a single-factor pair,
   * which is worth seeing; whether the pair is worth running depends on things
   * no file knows, so the verb stops at the facts and makes no
   * recommendation.
   * @param options - the two references (a condition id, or a path), plus the
   *   same repo / dataset / session resolution {@link EvalService.conditions}
   *   uses.
   * @throws {@link EvalReadRefused} when a repository or a side cannot be resolved.
   */
  conditionDiff(options: { a: string; b: string; repo?: string; dataset?: string; session?: { id: string } }): Promise<ConditionDiff> {
    const scope = this.resolveRepoScope(options)
    if (scope instanceof EvalReadRefused) return Promise.reject(scope)
    return diffConditions(scope.repo, options.a, options.b, scope.datasets)
  }

  /**
   * Provision one condition: resolve its `(harness, scope)` to a real scoped
   * home, refuse unless that scope holds a credential, check the declaration
   * against the scope's effective settings field by field, hash the home, and
   * write `conditions/<id>.lock.json` beside the declaration.
   *
   * The ONE writer of a condition lock. Writes go only into the working copy
   * `repo` names — nothing is committed, and the shared checkout stays
   * untouched.
   * @param conditionPath - path to the declaration (`~` expanded).
   * @param options - the working copy to write into.
   * @throws {@link EvalProvisionRefused} when the path, the declaration, or
   *   the local-agent facade makes provisioning impossible; a condition that
   *   simply is not ready comes back as a report with `written: false`.
   */
  provision(conditionPath: string, options: { repo: string }): Promise<ProvisionReport> {
    const localAgent = this.hosts?.get('localAgent') as LocalAgentFace | undefined
    if (localAgent === undefined) {
      return Promise.reject(new EvalProvisionRefused(
        'no localAgent service: provision reads the scoped home, its credential grade and its effective settings from the harness family'
        + ' — run it from a live session (/eval conditions provision <condition.json> --repo <working copy>), or mount the dsh-local-agent plugin',
      ))
    }
    return provisionCondition(conditionPath, { repo: options.repo, localAgent })
  }

  /**
   * Resolve which repository and which dataset sets a read verb may see:
   * `repo` wins; otherwise the calling session's datasets binding decides, and
   * its whitelist is honoured — which datasets an agent may see is the human's
   * decision, not the agent's.
   */
  private resolveRepoScope(
    options: { repo?: string; dataset?: string; session?: { id: string } },
  ): { repo: string; datasets: string[] | undefined } | EvalReadRefused {
    const binding = options.session === undefined
      ? undefined
      : (this.hosts?.get('datasets') as DatasetsBindingFace | undefined)?.binding(options.session)
    const repo = options.repo !== undefined && options.repo !== ''
      ? expandHome(options.repo)
      : binding?.repoPath
    if (repo === undefined || repo === '') {
      return new EvalReadRefused(
        'no dataset repository: pass repo, or ask the human to bind one for this session (/datasets bind <repoPath>)',
      )
    }
    const allowed = binding?.datasets
    if (options.dataset !== undefined && options.dataset !== '') {
      if (allowed !== undefined && !allowed.includes(options.dataset)) {
        return new EvalReadRefused(
          `dataset ${JSON.stringify(options.dataset)} is outside this session's binding (${allowed.join(', ')})`,
        )
      }
      return { repo, datasets: [options.dataset] }
    }
    return { repo, datasets: allowed === undefined ? undefined : [...allowed] }
  }

  /**
   * Project one run: the evaluation-relevant slice of `run.meta` plus a row
   * per cell (state, bucket, what the orchestrator last did, how often a
   * submission was rejected). Reads mission's ledger; writes nothing.
   * @param runId - the run to project.
   * @throws {@link EvalReadRefused} when the composition mounts no mission
   *   service — the run ledger lives there, so there is nothing to read.
   */
  runStatus(runId: string): RunStatusReport {
    const mission = this.hosts?.get('mission') as MissionReadFace | undefined
    if (mission === undefined) {
      // Named without its scope on purpose: a scoped `@khorsheed/…` string in
      // shipped code reads as a family edge to pack-dist, and this is a
      // sentence for a human, not a dependency.
      throw new EvalReadRefused(
        'no mission service: run records live in the mission ledger, so this composition cannot answer run '
        + 'status — mount the dsh-mission plugin',
      )
    }
    return runStatus(mission, runId)
  }

  /**
   * Generate a run template from a dataset-suite manifest (deterministic —
   * the same function `dsh-eval template` prints and the run loop writes
   * beside the plan).
   */
  generateTemplate(manifestPath: string, options?: GenerateTemplateOptions): Promise<GeneratedTemplate> {
    return generateTemplate(manifestPath, options)
  }

  /**
   * Run a plan: validate, snapshot, generate + write the template, expand
   * and order the matrix, then drive every cell to `archived` (or beyond
   * with `finalize`) and export the bundle. This is the body; `/eval run`
   * is its thin wrapper (decision 12).
   * @param planPath - path to a `dataseek.plan/1` document.
   * @param options - concurrency, dry-run, finalize, retry, export knobs.
   * @throws {@link EvalRunRefused} when the run is refused before executing.
   */
  run(planPath: string, options: RunOptions = {}): Promise<RunReport> {
    // Paths cross this seam from three faces — the slash command, the CLI,
    // and the Remote — and every one of them can carry a shell-unexpanded
    // `~`: a slash argument never saw a shell, and a CLI argument quoted to
    // survive one did not either. Expanding HERE means one rule for all
    // three instead of three call sites that must each remember.
    const plan = expandHome(planPath)
    const resolved: RunOptions = options.exportsDir === undefined
      ? options
      : { ...options, exportsDir: expandHome(options.exportsDir) }
    if (resolved.dryRun === true) {
      return runPlan(plan, resolved)
    }
    if (this.hosts === undefined) {
      return Promise.reject(new EvalRunRefused(
        'no host context: the run verb needs the datasets, mission, and localAgent services (the CLI supports --dry-run only)',
      ))
    }
    const datasets = this.hosts.get('datasets') as DatasetsFace | undefined
    const mission = this.hosts.get('mission') as MissionFace | undefined
    const localAgent = this.hosts.get('localAgent') as LocalAgentFace | undefined
    // Probed like the other three and just as optional: only a plan with a
    // `unit` segment needs it, and its absence is then a refusal that names
    // it — never a boot failure, never a silent fallback to the host path.
    const lab = this.hosts.get('lab') as LabFace | undefined
    const deps: Partial<RunDeps> & { stateRoot?: string } = {}
    if (datasets !== undefined) deps.datasets = datasets
    if (mission !== undefined) deps.mission = mission
    if (localAgent !== undefined) deps.localAgent = localAgent
    if (lab !== undefined) deps.lab = lab
    return runPlan(plan, resolved, deps)
  }

  /**
   * START a run in the background and answer immediately with its ids — the
   * default path of `/eval run` and the only path a CI runner has.
   *
   * The run is registered as an unowned `eval-run` job, so it outlives the
   * turn (and the session) that started it; its log lines are readable
   * through {@link runOutput} while it runs, and `job_kill` — through
   * {@link runCancel} — is its one cancellation entry.
   * @param planPath - path to a `dataseek.plan/1` document (`~` expanded).
   * @param options - the same run options `run` takes, minus the ones this
   *   owns (`runId`, `signal`).
   * @returns the job id, the minted run id, and the resolved parent session.
   * @throws {@link EvalJobsUnavailable} when the composition mounts no job
   *   registry (the caller then decides: `/eval run` waits synchronously and
   *   says so).
   */
  runStart(planPath: string, options: RunOptions & { cwd?: string; label?: string } = {}): Promise<EvalRunHandle> {
    const plan = expandHome(planPath)
    return this.jobs.start(
      runOptions => this.run(plan, runOptions),
      { ...options, label: options.label ?? `eval run ${plan}` },
    )
  }

  /**
   * One background run's JOB status — lifecycle, not ledger. The run's CELLS
   * are `runStatus(runId)`, which reads mission; this one answers "is the job
   * still going, and what did it end as".
   * @param jobId - the id {@link runStart} returned.
   * @returns the status, or undefined when this service never started it.
   */
  runJobStatus(jobId: string): EvalRunStatus | undefined {
    return this.jobs.status(jobId)
  }

  /**
   * Read a background run's log from a cursor (non-consuming — the
   * model-facing `job_output` tool has its own cursor).
   * @param jobId - the id {@link runStart} returned.
   * @param cursor - the cursor from the previous read; absent reads from the top.
   * @returns the lines after the cursor, or undefined for an unknown job.
   */
  runJobOutput(jobId: string, cursor?: number): EvalRunOutput | undefined {
    return this.jobs.output(jobId, cursor)
  }

  /**
   * Cancel a background run. The same lever `job_kill` pulls, and the only
   * one: every in-flight delegation is cancelled and the cells the cancel
   * caught stay mid-stage, which is what makes `finalize` call them
   * `interrupted`.
   * @param jobId - the id {@link runStart} returned.
   * @returns what the registry did, or `unknown-job`.
   */
  runJobCancel(jobId: string): 'requested' | 'already-finished' | 'unknown-job' {
    return this.jobs.cancel(jobId)
  }

  /** Every background run this service started, in start order. */
  runJobList(): EvalRunStatus[] {
    return this.jobs.list()
  }

  /**
   * Finalize a run that already stopped at `archived`: walk every archived
   * cell through `archived → releasable → released` (the same gate
   * `/eval run --finalize` takes) and report every cell that was not
   * archived with its state. A gate refusal is recorded against that cell,
   * never forced — the re-entry point pilot A had to improvise with
   * per-cell `dsh-mission transition` calls (G13).
   * @param runId - the run to finalize.
   * @param options - caller tag and progress sink.
   * @throws {@link EvalFinalizeRefused} when the composition mounts no
   *   mission service, or the run cannot be projected.
   */
  finalize(runId: string, options: FinalizeOptions = {}): Promise<FinalizeReport> {
    const mission = this.hosts?.get('mission') as MissionFinalizeFace | undefined
    if (mission === undefined) {
      return Promise.reject(new EvalFinalizeRefused(
        'no mission service: the release gate lives in the mission ledger, so this composition cannot finalize a run '
        + '— mount the dsh-mission plugin, or use the dsh-eval CLI (it drives the dsh-mission CLI in a child process)',
      ))
    }
    return finalizeRun(mission, runId, options)
  }
}

export { EvalRunRefused } from './run.ts'
export type { RunOptions, RunReport, RunCellReport, RunSubset } from './run.ts'
export { EvalFinalizeRefused } from './finalize.ts'
export type { FinalizeOptions, FinalizeReport, FinalizeCellOutcome, FinalizeSkipCategory } from './finalize.ts'
export { EvalReadRefused } from './read.ts'
export type { ConditionDiff, ConditionFieldDiff, ConditionsReport, ConditionSummary, RunCellStatus, RunStatusReport } from './read.ts'
export { EvalProvisionRefused } from './provision.ts'
export type { ProvisionReport } from './provision.ts'
export type { ProvisionCheck } from './effective.ts'
