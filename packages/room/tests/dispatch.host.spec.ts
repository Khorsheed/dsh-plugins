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
    // First dispatch: role instructions open the prompt, the roster carries
    // the notification protocol, the task is the tail.
    expect(text).toContain('你的角色指令：后端')
    expect(text).toContain('【成员名册】')
    expect(text).toContain('通知协议')
    expect(text).toContain('搭骨架')

    const state = await bench.service.getState({ sessionId: bench.sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: {
        // The delegation handle is journaled (reload reattaches the member).
        members: [{ name: 'main' }, { name: 'ada', childSessionId: 'child-1' }],
        // The dispatch auto-opened the task; the settle (speech) closed it.
        tasks: [{ member: 'ada', title: '搭骨架', status: 'done' }],
        runs: [{ member: 'ada', state: 'done' }],
      },
    })
  })

  it('the roster lists the other members with one-line roles; the prompt carries NO running log', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-1', '方案 A'))
    bench.facade.resume.mockImplementation(async () => settledRun('child-1', '按方案 A 实现完毕'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', instructions: '后端工程师\n负责 API', firstTask: '出方案' })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'codex', name: 'bill', instructions: '前端', firstTask: '搭页面' })
    await bench.service.engine.idle()

    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 按方案 A 实现' })
    await bench.service.engine.idle()

    expect(bench.facade.resume).toHaveBeenCalledTimes(1)
    const [parentId, provider, childSessionId, prompt] = bench.facade.resume.mock.calls[0] as [string, string, string, ContentBlock[]]
    expect([parentId, provider, childSessionId]).toEqual([bench.sessionId, 'kimi', 'child-1'])
    const text = textOf(prompt)
    // The roster: the OTHER members (self excluded), one-line roles, protocol.
    expect(text).toContain('- bill（codex）：前端')
    expect(text).toContain('- main（主 agent）')
    expect(text).not.toContain('- ada')
    // No blackboard: nothing replays ada's earlier dispatch, bill's task,
    // ada's own speech, or the initial instructions again; the dispatch text
    // rides the tail exactly once.
    expect(text).not.toContain('黑板')
    expect(text).not.toContain('搭页面')
    expect(text).not.toContain('出方案')
    expect(text).not.toContain('[ada]')
    expect(text).not.toContain('你的角色指令')
    expect(text.split('按方案 A 实现')).toHaveLength(2)
  })

  it('the roster section carries the room goal on top when set, and omits it when unset', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-1', 'done'))
    bench.facade.resume.mockImplementation(async () => settledRun('child-1', 'done'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: '出方案' })
    await bench.service.engine.idle()
    // Unset: no goal line.
    expect(textOf(bench.facade.start.mock.calls[0]![2] as ContentBlock[])).not.toContain('本房间的目标')

    await bench.service.setGoal({ sessionId: bench.sessionId, text: '插件 API v2 上线' })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 继续' })
    await bench.service.engine.idle()
    const text = textOf(bench.facade.resume.mock.calls[0]![3] as ContentBlock[])
    expect(text).toContain('【成员名册】\n本房间的目标：插件 API v2 上线')
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

  it('a reply whose trailing own line is `@name <content>` becomes a pending relay (fallback channel)', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-1', '方案已定。\n@bill 接口定稿了，请评审'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: '出方案' })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'codex', name: 'bill' })
    await bench.service.engine.idle()

    const state = await bench.service.getState({ sessionId: bench.sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: {
        relays: [{ from: 'ada', to: 'bill', content: '接口定稿了，请评审', state: 'pending' }],
      },
    })
  })

  it('a confirmed relay delivers as a continuation and is marked sent; a later dispatch re-carries an undelivered one', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-1', 'done'))
    bench.facade.resume.mockImplementation(async () => settledRun('child-1', '收到'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: '出方案' })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'codex', name: 'bill', firstTask: '待命' })
    await bench.service.engine.idle()

    await bench.service.receiveMemberMessage({
      from: 'ada', to: 'bill', content: '接口定稿', parentSessionId: bench.sessionId,
    })
    const pending = await bench.service.getState({ sessionId: bench.sessionId })
    if (!pending.ok) throw new Error('narrowing')
    const relay = pending.value.relays[0]!
    expect(relay.state).toBe('pending')

    await bench.service.confirmRelay({ sessionId: bench.sessionId, relayId: relay.id })
    await bench.service.engine.idle()
    // bill's continuation: the notification is the prompt tail.
    const delivery = bench.facade.resume.mock.calls[0] as [string, string, string, ContentBlock[]]
    expect(delivery[2]).toBe('child-1')
    expect(textOf(delivery[3])).toContain('ada 给你的通知: 接口定稿')

    const sent = await bench.service.getState({ sessionId: bench.sessionId })
    expect(sent).toMatchObject({ ok: true, value: { relays: [{ state: 'sent' }] } })

    // A relay confirmed while delivery fails stays 'confirmed' and rides the
    // member's NEXT dispatch in the notifications section.
    await bench.service.receiveMemberMessage({
      from: 'ada', to: 'bill', content: '别忘了超时', parentSessionId: bench.sessionId,
    })
    const second = (await bench.service.getState({ sessionId: bench.sessionId }))
    if (!second.ok) throw new Error('narrowing')
    const relay2 = second.value.relays[1]!
    // The facade vanishes: the confirm's dispatch fails before delivery.
    for (const key of Object.keys(bench.localAgentStub)) delete bench.localAgentStub[key]
    await bench.service.confirmRelay({ sessionId: bench.sessionId, relayId: relay2.id })
    await bench.service.engine.idle()
    const stuck = await bench.service.getState({ sessionId: bench.sessionId })
    expect(stuck).toMatchObject({ ok: true, value: { relays: [{ state: 'sent' }, { state: 'confirmed' }] } })

    // The facade returns; a human @bill dispatch carries the stuck relay.
    Object.assign(bench.localAgentStub, bench.facade)
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@bill 继续' })
    await bench.service.engine.idle()
    const carriedPrompt = textOf(bench.facade.resume.mock.calls[1]![3] as ContentBlock[])
    expect(carriedPrompt).toContain('【通知】')
    expect(carriedPrompt).toContain('- ada 给你的通知: 别忘了超时')
    expect(carriedPrompt).toContain('继续')
    const delivered = await bench.service.getState({ sessionId: bench.sessionId })
    expect(delivered).toMatchObject({ ok: true, value: { relays: [{ state: 'sent' }, { state: 'sent' }] } })
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
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@main 总结一下进度' })
    await bench.service.engine.idle()

    expect(bench.agent!.followup).toHaveBeenCalledTimes(1)
    const message = bench.agent!.followup.mock.calls[0]![0] as UserMessage
    expect(message.source).toEqual({ kind: 'plugin', plugin: ROOM_PLUGIN })
    const text = textOf(message.content)
    expect(text).toContain('总结一下进度')
    expect(text).toContain('【成员名册】')

    const state = await bench.service.getState({ sessionId: bench.sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: {
        tasks: [{ member: 'main', title: '总结一下进度', status: 'done' }],
        runs: [{ member: 'main', state: 'done' }],
      },
    })
    expect(bench.ctx.sessions.get(bench.sessionId)!.events.some(event => event.type === 'room/speech')).toBe(false)
  })

  it('fails loud when the room agent is not live', async () => {
    const bench = await bootRoom({ liveAgent: false })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@main 在吗' })
    await bench.service.engine.idle()
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    // The failed edge carries the reason (the client's dim row surfaces it).
    expect(state).toMatchObject({
      ok: true,
      value: { runs: [{ member: 'main', state: 'failed', error: 'the room session has no live agent' }] },
    })
    // A failed run leaves the auto-opened task open for the human.
    expect(state).toMatchObject({ ok: true, value: { tasks: [{ member: 'main', status: 'in_progress' }] } })
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
    expect(state).toMatchObject({
      ok: true,
      value: { runs: [{ member: 'ada', state: 'failed', error: 'the local-agent delegation facade is unavailable' }] },
    })
  })

  it('an adapter throw fails the run with the fault message on the edge', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockRejectedValue(new Error('unknown delegation provider "kimi"'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: '干活' })
    await bench.service.engine.idle()
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: { runs: [{ member: 'ada', state: 'failed', error: 'unknown delegation provider "kimi"' }] },
    })
  })

  it('a non-completed, non-aborted stopReason fails the run with the reason on the edge', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-1', '', 'error'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: '干活' })
    await bench.service.engine.idle()
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: { runs: [{ member: 'ada', state: 'failed', error: 'the member run ended with stopReason "error"' }] },
    })
  })

  it('journals the running and done edges with the SAME startedAt (the client fold key)', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-1', '搞定'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: '干活' })
    await bench.service.engine.idle()
    const edges = bench.ctx.sessions.get(bench.sessionId)!.events
      .filter(event => event.type === 'room/run-state')
      .map(event => event.data as { state: string; startedAt: number })
    expect(edges.map(edge => edge.state)).toEqual(['running', 'done'])
    expect(edges[1]!.startedAt).toBe(edges[0]!.startedAt)
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
    // The cancelled run closed the auto-opened task as cancelled.
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    expect(state).toMatchObject({ ok: true, value: { tasks: [{ member: 'ada', status: 'cancelled' }] } })
  })
})
