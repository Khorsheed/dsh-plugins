/**
 * Room → Context Lens contract. Context Lens reads room's session events
 * structurally (no dependency on this package), so this suite runs room's
 * REAL writers through a scripted member lifecycle and records the room log
 * they produce as a checked-in fixture that lens's `room-contract.spec.ts`
 * replays through its own parsers. The fixture is stale when room's writers
 * change what they write: this suite then fails; regenerate it with
 * `UPDATE_ROOM_CONTRACT=1 pnpm --filter @khorsheed/dsh-room test` and let
 * the lens suite say whether it still reads it.
 *
 * It also pins the two `/compact` mirrors (room journal.ts, lens room.ts) to
 * the local-agent core's isCompactCommand over one case table.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { isCompactCommand as coreIsCompactCommand } from '@khorsheed/dsh-local-agent/types'
import RoomService from '../src/index.ts'
import { isCompactCommand } from '../src/journal.ts'
import { createRoom } from './promote.ts'
import { withRunEntry } from './run-entry-shim.ts'

const FIXTURE = fileURLToPath(new URL('../../context-lens/tests/fixtures/room-contract.json', import.meta.url))

/** Inputs both mirrors must judge exactly as the core does. */
const COMPACT_INPUTS = ['/compact', '  /compact\n', '/compact now', 'please /compact', '/Compact', '/compactx', '', '@ada /compact']

/** The outside session the room asks for help (step 9). */
const HELPER = 'helper-1'

/** A `dsh-session:` mention the way the host composer writes one. */
const mention = (title: string, id: string): string => `@[${title}](dsh-session:${Buffer.from(JSON.stringify(id)).toString('base64url')})`

function run(id: string, result: Promise<SubagentResult>): SubagentRun {
  return { id: SessionId(id), localAgent: undefined, result, dispose: async () => {} }
}

function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/** UUIDs (member ids, run ids, session ids) → stable placeholders by first appearance. */
function normalize(value: unknown): unknown {
  const ids = new Map<string, string>()
  const text = JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (uuid) => {
    if (!ids.has(uuid)) ids.set(uuid, `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, '0')}`)
    return ids.get(uuid)!
  })
  return JSON.parse(text)
}

/** Run room's real writers through one member lifecycle; returns the room log as log rows. */
async function produce(): Promise<unknown> {
  // A deterministic clock: every Date.now() call advances 10 ms.
  let now = 1_800_000_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => (now += 10))
  const ctx = new Context()
  ctx.provide('agents', {
    get: () => ({ followup: vi.fn(), whenIdle: vi.fn(async () => {}) }),
    create: vi.fn(async (request: { sessionId: SessionId; meta?: Record<string, unknown> }) => {
      const session = ctx.sessions.create(request.sessionId, { meta: request.meta ?? {} })
      return { agent: { id: session.id, session }, dispose: async () => {} }
    }),
  } as never)
  const facade = { start: vi.fn(), resume: vi.fn(), cancel: vi.fn(() => true) }
  ctx.provide('localAgent', withRunEntry({ ...facade }, ctx) as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(RoomService)
  const service = ctx.get('room') as RoomService
  const sessionId = await createRoom(ctx, service)
  const child = ctx.sessions.create(SessionId('child-ada'), { meta: {} })
  const round = (turn: number, text: string, stopReason: SubagentResult['stopReason'] = 'completed'): SubagentRun => {
    child.append('turn/start', { turn })
    return run('child-ada', Promise.resolve({ output: [{ type: 'text', text }], stopReason }))
  }

  // 1. A member joins with a first task (round 1), then a human message (round 2).
  facade.start.mockImplementationOnce(async () => round(1, '骨架已搭'))
  await service.invite({ sessionId, provider: 'kimi-cli', name: 'ada', firstTask: '搭骨架' })
  await service.engine.idle()
  facade.resume.mockImplementationOnce(async () => round(2, '第二块好了'))
  await service.postMessage({ sessionId, text: '@ada 第二轮' })
  await service.engine.idle()

  // 2. A rename (addressed by the member's current name).
  await service.updateMember({ sessionId, name: 'ada', rename: 'bea' })

  // 3. A run the human stops mid-round (round 3).
  let stop!: (result: SubagentResult) => void
  facade.resume.mockImplementationOnce(async () => {
    child.append('turn/start', { turn: 3 })
    return run('child-ada', new Promise(resolve => { stop = resolve }))
  })
  await service.postMessage({ sessionId, text: '@bea 长任务' })
  for (let index = 0; index < 20 && stop === undefined; index += 1) await tick()
  await service.cancel({ sessionId, name: 'bea' })
  stop({ output: [], stopReason: 'aborted' })
  await service.engine.idle()

  // 4. A relay from outside the roster, confirmed: a delivery with no journaled dispatch (UUID run id, round 4).
  await service.receiveMemberMessage({ from: 'child-outsider', to: 'bea', content: '看一下', parentSessionId: sessionId,
    provenance: { childSessionId: 'child-outsider', provider: 'codex-local', parentSessionId: sessionId } })
  const relay = ctx.sessions.get(sessionId)!.snapshotEvents().findLast(event => event.type === 'room/relay')
  if (relay?.type !== 'room/relay') throw new Error('no relay journaled')
  facade.resume.mockImplementationOnce(async () => round(4, '看过了'))
  await service.confirmRelay({ sessionId, relayId: relay.data.id })
  await service.engine.idle()

  // 5. The human's /compact: a compaction round, the provider's compaction record in the member log.
  facade.resume.mockImplementationOnce(async () => {
    child.append('local-agent/compaction', { source: 'manual', outcome: 'completed', provider: 'kimi-cli', beforeTokens: 500_000, afterTokens: 40_000,
      startedAt: Date.now(), endedAt: Date.now(), boundarySeq: child.snapshotEvents().length })
    return run('child-ada', Promise.resolve({ output: [], stopReason: 'completed' }))
  })
  await service.postMessage({ sessionId, text: '@bea /compact' })
  await service.engine.idle()

  // 6. A /compact the member's CLI reports nothing about (as Claude Code and
  //    DSH do): the core writes the fact itself, marked unrecorded (batch 5
  //    S2), and room's row says the member does not report compaction data.
  facade.resume.mockImplementationOnce(async () => {
    child.append('local-agent/compaction', { source: 'manual', outcome: 'completed', provider: 'kimi-cli',
      startedAt: Date.now(), endedAt: Date.now(), boundarySeq: child.snapshotEvents().length, unrecorded: ['usage', 'before-after', 'summary'] })
    return run('child-ada', Promise.resolve({ output: [], stopReason: 'completed' }))
  })
  await service.postMessage({ sessionId, text: '@bea /compact' })
  await service.engine.idle()

  // From here on the room has a decision model and an outside session to ask
  // (provided late, so the earlier steps write exactly what they always did).
  const judge = vi.fn(async (input: { questions?: readonly { id: string }[] }) => ({
    ok: true,
    judgement: { decisions: (input.questions ?? []).map(question => ({ id: question.id, answer: question.id === 'deliver_now' ? 0.9 : 'new' })) },
  }))
  ctx.provide('typesafe', { judge } as never)
  const helperRows: { type: string; seq: number; time: number; data: Record<string, unknown> }[] = []
  const helperTools: { name: string; execute: (args: Record<string, string>, exec: { agent: unknown }) => Promise<{ text: string }> }[] = []
  const helper = {
    id: HELPER,
    status: 'running',
    session: { id: HELPER, header: {}, snapshotEvents: () => helperRows },
    followup: vi.fn((message: { id: string; content: unknown[]; source: unknown }) => {
      helperRows.push({ type: 'user/message', seq: helperRows.length, time: Date.now(), data: { id: message.id, content: message.content, source: message.source } })
    }),
    whenIdle: vi.fn(() => new Promise<void>(() => {})),
    ctx: { get: (name: string) => name === 'tools' ? { register: (def: (typeof helperTools)[number]) => { helperTools.push(def); return () => {} } } : undefined },
  }
  ctx.provide('sessionController', { resolveAgent: vi.fn(async () => ({ agent: helper })) } as never)
  ctx.provide('sessionReferenceResolver', { listCandidates: vi.fn(async () => [{ sessionId: HELPER, label: '开发剪辑插件' }]) } as never)

  // 7. A human round that also @-mentions an outside session (the help consent);
  //    its message is the task the coordinator's later work belongs to.
  facade.resume.mockImplementationOnce(async () => round(5, '第三块好了'))
  await service.postMessage({ sessionId, text: `@bea 第三轮，卡住了就问 ${mention('开发剪辑插件', HELPER)}` })
  await service.engine.idle()

  // 8. The coordinator sends bea two pieces of work: the first report is gated
  //    by the decision model (another one is still outstanding), the second by
  //    the last-result rule. Both decisions name the gated run (S9).
  facade.resume.mockImplementationOnce(async () => round(6, '甲做完了'))
  facade.resume.mockImplementationOnce(async () => round(7, '乙做完了'))
  await service.messageMember({ sessionId, member: 'bea', text: '做甲' })
  await service.messageMember({ sessionId, member: 'bea', text: '做乙' })
  await service.engine.idle()
  for (let index = 0; index < 50 && judge.mock.calls.length === 0; index += 1) await tick()
  await service.engine.idle()

  // 9. The room's own agent asks the outside session for help (the thread
  //    carries its task, S9); the helper replies and the reply reports back.
  const room = ctx.sessions.get(sessionId)!
  await service.askHelp({ sessionId, session: '开发剪辑插件', text: '第三轮卡住了' }, { id: sessionId, session: room } as never)
  await helperTools.find(entry => entry.name === 'room_help_reply')!.execute({ text: '换个参数就好', handoff: '无' }, { agent: helper })
  await service.engine.idle()

  // 10. bea's CLI opens a round on its own after a background task the
  //     coordinator's 「做甲」 round started (member-self-started-rounds A④):
  //     the core's records (caller `cli`, cause `self`), the room's card and
  //     reply with what it continues on, and the follow-up report through the
  //     gate (its own key `execution:<id>`, `followUpOf` the original delivery).
  const first = room.snapshotEvents().find(event => event.type === 'room/dispatch' && event.data.origin === 'coordinator' && event.data.text === '做甲')
  const startedBy = room.snapshotEvents().find(event => event.type === 'room/run-state' && event.data.state === 'running' && first !== undefined && event.data.runId?.startsWith(`${first.seq}:`) === true)
  if (startedBy?.type !== 'room/run-state' || startedBy.data.executionId === undefined) throw new Error('no 做甲 run journaled')
  child.append('local-agent/execution', { phase: 'start', executionId: 'exec-self', caller: 'cli', operation: 'prompt',
    cause: { kind: 'self', reason: 'background-task', taskId: 'bash-build', taskStatus: 'completed', notificationId: 'task:bash-build:completed', startedBy: startedBy.data.executionId },
    parentSessionId: sessionId, admittedAt: Date.now() } as never)
  await tick()
  child.append('turn/start', { turn: 8 })
  child.append('assistant/message', { turn: 8, step: 1, message: { role: 'assistant', id: 'msg-self', content: [{ type: 'text', text: '后台构建通过' }] } } as never, { surfaceOp: 'append' } as never)
  child.append('local-agent/execution', { phase: 'end', executionId: 'exec-self', outcome: 'done', turns: [8], endedAt: Date.now() } as never)
  await tick()
  for (let index = 0; index < 50 && !room.snapshotEvents().some(event => event.type === 'room/dispatch' && event.data.reportFor === 'execution:exec-self'); index += 1) await tick()
  await service.engine.idle()

  const rowsOf = (id: SessionId) => ctx.sessions.get(id)!.snapshotEvents().map(event => ({ type: event.type, seq: event.seq, time: event.time, data: event.data }))
  // Help thread ids are random 8-hex prefixes: stable placeholders too.
  const helpIds = rowsOf(sessionId).flatMap(row => row.type === 'room/help' ? [(row.data as { id: string }).id] : [])
  return normalize(helpIds.reduce<unknown>((value, id, index) => JSON.parse(JSON.stringify(value).replaceAll(id, `help${String(index + 1).padStart(4, '0')}`)), {
    note: 'Generated by packages/room/tests/lens-contract.host.spec.ts from room\'s real writers; do not edit by hand.',
    roomRows: rowsOf(sessionId),
    // The member's own child session as the run-entry double writes it: its
    // turns plus the execution start/end records the core writes (shape of
    // local-agent/execution; the core-written log is pinned separately).
    childRows: rowsOf(SessionId('child-ada')),
    compactCases: COMPACT_INPUTS.map(text => ({ text, compact: coreIsCompactCommand(text) })),
  }))
}

afterEach(() => { vi.restoreAllMocks() })

describe('room → Context Lens contract fixture', () => {
  it('room\'s writers still produce the checked-in fixture lens replays', async () => {
    const produced = await produce()
    if (process.env['UPDATE_ROOM_CONTRACT'] === '1') writeFileSync(FIXTURE, `${JSON.stringify(produced, null, 2)}\n`)
    const checkedIn: unknown = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    // Stale: regenerate with UPDATE_ROOM_CONTRACT=1 and rerun the context-lens suite.
    expect(checkedIn).toEqual(produced)
  })

  it('every member run names its local-agent execution, and its terminal round is that execution\'s', async () => {
    const produced = await produce() as { roomRows: { type: string; data: { member?: string; state?: string; runId?: string; executionId?: string; childTurn?: number; operation?: string } }[] }
    // The CLI member's runs (the room's own agent, dsh, runs no local-agent execution).
    const edges = produced.roomRows.filter(row => row.type === 'room/run-state' && row.data.member !== 'dsh')
    const running = edges.filter(row => row.data.state === 'running')
    expect(running.length).toBeGreaterThan(0)
    // Batch 5 S5: every CLI member round went through run(); its running edge carries the execution id.
    for (const edge of running) expect(edge.data.executionId).toEqual(expect.any(String))
    expect(new Set(running.map(edge => edge.data.executionId)).size).toBe(running.length)
    // A prompt round's terminal edge reports a round; a compaction's none.
    for (const edge of edges.filter(row => row.data.state !== 'running')) {
      if (edge.data.operation === 'compact') expect(edge.data.childTurn).toBeUndefined()
      else expect(edge.data.childTurn).toEqual(expect.any(Number))
    }
  })

  it('pins the S9 references lens reads: a model-gated report decision names its run, task and execution; a help thread names its task', async () => {
    type Row = { type: string; seq: number; data: Record<string, unknown> }
    const produced = await produce() as { roomRows: Row[]; childRows: Row[] }
    const rows = produced.roomRows
    const gated = rows.find(row => row.type === 'room/decision' && row.data['scenario'] === 'report-timing' && row.data['call'] !== undefined)
    expect(gated?.data).toMatchObject({ outcome: 'now', runId: expect.stringMatching(/^\d+:/), task: expect.any(String), executionId: expect.any(String) })
    // The gated run is a coordinator dispatch's delivery; its task is the human round's message.
    const dispatch = rows.find(row => row.seq === Number(String(gated!.data['runId']).split(':')[0]))
    expect(dispatch?.data).toMatchObject({ origin: 'coordinator', task: gated!.data['task'] })
    expect(rows.some(row => row.type === 'room/dispatch' && row.data['origin'] === 'human' && row.data['messageId'] === gated!.data['task'])).toBe(true)
    expect(rows.find(row => row.type === 'room/run-state' && row.data['runId'] === gated!.data['runId'] && row.data['state'] === 'running')?.data['executionId']).toBe(gated!.data['executionId'])
    const help = rows.find(row => row.type === 'room/help')
    expect(help?.data['task']).toBe(gated!.data['task'])
    // The member's child log holds the execution records the run-state edges name.
    const ends = produced.childRows.filter(row => row.type === 'local-agent/execution' && row.data['phase'] === 'end').map(row => row.data['executionId'])
    expect(ends).toContain(gated!.data['executionId'])
  })

  it('the room /compact mirror judges every case exactly as the core', () => {
    for (const text of COMPACT_INPUTS) expect([text, isCompactCommand(text)]).toEqual([text, coreIsCompactCommand(text)])
  })
})
