import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
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
    // Rooms mint through the factory: the session via the real store, as
    // the agent factory would.
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
  const sessionId = await createRoom(ctx, service)
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

  it('the invite-time model lands as the delegation start call option (absent without one)', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-1', 'done'))
    await bench.service.invite({
      sessionId: bench.sessionId, provider: 'kimi', name: 'ada', model: 'kimi-k2', firstTask: '搭骨架',
    })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'codex', name: 'bill', firstTask: '搭页面' })
    await bench.service.engine.idle()

    expect(bench.facade.start).toHaveBeenCalledTimes(2)
    // ada invited with a model: the facade start's `model` call option.
    expect(bench.facade.start.mock.calls[0]![3]).toEqual({ model: 'kimi-k2' })
    // bill invited without one: no options argument at all (harness default).
    expect(bench.facade.start.mock.calls[1]![3]).toBeUndefined()
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

  it('the goal line rides every dispatch; the roster rides only a stale one', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-1', 'done'))
    bench.facade.resume.mockImplementation(async () => settledRun('child-1', 'done'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: '出方案' })
    await bench.service.engine.idle()
    const first = textOf(bench.facade.start.mock.calls[0]![2] as ContentBlock[])
    // First dispatch: the roster (with the protocol) opens the member's world;
    // no goal line while unset.
    expect(first).toContain('【成员名册】')
    expect(first).not.toContain('本房间的目标')

    await bench.service.setGoal({ sessionId: bench.sessionId, text: '插件 API v2 上线' })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 继续' })
    await bench.service.engine.idle()
    const second = textOf(bench.facade.resume.mock.calls[0]![3] as ContentBlock[])
    // The roster is unchanged since ada's last dispatch: omitted (the member's
    // own session holds it). The goal still orients every dispatch.
    expect(second).toContain('本房间的目标：插件 API v2 上线')
    expect(second).not.toContain('【成员名册】')
    expect(second).not.toContain('通知协议')

    // A roster change (bill joins) re-carries the roster on the next dispatch.
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'codex', name: 'bill' })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 再继续' })
    await bench.service.engine.idle()
    const third = textOf(bench.facade.resume.mock.calls[1]![3] as ContentBlock[])
    expect(third).toContain('【成员名册】')
    expect(third).toContain('- bill（codex）')
    expect(third).toContain('本房间的目标：插件 API v2 上线')
  })

  it('a roster-invisible update (the journaled childSessionId handle) does not re-carry the roster', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-1', 'done'))
    bench.facade.resume.mockImplementation(async () => settledRun('child-1', 'done'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: '出方案' })
    await bench.service.engine.idle()
    // The first run journaled member-updated { childSessionId } AFTER ada's
    // dispatch: roster-invisible, so the next dispatch stays lean.
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 继续' })
    await bench.service.engine.idle()
    const second = textOf(bench.facade.resume.mock.calls[0]![3] as ContentBlock[])
    expect(second).not.toContain('【成员名册】')
    expect(second).toContain('继续')
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
    expect(bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents().some(event => event.type === 'room/speech')).toBe(false)
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
    // A failed run closes the auto-opened task as failed — the board shows
    // the failed row for the human (never a stranded spinning in_progress).
    expect(state).toMatchObject({ ok: true, value: { tasks: [{ member: 'main', status: 'failed' }] } })
  })

  it('a failed task stays human-actionable: closeTask dismisses it to cancelled', async () => {
    const bench = await bootRoom({ liveAgent: false })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@main 在吗' })
    await bench.service.engine.idle()
    const before = await bench.service.getState({ sessionId: bench.sessionId })
    if (!before.ok) throw new Error('narrowing')
    const task = before.value.tasks[0]!
    expect(task.status).toBe('failed')
    // The board's [关闭]: a failed task is NOT task-closed — it closes to cancelled.
    expect(await bench.service.closeTask({ sessionId: bench.sessionId, taskId: task.id, status: 'cancelled' }))
      .toEqual({ ok: true, value: { id: task.id } })
    expect(await bench.service.getState({ sessionId: bench.sessionId })).toMatchObject({
      ok: true,
      value: { tasks: [{ id: task.id, status: 'cancelled' }] },
    })
    // Closed for real now: a second close is the usual task-closed rejection.
    expect(await bench.service.closeTask({ sessionId: bench.sessionId, taskId: task.id }))
      .toEqual({ ok: false, error: { code: 'task-closed' } })
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
      value: {
        runs: [{ member: 'ada', state: 'failed', error: 'the local-agent delegation facade is unavailable' }],
        tasks: [{ member: 'ada', status: 'failed' }],
      },
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
    const edges = bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents()
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
    const edges = session.snapshotEvents().filter(event => event.type === 'room/run-state')
    // Exactly running + cancelled: the engine's settle saw the cancel edge and no-oped.
    expect(edges.map(event => (event.data as { state: string }).state)).toEqual(['running', 'cancelled'])
    expect(session.snapshotEvents().some(event => event.type === 'room/speech')).toBe(false)
    // The cancelled run closed the auto-opened task as cancelled.
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    expect(state).toMatchObject({ ok: true, value: { tasks: [{ member: 'ada', status: 'cancelled' }] } })
  })
})
import { createRoom } from './promote.ts'

describe('coordinator routing and durable deliveries', () => {
  async function preparedMember(bench: Bench, name = 'ada') {
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name })
    const session = bench.ctx.sessions.get(bench.sessionId)!
    session.append('room/member-updated', { name, childSessionId: SessionId(`child-${name}`) })
    bench.localAgentStub['memberConfiguration'] = () => ({ status: 'idle' })
    bench.localAgentStub['canCoordinateRoom'] = () => true
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    if (!state.ok) throw new Error('room unavailable')
    return state.value.members.find(member => member.name === name)!
  }

  it('promotes a ready identity without a prompt, routes bare input directly, and keeps native DSH addressable', async () => {
    const bench = await bootRoom()
    const member = await preparedMember(bench)
    expect(await bench.service.setCoordinator({ sessionId: bench.sessionId, memberId: member.id!, expectedRevision: 0 }))
      .toMatchObject({ ok: true, value: { memberId: member.id, revision: 1 } })
    expect(bench.facade.start).not.toHaveBeenCalled()
    expect(bench.facade.resume).not.toHaveBeenCalled()
    bench.facade.resume.mockImplementation(async () => settledRun('child-ada', 'external answer'))
    await bench.service.postMessage({ sessionId: bench.sessionId, text: 'hello', requestId: 'input-1' })
    await bench.service.engine.idle()
    expect(bench.facade.resume).toHaveBeenCalledTimes(1)
    expect(bench.agent!.followup).not.toHaveBeenCalled()
    expect(textOf(bench.facade.resume.mock.calls[0]![3])).toContain('Coordinator handoff')
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@main hello' })
    await bench.service.engine.idle()
    expect(bench.agent!.followup).toHaveBeenCalledTimes(1)
    expect(await bench.service.removeMember({ sessionId: bench.sessionId, name: 'ada' }))
      .toEqual({ ok: false, error: { code: 'active-coordinator' } })
    expect(await bench.service.setCoordinator({ sessionId: bench.sessionId, memberId: 'legacy:1', expectedRevision: 0 }))
      .toEqual({ ok: false, error: { code: 'coordinator-conflict' } })
    expect(await bench.service.setCoordinator({ sessionId: bench.sessionId, memberId: 'legacy:1', expectedRevision: 1 }))
      .toMatchObject({ ok: true, value: { memberId: 'legacy:1', revision: 2 } })
  })

  it('prepares an invited coordinator without a prompt and starts its reserved identity on first input', async () => {
    const bench = await bootRoom()
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'fresh', model: 'chosen' })
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    if (!state.ok) throw new Error('room unavailable')
    const member = state.value.members.find(member => member.name === 'fresh')!
    const preparation = vi.fn(async (_parent: string, _provider: string, id: string) => id)
    bench.localAgentStub['prepareMember'] = preparation
    bench.localAgentStub['isPreparedMember'] = (id: string) => id === member.id
    bench.localAgentStub['memberConfiguration'] = () => ({ status: 'idle' })
    bench.localAgentStub['canCoordinateRoom'] = () => true
    expect(await bench.service.setCoordinator({ sessionId: bench.sessionId, memberId: member.id!, expectedRevision: 0 })).toMatchObject({ ok: true })
    expect(preparation).toHaveBeenCalledWith(bench.sessionId, 'kimi', member.id, { model: 'chosen' })
    expect(bench.facade.start).not.toHaveBeenCalled()
    expect(bench.facade.resume).not.toHaveBeenCalled()
    bench.facade.start.mockImplementation(async () => settledRun(member.id!, 'ready'))
    await bench.service.postMessage({ sessionId: bench.sessionId, text: 'first real prompt' })
    await bench.service.engine.idle()
    expect(bench.facade.start.mock.calls[0]![3]).toMatchObject({ preparedMemberId: member.id })
    expect(bench.facade.resume).not.toHaveBeenCalled()
    expect(bench.agent!.followup).not.toHaveBeenCalled()
  })

  it('holds room mutations during preparation and keeps native routing when preparation fails', async () => {
    const bench = await bootRoom()
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'fresh' })
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    if (!state.ok) throw new Error('room unavailable')
    const member = state.value.members.find(member => member.name === 'fresh')!
    let fail!: (error: Error) => void
    const preparation = vi.fn(() => new Promise<string>((_resolve, reject) => { fail = reject }))
    bench.localAgentStub['prepareMember'] = preparation
    const promotion = bench.service.setCoordinator({ sessionId: bench.sessionId, memberId: member.id!, expectedRevision: 0 })
    await vi.waitFor(() => expect(preparation).toHaveBeenCalledOnce())
    for (const action of [
      bench.service.updateMember({ sessionId: bench.sessionId, name: 'fresh', rename: 'renamed' }),
      bench.service.removeMember({ sessionId: bench.sessionId, name: 'fresh' }),
      bench.service.messageMember({ sessionId: bench.sessionId, member: 'fresh', text: 'work' }),
      bench.service.postMessage({ sessionId: bench.sessionId, text: 'work' }),
    ]) expect(await action).toMatchObject({ ok: false, error: { code: 'coordinator-busy' } })
    fail(new Error('native initialization failed'))
    expect(await promotion).toMatchObject({ ok: false, error: { code: 'coordinator-not-ready' } })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: 'still native' })
    await bench.service.engine.idle()
    expect(bench.agent!.followup).toHaveBeenCalledOnce()
    expect(bench.facade.start).not.toHaveBeenCalled()
  })

  it('authenticates coordinator tools, prevents room spoofing and reports invited first work automatically', async () => {
    const bench = await bootRoom()
    const coordinator = await preparedMember(bench)
    await bench.service.setCoordinator({ sessionId: bench.sessionId, memberId: coordinator.id!, expectedRevision: 0 })
    const actor = { parentSessionId: bench.sessionId, childSessionId: 'child-ada', provider: 'kimi' }
    const read = await bench.service.receiveMemberCommand(actor, { name: 'room_read', arguments: {} })
    expect(read.ok).toBe(true)
    if (read.ok) expect(JSON.parse(read.receipt)).toMatchObject({ self: 'ada', coordinator: 'ada' })
    expect(await bench.service.receiveMemberCommand({ ...actor, childSessionId: 'forged' }, { name: 'room_read', arguments: {} })).toMatchObject({ ok: false })
    expect(await bench.service.receiveMemberCommand(actor, { name: 'room_message', arguments: { sessionId: 'foreign', member: 'main', text: 'work' } })).toMatchObject({ ok: false })
    expect(await bench.service.messageMember({ sessionId: bench.sessionId, member: 'main', text: 'old native coordinator dispatch' })).toMatchObject({ ok: false, error: { code: 'not-coordinator' } })
    const done = deferred<SubagentResult>()
    bench.facade.start.mockImplementation(async () => ({ ...settledRun('child-worker', ''), result: done.promise }))
    bench.facade.resume.mockImplementation(async () => settledRun('child-ada', 'accepted report'))
    expect(await bench.service.receiveMemberCommand(actor, { name: 'room_invite', arguments: { provider: 'kimi', name: 'worker', firstTask: 'small job' } })).toMatchObject({ ok: true })
    await tick()
    expect(bench.facade.resume).not.toHaveBeenCalled()
    done.resolve({ output: [{ type: 'text', text: 'finished evidence' }], stopReason: 'completed' })
    await bench.service.engine.idle()
    expect(bench.facade.resume).toHaveBeenCalledOnce()
    expect(textOf(bench.facade.resume.mock.calls[0]![3])).toContain('finished evidence')
    expect(bench.agent!.followup).not.toHaveBeenCalled()
    const worker = { ...actor, childSessionId: 'child-worker' }
    expect(await bench.service.receiveMemberCommand(worker, { name: 'room_invite', arguments: { provider: 'kimi', name: 'unauthorized' } })).toMatchObject({ ok: false })
    expect(await bench.service.receiveMemberCommand(worker, { name: 'room_read', arguments: {} })).toMatchObject({ ok: true })
  })

  it('refuses promotion without the coordination tool channel', async () => {
    const bench = await bootRoom()
    const member = await preparedMember(bench)
    bench.localAgentStub['canCoordinateRoom'] = () => false
    expect(await bench.service.setCoordinator({ sessionId: bench.sessionId, memberId: member.id!, expectedRevision: 0 })).toMatchObject({ ok: false, error: { code: 'coordinator-not-ready' } })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: 'still native' })
    await bench.service.engine.idle()
    expect(bench.agent!.followup).toHaveBeenCalledOnce()
  })

  it('reroutes stale official input before any native model request through the public pre-step seam', async () => {
    const bench = await bootRoom()
    const member = await preparedMember(bench)
    await bench.service.setCoordinator({ sessionId: bench.sessionId, memberId: member.id!, expectedRevision: 0 })
    bench.facade.resume.mockImplementation(async () => settledRun('child-ada', 'answer'))
    const session = bench.ctx.sessions.get(bench.sessionId)!
    const agent = { session } as Agent
    const message = createUserMessage({ content: [{ type: 'text', text: 'stale client input' }], source: { kind: 'user' } })
    const next = vi.fn(async () => ({ kind: 'enter' as const, messages: [message] }))
    expect(await agentEvents(bench.ctx, agent).waterfall('agent/pre-step', { messages: [message], turn: 1, step: 1, signal: new AbortController().signal }, next))
      .toEqual({ kind: 'enter', messages: [] })
    expect(next).not.toHaveBeenCalled()
    await bench.service.engine.idle()
    expect(bench.facade.resume).toHaveBeenCalledTimes(1)
    expect(bench.agent!.followup).not.toHaveBeenCalled()
  })

  it('returns acceptance before background completion and reports exactly once; human @ never wakes main', async () => {
    const bench = await bootRoom()
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada' })
    const done = deferred<SubagentResult>()
    bench.facade.start.mockImplementation(async () => ({ ...settledRun('child-ada', ''), result: done.promise }))
    expect(await bench.service.messageMember({ sessionId: bench.sessionId, member: 'ada', text: 'small job' })).toMatchObject({ ok: true })
    await tick()
    expect(bench.agent!.followup).not.toHaveBeenCalled()
    done.resolve({ output: [{ type: 'text', text: 'evidence: done' }], stopReason: 'completed' })
    await bench.service.engine.idle()
    expect(bench.agent!.followup).toHaveBeenCalledTimes(1)
    const session = bench.ctx.sessions.get(bench.sessionId)!
    expect(session.snapshotEvents().filter(event => event.type === 'room/dispatch' && event.data.reportFor !== undefined)).toHaveLength(1)
    await bench.service.engine.recover(session)
    await bench.service.engine.idle()
    expect(bench.agent!.followup).toHaveBeenCalledTimes(1)
    bench.facade.resume.mockImplementation(async () => settledRun('child-ada', 'private answer'))
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada private question' })
    await bench.service.engine.idle()
    expect(bench.agent!.followup).toHaveBeenCalledTimes(1)
  })

  it('deduplicates accepted requests and preserves queued recipient identity across a rename', async () => {
    const bench = await bootRoom()
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada' })
    const first = deferred<SubagentResult>()
    bench.facade.start.mockImplementation(async () => ({ ...settledRun('child-ada', ''), result: first.promise }))
    bench.facade.resume.mockImplementation(async () => settledRun('child-ada', 'second'))
    const request = { sessionId: bench.sessionId, text: '@ada first', requestId: 'first' }
    const receipt = await bench.service.postMessage(request)
    expect(await bench.service.postMessage(request)).toEqual(receipt)
    await tick()
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada second', requestId: 'second' })
    await bench.service.updateMember({ sessionId: bench.sessionId, name: 'ada', rename: 'renamed' })
    first.resolve({ output: [{ type: 'text', text: 'first' }], stopReason: 'completed' })
    await bench.service.engine.idle()
    expect(bench.facade.start).toHaveBeenCalledTimes(1)
    expect(bench.facade.resume).toHaveBeenCalledTimes(1)
    expect(await bench.service.getState({ sessionId: bench.sessionId })).toMatchObject({ ok: true, value: { runs: [{ member: 'renamed', state: 'done' }] } })
    expect(bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents().filter(event => event.type === 'room/speech').map(event => event.data.member)).toEqual(['renamed', 'renamed'])
  })

  it('recovers unstarted deliveries and marks crashed in-flight work uncertain without replay', async () => {
    const bench = await bootRoom()
    const member = await preparedMember(bench)
    bench.facade.resume.mockImplementation(async () => settledRun('child-ada', 'done'))
    const session = bench.ctx.sessions.get(bench.sessionId)!
    const started = session.append('room/dispatch', { id: 'crashed', targets: ['ada'], targetIds: [member.id!], origin: 'human', text: 'side effect' })
    session.append('room/delivery-state', { id: `${started.seq}:${member.id}`, dispatchSeq: started.seq, memberId: member.id!, state: 'running' })
    session.append('room/dispatch', { id: 'queued', targets: ['ada'], targetIds: [member.id!], origin: 'human', text: 'next' })
    await bench.service.engine.recover(session)
    await bench.service.engine.idle()
    await bench.service.engine.recover(session)
    await bench.service.engine.idle()
    expect(bench.facade.resume).not.toHaveBeenCalled()
    expect(await bench.service.reconcileDelivery({ sessionId: bench.sessionId, deliveryId: `${started.seq}:${member.id}`, outcome: 'cancelled', evidence: 'Reviewed native transcript and cancelled the uncertain attempt' })).toEqual({ ok: true })
    await bench.service.engine.idle()
    expect(bench.facade.resume).toHaveBeenCalledTimes(1)
    expect(textOf(bench.facade.resume.mock.calls[0]![3])).toContain('next')
    expect(session.snapshotEvents().some(event => event.type === 'room/delivery-state' && event.data.state === 'uncertain')).toBe(true)
  })
})
