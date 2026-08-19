import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import RoomService from '../src/index.ts'
import { ROOM_PLUGIN } from '../src/dispatch.ts'
import type { LocalAgentFacade } from '../src/adapter.ts'

/** A manually settled promise. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

/** Flush the microtask/macrotask queue so the engine's queued tasks advance. */
function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function textOf(blocks: readonly ContentBlock[]): string {
  return blocks.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('\n')
}

interface Bench {
  ctx: Context
  service: RoomService
  sessionId: SessionId
  facade: LocalAgentFacade & {
    start: ReturnType<typeof vi.fn>
    resume: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
  }
  localAgentStub: Record<string, unknown>
  agent: { followup: ReturnType<typeof vi.fn>; whenIdle: ReturnType<typeof vi.fn> } | undefined
}

/**
 * The REAL composition with stubbed external services. The facade is
 * scripted per test through `facade.start`/`facade.resume` implementations;
 * `localAgentStub` is the SAME object the probe reads, so deleting its
 * methods simulates the facade vanishing mid-flight.
 */
async function bootRoom(options: { liveAgent?: boolean } = {}): Promise<Bench> {
  const ctx = new Context()
  const agent = options.liveAgent === false
    ? undefined
    : { followup: vi.fn(), whenIdle: vi.fn(async () => {}) }
  ctx.provide('agents', {
    get: () => agent,
    // createRoom publishes through the factory: mint the session via the
    // real store, as the agent factory would.
    create: vi.fn(async (request: { sessionId: SessionId; meta?: Record<string, unknown> }) => {
      const session = ctx.sessions.create(request.sessionId, { meta: request.meta ?? {} })
      return { agent: { id: session.id, session }, dispose: async () => {} }
    }),
  } as never)
  const facade = {
    start: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(() => false),
  }
  const localAgentStub: Record<string, unknown> = { ...facade }
  ctx.provide('localAgent', localAgentStub as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(RoomService)
  const service = ctx.get('room') as RoomService
  const { sessionId } = await service.createRoom({})
  return { ctx, service, sessionId, facade: facade as Bench['facade'], localAgentStub, agent }
}

/** A settled run handle. */
function settledRun(id: string, text: string, stopReason: SubagentResult['stopReason'] = 'completed'): SubagentRun {
  return {
    id: SessionId(id),
    localAgent: undefined,
    result: Promise.resolve({ output: [{ type: 'text', text }], stopReason }),
    dispose: async () => {},
  }
}

describe('DispatchEngine (real composition)', () => {
  it('a first task starts a fresh delegation, journals the handle, the speech, and the run edges', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-1', '骨架已搭'))
    await bench.service.invite({
      sessionId: bench.sessionId, provider: 'kimi', name: 'ada', instructions: '后端', firstTask: '搭骨架',
    })
    await bench.service.engine.idle()

    expect(bench.facade.start).toHaveBeenCalledTimes(1)
    const [parentId, provider, prompt] = bench.facade.start.mock.calls[0] as [string, string, ContentBlock[]]
    expect(parentId).toBe(bench.sessionId)
    expect(provider).toBe('kimi')
    const text = textOf(prompt)
    // First dispatch: role instructions open the prompt, the task is the tail.
    expect(text).toContain('你的角色指令：后端')
    expect(text).toContain('搭骨架')

    const state = await bench.service.getState({ sessionId: bench.sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: {
        // The delegation handle is journaled (reload reattaches the member).
        members: [{ name: 'main' }, { name: 'ada', childSessionId: 'child-1' }],
        blackboard: [
          { kind: 'dispatch', targets: ['ada'], text: '搭骨架' },
          { kind: 'speech', member: 'ada', text: '骨架已搭', childSessionId: 'child-1' },
        ],
        runs: [{ member: 'ada', state: 'done' }],
      },
    })
  })

  it('a later dispatch resumes the CLI conversation with the blackboard increment', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-1', '方案 A'))
    bench.facade.resume.mockImplementation(async () => settledRun('child-1', '按方案 A 实现完毕'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', instructions: '后端', firstTask: '出方案' })
    await bench.service.engine.idle()

    await bench.service.postMessage({ sessionId: bench.sessionId, text: '补充：接口走 REST' })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 按方案 A 实现' })
    await bench.service.engine.idle()

    expect(bench.facade.resume).toHaveBeenCalledTimes(1)
    const [parentId, provider, childSessionId, prompt] = bench.facade.resume.mock.calls[0] as [string, string, string, ContentBlock[]]
    expect([parentId, provider, childSessionId]).toEqual([bench.sessionId, 'kimi', 'child-1'])
    const text = textOf(prompt)
    // The increment covers what happened since ada's last dispatch: the note
    // and ada's own speech — but not the initial instructions again, and the
    // current dispatch text rides the tail exactly once.
    expect(text).toContain('【房间黑板')
    expect(text).toContain('人: 补充：接口走 REST')
    expect(text).toContain('[ada]: 方案 A')
    expect(text).not.toContain('你的角色指令')
    expect(text.split('按方案 A 实现')).toHaveLength(2)
  })

  it('an instructions edit rides the next dispatch as an update notice', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-1', 'done'))
    bench.facade.resume.mockImplementation(async () => settledRun('child-1', 'done'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', instructions: '后端', firstTask: '出方案' })
    await bench.service.engine.idle()
    await bench.service.updateMember({ sessionId: bench.sessionId, name: 'ada', instructions: '后端 + 接口评审' })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 继续' })
    await bench.service.engine.idle()

    const prompt = bench.facade.resume.mock.calls[0]![3] as ContentBlock[]
    expect(textOf(prompt)).toContain('你的角色指令更新为：后端 + 接口评审')
  })

  it('serializes one member (FIFO) while different members run in parallel', async () => {
    const bench = await bootRoom()
    const first = deferred<SubagentResult>()
    const billFlight = deferred<SubagentResult>()
    bench.facade.start.mockImplementationOnce(async () => ({
      id: SessionId('child-ada'), localAgent: undefined, result: first.promise, dispose: async () => {},
    }))
    bench.facade.start.mockImplementationOnce(async () => ({
      id: SessionId('child-bill'), localAgent: undefined, result: billFlight.promise, dispose: async () => {},
    }))
    bench.facade.resume.mockImplementation(async () => settledRun('child-ada', '任务二完成'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada' })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'codex', name: 'bill' })

    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 任务一' })
    await tick()
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 任务二' })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@bill 任务' })
    await tick()
    await tick()
    // bill started in parallel; ada's second dispatch waits for the first run.
    expect(bench.facade.start).toHaveBeenCalledTimes(2)
    expect(bench.facade.resume).not.toHaveBeenCalled()

    first.resolve({ output: [{ type: 'text', text: '任务一完成' }], stopReason: 'completed' })
    await tick()
    await tick()
    expect(bench.facade.resume).toHaveBeenCalledTimes(1)
    const resumeCall = bench.facade.resume.mock.calls[0] as [string, string, string, ContentBlock[]]
    expect(resumeCall[2]).toBe('child-ada')
    expect(textOf(resumeCall[3])).toContain('任务二')
    billFlight.resolve({ output: [{ type: 'text', text: 'done' }], stopReason: 'completed' })
    await bench.service.engine.idle()
  })

  it('the main-agent member gets a plugin-sourced followup and no speech projection', async () => {
    const bench = await bootRoom()
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@main 总结一下黑板' })
    await bench.service.engine.idle()

    expect(bench.agent!.followup).toHaveBeenCalledTimes(1)
    const message = bench.agent!.followup.mock.calls[0]![0] as UserMessage
    expect(message.source).toEqual({ kind: 'plugin', plugin: ROOM_PLUGIN })
    expect(textOf(message.content)).toContain('总结一下黑板')

    const state = await bench.service.getState({ sessionId: bench.sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: {
        blackboard: [{ kind: 'dispatch', targets: ['main'] }],
        runs: [{ member: 'main', state: 'done' }],
      },
    })
  })

  it('fails loud when the room agent is not live', async () => {
    const bench = await bootRoom({ liveAgent: false })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@main 在吗' })
    await bench.service.engine.idle()
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    expect(state).toMatchObject({ ok: true, value: { runs: [{ member: 'main', state: 'failed' }] } })
  })

  it('fails the run when the facade vanishes mid-flight', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-1', 'done'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada' })
    // The facade disappears AFTER the invitation (plugin uninstalled).
    for (const key of Object.keys(bench.localAgentStub)) delete bench.localAgentStub[key]
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 干活' })
    await bench.service.engine.idle()
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    expect(state).toMatchObject({ ok: true, value: { runs: [{ member: 'ada', state: 'failed' }] } })
  })

  it('cancel journals one terminal cancelled edge and the settle path does not double-append', async () => {
    const bench = await bootRoom()
    const flight = deferred<SubagentResult>()
    bench.facade.start.mockImplementation(async () => ({
      id: SessionId('child-1'), localAgent: undefined, result: flight.promise, dispose: async () => {},
    }))
    bench.facade.cancel.mockImplementation(() => true)
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: '长任务' })
    await tick()
    await tick()

    expect(await bench.service.cancel({ sessionId: bench.sessionId, name: 'ada' }))
      .toEqual({ ok: true, value: { cancelled: true } })
    expect(bench.facade.cancel).toHaveBeenCalledWith('child-1')

    flight.resolve({ output: [], stopReason: 'aborted' })
    await bench.service.engine.idle()
    const session = bench.ctx.sessions.get(bench.sessionId)!
    const edges = session.events.filter(event => event.type === 'room/run-state')
    // Exactly running + cancelled: the engine's settle saw the cancel edge and no-oped.
    expect(edges.map(event => (event.data as { state: string }).state)).toEqual(['running', 'cancelled'])
    expect(session.events.some(event => event.type === 'room/speech')).toBe(false)
  })
})
