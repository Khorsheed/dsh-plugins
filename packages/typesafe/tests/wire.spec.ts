/** The wire face: request shape, bounds, retry and decode — no harness, no network. */
import { describe, expect, it } from 'vitest'
import type { QuestionSpec } from '../src/types.ts'
import {
  backoffMs,
  buildBody,
  callSystemOne,
  decodeAnswer,
  isRetryableStatus,
  stableStringify,
  TypeSafeWireError,
  type HttpRequest,
  type HttpResponse,
  type Transport,
} from '../src/wire.ts'

const NOUL: QuestionSpec = { id: 'needs_reply', type: 'noul', instructions: 'Does this need a reply?' }
const CHOICE: QuestionSpec = {
  id: 'tone',
  type: 'choice',
  instructions: 'What is the tone?',
  criteria: { calm: null, angry: null },
}

const respond = (body: unknown, status = 200, headers: Record<string, string> = {}): HttpResponse =>
  ({ status, body: JSON.stringify(body), headers })

const envelope = (answers: Record<string, unknown>): Record<string, unknown> => ({
  model: 'jev-1.13.0',
  answers,
  usage: { input_tokens: 12, output_tokens: 3 },
})

const baseCall = {
  baseUrl: 'https://api.typesafe.ai',
  apiKey: 'test-key',
  model: 'jev-latest',
  state: 'I was charged twice.',
  questions: [NOUL],
  timeoutMs: 1_000,
  retries: 0,
}

const noSleep = async (): Promise<void> => {}

describe('buildBody', () => {
  it('keys questions by the caller ids and omits absent criteria', () => {
    const body = buildBody({ state: { text: 'hi' }, model: 'jev-latest', questions: [NOUL, CHOICE] })
    expect(body).toEqual({
      state: { text: 'hi' },
      model: 'jev-latest',
      questions: {
        needs_reply: { type: 'noul', instructions: 'Does this need a reply?' },
        tone: { type: 'choice', instructions: 'What is the tone?', criteria: { calm: null, angry: null } },
      },
    })
  })
})

describe('callSystemOne', () => {
  it('sends the documented request shape', async () => {
    const seen: HttpRequest[] = []
    const transport: Transport = async (request) => {
      seen.push(request)
      return respond(envelope({ needs_reply: { type: 'noul', noul: 0.9 } }))
    }
    const answer = await callSystemOne(baseCall, transport, noSleep)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe('https://api.typesafe.ai/v1/systemone')
    expect(seen[0]?.headers).toEqual({ authorization: 'Bearer test-key', 'content-type': 'application/json' })
    expect(JSON.parse(seen[0]?.body ?? '')).toEqual({
      state: 'I was charged twice.',
      model: 'jev-latest',
      questions: { needs_reply: { type: 'noul', instructions: 'Does this need a reply?' } },
    })
    expect(answer).toEqual({
      model: 'jev-1.13.0',
      answers: { needs_reply: { type: 'noul', noul: 0.9 } },
      usage: { inputTokens: 12, outputTokens: 3 },
      attempts: 1,
    })
  })

  it('appends the endpoint to a base url with a trailing slash', async () => {
    let url = ''
    const transport: Transport = async (request) => {
      url = request.url
      return respond(envelope({ needs_reply: { type: 'noul', noul: 0.1 } }))
    }
    await callSystemOne({ ...baseCall, baseUrl: 'https://gateway.example/' }, transport, noSleep)
    expect(url).toBe('https://gateway.example/v1/systemone')
  })

  it('retries a 429 after the retry-after delay, then succeeds', async () => {
    const sleeps: number[] = []
    let calls = 0
    const transport: Transport = async () => {
      calls += 1
      return calls === 1
        ? respond({ error: 'rate limited' }, 429, { 'retry-after': '2' })
        : respond(envelope({ needs_reply: { type: 'noul', noul: 0.7 } }))
    }
    const answer = await callSystemOne(
      { ...baseCall, retries: 1 },
      transport,
      async (ms) => { sleeps.push(ms) },
    )
    expect(calls).toBe(2)
    expect(sleeps).toEqual([2_000])
    expect(answer.attempts).toBe(2)
  })

  it('does not retry a 401 and reports the status', async () => {
    let calls = 0
    const transport: Transport = async () => {
      calls += 1
      return respond({ error: 'Missing or invalid API key' }, 401)
    }
    const error = await callSystemOne({ ...baseCall, retries: 3 }, transport, noSleep).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(TypeSafeWireError)
    expect(error).toMatchObject({ reason: 'http', status: 401 })
    expect(String((error as Error).message)).toContain('401')
    expect(calls).toBe(1)
  })

  it('times out a transport that ignores the abort signal', async () => {
    const transport: Transport = () => new Promise<HttpResponse>(() => {})
    const error = await callSystemOne({ ...baseCall, timeoutMs: 5 }, transport, noSleep).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(TypeSafeWireError)
    expect((error as TypeSafeWireError).reason).toBe('timeout')
  })

  it('reports a caller abort as `aborted`', async () => {
    const controller = new AbortController()
    const transport: Transport = () => new Promise<HttpResponse>(() => {})
    const pending = callSystemOne({ ...baseCall, timeoutMs: 5_000, signal: controller.signal }, transport, noSleep)
    controller.abort()
    const error = await pending.catch((err: unknown) => err)
    expect((error as TypeSafeWireError).reason).toBe('aborted')
  })

  it('maps a transport rejection to `transport`', async () => {
    const transport: Transport = async () => { throw new Error('getaddrinfo ENOTFOUND') }
    const error = await callSystemOne(baseCall, transport, noSleep).catch((err: unknown) => err)
    expect(error).toMatchObject({ reason: 'transport' })
    expect(String((error as Error).message)).toContain('ENOTFOUND')
  })
})

describe('decodeAnswer', () => {
  it('rejects a non-JSON body', () => {
    expect(() => decodeAnswer({ status: 200, body: 'not json', headers: {} }, 1)).toThrow(TypeSafeWireError)
  })

  it('rejects an envelope without answers', () => {
    expect(() => decodeAnswer(respond({ model: 'jev-1.13.0' }), 1)).toThrow(/no `answers` object/)
  })
})

describe('status helpers', () => {
  it('classifies retryable statuses', () => {
    expect(isRetryableStatus(429)).toBe(true)
    expect(isRetryableStatus(529)).toBe(true)
    expect(isRetryableStatus(503)).toBe(true)
    expect(isRetryableStatus(400)).toBe(false)
    expect(isRetryableStatus(401)).toBe(false)
  })

  it('caps the backoff ladder', () => {
    expect(backoffMs(0)).toBe(250)
    expect(backoffMs(1)).toBe(500)
    expect(backoffMs(9)).toBe(4_000)
  })
})

describe('stableStringify', () => {
  it('is key-order independent', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3] } }))
      .toBe(stableStringify({ a: { c: [3], d: 2 }, b: 1 }))
  })
})
