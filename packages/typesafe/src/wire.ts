/**
 * The TypeSafe HTTP face: request building, the bounded transport, retry and
 * response decoding. This module deliberately imports nothing from the harness
 * — it is the part of the package that could be lifted into a non-dsh caller
 * unchanged (see the proposal's "known exit").
 *
 * `POST {baseUrl}/v1/systemone`, `Authorization: Bearer <key>`, body
 * `{ state, model, questions }`. The service maps every throw from here onto a
 * structured `Failure`, so a caller of the service never sees an exception.
 * @module @khorsheed/dsh-typesafe/wire
 */

import type { Json, QuestionSpec, Usage } from './types.ts'

/** One outbound request, reduced to what a transport must do. */
export interface HttpRequest {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
  readonly signal?: AbortSignal
}

/** A transport's answer: status, raw body and lower-cased response headers. */
export interface HttpResponse {
  readonly status: number
  readonly body: string
  readonly headers: Readonly<Record<string, string>>
}

/** Swappable transport — the seam that keeps tests off the network. */
export type Transport = (request: HttpRequest) => Promise<HttpResponse>

/** The real transport: Node's global fetch, lowered to {@link HttpResponse}. */
export const defaultTransport: Transport = async (request) => {
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => { headers[key.toLowerCase()] = value })
  return { status: response.status, body: await response.text(), headers }
}

/** Every way a wire call can fail. Mapped to a `Failure` by the service. */
export type WireFailureReason = 'timeout' | 'aborted' | 'http' | 'transport' | 'decode'

/** A wire-level failure. Never escapes the service. */
export class TypeSafeWireError extends Error {
  readonly reason: WireFailureReason
  readonly status: number | undefined

  constructor(reason: WireFailureReason, message: string, status?: number) {
    super(message)
    this.name = 'TypeSafeWireError'
    this.reason = reason
    this.status = status
  }
}

/** The request-side options one call needs. */
export interface CallOptions {
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
  readonly state: Json
  readonly questions: readonly QuestionSpec[]
  /** Hard ceiling for one attempt, aborting the transport when it elapses. */
  readonly timeoutMs: number
  /** Extra attempts after the first, for retryable failures only. */
  readonly retries: number
  /** The caller's cancellation signal (a turn's own signal, a gate's deadline). */
  readonly signal?: AbortSignal
}

/** A decoded System One envelope. */
export interface WireAnswer {
  /** `model` as reported by the response (e.g. `jev-1.13.0`). */
  readonly model: string
  /** Raw per-question answers, keyed by the caller's question ids. */
  readonly answers: Readonly<Record<string, unknown>>
  /** Token usage, when reported. */
  readonly usage?: Usage
  /** How many transport attempts this answer took (1 = clean first try). */
  readonly attempts: number
}

/** Which HTTP statuses are worth another attempt. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

/** Exponential backoff, capped, so a retry storm cannot pin a caller's turn. */
export function backoffMs(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 4_000)
}

/** The body this package sends: question ids are the only keying. */
export function buildBody(options: Pick<CallOptions, 'state' | 'model' | 'questions'>): {
  state: Json
  model: string
  questions: Record<string, { type: string; instructions: Json; criteria?: Json }>
} {
  const questions: Record<string, { type: string; instructions: Json; criteria?: Json }> = {}
  for (const question of options.questions) {
    questions[question.id] = {
      type: question.type,
      instructions: question.instructions,
      ...question.criteria === undefined ? {} : { criteria: question.criteria },
    }
  }
  return { state: options.state, model: options.model, questions }
}

/** A short, value-free suffix naming why a status was returned. */
function statusDetail(response: HttpResponse): string {
  const message = (() => {
    try {
      const parsed: unknown = JSON.parse(response.body)
      if (parsed !== null && typeof parsed === 'object' && 'error' in parsed) {
        const error = (parsed as { error: unknown }).error
        if (typeof error === 'string') return `: ${error}`
        if (error !== null && typeof error === 'object' && 'message' in error) {
          const inner = (error as { message: unknown }).message
          if (typeof inner === 'string') return `: ${inner}`
        }
      }
    } catch {
      // A non-JSON body carries nothing worth echoing; the status is the fact.
    }
    return ''
  })()
  return `${message}${message === '' ? ` (${response.body.slice(0, 200)})` : ''}`
}

/** `retry-after` in seconds when the API sends it, else the backoff ladder. */
function retryDelayMs(response: HttpResponse, attempt: number): number {
  const header = response.headers['retry-after']
  const seconds = header === undefined ? Number.NaN : Number.parseFloat(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 10_000)
  return backoffMs(attempt)
}

/** Parse the envelope, or fail with `decode`. */
export function decodeAnswer(response: HttpResponse, attempts: number): WireAnswer {
  let parsed: unknown
  try {
    parsed = JSON.parse(response.body)
  } catch (error) {
    throw new TypeSafeWireError('decode', `the response was not JSON (${String(error)})`)
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new TypeSafeWireError('decode', 'the response was not a JSON object')
  }
  const envelope = parsed as { model?: unknown; answers?: unknown; usage?: unknown }
  if (envelope.answers === null || typeof envelope.answers !== 'object' || Array.isArray(envelope.answers)) {
    throw new TypeSafeWireError('decode', 'the response carried no `answers` object')
  }
  const usage = envelope.usage
  const mappedUsage = usage !== null && typeof usage === 'object'
    ? {
        inputTokens: numberOrZero((usage as { input_tokens?: unknown }).input_tokens),
        outputTokens: numberOrZero((usage as { output_tokens?: unknown }).output_tokens),
      }
    : undefined
  return {
    model: typeof envelope.model === 'string' ? envelope.model : '',
    answers: envelope.answers as Record<string, unknown>,
    ...mappedUsage === undefined ? {} : { usage: mappedUsage },
    attempts,
  }
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Read the abort state through a call, so later checks are not narrowed away. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

/** The default pause between attempts. */
const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * One System One call, bounded and retried.
 * @param options - request-side options (state, questions, bounds).
 * @param transport - the transport to use; defaults to global fetch.
 * @param sleep - the inter-attempt pause; injectable so tests never wait.
 * @returns the decoded envelope.
 * @throws TypeSafeWireError - every failure path, for the service to map.
 */
export async function callSystemOne(
  options: CallOptions,
  transport: Transport = defaultTransport,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<WireAnswer> {
  const url = `${options.baseUrl.replace(/\/+$/, '')}/v1/systemone`
  const body = JSON.stringify(buildBody(options))
  const headers: Record<string, string> = {
    authorization: `Bearer ${options.apiKey}`,
    'content-type': 'application/json',
  }
  let lastError: TypeSafeWireError | undefined

  for (let attempt = 0; attempt <= options.retries; attempt++) {
    if (isAborted(options.signal)) {
      throw new TypeSafeWireError('aborted', 'the caller aborted before the request was sent')
    }
    const controller = new AbortController()
    const relayAbort = (): void => { controller.abort() }
    options.signal?.addEventListener('abort', relayAbort, { once: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    // The deadline RACES the transport rather than merely aborting its signal:
    // a transport that ignores the signal must not be able to hang a caller's
    // turn (the pre-step seam has no timeout of its own).
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new TypeSafeWireError('timeout', `no answer within ${options.timeoutMs}ms`))
      }, options.timeoutMs)
    })
    const cancelled = new Promise<never>((_resolve, reject) => {
      const signal = options.signal
      if (signal === undefined) return
      const onAbort = (): void => {
        controller.abort()
        reject(new TypeSafeWireError('aborted', 'the caller aborted the request'))
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    })
    let response: HttpResponse | undefined
    try {
      response = await Promise.race([transport({ url, headers, body, signal: controller.signal }), deadline, cancelled])
    } catch (error) {
      lastError = error instanceof TypeSafeWireError
        ? error
        : isAborted(options.signal)
          ? new TypeSafeWireError('aborted', 'the caller aborted the request')
          : new TypeSafeWireError('transport', error instanceof Error ? error.message : String(error))
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      options.signal?.removeEventListener('abort', relayAbort)
    }

    if (response === undefined) {
      if (lastError?.reason === 'transport' && attempt < options.retries) {
        await sleep(backoffMs(attempt))
        continue
      }
      throw lastError ?? new TypeSafeWireError('transport', 'the request could not be sent')
    }

    if (response.status >= 200 && response.status < 300) {
      return decodeAnswer(response, attempt + 1)
    }
    lastError = new TypeSafeWireError(
      'http',
      `TypeSafe answered ${response.status}${statusDetail(response)}`,
      response.status,
    )
    if (!isRetryableStatus(response.status) || attempt === options.retries) throw lastError
    await sleep(retryDelayMs(response, attempt))
  }

  throw lastError ?? new TypeSafeWireError('transport', 'the request could not be sent')
}

/** A deterministic stringify so a cache key is stable across key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
}
