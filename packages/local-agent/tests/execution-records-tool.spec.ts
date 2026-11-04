/**
 * The host tool path end to end (batch 5 S1): a real `subagent` tool call —
 * one that starts a member and one that continues it (user decision ④: a
 * main agent continuing a member directly) — runs through the real
 * ToolRuntime and SubagentRuntime, stages its intent, is admitted by the core,
 * opens its turn through `openMirrorTurn`, and lands in real JSONL
 * persistence. The stored member log carries the tool's start record (caller
 * `tool`, cause `tool-call`, task `turn:<n>` from the call's own `tool/call`
 * event) and an end record with outcome and turns, reads back through the
 * host reader, passes the released-log check, and quarantines nothing.
 */
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore, { KNOWN_SESSION_EVENT_TYPES, Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { assertReleasedV4Relationships } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import SubagentRuntime, { NO_START_CAPABILITIES, subprocessRunHandle } from '@deepseek-ai/dsh-subagent'
import type { SubagentProvider, SubagentResult } from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import * as localAgent from '../src/index.ts'
import { LOCAL_AGENT_SERVICE } from '../src/index.ts'
import type { LocalAgentDelegationIntent, LocalAgentExecutionEndEvent, LocalAgentExecutionStartEvent } from '../src/index.ts'
import { ExecutionRecorder } from '../src/execution-records.ts'
import { appendMirrorStep, closeMirrorTurn, openMirrorTurn } from '../src/mirror-step.ts'
import { mountSubagentDelegationTool } from '../src/tool-factory.ts'

const PROVIDER = 'fake-cli'
const PARENT = 'host-parent'
const TOOL = 'subagent_fake'
const TYPE = 'local-agent/execution'

type Record_ = LocalAgentExecutionStartEvent | LocalAgentExecutionEndEvent
const records = (events: readonly SessionEvent[]): Record_[] =>
  events.filter(event => event.type === TYPE).map(event => event.data as Record_)

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

const disposers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

/**
 * The real host stack (SessionStore, JSONL persistence, ToolRuntime,
 * SubagentRuntime, AgentRegistry, the local-agent plugin, the family tool)
 * and a provider that does what a family provider does: take its staged
 * intent, run through the core's admission with the intent's execution
 * facts, create a first round's child, open the turn through the shared
 * opener, write one step, close the turn, record the delegation.
 */
async function mount() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  ctx.provide('workingDirectory', { ensure: async () => '/home/user/work' } as never)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SubagentRuntime)
  const store = ctx.plugin(JsonlSessionPersistence, { root: mkdtempSync(join(tmpdir(), 'exec-tool-store-')), compression: 'none' })
  await store.await()
  const homes = mkdtempSync(join(tmpdir(), 'exec-tool-homes-'))
  const plugin = ctx.plugin(localAgent, { homesRoot: homes })
  await plugin.await()
  disposers.push(() => plugin.dispose(), () => store.dispose())
  const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
  registry.register({
    name: 'fake', displayName: 'Fake', homeEnvVar: 'FAKE_HOME', delegationProvider: PROVIDER,
    records: { listSessions: async () => [] }, isAuthenticated: async () => true,
    unrecorded: { exec: ['internal-calls'] },
    modelBroker: { modelInfo: () => ({ choices: [], switchable: true }), configurationAdapter: () => ({
      validate: async () => {}, prepare: async () => ({ model: 'm' }), apply: async () => ({ model: 'm' }),
      reconcile: async () => ({ active: false, matches: 'current', resolved: { model: 'm' } }),
    }) },
  } as never)

  let executions = 0
  const provider: SubagentProvider = {
    name: PROVIDER,
    capabilities: NO_START_CAPABILITIES,
    inheritsParentContext: false,
    async start(request) {
      const intent = registry.takeDelegationIntent(request.parent.session.id, PROVIDER) as LocalAgentDelegationIntent
      const childSessionId = intent.childSessionId!
      return registry.withMemberConfigurationRound({ childSessionId, provider: PROVIDER, parentSessionId: PARENT, cwd: '/home/user/work' }, async () => {
        const child = ctx.sessions.get(SessionId(childSessionId))
          ?? ctx.sessions.create(SessionId(childSessionId), { meta: { cwd: '/home/user/work', parentSession: SessionId(PARENT), origin: 'subagent', delegationDepth: 1 } } as never)
        if (intent.kind === 'fresh') child.append('subagent/descriptor', { version: 1, mode: 'one-shot', provider: PROVIDER, label: 'Fake' } as never)
        const turn = child.snapshotEvents().filter(event => event.type === 'turn/start').length + 1
        openMirrorTurn(child, turn, 'exec')
        appendMirrorStep(child, turn, 1, { blocks: [{ kind: 'text', text: 'ok' }], usage: { inputTokens: 10, outputTokens: 2 } as TokenUsage }, { provider: PROVIDER, model: 'm' })
        closeMirrorTurn(child, turn, 'completed', '')
        if (intent.kind === 'fresh') registry.recordDelegation({ childSessionId, provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'native', cwd: '/home/user/work' })
        await registry.syncChildSession(child)
        registry.recordRoundSettled(childSessionId, { usage: { inputTokens: 10, outputTokens: 2 } as TokenUsage })
        const result: Promise<SubagentResult> = Promise.resolve({ output: [{ type: 'text', text: 'done' }], stopReason: 'completed' })
        return subprocessRunHandle({
          id: SessionId(`fake-run-${++executions}`), result, signal: request.signal,
          onAbort: () => {}, requestCancel: () => {}, teardown: async () => {},
        })
      }, request.signal, intent.onAdmitted, intent.execution)
    },
  }
  ctx.subagents.registerProvider(provider)
  await ctx.plugin({ name: 'fake-tool', inject: ['tools', 'subagents', 'localAgent'], apply: (inner: Context) => mountSubagentDelegationTool(inner, { provider: PROVIDER, toolName: TOOL }, 'test-owner') })

  // The calling host session: a real log, as the agent loop writes it.
  const parentSession = Session.create(SessionId(PARENT))
  const agent = { id: SessionId(PARENT), session: parentSession } as unknown as Agent
  ctx.agents.enter(agent, undefined)

  /** One model tool call at `turn`: the loop logs its `tool/call`, then executes it. */
  const call = async (turn: number, callId: string, args: Record<string, string>) => {
    parentSession.append('turn/start', { turn } as never)
    parentSession.append('step/start', { turn, step: 1 } as never)
    parentSession.append('assistant/message', { turn, step: 1, message: { role: 'assistant', content: [{ type: 'tool-call', id: callId, name: TOOL, arguments: JSON.stringify(args) }] }, stream: [] } as never, { surfaceOp: 'append' } as never)
    parentSession.append('tool/call', { turn, step: 1, callId, name: TOOL, arguments: JSON.stringify(args) } as never)
    const batch = await ctx.tools.execute({
      calls: [{ type: 'tool-call', id: callId as ToolExecutionInput['callId'], name: TOOL, arguments: JSON.stringify(args) }],
      signal: new AbortController().signal,
      agent,
    })
    return batch.results[0]!.result
  }
  const stored = async (childSessionId: string) => {
    const reader = await ctx.sessionPersistence.open(SessionId(childSessionId), 'read')
    try { return (await reader.read(0)).events } finally { await reader.close() }
  }
  return { ctx, registry, homes, call, stored }
}

describe('host subagent tool → execution records (end to end)', () => {
  it('a starting call and a continuing call each record caller tool, cause tool-call, the calling turn, and their end', async () => {
    const h = await mount()
    const fresh = await h.call(3, 'call-start', { description: 'scout', prompt: 'look around' })
    expect(fresh.isError).toBe(false)
    const handle = /resume="([^"]+)"/.exec(fresh.content.map(block => (block as { text?: string }).text ?? '').join(''))?.[1]
    expect(handle).toBeDefined()
    const child = handle!

    // Decision ④: the main agent continues the member directly.
    const continued = await h.call(5, 'call-continue', { description: 'more', prompt: 'keep going', resume: child })
    expect(continued.isError).toBe(false)

    let events: readonly SessionEvent[] = []
    await vi.waitFor(async () => {
      events = await h.stored(child)
      expect(records(events).filter(record => record.phase === 'end')).toHaveLength(2)
    })
    expect(released(events)).toBeUndefined()
    expect(existsSync(join(h.homes, 'quarantine', `${child}.jsonl`))).toBe(false)
    expect(events.map(event => event.type as string).filter(type => [TYPE, 'turn/start', 'turn/end', 'subagent/descriptor'].includes(type)))
      .toEqual(['subagent/descriptor', TYPE, 'turn/start', 'turn/end', TYPE, TYPE, 'turn/start', 'turn/end', TYPE])

    const [start1, end1, start2, end2] = records(events) as [LocalAgentExecutionStartEvent, LocalAgentExecutionEndEvent, LocalAgentExecutionStartEvent, LocalAgentExecutionEndEvent]
    expect(start1).toMatchObject({
      phase: 'start', caller: 'tool', callerRef: 'call-start', operation: 'prompt', parentSessionId: PARENT,
      cause: { kind: 'tool-call', sessionId: PARENT, callId: 'call-start' },
      task: { sessionId: PARENT, id: 'turn:3' },
    })
    expect(end1).toMatchObject({ phase: 'end', executionId: start1.executionId, outcome: 'done', turns: [1], unrecorded: ['internal-calls'] })
    expect(start2).toMatchObject({
      phase: 'start', caller: 'tool', callerRef: 'call-continue',
      cause: { kind: 'tool-call', sessionId: PARENT, callId: 'call-continue' },
      task: { sessionId: PARENT, id: 'turn:5' },
    })
    expect(end2).toMatchObject({ phase: 'end', executionId: start2.executionId, outcome: 'done', turns: [2] })
  })
})

describe('plugin unload while an end waits for its settle report', () => {
  it('flush writes the end exactly once, and neither the timer nor a late report writes it again or throws', () => {
    vi.useFakeTimers()
    try {
      const child = Session.create(SessionId('unload-child'))
      const persisted: number[] = []
      const recorder = new ExecutionRecorder({
        session: () => child, persist: () => { persisted.push(child.snapshotEvents().length) },
        settleWaitMs: 60_000, onError: (error) => { throw error },
      })
      const open = recorder.admit({ childSessionId: 'unload-child', parentSessionId: PARENT, operation: 'prompt' })
      openMirrorTurn(child, 1, 'exec')
      closeMirrorTurn(child, 1, 'completed', '')
      open.settle('done')
      expect(records(child.snapshotEvents()).map(record => record.phase)).toEqual(['start'])
      // The plugin unloads: the parked end is written now.
      expect(() => { recorder.flush() }).not.toThrow()
      expect(records(child.snapshotEvents())).toMatchObject([{ phase: 'start' }, { phase: 'end', outcome: 'done', turns: [1] }])
      // A second flush, the expired timer, a late report and a repeated settle add nothing.
      expect(() => {
        recorder.flush()
        vi.advanceTimersByTime(60_000)
        recorder.noteReport('unload-child', { inputTokens: 1, outputTokens: 1 } as TokenUsage)
        open.settle('failed')
      }).not.toThrow()
      expect(records(child.snapshotEvents()).filter(record => record.phase === 'end')).toHaveLength(1)
      expect((records(child.snapshotEvents())[1] as LocalAgentExecutionEndEvent).providerReportedUsage).toBeUndefined()
      expect(persisted).toHaveLength(1)
      expect(released(child.snapshotEvents())).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('the real plugin dispose flushes a parked end', async () => {
    const h = await mount()
    // A round whose provider never reports its settle: the end parks.
    const child = Session.create(SessionId('parked-child'))
    h.ctx.sessions.enter(child)
    h.ctx.sessions.announce(child)
    const parked = (h.registry as unknown as { executions: ExecutionRecorder }).executions
    const open = parked.admit({ childSessionId: 'parked-child', parentSessionId: PARENT, operation: 'prompt' })
    openMirrorTurn(child, 1, 'exec')
    closeMirrorTurn(child, 1, 'completed', '')
    open.settle('done')
    expect(records(child.snapshotEvents()).map(record => record.phase)).toEqual(['start'])
    await expect(disposers.shift()!()).resolves.not.toThrow()
    expect(records(child.snapshotEvents()).map(record => record.phase)).toEqual(['start', 'end'])
  })
})
