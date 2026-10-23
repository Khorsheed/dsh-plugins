/**
 * Tasks: a human message that led to work, its follow-ups (filed by the
 * composer tag, the coordinator or the decision model) and everything its
 * work spawned, recorded at write time.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import RoomService from '../src/index.ts'
import { resolveTaskRef } from '../src/jobs.ts'
import { createRoom } from './promote.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

const finish = (text: string): SubagentResult => ({ output: [{ type: 'text', text }], stopReason: 'completed' })

/** A room with kimi and bill whose rounds wait on per-provider flights; `taskAnswer` scripts the attribution model. */
async function boot(taskAnswer?: { answer: string; probability: number }) {
  const ctx = new Context()
  const agent = { followup: vi.fn(), send: vi.fn(), whenIdle: vi.fn(async () => {}), cancel: vi.fn() }
  ctx.provide('agents', {
    get: () => agent,
    create: vi.fn(async (request: { sessionId: SessionId; meta?: Record<string, unknown> }) => {
      const session = ctx.sessions.create(request.sessionId, { meta: request.meta ?? {} })
      return { agent: { id: session.id, session }, dispose: async () => {} }
    }),
  } as never)
  if (taskAnswer !== undefined) {
    ctx.provide('typesafe', {
      judge: vi.fn(async (input: { questions: { id: string }[] }) => ({ ok: true, judgement: { decisions: input.questions.map(question => question.id === 'task'
        ? { id: 'task', answer: taskAnswer.answer, probabilities: { [taskAnswer.answer]: taskAnswer.probability } }
        : { id: question.id, answer: 0.9 }) } })),
    } as never)
  }
  const flights = new Map<string, ReturnType<typeof deferred<SubagentResult>>[]>()
  const run = (provider: string): SubagentRun => {
    const flight = deferred<SubagentResult>()
    flights.set(provider, [...flights.get(provider) ?? [], flight])
    return { id: SessionId(`child-${provider}`), localAgent: undefined, result: flight.promise, dispose: async () => {} }
  }
  const facade = {
    start: vi.fn(async (_parent: string, provider: string) => run(provider)),
    resume: vi.fn(async (_parent: string, provider: string) => run(provider)),
    cancel: vi.fn((child: string) => {
      const provider = child.replace('child-', '')
      flights.get(provider)?.at(-1)?.resolve({ output: [], stopReason: 'aborted' })
      return true
    }),
  }
  ctx.provide('localAgent', facade as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(RoomService)
  const service = ctx.get('room') as RoomService
  const sessionId = await createRoom(ctx, service)
  await service.invite({ sessionId, provider: 'kimi', name: 'kimi' })
  await service.invite({ sessionId, provider: 'codex', name: 'bill' })
  const state = async () => {
    const result = await service.getState({ sessionId })
    if (!result.ok) throw new Error('room unavailable')
    return result.value
  }
  return { ctx, service, sessionId, flights, facade, state }
}

describe('tasks', () => {
  it('a human @-message that leads to work is a task; the room agent\'s delegations from that turn join it', async () => {
    const bench = await boot()
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@kimi 实现登录接口' })
    await vi.waitFor(() => expect(bench.facade.start).toHaveBeenCalledOnce())
    // The room's own agent, answering that message, delegates more work.
    await bench.service.messageMember({ sessionId: bench.sessionId, member: 'bill', text: '准备测试' })
    const state = await bench.state()
    expect(state.jobs).toHaveLength(1)
    const [job] = state.jobs!
    expect(job).toMatchObject({ number: 1, title: '实现登录接口', status: 'running' })
    expect(job!.deliveries).toHaveLength(2)
    expect(job!.members).toHaveLength(2)
  })

  it('a follow-up while a task is open is filed by the decision model; the coordinator can re-file it as new', async () => {
    const bench = await boot({ answer: '1', probability: 0.88 })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@kimi 实现登录接口' })
    await vi.waitFor(() => expect(bench.facade.start).toHaveBeenCalledOnce())
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@bill 顺便把注册也测一下' })
    let state = await bench.state()
    expect(state.jobs).toHaveLength(1)
    expect(state.jobs![0]!.messages).toMatchObject([{ text: '@kimi 实现登录接口' }, { text: '@bill 顺便把注册也测一下', by: 'model', probability: 0.88 }])

    // The room's agent answering that follow-up decides it is new work after all.
    const sent = await bench.service.messageMember({ sessionId: bench.sessionId, member: 'kimi', text: '另起：写部署脚本', task: 'new' })
    expect(sent.ok).toBe(true)
    state = await bench.state()
    expect(state.jobs).toHaveLength(2)
    expect(state.jobs![0]!.title).toBe('顺便把注册也测一下')
    expect(state.jobs![0]!.messages[0]!.by).toBeUndefined()
    expect(await bench.service.messageMember({ sessionId: bench.sessionId, member: 'kimi', text: 'x', task: '9' }))
      .toEqual({ ok: false, error: { code: 'unknown-task' } })
  })

  it('the composer\'s tag files the next message under that task without asking the model', async () => {
    const bench = await boot({ answer: 'new', probability: 0.99 })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@kimi 实现登录接口' })
    await vi.waitFor(() => expect(bench.facade.start).toHaveBeenCalledOnce())
    const job = (await bench.state()).jobs![0]!
    await bench.service.setTaskHint({ sessionId: bench.sessionId, task: job.id })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@bill 也看看注册' })
    const state = await bench.state()
    expect(state.jobs).toHaveLength(1)
    expect(state.jobs![0]!.messages.at(-1)).toMatchObject({ text: '@bill 也看看注册', by: 'human' })
  })

  it('a member\'s sub-delegation nests under its own delivery in the same task', async () => {
    const bench = await boot()
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@kimi 实现登录接口' })
    await vi.waitFor(() => expect(bench.facade.start).toHaveBeenCalledOnce())
    await vi.waitFor(async () => expect((await bench.state()).members.find(member => member.name === 'kimi')?.childSessionId).toBe('child-kimi'))
    await bench.service.receiveMemberMessage({ from: 'child-kimi', to: 'bill', content: '帮我写测试', parentSessionId: bench.sessionId, provenance: { provider: 'kimi' } })
    const state = await bench.state()
    const [kimiRow, billRow] = state.deliveries!.filter(row => row.origin !== 'report')
    expect(billRow).toMatchObject({ task: kimiRow!.task, parent: kimiRow!.id })
    expect(kimiRow!.startedAt).toBeTypeOf('number')
  })

  it('stopping a task cancels its running and queued work', async () => {
    const bench = await boot()
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@kimi 实现登录接口' })
    await vi.waitFor(() => expect(bench.facade.start).toHaveBeenCalledOnce())
    await vi.waitFor(async () => expect((await bench.state()).members.find(member => member.name === 'kimi')?.childSessionId).toBe('child-kimi'))
    await bench.service.messageMember({ sessionId: bench.sessionId, member: 'kimi', text: '再补一个接口' })
    const job = (await bench.state()).jobs![0]!
    expect(await bench.service.stopJob({ sessionId: bench.sessionId, task: job.id })).toEqual({ ok: true, value: { stopped: 2 } })
    await bench.service.engine.idle()
    const state = await bench.state()
    expect(state.jobs![0]!.status).toBe('stopped')
    expect(bench.facade.resume).not.toHaveBeenCalled()
  })

  it('resolves task references', () => {
    const jobs = [{ id: 'a', number: 1 }, { id: 'b', number: 2 }] as never
    expect([resolveTaskRef(jobs, 'new'), resolveTaskRef(jobs, '2'), resolveTaskRef(jobs, '任务 1'), resolveTaskRef(jobs, '#2'), resolveTaskRef(jobs, '7')])
      .toEqual(['new', 'b', 'a', 'b', undefined])
  })
})
