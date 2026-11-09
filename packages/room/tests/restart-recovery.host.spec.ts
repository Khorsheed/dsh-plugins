/**
 * Restart recovery consolidation (design 2026-11-09): a round a host restart
 * cut off is closed as 「被重启打断」, the member itself checks and continues,
 * and the dispatcher only ever hears the continued round's normal report.
 * Replays the synthetic incident fixture (tests/fixtures/restart-incident.ts)
 * and the design's scenarios against the real room service and the core
 * double (run-entry-shim).
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import RoomService from '../src/index.ts'
import { readPlan } from '../src/plan-service.ts'
import { activePlanAttempts, countedAttempts, PLAN_RESTART_REASON, recoverPlan, type RoomPlan } from '../src/plan.ts'
import { replay } from '../src/journal.ts'
import { interruptedRounds } from '../src/restart-continue.ts'
import { OBSOLETE_RESTART_REPORT_TEXT, RESTART_STOPPED_TEXT, RESTART_UNKNOWN_TEXT, SUPERSEDED_BACKLOG_TEXT } from '../src/restart-interrupted.ts'
import { withRunEntry } from './run-entry-shim.ts'
import { createRoom } from './promote.ts'
import { seedRestartIncident, type IncidentCast } from './fixtures/restart-incident.ts'

export interface Bench {
  ctx: Context
  service: RoomService
  sessionId: SessionId
  facade: { start: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }
  stub: ReturnType<typeof withRunEntry> & Record<string, unknown>
}

async function bootRoom(): Promise<Bench> {
  const ctx = new Context()
  const agent = { followup: vi.fn(), whenIdle: vi.fn(async () => {}) }
  ctx.provide('agents', {
    get: () => agent,
    create: vi.fn(async (request: { sessionId: SessionId; meta?: Record<string, unknown> }) => {
      const session = ctx.sessions.create(request.sessionId, { meta: request.meta ?? {} })
      return { agent: { id: session.id, session }, dispose: async () => {} }
    }),
  } as never)
  const facade = { start: vi.fn(), resume: vi.fn(), cancel: vi.fn(() => false) }
  const stub = withRunEntry({ ...facade } as Record<string, unknown>, ctx)
  ctx.provide('localAgent', stub as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(RoomService)
  const service = ctx.get('room') as RoomService
  const sessionId = await createRoom(ctx, service)
  return { ctx, service, sessionId, facade, stub: stub as Bench['stub'] }
}

function settledRun(id: string, text: string, stopReason: SubagentResult['stopReason'] = 'completed'): SubagentRun {
  return { id: SessionId(id), localAgent: undefined, result: Promise.resolve({ output: [{ type: 'text', text }], stopReason }), dispose: async () => {} } as SubagentRun
}

/** Seat the incident's cast: two CLI members with child sessions, and 剧情师. */
async function seatCast(bench: Bench): Promise<IncidentCast> {
  const room = bench.ctx.sessions.get(bench.sessionId)!
  for (const name of ['总编排', '地图匠', '剧情师']) await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name })
  room.append('room/member-updated', { name: '总编排', childSessionId: SessionId('child-coord') })
  room.append('room/member-updated', { name: '地图匠', childSessionId: SessionId('child-map') })
  const members = replay(room.snapshotEvents()).members
  const idOf = (name: string): string => members.find(member => member.name === name)!.id!
  return {
    coordinator: { id: idOf('总编排'), name: '总编排', child: 'child-coord' },
    mapper: { id: idOf('地图匠'), name: '地图匠', child: 'child-map' },
    writer: { id: idOf('剧情师'), name: '剧情师' },
  }
}

/** The incident's room, its core ledgers seeded, every edge journaled by an earlier process (stale). */
export async function incidentRoom() {
  const bench = await bootRoom()
  const cast = await seatCast(bench)
  const room = bench.ctx.sessions.get(bench.sessionId)!
  const seeded = seedRestartIncident(room, cast, Date.now() - 3_600_000)
  for (const row of seeded.ledgers.coordinator) bench.stub.seedLedgerRow(cast.coordinator.child, row)
  for (const row of seeded.ledgers.mapper) bench.stub.seedLedgerRow(cast.mapper.child, row)
  await new Promise(resolve => setTimeout(resolve, 5))
  bench.service.engine.bootedAt = Date.now()
  bench.facade.resume.mockImplementation(async (_parent: string, _provider: string, child: string) => settledRun(child, '核对过了，接着做完'))
  return { bench, cast, room, seeded }
}

export const edges = (room: { snapshotEvents(): readonly SessionEvent[] }, id: string): string[] =>
  room.snapshotEvents().flatMap(event => event.type === 'room/delivery-state' && event.data.id === id ? [event.data.state] : [])

describe('the incident fixture (R0)', () => {
  it('replays to the shape the incident left behind: the goal stuck paused, task-a\'s attempt uncertain, task-b\'s still queued', async () => {
    const { room, seeded } = await incidentRoom()
    const plan = readPlan(room)!
    expect(plan).toMatchObject({ status: 'paused', reason: 'Reconcile uncertain attempts before continuing' })
    expect(plan.tasks.map(task => [task.id, task.status, task.attempts.map(attempt => attempt.status)])).toEqual([
      ['task-a', 'pending', ['uncertain']],
      ['task-b', 'running', ['queued']],
    ])
    const deliveries = replay(room.snapshotEvents()).deliveries!
    const status = (id: string) => deliveries.find(row => row.id === id)?.status
    expect(status(seeded.d1530)).toBe('cancelled')
    expect(status(seeded.d1539)).toBe('cancelled')
    expect(status(seeded.d1541)).toBe('done')
    expect(status(seeded.d1580)).toBe('queued')
    expect(status(seeded.d1601)).toBe('queued')
    expect(seeded.releases.map(status)).toEqual(['queued', 'queued', 'queued', 'queued', 'queued'])
  })
})

describe('the dispatcher hears only the continued round\'s normal report (R3)', () => {
  /** The coordinator (the room's own agent) dispatched work to 地图匠; a restart cut the round off; another message queued behind it. */
  async function cutOff(options: { readonly autoContinue: boolean }) {
    const bench = await bootRoom()
    const cast = await seatCast(bench)
    const room = bench.ctx.sessions.get(bench.sessionId)!
    room.append('room/settings', { reportTiming: 'each', autoContinueAfterRestart: options.autoContinue })
    const main = replay(room.snapshotEvents()).members.find(member => member.kind === 'main-agent')!
    const first = room.append('room/dispatch', { id: 'work', origin: 'coordinator', kind: 'task', from: main.id!, replyTo: main.id!,
      targets: [cast.mapper.name], targetIds: [cast.mapper.id], text: '把北岭的地形格子补完' })
    const id = `${first.seq}:${cast.mapper.id}`
    room.append('room/delivery-state', { id, dispatchSeq: first.seq, memberId: cast.mapper.id, state: 'running' })
    room.append('room/run-state', { member: cast.mapper.name, runId: id, state: 'running', startedAt: Date.now() - 5_000, executionId: 'exec-1' })
    const queued = room.append('room/dispatch', { id: 'later', origin: 'human', targets: [cast.mapper.name], targetIds: [cast.mapper.id], text: '顺便把出生点挪到桥头' })
    bench.stub.seedLedgerRow(cast.mapper.child, { id: 'exec-1', key: id, caller: 'room', status: 'cancelled', interrupted: 'restart' })
    bench.facade.resume.mockImplementation(async (_parent: string, _provider: string, child: string, prompt: readonly { text?: string }[]) =>
      settledRun(child, prompt.some(block => block.text?.includes('先核对') === true) ? '核对过：格子补完了，测试通过' : '出生点挪好了'))
    return { bench, cast, room, id, laterId: `${queued.seq}:${cast.mapper.id}` }
  }
  const access = (bench: Bench) => (bench.service as unknown as { ensureLive(id: SessionId): Promise<unknown> }).ensureLive(bench.sessionId)
  const reports = (room: { snapshotEvents(): readonly SessionEvent[] }) =>
    room.snapshotEvents().flatMap(event => event.type === 'room/dispatch' && event.data.origin === 'report' ? [event.data] : [])

  it('auto-continue: nothing reaches the coordinator while the round is cut off; the continuation\'s result arrives once, as the original delivery\'s report', async () => {
    const { bench, room, id, laterId } = await cutOff({ autoContinue: true })
    await access(bench)
    await access(bench)
    await bench.service.engine.idle()
    const continuation = room.snapshotEvents().find(event => event.type === 'room/dispatch' && event.data.via === 'auto-continue')
    expect(continuation?.data).toMatchObject({ continues: [id] })
    const continuationId = `${continuation!.seq}:${continuation!.type === 'room/dispatch' ? continuation!.data.targetIds![0] : ''}`
    expect(reports(room)).toEqual([expect.objectContaining({ reportFor: continuationId, followUpOf: id, text: '核对过：格子补完了，测试通过' })])
    // The continued round's reply says where it went, as any reported reply does.
    expect(room.snapshotEvents().find(event => event.type === 'room/speech' && event.data.runId === continuationId)?.data).toMatchObject({ reportedTo: 'dsh' })
    // The queued message ran after the continuation, on its own (no merge).
    expect(edges(room, laterId)).toEqual(['running', 'done'])
    expect(bench.facade.resume).toHaveBeenCalledTimes(2)
    expect(edges(room, id)).toEqual(['running', 'cancelled'])
  })

  it('the human\'s 全部继续 (setting off): the same single report; until then the queued message waits', async () => {
    const { bench, room, id, laterId } = await cutOff({ autoContinue: false })
    await access(bench)
    await bench.service.engine.idle()
    expect(bench.facade.resume).not.toHaveBeenCalled()
    expect(edges(room, laterId)).toEqual([])
    expect(reports(room)).toEqual([])
    expect(await bench.service.continueInterrupted({ sessionId: bench.sessionId, runIds: [id] })).toEqual({ ok: true, value: { continued: 1 } })
    await bench.service.engine.idle()
    expect(reports(room)).toEqual([expect.objectContaining({ followUpOf: id, text: '核对过：格子补完了，测试通过' })])
    expect(edges(room, laterId)).toEqual(['running', 'done'])
  })

  it('停止 (setting off): the coordinator hears 「被重启打断，已停止」 once, and the queued message goes out', async () => {
    const { bench, room, id, laterId } = await cutOff({ autoContinue: false })
    await access(bench)
    await bench.service.stopInterrupted({ sessionId: bench.sessionId, runIds: [id] })
    await bench.service.engine.idle()
    expect(reports(room).map(report => [report.reportFor, report.text])).toEqual([[id, RESTART_STOPPED_TEXT]])
    expect(edges(room, laterId)).toEqual(['running', 'done'])
    expect(bench.facade.resume).toHaveBeenCalledOnce()
  })
})

describe('the incident room after the upgrade (R3, design section G)', () => {
  it('no obsolete report reaches the coordinator: the 「结果不确定」 and 「被取代」 reports are retired, nothing new is reported for the interrupted rounds', async () => {
    const { bench, room, seeded } = await incidentRoom()
    const access = (bench.service as unknown as { ensureLive(id: SessionId): Promise<unknown> }).ensureLive.bind(bench.service)
    await access(bench.sessionId)
    await access(bench.sessionId)
    await bench.service.engine.idle()
    const last = (id: string) => room.snapshotEvents().filter(event => event.type === 'room/delivery-state' && event.data.id === id).at(-1)?.data
    // #1580 the human had cancelled in the core: journaled from the core. #1601 never reached the core: retired.
    expect(last(seeded.d1580)).toMatchObject({ state: 'cancelled' })
    expect(last(seeded.d1601)).toMatchObject({ state: 'cancelled', text: OBSOLETE_RESTART_REPORT_TEXT })
    // The coordinator's core never received either.
    const coordinatorKeys = (bench.stub['run'] as ReturnType<typeof vi.fn>).mock.calls.map(call => (call[0] as { key?: string }).key)
    expect(coordinatorKeys).not.toContain(seeded.d1580)
    expect(coordinatorKeys).not.toContain(seeded.d1601)
    // No report written after the seed mentions a restart's unknown outcome or a supersession.
    const texts = room.snapshotEvents().flatMap(event => event.type === 'room/dispatch' && event.data.origin === 'report' && event.data.releases === undefined ? [event.data.text] : [])
    expect(texts.filter(text => text === RESTART_UNKNOWN_TEXT || text === SUPERSEDED_BACKLOG_TEXT)).toHaveLength(2) // the two seeded ones, retired
    // 地图匠's legacy 「按没做完处理」 round was continued by the human's 全部继续: no banner entry for it.
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    if (!state.ok) throw new Error('room unavailable')
    expect(interruptedRounds(state.value).map(round => round.member)).not.toContain('地图匠')
    expect(state.value.deliveries?.find(row => row.id === seeded.d1530)).toMatchObject({ status: 'cancelled', endedBy: 'restart' })
  })
})

/** A new host process for the room's goal service: its once-per-process recovery runs again. */
function newPlanProcess(bench: Bench): void {
  (bench.service.plans as unknown as { recovered: Set<string> }).recovered.clear()
}

describe('formal goals after a restart (R4)', () => {
  it('the incident goal after the upgrade (section G): both attempts interrupted and uncounted, both tasks pending, the goal paused 「被重启打断」 for the human', async () => {
    const { bench, room } = await incidentRoom()
    newPlanProcess(bench)
    await (bench.service as unknown as { ensureLive(id: SessionId): Promise<unknown> }).ensureLive(bench.sessionId)
    await bench.service.engine.idle()
    const plan = readPlan(room)!
    expect(plan).toMatchObject({ status: 'paused', reason: PLAN_RESTART_REASON })
    expect(plan.tasks.map(task => [task.id, task.status, task.attempts.map(attempt => [attempt.status, attempt.interrupted])])).toEqual([
      ['task-a', 'pending', [['cancelled', 'restart']]],
      ['task-b', 'pending', [['cancelled', 'restart']]],
    ])
    expect(plan.tasks.map(task => countedAttempts(task).length)).toEqual([0, 0])
    expect(activePlanAttempts(plan)).toEqual([])
    // Nothing opened on its own (an earlier restart's goal), nothing sent to the coordinator.
    expect(room.snapshotEvents().filter(event => event.type === 'room/dispatch' && event.data.plan?.attemptId !== undefined)).toHaveLength(2)
  })

  it('全部继续 resumes it: a second attempt per task, the started one\'s brief says it was interrupted, and 地图匠 can submit the new attempt (the 5c561cf7 case)', async () => {
    const { bench, cast, room, seeded } = await incidentRoom()
    newPlanProcess(bench)
    const access = (bench.service as unknown as { ensureLive(id: SessionId): Promise<unknown> }).ensureLive.bind(bench.service)
    await access(bench.sessionId)
    await bench.service.engine.idle()
    // 地图匠's round for the new attempt stays open until released.
    let release!: () => void
    const open = new Promise<void>(resolve => { release = resolve })
    bench.facade.resume.mockImplementation(async (_parent: string, _provider: string, child: string) => child === cast.mapper.child
      ? { id: SessionId(child), localAgent: undefined, result: open.then(() => ({ output: [{ type: 'text', text: '格子补完，已提交' }], stopReason: 'completed' as const })), dispose: async () => {} } as SubagentRun
      : settledRun(child, '整合好了'))
    expect(await bench.service.continueInterrupted({ sessionId: bench.sessionId, runIds: [], goal: true })).toMatchObject({ ok: true })
    await vi.waitFor(() => expect(readPlan(room)!.tasks.find(task => task.id === 'task-b')!.attempts.at(-1)!.status).toBe('running'))
    const plan = readPlan(room)!
    expect(plan.status).toBe('running')
    const briefs = room.snapshotEvents().flatMap(event => event.type === 'room/dispatch' && event.data.plan?.attemptId !== undefined && !['attempt-a1', 'attempt-b1'].includes(event.data.plan.attemptId) ? [event.data] : [])
    const forA = briefs.find(entry => entry.plan?.taskId === 'task-a')!
    const forB = briefs.find(entry => entry.plan?.taskId === 'task-b')!
    expect(forA.text).toContain('上一次尝试（attempt-a1）被实例重启打断')
    expect(forA.continues).toEqual([seeded.d1541])
    expect(forB.text).not.toContain('被实例重启打断')
    expect(forB.continues).toBeUndefined()
    expect(plan.tasks.map(task => task.attempts.map(attempt => attempt.number))).toEqual([[1, 2], [1, 2]])
    // The member submits the NEW attempt while its round runs; the old one is gone.
    const b2 = plan.tasks.find(task => task.id === 'task-b')!.attempts.at(-1)!
    const submit = (attemptId: string, requestId: string) => bench.service.plans.command(room, JSON.stringify({ action: 'submit', taskId: 'task-b', attemptId, requestId, expectedRevision: readPlan(room)!.revision,
      evidence: { summary: '格子补完，测试通过', references: ['levels/north-ridge.json'], artifacts: [] } }), { kind: 'worker', memberId: cast.mapper.id })
    await expect(submit('attempt-b1', 'submit-old')).rejects.toThrow('superseded')
    await submit(b2.id, 'submit-new')
    expect(readPlan(room)!.tasks.find(task => task.id === 'task-b')!.attempts.at(-1)).toMatchObject({ id: b2.id, status: 'submitted' })
    release()
    await bench.service.engine.idle()
  })

  it('auto-continue on: a fresh interruption opens the next attempt at once (goal keeps running), the coordinator hears nothing in between; a second interruption in a row pauses', async () => {
    const bench = await bootRoom()
    const cast = await seatCast(bench)
    const room = bench.ctx.sessions.get(bench.sessionId)!
    room.append('room/coordinator', { version: 1, memberId: cast.coordinator.id, revision: 1, previousMemberId: '', handoff: '你是协调者。' })
    const now = Date.now()
    const plan: RoomPlan = {
      version: 1, id: 'g', revision: 1, objective: '北岭', status: 'running', activeMs: 0, resumedAt: now - 10_000,
      budget: { maxParallel: 2, maxAttempts: 3, maxAttemptsPerTask: 1, maxActiveMs: 3_600_000 }, stages: [{ id: 's', title: 'S' }],
      tasks: [{ id: 't', title: '关卡', stageId: 's', kind: 'task', ownerMemberId: cast.mapper.id, instruction: '做关卡', criteria: ['可核对'], inputRefs: [], artifactPaths: [], dependsOn: [], status: 'running',
        attempts: [{ id: 'att-1', deliveryId: 'att-1-dispatch', number: 1, status: 'running', createdAt: now - 9_000, startedAt: now - 9_000 }] }],
      requests: [],
    }
    const dispatch = room.append('room/dispatch', { id: 'att-1-dispatch', origin: 'coordinator', targets: [cast.mapper.name], targetIds: [cast.mapper.id], replyTo: cast.coordinator.id,
      text: 'Goal g, task t, attempt att-1.', plan: { goalId: 'g', taskId: 't', attemptId: 'att-1' } })
    const id = `${dispatch.seq}:${cast.mapper.id}`
    room.append('room/delivery-state', { id, dispatchSeq: dispatch.seq, memberId: cast.mapper.id, state: 'running' })
    room.append('room/run-state', { member: cast.mapper.name, runId: id, state: 'running', startedAt: now - 9_000, executionId: 'exec-att-1' })
    room.append('room/plan-state', plan)
    bench.stub.seedLedgerRow(cast.mapper.child, { id: 'exec-att-1', key: id, caller: 'room', status: 'cancelled', interrupted: 'restart' })
    let release!: () => void
    const open = new Promise<void>(resolve => { release = resolve })
    bench.facade.resume.mockImplementation(async (_parent: string, _provider: string, child: string) =>
      ({ id: SessionId(child), localAgent: undefined, result: open.then(() => ({ output: [{ type: 'text', text: '做完了' }], stopReason: 'completed' as const })), dispose: async () => {} } as SubagentRun))
    newPlanProcess(bench)
    await (bench.service as unknown as { ensureLive(id: SessionId): Promise<unknown> }).ensureLive(bench.sessionId)
    await vi.waitFor(() => expect(readPlan(room)!.tasks[0]!.attempts.at(-1)!.status).toBe('running'))
    const recovered = readPlan(room)!
    expect(recovered.status).toBe('running')
    // maxAttemptsPerTask 1, and still a second attempt: the interrupted one does not count.
    expect(recovered.tasks[0]!.attempts.map(attempt => [attempt.number, attempt.status, attempt.interrupted])).toEqual([[1, 'cancelled', 'restart'], [2, 'running', undefined]])
    const brief = room.snapshotEvents().findLast(event => event.type === 'room/dispatch' && event.data.plan?.taskId === 't')
    expect(brief?.type === 'room/dispatch' ? brief.data : undefined).toMatchObject({ continues: [id] })
    expect(brief?.type === 'room/dispatch' ? brief.data.text : '').toContain('上一次尝试（att-1）被实例重启打断')
    // No message reached the coordinator in between.
    expect(room.snapshotEvents().some(event => event.type === 'room/dispatch' && event.data.origin === 'report')).toBe(false)
    // The banner offers nothing: the goal continued the round.
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    if (!state.ok) throw new Error('room unavailable')
    expect(interruptedRounds(state.value)).toEqual([])

    // The host dies again during the second attempt: not opened a third time on its own.
    const second = recovered.tasks[0]!.attempts.at(-1)!
    const secondDispatch = room.snapshotEvents().find(event => event.type === 'room/dispatch' && event.data.id === second.deliveryId)!
    bench.stub.seedLedgerRow(cast.mapper.child, { id: 'exec-att-2', key: `${secondDispatch.seq}:${cast.mapper.id}`, caller: 'room', status: 'cancelled', interrupted: 'restart' })
    newPlanProcess(bench)
    ;(bench.service.plans as unknown as { recovered: Set<string> }).recovered.clear()
    const again = recoverPlan(readPlan(room)!, Date.now(), { autoContinue: true })
    expect(again).toMatchObject({ status: 'paused', reason: PLAN_RESTART_REASON })
    release()
    await bench.service.engine.idle()
  })
})
