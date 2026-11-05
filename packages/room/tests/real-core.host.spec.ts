/**
 * Room against the REAL local-agent core (batch 5 S5): the real
 * LocalAgentRegistry with its `run()` entry, per-member ledger,
 * MemberControls admission and `local-agent/execution` records, on real JSONL
 * persistence in temp directories. Only the provider is fake: it behaves like
 * a family provider (takes its staged intent, admits through
 * `withMemberConfigurationRound` with the intent's execution facts, creates a
 * first round's child, mirrors one turn with the shared writer) and holds each
 * round open until the test releases it. No CLI, no model call.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore, { KNOWN_SESSION_EVENT_TYPES, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { assertReleasedV4Relationships } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import type { SubagentActivationSpec, SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import * as localAgent from '@khorsheed/dsh-local-agent'
import type { LocalAgentDelegationIntent, LocalAgentExecutionEndEvent, LocalAgentExecutionStartEvent, LocalAgentRegistry } from '@khorsheed/dsh-local-agent'
import { appendMirrorStep, closeMirrorTurn, openMirrorTurn } from '../../local-agent/src/mirror-step.ts'
import RoomService from '../src/index.ts'
import { executionRows } from '../src/client/executions.ts'
import { MEMBER_UNRECONCILED_TEXT } from '../src/dispatch.ts'
import { stubAgents } from './agents-stub.ts'
import { createRoom } from './promote.ts'

const PROVIDER = 'fake-cli'
const EXEC = 'local-agent/execution'

type ExecutionRecord = LocalAgentExecutionStartEvent | LocalAgentExecutionEndEvent
const records = (events: readonly SessionEvent[]): ExecutionRecord[] =>
  events.filter(event => event.type === EXEC).map(event => event.data as ExecutionRecord)

interface Round {
  readonly kind: 'fresh' | 'resume'
  readonly prompt: string
  readonly childSessionId: string
  release(stop?: SubagentResult['stopReason']): void
}

const mounted: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of mounted.splice(0).reverse()) await dispose()
  delete current.reportedTotal
})

/** Mount the local-agent core (again, after a "crash") on a context that already carries the host and room. */
const current: { registry?: LocalAgentRegistry; rounds: Round[]; suppressSettlement: boolean; reportedTotal?: TokenUsage } = { rounds: [], suppressSettlement: false }

async function mountCore(ctx: Context, homes: string, rounds: Round[]): Promise<{ registry: LocalAgentRegistry; dispose: () => Promise<void> }> {
  const fiber = ctx.plugin(localAgent, { homesRoot: homes })
  await fiber.await()
  const registry = ctx.get('localAgent') as LocalAgentRegistry
  registry.register({
    name: 'fake', displayName: 'Fake', homeEnvVar: 'FAKE_HOME', delegationProvider: PROVIDER,
    records: { listSessions: async () => [] }, isAuthenticated: async () => true,
    modelBroker: { modelInfo: () => ({ choices: [], switchable: true }), configurationAdapter: () => ({
      validate: async () => {}, prepare: async () => ({ model: 'm' }), apply: async () => ({ model: 'm' }),
      reconcile: async () => ({ active: false, matches: 'current', resolved: { model: 'm' } }),
    }) },
  } as never)
  // The host's subagents service outlives a core restart: it starts rounds
  // on whichever core is mounted now.
  current.registry = registry
  current.rounds = rounds
  current.suppressSettlement = false
  if (ctx.get('subagents') === undefined) {
    ctx.provide('subagents', {
      getProvider: (name: string) => name === PROVIDER ? { name } : undefined,
      startActivation: async (spec: SubagentActivationSpec) => {
        const run = await providerStart(current.registry!, ctx, { ...spec.request, signal: spec.signal } as SubagentStartRequest, current.rounds)
        return { childId: run.id, result: run.result, dispose: () => run.dispose() }
      },
    })
  }
  let disposed = false
  const dispose = async (): Promise<void> => { if (!disposed) { disposed = true; await fiber.dispose() } }
  mounted.push(dispose)
  return { registry, dispose }
}

/** The fake family provider: one mirrored turn per round, held until released. */
async function providerStart(registry: LocalAgentRegistry, ctx: Context, request: SubagentStartRequest, rounds: Round[]): Promise<SubagentRun> {
  const parentSessionId = String((request as unknown as { parent: { id: string } }).parent.id)
  const intent = registry.takeDelegationIntent(parentSessionId, PROVIDER) as LocalAgentDelegationIntent
  const childSessionId = intent.childSessionId!
  const prompt = request.prompt.map(block => (block as { text?: string }).text ?? '').join('')
  return registry.withMemberConfigurationRound({ childSessionId, provider: PROVIDER, parentSessionId, cwd: '/home/user/work' }, async () => {
    const child = ctx.sessions.get(SessionId(childSessionId))
      ?? ctx.sessions.create(SessionId(childSessionId), { meta: { cwd: '/home/user/work', parentSession: SessionId(parentSessionId), origin: 'subagent', delegationDepth: 1 } } as never)
    if (intent.kind === 'fresh') child.append('subagent/descriptor', { version: 1, mode: 'one-shot', provider: PROVIDER, label: 'Fake' } as never)
    const turn = child.snapshotEvents().filter(event => event.type === 'turn/start').length + 1
    openMirrorTurn(child, turn, 'exec')
    let settle!: (result: SubagentResult) => void
    const result = new Promise<SubagentResult>((resolve) => { settle = resolve })
    let done = false
    const release = (stop: SubagentResult['stopReason'] = 'completed'): void => {
      if (current.suppressSettlement || done) return
      done = true
      appendMirrorStep(child, turn, 1, { blocks: [{ kind: 'text', text: `answer to ${prompt.slice(-12)}` }], usage: { inputTokens: 10, outputTokens: 2 } as TokenUsage }, { provider: PROVIDER, model: 'm' })
      closeMirrorTurn(child, turn, stop, 'stopped')
      if (intent.kind === 'fresh') registry.recordDelegation({ childSessionId, provider: PROVIDER, parentSessionId, cliSessionId: 'native', cwd: '/home/user/work' })
      void registry.syncChildSession(child).then(() => {
        registry.recordRoundSettled(childSessionId, { observedModel: 'm', ...current.reportedTotal === undefined ? {} : { providerReportedUsage: current.reportedTotal } })
        settle({ stopReason: stop, output: [{ type: 'text', text: `answer to ${prompt.slice(-12)}` }] })
      })
    }
    request.signal.addEventListener('abort', () => release('aborted'))
    rounds.push({ kind: intent.kind, prompt, childSessionId, release })
    return { id: SessionId(childSessionId), result, dispose: async () => { release('aborted') } }
  }, request.signal, intent.onAdmitted, intent.execution)
}

async function mount() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const store = mkdtempSync(join(tmpdir(), 'room-real-core-store-'))
  const persistence = ctx.plugin(JsonlSessionPersistence, { root: store, compression: 'none' })
  await persistence.await()
  stubAgents(ctx)
  const homes = mkdtempSync(join(tmpdir(), 'room-real-core-homes-'))
  const rounds: Round[] = []
  const core = await mountCore(ctx, homes, rounds)
  await ctx.plugin(RoomService)
  const service = ctx.get('room') as RoomService
  const sessionId = await createRoom(ctx, service)
  mounted.push(async () => { await persistence.dispose() })
  const room = () => ctx.sessions.get(sessionId)!
  const stored = async (id: string): Promise<readonly SessionEvent[]> => {
    const reader = await ctx.sessionPersistence.open(SessionId(id), 'read')
    try { return (await reader.read(0)).events } finally { await reader.close() }
  }
  return { ctx, homes, rounds, core, service, sessionId, room, stored }
}

type Bench = Awaited<ReturnType<typeof mount>>

async function roundsReach(bench: Bench, count: number): Promise<void> {
  await vi.waitFor(() => expect(bench.rounds).toHaveLength(count))
}

/** Invite `ada` (no first task) and return its room member id. */
async function invite(bench: Bench): Promise<string> {
  const invited = await bench.service.invite({ sessionId: bench.sessionId, provider: PROVIDER, name: 'ada' })
  expect(invited).toMatchObject({ ok: true })
  const state = await bench.service.getState({ sessionId: bench.sessionId })
  if (!state.ok) throw new Error('room unavailable')
  return state.value.members.find(member => member.name === 'ada')!.id!
}

const runStates = (bench: Bench) => bench.room().snapshotEvents().flatMap(event => event.type === 'room/run-state' ? [event.data] : [])

/** The child's stored log: released-valid against the host's V4 rules, nothing quarantined. */
async function releasedLog(bench: Bench, childSessionId: string, ends: number): Promise<readonly SessionEvent[]> {
  let events: readonly SessionEvent[] = []
  await vi.waitFor(async () => {
    events = await bench.stored(childSessionId)
    expect(records(events).filter(record => record.phase === 'end')).toHaveLength(ends)
  })
  expect(() => assertReleasedV4Relationships({
    header: { version: 4, id: childSessionId, createdAt: 0, isSeeded: false, delegationDepth: 1 },
    inheritedEventCount: 0,
    events,
  } as unknown as Parameters<typeof assertReleasedV4Relationships>[0], KNOWN_SESSION_EVENT_TYPES)).not.toThrow()
  expect(existsSync(join(bench.homes, 'quarantine', `${childSessionId}.jsonl`))).toBe(false)
  return events
}

describe('room on the real local-agent core', () => {
  it('a human dispatch runs as one recorded execution: cause, key, executionId and childTurn line up', async () => {
    const bench = await mount()
    const ada = await invite(bench)
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 搭骨架' })
    await roundsReach(bench, 1)
    // The first round creates the child under the member's own id.
    expect(bench.rounds[0]).toMatchObject({ kind: 'fresh', childSessionId: ada })
    expect(bench.rounds[0]!.prompt).toContain('【房间简报】')
    const dispatch = bench.room().snapshotEvents().find(event => event.type === 'room/dispatch')!
    await vi.waitFor(() => expect(runStates(bench).map(edge => edge.state)).toEqual(['running']))
    bench.rounds[0]!.release()
    await bench.service.engine.idle()

    const edges = runStates(bench)
    expect(edges.map(edge => edge.state)).toEqual(['running', 'done'])
    const executionId = edges[0]!.executionId!
    expect(executionId).toEqual(expect.any(String))
    expect(edges[1]).toMatchObject({ executionId, childTurn: 1, childSessionId: ada, runId: `${dispatch.seq}:${ada}` })
    const child = bench.ctx.sessions.get(SessionId(ada))!.snapshotEvents()
    const [start, end] = records(child) as [LocalAgentExecutionStartEvent, LocalAgentExecutionEndEvent]
    expect(start).toMatchObject({ phase: 'start', executionId, caller: 'room', callerRef: `${dispatch.seq}:${ada}`, parentSessionId: bench.sessionId,
      cause: { kind: 'human', sessionId: bench.sessionId, via: 'room', dispatchSeq: dispatch.seq }, task: { sessionId: bench.sessionId } })
    expect(end).toMatchObject({ phase: 'end', executionId, outcome: 'done', turns: [1] })
    const ledger = bench.core.registry.readMemberInbox(ada).messages
    expect(ledger.map(row => [row.id, row.caller, row.key, row.status])).toEqual([[executionId, 'room', `${dispatch.seq}:${ada}`, 'done']])
    expect(await bench.service.getState({ sessionId: bench.sessionId })).toMatchObject({ ok: true, value: { members: [{ name: 'dsh' }, { name: 'ada', childSessionId: ada }] } })
    await releasedLog(bench, ada, 1)
  })

  it('the same delivery submitted twice is one execution', async () => {
    const bench = await mount()
    const ada = await invite(bench)
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 只做一次' })
    await roundsReach(bench, 1)
    const dispatch = bench.room().snapshotEvents().find(event => event.type === 'room/dispatch')!
    // A second engine (a recovery pass that does not know this process's work) submits it again.
    const { DispatchEngine } = await import('../src/dispatch.ts')
    const replayed = new DispatchEngine(bench.ctx)
    replayed.dispatch(bench.room(), 'ada', '只做一次', { dispatchSeq: dispatch.seq })
    await new Promise(resolve => setTimeout(resolve, 20))
    bench.rounds[0]!.release()
    await bench.service.engine.idle()
    await replayed.idle()
    expect(bench.rounds).toHaveLength(1)
    expect(bench.core.registry.readMemberInbox(ada).messages).toHaveLength(1)
    expect(bench.room().snapshotEvents().filter(event => event.type === 'room/delivery-state').map(event => event.data.state)).toEqual(['running', 'done'])
    await releasedLog(bench, ada, 1)
  })

  it('a host-tool round and a room round share one queue; the room shows the tool round as its own card', async () => {
    const bench = await mount()
    const ada = await invite(bench)
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 第一轮' })
    await roundsReach(bench, 1)
    bench.rounds[0]!.release()
    await bench.service.engine.idle()

    // The room's own agent continues ada with the host `subagent` tool: the
    // tool calls run() as caller `tool` (what tool-factory does).
    const tool = await bench.core.registry.run({ parentSessionId: bench.sessionId, provider: PROVIDER, member: { childSessionId: ada },
      input: [{ type: 'text', text: '主 agent 直接续聊' }], caller: 'tool', cause: { kind: 'tool-call', sessionId: bench.sessionId, callId: 'call-1' },
      task: { sessionId: bench.sessionId, id: 'turn:3' }, callerRef: 'call-1' })
    await roundsReach(bench, 2)
    await vi.waitFor(() => expect(runStates(bench).at(-1)).toMatchObject({ state: 'running', runId: `execution:${tool.executionId}`, executionId: tool.executionId }))
    expect(await bench.service.getState({ sessionId: bench.sessionId })).toMatchObject({ ok: true, value: { runs: [{ member: 'ada', state: 'running' }] } })
    // A room message meanwhile waits in the member's ledger: never concurrent.
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 第二轮' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(bench.rounds).toHaveLength(2)
    expect(bench.core.registry.readMemberInbox(ada).messages.map(row => [row.caller, row.status])).toEqual([['room', 'done'], ['tool', 'running'], ['room', 'queued']])
    bench.rounds[1]!.release()
    await tool.settled
    await roundsReach(bench, 3)
    expect(bench.rounds[2]).toMatchObject({ kind: 'resume' })
    expect(bench.rounds[2]!.prompt).toContain('第二轮')
    bench.rounds[2]!.release()
    await bench.service.engine.idle()
    await vi.waitFor(() => expect(runStates(bench).map(edge => [edge.runId?.startsWith('execution:') === true, edge.state])).toEqual([
      [false, 'running'], [false, 'done'], [true, 'running'], [true, 'done'], [false, 'running'], [false, 'done'],
    ]))
    const toolEdge = runStates(bench).find(edge => edge.runId === `execution:${tool.executionId}` && edge.state === 'done')
    expect(toolEdge).toMatchObject({ childTurn: 2, executionId: tool.executionId })
    const speech = bench.room().snapshotEvents().flatMap(event => event.type === 'room/speech' ? [event.data] : [])
    expect(speech.map(row => row.runId)).toContain(`execution:${tool.executionId}`)
    // The room wrote no delivery for the tool's round.
    expect(bench.room().snapshotEvents().filter(event => event.type === 'room/delivery-state').map(event => event.data.state)).toEqual(['running', 'done', 'running', 'done'])
    await releasedLog(bench, ada, 3)
  })

  it('a member with an uncertain execution: the core refuses and the room says 待对账', async () => {
    const bench = await mount()
    const ada = await invite(bench)
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 第一轮' })
    await roundsReach(bench, 1)
    bench.rounds[0]!.release()
    await bench.service.engine.idle()
    // A tool round is in flight when the core goes away; its ledger row stays running on disk.
    await bench.core.registry.run({ parentSessionId: bench.sessionId, provider: PROVIDER, member: { childSessionId: ada }, input: [{ type: 'text', text: '被打断' }], caller: 'tool' })
    await roundsReach(bench, 2)
    const dir = join(bench.homes, '.member-inbox')
    const file = join(dir, readdirSync(dir).find(name => name.endsWith('.json'))!)
    const crashed = readFileSync(file, 'utf8')
    // Simulate process loss, not a graceful stop that settles the old round as cancelled.
    current.suppressSettlement = true
    await bench.core.dispose()
    writeFileSync(file, crashed)
    const rounds: Round[] = []
    const after = await mountCore(bench.ctx, bench.homes, rounds)
    after.registry.recordDelegation({ childSessionId: ada, provider: PROVIDER, parentSessionId: bench.sessionId, cliSessionId: 'native', cwd: '/home/user/work' })
    expect(after.registry.readMemberInbox(ada).messages.map(row => row.status)).toEqual(['done', 'uncertain'])

    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 继续' })
    await bench.service.engine.idle()
    expect(rounds).toHaveLength(0)
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    if (!state.ok) throw new Error('room unavailable')
    expect(state.value.deliveries?.at(-1)).toMatchObject({ status: 'failed', error: MEMBER_UNRECONCILED_TEXT })
    // The timeline's failed row (a run-state edge; it never had a running edge, so no execution id).
    // The interrupted tool round's own card (`execution:<id>`) settles on its
    // own schedule once the old core is gone; it may land after this row
    // (more likely now that getState awaits the core's reads), so pick the
    // room delivery's edge explicitly.
    const refused = runStates(bench).filter(edge => edge.runId?.startsWith('execution:') !== true).at(-1)
    expect(refused).toMatchObject({ member: 'ada', state: 'failed', error: MEMBER_UNRECONCILED_TEXT })
    expect(refused?.executionId).toBeUndefined()
  })

  it('usage in one place (S6): the room stores no copy; getState attaches the core\'s reading (per-call sum and the CLI total)', async () => {
    const bench = await mount()
    const ada = await invite(bench)
    current.reportedTotal = { inputTokens: 1_300, outputTokens: 2 } as TokenUsage
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@ada 搭骨架' })
    await roundsReach(bench, 1)
    bench.rounds[0]!.release()
    await bench.service.engine.idle()
    await releasedLog(bench, ada, 1)
    // No usage copy in any room event: metadata carries the observed model only.
    const roomEvents = bench.room().snapshotEvents()
    const metadata = roomEvents.filter(event => event.type === 'room/execution-metadata').map(event => event.data)
    expect(metadata).toEqual([{ runId: expect.any(String), model: 'm' }])
    expect(roomEvents.some(event => typeof event.data === 'object' && event.data !== null && ('tokens' in event.data || 'usage' in event.data))).toBe(false)
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    if (!state.ok) throw new Error('room unavailable')
    const run = state.value.executions?.find(row => row.memberId === ada)
    expect(run).toMatchObject({ executionId: expect.any(String), reading: {
      outcome: 'done', turns: [1], calls: 1, callUsage: { inputTokens: 10, outputTokens: 2 }, providerReportedUsage: { inputTokens: 1_300, outputTokens: 2 },
    } })
    expect(run).not.toHaveProperty('tokens')
    expect(run?.runId).toEqual(expect.any(String))
    expect(executionRows(state.value).find(row => row.id === run!.runId)).toMatchObject({ tokens: 1_302, execution: { executionId: run!.executionId } })
  })
})
