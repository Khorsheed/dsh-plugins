/**
 * The eval service face: the offline verbs the CLI shares, plus — since I2 —
 * the two orchestration verbs: `generateTemplate` (manifest → run template)
 * and `run` (the stage-one/two run loop). The offline surface is stable; the
 * run verb resolves the datasets / mission / localAgent services through the
 * host at call time and refuses loudly naming whatever is missing.
 * @module @khorsheed/dsh-eval
 */
import { hashConditionDocument, hashHome, type HomeHash } from './hash.ts'
import { CONDITION_SCHEMA_ID } from './schema.ts'
import { conditionDiagnostics, validatePlan, type EvalDiagnostic, type PlanValidation } from './validate.ts'
import { generateTemplate, type GeneratedTemplate, type GenerateTemplateOptions } from './template.ts'
import { runPlan, EvalRunRefused, type RunDeps, type RunOptions, type RunReport } from './run.ts'
import type { DatasetsFace, LocalAgentFace, MissionFace } from './faces.ts'

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
