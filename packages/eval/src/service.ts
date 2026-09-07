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
import {
  EvalReadRefused,
  listConditions,
  runStatus,
  type ConditionsReport,
  type RunStatusReport,
} from './read.ts'
import type { DatasetsBindingFace, DatasetsFace, LocalAgentFace, MissionFace, MissionReadFace } from './faces.ts'

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
  constructor(private readonly hosts?: { get(name: string): unknown }) {}

  /**
   * Validate a plan document against `dataseek.plan/1` and resolve what it
   * references (condition declarations, locks, stage schemas). Data problems
   * come back as diagnostics, never as throws.
   */
  validatePlan(planPath: string): Promise<PlanValidation> {
    return validatePlan(planPath)
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
    return writeEvalReport(bundleDir, options)
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
    const binding = options.session === undefined
      ? undefined
      : (this.hosts?.get('datasets') as DatasetsBindingFace | undefined)?.binding(options.session)
    const repo = options.repo !== undefined && options.repo !== ''
      ? expandHome(options.repo)
      : binding?.repoPath
    if (repo === undefined || repo === '') {
      return Promise.reject(new EvalReadRefused(
        'no dataset repository: pass repo, or ask the human to bind one for this session (/datasets bind <repoPath>)',
      ))
    }
    const allowed = binding?.datasets
    if (options.dataset !== undefined && options.dataset !== '') {
      if (allowed !== undefined && !allowed.includes(options.dataset)) {
        return Promise.reject(new EvalReadRefused(
          `dataset ${JSON.stringify(options.dataset)} is outside this session's binding (${allowed.join(', ')})`,
        ))
      }
      return listConditions(repo, [options.dataset])
    }
    return listConditions(repo, allowed)
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
    if (options.dryRun === true) {
      return runPlan(planPath, options)
    }
    if (this.hosts === undefined) {
      return Promise.reject(new EvalRunRefused(
        'no host context: the run verb needs the datasets, mission, and localAgent services (the CLI supports --dry-run only)',
      ))
    }
    const datasets = this.hosts.get('datasets') as DatasetsFace | undefined
    const mission = this.hosts.get('mission') as MissionFace | undefined
    const localAgent = this.hosts.get('localAgent') as LocalAgentFace | undefined
    const deps: Partial<RunDeps> & { stateRoot?: string } = {}
    if (datasets !== undefined) deps.datasets = datasets
    if (mission !== undefined) deps.mission = mission
    if (localAgent !== undefined) deps.localAgent = localAgent
    return runPlan(planPath, options, deps)
  }
}

export { EvalRunRefused } from './run.ts'
export type { RunOptions, RunReport, RunCellReport } from './run.ts'
export { EvalReadRefused } from './read.ts'
export type { ConditionsReport, ConditionSummary, RunCellStatus, RunStatusReport } from './read.ts'
