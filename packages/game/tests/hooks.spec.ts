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
  let pending: string | undefined = '自上一轮以来，用户在右栏游戏面板里改了：\n- 参数 速度 1→2\n这些改动已经生效。'
  const store = {
    checkTurn: async (_s: unknown, attempt: number) => { attempts.push(attempt); return outcome(attempt) },
    takePending: async () => { const p = pending; pending = undefined; return p },
  } as unknown as GameService
  registerTurnHooks(ctx, store)
  const steers: string[] = []
  const agent = { session: { id: 's1' }, steer: (m: { content: { text: string }[] }) => { steers.push(m.content[0]!.text) } }
  const stop = (turn: number, aborted = false) => (handlers['agent/turn-stopping'] as unknown as (p: unknown) => Promise<void>)(
    { agent, turn, signal: { aborted } })
  const end = (turn: number) => (handlers['session/event'] as unknown as (s: unknown, e: unknown) => void)({ id: 's1' }, { type: 'turn/end', data: { turn } })
  const preStep = (messages: unknown[], aborted = false) => (handlers['agent/pre-step'] as unknown as (p: unknown, next: () => Promise<unknown>) => Promise<{ kind: string; messages: { source: Record<string, unknown> }[] }>)(
    { agent, signal: { aborted } }, async () => ({ kind: 'enter', messages }))
  return { stop, end, steers, attempts, preStep }
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

  it('attaches pending panel changes once, after the batch, with the items in the source', async () => {
    const h = harness(() => ({ kind: 'skip' }))
    expect((await h.preStep([])).messages).toEqual([])
    const first = await h.preStep([{ user: true }])
    expect(first.messages).toHaveLength(2)
    expect(first.messages[1]!.source).toMatchObject({ kind: 'dsh-game', op: 'attached', items: ['参数 速度 1→2'] })
    expect((await h.preStep([{ user: true }])).messages).toHaveLength(1)
  })

  it('words findings for the model', () => {
    const text = failureText({ ...failing, skipped: '没找到 Chrome' }, 1)
    expect(text).toContain('- tests/a.test.js › 走：期望 150，实际 112')
    expect(text).toContain('（没找到 Chrome）')
  })
})
