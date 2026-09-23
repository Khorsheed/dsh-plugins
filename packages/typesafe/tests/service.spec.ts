/** The service contract: never throws, degrades to structured failures, caches, and trips its breaker. */
import { describe, expect, it } from 'vitest'
import { QUESTION_REGISTRY, questionSpec } from '../src/questions.ts'
import { resolveConfig, TypeSafeService } from '../src/service.ts'
import type { Json, QuestionSpec } from '../src/types.ts'
import type { HttpRequest, HttpResponse, Transport } from '../src/wire.ts'

const NOUL: QuestionSpec = { id: 'needs_reply', type: 'noul', instructions: 'Does this need a reply?' }

const respond = (body: unknown, status = 200, headers: Record<string, string> = {}): HttpResponse =>
  ({ status, body: JSON.stringify(body), headers })

const envelope = (answers: Record<string, unknown>): Record<string, unknown> => ({ model: 'jev-1.13.0', answers })

interface Harness {
  readonly service: TypeSafeService
  readonly calls: HttpRequest[]
  readonly logs: string[]
  readonly warns: string[]
}

function harness(config: Parameters<typeof resolveConfig>[0] = {}, transport?: Transport, key: string | null = 'test-key'): Harness {
  const calls: HttpRequest[] = []
  const logs: string[] = []
  const warns: string[] = []
  const ctx = {
    credentials: {
      resolve: async () => (key === null ? undefined : { value: key, source: 'file' }),
    },
    logger: {
      info: (message: string) => { logs.push(message) },
      warn: (message: string) => { warns.push(message) },
    },
  }
  const inner: Transport = transport ?? (async () => respond(envelope({ needs_reply: { type: 'noul', noul: 0.8 } })))
  const spy: Transport = async (request) => {
    calls.push(request)
    return inner(request)
  }
  const service = new TypeSafeService(
    ctx as never,
    resolveConfig({ logDecisions: true, ...config }),
    { transport: spy, sleep: async () => {} },
  )
  return { service, calls, logs, warns }
}

describe('TypeSafeService', () => {
  it('answers a noul, a choice and a score in one call', async () => {
    const { service, calls, logs } = harness({}, async () => respond(envelope({
      needs_reply: { type: 'noul', noul: 0.82 },
      tone: { type: 'choice', choice: 'angry', confidence: 0.76, probabilities: { calm: 0, angry: 0.9 } },
      urgency: { type: 'score', score: 2, confidence: 0.5, legend: { '0': 'can wait', '1': 'this week', '2': 'today' } },
    })))
    const result = await service.judge({
      state: 'I was charged twice.',
      questions: [
        NOUL,
        { id: 'tone', type: 'choice', instructions: 'What is the tone?', criteria: { calm: null, angry: null } },
        { id: 'urgency', type: 'score', instructions: 'How urgent?', criteria: ['can wait', 'this week', 'today'] },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.judgement.model).toBe('jev-1.13.0')
    expect(result.judgement.cached).toBe(false)
    expect(result.judgement.decisions).toEqual([
      { id: 'needs_reply', type: 'noul', answer: 0.82 },
      { id: 'tone', type: 'choice', answer: 'angry', confidence: 0.76, probabilities: { calm: 0, angry: 0.9 } },
      {
        id: 'urgency',
        type: 'score',
        answer: 2,
        confidence: 0.5,
        legend: { '0': 'can wait', '1': 'this week', '2': 'today' },
      },
    ])
    expect(calls).toHaveLength(1)
    expect(logs[0]).toContain('needs_reply=0.82')
    expect(logs[0]).toContain('tone=angry@0.76')
  })

  it('reports `unconfigured` without calling the network when the key does not resolve', async () => {
    const { service, calls } = harness({}, undefined, null)
    const result = await service.judge({ state: 'hi', questions: [NOUL] })
    expect(result).toMatchObject({ ok: false, reason: 'unconfigured' })
    expect(calls).toHaveLength(0)
    expect(await service.health()).toMatchObject({ available: false, reason: 'unconfigured' })
  })

  it('rejects malformed input before spending a call', async () => {
    const { service, calls } = harness()
    const duplicate = await service.judge({ state: 'hi', questions: [NOUL, NOUL] })
    expect(duplicate).toMatchObject({ ok: false, reason: 'invalid-request' })
    const empty = await service.judge({ state: 'hi', questions: [] })
    expect(empty).toMatchObject({ ok: false, reason: 'invalid-request' })
    const missingCriteria = await service.judge({
      state: 'hi',
      questions: [{ id: 'tone', type: 'choice', instructions: 'tone?' }],
    })
    expect(missingCriteria).toMatchObject({ ok: false, reason: 'invalid-request' })
    expect(calls).toHaveLength(0)
  })

  it('returns a `decode` failure when the answer is missing a question', async () => {
    const { service } = harness({}, async () => respond(envelope({})))
    const result = await service.judge({ state: 'hi', questions: [NOUL] })
    expect(result).toMatchObject({ ok: false, reason: 'decode' })
  })

  it('surfaces a timeout as a structured failure instead of hanging', async () => {
    const { service } = harness({ timeoutMs: 5 }, () => new Promise<HttpResponse>(() => {}))
    const result = await service.judge({ state: 'hi', questions: [NOUL] })
    expect(result).toMatchObject({ ok: false, reason: 'timeout' })
  })

  it('caches by hash(state + questions) and honours `fresh`', async () => {
    const { service, calls } = harness({ cacheTtlMs: 60_000 })
    const first = await service.judge({ state: 'hi', questions: [NOUL] })
    const second = await service.judge({ state: 'hi', questions: [NOUL] })
    const fresh = await service.judge({ state: 'hi', questions: [NOUL] }, { fresh: true })
    expect(first.ok && first.judgement.cached).toBe(false)
    expect(second.ok && second.judgement.cached).toBe(true)
    expect(fresh.ok && fresh.judgement.cached).toBe(false)
    expect(calls).toHaveLength(2)
  })

  it('serves one in-flight call to concurrent identical requests', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { service, calls } = harness({}, async () => {
      await gate
      return respond(envelope({ needs_reply: { type: 'noul', noul: 0.4 } }))
    })
    const both = Promise.all([
      service.judge({ state: 'hi', questions: [NOUL] }),
      service.judge({ state: 'hi', questions: [NOUL] }),
    ])
    release?.()
    const [a, b] = await both
    expect(calls).toHaveLength(1)
    expect(a.ok && b.ok).toBe(true)
  })

  it('opens the breaker after consecutive failures', async () => {
    const { service, calls } = harness({ circuitBreakerThreshold: 2, circuitCooldownMs: 60_000 }, async () => {
      return respond({ error: 'boom' }, 500)
    })
    expect(await service.judge({ state: 'a', questions: [NOUL] })).toMatchObject({ ok: false, reason: 'http' })
    expect(await service.judge({ state: 'b', questions: [NOUL] })).toMatchObject({ ok: false, reason: 'http' })
    const callsBefore = calls.length
    const blocked = await service.judge({ state: 'c', questions: [NOUL] })
    expect(blocked).toMatchObject({ ok: false, reason: 'circuit-open' })
    expect(calls).toHaveLength(callsBefore)
    expect(await service.health()).toMatchObject({ available: false, reason: 'circuit-open' })
  })

  it('applies a registry threshold when deciding by id', async () => {
    const { service } = harness({}, async () => respond(envelope({ NEEDS_REPLY: { type: 'noul', noul: 0.9 } })))
    const result = await service.decide('NEEDS_REPLY', 'hi')
    expect(result).toMatchObject({
      ok: true,
      decision: {
        id: 'NEEDS_REPLY',
        type: 'noul',
        answer: 0.9,
        threshold: QUESTION_REGISTRY.NEEDS_REPLY.threshold,
        meetsThreshold: true,
      },
    })
  })

  it('reports a miss below the threshold', async () => {
    const { service } = harness({}, async () => respond(envelope({ NEEDS_REPLY: { type: 'noul', noul: 0.1 } })))
    const result = await service.decide('NEEDS_REPLY', 'hi')
    expect(result.ok && result.decision.meetsThreshold).toBe(false)
  })

  it('accepts an ad-hoc spec through decide()', async () => {
    const { service } = harness({}, async () => respond(envelope({ custom: { type: 'noul', noul: 0.5 } })))
    const result = await service.decide({ id: 'custom', type: 'noul', instructions: 'anything?' }, 'x' as Json)
    expect(result).toMatchObject({ ok: true, decision: { id: 'custom', answer: 0.5 } })
    expect(result.ok && result.decision.threshold).toBeUndefined()
  })

  it('propagates a caller abort as `aborted`', async () => {
    const controller = new AbortController()
    const { service } = harness({ timeoutMs: 5_000 }, () => new Promise<HttpResponse>(() => {}))
    const pending = service.judge({ state: 'hi', questions: [NOUL] }, { signal: controller.signal })
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, reason: 'aborted' })
  })

  it('keeps the registry ids and the spec projection in sync', () => {
    expect(questionSpec('SHOULD_START_WORK').id).toBe('SHOULD_START_WORK')
    expect(questionSpec('NEEDS_REPLY').type).toBe('noul')
  })
})
