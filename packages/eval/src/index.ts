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
 * they live in the `./tool` composition row `@khorsheed/dsh-eval/tool`, which an agent preset
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
import type { ExecutionHomePort, ScopedHomeEvidenceFace } from './faces.ts'
/** Cordis plugin name used by loader diagnostics. */
export const name = 'eval'

/**
 * No required services: the `/eval` slash face moved to the companion
 * `@khorsheed/dsh-eval/tool` row (its registration is what needed the
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
 * The optional plugin config. Unset everywhere keeps the legacy
 * DSH_HOME-derived behavior byte-identical.
 */
export interface EvalConfig {
  /**
   * An instance-bound eval state root: experiments, the condition library and
   * the per-run cell directories live under it instead of
   * `$DSH_HOME/state/eval`, and a Remote `runStart` stateRoot must resolve
   * under it. Nothing global is mutated — two instances mounted with two
   * roots see disjoint state.
   */
  readonly stateRoot?: string
  /**
   * The execution target's scoped-home evidence face: provision, the
   * readiness gate and the freshness checks consume the target's answers
   * (home fingerprint, credential grade, effective settings, roster
   * read-back, preset-copy digest) as plain data instead of reading local
   * directories. Fail-closed by construction — a missing or invalid answer
   * lands where the corresponding local failure lands today. Absent, the
   * local facade/directory reads behave byte-identically.
   */
  readonly evidence?: ScopedHomeEvidenceFace
  /**
   * The execution-home port: the unit path's scoped-home resolution,
   * availability verification and mount planning (`bind` or `volume`) come
   * from the execution target; no management-host path is derived or
   * consulted anywhere in the unit segment. When both this and `evidence`
   * are mounted, the two are pinned by `homeIdentity` — a mismatch refuses
   * the run before any unit is acquired. Absent, the unit path is the local
   * `homeDir` + credential-dir check + `bind` mount, byte-identical.
   */
  readonly executionHome?: ExecutionHomePort
}

/**
 * Mount the eval service, its Remote face, and the run-job controller. The
 * `/eval` slash command and the model tools are deliberately NOT registered
 * here: both moved to the `./tool` composition row `@khorsheed/dsh-eval/tool`, which an
 * agent preset composes per session.
 * @param ctx - plugin context.
 * @param config - optional instance binding; every field is additive and the
 *   row boots without it.
 */
export function apply(ctx: Context, config: EvalConfig = {}): void {
  const service = new EvalService(ctx, config)
  ctx.provide('dshEval', service)
  // The borrowed Context's teardown IS this instance's disposal: the run jobs
  // it started are cancelled through their own AbortSignal, and every public
  // verb refuses coded afterwards.
  ctx.effect(() => () => { service.dispose() }, 'eval: dispose on context teardown')
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

export { EvalService, EvalContractError, EvalDisposedError } from './service.ts'
export { EvalRunRefused } from './service.ts'
export { EvalFinalizeRefused, finalizeRun, skipCategoryOf, FINALIZE_FROM_STATE } from './run/finalize.ts'
export type { FinalizeOptions, FinalizeReport, FinalizeCellOutcome, FinalizeSkipCategory } from './run/finalize.ts'
export { MISSION_LIST_SCHEMA, missionCliFace, MissionCliError, oldMissionCliHint, parseMissionList } from './run/mission-cli.ts'
export type { MissionCliOptions } from './run/mission-cli.ts'
export { checkReadiness, READINESS_PROMPT, DEFAULT_READINESS_TIMEOUT_MS } from './run/readiness.ts'
export type { ReadinessRecord, ReadinessSubject, ReadinessInput, ReadinessUnit } from './run/readiness.ts'
export { capabilityRefusal } from './run/readiness.ts'
export { awaitObservedModel, DEFAULT_READBACK_WAIT_MS } from './run/readback.ts'
export { EvalReadRefused } from './read.ts'
/** The target-side evidence producer: the ScopedHomeEvidenceFace's answers, computed where the scoped home lives. */
export { produceScopedHomeEvidence } from './evidence.ts'
export type { ProducedScopedHomeEvidence } from './evidence.ts'
/** The narrow write into one experiment's analysis/ (the analysis draft's door; I5·T39 · G16, T73). */
export { ANALYSIS_WRITE_PREFIX, EvalWriteRefused, resolveAnalysisWrite, writeAnalysisFile } from './design/analysis-write.ts'
export type { AnalysisWriteResult, AnalysisWriteTarget } from './design/analysis-write.ts'
/** Experiments as deployment-level objects, and the condition library beside them (T73). */
export {
  conditionLibraryDir, conditionLibraryRoot, createExperiment, EvalExperimentError, EXPERIMENT_ID_RE, EXPERIMENT_META_SCHEMA,
  experimentIdOfPlanPath, experimentsRoot, listExperimentRecords, mintExperimentId, readExperiment,
} from './design/experiment-store.ts'
export type { CreateExperimentInput, ExperimentDataset, ExperimentMeta, ExperimentRecord } from './design/experiment-store.ts'
export { decideDatasetVersion, DatasetVersionRefused } from './design/dataset-version.ts'
export type { DatasetVersionCandidate, DatasetVersionDecision, DatasetVersionFace } from './design/dataset-version.ts'
export { EvalImportRefused, importExperiments, parseImportSource } from './design/import.ts'
export type { ImportedExperiment, ImportRegistryFace, ImportReport } from './design/import.ts'
export { listAnalysisFiles, readExperimentArtifact } from './design/experiment-artifact.ts'
export { answerFileName, answerHandle, composeExperimentGet, isLocalPath } from './design/experiment-get.ts'
export type { EvalAnswerEntry, EvalAnswerFile, EvalExperimentGetView, ExperimentGetInput } from './design/experiment-get.ts'
/** The run-level export note: where a run's bundle went, and when (I5·T53 / G17). */
export { EXPORT_NOTE_KIND, readExportState, recordExportNote, recordExportNoteOn, reexportDirOf } from './report/export-note.ts'
export type { ConditionHash, RunOptions, RunReport, RunCellReport, RunSubset } from './service.ts'
export type {
  PlanValidation, ConditionResolution, EvalDiagnostic, ConditionDiagnostics, ConditionReadiness, LockedCapabilities,
} from './contract/validate.ts'
export { conditionDiagnostics, resolveConditionReadiness, unresolvedFields, validatePlan } from './contract/validate.ts'
export { conditionFactors, conditionLeaves, listConditions, runCells, runStatus } from './read.ts'
export type {
  ConditionsReport, ConditionSummary, RunCellDetail, RunCellRefs, RunCellsQuery, RunCellsReport, RunCellStatus, RunLedgerStatus, RunStatusReport,
} from './read.ts'
export { deriveExperimentStatus, experimentDetail, isJudgedOrBeyond, isReleased, listExperiments, runsForItem } from './design/experiments.ts'
export type { ExperimentsInput, ExperimentStatusInput } from './design/experiments.ts'
export { attemptDirOf, materializationShaOf, probeRunsOf, runCellDetail, summarizeAnnotations } from './cell-detail.ts'
export { DEFAULT_STUCK_MS, pivotMatrix, repDot } from './matrix-view.ts'
export type { MatrixInput, MatrixInputCell } from './matrix-view.ts'
export { conditionDiffView, conditionsView, reviewPlan } from './design/review.ts'
export { evalToolDefinitions, EVAL_TOOL_NAMES } from './tool-definition.ts'
export { canonicalJson, hashConditionDocument, hashHome } from './contract/hash.ts'
export type { HomeHash } from './contract/hash.ts'
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
} from './judge/judge.ts'
export type {
  Deidentified, DeidentifyRule, JudgeSampleRecord, ProbeOutcome, ProbeRef, ProbeStatus,
  RegisterEntry, ReplacementCount, ResolvedJudge, RubricCriterion, VerdictAnchor,
} from './judge/judge.ts'
export { cellTicket, judgeQueueView, resolveTicket, writeHumanFinal } from './judge/judge-bench.ts'
export type { HumanFinalInput, JudgeQueueInput } from './judge/judge-bench.ts'
export { analyzeBundle, judgeConsistencyOf, writeEvalReport, parseMissionId } from './report/report.ts'
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
} from './report/report.ts'
export {
  buildRubricWeightTable, readRubricWeightTable, rubricWeightRows, writeRubricWeightTable,
  RUBRIC_WEIGHTS_PATH, RUBRIC_WEIGHTS_SCHEMA,
} from './judge/weights.ts'
export type { RubricWeightRow, RubricWeightTable } from './judge/weights.ts'
export { bootstrapMeanCi, cohenKappa, fnv1a, mean, mulberry32, allEqualRate } from './report/stats.ts'
export { generateTemplate, generateTemplateFromManifest, stageStateName, ARCHIVE_FILE_CHECK } from './contract/template.ts'
export type { GeneratedTemplate, GenerateTemplateOptions, TemplateMissionDoc, TemplateTransitionDoc, TemplateGuardDoc } from './contract/template.ts'
export { parseSuiteManifest, loadManifest } from './contract/manifest.ts'
export type { SuiteManifest, ManifestStage, ManifestOutputSchema } from './contract/manifest.ts'
export { expandMatrix, orderCells, missionIdFor } from './run/matrix.ts'
export type { EvalCell } from './run/matrix.ts'
export { runPlan, defaultStateRoot } from './run/run.ts'
export { evalVersion } from './eval-version.ts'
export {
  acquireSpecFor, checkCredentialsDir, conditionOwnedComponents, conditionUnitDiagnostics, conditionUnitOf,
  describeAcquireSpec, environmentClassComponents, planScopedHomeMount, planUnitOf, resolveCellUnit, unitUid,
  DSH_CONTAINER_NODE_OPTIONS, UNIT_VERDICTS_DIR, UNIT_WORKSPACE,
} from './run/unit.ts'
export type { CellUnitPlan, ConditionOwnedComponents, ConditionUnitDecl, CredentialsCheck, PlanUnitDecl } from './run/unit.ts'
export { discardDir, hostProbeExecutor, unitProbeExecutor } from './run/probe-exec.ts'
export type { ProbeExecution, ProbeExecResult, ProbeExecutor } from './run/probe-exec.ts'
export type { RunSubset as RunSubsetRecord } from './run/run.ts'
export type {
  DatasetsFace, DatasetsRegistryFace, MissionActionFace, MissionAnnotateFace, MissionExportFace,
  MissionFace, MissionFinalizeFace, MissionReadFace, MissionRunListFace, MissionStatusRow,
  LocalAgentFace, DelegationRun, DelegationResult, EvalDelegationOptions, MissionSubmitFile,
  LocalAgentCredentialGrade, LocalAgentEffectiveSettingsFace,
  ScopedHomeEvidenceFace, ScopedHomeHashEvidence, PresetSnapshotEvidence,
  CapabilityCompositionEvidence, CapabilitySectionCompleteness,
  ExecutionHomePort, ScopedHomePlanRequest, ScopedHomePlan,
  LabFace, LabAcquireSpec, LabFingerprintComponents, LabMountSpec, LabPopulateResult, LabResourceLimits,
  LabUnitInfo, LabVerifyResult,
} from './faces.ts'
export { CAPABILITY_COMPOSITION_FORMAT } from './faces.ts'
export { compositionFreshnessRefusal, incompleteSections, readCapabilityCompositionShape } from './capability-composition.ts'
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
} from './contract/schema.ts'
