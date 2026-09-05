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
import { EvalService } from './service.ts'
import { registerEvalSlash } from './slash.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'eval'

/** Required services: the command registry (the `/eval` slash face). */
export const inject = ['commands']

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** NOT named `eval`: a ctx property of that name shadows the global
     * `eval` inside the loader's `with (ctx) { return eval(expr) }` !!js
     * evaluation and crashes every composition that mounts this plugin. */
    dshEval: EvalService
  }
}

/**
 * Mount the eval service and its slash command.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const service = new EvalService(ctx)
  ctx.provide('dshEval', service)
  registerEvalSlash(ctx, service)
}

export { EvalService, EvalContractError } from './service.ts'
export { EvalRunRefused } from './service.ts'
export type { ConditionHash, RunOptions, RunReport, RunCellReport } from './service.ts'
export type { PlanValidation, ConditionResolution, EvalDiagnostic, ConditionDiagnostics } from './validate.ts'
export { conditionDiagnostics, validatePlan } from './validate.ts'
export { canonicalJson, hashConditionDocument, hashHome } from './hash.ts'
export type { HomeHash } from './hash.ts'
export { generateTemplate, generateTemplateFromManifest, stageStateName, ARCHIVE_FILE_CHECK } from './template.ts'
export type { GeneratedTemplate, GenerateTemplateOptions, TemplateMissionDoc, TemplateTransitionDoc, TemplateGuardDoc } from './template.ts'
export { parseSuiteManifest, loadManifest } from './manifest.ts'
export type { SuiteManifest, ManifestStage, ManifestOutputSchema } from './manifest.ts'
export { expandMatrix, orderCells, missionIdFor } from './matrix.ts'
export type { EvalCell } from './matrix.ts'
export { runPlan, evalVersion, defaultStateRoot } from './run.ts'
export type { DatasetsFace, MissionFace, LocalAgentFace, DelegationRun, DelegationResult, EvalDelegationOptions, MissionSubmitFile } from './faces.ts'
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
