/**
 * The profile-root core row: publishes `ctx.typesafe`, the TypeSafe System One
 * decision service other plugins call in code — no model-facing surface of its
 * own (the `typesafe_judge` tool and its guidance ship in the separate
 * preset-composed `@khorsheed/dsh-typesafe-tool` row).
 *
 * The row injects the official `credentials` service because every call
 * resolves the API key by reference through it; config therefore carries only
 * `apiKeyRef`, never a secret value.
 * @module @khorsheed/dsh-typesafe
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveConfig, TYPE_SAFE_DEFAULTS, TypeSafeService, type TypeSafeConfig } from './service.ts'

export { TypeSafeService, resolveConfig, TYPE_SAFE_DEFAULTS, validateQuestions, decodeDecisions } from './service.ts'
export type { CallOptions, JudgeInput, ResolvedTypeSafeConfig, TypeSafeConfig, TypeSafeServiceInternals } from './service.ts'
export { isQuestionId, QUESTION_IDS, QUESTION_REGISTRY, questionSpec, thresholdOf } from './questions.ts'
export type { QuestionDefinition, QuestionId } from './questions.ts'
export { buildBody, callSystemOne, decodeAnswer, defaultTransport, stableStringify, TypeSafeWireError } from './wire.ts'
export type { CallOptions as WireCallOptions, HttpRequest, HttpResponse, Transport, WireAnswer } from './wire.ts'
export type {
  Decision,
  DecisionResult,
  Failure,
  FailureReason,
  Health,
  Json,
  JudgeResult,
  Judgement,
  ModelCard,
  QuestionSpec,
  QuestionType,
  Usage,
} from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'typesafe'

/** The official credential seam; the key is resolved per call through it. */
export const inject = ['credentials']

/**
 * Plugin configuration: every key has a default, and none of them is a secret.
 * A literal key is deliberately NOT configurable — that is what the credential
 * store and its configuration surface exist for.
 */
export const Config: z<TypeSafeConfig> = z.object({
  apiKeyRef: z.string().default(TYPE_SAFE_DEFAULTS.apiKeyRef),
  baseUrl: z.string().default(TYPE_SAFE_DEFAULTS.baseUrl),
  defaultModel: z.string().default(TYPE_SAFE_DEFAULTS.defaultModel),
  timeoutMs: z.number().default(TYPE_SAFE_DEFAULTS.timeoutMs),
  retries: z.number().default(TYPE_SAFE_DEFAULTS.retries),
  cacheTtlMs: z.number().default(TYPE_SAFE_DEFAULTS.cacheTtlMs),
  maxQuestionsPerCall: z.number().default(TYPE_SAFE_DEFAULTS.maxQuestionsPerCall),
  circuitBreakerThreshold: z.number().default(TYPE_SAFE_DEFAULTS.circuitBreakerThreshold),
  circuitCooldownMs: z.number().default(TYPE_SAFE_DEFAULTS.circuitCooldownMs),
  logDecisions: z.boolean().default(TYPE_SAFE_DEFAULTS.logDecisions),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The TypeSafe System One decision service (core row). */
    typesafe: TypeSafeService
  }
}

/**
 * Plugin body: build the service and publish it.
 * @param ctx - owning Cordis context (the profile root).
 * @param config - validated row config; every key optional.
 */
export function apply(ctx: Context, config: TypeSafeConfig = {}): void {
  const service = new TypeSafeService(ctx, resolveConfig(config))
  ctx.provide('typesafe', service)
  ctx.logger?.info(
    `typesafe: providing ctx.typesafe (model ${service.config.defaultModel}, key ref ${service.config.apiKeyRef})`,
  )
}
