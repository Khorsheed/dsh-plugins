/**
 * `@khorsheed/dsh-eval` — the web-eval orchestrator: the dataseek contract
 * schemas (condition / plan / verdict), the plan and condition validator,
 * deterministic condition & scoped-home hashing, run-template generation
 * from a dataset-suite manifest, and the stage-one/two run loop.
 *
 * The run's START is a human action (decision 1): the `/eval run` slash
 * command in the web-eval instance — the invoking session becomes the
 * originSession and every delegation's parent. There is deliberately no
 * run-class model tool; the `dsh-eval` CLI is dry-run-only (outside a
 * session there is no live parent agent). The three upstream services
 * (datasets / mission / localAgent) are probed at run time with ctx.get and
 * a missing one is a refusal naming it, never a boot failure — the plugin
 * itself only requires the command registry for the slash face.
 *
 * @module @khorsheed/dsh-eval
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { EvalService } from './service.ts'
import { registerEvalSlash } from './slash.ts'
import { registerEvalTools } from './tools.ts'

/** Plugin configuration. */
export interface EvalConfig {
  /**
   * Which model tools to register. `all` (the default) registers the three
   * READ tools; `none` registers none and the plugin keeps only its slash,
   * CLI, and service faces. There is no finer grouping because there is
   * nothing to group: this package registers no write tool at all — starting
   * a run is a human act and the write verbs are the orchestrator's service
   * face (README «工具按域开放»).
   */
  tools?: 'all' | 'none'
}

export const Config: z<EvalConfig> = z.object({
  tools: z.union([z.const('all'), z.const('none')]).default('all'),
})

/** Cordis plugin name used by loader diagnostics. */
export const name = 'eval'

/** Required services: the command registry (the `/eval` slash face). */
export const inject = ['commands']

/** The narrow prompt-section registry surface this plugin opportunistically uses. */
interface PromptSections {
  section(section: { name: string; order: number; text: string }): () => void
}

/** Cross-call guidance, registered beside the tools it describes. */
const EVAL_PROMPT = `The eval_* tools are READ ONLY, all three of them. eval_conditions lists the conditions (subjects under test) a dataset repository declares, each with its hash and readiness — a lock that exists and still matches, and which contract fields are still null. eval_plan_validate checks a dataseek.plan/1 document and reports errors (the plan cannot run) and warnings (not resolved yet). eval_run_status projects one run: the run.meta digest and a row per cell with its state, bucket, and what the orchestrator last did to it. Starting a run is a HUMAN act: the person runs /eval run <plan.json> in this session, and that session becomes the parent of every delegation — there is no run tool and you must not look for one. Your part is drafting and reading: propose conditions and plans as data files (copy an existing condition and change exactly ONE field), validate them, and hand them to the human for approval; the orchestrator does the executing, and the write verbs (materialize, submit, transition, annotate, archive, export) are its service face, not yours.`

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** NOT named `eval`: a ctx property of that name shadows the global
     * `eval` inside the loader's `with (ctx) { return eval(expr) }` !!js
     * evaluation and crashes every composition that mounts this plugin. */
    dshEval: EvalService
  }
}

/**
 * Mount the eval service, its slash command, and (unless `tools: 'none'`) the
 * three read tools.
 * @param ctx - plugin context.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: EvalConfig = {}): void {
  const service = new EvalService(ctx)
  ctx.provide('dshEval', service)
  registerEvalSlash(ctx, service)
  if (config.tools === 'none') return
  // Deferred injection, NOT an apply-time `ctx.get('tools')` probe: the probe
  // races the tools registry's own mount order on a real composition tree and
  // loses silently — the tools would simply never register, and nothing would
  // say so (room and worktrees both shipped this fix). `ctx.inject` fires when
  // the registry appears and never fires in a composition without one, so a
  // tools-less composition keeps the slash, CLI, and service faces and never
  // fails boot.
  ctx.inject(['tools'], (toolsCtx) => {
    registerEvalTools(toolsCtx, service)
    // The guidance describes those tools, so it rides with them — and through
    // the same deferred door, for the same reason.
    toolsCtx.inject(['systemPrompt'], (promptCtx) => {
      const sections = promptCtx.get('systemPrompt') as PromptSections | undefined
      sections?.section({ name: 'tool:eval', order: 114, text: EVAL_PROMPT })
    })
  })
}

export { EvalService, EvalContractError } from './service.ts'
export { EvalRunRefused } from './service.ts'
export { EvalFinalizeRefused, finalizeRun, skipCategoryOf, FINALIZE_FROM_STATE } from './finalize.ts'
export type { FinalizeOptions, FinalizeReport, FinalizeCellOutcome, FinalizeSkipCategory } from './finalize.ts'
export { missionCliFace, MissionCliError, parseMissionRow } from './mission-cli.ts'
export type { MissionCliOptions } from './mission-cli.ts'
export { checkReadiness, READINESS_PROMPT, DEFAULT_READINESS_TIMEOUT_MS } from './readiness.ts'
export type { ReadinessRecord, ReadinessSubject, ReadinessInput } from './readiness.ts'
export { awaitObservedModel, DEFAULT_READBACK_WAIT_MS } from './readback.ts'
export { EvalReadRefused } from './read.ts'
export type { ConditionHash, RunOptions, RunReport, RunCellReport, RunSubset } from './service.ts'
export type { PlanValidation, ConditionResolution, EvalDiagnostic, ConditionDiagnostics, ConditionReadiness } from './validate.ts'
export { conditionDiagnostics, resolveConditionReadiness, unresolvedFields, validatePlan } from './validate.ts'
export { listConditions, runStatus } from './read.ts'
export type { ConditionsReport, ConditionSummary, RunCellStatus, RunStatusReport } from './read.ts'
export { registerEvalTools, EVAL_TOOL_NAMES } from './tools.ts'
export { canonicalJson, hashConditionDocument, hashHome } from './hash.ts'
export type { HomeHash } from './hash.ts'
export {
  buildDeidentifyRules, buildJudgePrompt, collectProbes, deidentify, itemVerifyRoot,
  llmDraftCriteria, mergeReplacements, pickRubricPath, probePaths,
  DATASET_VERIFY_ROOT, DEFAULT_JUDGE_SAMPLES, HARNESS_ALIASES, JUDGE_MATERIAL_FILES,
  PROBE_EXIT_NOT_APPLICABLE,
} from './judge.ts'
export type {
  Deidentified, DeidentifyRule, JudgeSampleRecord, ProbeOutcome, ProbeRef, ProbeStatus,
  ReplacementCount, ResolvedJudge, RubricCriterion, VerdictAnchor,
} from './judge.ts'
export { analyzeBundle, writeEvalReport, parseMissionId } from './report.ts'
export type {
  ConditionEfficiency,
  EvalReport,
  ExcludedCells,
  FactorPair,
  InvariantCheck,
  JudgeConsistency,
  NegativeHit,
  PairComparison,
  PairTaskDelta,
  ReportRow,
  ReportWrite,
  RubricPolarity,
  VerdictRatio,
} from './report.ts'
export {
  buildRubricWeightTable, readRubricWeightTable, rubricWeightRows, writeRubricWeightTable,
  RUBRIC_WEIGHTS_PATH, RUBRIC_WEIGHTS_SCHEMA,
} from './weights.ts'
export type { RubricWeightRow, RubricWeightTable } from './weights.ts'
export { bootstrapMeanCi, cohenKappa, fnv1a, mean, mulberry32, allEqualRate } from './stats.ts'
export { generateTemplate, generateTemplateFromManifest, stageStateName, ARCHIVE_FILE_CHECK } from './template.ts'
export type { GeneratedTemplate, GenerateTemplateOptions, TemplateMissionDoc, TemplateTransitionDoc, TemplateGuardDoc } from './template.ts'
export { parseSuiteManifest, loadManifest } from './manifest.ts'
export type { SuiteManifest, ManifestStage, ManifestOutputSchema } from './manifest.ts'
export { expandMatrix, orderCells, missionIdFor } from './matrix.ts'
export type { EvalCell } from './matrix.ts'
export { runPlan, evalVersion, defaultStateRoot } from './run.ts'
export type { RunSubset as RunSubsetRecord } from './run.ts'
export type { DatasetsBindingFace, DatasetsFace, MissionFace, MissionFinalizeFace, MissionReadFace, MissionStatusRow, LocalAgentFace, DelegationRun, DelegationResult, EvalDelegationOptions, MissionSubmitFile } from './faces.ts'
export { handleEvalCommand, registerEvalSlash } from './slash.ts'
export {
  CONDITION_SCHEMA,
  CONDITION_SCHEMA_ID,
  EXPECTED_NS_VALUES,
  LOCK_SCHEMA,
  LOCK_SCHEMA_ID,
  PERMISSIONS_BY_HARNESS,
  PERMISSION_VALUES,
  PLAN_SCHEMA,
  PLAN_SCHEMA_ID,
  VERDICT_SCHEMA,
  VERDICT_SCHEMA_ID,
  jsonEquals,
  schemaSubsetProblems,
  validateJson,
} from './schema.ts'
