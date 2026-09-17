/**
 * `@khorsheed/dsh-eval` — the web-eval orchestrator: the dataseek contract
 * schemas (condition / plan / verdict), the plan and condition validator,
 * deterministic condition & scoped-home hashing, run-template generation
 * from a dataset-suite manifest, and the stage-one/two run loop.
 *
 * The run's START is a human action (decision 1): the `/eval run` slash
 * command in the web-eval instance — the invoking session becomes the
 * originSession and every delegation's parent. There is deliberately no
 * run-class model tool. The three READ tools are not registered here either:
 * they live in the companion `@khorsheed/dsh-eval-tool`, which an agent preset
 * composes per session (its own config grants them or not) — and since the
 * preset-visibility rollout (A3) the `/eval` slash REGISTRATION lives there
 * too: only a preset naming the companion row shows the command to its
 * sessions; the handler and definition stay in `./slash.ts` for the companion
 * to register. The `dsh-eval` CLI
 * is dry-run-only (outside a session there is no live parent agent). The three upstream services
 * (datasets / mission / localAgent) are probed at run time with ctx.get and
 * a missing one is a refusal naming it, never a boot failure — the plugin
 * itself requires no host service at all.
 *
 * @module @khorsheed/dsh-eval
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the jobs Context merge in so the controller attach below
// type-checks; the service itself is deferred-injected, never required.
import type {} from '@deepseek-ai/dsh-jobs'
import { EvalRemoteService } from './remote.ts'
import { EvalService } from './service.ts'
/** Cordis plugin name used by loader diagnostics. */
export const name = 'eval'

/**
 * No required services: the `/eval` slash face moved to the companion
 * `@khorsheed/dsh-eval-tool` row (its registration is what needed the
 * command registry), the run-job controller attaches through deferred
 * injection, and the upstream evaluation services are probed per call.
 */
export const inject = []

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** NOT named `eval`: a ctx property of that name shadows the global
     * `eval` inside the loader's `with (ctx) { return eval(expr) }` !!js
     * evaluation and crashes every composition that mounts this plugin. */
    dshEval: EvalService
  }
}

/**
 * Mount the eval service, its Remote face, and the run-job controller. The
 * `/eval` slash command and the model tools are deliberately NOT registered
 * here: both moved to the companion `@khorsheed/dsh-eval-tool`, which an
 * agent preset composes per session.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const service = new EvalService(ctx)
  ctx.provide('dshEval', service)
  // The Typert Remote face (wire namespace `dshEval`): start / watch / stop a
  // run from outside a browser — the CI door. It mounts through the plugin
  // seam like every other Remote, so a composition without the Typert
  // gateway simply never registers it.
  ctx.plugin(EvalRemoteService)
  // A producer may register work only while a job CONTROLLER serves the
  // owner, and a run's job is deliberately UNOWNED (it has to outlive the
  // session that started it), which only a controller attached at this
  // scope serves. Attaching one here is not a formality: this package IS the
  // controller for its runs — `runJobStatus` / `runJobOutput` /
  // `runJobCancel` on the service, and the four Remote verbs, are its read
  // and stop surface. Deferred, so a composition without a job registry
  // simply never attaches one and `/eval run` waits in the turn instead.
  ctx.inject(['jobs'], (jobsCtx) => {
    jobsCtx.effect(() => jobsCtx.jobs.attachController('eval-run'), 'eval: job controller')
  })
}

export { EvalService, EvalContractError } from './service.ts'
export { EvalRunRefused } from './service.ts'
export { EvalFinalizeRefused, finalizeRun, skipCategoryOf, FINALIZE_FROM_STATE } from './finalize.ts'
export type { FinalizeOptions, FinalizeReport, FinalizeCellOutcome, FinalizeSkipCategory } from './finalize.ts'
export { missionCliFace, MissionCliError, parseMissionRow } from './mission-cli.ts'
export type { MissionCliOptions } from './mission-cli.ts'
export { checkReadiness, READINESS_PROMPT, DEFAULT_READINESS_TIMEOUT_MS } from './readiness.ts'
export type { ReadinessRecord, ReadinessSubject, ReadinessInput, ReadinessUnit } from './readiness.ts'
export { capabilityRefusal } from './readiness.ts'
export { awaitObservedModel, DEFAULT_READBACK_WAIT_MS } from './readback.ts'
export { EvalReadRefused } from './read.ts'
export type { ConditionHash, RunOptions, RunReport, RunCellReport, RunSubset } from './service.ts'
export type {
  PlanValidation, ConditionResolution, EvalDiagnostic, ConditionDiagnostics, ConditionReadiness, LockedCapabilities,
} from './validate.ts'
export { conditionDiagnostics, resolveConditionReadiness, unresolvedFields, validatePlan } from './validate.ts'
export { conditionFactors, conditionLeaves, listConditions, runCells, runStatus } from './read.ts'
export type {
  ConditionsReport, ConditionSummary, RunCellDetail, RunCellRefs, RunCellsQuery, RunCellsReport, RunCellStatus, RunStatusReport,
} from './read.ts'
export { deriveExperimentStatus, experimentDetail, isJudgedOrBeyond, isReleased, listExperiments, runsForItem } from './experiments.ts'
export type { ExperimentsInput, ExperimentStatusInput } from './experiments.ts'
export { attemptDataDir, materializationShaOf, probeRunsOf, runCellDetail, summarizeAnnotations } from './cell-detail.ts'
export { DEFAULT_STUCK_MS, pivotMatrix, repDot } from './matrix-view.ts'
export type { MatrixInput, MatrixInputCell } from './matrix-view.ts'
export { conditionDiffView, conditionsView, reviewPlan } from './review.ts'
export { evalToolDefinitions, EVAL_TOOL_NAMES } from './tool.ts'
export { canonicalJson, hashConditionDocument, hashHome } from './hash.ts'
export type { HomeHash } from './hash.ts'
export { EvalProvisionRefused, loginCommandFor, provisionCondition } from './provision.ts'
export type {
  CapabilityProbe, CapabilityProbeInput, ProvisionedCapabilities, ProvisionOptions, ProvisionReport,
} from './provision.ts'
export {
  buildDeidentifyRules, buildJudgePrompt, collectProbes, deidentify, humanCriteria, itemLayerPath, itemProbeCwd,
  itemVerifyRoot, llmDraftCriteria, mergeReplacements, pickChecklistPath, pickRubricPath, probePaths,
  registerEntriesOf, registerPatternMatches, rubricCriteria,
  DATASET_VERIFY_ROOT, DEFAULT_JUDGE_SAMPLES, HARNESS_ALIASES, JUDGE_MATERIAL_FILES,
  PROBE_EXIT_NOT_APPLICABLE,
} from './judge.ts'
export type {
  Deidentified, DeidentifyRule, JudgeSampleRecord, ProbeOutcome, ProbeRef, ProbeStatus,
  RegisterEntry, ReplacementCount, ResolvedJudge, RubricCriterion, VerdictAnchor,
} from './judge.ts'
export { cellTicket, judgeQueueView, resolveTicket, writeHumanFinal } from './judge-bench.ts'
export type { HumanFinalInput, JudgeQueueInput } from './judge-bench.ts'
export { analyzeBundle, judgeConsistencyOf, writeEvalReport, parseMissionId } from './report.ts'
export type {
  ConditionEfficiency,
  EvalReport,
  ExcludedCells,
  FactorPair,
  InvariantCheck,
  JudgeConsistency,
  JudgeConsistencyCell,
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
export {
  acquireSpecFor, checkCredentialsDir, conditionOwnedComponents, conditionUnitDiagnostics, conditionUnitOf,
  describeAcquireSpec, environmentClassComponents, planUnitOf, resolveCellUnit, unitUid,
  DSH_CONTAINER_NODE_OPTIONS, UNIT_VERDICTS_DIR, UNIT_WORKSPACE,
} from './unit.ts'
export type { CellUnitPlan, ConditionOwnedComponents, ConditionUnitDecl, CredentialsCheck, PlanUnitDecl } from './unit.ts'
export { discardDir, hostProbeExecutor, unitProbeExecutor } from './probe-exec.ts'
export type { ProbeExecution, ProbeExecResult, ProbeExecutor } from './probe-exec.ts'
export type { RunSubset as RunSubsetRecord } from './run.ts'
export type {
  DatasetsBindingFace, DatasetsFace, MissionActionFace, MissionAnnotateFace, MissionExportRemoteFace,
  MissionFace, MissionFinalizeFace, MissionReadFace, MissionRunListFace, MissionStatusRow,
  LocalAgentFace, DelegationRun, DelegationResult, EvalDelegationOptions, MissionSubmitFile,
  LabFace, LabAcquireSpec, LabFingerprintComponents, LabMountSpec, LabPopulateResult, LabResourceLimits,
  LabUnitInfo, LabVerifyResult,
} from './faces.ts'
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
