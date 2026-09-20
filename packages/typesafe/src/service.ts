/**
 * The TypeSafe service: the one object other plugins call in code.
 *
 * Every call resolves the API key from the host credential store by reference
 * (never a literal in config), is bounded by an owned timeout plus the caller's
 * signal, retried on 429/529 with exponential backoff, shielded by a circuit
 * breaker, optionally cached by `hash(state + questions)`, and logged. Failures
 * NEVER throw: they come back as a structured `Failure`, so a caller's turn can
 * apply its own fail-open/fail-closed policy without a try/catch.
 * @module @khorsheed/dsh-typesafe/service
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { questionSpec, thresholdOf, type QuestionId } from './questions.ts'
import { callSystemOne, defaultTransport, stableStringify, TypeSafeWireError, type CallOptions as WireCallOptions, type Transport } from './wire.ts'
import type {
  Decision,
  DecisionResult,
  Failure,
  FailureReason,
  Health,
  Json,
  JudgeResult,
  Judgement,
  QuestionSpec,
} from './types.ts'

/** The config keys the plugin row accepts. Every one has a default. */
export interface TypeSafeConfig {
  /** Credential reference resolved per call. */
  apiKeyRef?: string
  /** API base; a gateway or private deployment goes here. */
  baseUrl?: string
  /** Model used when a call does not name one. */
  defaultModel?: string
  /** Hard ceiling for one attempt. */
  timeoutMs?: number
  /** Extra attempts after the first, for retryable failures only. */
  retries?: number
  /** Cache lifetime; `0` disables caching. */
  cacheTtlMs?: number
  /** Reject a call asking for more questions than this. */
  maxQuestionsPerCall?: number
  /** Consecutive failures that open the breaker. */
  circuitBreakerThreshold?: number
  /** How long the breaker stays open. */
  circuitCooldownMs?: number
  /** Log one line per served judgement. */
  logDecisions?: boolean
}

/** {@link TypeSafeConfig} with every default resolved. */
export interface ResolvedTypeSafeConfig {
  readonly apiKeyRef: string
  readonly baseUrl: string
  readonly defaultModel: string
  readonly timeoutMs: number
  readonly retries: number
  readonly cacheTtlMs: number
  readonly maxQuestionsPerCall: number
  readonly circuitBreakerThreshold: number
  readonly circuitCooldownMs: number
  readonly logDecisions: boolean
}

/** The documented defaults, exported so a settings surface can show them. */
export const TYPE_SAFE_DEFAULTS = {
  apiKeyRef: 'TYPESAFE_API_KEY',
  baseUrl: 'https://api.typesafe.ai',
  defaultModel: 'jev-latest',
  timeoutMs: 5_000,
  retries: 1,
  cacheTtlMs: 0,
  maxQuestionsPerCall: 32,
  circuitBreakerThreshold: 3,
  circuitCooldownMs: 30_000,
  logDecisions: true,
} as const

/** Fill every default, so the service never re-decides one per call. */
export function resolveConfig(config: TypeSafeConfig = {}): ResolvedTypeSafeConfig {
  return {
    apiKeyRef: config.apiKeyRef ?? TYPE_SAFE_DEFAULTS.apiKeyRef,
    baseUrl: config.baseUrl ?? TYPE_SAFE_DEFAULTS.baseUrl,
    defaultModel: config.defaultModel ?? TYPE_SAFE_DEFAULTS.defaultModel,
    timeoutMs: config.timeoutMs ?? TYPE_SAFE_DEFAULTS.timeoutMs,
    retries: config.retries ?? TYPE_SAFE_DEFAULTS.retries,
    cacheTtlMs: config.cacheTtlMs ?? TYPE_SAFE_DEFAULTS.cacheTtlMs,
    maxQuestionsPerCall: config.maxQuestionsPerCall ?? TYPE_SAFE_DEFAULTS.maxQuestionsPerCall,
    circuitBreakerThreshold: config.circuitBreakerThreshold ?? TYPE_SAFE_DEFAULTS.circuitBreakerThreshold,
    circuitCooldownMs: config.circuitCooldownMs ?? TYPE_SAFE_DEFAULTS.circuitCooldownMs,
    logDecisions: config.logDecisions ?? TYPE_SAFE_DEFAULTS.logDecisions,
  }
}

/** What one judgement call takes. */
export interface JudgeInput {
  /** The state to judge — text, or named fields when the context has parts. */
  readonly state: Json
  /** The questions to answer together (they run in parallel server-side). */
  readonly questions: readonly QuestionSpec[]
  /** Model override for this call. */
  readonly model?: string
}

/** Per-call bounds and cache policy. */
export interface CallOptions {
  /** The caller's cancellation signal (a turn's signal, a gate's deadline). */
  readonly signal?: AbortSignal
  /** Override this call's timeout. */
  readonly timeoutMs?: number
  /** Skip the cache — for a gate that must judge fresh information. */
  readonly fresh?: boolean
}

/** The narrow credential-store slice this service reads (ref namespace only). */
interface CredentialsLike {
  resolve(ref: unknown): Promise<{ readonly value: string; readonly source?: string } | undefined>
}

/** The narrow logger slice this service writes to. */
interface LoggerLike {
  info(message: string): void
  warn?(message: string): void
}

/** Swappable internals, for tests. */
export interface TypeSafeServiceInternals {
  readonly transport?: Transport
  readonly sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Build the structured failure every path returns. */
function failure(reason: FailureReason, detail: string, status?: number): Failure {
  return { ok: false, reason, detail, ...status === undefined ? {} : { status } }
}

/** A finite number, or undefined. */
function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** A distribution, keeping only finite entries. */
function probabilitiesOf(value: unknown): Record<string, number> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, number> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const number = numberOrUndefined(item)
    if (number !== undefined) out[key] = number
  }
  return Object.keys(out).length === 0 ? undefined : out
}

/** A legend map of level index → description. */
function legendOf(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') out[key] = item
  }
  return Object.keys(out).length === 0 ? undefined : out
}

/** Reject a caller's own malformed input before spending a network call. */
export function validateQuestions(questions: readonly QuestionSpec[], maxQuestions: number): string | undefined {
  if (questions.length === 0) return 'at least one question is required'
  if (questions.length > maxQuestions) return `at most ${maxQuestions} questions may be asked in one call`
  const seen = new Set<string>()
  for (const question of questions) {
    if (question.id.trim() === '') return 'every question needs a non-empty id'
    if (seen.has(question.id)) return `duplicate question id "${question.id}"`
    seen.add(question.id)
    if (question.type === 'choice' || question.type === 'score') {
      if (question.criteria === undefined) return `question "${question.id}" is a ${question.type} and needs criteria`
    }
  }
  return undefined
}

/**
 * Decode the answer envelope onto the asked questions, in request order.
 * @throws TypeSafeWireError with reason `decode` when an answer is missing or mistyped.
 */
export function decodeDecisions(
  questions: readonly QuestionSpec[],
  answers: Readonly<Record<string, unknown>>,
): readonly Decision[] {
  const decisions: Decision[] = []
  for (const question of questions) {
    const raw = answers[question.id]
    if (raw === null || typeof raw !== 'object') {
      throw new TypeSafeWireError('decode', `no answer came back for question "${question.id}"`)
    }
    const answer = raw as Record<string, unknown>
    const confidence = numberOrUndefined(answer['confidence'])
    const probabilities = probabilitiesOf(answer['probabilities'])
    if (question.type === 'noul') {
      const probability = numberOrUndefined(answer['noul'])
      if (probability === undefined) {
        throw new TypeSafeWireError('decode', `question "${question.id}" was not answered as a noul`)
      }
      decisions.push({ id: question.id, type: 'noul', answer: probability })
      continue
    }
    if (question.type === 'choice') {
      const choice = answer['choice']
      if (typeof choice !== 'string') {
        throw new TypeSafeWireError('decode', `question "${question.id}" was not answered as a choice`)
      }
      decisions.push({
        id: question.id,
        type: 'choice',
        answer: choice,
        ...confidence === undefined ? {} : { confidence },
        ...probabilities === undefined ? {} : { probabilities },
      })
      continue
    }
    const score = numberOrUndefined(answer['score'])
    if (score === undefined) {
      throw new TypeSafeWireError('decode', `question "${question.id}" was not answered as a score`)
    }
    const legend = legendOf(answer['legend'])
    decisions.push({
      id: question.id,
      type: 'score',
      answer: score,
      ...confidence === undefined ? {} : { confidence },
      ...probabilities === undefined ? {} : { probabilities },
      ...legend === undefined ? {} : { legend },
    })
  }
  return decisions
}

/**
 * The service core. Construct once per process and publish with `ctx.provide`
 * (the plugin row does exactly that); consumers get it through `ctx.get`.
 */
export class TypeSafeService {
  readonly #ctx: Context
  readonly #config: ResolvedTypeSafeConfig
  readonly #transport: Transport | undefined
  readonly #sleep: (ms: number) => Promise<void>
  readonly #cache = new Map<string, { readonly at: number; readonly judgement: Judgement }>()
  readonly #inflight = new Map<string, Promise<JudgeResult>>()
  #consecutiveFailures = 0
  #circuitOpenUntil = 0
  #lastError: string | undefined

  constructor(ctx: Context, config: ResolvedTypeSafeConfig, internals: TypeSafeServiceInternals = {}) {
    this.#ctx = ctx
    this.#config = config
    this.#transport = internals.transport
    this.#sleep = internals.sleep ?? defaultSleep
  }

  /** The resolved configuration this service runs with. */
  get config(): ResolvedTypeSafeConfig {
    return this.#config
  }

  /** Resolve the API key for one call. Never cached — the store may change under us. */
  async #apiKey(): Promise<{ readonly value: string; readonly source?: string } | undefined> {
    const credentials = (this.#ctx as { credentials?: CredentialsLike }).credentials
    if (credentials === undefined) return undefined
    return credentials.resolve(credentialRef(this.#config.apiKeyRef)).catch(() => undefined)
  }

  /** A cheap readiness read: key resolvable and breaker closed. */
  async health(): Promise<Health> {
    const key = await this.#apiKey()
    const open = Date.now() < this.#circuitOpenUntil
    const tail = {
      ...this.#lastError === undefined ? {} : { lastError: this.#lastError },
      ...open ? { circuitOpenUntil: this.#circuitOpenUntil } : {},
    }
    if (key === undefined) return { available: false, reason: 'unconfigured', ...tail }
    if (open) return { available: false, reason: 'circuit-open', ...key.source === undefined ? {} : { source: key.source }, ...tail }
    return { available: true, ...key.source === undefined ? {} : { source: key.source }, ...tail }
  }

  /**
   * Ask every question against one state, as a single API call.
   * @param input - state plus the questions to answer together.
   * @param options - per-call bounds and cache policy.
   * @returns the judgement, or a structured failure — never a throw.
   */
  async judge(input: JudgeInput, options: CallOptions = {}): Promise<JudgeResult> {
    const invalid = validateQuestions(input.questions, this.#config.maxQuestionsPerCall)
    if (invalid !== undefined) return failure('invalid-request', invalid)
    if (Date.now() < this.#circuitOpenUntil) {
      return failure('circuit-open', `the typesafe breaker is open until ${new Date(this.#circuitOpenUntil).toISOString()}`)
    }
    const key = await this.#apiKey()
    if (key === undefined) {
      return failure('unconfigured', `no value resolved for credential reference ${this.#config.apiKeyRef}`)
    }
    const model = input.model ?? this.#config.defaultModel
    const cacheKey = stableStringify({
      baseUrl: this.#config.baseUrl,
      model,
      state: input.state,
      questions: input.questions,
    })

    if (options.fresh !== true && this.#config.cacheTtlMs > 0) {
      const hit = this.#cache.get(cacheKey)
      if (hit !== undefined) {
        if (Date.now() - hit.at < this.#config.cacheTtlMs) return { ok: true, judgement: { ...hit.judgement, cached: true } }
        this.#cache.delete(cacheKey)
      }
    }
    const running = this.#inflight.get(cacheKey)
    if (running !== undefined) return running

    const call: WireCallOptions = {
      baseUrl: this.#config.baseUrl,
      apiKey: key.value,
      model,
      state: input.state,
      questions: input.questions,
      timeoutMs: options.timeoutMs ?? this.#config.timeoutMs,
      retries: this.#config.retries,
      ...options.signal === undefined ? {} : { signal: options.signal },
    }
    const started = Date.now()
    const pending = this.#serve(call, input.questions, cacheKey, started)
    this.#inflight.set(cacheKey, pending)
    try {
      return await pending
    } finally {
      this.#inflight.delete(cacheKey)
    }
  }

  /** One bounded attempt path, with the breaker and the cache maintained. */
  async #serve(
    call: WireCallOptions,
    questions: readonly QuestionSpec[],
    cacheKey: string,
    started: number,
  ): Promise<JudgeResult> {
    try {
      const answer = await callSystemOne(call, this.#transport ?? defaultTransport, this.#sleep)
      const decisions = decodeDecisions(questions, answer.answers)
      const judgement: Judgement = {
        model: answer.model === '' ? call.model : answer.model,
        decisions,
        latencyMs: Date.now() - started,
        cached: false,
        ...answer.usage === undefined ? {} : { usage: answer.usage },
      }
      this.#consecutiveFailures = 0
      this.#lastError = undefined
      if (this.#config.cacheTtlMs > 0) this.#cache.set(cacheKey, { at: Date.now(), judgement })
      this.#log(judgement, call.model)
      return { ok: true, judgement }
    } catch (error) {
      const wire = error instanceof TypeSafeWireError
        ? error
        : new TypeSafeWireError('transport', error instanceof Error ? error.message : String(error))
      this.#consecutiveFailures += 1
      this.#lastError = `${wire.reason}: ${wire.message}`
      if (this.#consecutiveFailures >= this.#config.circuitBreakerThreshold) {
        this.#circuitOpenUntil = Date.now() + this.#config.circuitCooldownMs
      }
      this.#logger()?.warn?.(`typesafe: ${wire.reason} — ${wire.message}`)
      return failure(wire.reason, wire.message, wire.status)
    }
  }

  /** The logger slice, or undefined in a composition without one. */
  #logger(): LoggerLike | undefined {
    return (this.#ctx as { logger?: LoggerLike }).logger
  }

  /** One line per served judgement: question ids, answers, latency, tokens. */
  #log(judgement: Judgement, model: string): void {
    if (!this.#config.logDecisions) return
    const logger = this.#logger()
    if (logger === undefined) return
    const summary = judgement.decisions
      .map((decision) => `${decision.id}=${String(decision.answer)}${decision.confidence === undefined ? '' : `@${decision.confidence.toFixed(2)}`}`)
      .join(' ')
    const tokens = judgement.usage === undefined ? '' : ` tokens=${judgement.usage.inputTokens}/${judgement.usage.outputTokens}`
    logger.info(`typesafe: ${model} ${summary} ${judgement.latencyMs}ms${tokens}`)
  }

  /**
   * Answer one registered decision (or an ad-hoc spec) and apply its threshold.
   * @param question - a registry id, or a full spec for a one-off question.
   * @param state - the state to judge.
   * @param options - per-call bounds and cache policy.
   * @returns the decision, or a structured failure — never a throw.
   */
  async decide(
    question: QuestionId | QuestionSpec,
    state: Json,
    options: CallOptions = {},
  ): Promise<DecisionResult> {
    const spec = typeof question === 'string' ? questionSpec(question) : question
    const threshold = typeof question === 'string' ? thresholdOf(question) : undefined
    const result = await this.judge({ state, questions: [spec] }, options)
    if (!result.ok) return result
    const decision = result.judgement.decisions[0]
    if (decision === undefined) {
      return failure('decode', `no answer came back for question "${spec.id}"`)
    }
    const meetsThreshold = threshold === undefined || spec.type !== 'noul'
      ? undefined
      : Number(decision.answer) >= threshold
    return {
      ok: true,
      decision: {
        ...decision,
        ...threshold === undefined ? {} : { threshold },
        ...meetsThreshold === undefined ? {} : { meetsThreshold },
      },
    }
  }
}
