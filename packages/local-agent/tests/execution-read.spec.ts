/**
 * The read side of the execution records (batch 5 S6, usage in one place):
 * `executionReadingsOf` adds the per-call `assistant/message.usage` in an
 * execution's turns, passes the CLI's own round total and the compaction
 * facts through verbatim, and never mixes a compaction's numbers into the
 * call sum. `LocalAgentRegistry.readExecution` serves it from a live log and,
 * once, from a cold stored one.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as localAgent from '../src/index.ts'
import { LOCAL_AGENT_SERVICE, addUsage, executionOfToolCall, executionReadingsOf, selfExecutionOfTask, subagentReadingsFor } from '../src/index.ts'
import type { LocalAgentBackgroundTasksRequest, LocalAgentExecutionCause } from '../src/index.ts'

let seq = 0
const ev = (type: string, data: unknown): SessionEvent => ({ type, data, seq: seq++, time: 0 }) as never
const start = (executionId: string, operation: 'prompt' | 'compact' = 'prompt'): SessionEvent =>
  ev('local-agent/execution', { phase: 'start', executionId, caller: 'room', operation, parentSessionId: 'room-1', admittedAt: 1 })
const end = (executionId: string, turns: number[], extra: Record<string, unknown> = {}): SessionEvent =>
  ev('local-agent/execution', { phase: 'end', executionId, outcome: 'done', turns, endedAt: 2, ...extra })
const call = (turn: number, usage?: Record<string, number>): SessionEvent =>
  ev('assistant/message', { turn, step: 1, message: { role: 'assistant', content: [] }, stream: [], ...usage === undefined ? {} : { usage } })
const turn = (n: number): SessionEvent => ev('turn/start', { turn: n })

describe('addUsage', () => {
  it('sums every bucket on its own; an optional bucket appears once any addend has it; totalTokens is not summed', () => {
    expect(addUsage(undefined, { inputTokens: 10, outputTokens: 2, totalTokens: 12 })).toEqual({ inputTokens: 10, outputTokens: 2 })
    expect(addUsage({ inputTokens: 10, outputTokens: 2 }, { inputTokens: 5, outputTokens: 1, cacheReadTokens: 40 }))
      .toEqual({ inputTokens: 15, outputTokens: 3, cacheReadTokens: 40 })
  })
})

describe('executionReadingsOf', () => {
  it('a claude-code round whose call sum equals the CLI total: both returned, nothing derived', () => {
    const total = { inputTokens: 30, outputTokens: 7, cacheReadTokens: 900 }
    const readings = executionReadingsOf([
      start('e1'), turn(1),
      call(1, { inputTokens: 10, outputTokens: 3, cacheReadTokens: 400 }),
      call(1, { inputTokens: 20, outputTokens: 4, cacheReadTokens: 500 }),
      end('e1', [1], { providerReportedUsage: total, unrecorded: ['internal-calls'] }),
    ])
    expect(readings.get('e1')).toEqual({
      executionId: 'e1', operation: 'prompt', outcome: 'done', turns: [1],
      callUsage: total, calls: 2, providerReportedUsage: total, unrecorded: ['internal-calls'], compactions: [],
    })
  })

  it('a mismatch stays visible: the call sum and the CLI total are returned side by side, never reconciled', () => {
    const readings = executionReadingsOf([
      start('e1'), turn(1), call(1, { inputTokens: 100, outputTokens: 10 }),
      end('e1', [1], { providerReportedUsage: { inputTokens: 1300, outputTokens: 10 } }),
    ])
    expect(readings.get('e1')).toMatchObject({ callUsage: { inputTokens: 100, outputTokens: 10 }, providerReportedUsage: { inputTokens: 1300, outputTokens: 10 } })
  })

  it('kimi (no CLI total): only the call sum, across every turn of the execution and none of another execution', () => {
    const readings = executionReadingsOf([
      start('e1'), turn(1), call(1, { inputTokens: 5, outputTokens: 1 }), end('e1', [1]),
      start('e2'), turn(2), call(2, { inputTokens: 7, outputTokens: 2 }), turn(3), call(3, { inputTokens: 11, outputTokens: 3 }), call(3), end('e2', [2, 3]),
    ])
    expect(readings.get('e1')).toMatchObject({ callUsage: { inputTokens: 5, outputTokens: 1 }, calls: 1 })
    expect(readings.get('e2')).toMatchObject({ callUsage: { inputTokens: 18, outputTokens: 5 }, calls: 2, turns: [2, 3] })
    expect(readings.get('e2')).not.toHaveProperty('providerReportedUsage')
  })

  it('a compaction is passed through as a fact: its spend and context sizes never enter the call sum', () => {
    const fact = { source: 'manual', outcome: 'completed', provider: 'kimi-cli', beforeTokens: 560_000, afterTokens: 41_000, usage: { inputTokens: 21_000, outputTokens: 900 }, summary: 's', startedAt: 1, endedAt: 2, boundarySeq: 3 }
    const readings = executionReadingsOf([
      start('e1'), turn(1), call(1, { inputTokens: 5, outputTokens: 1 }), end('e1', [1]),
      start('c1', 'compact'), ev('local-agent/compaction', fact), end('c1', []),
    ])
    expect(readings.get('c1')).toEqual({ executionId: 'c1', operation: 'compact', outcome: 'done', turns: [], calls: 0, unrecorded: [], compactions: [fact] })
    expect(readings.get('e1')?.compactions).toEqual([])
    expect(readings.get('e1')?.callUsage).toEqual({ inputTokens: 5, outputTokens: 1 })
  })

  it('an open execution reads its turns after its start record; a log without records reads nothing', () => {
    const readings = executionReadingsOf([start('e1'), turn(4), call(4, { inputTokens: 3, outputTokens: 1 })])
    expect(readings.get('e1')).toMatchObject({ turns: [4], callUsage: { inputTokens: 3, outputTokens: 1 }, unrecorded: [] })
    expect(readings.get('e1')).not.toHaveProperty('outcome')
    expect(executionReadingsOf([turn(1), call(1, { inputTokens: 3, outputTokens: 1 })]).size).toBe(0)
  })

  it('reads a `cli` execution (a round the CLI opened itself) exactly like any other caller\'s', () => {
    const cause: LocalAgentExecutionCause = { kind: 'self', reason: 'background-task', taskId: 'bash-1', taskStatus: 'completed', notificationId: 'task:bash-1:completed', startedBy: 'e1' }
    const readings = executionReadingsOf([
      ev('local-agent/execution', { phase: 'start', executionId: 's1', caller: 'cli', operation: 'prompt', cause, parentSessionId: 'room-1', admittedAt: 1 }),
      turn(3), call(3, { inputTokens: 4, outputTokens: 2 }), end('s1', [3]),
    ])
    expect(readings.get('s1')).toEqual({ executionId: 's1', operation: 'prompt', outcome: 'done', turns: [3], callUsage: { inputTokens: 4, outputTokens: 2 }, calls: 1, unrecorded: [], compactions: [] })
  })
})

describe('background task fact chain', () => {
  const toolCall = (turnNo: number, id: string): SessionEvent =>
    ev('assistant/message', { turn: turnNo, step: 1, message: { role: 'assistant', content: [{ type: 'tool-call', id, name: 'Bash', arguments: '{}' }] }, stream: [] })
  const selfStart = (executionId: string, taskId: string): SessionEvent =>
    ev('local-agent/execution', { phase: 'start', executionId, caller: 'cli', operation: 'prompt', parentSessionId: 'room-1', admittedAt: 1,
      cause: { kind: 'self', reason: 'background-task', taskId, taskStatus: 'completed' } })

  it('tool call → its turn → the execution holding that turn; any missing link answers undefined', () => {
    const events = [
      start('e1'), turn(1), toolCall(1, 'call-a'), end('e1', [1]),
      start('e2'), turn(2), toolCall(2, 'call-b'),
      // A call mirrored into a turn no execution claims (an older log).
      turn(3), toolCall(3, 'call-orphan'), end('e2', [2]),
    ]
    expect(executionOfToolCall(events, 'call-a')).toBe('e1')
    expect(executionOfToolCall(events, 'call-b')).toBe('e2')
    expect(executionOfToolCall(events, 'call-orphan')).toBeUndefined()
    expect(executionOfToolCall(events, 'never-mirrored')).toBeUndefined()
    // No execution records at all: nothing is guessed.
    expect(executionOfToolCall([turn(1), toolCall(1, 'call-a')], 'call-a')).toBeUndefined()
  })

  it('the round the CLI opened for a task is the `self` start naming it', () => {
    const events = [start('e1'), turn(1), end('e1', [1]), selfStart('s1', 'bash-1'), turn(2), end('s1', [2])]
    expect(selfExecutionOfTask(events, 'bash-1')).toBe('s1')
    expect(selfExecutionOfTask(events, 'bash-2')).toBeUndefined()
  })
})

describe('subagentReadingsFor', () => {
  const subStart = (executionId: string, cause: Record<string, unknown>): SessionEvent =>
    ev('local-agent/execution', { phase: 'start', executionId, caller: 'cli', operation: 'prompt', parentSessionId: 'member-1', admittedAt: 1,
      cause: { kind: 'cli-subagent', sessionId: 'member-1', callId: 'call-1', ...cause } })

  it('collects the grandchild executions naming the member execution; the sum adds per-call usage only', () => {
    const explore = [
      subStart('x1', { executionId: 'e1', name: 'explore' }), turn(1), call(1, { inputTokens: 10, outputTokens: 2 }),
      end('x1', [1], { providerReportedUsage: { inputTokens: 999, outputTokens: 9 } }),
      // A resumed execution for another member execution: not this one's.
      subStart('x2', { executionId: 'e2', name: 'explore', resumed: true }), turn(2), call(2, { inputTokens: 50, outputTokens: 5 }), end('x2', [2]),
    ]
    const coder = [subStart('y1', { executionId: 'e1', name: 'coder', group: { index: 0, size: 1 } }), turn(1), call(1, { inputTokens: 1, outputTokens: 1, cacheReadTokens: 7 }), end('y1', [1])]
    const unrelated = [start('z1'), turn(1), call(1, { inputTokens: 100, outputTokens: 100 }), end('z1', [1])]
    expect(subagentReadingsFor('e1', [
      { sessionId: 'member-1.sub.agent-0', events: explore },
      { sessionId: 'member-1.sub.agent-1', events: coder },
      { sessionId: 'member-1.sub.agent-2', events: unrelated },
    ])).toEqual({
      subagents: [
        { sessionId: 'member-1.sub.agent-0', executionId: 'x1', name: 'explore', callUsage: { inputTokens: 10, outputTokens: 2 }, calls: 1, providerReportedUsage: { inputTokens: 999, outputTokens: 9 } },
        { sessionId: 'member-1.sub.agent-1', executionId: 'y1', name: 'coder', callUsage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 7 }, calls: 1 },
      ],
      subagentUsage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 7 },
    })
    expect(subagentReadingsFor('e9', [{ sessionId: 'member-1.sub.agent-0', events: explore }])).toEqual({ subagents: [] })
  })
})

describe('LocalAgentRegistry.readExecution', () => {
  const disposers: Array<() => Promise<void>> = []
  afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose() })

  async function mount(root: string) {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const persistence = ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    await persistence.await()
    const fiber = ctx.plugin(localAgent, { homesRoot: mkdtempSync(join(tmpdir(), 'exec-read-homes-')) })
    await fiber.await()
    const dispose = async (): Promise<void> => { await fiber.dispose(); await persistence.dispose() }
    disposers.push(dispose)
    return { ctx, registry: ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry }
  }

  it('reads a live log (re-read when it moves) and, in another process, the cold stored one; unknown ids read undefined', async () => {
    const root = mkdtempSync(join(tmpdir(), 'exec-read-store-'))
    const { ctx, registry } = await mount(root)
    const child = ctx.sessions.create(SessionId('member-1'), { meta: { cwd: '/home/user/work' } } as never)
    child.append('local-agent/execution', { phase: 'start', executionId: 'e1', caller: 'room', operation: 'prompt', parentSessionId: 'room-1', admittedAt: 1 })
    child.append('turn/start', { turn: 1 } as never)
    expect(await registry.readExecution('member-1', 'e1')).toMatchObject({ turns: [1], calls: 0 })
    child.append('local-agent/execution', { phase: 'end', executionId: 'e1', outcome: 'done', turns: [1], endedAt: 2, providerReportedUsage: { inputTokens: 9, outputTokens: 1 } })
    expect(await registry.readExecution('member-1', 'e1')).toMatchObject({ outcome: 'done', providerReportedUsage: { inputTokens: 9, outputTokens: 1 } })
    expect(await registry.readExecution('member-1', 'nope')).toBeUndefined()
    await registry.syncChildSession(child)

    const cold = await mount(root)
    expect(cold.ctx.sessions.get(SessionId('member-1'))).toBeUndefined()
    expect(await cold.registry.readExecution('member-1', 'e1')).toMatchObject({ outcome: 'done', turns: [1], providerReportedUsage: { inputTokens: 9, outputTokens: 1 } })
    expect(await cold.registry.readExecution('never-existed', 'e1')).toBeUndefined()
  })

  it('memberBackgroundTasks: hands the harness the member home, CLI session and child-log lookups; null / unsupported otherwise', async () => {
    const { ctx, registry } = await mount(mkdtempSync(join(tmpdir(), 'exec-read-bg-')))
    const seen: LocalAgentBackgroundTasksRequest[] = []
    registry.register({
      name: 'fake', displayName: 'Fake', homeEnvVar: 'FAKE_HOME', delegationProvider: 'fake-cli', records: { listSessions: async () => [] },
      backgroundTasks: async (request: LocalAgentBackgroundTasksRequest) => {
        seen.push(request)
        const startedBy = await request.executionOfCall('call-a')
        const resultIn = await request.selfExecutionOf('bash-1')
        return { supported: true, processAlive: true, tasks: [{ id: 'bash-1', label: 'deploy', kind: 'shell', startedAt: 1, endedAt: 2, state: 'completed', ...startedBy === undefined ? {} : { startedBy }, ...resultIn === undefined ? {} : { resultIn } }] }
      },
    } as never)
    registry.register({ name: 'plain', displayName: 'Plain', homeEnvVar: 'PLAIN_HOME', delegationProvider: 'plain-cli', records: { listSessions: async () => [] } } as never)
    registry.recordDelegation({ childSessionId: 'member-1', provider: 'fake-cli', parentSessionId: 'room-1', cliSessionId: 'cli-1', cwd: '/home/user/work' })
    registry.recordDelegation({ childSessionId: 'member-2', provider: 'plain-cli', parentSessionId: 'room-1', cliSessionId: 'cli-2', cwd: '/home/user/work' })
    const child = ctx.sessions.create(SessionId('member-1'), { meta: { cwd: '/home/user/work' } } as never)
    child.append('local-agent/execution', { phase: 'start', executionId: 'e1', caller: 'room', operation: 'prompt', parentSessionId: 'room-1', admittedAt: 1 })
    child.append('turn/start', { turn: 1 } as never)
    child.append('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'tool-call', id: 'call-a', name: 'Bash', arguments: '{}' }] }, stream: [] } as never, { surfaceOp: 'append' } as never)
    child.append('local-agent/execution', { phase: 'end', executionId: 'e1', outcome: 'done', turns: [1], endedAt: 2 })
    child.append('local-agent/execution', { phase: 'start', executionId: 's1', caller: 'cli', operation: 'prompt', parentSessionId: 'room-1', admittedAt: 3,
      cause: { kind: 'self', reason: 'background-task', taskId: 'bash-1', taskStatus: 'completed', startedBy: 'e1' } })

    expect(await registry.memberBackgroundTasks('member-1')).toEqual({
      supported: true, processAlive: true,
      tasks: [{ id: 'bash-1', label: 'deploy', kind: 'shell', startedAt: 1, endedAt: 2, state: 'completed', startedBy: 'e1', resultIn: 's1' }],
    })
    expect(seen[0]).toMatchObject({ childSessionId: 'member-1', cliSessionId: 'cli-1', homeDir: registry.homeDir('fake') })
    expect(await registry.memberBackgroundTasks('member-2')).toEqual({ supported: false, tasks: [], processAlive: false })
    expect(await registry.memberBackgroundTasks('not-a-member')).toBeNull()
  })

  it('lostBackgroundTaskParents: the parents of members with a task this restart lost, read-only (no member-log lookups)', async () => {
    const { registry } = await mount(mkdtempSync(join(tmpdir(), 'exec-read-lost-')))
    const seen: LocalAgentBackgroundTasksRequest[] = []
    const lookups: string[] = []
    const byChild: Record<string, { state: 'lost' | 'running'; lostBecause?: 'host-restart' | 'process-reclaimed'; startedAt: number }[]> = {
      'member-1': [{ state: 'lost', lostBecause: 'host-restart', startedAt: 500 }],
      'member-2': [{ state: 'lost', lostBecause: 'host-restart', startedAt: 10 }],
      'member-3': [{ state: 'lost', lostBecause: 'process-reclaimed', startedAt: 500 }, { state: 'running', startedAt: 600 }],
      'member-4': [{ state: 'lost', lostBecause: 'host-restart', startedAt: 700 }],
    }
    registry.register({
      name: 'fake', displayName: 'Fake', homeEnvVar: 'FAKE_HOME', delegationProvider: 'fake-cli', records: { listSessions: async () => [] },
      backgroundTasks: async (request: LocalAgentBackgroundTasksRequest) => {
        seen.push(request)
        if (await request.executionOfCall('call-a') !== undefined) lookups.push('call')
        if (await request.selfExecutionOf('bash-1') !== undefined) lookups.push('self')
        return { supported: true, processAlive: false, tasks: (byChild[request.childSessionId] ?? []).map((task, index) => ({ id: `bash-${index}`, label: 'x', kind: 'shell' as const, ...task })) }
      },
    } as never)
    registry.register({ name: 'plain', displayName: 'Plain', homeEnvVar: 'PLAIN_HOME', delegationProvider: 'plain-cli', records: { listSessions: async () => [] } } as never)
    registry.recordDelegation({ childSessionId: 'member-1', provider: 'fake-cli', parentSessionId: 'room-1', cliSessionId: 'cli-1', cwd: '/home/user/work' })
    registry.recordDelegation({ childSessionId: 'member-2', provider: 'fake-cli', parentSessionId: 'room-2', cliSessionId: 'cli-2', cwd: '/home/user/work' })
    registry.recordDelegation({ childSessionId: 'member-3', provider: 'fake-cli', parentSessionId: 'room-3', cliSessionId: 'cli-3', cwd: '/home/user/work' })
    registry.recordDelegation({ childSessionId: 'member-4', provider: 'fake-cli', parentSessionId: 'room-1', cliSessionId: 'cli-4', cwd: '/home/user/work' })
    registry.recordDelegation({ childSessionId: 'member-5', provider: 'plain-cli', parentSessionId: 'room-5', cliSessionId: 'cli-5', cwd: '/home/user/work' })
    // room-2's loss is older than `since`; room-3's was a reclaim, not this restart.
    expect(await registry.lostBackgroundTaskParents(100)).toEqual(['room-1'])
    // room-1 answered after its first member: its second member is not read.
    expect(seen.map(request => request.childSessionId)).toEqual(['member-1', 'member-2', 'member-3'])
    expect(lookups).toEqual([])
  })
})
