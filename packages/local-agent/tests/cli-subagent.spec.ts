/**
 * A member CLI's own subagents as grandchild sessions (member-cli-subagents
 * M2). Synthetic inputs only: a fake family provider runs member rounds
 * through the real core admission and the shared mirror writer, and inside a
 * round "its CLI" runs subagents, mirrored through `openCliSubagent`. The
 * cases prove the grandchild is created once per subagent id, a reuse opens
 * one more execution in the same session, the stored grandchild log passes
 * the released-log check with nothing quarantined, and the member's catalog
 * row has the host's own shape — read back through the host's real
 * SubagentRuntime lineage listing.
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
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { assertReleasedV4Relationships } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import type { SubagentActivationSpec, SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import * as localAgent from '../src/index.ts'
import { LOCAL_AGENT_SERVICE, cliSubagentSessionId, establishSubagentCatalogChild, openCliSubagent } from '../src/index.ts'
import type { CliSubagentHandle, LocalAgentDelegationIntent, LocalAgentExecutionEndEvent, LocalAgentExecutionStartEvent } from '../src/index.ts'
import { appendMirrorStep, closeMirrorTurn, openMirrorTurn } from '../src/mirror-step.ts'

const PROVIDER = 'fake-cli'
const PARENT = 'room-parent'
const TYPE = 'local-agent/execution'
const SOURCE = { provider: PROVIDER, model: 'sub-model' }
const usage = (inputTokens: number, outputTokens: number): TokenUsage => ({ inputTokens, outputTokens } as TokenUsage)

type Round = (child: Session, turn: number) => Promise<SubagentResult>

interface Harness {
  ctx: Context
  registry: localAgent.LocalAgentRegistry
  homes: string
  next(round: Round): void
  stored(sessionId: string): Promise<readonly SessionEvent[]>
}

const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

/** The real stack and a fake family provider (see execution-records.spec.ts). */
async function mount(dirs: { root?: string; homes?: string } = {}): Promise<Harness & { dispose(): Promise<void>; root: string }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  const root = dirs.root ?? mkdtempSync(join(tmpdir(), 'cli-subagent-store-'))
  const persistence = ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await persistence.await()
  const rounds: Round[] = []
  ctx.provide('subagents', {
    getProvider: (name: string) => name === PROVIDER ? { name } : undefined,
    startActivation: async (spec: SubagentActivationSpec) => {
      const run = await providerStart({ ...spec.request, signal: spec.signal } as SubagentStartRequest, rounds.shift()!)
      return { childId: run.id, result: run.result, dispose: () => run.dispose() }
    },
  })
  const homes = dirs.homes ?? mkdtempSync(join(tmpdir(), 'cli-subagent-homes-'))
  const fiber = ctx.plugin(localAgent, { homesRoot: homes })
  await fiber.await()
  let disposed = false
  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    await fiber.dispose()
    await persistence.dispose()
  }
  disposers.push(dispose)
  const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
  registry.register({
    name: 'fake', displayName: 'Fake', homeEnvVar: 'FAKE_HOME', delegationProvider: PROVIDER,
    records: { listSessions: async () => [] }, isAuthenticated: async () => true,
    unrecorded: { live: ['internal-calls'], exec: ['call-boundaries'] },
    modelBroker: { modelInfo: () => ({ choices: [], switchable: true }), configurationAdapter: () => ({
      validate: async () => {}, prepare: async () => ({ model: 'm' }), apply: async () => ({ model: 'm' }),
      reconcile: async () => ({ active: false, matches: 'current', resolved: { model: 'm' } }),
    }) },
  } as never)
  const agent = { id: SessionId(PARENT), session: { id: SessionId(PARENT), header: { id: SessionId(PARENT), cwd: '/home/user/work' } } } as unknown as Agent
  ctx.agents.enter(agent, undefined)

  async function providerStart(request: SubagentStartRequest, round: Round): Promise<SubagentRun> {
    const intent = registry.takeDelegationIntent(PARENT, PROVIDER) as LocalAgentDelegationIntent
    const childSessionId = intent.kind === 'resume' ? intent.childSessionId : intent.childSessionId!
    return registry.withMemberConfigurationRound({ childSessionId, provider: PROVIDER, parentSessionId: PARENT, cwd: '/home/user/work' }, async () => {
      const child = ctx.sessions.get(SessionId(childSessionId))
        ?? ctx.sessions.create(SessionId(childSessionId), { meta: { cwd: '/home/user/work', parentSession: SessionId(PARENT), origin: 'subagent', delegationDepth: 1 } } as never)
      if (intent.kind === 'fresh') child.append('subagent/descriptor', { version: 1, mode: 'one-shot', provider: PROVIDER, label: 'Fake' } as never)
      const turn = child.snapshotEvents().filter(event => event.type === 'turn/start').length + 1
      const result = (async () => {
        const settled = await round(child, turn)
        await registry.syncChildSession(child)
        registry.recordRoundSettled(childSessionId, { usage: usage(1, 1) })
        return settled
      })()
      return { id: SessionId(`exec-${childSessionId}`), result, dispose: async () => {} }
    }, request.signal, intent.onAdmitted, intent.execution)
  }

  return {
    ctx, registry, homes, root, dispose,
    next: round => { rounds.push(round) },
    stored: async (sessionId) => {
      const reader = await ctx.sessionPersistence.open(SessionId(sessionId), 'read')
      try { return (await reader.read(0)).events } finally { await reader.close() }
    },
  }
}

/** A member round whose CLI calls one `Agent` tool and, while the call runs, does `inside`. */
const roundWithAgentCall = (callId: string, inside: (child: Session) => Promise<void>): Round => async (child, turn) => {
  openMirrorTurn(child, turn, 'live')
  appendMirrorStep(child, turn, 1, { blocks: [{ kind: 'tool', id: callId, name: 'Agent', args: '{"description":"看文件"}', result: 'done' }], usage: usage(500, 20) }, { provider: PROVIDER, model: 'm' })
  await inside(child)
  appendMirrorStep(child, turn, 2, { blocks: [{ kind: 'text', text: '好了' }], usage: usage(600, 10) }, { provider: PROVIDER, model: 'm' })
  closeMirrorTurn(child, turn, 'completed', '')
  return { stopReason: 'completed', output: [] }
}

const records = (events: readonly SessionEvent[]): Array<LocalAgentExecutionStartEvent | LocalAgentExecutionEndEvent> =>
  events.filter(event => event.type === TYPE).map(event => event.data as LocalAgentExecutionStartEvent | LocalAgentExecutionEndEvent)

const released = (events: readonly SessionEvent[], depth: number): string | undefined => {
  try {
    assertReleasedV4Relationships({
      header: { version: 4, id: 'grandchild', createdAt: 0, isSeeded: false, delegationDepth: depth },
      inheritedEventCount: 0,
      events,
    } as unknown as Parameters<typeof assertReleasedV4Relationships>[0], KNOWN_SESSION_EVENT_TYPES)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** The stored grandchild once `ends` end records reached persistence: released-valid, nothing quarantined. */
async function storedGrandchild(h: Harness, sessionId: string, ends: number): Promise<readonly SessionEvent[]> {
  let events: readonly SessionEvent[] = []
  await vi.waitFor(async () => {
    events = await h.stored(sessionId)
    expect(records(events).filter(record => record.phase === 'end')).toHaveLength(ends)
  })
  expect(released(events, 2)).toBeUndefined()
  expect(existsSync(join(h.homes, 'quarantine', `${sessionId}.jsonl`))).toBe(false)
  return events
}

const memberStart = (events: readonly SessionEvent[]): LocalAgentExecutionStartEvent =>
  records(events).find(record => record.phase === 'start') as LocalAgentExecutionStartEvent

describe('CLI subagents as grandchild sessions (M2)', () => {
  it('opens one grandchild per subagent id: host parent link, descriptor, one catalog row on the member', async () => {
    const h = await mount()
    const handles: CliSubagentHandle[] = []
    let member!: Session
    h.next(roundWithAgentCall('call-1', async (child) => {
      member = child
      const identity = { provider: PROVIDER, key: 'agent-0', name: 'explore', description: '看文件' }
      // Two concurrent opens and a later one: one session.
      handles.push(...await Promise.all([openCliSubagent(h.ctx, child, identity), openCliSubagent(h.ctx, child, identity)]))
      handles.push(await openCliSubagent(h.ctx, child, identity))
    }))
    const run = await h.registry.start(PARENT, PROVIDER, [{ type: 'text', text: 'go' }], { caller: 'room', task: { sessionId: 'room-1', id: 'u-1' } })
    await run.result
    const id = cliSubagentSessionId(String(member.id), 'agent-0')
    expect(new Set(handles.map(handle => handle.session))).toHaveProperty('size', 1)
    expect(handles.map(handle => handle.sessionId)).toEqual([id, id, id])
    // Concurrent opens share one opening; a later one finds the session.
    expect(handles[1]).toBe(handles[0])
    expect(handles.map(handle => handle.created)).toEqual([true, true, false])
    const grandchild = handles[0]!.session
    expect(grandchild.header).toMatchObject({ parentSession: member.id, origin: 'subagent', delegationDepth: 2, cwd: '/home/user/work' })
    expect(grandchild.snapshotEvents().filter(event => event.type === 'subagent/descriptor').map(event => event.data))
      .toEqual([{ version: expect.any(Number), mode: 'one-shot', provider: PROVIDER, label: 'explore: 看文件' }])
    const rows = member.snapshotEvents().filter(event => event.type === 'subagent/catalog').map(event => event.data)
    // The host's establishCatalogChild payload, key for key (its zod schema is strict).
    expect(rows).toEqual([{ version: 0, childId: grandchild.header.id, childCreatedAt: grandchild.header.createdAt, mode: 'one-shot', label: 'explore: 看文件' }])
    // Both logs are stored and readable; the member's catalog row is durable.
    await vi.waitFor(async () => {
      expect((await h.stored(String(member.id))).filter(event => event.type === 'subagent/catalog')).toHaveLength(1)
    })
    expect((await h.stored(id)).map(event => event.type)).toContain('subagent/descriptor')
  })

  it('one call = one execution: caller cli, the cli-subagent cause, the member execution and its task; steps through the mirror writer', async () => {
    const h = await mount()
    let member!: Session
    let handle!: CliSubagentHandle
    h.next(roundWithAgentCall('call-1', async (child) => {
      member = child
      handle = await openCliSubagent(h.ctx, child, { provider: PROVIDER, key: 'agent-0', name: 'explore', description: '看文件' })
      const execution = handle.beginExecution({ callId: 'call-1', group: { index: 0, size: 3 }, transport: 'live', admittedAt: 1000 })
      expect(handle.beginExecution({ callId: 'call-1' }).executionId).toBe(execution.executionId)
      expect(execution.mirror({ blocks: [{ kind: 'tool', id: 's-1', name: 'Read', args: '{"path":"a"}', result: 'x'.repeat(10) }], usage: usage(100, 5) }, SOURCE)).toEqual({ turn: 1, step: 1 })
      expect(execution.mirror({ blocks: [{ kind: 'text', text: '读完了' }], usage: usage(150, 8) }, SOURCE)).toEqual({ turn: 1, step: 2 })
      execution.end('done', { providerReportedUsage: usage(250, 13), endedAt: 2000 })
      expect(execution.ended).toBe(true)
      // Writes after the end are no-ops.
      expect(execution.mirror({ blocks: [{ kind: 'text', text: 'late' }] }, SOURCE)).toBeUndefined()
      execution.end('failed')
    }))
    const task = { sessionId: 'room-1', id: 'u-1' }
    const run = await h.registry.start(PARENT, PROVIDER, [{ type: 'text', text: 'go' }], { caller: 'room', task })
    await run.result
    const owner = memberStart(member.snapshotEvents())
    const events = await storedGrandchild(h, handle.sessionId, 1)
    const [start, end] = records(events) as [LocalAgentExecutionStartEvent, LocalAgentExecutionEndEvent]
    expect(start).toEqual({
      phase: 'start', executionId: start.executionId, caller: 'cli', callerRef: 'call-1', operation: 'prompt',
      cause: { kind: 'cli-subagent', sessionId: String(member.id), callId: 'call-1', executionId: owner.executionId, name: 'explore', group: { index: 0, size: 3 } },
      task, parentSessionId: String(member.id), admittedAt: 1000,
    })
    expect(end).toEqual({ phase: 'end', executionId: start.executionId, outcome: 'done', turns: [1], endedAt: 2000, unrecorded: ['internal-calls'], providerReportedUsage: usage(250, 13) })
    expect(events.filter(event => event.type === 'assistant/message').map(event => (event.data as { usage?: TokenUsage }).usage)).toEqual([usage(100, 5), usage(150, 8)])
    expect(events.map(event => event.type).filter(type => type.startsWith('turn/') || type === TYPE)).toEqual([TYPE, 'turn/start', 'turn/end', TYPE])
    // The reading the M6 wiring will use sees it under the member execution.
    const reading = localAgent.subagentReadingsFor(owner.executionId, [{ sessionId: handle.sessionId, events }])
    expect(reading).toEqual({
      subagents: [{ sessionId: handle.sessionId, executionId: start.executionId, name: 'explore', callUsage: usage(250, 13), calls: 2, providerReportedUsage: usage(250, 13) }],
      subagentUsage: usage(250, 13),
    })
  })

  it('reuse (same subagent id, a later call) → the same session, one more execution and turn', async () => {
    const h = await mount()
    let member!: Session
    const identity = { provider: PROVIDER, key: 'agent-9', name: 'coder', description: '改代码' }
    let first!: CliSubagentHandle
    h.next(roundWithAgentCall('call-1', async (child) => {
      member = child
      first = await openCliSubagent(h.ctx, child, identity)
      const execution = first.beginExecution({ callId: 'call-1' })
      execution.mirror({ blocks: [{ kind: 'text', text: '第一次' }], usage: usage(10, 1) }, SOURCE)
      execution.end('done')
    }))
    const run = await h.registry.start(PARENT, PROVIDER, [{ type: 'text', text: 'go' }])
    await run.result
    const child = String(member.id)
    h.registry.recordDelegation({ childSessionId: child, provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'native', cwd: '/home/user/work' })
    let again!: CliSubagentHandle
    h.next(roundWithAgentCall('call-2', async (session) => {
      again = await openCliSubagent(h.ctx, session, identity)
      const execution = again.beginExecution({ callId: 'call-2', resumed: true, background: true })
      execution.mirror({ blocks: [{ kind: 'text', text: '第二次' }], usage: usage(20, 2) }, SOURCE)
      execution.end('done')
    }))
    const second = await h.registry.resume(PARENT, PROVIDER, child, [{ type: 'text', text: 'more' }])
    await second.result
    expect(again.session).toBe(first.session)
    expect(again.created).toBe(false)
    const events = await storedGrandchild(h, first.sessionId, 2)
    const all = records(events)
    expect(all.map(record => record.phase)).toEqual(['start', 'end', 'start', 'end'])
    const memberExecutions = records(member.snapshotEvents()).filter(record => record.phase === 'start').map(record => record.executionId)
    expect(all[2]).toMatchObject({ cause: { callId: 'call-2', executionId: memberExecutions[1], resumed: true, background: true } })
    expect(all.filter(record => record.phase === 'end').map(record => (record as LocalAgentExecutionEndEvent).turns)).toEqual([[1], [2]])
    // Still exactly one catalog row and one descriptor.
    expect(member.snapshotEvents().filter(event => event.type === 'subagent/catalog')).toHaveLength(1)
    expect(events.filter(event => event.type === 'subagent/descriptor')).toHaveLength(1)
  })

  it('a call not yet mirrored resolves to the member\'s open execution; a call over a still-open one ends it uncertain', async () => {
    const h = await mount()
    let member!: Session
    let handle!: CliSubagentHandle
    h.next(roundWithAgentCall('call-1', async (child) => {
      member = child
      handle = await openCliSubagent(h.ctx, child, { provider: PROVIDER, key: 'agent-1' })
      // An AgentSwarm-style call the member mirror has not written yet.
      const lost = handle.beginExecution({ callId: 'call-unmirrored' })
      lost.mirror({ blocks: [{ kind: 'text', text: '半途' }] }, SOURCE)
      const next = handle.beginExecution({ callId: 'call-next' })
      expect(lost.ended).toBe(true)
      next.end('cancelled')
    }))
    const run = await h.registry.start(PARENT, PROVIDER, [{ type: 'text', text: 'go' }])
    await run.result
    const owner = memberStart(member.snapshotEvents())
    const events = await storedGrandchild(h, handle.sessionId, 2)
    const all = records(events)
    expect(all.map(record => record.phase === 'start' ? `start:${record.cause?.kind === 'cli-subagent' ? record.cause.callId : ''}` : `end:${record.outcome}`))
      .toEqual(['start:call-unmirrored', 'end:uncertain', 'start:call-next', 'end:cancelled'])
    expect((all[0] as LocalAgentExecutionStartEvent).cause).toMatchObject({ executionId: owner.executionId })
    expect(all[1]).toMatchObject({ turns: [1] })
    // No name, no description: no label at all (the host's optional field stays absent).
    expect(member.snapshotEvents().find(event => event.type === 'subagent/catalog')?.data).not.toHaveProperty('label')
    // The open turn closed aborted before the uncertain end.
    expect(events.find(event => event.type === 'turn/end')?.data).toMatchObject({ reason: { kind: 'aborted' } })
  })

  it('a restart: the stored grandchild is reattached, not recreated, and a replayed call opens no second execution', async () => {
    const before = await mount()
    let memberId!: string
    let handle!: CliSubagentHandle
    const identity = { provider: PROVIDER, key: 'agent-2', name: 'explore' }
    before.next(roundWithAgentCall('call-1', async (child) => {
      memberId = String(child.id)
      handle = await openCliSubagent(before.ctx, child, identity)
      // The subagent is mid-turn when the host goes down.
      handle.beginExecution({ callId: 'call-1' }).mirror({ blocks: [{ kind: 'text', text: '进行中' }] }, SOURCE)
    }))
    const run = await before.registry.start(PARENT, PROVIDER, [{ type: 'text', text: 'go' }])
    await run.result
    await handle.persist()
    const startedAs = records(handle.session.snapshotEvents())[0] as LocalAgentExecutionStartEvent
    await before.dispose()

    const after = await mount({ root: before.root, homes: before.homes })
    await after.registry.ensureChildLive(memberId)
    const member = after.ctx.sessions.get(SessionId(memberId))!
    const reopened = await openCliSubagent(after.ctx, member, identity)
    expect(reopened.created).toBe(false)
    expect(reopened.session).not.toBe(handle.session)
    const replay = reopened.beginExecution({ callId: 'call-1' })
    expect(replay.executionId).toBe(startedAs.executionId)
    replay.end('uncertain')
    const events = await storedGrandchild(after, reopened.sessionId, 1)
    expect(records(events)).toMatchObject([{ phase: 'start', executionId: startedAs.executionId }, { phase: 'end', outcome: 'uncertain', turns: [1] }])
    expect(member.snapshotEvents().filter(event => event.type === 'subagent/catalog')).toHaveLength(1)
    expect(events.filter(event => event.type === 'subagent/descriptor')).toHaveLength(1)
  })

  it('the host lineage reads it: SubagentRuntime.listDescendants walks room → member → subagent', async () => {
    // The host's own catalog projection and listing, no local-agent registry:
    // the module degrades to in-memory writes (nothing to persist through).
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.provide('workingDirectory', { ensure: async () => '/home/user/work' } as never)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(SessionQueryEngine)
    const room = ctx.sessions.create(SessionId('room'), { meta: { cwd: '/home/user/work' } } as never)
    const member = ctx.sessions.create(SessionId('member'), { meta: { cwd: '/home/user/work', parentSession: room.id, origin: 'subagent', delegationDepth: 1 } } as never)
    member.append('subagent/descriptor', { version: 3, mode: 'one-shot', provider: PROVIDER, label: 'Fake' } as never)
    establishSubagentCatalogChild(room, member.header, 'Fake')
    const handle = await openCliSubagent(ctx, member, { provider: PROVIDER, key: 'agent-0', name: 'explore', description: '看文件' })
    const listed = await ctx.subagents.listDescendants(room.id)
    expect(listed.map(entry => ({ id: String(entry.id), parentId: String(entry.parentId), depth: entry.depth, mode: entry.mode, label: entry.label }))).toEqual([
      { id: 'member', parentId: 'room', depth: 1, mode: 'one-shot', label: 'Fake' },
      { id: handle.sessionId, parentId: 'member', depth: 2, mode: 'one-shot', label: 'explore: 看文件' },
    ])
  })
})
