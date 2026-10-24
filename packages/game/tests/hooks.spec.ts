import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { FIX_CAP, failureText, registerTurnHooks } from '../src/hooks.ts'
import type { GameService, TurnCheckOutcome } from '../src/store.ts'
import type { CheckRecord } from '../src/types.ts'

const failing: CheckRecord = { fingerprint: 'f', at: '', ok: false, failures: [{ where: 'tests/a.test.js › 走', message: '期望 150，实际 112' }], passed: 0, attempt: 0 }

function harness(outcome: (attempt: number) => TurnCheckOutcome) {
  const handlers: Record<string, (...args: never[]) => unknown> = {}
  const ctx = { on: (name: string, fn: (...args: never[]) => unknown) => { handlers[name] = fn }, logger: { warn: () => {} } } as unknown as Context
  const attempts: number[] = []
  const cleared: string[] = []
  const store = {
    checkTurn: async (_s: unknown, attempt: number) => { attempts.push(attempt); return outcome(attempt) },
    clearSent: async (_s: string, text: string) => { cleared.push(text); return 1 },
    setTurnActive: () => {},
  } as unknown as GameService
  registerTurnHooks(ctx, store)
  const steers: string[] = []
  const agent = { session: { id: 's1' }, steer: (m: { content: { text: string }[] }) => { steers.push(m.content[0]!.text) } }
  const stop = (turn: number, aborted = false) => (handlers['agent/turn-stopping'] as unknown as (p: unknown) => Promise<void>)(
    { agent, turn, signal: { aborted } })
  const end = (turn: number) => (handlers['session/event'] as unknown as (s: unknown, e: unknown) => void)({ id: 's1' }, { type: 'turn/end', data: { turn } })
  const preStep = (messages: unknown[], aborted = false) => (handlers['agent/pre-step'] as unknown as (p: unknown, next: () => Promise<unknown>) => Promise<{ kind: string; messages: { source: Record<string, unknown> }[] }>)(
    { agent, signal: { aborted } }, async () => ({ kind: 'enter', messages }))
  return { stop, end, steers, attempts, preStep, cleared }
}

describe('the end-of-turn loop', () => {
  it('steers a failure back at most FIX_CAP times per turn', async () => {
    const h = harness(() => ({ kind: 'fail', record: failing }))
    await h.stop(1)
    await h.stop(1)
    await h.stop(1)
    expect(h.attempts).toEqual([0, 1, 2])
    expect(h.steers).toHaveLength(FIX_CAP)
    expect(h.steers[0]).toContain('[游戏检查未通过 1/2]')
    expect(h.steers[1]).toContain('最后一次')
    h.end(1)
    await h.stop(2)
    expect(h.attempts.at(-1)).toBe(0)
  })

  it('does nothing on a pass, a skip or an aborted turn', async () => {
    const h = harness(() => ({ kind: 'skip' }))
    await h.stop(1)
    await h.stop(2, true)
    expect(h.steers).toEqual([])
    expect(h.attempts).toEqual([0])
  })

  it('never adds to the batch; a sent panel-changes message clears what it lists', async () => {
    const h = harness(() => ({ kind: 'skip' }))
    const plain = [{ content: [{ type: 'text', text: '雾怪是不是太快了？' }] }]
    expect((await h.preStep(plain)).messages).toEqual(plain)
    expect(h.cleared).toEqual([])
    const sent = [{ content: [{ type: 'text', text: '【面板改动】我在右栏面板里改了这些：\n- 参数 速度 1→2\n\n手感好多了' }] }]
    expect((await h.preStep(sent)).messages).toEqual(sent)
    expect(h.cleared).toHaveLength(1)
  })

  it('words findings for the model', () => {
    const text = failureText({ ...failing, skipped: '没找到 Chrome' }, 1)
    expect(text).toContain('- tests/a.test.js › 走：期望 150，实际 112')
    expect(text).toContain('（没找到 Chrome）')
  })
})
