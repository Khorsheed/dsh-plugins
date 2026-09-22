/**
 * The payload vocabulary this package exchanges with TypeSafe's System One
 * API. Kept honest to the wire: a `noul` answer carries only its probability,
 * while `choice` and `score` answers add a confidence and a full distribution.
 * @module @khorsheed/dsh-typesafe/types
 */

/** A JSON value, the only thing that may cross the wire. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** The three System One question types. */
export type QuestionType = 'noul' | 'choice' | 'score'

/**
 * One question, addressed by the caller's own id. The id is never sent to the
 * model — it is the key `answers` comes back under.
 */
export interface QuestionSpec {
  /** Caller-chosen id; the answer returns under the same key. */
  readonly id: string
  /** Which primitive answers it. */
  readonly type: QuestionType
  /** The judgement itself. A string, or a structured object when it needs parts. */
  readonly instructions: Json
  /** Option names → descriptions for `choice`, ordered levels for `score`, omitted for `noul`. */
  readonly criteria?: Json
}

/** One typed answer. */
export interface Decision {
  /** The question id this answers. */
  readonly id: string
  /** The asked primitive. */
  readonly type: QuestionType
  /** `noul`: the yes probability. `choice`: the winning option. `score`: the level index. */
  readonly answer: string | number | boolean
  /** Distribution concentration — absent for `noul`. */
  readonly confidence?: number
  /** Probability per option / per level — absent for `noul`. */
  readonly probabilities?: Record<string, number>
  /** Level index → level description, `score` only. */
  readonly legend?: Record<string, string>
  /** The registry threshold for this question, when it came from the registry. */
  readonly threshold?: number
  /** Whether the answer clears that threshold. Absent when no threshold applies. */
  readonly meetsThreshold?: boolean
}

/** Token usage as the API reports it. */
export interface Usage {
  readonly inputTokens: number
  readonly outputTokens: number
}

/** One completed request's answers. */
export interface Judgement {
  /** The model the service actually answered with. */
  readonly model: string
  /** One entry per asked question, in request order. */
  readonly decisions: readonly Decision[]
  /** Reported token usage, when the response carried it. */
  readonly usage?: Usage
  /** Wall-clock duration of the served call (a cache hit reports its own recall time). */
  readonly latencyMs: number
  /** Whether this came from the cache without a network call. */
  readonly cached: boolean
}

/** One entry of the models listing. */
export interface ModelCard {
  readonly id: string
  readonly [key: string]: unknown
}

/** Why a call could not produce an answer. */
export type FailureReason =
  /** No API key resolved for the configured reference. */
  | 'unconfigured'
  /** The circuit breaker is cooling down after repeated failures. */
  | 'circuit-open'
  /** The bounded timeout elapsed. */
  | 'timeout'
  /** The caller's own AbortSignal fired. */
  | 'aborted'
  /** The API answered with a non-retryable status, or retries were exhausted. */
  | 'http'
  /** The request never reached the API (DNS, connection, TLS). */
  | 'transport'
  /** The response was not a usable System One envelope. */
  | 'decode'
  /** The caller's own input was rejected before any network call. */
  | 'invalid-request'

/** Everything a failed call reports — never thrown, always returned. */
export interface Failure {
  readonly ok: false
  readonly reason: FailureReason
  /** A one-line human/model-readable explanation. */
  readonly detail: string
  /** HTTP status when the failure came from a response. */
  readonly status?: number
}

/** The result of {@link TypeSafeService.judge}. */
export type JudgeResult = { readonly ok: true; readonly judgement: Judgement } | Failure

/** The result of {@link TypeSafeService.decide}. */
export type DecisionResult = { readonly ok: true; readonly decision: Decision } | Failure

/** A cheap readiness read for health checks, settings surfaces and gates. */
export interface Health {
  /** True when a key resolves and the breaker is closed. */
  readonly available: boolean
  /** Which layer supplied the key (`env`, `file`, …), never the value. */
  readonly source?: string
  /** Set when unavailable: why. */
  readonly reason?: FailureReason
  /** The last failure's detail, kept for diagnostics until the next success. */
  readonly lastError?: string
  /** Epoch ms the breaker reopens at, when it is open. */
  readonly circuitOpenUntil?: number
}
