/**
 * The report gate: rules first, then the decision model decides only WHEN a
 * report reaches the member waiting on it; held reports sit in its inbox and
 * are released by the last result, a later round, a human, or a restart.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import RoomService from '../src/index.ts'
import { judgeReport } from '../src/report-gate.ts'
import { pendingHolds } from '../src/dispatch.ts'
import { createRoom } from './promote.ts'

function textOf(blocks: readonly ContentBlock[]): string {
  return blocks.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('\n')
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

function run(id: string, result: Promise<SubagentResult>): SubagentRun {
  return { id: SessionId(id), localAgent: undefined, result, dispose: async () => {} }
}

describe('judgeReport (rules)', () => {
  const ctx = new Context()
  const base = { timing: 'judge' as const, outcome: 'done', outstanding: 2, state: () => ({}) }
  it('hands over at once for the each setting, a failure, the last result, or no decision model', async () => {
    expect(await judgeReport(ctx, { ...base, timing: 'each' })).toEqual({ hold: false, reason: 'setting' })
    expect(await judgeReport(ctx, { ...base, outcome: 'failed' })).toEqual({ hold: false, reason: 'failure' })
    expect(await judgeReport(ctx, { ...base, outstanding: 0 })).toEqual({ hold: false, reason: 'last' })
    expect(await judgeReport(ctx, base)).toEqual({ hold: false, reason: 'unavailable' })
  })

  it('asks the model otherwise; a failed call hands over', async () => {
    const model = new Context()
    const judge = vi.fn(async () => ({ ok: true, judgement: { decisions: [{ id: 'deliver_now', answer: 0.2 }] } }))
    model.provide('typesafe', { judge } as never)
    expect(await judgeReport(model, base)).toEqual({ hold: true, reason: 'model', probability: 0.2 })
    judge.mockResolvedValueOnce({ ok: true, judgement: { decisions: [{ id: 'deliver_now', answer: 0.8 }] } })
    expect(await judgeReport(model, base)).toEqual({ hold: false, reason: 'model', probability: 0.8 })
    judge.mockResolvedValueOnce({ ok: false, reason: 'timeout' } as never)
    expect(await judgeReport(model, base)).toEqual({ hold: false, reason: 'unavailable' })
  })
})

async function boot(answer: number) {
  const ctx = new Context()
  const agent = { followup: vi.fn(), send: vi.fn(), whenIdle: vi.fn(async () => {}) }
  ctx.provide('agents', {
    get: () => agent,
    create: vi.fn(async (request: { sessionId: SessionId; meta?: Record<string, unknown> }) => {
      const session = ctx.sessions.create(request.sessionId, { meta: request.meta ?? {} })
      return { agent: { id: session.id, session }, dispose: async () => {} }
    }),
  } as never)
  const judge = vi.fn(async (_input: { state: unknown }) => ({ ok: true, judgement: { decisions: [{ id: 'deliver_now', answer }] } }))
  ctx.provide('typesafe', { judge } as never)
  const flights = new Map<string, ReturnType<typeof deferred<SubagentResult>>>()
  const facade = {
    start: vi.fn(async (_parent: string, provider: string) => {
      const flight = deferred<SubagentResult>()
      flights.set(provider, flight)
      return run(`child-${provider}`, flight.promise)
    }),
    resume: vi.fn(), cancel: vi.fn(() => false),
  }
  ctx.provide('localAgent', facade as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(RoomService)
  const service = ctx.get('room') as RoomService
  const sessionId = await createRoom(ctx, service)
  return { ctx, service, sessionId, agent, judge, flights, facade }
}

const finish = (text: string): SubagentResult => ({ output: [{ type: 'text', text }], stopReason: 'completed' })
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('report gate in the room', () => {
  it('holds an early result in the coordinator\'s inbox and hands everything over with the last one', async () => {
    const bench = await boot(0.1)
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada' })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'codex', name: 'bill' })
    await bench.service.messageMember({ sessionId: bench.sessionId, member: 'ada', text: '打招呼', note: '两位都打完招呼再一起跟用户说' })
    await bench.service.messageMember({ sessionId: bench.sessionId, member: 'bill', text: '打招呼' })
    await vi.waitFor(() => expect(bench.facade.start).toHaveBeenCalledTimes(2))

    bench.flights.get('kimi')!.resolve(finish('我是 ada'))
    await vi.waitFor(() => expect(bench.agent.send).toHaveBeenCalledOnce())
    // Held: in the inbox without waking (no followup), judged with the note.
    const [held, target, wakeup] = bench.agent.send.mock.calls[0]! as [UserMessage, string, boolean]
    expect([target, wakeup]).toEqual(['next-turn', false])
    expect(textOf(held.content)).toMatch(/【#m\d+ 的回报 · 来自 ada · 完成】.*不要复述/)
    expect(textOf(held.content)).toContain('我是 ada')
    expect(bench.agent.followup).not.toHaveBeenCalled()
    const asked = bench.judge.mock.calls[0]![0].state as { coordinatorNotes: string[]; progress: { done: number; total: number } }
    expect(asked.coordinatorNotes).toEqual(['两位都打完招呼再一起跟用户说'])
    expect(asked.progress).toMatchObject({ done: 1, total: 2 })
    const session = bench.ctx.sessions.get(bench.sessionId)!
    expect(session.snapshotEvents().filter(event => event.type === 'room/report-gate').map(event => event.type === 'room/report-gate' ? [event.data.verdict, event.data.reason] : []))
      .toEqual([['hold', 'model']])

    // The last result needs no model: it wakes the coordinator, which then has both.
    bench.flights.get('codex')!.resolve(finish('我是 bill'))
    await vi.waitFor(() => expect(bench.agent.followup).toHaveBeenCalledOnce())
    await bench.service.engine.idle()
    expect(bench.judge).toHaveBeenCalledOnce()
    expect(textOf((bench.agent.followup.mock.calls[0]![0] as UserMessage).content)).toContain('我是 bill')
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    if (!state.ok) throw new Error('room unavailable')
    expect(pendingHolds(session.snapshotEvents(), state.value.members.find(member => member.name === 'dsh')!.id!)).toEqual([])
  })

  it('a human can hand held reports over at once', async () => {
    const bench = await boot(0.1)
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada' })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'codex', name: 'bill' })
    await bench.service.messageMember({ sessionId: bench.sessionId, member: 'ada', text: '打招呼' })
    await bench.service.messageMember({ sessionId: bench.sessionId, member: 'bill', text: '打招呼' })
    await vi.waitFor(() => expect(bench.facade.start).toHaveBeenCalledTimes(2))
    bench.flights.get('kimi')!.resolve(finish('我是 ada'))
    await vi.waitFor(() => expect(bench.agent.send).toHaveBeenCalledOnce())
    await tick()
    expect(await bench.service.releaseReports({ sessionId: bench.sessionId, name: 'dsh' })).toEqual({ ok: true, value: { released: true } })
    await vi.waitFor(() => expect(bench.agent.followup).toHaveBeenCalledOnce())
    expect(textOf((bench.agent.followup.mock.calls[0]![0] as UserMessage).content)).toMatch(/1 条回报一直等着交给你：#m\d+/)
    expect(await bench.service.releaseReports({ sessionId: bench.sessionId, name: 'dsh' })).toEqual({ ok: true, value: { released: false } })
    bench.flights.get('codex')!.resolve(finish('我是 bill'))
    await bench.service.engine.idle()
  })

  it('a high probability hands the report over immediately', async () => {
    const bench = await boot(0.9)
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada' })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'codex', name: 'bill' })
    await bench.service.messageMember({ sessionId: bench.sessionId, member: 'ada', text: '写接口', note: '做完就交给 bill 审' })
    await bench.service.messageMember({ sessionId: bench.sessionId, member: 'bill', text: '准备' })
    await vi.waitFor(() => expect(bench.facade.start).toHaveBeenCalledTimes(2))
    bench.flights.get('kimi')!.resolve(finish('接口写好了'))
    await vi.waitFor(() => expect(bench.agent.followup).toHaveBeenCalledOnce())
    expect(bench.agent.send).not.toHaveBeenCalled()
    bench.flights.get('codex')!.resolve(finish('好了'))
    await bench.service.engine.idle()
  })
})
