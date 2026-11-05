/**
 * The single execution entry `run()` and the per-member execution ledger
 * (batch 5 S4), driven through the real stack: SessionStore, JSONL
 * persistence, AgentRegistry, ToolRuntime, the local-agent plugin, the family
 * `subagent` tool, and a provider that behaves like a family provider (takes
 * its staged intent, admits through `withMemberConfigurationRound`, creates a
 * first round's child, mirrors one turn) but holds each round open until the
 * test releases it — so queue order and the absence of concurrent rounds are
 * observable.
 */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { SubagentActivationSpec, SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import * as localAgent from '../src/index.ts'
import { LOCAL_AGENT_SERVICE } from '../src/index.ts'
import type { LocalAgentDelegationIntent, LocalAgentExecutionEndEvent, LocalAgentExecutionStartEvent } from '../src/index.ts'
import { appendMirrorStep, closeMirrorTurn, openMirrorTurn } from '../src/mirror-step.ts'
import { mountSubagentDelegationTool } from '../src/tool-factory.ts'

const PROVIDER = 'fake-cli'
const PARENT = 'parent-run'
const TOOL = 'subagent_fake'
const TYPE = 'local-agent/execution'

type Record_ = LocalAgentExecutionStartEvent | LocalAgentExecutionEndEvent
const records = (events: readonly SessionEvent[]): Record_[] =>
  events.filter(event => event.type === TYPE).map(event => event.data as Record_)

interface Round {
  readonly kind: 'fresh' | 'resume'
  readonly prompt: string
  readonly childSessionId: string
  readonly scope: string | undefined
  readonly cwd: string | undefined
  release(stop?: SubagentResult['stopReason']): void
}

const mounted: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of mounted.splice(0)) await dispose()
})

async function mount(homes = mkdtempSync(join(tmpdir(), 'run-entry-homes-')), store = mkdtempSync(join(tmpdir(), 'run-entry-store-'))) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry).await()
  const persistence = ctx.plugin(JsonlSessionPersistence, { root: store, compression: 'none' })
  await persistence.await()
  const rounds: Round[] = []
  let running = 0
  let maxRunning = 0
  const providers = new Set<string>([PROVIDER])
  ctx.provide('subagents', {
    getProvider: (name: string) => providers.has(name) ? { name } : undefined,
    startActivation: async (spec: SubagentActivationSpec) => {
      const run = await providerStart({ ...spec.request, signal: spec.signal } as SubagentStartRequest)
      return { childId: run.id, result: run.result, dispose: () => run.dispose() }
    },
  })
  const fiber = ctx.plugin(localAgent, { homesRoot: homes })
  await fiber.await()
  const registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
  registry.register({
    name: 'fake', displayName: 'Fake', homeEnvVar: 'FAKE_HOME', delegationProvider: PROVIDER,
    records: { listSessions: async () => [] }, isAuthenticated: async () => true,
    modelBroker: { modelInfo: () => ({ choices: [], switchable: true }), configurationAdapter: () => ({
      validate: async () => {}, prepare: async () => ({ model: 'm' }), apply: async () => ({ model: 'm' }),
      reconcile: async () => ({ active: false, matches: 'current', resolved: { model: 'm' } }),
    }) },
  } as never)
  const parentSession = Session.create(SessionId(PARENT))
  const agent = { id: SessionId(PARENT), session: parentSession } as unknown as Agent
  ctx.agents.enter(agent, undefined)
  await ctx.plugin({ name: 'fake-tool', inject: ['tools', 'subagents', 'localAgent'], apply: (inner: Context) => mountSubagentDelegationTool(inner, { provider: PROVIDER, toolName: TOOL }, 'test-owner') })

  async function providerStart(request: SubagentStartRequest): Promise<SubagentRun> {
    const intent = registry.takeDelegationIntent(PARENT, PROVIDER) as LocalAgentDelegationIntent
    const childSessionId = intent.childSessionId!
    const prompt = request.prompt.map(block => (block as { text?: string }).text ?? '').join('')
    return registry.withMemberConfigurationRound({ childSessionId, provider: PROVIDER, parentSessionId: PARENT, cwd: '/home/user/work' }, async () => {
      const child = ctx.sessions.get(SessionId(childSessionId))
        ?? ctx.sessions.create(SessionId(childSessionId), { meta: { cwd: '/home/user/work', parentSession: SessionId(PARENT), origin: 'subagent', delegationDepth: 1 } } as never)
      if (intent.kind === 'fresh') child.append('subagent/descriptor', { version: 1, mode: 'one-shot', provider: PROVIDER, label: 'Fake' } as never)
      running += 1
      maxRunning = Math.max(maxRunning, running)
      const turn = child.snapshotEvents().filter(event => event.type === 'turn/start').length + 1
      openMirrorTurn(child, turn, 'exec')
      let settle!: (result: SubagentResult) => void
      const result = new Promise<SubagentResult>((resolve) => { settle = resolve })
      let done = false
      const release = (stop: SubagentResult['stopReason'] = 'completed'): void => {
        if (done) return
        done = true
        running -= 1
        appendMirrorStep(child, turn, 1, { blocks: [{ kind: 'text', text: 'ok' }], usage: { inputTokens: 10, outputTokens: 2 } as TokenUsage }, { provider: PROVIDER, model: 'm' })
        closeMirrorTurn(child, turn, stop, 'stopped')
        if (intent.kind === 'fresh') registry.recordDelegation({ childSessionId, provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'native', cwd: '/home/user/work', ...intent.scope === undefined ? {} : { scope: intent.scope } })
        registry.recordRoundSettled(childSessionId, { observedModel: 'model-seen', cliVersion: '1.2.3' })
        settle({ stopReason: stop, output: [{ type: 'text', text: `answer to ${prompt}` }] })
      }
      request.signal.addEventListener('abort', () => release('aborted'))
      rounds.push({ kind: intent.kind, prompt, childSessionId, scope: intent.scope, cwd: intent.cwd, release })
      return { id: SessionId(`exec-${rounds.length}`), result, dispose: async () => { release('aborted') } }
    }, request.signal, intent.onAdmitted, intent.execution)
  }

  /** One host-model tool call at `turn` in the parent session. */
  const call = async (turn: number, callId: string, args: Record<string, string>, signal = new AbortController().signal) => {
    parentSession.append('turn/start', { turn } as never)
    parentSession.append('step/start', { turn, step: 1 } as never)
    parentSession.append('assistant/message', { turn, step: 1, message: { role: 'assistant', content: [{ type: 'tool-call', id: callId, name: TOOL, arguments: JSON.stringify(args) }] }, stream: [] } as never, { surfaceOp: 'append' } as never)
    parentSession.append('tool/call', { turn, step: 1, callId, name: TOOL, arguments: JSON.stringify(args) } as never)
    const batch = await ctx.tools.execute({
      calls: [{ type: 'tool-call', id: callId as ToolExecutionInput['callId'], name: TOOL, arguments: JSON.stringify(args) }],
      signal,
      agent,
    })
    return batch.results[0]!.result
  }
  const childEvents = (childSessionId: string): readonly SessionEvent[] => ctx.sessions.get(SessionId(childSessionId))?.snapshotEvents() ?? []
  const dispose = async (): Promise<void> => { await fiber.dispose(); await persistence.dispose() }
  mounted.push(dispose)
  return { ctx, registry, homes, store, rounds, call, childEvents, maxRunning: () => maxRunning, dispose }
}

/** Wait until the provider holds `count` rounds. */
async function roundsReach(h: { rounds: Round[] }, count: number, stage?: string): Promise<void> {
  await vi.waitFor(() => expect(h.rounds.map(round => round.kind), stage).toHaveLength(count))
}

const text = (value: string) => [{ type: 'text' as const, text: value }]

describe('run(): the single execution entry', () => {
  it('starts a member with no delegation record, then continues it — the core decides, scope and cwd come from the record', async () => {
    const h = await mount()
    const admitted = vi.fn()
    const first = await h.registry.run({
      parentSessionId: PARENT, provider: PROVIDER, member: { childSessionId: 'member-a', create: { scope: 'team-b', cwd: '/home/user/work' } },
      input: text('first'), caller: 'room', cause: { kind: 'human', sessionId: 'room-1', messageId: 'msg-1' }, task: { sessionId: 'room-1', id: 'task-1' },
      callerRef: 'run-1', on: { admitted },
    })
    await roundsReach(h, 1)
    expect(h.rounds[0]).toMatchObject({ kind: 'fresh', childSessionId: 'member-a', scope: 'team-b', cwd: '/home/user/work' })
    expect(admitted).toHaveBeenCalledWith({ executionId: first.executionId, admittedAt: expect.any(Number), childFromSeq: 0 })
    h.rounds[0]!.release()
    const settled = await first.settled
    expect(settled).toMatchObject({ executionId: first.executionId, outcome: 'done', turns: [1], observedModel: 'model-seen', cliVersion: '1.2.3' })
    expect(settled.run).toBeDefined()

    // The caller names neither scope nor cwd: the continuation takes them from the record.
    const lazy = vi.fn(async () => text('second, assembled at admission'))
    const second = await h.registry.run({ parentSessionId: PARENT, provider: PROVIDER, member: { childSessionId: 'member-a', create: { scope: 'ignored' } }, input: lazy, cause: { kind: 'restart', sessionId: 'room-1' } })
    await roundsReach(h, 2)
    expect(lazy).toHaveBeenCalledOnce()
    expect(h.rounds[1]).toMatchObject({ kind: 'resume', childSessionId: 'member-a', prompt: 'second, assembled at admission', scope: 'team-b', cwd: '/home/user/work' })
    h.rounds[1]!.release()
    expect(await second.settled).toMatchObject({ outcome: 'done', turns: [2] })

    const [start1, end1, start2, end2] = records(h.childEvents('member-a')) as [LocalAgentExecutionStartEvent, LocalAgentExecutionEndEvent, LocalAgentExecutionStartEvent, LocalAgentExecutionEndEvent]
    expect(start1).toMatchObject({ executionId: first.executionId, caller: 'room', callerRef: 'run-1', cause: { kind: 'human', messageId: 'msg-1' }, task: { id: 'task-1' } })
    expect(end1).toMatchObject({ executionId: first.executionId, outcome: 'done', turns: [1] })
    expect(start2).toMatchObject({ executionId: second.executionId, caller: 'api', cause: { kind: 'restart' } })
    expect(end2).toMatchObject({ executionId: second.executionId, turns: [2] })
    // The ledger rows carry the same execution ids.
    expect(h.registry.readMemberInbox('member-a').messages.map(row => [row.id, row.caller, row.status])).toEqual([
      [first.executionId, 'room', 'done'], [second.executionId, 'api', 'done'],
    ])
  })

  it('runs a key once: the same key returns the same execution while it runs and its settlement after', async () => {
    const h = await mount()
    const request = { parentSessionId: PARENT, provider: PROVIDER, member: { childSessionId: 'member-k' }, input: text('deliver'), caller: 'room' as const, key: 'delivery-1' }
    const first = await h.registry.run(request)
    const again = await h.registry.run(request)
    expect(again.executionId).toBe(first.executionId)
    await roundsReach(h, 1)
    h.rounds[0]!.release()
    await first.settled
    const replay = await h.registry.run(request)
    expect(replay.executionId).toBe(first.executionId)
    expect(await replay.settled).toMatchObject({ executionId: first.executionId, outcome: 'done' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(h.rounds).toHaveLength(1)
    expect(h.registry.readMemberInbox('member-k').messages).toHaveLength(1)
  })

  it('queues in order, one round at a time; a queued row can be cancelled and never runs', async () => {
    const h = await mount()
    const member = { childSessionId: 'member-q' }
    const a = await h.registry.run({ parentSessionId: PARENT, provider: PROVIDER, member, input: text('a') })
    const b = await h.registry.run({ parentSessionId: PARENT, provider: PROVIDER, member, input: text('b') })
    const c = await h.registry.run({ parentSessionId: PARENT, provider: PROVIDER, member, input: text('c') })
    await roundsReach(h, 1)
    expect(h.registry.queuedMemberRounds('member-q')).toBe(2)
    expect(h.registry.cancelExecution('member-q', b.executionId)).toBe(true)
    expect(await b.settled).toMatchObject({ outcome: 'cancelled', turns: [] })
    await expect(b.started).rejects.toThrow()
    h.rounds[0]!.release()
    await roundsReach(h, 2)
    expect(h.rounds.map(round => round.prompt)).toEqual(['a', 'c'])
    h.rounds[1]!.release()
    await c.settled
    expect(h.maxRunning()).toBe(1)
    expect(h.registry.readMemberInbox('member-q').messages.map(row => row.status)).toEqual(['done', 'cancelled', 'done'])
    expect((await a.settled).outcome).toBe('done')
  })

  it('a caller signal cancels a queued row; cancel() stops the running one', async () => {
    const h = await mount()
    const member = { childSessionId: 'member-s' }
    const a = await h.registry.run({ parentSessionId: PARENT, provider: PROVIDER, member, input: text('a') })
    const controller = new AbortController()
    const b = await h.registry.run({ parentSessionId: PARENT, provider: PROVIDER, member, input: text('b'), signal: controller.signal })
    await roundsReach(h, 1)
    controller.abort()
    expect(await b.settled).toMatchObject({ outcome: 'cancelled' })
    expect(h.registry.cancel('member-s')).toBe(true)
    expect(await a.settled).toMatchObject({ outcome: 'cancelled' })
    expect(h.rounds).toHaveLength(1)
  })

  it('after a restart a running row is uncertain and blocks every caller until reconcileExecution', async () => {
    const before = await mount()
    const running = await before.registry.run({ parentSessionId: PARENT, provider: PROVIDER, member: { childSessionId: 'member-r' }, input: text('long'), caller: 'room', key: 'delivery-9' })
    await roundsReach(before, 1)
    before.rounds[0]!.release()
    await running.settled
    // A second round is in flight when the host goes away.
    const second = await before.registry.run({ parentSessionId: PARENT, provider: PROVIDER, member: { childSessionId: 'member-r' }, input: text('interrupted'), caller: 'room', key: 'delivery-10' })
    await roundsReach(before, 2, 'the interrupted second round')
    // A queued room row (no stored input) is dropped on restart; its caller resubmits it.
    await before.registry.run({ parentSessionId: PARENT, provider: PROVIDER, member: { childSessionId: 'member-r' }, input: text('later'), caller: 'room', key: 'delivery-11' })
    // Simulate the crash: the ledger file stays as written (running), the process is gone.
    const file = join(before.homes, '.member-inbox', readdirSync(join(before.homes, '.member-inbox')).find(name => name.endsWith('.json'))!)
    const crashed = readFileSync(file, 'utf8')
    await before.dispose()
    mounted.splice(mounted.indexOf(before.dispose), 1)
    writeFileSync(file, crashed)

    const after = await mount(before.homes, before.store)
    after.registry.recordDelegation({ childSessionId: 'member-r', provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'native', cwd: '/home/user/work' })
    const ledger = after.registry.readMemberInbox('member-r')
    expect(ledger.messages.map(row => [row.key, row.status])).toEqual([['delivery-9', 'done'], ['delivery-10', 'uncertain']])
    // Every caller is refused while uncertain — and replaying the same key is too.
    await expect(after.registry.run({ parentSessionId: PARENT, provider: PROVIDER, member: { childSessionId: 'member-r' }, input: text('x'), caller: 'tool' })).rejects.toThrow('uncertain')
    await expect(after.registry.run({ parentSessionId: PARENT, provider: PROVIDER, member: { childSessionId: 'member-r' }, input: text('x'), caller: 'room', key: 'delivery-10' })).rejects.toThrow('uncertain')
    await expect(after.registry.resume(PARENT, PROVIDER, 'member-r', text('x'))).rejects.toThrow('uncertain')
    expect(() => after.registry.reconcileExecution('member-r', second.executionId, 'done', '')).toThrow('evidence')
    after.registry.reconcileExecution('member-r', second.executionId, 'done', 'checked the CLI transcript')
    expect(after.registry.readMemberInbox('member-r').messages[1]).toMatchObject({ status: 'done', error: 'checked the CLI transcript' })
    // The key of the reconciled execution now reads as settled, not as new work.
    expect(await (await after.registry.run({ parentSessionId: PARENT, provider: PROVIDER, member: { childSessionId: 'member-r' }, input: text('x'), caller: 'room', key: 'delivery-10' })).settled).toMatchObject({ outcome: 'done' })
    const next = await after.registry.run({ parentSessionId: PARENT, provider: PROVIDER, member: { childSessionId: 'member-r' }, input: text('after reconcile'), caller: 'room', key: 'delivery-11' })
    await next.started
    await roundsReach(after, 1, 'the post-reconcile round')
    expect(after.rounds[0]).toMatchObject({ kind: 'resume', prompt: 'after reconcile' })
    after.rounds[0]!.release()
    expect(await next.settled).toMatchObject({ outcome: 'done' })
    // This harness's "crash" is a graceful dispose (only the ledger file is
    // restored), which already wrote an end for the interrupted round: the
    // reconciliation closer never writes a second one (a real crash leaves
    // the start open; see the recorder case in execution-records.spec.ts).
    const closed = records(after.childEvents('member-r'))
    expect(closed.filter(record => record.phase === 'end' && record.executionId === second.executionId)).toHaveLength(1)
    expect(after.registry.readMemberInbox('member-r').messages[1]).toMatchObject({ reconciledAt: expect.any(Number) })
  })

  it('the host subagent tool and the members-page composer share one queue: no concurrent rounds, each recorded with its cause', async () => {
    const h = await mount()
    const fresh = h.call(3, 'call-start', { description: 'scout', prompt: 'look around' })
    await roundsReach(h, 1)
    h.rounds[0]!.release()
    const handle = /resume="([^"]+)"/.exec((await fresh).content.map(block => (block as { text?: string }).text ?? '').join(''))![1]!

    // A tool call continues the member (decision ④) while a human types into the members page.
    const continued = h.call(5, 'call-continue', { description: 'more', prompt: 'keep going', resume: handle })
    await roundsReach(h, 2)
    h.registry.enqueueMemberInput(handle, 'from the page', 'input-1')
    expect(h.registry.readMemberInbox(handle).messages.map(row => [row.caller, row.status])).toEqual([['tool', 'done'], ['tool', 'running'], ['composer', 'queued']])
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(h.rounds).toHaveLength(2)
    h.rounds[1]!.release()
    expect((await continued).isError).toBe(false)
    await roundsReach(h, 3)
    expect(h.rounds[2]).toMatchObject({ kind: 'resume', prompt: 'from the page' })
    h.rounds[2]!.release()
    await vi.waitFor(() => expect(h.registry.readMemberInbox(handle).messages.at(-1)?.status).toBe('done'))
    expect(h.maxRunning()).toBe(1)

    await vi.waitFor(() => expect(records(h.childEvents(handle)).filter(record => record.phase === 'end')).toHaveLength(3))
    const starts = records(h.childEvents(handle)).filter((record): record is LocalAgentExecutionStartEvent => record.phase === 'start')
    expect(starts).toMatchObject([
      { caller: 'tool', callerRef: 'call-start', cause: { kind: 'tool-call', sessionId: PARENT, callId: 'call-start' }, task: { sessionId: PARENT, id: 'turn:3' } },
      { caller: 'tool', callerRef: 'call-continue', cause: { kind: 'tool-call', sessionId: PARENT, callId: 'call-continue' }, task: { sessionId: PARENT, id: 'turn:5' } },
      { caller: 'composer', callerRef: 'input-1', cause: { kind: 'human', sessionId: PARENT, via: 'member-composer' } },
    ])
    expect(starts.map(start => start.executionId)).toEqual(h.registry.readMemberInbox(handle).messages.map(row => row.id))
  })

  it('the old wrappers queue through the same ledger, so a resume waits behind a running tool round', async () => {
    const h = await mount()
    const fresh = h.call(1, 'call-1', { description: 'scout', prompt: 'one' })
    await roundsReach(h, 1)
    h.rounds[0]!.release()
    const handle = /resume="([^"]+)"/.exec((await fresh).content.map(block => (block as { text?: string }).text ?? '').join(''))![1]!
    const tool = h.call(2, 'call-2', { description: 'more', prompt: 'two', resume: handle })
    await roundsReach(h, 2)
    const resumed = h.registry.resume(PARENT, PROVIDER, handle, text('three'))
    await vi.waitFor(() => expect(h.registry.queuedMemberRounds(handle)).toBe(1))
    h.rounds[1]!.release()
    await tool
    const run = await resumed
    await roundsReach(h, 3)
    h.rounds[2]!.release()
    expect((await run.result).stopReason).toBe('completed')
    expect(h.maxRunning()).toBe(1)
  })
})
