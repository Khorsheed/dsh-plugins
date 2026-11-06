import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import RoomService from '../src/index.ts'
import { PlanService, readPlan } from '../src/plan-service.ts'
import { changePlan, queuePlanAttempt, admitPlanAttempt } from '../src/plan.ts'
import { COMPACTED_TEXT, COMPACT_UNREPORTED_TEXT, DispatchEngine, DELIVERY_UNKNOWN_TEXT, MEMBER_UNRECONCILED_TEXT, MEMBER_WAITING_TEXT, RESTART_UNKNOWN_TEXT, ROOM_KIND, ROOM_PLUGIN, compactionUnreported, executionFacts, isRoomSource } from '../src/dispatch.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { LocalAgentFacade } from '../src/adapter.ts'
import { withRunEntry } from './run-entry-shim.ts'
import { replay } from '../src/journal.ts'
import { AUTO_CONTINUE_MOVED_ON_TEXT, RESTART_CONTINUE_TEXT, interruptedRounds } from '../src/restart-continue.ts'
import { restartBanner } from '../src/client/restart-view.ts'

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
  const localAgentStub: Record<string, unknown> = withRunEntry({ ...facade }, ctx)
  ctx.provide('localAgent', localAgentStub as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(RoomService)
  const service = ctx.get('room') as RoomService
  const sessionId = await createRoom(ctx, service)
  return { ctx, service, sessionId, facade: facade as Bench['facade'], localAgentStub, agent }
}

/** Seat `ada` with a child of its own (a continuing member). */
async function preparedMemberOf(bench: Bench) {
  await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada' })
  bench.ctx.sessions.get(bench.sessionId)!.append('room/member-updated', { name: 'ada', childSessionId: SessionId('child-ada') })
  const state = await bench.service.getState({ sessionId: bench.sessionId })
  if (!state.ok) throw new Error('room unavailable')
  return state.value.members.find(member => member.name === 'ada')!
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
    // A live child with one round: the done edge reports the round reached.
    bench.ctx.sessions.create(SessionId('child-1')).append('turn/start', { turn: 1 })
    bench.facade.start.mockImplementation(async () => settledRun('child-1', '骨架已搭'))
    await bench.service.invite({
      sessionId: bench.sessionId, provider: 'kimi', name: 'ada', instructions: '后端', firstTask: '搭骨架',
    })
    await bench.service.engine.idle()

    expect(bench.facade.start).toHaveBeenCalledTimes(1)
    const [parentId, provider, prompt, options] = bench.facade.start.mock.calls[0] as [string, string, ContentBlock[], { label?: string }]
    expect(parentId).toBe(bench.sessionId)
    expect(provider).toBe('kimi')
    // The member's name labels its child in the host's subagent list.
    expect(options.label).toBe('ada')
    const text = textOf(prompt)
    // First dispatch: one briefing (identity, private instructions, the
    // tool-based contract), the task is the tail.
    expect(text).toContain('【房间简报】')
    expect(text).toContain('你是协作间成员「ada」')
    expect(text).toContain('你的指令：后端')
    expect(text).toContain('member_message')
    // A CLI is told where its room tools live (some keep MCP tools behind discovery).
    expect(text).toContain('名为 dsh-member 的 MCP 服务')
    // Deploying 3080 restarts the member's own instance: prepare, hand the restart off.
    expect(text).toContain('`--no-restart` 准备并验证，最后的重启交给协调者或人来做')
    expect(text).not.toContain('通知协议')
    expect(text).toContain('搭骨架')

    const state = await bench.service.getState({ sessionId: bench.sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: {
        // The delegation handle is journaled (reload reattaches the member).
        members: [{ name: 'dsh' }, { name: 'ada', childSessionId: 'child-1' }],
        // The first task is a task of its own; the settle (speech) finished it.
        jobs: [{ title: '搭骨架', status: 'done' }],
        runs: [{ member: 'ada', state: 'done' }],
      },
    })
    // Every run-state edge carries the child identity once it exists; the
    // terminal edge also reports the child round reached (Context Lens's
    // room-turn correlation). A fresh member's first running edge predates
    // the child handle — the terminal edge and later rounds carry it.
    const runStates = bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents().filter(event => event.type === 'room/run-state')
    expect(runStates.map(event => event.data.state)).toEqual(['running', 'done'])
    expect(runStates[0]!.data.childSessionId).toBeUndefined()
    expect(runStates.at(-1)?.data).toMatchObject({ childSessionId: 'child-1', childTurn: 1 })

    // Later rounds carry the identity on every edge, running included.
    bench.facade.resume.mockImplementation(async () => settledRun('child-1', '搭好了'))
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 再搭一块' })
    await bench.service.engine.idle()
    const edges = bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents().filter(event => event.type === 'room/run-state')
    expect(edges.map(event => event.data.state)).toEqual(['running', 'done', 'running', 'done'])
    expect(edges.slice(1).every(event => event.data.childSessionId === 'child-1')).toBe(true)
  })

  it('a run claims only the child rounds written inside its own range, never an earlier run\'s', async () => {
    const bench = await bootRoom()
    const child = bench.ctx.sessions.create(SessionId('child-1'))
    bench.facade.start.mockImplementation(async () => {
      child.append('turn/start', { turn: 1 })
      return settledRun('child-1', '骨架已搭')
    })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: '搭骨架' })
    await bench.service.engine.idle()
    // The second run fails before its round starts: it reached no round, so
    // it must not claim round 1 (the earlier run's).
    bench.facade.resume.mockRejectedValueOnce(new Error('spawn failed'))
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 再搭一块' })
    await bench.service.engine.idle()
    // The third run writes round 2 and claims it.
    bench.facade.resume.mockImplementationOnce(async () => {
      child.append('turn/start', { turn: 2 })
      return settledRun('child-1', '搭好了')
    })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 第三块' })
    await bench.service.engine.idle()
    const edges = bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents().filter(event => event.type === 'room/run-state')
    expect(edges.map(event => event.data.state)).toEqual(['running', 'done', 'running', 'failed', 'running', 'done'])
    // Each running edge records where its run's child events begin (the
    // core's admission says; its execution records sit in the child too) and
    // which execution it is.
    expect(edges.filter(event => event.data.state === 'running').map(event => event.data.childFromSeq)).toEqual([0, 2, 3])
    const executions = edges.filter(event => event.data.state === 'running').map(event => event.data.executionId)
    expect(new Set(executions).size).toBe(3)
    expect(edges.filter(event => event.data.state !== 'running').map(event => event.data.executionId)).toEqual(executions)
    // The terminal edge's round is the execution's recorded turns.
    expect(edges.filter(event => event.data.state !== 'running').map(event => event.data.childTurn)).toEqual([1, undefined, 2])
  })

  it('the invite-time model lands as the delegation start call option (absent without one)', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-1', 'done'))
    await bench.service.invite({
      sessionId: bench.sessionId, provider: 'kimi', name: 'ada', model: 'kimi-k2', effort: 'high', firstTask: '搭骨架',
    })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'codex', name: 'bill', firstTask: '搭页面' })
    await bench.service.engine.idle()

    expect(bench.facade.start).toHaveBeenCalledTimes(2)
    // ada invited with a model and an effort: the facade start's call options.
    expect(bench.facade.start.mock.calls[0]![3]).toMatchObject({ model: 'kimi-k2', effort: 'high', onProgress: expect.any(Function) })
    // Usage observation does not select a model on behalf of the user.
    expect(bench.facade.start.mock.calls[1]![3].model).toBeUndefined()
    expect(bench.facade.start.mock.calls[1]![3].effort).toBeUndefined()
  })

  it('records the late observed model on its own completed execution, and no usage copy (S6)', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-usage', 'done'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: 'Check output' })
    await bench.service.engine.idle()
    const session = bench.ctx.sessions.get(bench.sessionId)!
    const lifecycleCount = session.snapshotEvents().filter(event => event.type === 'room/run-state').length
    const progress = bench.facade.start.mock.calls[0]![3].onProgress
    // Disjoint counts: the billed total includes the cached input buckets.
    progress({ kind: 'settled', observedModel: 'observed-model', observedEffort: 'high', usage: { inputTokens: 30, outputTokens: 12, cacheReadTokens: 1_000, cacheWriteTokens: 8 } })
    expect(session.snapshotEvents().filter(event => event.type === 'room/run-state')).toHaveLength(lifecycleCount)
    const metadata = session.snapshotEvents().findLast(event => event.type === 'room/execution-metadata')
    expect(metadata?.data).toEqual({ runId: expect.any(String), model: 'observed-model', effort: 'high' })
    // A settle report with usage only (no observation) writes nothing at all.
    progress({ kind: 'settled', usage: { inputTokens: 1, outputTokens: 1 } })
    expect(session.snapshotEvents().filter(event => event.type === 'room/execution-metadata')).toHaveLength(1)
    // A core without readExecution: the run shows no reading and no usage, nothing breaks.
    const result = await bench.service.getState({ sessionId: bench.sessionId })
    expect(result).toMatchObject({ ok: true, value: { executions: [{ state: 'done', model: 'observed-model', effort: 'high', childSessionId: 'child-usage' }] } })
    if (!result.ok) throw new Error('room unavailable')
    expect(result.value.executions?.[0]).not.toHaveProperty('tokens')
    expect(result.value.executions?.[0]).not.toHaveProperty('reading')
  })

  it('getState attaches the core\'s reading per execution; a failing or empty read keeps the run as replayed', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-usage', 'done'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: 'Check output' })
    await bench.service.engine.idle()
    const reading = { executionId: 'x', operation: 'prompt', outcome: 'done', turns: [1], calls: 2, callUsage: { inputTokens: 40, outputTokens: 4 }, unrecorded: [], compactions: [] }
    const readExecution = vi.fn(async (_child: string, executionId: string) => ({ ...reading, executionId }))
    bench.localAgentStub['readExecution'] = readExecution
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    if (!state.ok) throw new Error('room unavailable')
    const run = state.value.executions![0]!
    expect(readExecution).toHaveBeenCalledWith('child-usage', run.executionId)
    expect(run.reading).toMatchObject({ executionId: run.executionId, callUsage: { inputTokens: 40, outputTokens: 4 } })
    bench.localAgentStub['readExecution'] = vi.fn(async () => { throw new Error('unreadable') })
    const failed = await bench.service.getState({ sessionId: bench.sessionId })
    expect(failed.ok && failed.value.executions![0]).not.toHaveProperty('reading')
  })

  it('/compact to a member runs its compaction round: one compaction row, no reply', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-1', '方案 A'))
    bench.facade.resume.mockImplementation(async () => {
      // The member session records the compaction (local-agent's event).
      const child = bench.ctx.sessions.get(SessionId('child-1')) ?? bench.ctx.sessions.create(SessionId('child-1'), { meta: {} })
      child.append('local-agent/compaction' as never, {
        source: 'manual', outcome: 'completed', provider: 'kimi-cli', summary: '用户在写《潜梦者》', beforeTokens: 560_000, afterTokens: 41_000,
        usage: { inputTokens: 1_103, outputTokens: 154, cacheReadTokens: 19_712 }, startedAt: 1, endedAt: 2, boundarySeq: 0,
      } as never)
      return settledRun('child-1', '用户在写《潜梦者》')
    })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: '出方案' })
    await bench.service.engine.idle()
    const speeches = (): number => bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents().filter(event => event.type === 'room/speech').length
    const before = speeches()
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada /compact' })
    await bench.service.engine.idle()
    expect(bench.facade.resume).toHaveBeenCalledTimes(1)
    const [, , childSessionId, prompt, options] = bench.facade.resume.mock.calls[0] as [string, string, string, ContentBlock[], { operation?: string }]
    expect(childSessionId).toBe('child-1')
    expect(textOf(prompt)).toBe('/compact')
    expect(options.operation).toBe('compact')
    // Kimi answers /compact with its summary: that is the row's, not a reply.
    expect(speeches()).toBe(before)
    // Both run edges say it is a compaction, and the terminal one names no child turn (it wrote none).
    const edges = bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents()
      .filter(event => event.type === 'room/run-state' && (event.data as { operation?: string }).operation === 'compact')
    expect(edges.map(event => (event.data as { state: string }).state)).toEqual(['running', 'done'])
    expect((edges[1]!.data as { childTurn?: number }).childTurn).toBeUndefined()
    const row = bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents().findLast(event => event.type === 'room/member-compacted')
    // The row keeps outcome and summary; the sizes and spend stay on the
    // member log's fact and are read at display time (S6), never copied.
    expect(row?.data).toMatchObject({ member: 'ada', outcome: 'completed', summary: '用户在写《潜梦者》' })
    for (const copied of ['beforeTokens', 'afterTokens', 'contextWindow', 'usage']) expect(row?.data).not.toHaveProperty(copied)
  })

  it('/compact reads only the compaction written inside its own run; the core\'s unrecorded fact says the member reports none', async () => {
    const bench = await bootRoom()
    const child = bench.ctx.sessions.create(SessionId('child-1'), { meta: {} })
    bench.facade.start.mockImplementation(async () => settledRun('child-1', '方案 A'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'claude-code', name: 'ada', firstTask: '出方案' })
    await bench.service.engine.idle()
    // An earlier run's compaction sits in the member log.
    child.append('local-agent/compaction', {
      source: 'auto', outcome: 'completed', provider: 'claude-code', beforeTokens: 900_000, afterTokens: 50_000, startedAt: 1, endedAt: 2, boundarySeq: 0,
    })
    // The provider reports no compaction: the core writes the fact itself,
    // marked unrecorded, inside this execution (local-agent execution-records).
    bench.facade.resume.mockImplementation(async () => {
      child.append('local-agent/compaction', {
        source: 'manual', outcome: 'completed', provider: 'claude-code', startedAt: 3, endedAt: 4, boundarySeq: 1,
        unrecorded: ['usage', 'before-after', 'summary'],
      })
      return settledRun('child-1', '')
    })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada /compact' })
    await bench.service.engine.idle()
    const row = bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents().findLast(event => event.type === 'room/member-compacted')
    expect(row?.data).toMatchObject({ member: 'ada', outcome: 'completed', unreported: true })
    expect(row?.data).not.toHaveProperty('beforeTokens')
    // The delivery's outcome (what a waiting sender's report reads) says so too.
    const settled = bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents().findLast(event => event.type === 'room/delivery-state')
    expect(settled?.data).toMatchObject({ state: 'done', text: COMPACT_UNREPORTED_TEXT })
  })

  it('/compact whose run holds no compaction fact is not guessed to be unreported', async () => {
    const bench = await bootRoom()
    bench.ctx.sessions.create(SessionId('child-1'), { meta: {} })
    bench.facade.start.mockImplementation(async () => settledRun('child-1', '方案 A'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'claude-code', name: 'ada', firstTask: '出方案' })
    await bench.service.engine.idle()
    // A core from before batch 5 S2 writes no fact: room no longer infers one.
    bench.facade.resume.mockImplementation(async () => settledRun('child-1', ''))
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada /compact' })
    await bench.service.engine.idle()
    const row = bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents().findLast(event => event.type === 'room/member-compacted')
    expect(row?.data).toMatchObject({ member: 'ada', outcome: 'completed' })
    expect(row?.data).not.toHaveProperty('unreported')
    const settled = bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents().findLast(event => event.type === 'room/delivery-state')
    expect(settled?.data).toMatchObject({ state: 'done', text: COMPACTED_TEXT })
  })

  it('a codex automatic compaction marked unrecorded for usage only still shows its numbers', () => {
    expect(compactionUnreported({ unrecorded: ['usage'] })).toBe(false)
    expect(compactionUnreported({})).toBe(false)
    expect(compactionUnreported({ unrecorded: ['usage', 'before-after', 'summary'] })).toBe(true)
  })

  it('/compact to a member that never ran starts nothing', async () => {
    const bench = await bootRoom()
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada' })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada /compact' })
    await bench.service.engine.idle()
    expect(bench.facade.start).not.toHaveBeenCalled()
    expect(bench.facade.resume).not.toHaveBeenCalled()
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    expect(state).toMatchObject({ ok: true, value: { deliveries: [{ status: 'done' }] } })
  })

  it('the briefing lists the other members by public role only; later prompts carry NO running log', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-1', '方案 A'))
    bench.facade.resume.mockImplementation(async () => settledRun('child-1', '按方案 A 实现完毕'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'codex', name: 'bill', role: '前端', instructions: '你负责页面。被要求打招呼时自我介绍。' })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', role: '后端', instructions: '后端工程师\n负责 API', firstTask: '出方案' })
    await bench.service.engine.idle()
    const first = textOf(bench.facade.start.mock.calls[0]![2] as ContentBlock[])
    // Others appear by name, public role and provider — never by their
    // private instructions (which read like orders to the reader).
    expect(first).toContain('- bill（前端 · codex）')
    expect(first).toContain('- dsh（协调者 · 原生 DSH）')
    expect(first).not.toContain('你负责页面')
    expect(first).not.toContain('打招呼')
    expect(first).toContain('职责：后端')

    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 按方案 A 实现' })
    await bench.service.engine.idle()

    expect(bench.facade.resume).toHaveBeenCalledTimes(1)
    const [parentId, provider, childSessionId, prompt] = bench.facade.resume.mock.calls[0] as [string, string, string, ContentBlock[]]
    expect([parentId, provider, childSessionId]).toEqual([bench.sessionId, 'kimi', 'child-1'])
    const text = textOf(prompt)
    // Nothing the member has seen comes back: no briefing, no earlier task,
    // no own speech; the dispatch text rides the tail exactly once.
    expect(text).not.toContain('【房间简报】')
    expect(text).not.toContain('出方案')
    expect(text).not.toContain('[ada]')
    expect(text).not.toContain('你的指令')
    expect(text.split('按方案 A 实现')).toHaveLength(2)
  })

  it('later dispatches carry one-line room changes instead of the roster or the goal again', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-1', 'done'))
    bench.facade.resume.mockImplementation(async () => settledRun('child-1', 'done'))
    await bench.service.setGoal({ sessionId: bench.sessionId, text: '插件 API v2 上线' })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: '出方案' })
    await bench.service.engine.idle()
    const first = textOf(bench.facade.start.mock.calls[0]![2] as ContentBlock[])
    expect(first).toContain('房间目标：插件 API v2 上线')

    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 继续' })
    await bench.service.engine.idle()
    const second = textOf(bench.facade.resume.mock.calls[0]![3] as ContentBlock[])
    // Nothing changed: no goal, no roster, no change notes.
    expect(second).not.toContain('插件 API v2')
    expect(second).not.toContain('【房间变动】')
    // The human's own words carry no envelope.
    expect(second.trim()).toBe('继续')

    await bench.service.invite({ sessionId: bench.sessionId, provider: 'codex', name: 'bill', role: '前端' })
    await bench.service.updateMember({ sessionId: bench.sessionId, name: 'ada', role: '后端' })
    await bench.service.setGoal({ sessionId: bench.sessionId, text: '插件 API v3 上线' })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 再继续' })
    await bench.service.engine.idle()
    const third = textOf(bench.facade.resume.mock.calls[1]![3] as ContentBlock[])
    expect(third).toContain('【房间变动】')
    expect(third).toContain('- bill 加入（前端 · codex）')
    expect(third).toContain('- 你的职责改为：后端')
    expect(third).toContain('- 房间目标更新为：插件 API v3 上线')
    expect(third).not.toContain('【房间简报】')
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
    expect(textOf(prompt)).toContain('你的指令更新为：后端 + 接口评审')
  })

  it('a reply ending in an `@name` line is plain speech, never a relay', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-1', '方案已定。\n@bill 接口定稿了，请评审'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: '出方案' })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'codex', name: 'bill' })
    await bench.service.engine.idle()

    const state = await bench.service.getState({ sessionId: bench.sessionId })
    expect(state).toMatchObject({ ok: true, value: { relays: [] } })
  })

  it('removing a busy member stops it, cancels its queue, tells the waiting coordinator, and can be undone', async () => {
    const bench = await bootRoom()
    const flight = deferred<SubagentResult>()
    bench.facade.start.mockImplementation(async () => ({
      id: SessionId('child-ada'), localAgent: undefined, result: flight.promise, dispose: async () => {},
    }))
    bench.facade.cancel.mockImplementation(() => {
      flight.resolve({ output: [{ type: 'text', text: '写了一半' }], stopReason: 'aborted' })
      return true
    })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', role: '实现', instructions: '后端' })
    await bench.service.messageMember({ sessionId: bench.sessionId, member: 'ada', text: '补迁移脚本' })
    await vi.waitFor(() => expect(bench.facade.start).toHaveBeenCalledOnce())
    await tick()
    await bench.service.messageMember({ sessionId: bench.sessionId, member: 'ada', text: '再对一下接口' })

    const removal = await bench.service.removeMember({ sessionId: bench.sessionId, name: 'ada' })
    expect(removal).toEqual({ ok: true, value: {
      name: 'ada', stopped: true, cancelledDeliveries: 1, notified: ['dsh'],
    } })
    await bench.service.engine.idle()
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    if (!state.ok) throw new Error('room unavailable')
    expect(state.value.members.map(member => member.name)).toEqual(['dsh'])
    expect(state.value.deliveries?.filter(row => row.origin !== 'report').map(row => [row.text, row.status])).toEqual([
      ['补迁移脚本', 'cancelled'], ['再对一下接口', 'cancelled'],
    ])
    // The queued message never runs, and the coordinator heard about it.
    expect(bench.facade.resume).not.toHaveBeenCalled()
    const followups = bench.agent!.followup.mock.calls.map(call => textOf((call[0] as UserMessage).content))
    expect(followups.some(text => /【#m\d+ 的回报 · 来自 ada · 已取消】/.test(text) && text.includes('ada 已被移除'))).toBe(true)

    // Undo: ada rejoins on its own session; the cancelled work stays cancelled.
    expect(await bench.service.restoreMember({ sessionId: bench.sessionId, name: 'ada' })).toEqual({ ok: true, value: { name: 'ada' } })
    await bench.service.engine.idle()
    const restored = await bench.service.getState({ sessionId: bench.sessionId })
    if (!restored.ok) throw new Error('room unavailable')
    expect(restored.value.members.find(member => member.name === 'ada')).toMatchObject({ role: '实现', instructions: '后端', childSessionId: 'child-ada' })
    expect(bench.facade.resume).not.toHaveBeenCalled()
    expect(await bench.service.restoreMember({ sessionId: bench.sessionId, name: 'ada' })).toEqual({ ok: false, error: { code: 'duplicate-name' } })
  })

  it('members message each other freely; a task reply is reported back to the sender with its message id', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async (_parent: string, provider: string) => settledRun(provider === 'kimi' ? 'child-ada' : 'child-bill', 'ready'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', role: '实现', firstTask: '准备' })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'codex', name: 'bill', role: '测试', firstTask: '准备' })
    await bench.service.engine.idle()
    bench.facade.resume.mockImplementation(async (_parent: string, _provider: string, child: string) =>
      settledRun(child, child === 'child-bill' ? '6 个用例全部通过' : '收到'))

    const receipt = await bench.service.receiveMemberMessage({
      from: 'child-ada', to: 'bill', content: '为登录写测试', parentSessionId: bench.sessionId, provenance: { provider: 'kimi' },
    })
    expect(receipt).toMatch(/^sent #m\d+（bill 做完后结果会自动回报给你/)
    await bench.service.engine.idle()

    const [toBill, back] = bench.facade.resume.mock.calls as [string, string, string, ContentBlock[]][]
    expect(toBill![2]).toBe('child-bill')
    const id = /#(m\d+)/.exec(receipt)![1]
    expect(textOf(toBill![3])).toContain(`【来自 ada · #${id} · 派活】`)
    expect(textOf(toBill![3])).toContain('为登录写测试')
    expect(back![2]).toBe('child-ada')
    expect(textOf(back![3])).toContain(`【#${id} 的回报 · 来自 bill · 完成】`)
    expect(textOf(back![3])).toContain('6 个用例全部通过')
    const speech = bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents()
      .filter(event => event.type === 'room/speech').at(-2)
    expect(speech).toMatchObject({ data: { member: 'bill', reportedTo: 'ada' } })
  })

  it('every member round goes through run() with its cause, task, delivery key and run id', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async (_parent: string, provider: string) => settledRun(provider === 'kimi' ? 'child-ada' : 'child-bill', 'ready'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: '准备' })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'codex', name: 'bill', firstTask: '准备' })
    await bench.service.engine.idle()
    bench.facade.resume.mockImplementation(async (_parent: string, _provider: string, child: string) => settledRun(child, child === 'child-bill' ? '测完了' : '收到'))
    await bench.service.receiveMemberMessage({ from: 'child-ada', to: 'bill', content: '写测试', parentSessionId: bench.sessionId, provenance: { provider: 'kimi' } })
    await bench.service.engine.idle()
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 看一下' })
    await bench.service.engine.idle()

    const events = bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents()
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    if (!state.ok) throw new Error('room unavailable')
    const ada = state.value.members.find(member => member.name === 'ada')!.id!
    const bill = state.value.members.find(member => member.name === 'bill')!.id!
    const dispatches = events.filter(event => event.type === 'room/dispatch')
    const run = bench.localAgentStub['run'] as ReturnType<typeof vi.fn>
    const requests = run.mock.calls.map(call => call[0] as Record<string, unknown> & { member: { childSessionId: string } })
    expect(requests).toHaveLength(5)
    for (const request of requests) {
      expect(request).toMatchObject({ parentSessionId: bench.sessionId, caller: 'room', operation: 'prompt' })
      // The delivery id (`<dispatch seq>:<member id>`) is both the key and the run id.
      expect(request['key']).toBe(request['callerRef'])
    }
    const [inviteAda, inviteBill, toBill, report, human] = requests
    const seqOf = (request: Record<string, unknown>): number => Number(String(request['key']).split(':')[0])
    const dispatchOf = (request: Record<string, unknown>) => dispatches.find(event => event.seq === seqOf(request))!
    // An invite's first task: the human asked, in this room.
    expect(inviteAda).toMatchObject({ member: { childSessionId: ada }, cause: { kind: 'human', sessionId: bench.sessionId, via: 'room', dispatchSeq: seqOf(inviteAda!) } })
    expect(inviteAda!['task']).toEqual({ sessionId: bench.sessionId, id: (dispatchOf(inviteAda!).data as { task: string }).task })
    expect(inviteBill).toMatchObject({ member: { childSessionId: bill }, key: `${seqOf(inviteBill!)}:${bill}` })
    // A member's message: from that member, by the dispatch it rides.
    expect(toBill).toMatchObject({ member: { childSessionId: 'child-bill' }, cause: { kind: 'member', sessionId: bench.sessionId, fromMemberId: ada, dispatchSeq: seqOf(toBill!) } })
    expect(toBill!['member']).not.toHaveProperty('create')
    // bill's report to ada: caused by bill's execution, named by its run-state edge.
    const billRun = events.find(event => event.type === 'room/run-state' && event.data.runId === toBill!['key'] && event.data.state === 'running')
    expect(billRun?.type === 'room/run-state' && billRun.data.executionId).toBeTruthy()
    expect(report).toMatchObject({ member: { childSessionId: 'child-ada' }, cause: { kind: 'execution', executionId: billRun?.type === 'room/run-state' ? billRun.data.executionId : '' } })
    // A human message names the message it carries.
    const message = dispatchOf(human!).data as { messageId?: string; task?: string }
    expect(message.messageId).toBeDefined()
    expect(human).toMatchObject({ cause: { kind: 'human', messageId: message.messageId, via: 'room' }, task: { sessionId: bench.sessionId, id: message.task } })
  })

  it('names the cause of help, help replies, release rounds and legacy relays from the room facts', () => {
    const room = 'room-1'
    let seq = 0
    const event = (type: string, data: Record<string, unknown>) => ({ type, seq: seq++, time: 0, data }) as unknown as SessionEvent
    const events: SessionEvent[] = [
      event('room/member-added', { id: 'm-ada', name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human' }),
      event('room/dispatch', { origin: 'help', help: { id: 'h1', room: 'room-0', roomTitle: '别的房间', from: 'zed' }, targets: ['ada'], text: '帮个忙', task: 't1' }),
      event('room/help', { id: 'h2', from: 'm-ada', fromName: 'ada', target: { sessionId: 'helper-1', title: '帮手' }, text: '问一下' }),
      event('room/dispatch', { origin: 'report', reportFor: 'help:h2', targets: ['ada'], text: '答复' }),
      event('room/decision', { id: 'd1', scenario: 'report-timing', outcome: 'later', about: { from: 'bill', to: 'ada' } }),
      event('room/dispatch', { origin: 'report', releases: [1], releaseReason: 'timeout', targets: ['ada'], text: '等着交给你', task: 't1' }),
      event('room/dispatch', { origin: 'report', releases: [1], releaseReason: 'restart', targets: ['ada'], text: '等着交给你' }),
      event('room/dispatch', { origin: 'report', releases: [1], releaseReason: 'manual', targets: ['ada'], text: '等着交给你' }),
      event('room/dispatch', { origin: 'report', reportFor: '1:m-bill', targets: ['ada'], text: '旧回报' }),
      event('room/relay', { id: 'r1', from: 'ada', to: 'bill', content: '通知', state: 'pending' }),
    ]
    expect(executionFacts(events, room, 1)).toEqual({ cause: { kind: 'help', sessionId: room, helpId: 'h1', fromRoom: 'room-0' }, task: { sessionId: room, id: 't1' } })
    expect(executionFacts(events, room, 3)).toEqual({ cause: { kind: 'help', sessionId: room, helpId: 'h2', fromRoom: 'helper-1' } })
    expect(executionFacts(events, room, 5)).toEqual({ cause: { kind: 'decision', sessionId: room, decisionId: 'd1' }, task: { sessionId: room, id: 't1' } })
    expect(executionFacts(events, room, 6)).toEqual({ cause: { kind: 'restart', sessionId: room } })
    expect(executionFacts(events, room, 7)).toEqual({ cause: { kind: 'human', sessionId: room, dispatchSeq: 7, via: 'room' } })
    // A report of a run with no execution id (the room's own agent, a run from before S5): from the reporting member.
    expect(executionFacts(events, room, 8)).toEqual({ cause: { kind: 'member', sessionId: room, fromMemberId: 'm-bill', dispatchSeq: 8 } })
    expect(executionFacts(events, room, undefined, ['r1'])).toEqual({ cause: { kind: 'member', sessionId: room, fromMemberId: 'm-ada', dispatchSeq: 9 } })
  })

  it('S9: a help round carries the asker\'s task, a help reply its thread\'s task, a release round its cited decision', () => {
    const room = 'room-1'
    let seq = 0
    const event = (type: string, data: Record<string, unknown>) => ({ type, seq: seq++, time: 0, data }) as unknown as SessionEvent
    const events: SessionEvent[] = [
      event('room/member-added', { id: 'm-ada', name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human' }),
      event('room/dispatch', { origin: 'help', help: { id: 'h1', room: 'room-0', roomTitle: '别的房间', from: 'zed', task: 'asker-task' }, targets: ['ada'], text: '帮个忙', task: 't1' }),
      event('room/help', { id: 'h2', from: 'm-ada', fromName: 'ada', target: { sessionId: 'helper-1', title: '帮手' }, text: '问一下', task: 't9' }),
      event('room/dispatch', { origin: 'report', reportFor: 'help:h2', targets: ['ada'], text: '答复' }),
      event('room/dispatch', { origin: 'report', reportFor: 'help:h2', targets: ['ada'], text: '答复', task: 't7' }),
      event('room/decision', { id: 'd-cited', scenario: 'report-timing', outcome: 'later', about: { from: 'bill', to: 'ada' }, runId: '9:m-bill' }),
      event('room/decision', { id: 'd-later', scenario: 'report-timing', outcome: 'later', about: { from: 'cid', to: 'ada' } }),
      event('room/dispatch', { origin: 'report', releases: [2], releaseReason: 'timeout', releaseDecision: 'd-cited', targets: ['ada'], text: '等着交给你' }),
    ]
    expect(executionFacts(events, room, 1)).toEqual({
      cause: { kind: 'help', sessionId: room, helpId: 'h1', fromRoom: 'room-0', fromTask: { sessionId: 'room-0', id: 'asker-task' } },
      task: { sessionId: room, id: 't1' },
    })
    // The asking room's reply round: the thread's own task when the dispatch names none; its own task wins otherwise.
    expect(executionFacts(events, room, 3)).toEqual({ cause: { kind: 'help', sessionId: room, helpId: 'h2', fromRoom: 'helper-1' }, task: { sessionId: room, id: 't9' } })
    expect(executionFacts(events, room, 4)).toEqual({ cause: { kind: 'help', sessionId: room, helpId: 'h2', fromRoom: 'helper-1' }, task: { sessionId: room, id: 't7' } })
    // The cited decision, not the latest one that held reports for the recipient.
    expect(executionFacts(events, room, 7)).toEqual({ cause: { kind: 'decision', sessionId: room, decisionId: 'd-cited' } })
  })

  it('a member waiting for 待对账 (members page): the room delivery waits, reads 待对账 rather than failed, and goes out once reconciled there', async () => {
    const bench = await bootRoom()
    const member = await preparedMemberOf(bench)
    const stub = bench.localAgentStub as ReturnType<typeof withRunEntry>
    // A members-page input a restart cut off: the core admits nothing else of ada.
    stub.seedLedgerRow('child-ada', { id: 'composer-1', key: 'input-1', caller: 'composer', status: 'uncertain', text: '页面里打的字' })
    bench.facade.resume.mockImplementation(async () => settledRun('child-ada', '接着做完了'))
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 继续' })
    await bench.service.engine.idle()
    expect(bench.facade.resume).not.toHaveBeenCalled()
    const waiting = await bench.service.getState({ sessionId: bench.sessionId })
    expect(waiting).toMatchObject({ ok: true, value: {
      deliveries: [{ status: 'queued', waiting: 'reconcile' }],
      runs: [{ member: 'ada', state: 'uncertain', error: MEMBER_WAITING_TEXT }],
      executions: [{ member: 'ada', state: 'uncertain', error: MEMBER_WAITING_TEXT }],
    } })
    const room = bench.ctx.sessions.get(bench.sessionId)!
    // Nothing failed: no delivery edge, one run row saying it waits.
    expect(room.snapshotEvents().filter(event => event.type === 'room/delivery-state')).toHaveLength(0)
    // Every later live access tries again and is refused again: still one row.
    await bench.service.engine.recover(room)
    await bench.service.engine.idle()
    expect(room.snapshotEvents().filter(event => event.type === 'room/run-state').map(event => event.data.error)).toEqual([MEMBER_WAITING_TEXT])
    // Reconciled on the members page (the core's one reconciliation): the
    // room catches up on its next read and the delivery goes out once.
    ;(stub['reconcileExecution'] as (child: string, id: string, outcome: string, evidence: string) => void)('child-ada', 'composer-1', 'done', '看过成员会话：已完成')
    await bench.service.getState({ sessionId: bench.sessionId })
    await vi.waitFor(() => expect(bench.facade.resume).toHaveBeenCalledOnce())
    await bench.service.engine.idle()
    await bench.service.getState({ sessionId: bench.sessionId })
    await bench.service.engine.idle()
    expect(bench.facade.resume).toHaveBeenCalledOnce()
    expect(textOf(bench.facade.resume.mock.calls[0]![3])).toContain('继续')
    expect(room.snapshotEvents().flatMap(event => event.type === 'room/delivery-state' ? [event.data.state] : [])).toEqual(['running', 'done'])
    const after = await bench.service.getState({ sessionId: bench.sessionId })
    expect(after).toMatchObject({ ok: true, value: { deliveries: [{ status: 'done' }], runs: [{ member: 'ada', state: 'done' }] } })
    if (!after.ok) throw new Error('room unavailable')
    expect(after.value.deliveries?.[0]).not.toHaveProperty('waiting')
    expect(after.value.runs[0]).not.toHaveProperty('error')
    expect(member.id).toBeDefined()
  })

  it('a legacy relay (no delivery to wait) refused for 待对账 still fails with the 待对账 pointer', async () => {
    const bench = await bootRoom()
    await preparedMemberOf(bench)
    bench.localAgentStub['run'] = vi.fn(async () => { throw new Error('A member input has an uncertain outcome; reconcile before continuing') })
    bench.localAgentStub['readMemberInbox'] = (id: string) => ({ paused: false, messages: id === 'child-ada' ? [{ id: 'x', status: 'uncertain' }] : [] })
    const room = bench.ctx.sessions.get(bench.sessionId)!
    bench.service.engine.dispatch(room, 'ada', 'relay text', { relayIds: ['r1'] })
    await bench.service.engine.idle()
    expect(room.snapshotEvents().filter(event => event.type === 'room/run-state').at(-1)?.data).toMatchObject({ state: 'failed', error: MEMBER_UNRECONCILED_TEXT })
  })

  it('a delivery replayed while the core holds it is admitted once', async () => {
    const bench = await bootRoom()
    await preparedMemberOf(bench)
    bench.localAgentStub.supportsMemberConfiguration = () => true
    const admit = deferred<void>()
    bench.facade.resume.mockImplementation(async (_parent, _provider, _child, _prompt, options) => {
      await admit.promise
      await options.onAdmitted()
      return settledRun('child-ada', 'done once')
    })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 只做一次' })
    await tick()
    const room = bench.ctx.sessions.get(bench.sessionId)!
    // A second engine over the same room (a recovery pass that does not know
    // this process's in-flight work) submits the same, still queued delivery.
    const replayed = new DispatchEngine(bench.ctx)
    const dispatch = room.snapshotEvents().find(event => event.type === 'room/dispatch')!
    replayed.dispatch(room, 'ada', '只做一次', { dispatchSeq: dispatch.seq })
    await tick()
    admit.resolve()
    await bench.service.engine.idle()
    await replayed.idle()
    const run = bench.localAgentStub['run'] as ReturnType<typeof vi.fn>
    expect(run).toHaveBeenCalledTimes(2)
    expect(new Set(run.mock.calls.map(call => (call[0] as { key: string }).key)).size).toBe(1)
    expect(bench.facade.resume).toHaveBeenCalledOnce()
    const edges = room.snapshotEvents().filter(event => event.type === 'room/delivery-state').map(event => event.data.state)
    expect(edges).toEqual(['running', 'done'])
  })

  it('a round another caller starts on a room member shows in the room: busy card, reply, terminal edge', async () => {
    const bench = await bootRoom()
    await preparedMemberOf(bench)
    const child = bench.ctx.sessions.create(SessionId('child-ada'))
    // The room's own agent continues ada with the host `subagent` tool: the
    // core records the execution in ada's session (user decision ④).
    child.append('local-agent/execution', { phase: 'start', executionId: 'exec-tool', caller: 'tool', callerRef: 'call-1', operation: 'prompt',
      cause: { kind: 'tool-call', sessionId: bench.sessionId, callId: 'call-1' }, parentSessionId: bench.sessionId, admittedAt: Date.now() } as never)
    await tick()
    const room = bench.ctx.sessions.get(bench.sessionId)!
    const running = room.snapshotEvents().filter(event => event.type === 'room/run-state')
    expect(running.map(event => event.data)).toMatchObject([{ member: 'ada', state: 'running', runId: 'execution:exec-tool', executionId: 'exec-tool', childSessionId: 'child-ada' }])
    // Busy while it runs (the recovery projection keeps it running), and the stop button reaches it.
    expect(await bench.service.getState({ sessionId: bench.sessionId })).toMatchObject({ ok: true, value: { runs: [{ member: 'ada', state: 'running' }] } })
    child.append('turn/start', { turn: 1 } as never)
    child.append('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', id: 'msg-1', content: [{ type: 'text', text: '按主 agent 说的改好了' }] } } as never, { surfaceOp: 'append' } as never)
    child.append('local-agent/execution', { phase: 'end', executionId: 'exec-tool', outcome: 'done', turns: [1], endedAt: Date.now() } as never)
    await tick()
    const rows = room.snapshotEvents()
    expect(rows.filter(event => event.type === 'room/speech').map(event => event.data)).toMatchObject([{ member: 'ada', text: '按主 agent 说的改好了', runId: 'execution:exec-tool', messageId: 'msg-1' }])
    expect(rows.filter(event => event.type === 'room/run-state').at(-1)?.data).toMatchObject({ state: 'done', childTurn: 1, executionId: 'exec-tool' })
    // It is that caller's work: no room delivery, and nothing went through the room's own entry.
    expect(rows.some(event => event.type === 'room/delivery-state' || event.type === 'room/dispatch')).toBe(false)
    expect(bench.localAgentStub['run']).not.toHaveBeenCalled()
    // The room's own rounds and replayed history are not outside rounds.
    child.append('local-agent/execution', { phase: 'start', executionId: 'exec-room', caller: 'room', operation: 'prompt', parentSessionId: bench.sessionId, admittedAt: Date.now() } as never)
    child.append('local-agent/execution', { phase: 'start', executionId: 'exec-old', caller: 'tool', operation: 'prompt', parentSessionId: bench.sessionId, admittedAt: Date.now() - 3_600_000 } as never)
    await tick()
    expect(room.snapshotEvents().filter(event => event.type === 'room/run-state')).toHaveLength(2)
  })

  it('a notify is delivered once and never reported back', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async (_parent: string, provider: string) => settledRun(provider === 'kimi' ? 'child-ada' : 'child-bill', 'ok'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: '准备' })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'codex', name: 'bill', firstTask: '准备' })
    await bench.service.engine.idle()
    bench.facade.resume.mockImplementation(async (_parent: string, _provider: string, child: string) => settledRun(child, '知道了'))
    const receipt = await bench.service.receiveMemberMessage({
      from: 'child-ada', to: 'bill', content: '接口路径改成 /api/session 了', parentSessionId: bench.sessionId, provenance: { provider: 'kimi' }, kind: 'notify',
    })
    expect(receipt).toMatch(/^sent #m\d+（知会/)
    await bench.service.engine.idle()
    expect(bench.facade.resume).toHaveBeenCalledOnce()
    expect(textOf(bench.facade.resume.mock.calls[0]![3] as ContentBlock[])).toMatch(/【来自 ada · #m\d+ · 知会】/)
  })

  it('a chain past the hop limit is held for the human; continuing releases it with a fresh budget', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async (_parent: string, provider: string) => settledRun(provider === 'kimi' ? 'child-ada' : 'child-bill', 'ok'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: '准备' })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'codex', name: 'bill', firstTask: '准备' })
    await bench.service.engine.idle()
    expect(await bench.service.setSettings({ sessionId: bench.sessionId, hopLimit: 2 })).toMatchObject({ ok: true, value: { hopLimit: 2 } })
    let receipt: string | undefined
    bench.facade.resume.mockImplementation(async (_parent: string, _provider: string, child: string, prompt: ContentBlock[]) => {
      // ada, working on the human's message (hop 1), hands bill a task (hop 2).
      if (child === 'child-ada' && textOf(prompt).includes('分给 bill')) {
        receipt = await bench.service.receiveMemberMessage({ from: 'child-ada', to: 'bill', content: '写测试', parentSessionId: bench.sessionId, provenance: { provider: 'kimi' } })
      }
      return settledRun(child, child === 'child-bill' ? '测试写好了' : 'ok')
    })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 分给 bill' })
    await bench.service.engine.idle()
    expect(receipt).toMatch(/^sent #m/)
    // bill's report to ada would be hop 3: held.
    const held = await bench.service.getState({ sessionId: bench.sessionId })
    if (!held.ok) throw new Error('room unavailable')
    const relay = held.value.relays.find(entry => entry.state === 'pending')!
    expect(relay).toMatchObject({ from: 'bill', to: 'ada', reason: 'hop-limit', content: '测试写好了' })
    const resumesBefore = bench.facade.resume.mock.calls.length
    expect(await bench.service.confirmRelay({ sessionId: bench.sessionId, relayId: relay.id })).toMatchObject({ ok: true })
    await bench.service.engine.idle()
    expect(bench.facade.resume.mock.calls.length).toBe(resumesBefore + 1)
    expect(textOf(bench.facade.resume.mock.calls.at(-1)![3] as ContentBlock[])).toMatch(/【#m\d+ 的回报 · 来自 bill · 完成】（这条回复用户已在房间里看到，不要复述）\n测试写好了/)
  })

  it('a paused room holds agent messages and delivers them in order on resume; confirm mode holds member messages only', async () => {
    const bench = await bootRoom()
    bench.facade.start.mockImplementation(async () => settledRun('child-ada', 'ok'))
    bench.facade.resume.mockImplementation(async () => settledRun('child-ada', 'ok'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: '准备' })
    await bench.service.engine.idle()
    await bench.service.setSettings({ sessionId: bench.sessionId, paused: true })
    expect(await bench.service.messageMember({ sessionId: bench.sessionId, member: 'ada', text: '第一条' })).toMatchObject({ ok: true, value: { held: 'paused' } })
    expect(await bench.service.messageMember({ sessionId: bench.sessionId, member: 'ada', text: '第二条' })).toMatchObject({ ok: true, value: { held: 'paused' } })
    await bench.service.engine.idle()
    expect(bench.facade.resume).not.toHaveBeenCalled()
    await bench.service.setSettings({ sessionId: bench.sessionId, paused: false })
    await bench.service.engine.idle()
    expect(bench.facade.resume.mock.calls.map(call => textOf(call[3] as ContentBlock[]).split('\n').at(-1))).toEqual(['第一条', '第二条'])

    // Confirm mode: the coordinator's delegation still goes straight through;
    // a non-coordinator member's message waits for the human.
    await bench.service.setSettings({ sessionId: bench.sessionId, memberMessages: 'confirm' })
    expect(await bench.service.messageMember({ sessionId: bench.sessionId, member: 'ada', text: '协调者派活' })).toMatchObject({ ok: true, value: { messageId: expect.stringMatching(/^m\d+$/) } })
    await bench.service.engine.idle()
    expect(await bench.service.receiveMemberMessage({ from: 'child-ada', to: 'dsh', content: '我有个问题', parentSessionId: bench.sessionId, provenance: { provider: 'kimi' } }))
      .toBe('pending-confirm （房间设置为成员间消息需房间主人确认）')
    expect(await bench.service.setSettings({ sessionId: bench.sessionId, hopLimit: 1 })).toEqual({ ok: false, error: { code: 'invalid-settings' } })
  })

  it('rejects a public role longer than 30 characters', async () => {
    const bench = await bootRoom()
    const result = await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', role: '很'.repeat(31) })
    expect(result).toEqual({ ok: false, error: { code: 'role-too-long' } })
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
    const runEntry = bench.localAgentStub['run']
    for (const key of Object.keys(bench.localAgentStub)) delete bench.localAgentStub[key]
    await bench.service.confirmRelay({ sessionId: bench.sessionId, relayId: relay2.id })
    await bench.service.engine.idle()
    const stuck = await bench.service.getState({ sessionId: bench.sessionId })
    expect(stuck).toMatchObject({ ok: true, value: { relays: [{ state: 'sent' }, { state: 'confirmed' }] } })

    // The facade returns; a human @bill dispatch carries the stuck relay.
    Object.assign(bench.localAgentStub, bench.facade, { run: runEntry })
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

  it('a member still running keeps its card at the bottom: replies and human messages that land later push it down', async () => {
    const bench = await bootRoom()
    const adaFlight = deferred<SubagentResult>()
    bench.facade.start.mockImplementationOnce(async () => ({
      id: SessionId('child-ada'), localAgent: undefined, result: adaFlight.promise, dispose: async () => {},
    }))
    bench.facade.start.mockImplementationOnce(async () => settledRun('child-bill', 'bill 先答完'))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada' })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'codex', name: 'bill' })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 慢活' })
    await tick()
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@bill 快活' })
    await tick()
    await tick()
    const events = () => bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents()
    const speech = events().find(event => event.type === 'room/speech' && (event.data as { member: string }).member === 'bill')!
    const moves = events().filter(event => event.type === 'room/run-moved')
    // ada moved below bill's human message and again below bill's reply; bill never moves for its own reply.
    expect(moves.every(event => (event.data as { member: string }).member === 'ada')).toBe(true)
    expect(moves.at(-1)!.seq).toBeGreaterThan(speech.seq)
    adaFlight.resolve({ output: [{ type: 'text', text: 'ada 完成' }], stopReason: 'completed' })
    await bench.service.engine.idle()
    const count = events().filter(event => event.type === 'room/run-moved').length
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@bill 再来' })
    await bench.service.engine.idle()
    // Nobody running when the next message lands except bill's own new run, which starts after it.
    expect(events().filter(event => event.type === 'room/run-moved').length).toBe(count)
  })

  it('the main-agent member gets the human\'s own message, the room\'s additions beside it, and no speech projection', async () => {
    const bench = await bootRoom()
    // What the room hands the turn's first step, read while the followup runs
    // (the addition is taken by that step and cleared when the run ends).
    let additions: string | undefined
    const room = bench.ctx.sessions.get(bench.sessionId)!
    bench.agent!.followup.mockImplementation((message: UserMessage) => {
      additions = bench.service.engine.directExtras.get(String(message.id))
      // The host's turn writes the human's message into the log, once.
      room.append('user/message', message, { surfaceOp: 'append' })
    })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@dsh 总结一下进度' })
    await bench.service.engine.idle()

    expect(bench.agent!.followup).toHaveBeenCalledTimes(1)
    const message = bench.agent!.followup.mock.calls[0]![0] as UserMessage
    // The human's words reach the agent once, as their own message — the
    // room writes no copy of it into the log.
    expect(message.source).toEqual({ kind: 'user' })
    expect(textOf(message.content)).toBe('@dsh 总结一下进度')
    // The room wrote no copy: the only record of it is the turn's own.
    expect(room.snapshotEvents().filter(event => event.type === 'user/message' && (event.data as { id?: string }).id === message.id)).toHaveLength(1)
    // The room's own agent sends with room_message, not the CLI bridge tool;
    // the briefing never repeats the human's words.
    expect(additions).toContain('【房间简报】')
    expect(additions).toContain('room_message')
    expect(additions).not.toContain('总结一下进度')
    expect(bench.service.engine.directMessages.size).toBe(0)

    const state = await bench.service.getState({ sessionId: bench.sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: {
        jobs: [{ title: '总结一下进度', status: 'done' }],
        runs: [{ member: 'dsh', state: 'done' }],
      },
    })
    expect(bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents().some(event => event.type === 'room/speech')).toBe(false)
  })

  it('fails loud when the room agent is not live', async () => {
    const bench = await bootRoom({ liveAgent: false })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@dsh 在吗' })
    await bench.service.engine.idle()
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    // The failed edge carries the reason (the client's dim row surfaces it).
    expect(state).toMatchObject({
      ok: true,
      value: { runs: [{ member: 'dsh', state: 'failed', error: 'the room session has no live agent' }] },
    })
    // A failed run settles its delivery as failed (never a stranded running row).
    expect(state).toMatchObject({ ok: true, value: { deliveries: [{ status: 'failed' }], jobs: [{ status: 'done' }] } })
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
        deliveries: [{ status: 'failed' }],
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

  it.each(['aborted', 'error'] as const)('preserves %s partial output without dispatching its trailing directive', async stopReason => {
    const bench = await bootRoom()
    bench.facade.start.mockResolvedValue(settledRun('child-partial', 'Partial answer\n@dsh do not relay', stopReason))
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: 'Long task' })
    await bench.service.engine.idle()
    const events = bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents()
    expect(events.find(event => event.type === 'room/speech')?.data).toMatchObject({
      member: 'ada', text: 'Partial answer\n@dsh do not relay', childSessionId: 'child-partial',
      interrupted: stopReason === 'aborted' ? 'cancelled' : 'failed',
    })
    expect(events.some(event => event.type === 'room/relay')).toBe(false)
    expect(events.filter(event => event.type === 'room/run-state').at(-1)?.data.state)
      .toBe(stopReason === 'aborted' ? 'cancelled' : 'failed')
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

    expect(await bench.service.cancel({ sessionId: bench.sessionId, name: 'ada', expectedRunId: 'an-earlier-round', expectedStartedAt: 0 }))
      .toEqual({ ok: true, value: { cancelled: false } })
    expect(bench.facade.cancel).not.toHaveBeenCalled()
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
    // The cancelled run settled its delivery as cancelled.
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    expect(state).toMatchObject({ ok: true, value: { deliveries: [{ status: 'cancelled' }] } })
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

  it('a bare /compact compacts an external coordinator, and its handoff waits for the next real message', async () => {
    const bench = await bootRoom()
    const member = await preparedMember(bench)
    await bench.service.setCoordinator({ sessionId: bench.sessionId, memberId: member.id!, expectedRevision: 0 })
    bench.facade.resume.mockImplementation(async () => settledRun('child-ada', '摘要'))
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '/compact', requestId: 'input-c' })
    await bench.service.engine.idle()
    expect(bench.facade.resume).toHaveBeenCalledTimes(1)
    expect(textOf(bench.facade.resume.mock.calls[0]![3])).toBe('/compact')
    expect(bench.facade.resume.mock.calls[0]![4]).toMatchObject({ operation: 'compact' })
    const events = bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents()
    expect(events.some(event => event.type === 'room/speech' && (event.data as { member: string }).member === 'ada')).toBe(false)
    expect(events.some(event => event.type === 'room/member-compacted')).toBe(true)
    bench.facade.resume.mockImplementation(async () => settledRun('child-ada', 'answer'))
    await bench.service.postMessage({ sessionId: bench.sessionId, text: 'hello', requestId: 'input-d' })
    await bench.service.engine.idle()
    expect(textOf(bench.facade.resume.mock.calls[1]![3])).toContain('【协调者交接】')
  })

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
    expect(textOf(bench.facade.resume.mock.calls[0]![3])).toContain('【协调者交接】dsh 把协调者交给了你（ada）')
    // Sent once: the next bare message carries no handoff.
    bench.facade.resume.mockImplementation(async () => settledRun('child-ada', 'again'))
    await bench.service.postMessage({ sessionId: bench.sessionId, text: 'again', requestId: 'input-2' })
    await bench.service.engine.idle()
    expect(textOf(bench.facade.resume.mock.calls[1]![3])).not.toContain('协调者交接')
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@dsh hello' })
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
    expect(await bench.service.receiveMemberCommand(actor, { name: 'room_message', arguments: { sessionId: 'foreign', member: 'dsh', text: 'work' } })).toMatchObject({ ok: false })
    // Any member may message others now; nobody may message itself.
    expect(await bench.service.messageMember({ sessionId: bench.sessionId, member: 'dsh', text: 'old native coordinator dispatch' })).toMatchObject({ ok: false, error: { code: 'self-message' } })
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

  it('an edited message goes to the external coordinator through the room: the original stops, the edit runs once under its task', async () => {
    const bench = await bootRoom()
    const member = await preparedMember(bench)
    await bench.service.setCoordinator({ sessionId: bench.sessionId, memberId: member.id!, expectedRevision: 0 })
    const first = deferred<SubagentResult>()
    bench.facade.resume.mockImplementationOnce(async () => ({ ...settledRun('child-ada', ''), result: first.promise }))
    bench.facade.cancel.mockImplementation(() => { first.resolve({ output: [], stopReason: 'aborted' }); return true })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '请让d s h' })
    await vi.waitFor(() => expect(bench.facade.resume).toHaveBeenCalledTimes(1))
    const session = bench.ctx.sessions.get(bench.sessionId)!
    const original = session.snapshotEvents().findLast(event => event.type === 'user/message')!
    // message-tools: the edited bubble replaces the original, then a trigger wakes the room agent.
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '请让dsh打声招呼' }], source: { kind: 'message-tools', op: 'edit' } as never }),
      { surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq] } as never)
    const trigger = createUserMessage({ content: [{ type: 'text', text: '(用户编辑了上一条消息，请按编辑后的内容重新回答)' }], source: { kind: 'message-tools', op: 'edit-trigger' } as never })
    bench.facade.resume.mockImplementation(async () => settledRun('child-ada', 'answer'))
    const agent = { session } as Agent
    const next = vi.fn(async () => ({ kind: 'enter' as const, messages: [trigger] }))
    const step = { messages: [trigger], turn: 2, step: 1, signal: new AbortController().signal }
    expect(await agentEvents(bench.ctx, agent).waterfall('agent/pre-step', step, next)).toEqual({ kind: 'enter', messages: [] })
    // A replayed trigger does not dispatch twice.
    expect(await agentEvents(bench.ctx, agent).waterfall('agent/pre-step', { ...step, turn: 3 }, next)).toEqual({ kind: 'enter', messages: [] })
    expect(next).not.toHaveBeenCalled()
    await bench.service.engine.idle()
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    if (!state.ok) throw new Error('room unavailable')
    expect(state.value.deliveries!.filter(row => row.origin === 'human').map(row => [row.text, row.status])).toEqual([['请让d s h', 'cancelled'], ['请让dsh打声招呼', 'done']])
    expect(state.value.jobs).toHaveLength(1)
    expect(state.value.jobs![0]!.messages.map(entry => entry.text)).toEqual(['请让d s h', '请让dsh打声招呼'])
    expect(textOf(bench.facade.resume.mock.calls.at(-1)![3])).toContain('请让dsh打声招呼')
    expect(bench.agent!.followup).not.toHaveBeenCalled()
  })

  it('a report reaching the room agent mid-turn joins that turn instead of waking a second one', async () => {
    const bench = await bootRoom()
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada' })
    bench.facade.start.mockImplementation(async () => settledRun('child-ada', '你好，我是 ada'))
    // The human's message is the room agent's running round.
    const turn = deferred<void>()
    const agent = bench.agent! as typeof bench.agent & { status?: string; steer?: ReturnType<typeof vi.fn> }
    agent.status = 'running'
    agent.steer = vi.fn()
    agent.whenIdle.mockImplementation(() => turn.promise)
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '请邀请 ada 打个招呼' })
    await vi.waitFor(() => expect(agent.followup).toHaveBeenCalledOnce())
    // That round delegates; ada answers while the round still runs.
    await bench.service.messageMember({ sessionId: bench.sessionId, member: 'ada', text: '打个招呼' })
    await vi.waitFor(() => expect(agent.steer).toHaveBeenCalledOnce())
    expect(textOf((agent.steer.mock.calls[0]![0] as UserMessage).content)).toContain('你好，我是 ada')
    expect(agent.followup).toHaveBeenCalledOnce()
    agent.status = 'idle'
    turn.resolve()
    await bench.service.engine.idle()
    expect(agent.followup).toHaveBeenCalledOnce()
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

  it('keeps a queued native turn unstarted until durable provider admission and excludes queue time', async () => {
    const bench = await bootRoom()
    await preparedMember(bench)
    bench.localAgentStub.supportsMemberConfiguration = () => true
    const admit = deferred<void>()
    const finish = deferred<SubagentResult>()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    bench.facade.resume.mockImplementation(async (_parent, _provider, _child, _prompt, options) => {
      await admit.promise
      await options.onAdmitted()
      return { ...settledRun('child-ada', ''), result: finish.promise }
    })
    try {
      await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada wait behind independent work' })
      await tick()
      expect(bench.facade.resume).toHaveBeenCalledOnce()
      expect(await bench.service.getState({ sessionId: bench.sessionId })).toMatchObject({ ok: true, value: {
        deliveries: [{ status: 'queued' }], runs: [],
      } })
      // Stop may cancel independent member work, but it must not cancel this waiting room delivery/task.
      bench.facade.cancel.mockReturnValue(true)
      expect(await bench.service.cancel({ sessionId: bench.sessionId, name: 'ada' })).toMatchObject({ ok: true, value: { cancelled: true } })
      expect(await bench.service.getState({ sessionId: bench.sessionId })).toMatchObject({ ok: true, value: { runs: [], deliveries: [{ status: 'queued' }] } })
      clock.mockReturnValue(4000)
      admit.resolve()
      await tick()
      expect(await bench.service.getState({ sessionId: bench.sessionId })).toMatchObject({ ok: true, value: {
        deliveries: [{ status: 'running' }], runs: [{ state: 'running', startedAt: 4000 }],
      } })
      clock.mockReturnValue(4050)
      finish.resolve({ output: [{ type: 'text', text: 'actual reply' }], stopReason: 'completed' })
      await bench.service.engine.idle()
      const speech = bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents().find(event => event.type === 'room/speech')
      expect(speech?.data).toMatchObject({ durationMs: 50, text: 'actual reply' })
    } finally { clock.mockRestore() }
  })

  it('does not start native work when the room admission edge cannot be flushed', async () => {
    const bench = await bootRoom()
    await preparedMember(bench)
    bench.localAgentStub.supportsMemberConfiguration = () => true
    const admit = deferred<void>()
    const native = vi.fn()
    bench.facade.resume.mockImplementation(async (_parent, _provider, _child, _prompt, options) => {
      await admit.promise
      await options.onAdmitted()
      native()
      return settledRun('child-ada', 'must not execute')
    })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada execute once' })
    await tick()
    const flush = vi.spyOn(bench.ctx.sessions, 'flush').mockRejectedValueOnce(new Error('journal unavailable'))
    admit.resolve()
    await bench.service.engine.idle()
    expect(native).not.toHaveBeenCalled()
    expect(await bench.service.getState({ sessionId: bench.sessionId })).toMatchObject({ ok: true, value: {
      deliveries: [{ status: 'failed', error: 'journal unavailable' }],
    } })
    flush.mockRestore()
  })

  it('submits existing members to core immediately and isolates late settlement from a newer run', async () => {
    const bench = await bootRoom()
    await preparedMember(bench)
    bench.localAgentStub.supportsMemberConfiguration = () => true
    const first = deferred<SubagentResult>()
    const second = deferred<SubagentResult>()
    const olderFlushEntered = deferred<void>()
    const olderFlush = deferred<void>()
    const session = bench.ctx.sessions.get(bench.sessionId)!
    const originalFlush = bench.ctx.sessions.flush.bind(bench.ctx.sessions)
    let delayed = false
    const flush = vi.spyOn(bench.ctx.sessions, 'flush').mockImplementation(async target => {
      const last = target.snapshotEvents().at(-1)
      if (!delayed && last?.type === 'room/speech' && last.data.text === 'first own output') {
        delayed = true
        olderFlushEntered.resolve()
        await olderFlush.promise
      }
      return originalFlush(target)
    })
    let calls = 0
    bench.facade.resume.mockImplementation(async (_parent, _provider, _child, _prompt, options) => {
      const position = calls++
      if (position === 1) await olderFlushEntered.promise
      await options.onAdmitted()
      return { ...settledRun('child-ada', ''), result: position === 0 ? first.promise : second.promise }
    })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada first input' })
    await tick()
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada second input' })
    await tick()
    // Both reach the core's execution entry at once (the old room chain held
    // the second until the entire first turn settled); the member's ledger
    // runs them one at a time.
    expect(bench.localAgentStub['run']).toHaveBeenCalledTimes(2)
    expect(bench.facade.resume).toHaveBeenCalledTimes(1)
    first.resolve({ output: [{ type: 'text', text: 'first own output' }], stopReason: 'completed' })
    await olderFlushEntered.promise
    await tick()
    const admitted = await bench.service.getState({ sessionId: bench.sessionId })
    if (!admitted.ok) throw new Error('missing room')
    const secondRunId = admitted.value.runs[0]!.runId
    expect(admitted.value.deliveries?.map(row => row.status)).toEqual(['running', 'running'])
    olderFlush.resolve()
    await tick()
    const settled = await bench.service.getState({ sessionId: bench.sessionId })
    expect(settled).toMatchObject({ ok: true, value: {
      runs: [{ state: 'running', runId: secondRunId }],
      deliveries: [{ status: 'done' }, { status: 'running' }],
    } })
    expect(bench.service.engine.hasPending(session, 'ada')).toBe(true)
    bench.facade.cancel.mockReturnValue(true)
    await bench.service.cancel({ sessionId: bench.sessionId, name: 'ada' })
    second.resolve({ output: [], stopReason: 'aborted' })
    await bench.service.engine.idle()
    expect(await bench.service.getState({ sessionId: bench.sessionId })).toMatchObject({ ok: true, value: {
      deliveries: [{ status: 'done' }, { status: 'cancelled' }],
    } })
    const outcomes = session.snapshotEvents().filter(event => event.type === 'room/delivery-state' && event.data.state === 'done')
    expect(outcomes[0]?.data).toMatchObject({ text: 'first own output' })
    expect(bench.service.engine.hasPending(session, 'ada')).toBe(false)
    flush.mockRestore()
  })

  it('names a fresh member by its stable id: a second round queues in the core at once and continues the first', async () => {
    const bench = await bootRoom()
    bench.localAgentStub.supportsMemberConfiguration = () => true
    const publish = deferred<void>()
    const result = deferred<SubagentResult>()
    bench.facade.start.mockImplementation(async (_parent, _provider, _prompt, options) => {
      await publish.promise
      await options.onAdmitted()
      return { ...settledRun('fresh-child', ''), result: result.promise }
    })
    bench.facade.resume.mockImplementation(async (_parent, _provider, _child, _prompt, options) => {
      await options.onAdmitted()
      return settledRun('fresh-child', 'second output')
    })
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name: 'ada', firstTask: 'first input' })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada second input' })
    await tick()
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    if (!state.ok) throw new Error('room unavailable')
    const ada = state.value.members.find(member => member.name === 'ada')!
    // No room-side hold for the first handle: both rounds reach the core
    // under the member's own id, and only the first carries a creation identity.
    const run = bench.localAgentStub['run'] as ReturnType<typeof vi.fn>
    expect(run).toHaveBeenCalledTimes(2)
    const requests = run.mock.calls.map(call => call[0] as { member: { childSessionId: string; create?: unknown }; caller: string; key: string; callerRef: string })
    expect(requests.map(request => request.member.childSessionId)).toEqual([ada.id, ada.id])
    expect(requests[0]!.member.create).toEqual({ label: 'ada' })
    expect(requests.map(request => request.caller)).toEqual(['room', 'room'])
    // The delivery id is the key and the run id: one delivery, one execution.
    expect(requests.every(request => request.key === request.callerRef && request.key.endsWith(`:${ada.id!}`))).toBe(true)
    expect(bench.facade.start).toHaveBeenCalledOnce()
    publish.resolve()
    await tick()
    // The member's ledger runs one round at a time.
    expect(bench.facade.resume).not.toHaveBeenCalled()
    result.resolve({ output: [{ type: 'text', text: 'first output' }], stopReason: 'completed' })
    await bench.service.engine.idle()
    expect(bench.facade.start).toHaveBeenCalledOnce()
    expect(bench.facade.resume).toHaveBeenCalledOnce()
    expect(bench.facade.resume.mock.calls[0]![2]).toBe('fresh-child')
    expect(await bench.service.getState({ sessionId: bench.sessionId })).toMatchObject({ ok: true, value: { deliveries: [{ status: 'done' }, { status: 'done' }] } })
  })

  it('does not report a terminal room failure before already-started native work settles', async () => {
    const bench = await bootRoom()
    await preparedMember(bench)
    bench.localAgentStub.supportsMemberConfiguration = () => true
    const result = deferred<SubagentResult>()
    const nativeStarted = deferred<void>()
    let flush: ReturnType<typeof vi.spyOn> | undefined
    bench.facade.resume.mockImplementation(async (_parent, _provider, _child, _prompt, options) => {
      await options.onAdmitted()
      flush = vi.spyOn(bench.ctx.sessions, 'flush').mockRejectedValueOnce(new Error('handle flush failed'))
      nativeStarted.resolve()
      return { ...settledRun('child-ada', ''), result: result.promise }
    })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada work with side effects' })
    await nativeStarted.promise
    await tick()
    expect(await bench.service.getState({ sessionId: bench.sessionId })).toMatchObject({ ok: true, value: { deliveries: [{ status: 'running' }] } })
    result.resolve({ output: [], stopReason: 'completed' })
    await bench.service.engine.idle()
    expect(await bench.service.getState({ sessionId: bench.sessionId })).toMatchObject({ ok: true, value: { deliveries: [{ status: 'failed', error: 'handle flush failed' }] } })
    flush?.mockRestore()
  })

  it('deduplicates the original request across member rename and refuses changed payloads', async () => {
    const bench = await bootRoom()
    await preparedMember(bench)
    bench.facade.resume.mockImplementation(async () => settledRun('child-ada', 'only once'))
    const request = { sessionId: bench.sessionId, text: '@ada original', requestId: 'stable-retry' }
    const accepted = await bench.service.postMessage(request)
    await bench.service.engine.idle()
    await bench.service.updateMember({ sessionId: bench.sessionId, name: 'ada', rename: 'renamed' })
    expect(await bench.service.postMessage(request)).toEqual(accepted)
    expect(await bench.service.postMessage({ ...request, text: '@renamed changed' })).toEqual({ ok: false, error: { code: 'request-conflict' } })
    await bench.service.engine.idle()
    expect(bench.facade.resume).toHaveBeenCalledOnce()
  })

  it('retries durable acceptance after a failed flush without duplicating the message or dropping dispatch', async () => {
    const bench = await bootRoom()
    await preparedMember(bench)
    bench.facade.resume.mockImplementation(async () => settledRun('child-ada', 'only once'))
    const request = { sessionId: bench.sessionId, text: '@ada durable input', requestId: 'flush-retry' }
    const flush = vi.spyOn(bench.ctx.sessions, 'flush').mockRejectedValueOnce(new Error('temporary flush failure'))
    await expect(bench.service.postMessage(request)).rejects.toThrow('temporary flush failure')
    expect(bench.facade.resume).not.toHaveBeenCalled()
    expect(await bench.service.postMessage(request)).toMatchObject({ ok: true })
    await bench.service.engine.idle()
    const events = bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents()
    expect(events.filter(event => event.type === 'room/dispatch' && event.data.id === request.requestId)).toHaveLength(1)
    expect(events.filter(event => event.type === 'user/message')).toHaveLength(1)
    expect(bench.facade.resume).toHaveBeenCalledOnce()
    flush.mockRestore()
  })

  it('blocks coordinator promotion for queued core or recovered inbox work, and preserves the native seat', async () => {
    const bench = await bootRoom()
    const member = await preparedMember(bench)
    bench.localAgentStub.queuedMemberRounds = () => 1
    const promote = { sessionId: bench.sessionId, memberId: member.id!, expectedRevision: 0 }
    expect(await bench.service.setCoordinator(promote)).toEqual({ ok: false, error: { code: 'coordinator-busy' } })
    bench.localAgentStub.queuedMemberRounds = () => 0
    bench.localAgentStub.readMemberInbox = () => ({ paused: true, messages: [{ status: 'uncertain' }] })
    expect(await bench.service.setCoordinator(promote)).toEqual({ ok: false, error: { code: 'coordinator-busy' } })
    bench.localAgentStub.readMemberInbox = () => ({ paused: false, messages: [] })
    expect(await bench.service.setCoordinator(promote)).toMatchObject({ ok: true })
    expect(await bench.service.removeMember({ sessionId: bench.sessionId, name: 'dsh' })).toEqual({ ok: false, error: { code: 'main-member' } })
    expect(await bench.service.updateMember({ sessionId: bench.sessionId, name: 'ada', cwd: '/home/user/other' })).toEqual({ ok: false, error: { code: 'member-cwd-bound' } })
  })

  it('executes a formal dependency chain only after evidence review and retains a rework attempt', async () => {
    const bench = await bootRoom()
    const member = await preparedMember(bench)
    let calls = 0
    bench.facade.resume.mockImplementation(async () => settledRun('child-ada', `artifact result ${++calls}`))
    let requests = 0
    const command = async (operation: Record<string, unknown>) => {
      const state = await bench.service.getState({ sessionId: bench.sessionId })
      if (!state.ok) throw new Error('room missing')
      return JSON.parse(await bench.service.commandPlan(bench.sessionId, JSON.stringify({ requestId: `plan-command-${requests++}`, expectedRevision: state.value.plan?.revision ?? 0, ...operation })))
    }
    expect((await bench.service.getState({ sessionId: bench.sessionId }))).not.toHaveProperty('value.plan')
    await command({ action: 'create', id: 'implementation', objective: 'Implement then verify', mode: 'execute', budget: { maxParallel: 2, maxAttempts: 6, maxAttemptsPerTask: 3, maxActiveMs: 60000 } })
    const task = (id: string, dependsOn: string[]) => ({ id, title: id, stageId: 'phase', kind: 'task', ownerMemberId: member.id, instruction: `Do ${id}`, criteria: ['Reviewed evidence'], inputRefs: [], artifactPaths: ['result.txt'], dependsOn })
    await command({ action: 'extend', stages: [{ id: 'phase', title: 'Build' }], tasks: [task('build', []), task('verify', ['build'])] })
    await bench.service.engine.idle()
    expect(calls).toBe(1)
    let state = await bench.service.getState({ sessionId: bench.sessionId })
    if (!state.ok) throw new Error('room missing')
    expect(state.value.tasks).toEqual([]) // Formal tasks do not create legacy chat-task rows.
    expect(state.value.plan!.tasks.map(task => task.status)).toEqual(['submitted', 'pending'])
    const firstAttempt = state.value.plan!.tasks[0]!.attempts[0]!.id
    await command({ action: 'review', taskId: 'build', attemptId: firstAttempt, decision: 'rework', reason: 'Add missing test', references: ['review:missing-test'] })
    await bench.service.engine.idle()
    expect(calls).toBe(2)
    state = await bench.service.getState({ sessionId: bench.sessionId })
    if (!state.ok) throw new Error('room missing')
    expect(state.value.plan!.tasks[0]!.attempts.map(attempt => attempt.status)).toEqual(['rejected', 'submitted'])
    await command({ action: 'review', taskId: 'build', attemptId: state.value.plan!.tasks[0]!.attempts[1]!.id, decision: 'accepted', reason: 'Build checked', references: ['review:build'] })
    await bench.service.engine.idle()
    expect(calls).toBe(3)
    expect(textOf(bench.facade.resume.mock.calls[2]![3])).toContain('artifact result 2')
    state = await bench.service.getState({ sessionId: bench.sessionId })
    if (!state.ok) throw new Error('room missing')
    await command({ action: 'review', taskId: 'verify', attemptId: state.value.plan!.tasks[1]!.attempts[0]!.id, decision: 'accepted', reason: 'Tests checked', references: ['review:verification'] })
    const complete = await command({ action: 'complete', evidence: { summary: 'Goal verified', references: ['review:build', 'review:verification'], artifacts: ['result.txt'] } })
    expect(complete.status).toBe('completed')
    expect(complete.requests).toBeUndefined()
    expect(bench.agent!.followup).toHaveBeenCalledTimes(3)
  })

  it('persists goal results while paused and releases their coordinator report on explicit resume', async () => {
    const bench = await bootRoom()
    const member = await preparedMember(bench)
    const native = deferred<SubagentResult>()
    bench.facade.resume.mockImplementation(async () => ({ ...settledRun('child-ada', ''), result: native.promise }))
    let id = 0
    const send = async (operation: Record<string, unknown>) => {
      const state = await bench.service.getState({ sessionId: bench.sessionId })
      if (!state.ok) throw new Error('room missing')
      const result = await bench.service.planCommand({ sessionId: bench.sessionId, command: JSON.stringify({ requestId: `human-${id++}`, expectedRevision: state.value.plan?.revision ?? 0, ...operation }) })
      expect(result).toEqual({ ok: true })
    }
    await send({ action: 'create', id: 'pause-goal', objective: 'Paused work', mode: 'execute', budget: { maxParallel: 1, maxAttempts: 3, maxAttemptsPerTask: 2, maxActiveMs: 60000 } })
    await bench.service.engine.idle()
    expect(bench.agent!.followup).toHaveBeenCalledOnce()
    bench.agent!.followup.mockClear()
    await send({ action: 'extend', stages: [{ id: 's', title: 'Stage' }], tasks: [{ id: 't', title: 'Task', stageId: 's', kind: 'task', ownerMemberId: member.id, instruction: 'Work', criteria: ['Evidence'], inputRefs: [], artifactPaths: [], dependsOn: [] }] })
    await tick()
    await send({ action: 'pause', reason: 'Inspect before continuing' })
    native.resolve({ output: [{ type: 'text', text: 'result while paused' }], stopReason: 'completed' })
    await bench.service.engine.idle()
    expect(bench.agent!.followup).not.toHaveBeenCalled()
    expect(await bench.service.getState({ sessionId: bench.sessionId })).toMatchObject({ ok: true, value: { plan: { status: 'paused', tasks: [{ status: 'submitted' }] } } })
    await send({ action: 'resume' })
    await bench.service.engine.idle()
    expect(bench.agent!.followup).toHaveBeenCalledOnce()
  })

  it.each([true, false])('closing a goal retires held reports and preserves an active result (settled before closing: %s)', async (settledBefore) => {
    const bench = await bootRoom()
    const member = await preparedMember(bench)
    const native = deferred<SubagentResult>()
    bench.facade.resume.mockImplementation(async () => ({ ...settledRun('child-ada', ''), result: native.promise }))
    let id = 0
    const send = async (operation: Record<string, unknown>) => {
      const state = await bench.service.getState({ sessionId: bench.sessionId })
      if (!state.ok) throw new Error('room missing')
      expect(await bench.service.planCommand({ sessionId: bench.sessionId, command: JSON.stringify({ requestId: `close-${id++}`, expectedRevision: state.value.plan?.revision ?? 0, ...operation }) })).toEqual({ ok: true })
    }
    await send({ action: 'create', id: 'closing-goal', objective: 'Close work', mode: 'execute', budget: { maxParallel: 1, maxAttempts: 2, maxAttemptsPerTask: 1, maxActiveMs: 60000 } })
    await bench.service.engine.idle()
    bench.agent!.followup.mockClear()
    await send({ action: 'extend', stages: [{ id: 's', title: 'Stage' }], tasks: [{ id: 't', title: 'Task', stageId: 's', kind: 'task', ownerMemberId: member.id, instruction: 'Work', criteria: ['Evidence'], inputRefs: [], artifactPaths: [], dependsOn: [] }] })
    await tick()
    await send({ action: 'pause', reason: 'Review first' })
    const finish = async () => { native.resolve({ output: [{ type: 'text', text: 'retained result' }], stopReason: 'completed' }); await bench.service.engine.idle() }
    if (settledBefore) await finish()
    await send({ action: 'cancel', reason: 'No further automation' })
    if (!settledBefore) await finish()
    const room = bench.ctx.sessions.get(bench.sessionId)!
    await bench.service.engine.recover(room)
    await bench.service.engine.idle()
    const result = await bench.service.getState({ sessionId: bench.sessionId })
    if (!result.ok) throw new Error('room missing')
    expect(result.value.plan).toMatchObject({ status: 'cancelled', tasks: [{ attempts: [{ submission: { summary: 'retained result' } }] }] })
    expect(result.value.deliveries?.filter(row => row.plan?.goalId === 'closing-goal' && row.status === 'queued')).toEqual([])
    expect(bench.agent!.followup).not.toHaveBeenCalled()
    expect(bench.facade.resume).toHaveBeenCalledOnce()
  })

  it('reconciles a recovered goal execution without replay and replaces its held uncertainty report', async () => {
    const bench = await bootRoom()
    const member = await preparedMember(bench)
    const room = bench.ctx.sessions.get(bench.sessionId)!
    const context = { actor: { kind: 'coordinator' as const, memberId: 'main' }, memberIds: new Set([member.id!]), now: Date.now() }
    let plan = changePlan(undefined, { action: 'create', requestId: 'seed', expectedRevision: 0, id: 'recovery', objective: 'Recover evidence', mode: 'execute', budget: { maxParallel: 1, maxAttempts: 3, maxAttemptsPerTask: 2, maxActiveMs: 60000 } }, context)
    plan = changePlan(plan, { action: 'extend', requestId: 'seed-task', expectedRevision: plan.revision, stages: [{ id: 's', title: 'Stage' }], tasks: [{ id: 't', title: 'Task', stageId: 's', kind: 'task', ownerMemberId: member.id!, instruction: 'Work', criteria: ['Evidence'], inputRefs: [], artifactPaths: [], dependsOn: [] }] }, context)
    plan = admitPlanAttempt(queuePlanAttempt(plan, 't', 'attempt', 'native-delivery', Date.now()), 't', 'attempt', Date.now())
    room.append('room/plan-state', plan)
    const roster = await bench.service.getState({ sessionId: bench.sessionId })
    if (!roster.ok) throw new Error('room missing')
    const mainId = roster.value.members[0]!.id!
    const source = room.append('room/dispatch', { id: 'native-delivery', targets: ['ada'], targetIds: [member.id!], origin: 'coordinator', replyTo: mainId, text: 'Work', plan: { goalId: plan.id, taskId: 't', attemptId: 'attempt' } })
    const deliveryId = `${source.seq}:${member.id}`
    room.append('room/delivery-state', { id: deliveryId, dispatchSeq: source.seq, memberId: member.id!, state: 'running' })
    room.append('room/run-state', { member: 'ada', runId: deliveryId, state: 'running', startedAt: Date.now() })
    const recovery = new PlanService(bench.ctx, () => bench.service.engine)
    try {
      const before = room.snapshotEvents().length
      expect(recovery.view(room.id, plan)).toMatchObject({ status: 'paused', tasks: [{ attempts: [{ status: 'uncertain' }] }] })
      expect(room.snapshotEvents()).toHaveLength(before) // Inspection never writes or starts work.
      await recovery.recover(room)
      await bench.service.engine.recover(room)
      await bench.service.engine.idle()
      expect(await bench.service.reconcileDelivery({ sessionId: bench.sessionId, deliveryId, outcome: 'done', evidence: 'Must use the formal goal review path' })).toEqual({ ok: false, error: { code: 'plan-reconciliation-required' } })
      expect(bench.facade.resume).not.toHaveBeenCalled()
      expect(bench.agent!.followup).not.toHaveBeenCalled()
      const command = JSON.stringify({ action: 'reconcile', requestId: 'reconcile-once', expectedRevision: readPlan(room)!.revision, taskId: 't', attemptId: 'attempt', outcome: 'submitted', evidence: { summary: 'Artifact verified after restart', references: ['session:child-ada'], artifacts: ['result.txt'] } })
      await recovery.command(room, command, { kind: 'human', memberId: 'human' })
      await recovery.command(room, command, { kind: 'human', memberId: 'human' }) // Lost acknowledgement.
      await bench.service.engine.idle()
      expect(readPlan(room)).toMatchObject({ status: 'paused', tasks: [{ status: 'submitted' }] })
      expect(await bench.service.getState({ sessionId: bench.sessionId })).toMatchObject({ ok: true, value: { runs: [{ member: 'ada', state: 'done' }] } })
      const reports = room.snapshotEvents().filter(event => event.type === 'room/dispatch' && event.data.reportFor?.startsWith('reconcile:'))
      expect(reports).toHaveLength(1)
      const oldReport = room.snapshotEvents().find(event => event.type === 'room/dispatch' && event.data.reportFor === deliveryId)
      expect(oldReport).toBeDefined()
      expect(room.snapshotEvents().some(event => event.type === 'room/delivery-state' && event.data.dispatchSeq === oldReport!.seq && event.data.state === 'cancelled')).toBe(true)
      expect(bench.facade.resume).not.toHaveBeenCalled()
      expect(bench.agent!.followup).not.toHaveBeenCalled()
    } finally { recovery.dispose() }
  })

  it('pauses automation when its active-time deadline expires without requiring another command', async () => {
    const bench = await bootRoom()
    vi.useFakeTimers()
    try {
      const room = bench.ctx.sessions.get(bench.sessionId)!
      const main = (await bench.service.getState({ sessionId: bench.sessionId }))
      if (!main.ok) throw new Error('room missing')
      await bench.service.plans.command(room, JSON.stringify({ action: 'create', requestId: 'deadline', expectedRevision: 0, id: 'deadline-goal', objective: 'Bounded execution', mode: 'execute', budget: { maxParallel: 1, maxAttempts: 2, maxAttemptsPerTask: 1, maxActiveMs: 100 } }), { kind: 'coordinator', memberId: main.value.members[0]!.id! })
      await vi.advanceTimersByTimeAsync(101)
      expect(readPlan(room)).toMatchObject({ status: 'paused', reason: 'Active-time budget exhausted', activeMs: 100 })
      expect(bench.agent!.followup).not.toHaveBeenCalled()
    } finally { bench.service.plans.dispose(); vi.useRealTimers() }
  })

  it('recovers unstarted deliveries and marks crashed in-flight work uncertain without replay', async () => {
    const bench = await bootRoom()
    const member = await preparedMember(bench)
    bench.facade.resume.mockImplementation(async () => settledRun('child-ada', 'done'))
    const session = bench.ctx.sessions.get(bench.sessionId)!
    // The manual path (M9's 重启后自动继续 off): recovery alone never replays.
    session.append('room/settings', { autoContinueAfterRestart: false })
    const started = session.append('room/dispatch', { id: 'crashed', targets: ['ada'], targetIds: [member.id!], origin: 'human', text: 'side effect' })
    session.append('room/delivery-state', { id: `${started.seq}:${member.id}`, dispatchSeq: started.seq, memberId: member.id!, state: 'running' })
    session.append('room/run-state', { member: 'ada', runId: `${started.seq}:${member.id}`, state: 'running', startedAt: Date.now() })
    session.append('room/dispatch', { id: 'queued', targets: ['ada'], targetIds: [member.id!], origin: 'human', text: 'next' })
    const before = session.snapshotEvents().length
    expect(await bench.service.getState({ sessionId: bench.sessionId })).toMatchObject({ ok: true, value: {
      deliveries: [{ status: 'uncertain' }, { status: 'queued' }],
      runs: [{ member: 'ada', state: 'failed', error: expect.stringContaining('unknown after restart') }],
    } })
    expect(session.snapshotEvents()).toHaveLength(before)
    expect(bench.facade.resume).not.toHaveBeenCalled()
    await bench.service.engine.recover(session)
    await bench.service.engine.idle()
    await bench.service.engine.recover(session)
    await bench.service.engine.idle()
    expect(bench.facade.resume).not.toHaveBeenCalled()
    expect(await bench.service.reconcileDelivery({ sessionId: bench.sessionId, deliveryId: `${started.seq}:${member.id}`, outcome: 'cancelled', evidence: 'Reviewed native transcript and cancelled the uncertain attempt' })).toEqual({ ok: true })
    expect(session.snapshotEvents().some(event => event.type === 'room/run-state' && event.data.runId === `${started.seq}:${member.id}` && event.data.state === 'cancelled')).toBe(true)
    await bench.service.engine.idle()
    expect(bench.facade.resume).toHaveBeenCalledTimes(1)
    expect(textOf(bench.facade.resume.mock.calls[0]![3])).toContain('next')
    expect(session.snapshotEvents().some(event => event.type === 'room/delivery-state' && event.data.state === 'uncertain')).toBe(true)
  })
})

describe('restart recovery through the core ledger (batch 5 S7)', () => {
  /** A room whose journal says ada was running delivery #1 (execution `exec-1`) when the host went away, with #2 queued behind it. */
  async function crashed() {
    const bench = await bootRoom()
    const member = await preparedMemberOf(bench)
    const stub = bench.localAgentStub as ReturnType<typeof withRunEntry>
    const room = bench.ctx.sessions.get(bench.sessionId)!
    // S7's manual path: the room's own 重启后自动继续 (M9, below) is off here.
    room.append('room/settings', { autoContinueAfterRestart: false })
    const first = room.append('room/dispatch', { id: 'crashed', targets: ['ada'], targetIds: [member.id!], origin: 'human', text: '有副作用的一轮' })
    const id = `${first.seq}:${member.id}`
    room.append('room/delivery-state', { id, dispatchSeq: first.seq, memberId: member.id!, state: 'running' })
    room.append('room/run-state', { member: 'ada', runId: id, state: 'running', startedAt: Date.now() - 5_000, childSessionId: SessionId('child-ada'), executionId: 'exec-1' })
    const second = room.append('room/dispatch', { id: 'queued', targets: ['ada'], targetIds: [member.id!], origin: 'human', text: '下一条' })
    bench.facade.resume.mockImplementation(async (_parent: string, _provider: string, child: string) => settledRun(child, '收到'))
    return { bench, member, stub, room, id, nextId: `${second.seq}:${member.id}` }
  }
  const deliveryEdges = (room: { snapshotEvents(): readonly SessionEvent[] }, id: string) =>
    room.snapshotEvents().flatMap(event => event.type === 'room/delivery-state' && event.data.id === id ? [event.data.state] : [])

  it('an execution the core says is uncertain reads 待对账 (not failed); recovery journals the core\'s verdict and resubmits nothing', async () => {
    const { bench, stub, room, id, nextId } = await crashed()
    stub.seedLedgerRow('child-ada', { id: 'exec-1', key: id, caller: 'room', status: 'uncertain' })
    const before = room.snapshotEvents().length
    // The projection (side-effect free) says what the core says; the journal is untouched until a pass.
    expect(bench.service.engine.view(bench.sessionId, replay(room.snapshotEvents()))).toMatchObject({
      deliveries: [{ id, status: 'uncertain' }, { id: nextId, status: 'queued', waiting: 'reconcile' }],
      runs: [{ member: 'ada', state: 'uncertain', error: RESTART_UNKNOWN_TEXT }],
    })
    expect(room.snapshotEvents()).toHaveLength(before)
    await bench.service.engine.recover(room)
    await bench.service.engine.idle()
    await bench.service.engine.recover(room)
    await bench.service.engine.idle()
    expect(bench.facade.resume).not.toHaveBeenCalled()
    expect(deliveryEdges(room, id)).toEqual(['running', 'uncertain'])
    expect(room.snapshotEvents().filter(event => event.type === 'room/delivery-state' && event.data.id === id).at(-1)?.data).toMatchObject({ error: DELIVERY_UNKNOWN_TEXT })
    // The card closes with the reason (the journal's failed edge); the projection keeps reading 待对账.
    expect(room.snapshotEvents().filter(event => event.type === 'room/run-state').at(-1)?.data).toMatchObject({ state: 'failed', error: RESTART_UNKNOWN_TEXT, executionId: 'exec-1' })
    expect(await bench.service.getState({ sessionId: bench.sessionId })).toMatchObject({ ok: true, value: { runs: [{ state: 'uncertain' }] } })
    expect(deliveryEdges(room, nextId)).toEqual([])
  })

  it('reconciling in the room settles the core\'s row too; the queued delivery then runs once', async () => {
    const { bench, stub, room, id, nextId } = await crashed()
    stub.seedLedgerRow('child-ada', { id: 'exec-1', key: id, caller: 'room', status: 'uncertain' })
    await bench.service.engine.recover(room)
    expect(await bench.service.reconcileDelivery({ sessionId: bench.sessionId, deliveryId: id, outcome: 'cancelled', evidence: '看过会话：没做完' })).toEqual({ ok: true })
    await bench.service.engine.idle()
    // The members page and the edit dialog read the same row: it is settled.
    const ledger = (stub['readMemberInbox'] as (child: string) => { messages: Array<{ id: string; status: string; error?: string }> })('child-ada').messages
    expect(ledger.find(row => row.id === 'exec-1')).toMatchObject({ status: 'cancelled', error: '看过会话：没做完' })
    expect(deliveryEdges(room, id)).toEqual(['running', 'uncertain', 'cancelled'])
    expect(bench.facade.resume).toHaveBeenCalledOnce()
    expect(textOf(bench.facade.resume.mock.calls[0]![3])).toContain('下一条')
    expect(deliveryEdges(room, nextId)).toEqual(['running', 'done'])
  })

  it('a core refusal of the reconciliation leaves the room untouched and says why', async () => {
    const { bench, stub, room, id } = await crashed()
    stub.seedLedgerRow('child-ada', { id: 'exec-1', key: id, caller: 'room', status: 'uncertain' })
    await bench.service.engine.recover(room)
    stub['reconcileExecution'] = () => { throw new Error('Member inbox persistence failed') }
    expect(await bench.service.reconcileDelivery({ sessionId: bench.sessionId, deliveryId: id, outcome: 'done', evidence: '核对过' }))
      .toEqual({ ok: false, error: { code: 'reconcile-failed', message: 'Member inbox persistence failed' } })
    expect(deliveryEdges(room, id)).toEqual(['running', 'uncertain'])
  })

  it('reconciling on the members page (or in the edit dialog) clears the room\'s 待对账 too', async () => {
    const { bench, stub, room, id, nextId } = await crashed()
    stub.seedLedgerRow('child-ada', { id: 'exec-1', key: id, caller: 'room', status: 'uncertain' })
    await bench.service.engine.recover(room)
    await bench.service.engine.idle()
    expect(deliveryEdges(room, id)).toEqual(['running', 'uncertain'])
    ;(stub['reconcileExecution'] as (child: string, id: string, outcome: string, evidence: string) => void)('child-ada', 'exec-1', 'done', '成员页核对：已完成')
    // The projection follows the core at once; a live read lets the journal catch up.
    expect(await bench.service.getState({ sessionId: bench.sessionId })).toMatchObject({ ok: true, value: { deliveries: [{ id, status: 'done' }, { id: nextId }] } })
    await vi.waitFor(() => expect(deliveryEdges(room, id)).toEqual(['running', 'uncertain', 'done']))
    await bench.service.engine.idle()
    expect(room.snapshotEvents().filter(event => event.type === 'room/delivery-state' && event.data.id === id).at(-1)?.data).toMatchObject({ text: '成员页核对：已完成' })
    expect(room.snapshotEvents().filter(event => event.type === 'room/run-state' && event.data.runId === id).map(event => event.data.state)).toEqual(['running', 'failed', 'done'])
    expect(bench.facade.resume).toHaveBeenCalledOnce()
    expect(deliveryEdges(room, nextId)).toEqual(['running', 'done'])
    // A room reconciliation of the same delivery now has nothing left to settle.
    expect(await bench.service.reconcileDelivery({ sessionId: bench.sessionId, deliveryId: id, outcome: 'cancelled', evidence: 'x' })).toEqual({ ok: false, error: { code: 'delivery-not-uncertain' } })
  })

  it('a delivery the core settled before the room journaled it is journaled from the core, never run again', async () => {
    const { bench, stub, room, id, nextId } = await crashed()
    stub.seedLedgerRow('child-ada', { id: 'exec-1', key: id, caller: 'room', status: 'done' })
    // #2 was admitted and finished in the core, but the room never wrote its edges.
    stub.seedLedgerRow('child-ada', { id: 'exec-2', key: nextId, caller: 'room', status: 'done' })
    await bench.service.engine.recover(room)
    await bench.service.engine.idle()
    await bench.service.engine.recover(room)
    await bench.service.engine.idle()
    expect(bench.facade.resume).not.toHaveBeenCalled()
    expect(deliveryEdges(room, id)).toEqual(['running', 'done'])
    expect(deliveryEdges(room, nextId)).toEqual(['done'])
  })

  it('a queued delivery the restart dropped from the core is resubmitted under its key and runs once, however often recovery runs', async () => {
    const { bench, stub, room, id, nextId } = await crashed()
    stub.seedLedgerRow('child-ada', { id: 'exec-1', key: id, caller: 'room', status: 'done' })
    await Promise.all([bench.service.engine.recover(room), bench.service.engine.recover(room)])
    await bench.service.engine.recover(room)
    await bench.service.engine.idle()
    await bench.service.engine.recover(room)
    await bench.service.engine.idle()
    expect(bench.facade.resume).toHaveBeenCalledOnce()
    const run = stub['run'] as ReturnType<typeof vi.fn>
    expect(new Set(run.mock.calls.map(call => (call[0] as { key: string }).key))).toEqual(new Set([nextId]))
    expect(deliveryEdges(room, nextId)).toEqual(['running', 'done'])
  })

  it('a round another caller started, cut off by a restart, reads 待对账 in the room as in the core, then the reconciled outcome', async () => {
    const bench = await bootRoom()
    await preparedMemberOf(bench)
    const stub = bench.localAgentStub as ReturnType<typeof withRunEntry>
    const room = bench.ctx.sessions.get(bench.sessionId)!
    // The room showed a members-page round as its own card; the host restarted mid-round.
    room.append('room/run-state', { member: 'ada', runId: 'execution:exec-tool', state: 'running', startedAt: Date.now() - 5_000, childSessionId: SessionId('child-ada'), executionId: 'exec-tool' })
    stub.seedLedgerRow('child-ada', { id: 'exec-tool', key: 'input-7', caller: 'composer', status: 'uncertain', text: '页面输入' })
    expect(await bench.service.getState({ sessionId: bench.sessionId })).toMatchObject({ ok: true, value: {
      runs: [{ member: 'ada', state: 'uncertain', error: RESTART_UNKNOWN_TEXT }],
      executions: [{ id: 'execution:exec-tool', state: 'uncertain' }],
    } })
    await bench.service.engine.recover(room)
    const edges = () => room.snapshotEvents().flatMap(event => event.type === 'room/run-state' && event.data.runId === 'execution:exec-tool' ? [event.data.state] : [])
    expect(edges()).toEqual(['running', 'failed'])
    await bench.service.engine.recover(room)
    expect(edges()).toEqual(['running', 'failed'])
    ;(stub['reconcileExecution'] as (child: string, id: string, outcome: string, evidence: string) => void)('child-ada', 'exec-tool', 'done', '页面核对：完成')
    expect(await bench.service.getState({ sessionId: bench.sessionId })).toMatchObject({ ok: true, value: { runs: [{ member: 'ada', state: 'done' }] } })
    await bench.service.engine.recover(room)
    expect(edges()).toEqual(['running', 'failed', 'done'])
    // It was that caller's work: no room delivery appeared.
    expect(room.snapshotEvents().some(event => event.type === 'room/delivery-state')).toBe(false)
  })

  it('a human message moves on from the lost round in the core too, so it is not refused', async () => {
    const { bench, stub, room, id } = await crashed()
    stub.seedLedgerRow('child-ada', { id: 'exec-1', key: id, caller: 'room', status: 'uncertain' })
    await bench.service.engine.recover(room)
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 换个思路' })
    await bench.service.engine.idle()
    const ledger = (stub['readMemberInbox'] as (child: string) => { messages: Array<{ id: string; status: string }> })('child-ada').messages
    expect(ledger.find(row => row.id === 'exec-1')).toMatchObject({ status: 'cancelled' })
    expect(bench.facade.resume).toHaveBeenCalledOnce()
    expect(deliveryEdges(room, id)).toEqual(['running', 'uncertain', 'cancelled'])
  })
})

describe('restart: the room continues interrupted rounds itself (M9)', () => {
  /** ada's delivery #1 (execution `exec-1`) was running when the host went away; the core says uncertain. #2 waits behind it. */
  async function crashed(options: { readonly via?: 'auto-continue' } = {}) {
    const bench = await bootRoom()
    const member = await preparedMemberOf(bench)
    const stub = bench.localAgentStub as ReturnType<typeof withRunEntry>
    const room = bench.ctx.sessions.get(bench.sessionId)!
    const first = room.append('room/dispatch', { id: 'crashed', targets: ['ada'], targetIds: [member.id!], origin: 'human', text: '有副作用的一轮',
      ...options.via === undefined ? {} : { via: options.via, continues: ['0:earlier'] } })
    const id = `${first.seq}:${member.id}`
    room.append('room/delivery-state', { id, dispatchSeq: first.seq, memberId: member.id!, state: 'running' })
    room.append('room/run-state', { member: 'ada', runId: id, state: 'running', startedAt: Date.now() - 5_000, childSessionId: SessionId('child-ada'), executionId: 'exec-1' })
    const second = room.append('room/dispatch', { id: 'queued', targets: ['ada'], targetIds: [member.id!], origin: 'human', text: '下一条' })
    stub.seedLedgerRow('child-ada', { id: 'exec-1', key: id, caller: 'room', status: 'uncertain' })
    bench.facade.resume.mockImplementation(async (_parent: string, _provider: string, child: string) => settledRun(child, '核对过了，接着做完'))
    return { bench, member, stub, room, id, nextId: `${second.seq}:${member.id}` }
  }
  /** The room's live access (every mutation, a cold room's load, getState when a round waits): recovery, then auto-continue. */
  const access = (bench: Bench) => (bench.service as unknown as { ensureLive(id: SessionId): Promise<unknown> }).ensureLive(bench.sessionId)
  const autoDispatches = (room: { snapshotEvents(): readonly SessionEvent[] }) =>
    room.snapshotEvents().flatMap(event => event.type === 'room/dispatch' && event.data.via === 'auto-continue' ? [event] : [])
  const view = async (bench: Bench) => {
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    if (!state.ok) throw new Error('room unavailable')
    return state.value
  }

  it('on (the default): recovery twice, concurrent and repeated, sends the continue message once, from the room', async () => {
    const { bench, stub, room, id, nextId } = await crashed()
    expect(replay(room.snapshotEvents()).settings?.autoContinueAfterRestart).toBe(true)
    await Promise.all([access(bench), access(bench)])
    await access(bench)
    await bench.service.engine.idle()
    await access(bench)
    await bench.service.engine.idle()
    expect(bench.facade.resume).toHaveBeenCalledOnce()
    const prompt = textOf(bench.facade.resume.mock.calls[0]![3])
    expect(prompt).toContain(RESTART_CONTINUE_TEXT)
    // The message queued behind the lost round rides along (the human's move-on, unchanged).
    expect(prompt).toContain('下一条')
    const [dispatch, ...more] = autoDispatches(room)
    expect(more).toEqual([])
    expect(dispatch!.data).toMatchObject({ origin: 'human', via: 'auto-continue', continues: [id], targets: ['ada'], text: RESTART_CONTINUE_TEXT })
    // Moved on from the lost round, in the core too.
    expect(room.snapshotEvents().filter(event => event.type === 'room/delivery-state' && event.data.id === id).at(-1)?.data).toMatchObject({ state: 'cancelled', text: AUTO_CONTINUE_MOVED_ON_TEXT })
    const ledger = (stub['readMemberInbox'] as (child: string) => { messages: Array<{ id: string; status: string }> })('child-ada').messages
    expect(ledger.find(row => row.id === 'exec-1')).toMatchObject({ status: 'cancelled' })
    expect(room.snapshotEvents().filter(event => event.type === 'room/delivery-state' && event.data.id === nextId).at(-1)?.data).toMatchObject({ state: 'done' })
    // The round's cause is the restart hand-off.
    const run = stub['run'] as ReturnType<typeof vi.fn>
    expect(run).toHaveBeenCalledOnce()
    expect((run.mock.calls[0]![0] as { cause?: unknown }).cause).toEqual({ kind: 'restart', sessionId: String(bench.sessionId) })
    expect(executionFacts(room.snapshotEvents(), bench.sessionId, dispatch!.seq).cause).toEqual({ kind: 'restart', sessionId: String(bench.sessionId) })
    // Nothing is left for the human.
    expect(interruptedRounds(await view(bench))).toEqual([])
    expect((await view(bench)).continued).toEqual([id])
  })

  it('opening the room after the restart is enough: getState brings it live and continues once', async () => {
    const { bench, room } = await crashed()
    await bench.service.getState({ sessionId: bench.sessionId })
    await bench.service.getState({ sessionId: bench.sessionId })
    await vi.waitFor(() => expect(autoDispatches(room)).toHaveLength(1))
    await bench.service.engine.idle()
    await bench.service.getState({ sessionId: bench.sessionId })
    await bench.service.engine.idle()
    expect(bench.facade.resume).toHaveBeenCalledOnce()
    expect(autoDispatches(room)).toHaveLength(1)
  })

  it('off: nothing is sent; the human gets the banner, and their 全部继续 records what it continues', async () => {
    const { bench, room, id } = await crashed()
    // Turned off on a room nobody opened since the restart: the write wins, nothing is continued on the way in.
    expect(await bench.service.setSettings({ sessionId: bench.sessionId, autoContinueAfterRestart: false })).toMatchObject({ ok: true, value: { autoContinueAfterRestart: false } })
    await bench.service.engine.idle()
    expect(autoDispatches(room)).toEqual([])
    await access(bench)
    await bench.service.getState({ sessionId: bench.sessionId })
    await access(bench)
    await bench.service.engine.idle()
    expect(bench.facade.resume).not.toHaveBeenCalled()
    expect(autoDispatches(room)).toEqual([])
    expect(interruptedRounds(await view(bench))).toEqual([{ member: 'ada', memberId: expect.any(String), runId: id, task: expect.any(String) }])
    // The human's button: the same message, with `continues` (no `via`).
    await bench.service.postMessage({ sessionId: bench.sessionId, text: RESTART_CONTINUE_TEXT, targets: ['ada'], continues: [id, 'not-a-round'] })
    await bench.service.engine.idle()
    const human = room.snapshotEvents().findLast(event => event.type === 'room/dispatch')
    expect(human?.data).toMatchObject({ origin: 'human', continues: [id] })
    expect((human?.data as { via?: string }).via).toBeUndefined()
    expect(bench.facade.resume).toHaveBeenCalledOnce()
  })

  it('turning it off wins over a live access racing the write (the room opened meanwhile)', async () => {
    const { bench, room } = await crashed()
    const [written] = await Promise.all([
      bench.service.setSettings({ sessionId: bench.sessionId, autoContinueAfterRestart: false }),
      bench.service.getState({ sessionId: bench.sessionId }),
      access(bench),
    ])
    expect(written).toMatchObject({ ok: true, value: { autoContinueAfterRestart: false } })
    await bench.service.engine.idle()
    expect(autoDispatches(room)).toEqual([])
    expect(bench.facade.resume).not.toHaveBeenCalled()
    // The banner's manual state: ada waits for the human, no reason.
    expect(restartBanner(await view(bench)).manual).toMatchObject([{ member: 'ada' }])
    expect(restartBanner(await view(bench)).auto).toBeUndefined()
  })

  it('turning it back on through the settings continues once, under the written setting', async () => {
    const { bench, room } = await crashed()
    await bench.service.setSettings({ sessionId: bench.sessionId, autoContinueAfterRestart: false })
    await bench.service.setSettings({ sessionId: bench.sessionId, autoContinueAfterRestart: true })
    await bench.service.engine.idle()
    await access(bench)
    await bench.service.engine.idle()
    expect(autoDispatches(room)).toHaveLength(1)
    expect(bench.facade.resume).toHaveBeenCalledOnce()
  })

  it('a round the human already continued is never continued again by the room', async () => {
    const { bench, room, id } = await crashed()
    room.append('room/settings', { autoContinueAfterRestart: false })
    await bench.service.postMessage({ sessionId: bench.sessionId, text: RESTART_CONTINUE_TEXT, targets: ['ada'], continues: [id] })
    await bench.service.engine.idle()
    await bench.service.setSettings({ sessionId: bench.sessionId, autoContinueAfterRestart: true })
    await access(bench)
    await bench.service.engine.idle()
    expect(autoDispatches(room)).toEqual([])
    expect(bench.facade.resume).toHaveBeenCalledOnce()
  })

  it('an auto-continued round interrupted again is not continued again: the banner says why', async () => {
    const { bench, room, id } = await crashed({ via: 'auto-continue' })
    await access(bench)
    await access(bench)
    await bench.service.engine.idle()
    expect(bench.facade.resume).not.toHaveBeenCalled()
    expect(autoDispatches(room)).toHaveLength(1)
    expect(interruptedRounds(await view(bench))).toMatchObject([{ member: 'ada', runId: id, blocked: 'again' }])
  })

  it('the member whose round requested the restart is not continued when the guard records it', async () => {
    const { bench, room, id } = await crashed()
    bench.ctx.provide('selfRestartGuard', { lastRestart: () => ({ initiatorMember: 'child-ada' }) } as never)
    await access(bench)
    await bench.service.engine.idle()
    expect(bench.facade.resume).not.toHaveBeenCalled()
    expect(autoDispatches(room)).toEqual([])
    const state = await view(bench)
    expect(state.restartFacts).toEqual({ restartInitiator: 'child-ada' })
    expect(interruptedRounds(state)).toMatchObject([{ member: 'ada', runId: id, blocked: 'self-restart' }])
  })

  it('a guard that records no member (before M10) does not hold the round back: continued once', async () => {
    const { bench, room } = await crashed()
    bench.ctx.provide('selfRestartGuard', { verify: () => ({ ok: true }) } as never)
    await access(bench)
    await access(bench)
    await bench.service.engine.idle()
    expect(autoDispatches(room)).toHaveLength(1)
    expect(bench.facade.resume).toHaveBeenCalledOnce()
  })

  it('a member whose input queue is paused, and a paused room, are left to the human', async () => {
    const paused = await crashed()
    const stub = paused.stub as Record<string, unknown>
    const read = stub['readMemberInbox'] as (child: string) => Record<string, unknown>
    stub['readMemberInbox'] = (child: string) => ({ ...read(child), paused: true })
    await access(paused.bench)
    await paused.bench.service.engine.idle()
    expect(paused.bench.facade.resume).not.toHaveBeenCalled()
    expect(autoDispatches(paused.room)).toEqual([])
    expect(interruptedRounds(await view(paused.bench))).toMatchObject([{ member: 'ada', blocked: 'queue-paused' }])

    const room = await crashed()
    room.room.append('room/settings', { paused: true })
    await access(room.bench)
    await room.bench.service.engine.idle()
    expect(room.bench.facade.resume).not.toHaveBeenCalled()
    expect(autoDispatches(room.room)).toEqual([])
    expect(interruptedRounds(await view(room.bench))).toMatchObject([{ member: 'ada', blocked: 'room-paused' }])
  })
})

describe('isRoomSource (durable source forms)', () => {
  // The room producer identity survives in two durable forms: the current
  // producer-owned kind and the V3→V4 migrated kind (released V3 files
  // rewritten by the official migration before any read serves them).
  const forms = [
    ['current producer kind', { kind: ROOM_KIND }],
    ['V3→V4 migrated kind', { kind: `plugin:${ROOM_PLUGIN}` }],
  ] as const

  it.each(forms)('accepts the %s form', (_label, source) => {
    expect(isRoomSource(source)).toBe(true)
  })

  it('rejects foreign producers in every form and malformed values', () => {
    expect(isRoomSource({ kind: 'user' })).toBe(false)
    expect(isRoomSource({ kind: 'plugin', plugin: 'other-plugin' })).toBe(false)
    expect(isRoomSource({ kind: 'plugin:other-plugin' })).toBe(false)
    // The migrated-form match is exact: a longer kind names another producer.
    expect(isRoomSource({ kind: `plugin:${ROOM_PLUGIN}-extra` })).toBe(false)
    expect(isRoomSource({ kind: 'room-extra' })).toBe(false)
    expect(isRoomSource({ kind: 'plugin' })).toBe(false)
    expect(isRoomSource({})).toBe(false)
    expect(isRoomSource(null)).toBe(false)
    expect(isRoomSource(undefined)).toBe(false)
    expect(isRoomSource('room')).toBe(false)
  })
})
