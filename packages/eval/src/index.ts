/**
 * `@khorsheed/dsh-eval` — offline half of the web-eval orchestrator: the
 * dataseek contract schemas (condition / plan / verdict), the plan and
 * condition validator, and deterministic condition & scoped-home hashing.
 * Declares and checks; never executes or judges.
 *
 * The plugin is a bare mount: no config, no injected services, no client
 * half. It only provides the `eval` service face; the `dsh-eval` CLI builds
 * the same kernel directly (scripts and hosts without the plugin get
 * identical behavior).
 *
 * @module @khorsheed/dsh-eval
 */
import type { Context } from '@deepseek-ai/cordis'
import { EvalService } from './service.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'eval'

declare module '@deepseek-ai/cordis' {
  interface Context {
    eval: EvalService
  }
}

/**
 * Mount the eval service.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.provide('eval', new EvalService())
}

export { EvalService, EvalContractError } from './service.ts'
export type { ConditionHash } from './service.ts'
export type { PlanValidation, ConditionResolution, EvalDiagnostic, ConditionDiagnostics } from './validate.ts'
export { conditionDiagnostics, validatePlan } from './validate.ts'
export { canonicalJson, hashConditionDocument, hashHome } from './hash.ts'
export type { HomeHash } from './hash.ts'
export { analyzeBundle, writeEvalReport, parseMissionId } from './report.ts'
export type {
  ConditionEfficiency,
  EvalReport,
  FactorPair,
  InvariantCheck,
  JudgeConsistency,
  PairComparison,
  PairTaskDelta,
  ReportRow,
  ReportWrite,
} from './report.ts'
export { bootstrapMeanCi, cohenKappa, fnv1a, mean, mulberry32, allEqualRate } from './stats.ts'
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
