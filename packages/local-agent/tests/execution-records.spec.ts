/**
 * The core writes `local-agent/execution` start/end records around every
 * admitted member execution (batch 5 S1). These cases drive the real
 * registry facade → provider admission (`withMemberConfigurationRound`) →
 * mirror writes (`openMirrorTurn`) → real JSONL persistence, then prove the
 * stored member log loads through the host's reader, passes the released-log
 * check, and diverted nothing through the child-log guard — for a first
 * round, a resume, a compaction, a cancelled round and failed rounds.
 */
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore, { KNOWN_SESSION_EVENT_TYPES, Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { assertReleasedV4Relationships } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import type { SubagentActivationSpec, SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import * as localAgent from '../src/index.ts'
import { LOCAL_AGENT_SERVICE } from '../src/index.ts'
import type { LocalAgentDelegationIntent, LocalAgentExecutionEndEvent, LocalAgentExecutionStartEvent, LocalAgentUnrecordedDeclaration } from '../src/index.ts'
import { ExecutionRecorder } from '../src/execution-records.ts'
import { appendMirrorStep, closeMirrorTurn, openMirrorTurn } from '../src/mirror-step.ts'
import { toolCallExecution } from '../src/tool-factory.ts'

const PROVIDER = 'fake-cli'
const PARENT = 'parent-exec'
const TYPE = 'local-agent/execution'
const UNRECORDED: LocalAgentUnrecordedDeclaration = { exec: ['call-boundaries', 'per-call-usage'], live: ['internal-calls'], compact: ['compaction'] }
const TOTAL: TokenUsage = { inputTokens: 120, outputTokens: 30 } as TokenUsage

type Round = (child: Session, turn: number) => Promise<SubagentResult> | SubagentResult
interface Script {
  /** What the provider does with the child once admitted. */
  round: Round
  /** Fail the provider start after creating the child (a spawn failure). */
  failStart?: boolean
  /** The settle report: before the result, after it, or never. */
  report?: 'before' | 'after' | 'never'
  transport?: 'exec' | 'live'
}

interface Harness {
  ctx: Context
  registry: localAgent.LocalAgentRegistry
  homes: string
  dispose(): Promise<void>
  next(script: Script): void
  /** The stored member log, read through the host's persistence reader. */
  stored(childSessionId: string): Promise<readonly SessionEvent[]>
}

const harnesses: Harness[] = []
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.dispose()
  vi.useRealTimers()
})

/**
 * The real stack — SessionStore, JSONL persistence, AgentRegistry, the
 * local-agent plugin — and a provider that behaves like a family provider:
 * it takes its staged intent, runs through the core's admission with the
 * intent's execution facts, creates a first round's child session, and writes
 * its round with the shared mirror writer.
 */
async function mount(): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  const root = mkdtempSync(join(tmpdir(), 'exec-records-store-'))
  const persistence = ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await persistence.await()
  const scripts: Script[] = []
  ctx.provide('subagents', {
    getProvider: (name: string) => name === PROVIDER ? { name } : undefined,
    startActivation: async (spec: SubagentActivationSpec) => {
      const request = { ...spec.request, signal: spec.signal } as SubagentStartRequest
      const run = await providerStart(request, scripts.shift()!)
      return { childId: run.id, result: run.result, dispose: () => run.dispose() }
    },
  })
  const homes = mkdtempSync(join(tmpdir(), 'exec-records-homes-'))
  const fiber = ctx.plugin(localAgent, { homesRoot: homes })
  await fiber.await()
  const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
  registry.register({
    name: 'fake', displayName: 'Fake', homeEnvVar: 'FAKE_HOME', delegationProvider: PROVIDER,
    records: { listSessions: async () => [] }, isAuthenticated: async () => true,
    unrecorded: UNRECORDED,
    modelBroker: { modelInfo: () => ({ choices: [], switchable: true }), configurationAdapter: () => ({
      validate: async () => {}, prepare: async () => ({ model: 'm' }), apply: async () => ({ model: 'm' }),
      reconcile: async () => ({ active: false, matches: 'current', resolved: { model: 'm' } }),
    }) },
  } as never)
  const agent = { id: SessionId(PARENT), session: { id: SessionId(PARENT), header: { id: SessionId(PARENT), cwd: '/home/user/work' } } } as unknown as Agent
  ctx.agents.enter(agent, undefined)

  async function providerStart(request: SubagentStartRequest, script: Script): Promise<SubagentRun> {
    const intent = registry.takeDelegationIntent(PARENT, PROVIDER) as LocalAgentDelegationIntent
    const childSessionId = intent.kind === 'resume' ? intent.childSessionId : intent.childSessionId!
    return registry.withMemberConfigurationRound({ childSessionId, provider: PROVIDER, parentSessionId: PARENT, cwd: '/home/user/work' }, async () => {
      const child = ctx.sessions.get(SessionId(childSessionId))
        ?? ctx.sessions.create(SessionId(childSessionId), { meta: { cwd: '/home/user/work', parentSession: SessionId(PARENT), origin: 'subagent', delegationDepth: 1 } } as never)
      if (intent.kind === 'fresh') {
        child.append('subagent/descriptor', { version: 1, mode: 'one-shot', provider: PROVIDER, label: 'Fake' } as never)
      }
      if (script.failStart === true) throw new Error('spawn failed')
      const report = (): void => {
        registry.recordRoundSettled(childSessionId, { usage: TOTAL, providerReportedUsage: TOTAL })
      }
      let settle!: (result: SubagentResult) => void
      const result = new Promise<SubagentResult>((resolve) => { settle = resolve })
      const turn = child.snapshotEvents().filter(event => event.type === 'turn/start').length + 1
      void (async () => {
        const settled = await script.round(child, turn)
        await registry.syncChildSession(child)
        if (script.report === 'before') report()
        settle(settled)
        if (script.report === 'after') { await Promise.resolve(); report() }
      })()
      request.signal.addEventListener('abort', () => { settle({ stopReason: 'aborted', output: [] }) })
      return { id: SessionId(`exec-${childSessionId}`), result, dispose: async () => { settle({ stopReason: 'aborted', output: [] }) } }
    }, request.signal, intent.onAdmitted, intent.execution)
  }

  const h: Harness = {
    ctx, registry, homes,
    dispose: async () => { await fiber.dispose(); await persistence.dispose() },
    next: script => { scripts.push(script) },
    stored: async (childSessionId) => {
      const reader = await ctx.sessionPersistence.open(SessionId(childSessionId), 'read')
      try { return (await reader.read(0)).events } finally { await reader.close() }
    },
  }
  harnesses.push(h)
  return h
}

/** One mirrored prompt round: turn opened through the shared opener, one step, closed. */
const promptRound = (transport: 'exec' | 'live' = 'exec', stop: SubagentResult['stopReason'] = 'completed'): Round => (child, turn) => {
  openMirrorTurn(child, turn, transport)
  appendMirrorStep(child, turn, 1, { blocks: [{ kind: 'text', text: 'ok' }], usage: { inputTokens: 100, outputTokens: 20 } as TokenUsage }, { provider: PROVIDER, model: 'm' })
  closeMirrorTurn(child, turn, stop, 'the round failed')
  return { stopReason: stop, output: [] }
}

const records = (events: readonly SessionEvent[]): Array<LocalAgentExecutionStartEvent | LocalAgentExecutionEndEvent> =>
  events.filter(event => event.type === TYPE).map(event => event.data as LocalAgentExecutionStartEvent | LocalAgentExecutionEndEvent)

const released = (events: readonly SessionEvent[]): string | undefined => {
  try {
    assertReleasedV4Relationships({
      header: { version: 4, id: 'member', createdAt: 0, isSeeded: false, delegationDepth: 1 },
      inheritedEventCount: 0,
      events,
    } as unknown as Parameters<typeof assertReleasedV4Relationships>[0], KNOWN_SESSION_EVENT_TYPES)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** The stored log once its last end record reached persistence: readable, released-valid, nothing quarantined. */
async function storedLog(h: Harness, childSessionId: string, ends: number): Promise<readonly SessionEvent[]> {
  let events: readonly SessionEvent[] = []
  await vi.waitFor(async () => {
    events = await h.stored(childSessionId)
    expect(records(events).filter(record => record.phase === 'end')).toHaveLength(ends)
  })
  expect(released(events)).toBeUndefined()
  expect(existsSync(join(h.homes, 'quarantine', `${childSessionId}.jsonl`))).toBe(false)
  return events
}

const types = (events: readonly SessionEvent[]): string[] => events
  .map(event => event.type as string)
  .filter(type => ['subagent/descriptor', TYPE, 'turn/start', 'turn/end', 'local-agent/compaction'].includes(type))

describe('local-agent/execution records (batch 5 S1)', () => {
  it('a first round: the start lands before its first turn/start, the end after turn/end with turns, outcome, declaration and the CLI total', async () => {
    const h = await mount()
    h.next({ round: promptRound('exec'), report: 'before' })
    const cause = { kind: 'member' as const, sessionId: 'room-1', fromMemberId: 'm-2', dispatchSeq: 7 }
    const task = { sessionId: 'room-1', id: 'task-3' }
    const run = await h.registry.start(PARENT, PROVIDER, [{ type: 'text', text: 'go' }], { caller: 'room', callerRef: 'run-9', cause, task })
    await run.result
    const events = await storedLog(h, String(run.id), 1)
    expect(types(events)).toEqual(['subagent/descriptor', TYPE, 'turn/start', 'turn/end', TYPE])
    const [start, end] = records(events) as [LocalAgentExecutionStartEvent, LocalAgentExecutionEndEvent]
    expect(start).toMatchObject({ phase: 'start', caller: 'room', callerRef: 'run-9', operation: 'prompt', cause, task, parentSessionId: PARENT })
    expect(typeof start.admittedAt).toBe('number')
    expect(end).toMatchObject({ phase: 'end', executionId: start.executionId, outcome: 'done', turns: [1], unrecorded: ['call-boundaries', 'per-call-usage'], providerReportedUsage: TOTAL })
  })

  it('a resume: the start is written at admission, before the provider opens its turn; a live round copies the live declaration', async () => {
    const h = await mount()
    h.next({ round: promptRound('exec'), report: 'before' })
    const first = await h.registry.start(PARENT, PROVIDER, [{ type: 'text', text: 'go' }])
    await first.result
    const child = String(first.id)
    h.registry.recordDelegation({ childSessionId: child, provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'native', cwd: '/home/user/work' })
    await storedLog(h, child, 1)
    let startedBeforeTurn = false
    h.next({ round: (session, turn) => {
      startedBeforeTurn = records(session.snapshotEvents()).filter(record => record.phase === 'start').length === 2
      return promptRound('live')(session, turn)
    }, report: 'before' })
    const second = await h.registry.resume(PARENT, PROVIDER, child, [{ type: 'text', text: 'more' }])
    await second.result
    expect(startedBeforeTurn).toBe(true)
    const events = await storedLog(h, child, 2)
    expect(types(events)).toEqual(['subagent/descriptor', TYPE, 'turn/start', 'turn/end', TYPE, TYPE, 'turn/start', 'turn/end', TYPE])
    const second_ = records(events).slice(2) as [LocalAgentExecutionStartEvent, LocalAgentExecutionEndEvent]
    // No cause given: none recorded, and the facade is the caller.
    expect(second_[0].cause).toBeUndefined()
    expect(second_[0].caller).toBe('api')
    expect(second_[1]).toMatchObject({ outcome: 'done', turns: [2], unrecorded: ['internal-calls'] })
  })

  it('a compaction: no turn, the compact declaration, the end written without waiting for a settle report', async () => {
    const h = await mount()
    h.next({ round: promptRound('exec'), report: 'before' })
    const first = await h.registry.start(PARENT, PROVIDER, [{ type: 'text', text: 'go' }])
    await first.result
    const child = String(first.id)
    h.registry.recordDelegation({ childSessionId: child, provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'native', cwd: '/home/user/work' })
    h.next({ round: (session) => {
      session.append('local-agent/compaction', { source: 'manual', outcome: 'completed', provider: PROVIDER, startedAt: 1, endedAt: 2, boundarySeq: -1 } as never)
      return { stopReason: 'completed', output: [] }
    }, report: 'never' })
    const compaction = await h.registry.compact(PARENT, PROVIDER, child, { cause: { kind: 'human', sessionId: PARENT, via: 'compact-button' } })
    await compaction.result
    const events = await storedLog(h, child, 2)
    expect(types(events).slice(-3)).toEqual([TYPE, 'local-agent/compaction', TYPE])
    const [start, end] = records(events).slice(2) as [LocalAgentExecutionStartEvent, LocalAgentExecutionEndEvent]
    expect(start).toMatchObject({ operation: 'compact', cause: { kind: 'human', via: 'compact-button' } })
    expect(end).toMatchObject({ outcome: 'done', turns: [], unrecorded: ['compaction'] })
    expect(end.providerReportedUsage).toBeUndefined()
  })

  it('a cancelled round ends cancelled; an error round and a failed spawn end failed', async () => {
    const h = await mount()
    // Cancelled mid-round: the turn closes aborted, the end follows.
    h.next({ round: async (session, turn) => {
      openMirrorTurn(session, turn, 'exec')
      await new Promise(resolve => setTimeout(resolve, 20))
      closeMirrorTurn(session, turn, 'aborted', '')
      return { stopReason: 'aborted', output: [] }
    }, report: 'before' })
    const cancelled = await h.registry.start(PARENT, PROVIDER, [{ type: 'text', text: 'go' }])
    expect(h.registry.cancel(String(cancelled.id))).toBe(true)
    await cancelled.result
    const child = String(cancelled.id)
    let events = await storedLog(h, child, 1)
    expect(records(events)[1]).toMatchObject({ outcome: 'cancelled' })

    // An error stop.
    h.registry.recordDelegation({ childSessionId: child, provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'native', cwd: '/home/user/work' })
    h.next({ round: promptRound('exec', 'error'), report: 'before' })
    const failed = await h.registry.resume(PARENT, PROVIDER, child, [{ type: 'text', text: 'again' }])
    await failed.result
    events = await storedLog(h, child, 2)
    expect(records(events)[3]).toMatchObject({ outcome: 'failed', turns: [2] })

    // The provider's start fails after admission: the end says failed, no turns.
    h.next({ round: promptRound(), failStart: true })
    await expect(h.registry.resume(PARENT, PROVIDER, child, [{ type: 'text', text: 'once more' }])).rejects.toThrow('spawn failed')
    events = await storedLog(h, child, 3)
    expect(records(events).slice(4)).toMatchObject([{ phase: 'start' }, { phase: 'end', outcome: 'failed', turns: [] }])
    expect((records(events)[5] as LocalAgentExecutionEndEvent).unrecorded).toBeUndefined()
  })

  it('a settle report arriving after the result still lands on the end record', async () => {
    const h = await mount()
    h.next({ round: promptRound('exec'), report: 'after' })
    const run = await h.registry.start(PARENT, PROVIDER, [{ type: 'text', text: 'go' }])
    await run.result
    const events = await storedLog(h, String(run.id), 1)
    expect(records(events)[1]).toMatchObject({ outcome: 'done', providerReportedUsage: TOTAL })
  })

  it('the member composer is the caller of its rounds, with the input row as its handle', async () => {
    const h = await mount()
    h.next({ round: promptRound('exec'), report: 'before' })
    const first = await h.registry.start(PARENT, PROVIDER, [{ type: 'text', text: 'go' }])
    await first.result
    const child = String(first.id)
    h.registry.recordDelegation({ childSessionId: child, provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'native', cwd: '/home/user/work' })
    h.next({ round: promptRound('exec'), report: 'before' })
    const inputId = h.registry.enqueueMemberInput(child, 'hello', 'req-1')
    const events = await storedLog(h, child, 2)
    expect(records(events)[2]).toMatchObject({ phase: 'start', caller: 'composer', callerRef: inputId })
    expect((records(events)[2] as LocalAgentExecutionStartEvent).cause).toBeUndefined()
  })
})

describe('execution recorder', () => {
  it('a prompt round whose settle report never comes ends without a total once the wait runs out', () => {
    vi.useFakeTimers()
    const child = Session.create(SessionId('recorder-child'))
    const recorder = new ExecutionRecorder({ session: () => child, persist: () => {}, settleWaitMs: 1_000, onError: (error) => { throw error } })
    const open = recorder.admit({ childSessionId: 'recorder-child', parentSessionId: PARENT, operation: 'prompt' })
    openMirrorTurn(child, 1, 'live')
    closeMirrorTurn(child, 1, 'completed', '')
    open.settle('done')
    expect(records(child.snapshotEvents()).map(record => record.phase)).toEqual(['start'])
    vi.advanceTimersByTime(1_000)
    expect(records(child.snapshotEvents())).toMatchObject([{ phase: 'start', caller: 'api' }, { phase: 'end', outcome: 'done', turns: [1] }])
    expect((records(child.snapshotEvents())[1] as LocalAgentExecutionEndEvent).providerReportedUsage).toBeUndefined()
  })

  it('a first round whose provider never opens a turn through the mirror opener still gets its start before the end', () => {
    vi.useFakeTimers()
    let late: Session | undefined
    const recorder = new ExecutionRecorder({ session: id => id === 'late' ? late : undefined, persist: () => {}, settleWaitMs: 1_000, onError: (error) => { throw error } })
    const open = recorder.admit({ childSessionId: 'late', parentSessionId: PARENT, operation: 'prompt', unrecorded: UNRECORDED })
    late = Session.create(SessionId('late'))
    late.append('turn/start', { turn: 1 } as never)
    late.append('turn/end', { turn: 1, reason: { kind: 'completed' } } as never)
    open.settle('done')
    vi.advanceTimersByTime(1_000)
    const kinds = late.snapshotEvents().map(event => event.type as string)
    expect(kinds.slice(kinds.indexOf('turn/start'))).toEqual(['turn/start', 'turn/end', TYPE, TYPE])
    // No transport known (the opener never ran): both paths' declarations stand.
    expect(records(late.snapshotEvents())[1]).toMatchObject({ phase: 'end', turns: [1], unrecorded: ['call-boundaries', 'per-call-usage', 'internal-calls'] })
  })

  it('a provider that fails before any child exists leaves no record', () => {
    const recorder = new ExecutionRecorder({ session: () => undefined, persist: () => { throw new Error('nothing to persist') }, settleWaitMs: 0, onError: (error) => { throw error } })
    const open = recorder.admit({ childSessionId: 'never', parentSessionId: PARENT, operation: 'prompt' })
    expect(() => { open.settle('failed') }).not.toThrow()
  })
})

describe('the family tool\'s execution facts', () => {
  it('caller tool, the call id, cause tool-call, and the calling turn as the task', () => {
    const parent = Session.create(SessionId('tool-parent'))
    parent.append('turn/start', { turn: 1 } as never)
    parent.append('turn/end', { turn: 1, reason: { kind: 'completed' } } as never)
    parent.append('turn/start', { turn: 2 } as never)
    parent.append('step/start', { turn: 2, step: 1 } as never)
    parent.append('assistant/message', { turn: 2, step: 1, message: { role: 'assistant', content: [{ type: 'tool-call', id: 'call-7', name: 'subagent', arguments: '{}' }] }, stream: [] } as never, { surfaceOp: 'append' } as never)
    parent.append('tool/call', { turn: 2, step: 1, callId: 'call-7', name: 'subagent', arguments: '{}' } as never)
    expect(toolCallExecution(parent, 'call-7')).toEqual({
      caller: 'tool', callerRef: 'call-7',
      cause: { kind: 'tool-call', sessionId: 'tool-parent', callId: 'call-7' },
      task: { sessionId: 'tool-parent', id: 'turn:2' },
    })
    // A call the log does not show: no task, never a guessed one.
    expect(toolCallExecution(parent, 'call-unknown')).not.toHaveProperty('task')
  })
})
