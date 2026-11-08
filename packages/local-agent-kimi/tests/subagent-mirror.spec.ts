/**
 * A Kimi member's own subagents as grandchild sessions (member-cli-subagents
 * M3). Synthetic wires only (subagent-fixtures.ts): the mirror reads the
 * member wire's `subagent.*` lines, folds each subagent's wire one step per
 * wire step into its grandchild, closes a foreground subagent on
 * `subagent.completed` (or `cancelled` when the member's round settles
 * first), keeps a background one open past the round, and each execution's
 * per-call usage sums to the call's share of Kimi's reported total. Every
 * grandchild log passes the released-log check.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { addUsage, cliSubagentSessionId, executionReadingsOf, openMirrorTurn } from '@khorsheed/dsh-local-agent'
import type { LocalAgentExecutionEndEvent, LocalAgentExecutionStartEvent } from '@khorsheed/dsh-local-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readKimiBackgroundTasks } from '../src/background-tasks.ts'
import { startKimiCliRun } from '../src/kimi-cli-provider.ts'
import { readKimiSubagents, readKimiTranscript } from '../src/session-view.ts'
import { KimiSubagentMirror } from '../src/subagent-mirror.ts'
import { expectValidReleasedLog } from './expect-valid-log.ts'
import { mirrorSnapshot, SNAPSHOT_NOW } from './mirror-snapshot.ts'
import {
  completed,
  FIXTURE_SESSION,
  memberPrompt,
  readThenAnswer,
  sessionDir,
  spawned,
  started,
  subTurn,
  totalOf,
  usage,
  writeMainWire,
  writeSubWire,
} from './subagent-fixtures.ts'

const MEMBER = 'member-kimi'

interface Stage {
  ctx: Context
  homeDir: string
  member: Session
  mirror(transport?: 'live' | 'exec'): Promise<KimiSubagentMirror>
  grandchild(subagentId: string): Session | undefined
}

const mirrors: KimiSubagentMirror[] = []
afterEach(() => { for (const mirror of mirrors.splice(0)) mirror.dispose() })

/** A member with an open prompt execution and turn, and its (empty) wire. */
async function stage(): Promise<Stage> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const homeDir = mkdtempSync(join(tmpdir(), 'kimi-subagents-'))
  const member = ctx.sessions.create(SessionId(MEMBER), {
    meta: { cwd: '/home/user/work', parentSession: SessionId('room-parent'), origin: 'subagent', delegationDepth: 1 },
  } as never)
  member.append('local-agent/execution' as never, {
    phase: 'start', executionId: 'member-exec-1', caller: 'room', callerRef: 'run-1', operation: 'prompt',
    task: { sessionId: 'room-parent', id: 'task-1' }, parentSessionId: 'room-parent', admittedAt: 1,
  } as never)
  openMirrorTurn(member, 1, 'live')
  writeMainWire(homeDir, [memberPrompt('派个子智能体')])
  return {
    ctx,
    homeDir,
    member,
    mirror: async (transport = 'live') => {
      const mirror = new KimiSubagentMirror({ ctx, member, homeDir, transport, pollMs: 60_000 })
      await mirror.attach(FIXTURE_SESSION)
      mirrors.push(mirror)
      return mirror
    },
    grandchild: subagentId => ctx.sessions.get(SessionId(cliSubagentSessionId(MEMBER, subagentId))),
  }
}

const executions = (session: Session): Array<LocalAgentExecutionStartEvent | LocalAgentExecutionEndEvent> =>
  session.snapshotEvents().filter(event => event.type === 'local-agent/execution').map(event => event.data as LocalAgentExecutionStartEvent | LocalAgentExecutionEndEvent)

const ends = (session: Session): LocalAgentExecutionEndEvent[] =>
  executions(session).filter((record): record is LocalAgentExecutionEndEvent => record.phase === 'end')

const ofType = (session: Session, type: string): SessionEvent[] => session.snapshotEvents().filter(event => event.type === type)

/** The grandchild's steps, as `[kinds of the message's blocks]` per step. */
function steps(session: Session): string[][] {
  return ofType(session, 'assistant/message').map(event =>
    ((event.data as { message: { content: Array<{ type: string }> } }).message.content).map(block => block.type))
}

/** Kimi's counters as the shared usage contract (what the fold writes). */
function asUsage(wire: { inputOther: number; output: number; inputCacheRead: number; inputCacheCreation: number }): TokenUsage {
  return { inputTokens: wire.inputOther, outputTokens: wire.output, cacheReadTokens: wire.inputCacheRead, ...wire.inputCacheCreation > 0 ? { cacheWriteTokens: wire.inputCacheCreation } : {} }
}

describe('readKimiSubagents', () => {
  it('reads spawns in order, pairs completions, numbers resumed calls, and groups an AgentSwarm', async () => {
    const s = await stage()
    writeMainWire(s.homeDir, [
      spawned({ id: 'agent-0', callId: 'call-a', seconds: 2_000 }), started('agent-0'),
      completed('agent-0', usage(10, 2), 2_010),
      spawned({ id: 'agent-0', callId: 'call-b' }), completed('agent-0', usage(25, 5)),
      spawned({ id: 'agent-1', callId: 'swarm', name: 'coder', swarmIndex: 1 }),
      spawned({ id: 'agent-2', callId: 'swarm', name: 'coder', swarmIndex: 2 }),
      spawned({ id: 'agent-3', callId: 'swarm', name: 'coder', swarmIndex: 3 }),
      spawned({ id: 'agent-4', callId: 'bg', background: true, taskId: 'agent-task1' }),
    ], true)
    const calls = await readKimiSubagents(sessionDir(s.homeDir))
    expect(calls.map(call => [call.subagentId, call.callId, call.ordinal, call.resumed, call.group?.index, call.group?.size, call.background])).toEqual([
      ['agent-0', 'call-a', 1, false, undefined, undefined, false],
      ['agent-0', 'call-b', 2, true, undefined, undefined, false],
      ['agent-1', 'swarm', 1, false, 0, 3, false],
      ['agent-2', 'swarm', 1, false, 1, 3, false],
      ['agent-3', 'swarm', 1, false, 2, 3, false],
      ['agent-4', 'bg', 1, false, undefined, undefined, true],
    ])
    // Seconds → ms; a resumed call's share of the running total.
    expect(calls[0]!.spawnedAt).toBe(2_000_000)
    expect(calls[0]!.completed).toEqual({ at: 2_010_000, usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0 } })
    expect(calls[1]!.completed?.usage).toEqual({ inputTokens: 15, outputTokens: 3, cacheReadTokens: 0 })
    expect(calls[5]!.taskId).toBe('agent-task1')
    expect(calls[2]!.completed).toBeUndefined()
  })

  it('a subagent wire numbers one turn per call (its prompts are the calls, never injections)', async () => {
    const s = await stage()
    writeSubWire(s.homeDir, 'agent-0', [
      ...readThenAnswer('agent-0', 0, '第一次任务', '第一次结论', [usage(10, 1), usage(20, 2)]),
      ...readThenAnswer('agent-0', 1, '续用任务', '第二次结论', [usage(30, 3), usage(40, 4)]),
    ])
    const transcript = await readKimiTranscript(sessionDir(s.homeDir), { agent: 'agent-0' })
    expect(transcript.lines.filter(line => line.kind === 'user').map(line => [line.turn, line.text, 'injected' in line])).toEqual([
      [1, '第一次任务', false],
      [2, '续用任务', false],
    ])
    expect([...transcript.endedTurns!]).toEqual([[1, 'completed'], [2, 'completed']])
    // The member's own read is unchanged by the option.
    expect((await readKimiTranscript(sessionDir(s.homeDir))).endedTurns).toBeUndefined()
  })
})

describe('kimi subagent mirror: foreground', () => {
  it('mirrors a call live, closes it on subagent.completed, and a resumed call is the same session\'s next execution', async () => {
    const s = await stage()
    const mirror = await s.mirror()
    const first = [usage(100, 10, 50), usage(120, 20, 150)] as const
    const second = [usage(30, 3, 300), usage(40, 4, 330)] as const
    // Spawned, the first step closed, the answer still streaming.
    writeMainWire(s.homeDir, [spawned({ id: 'agent-0', callId: 'call-1', description: '看目录', seconds: 1_000 }), started('agent-0')], true)
    const call1 = readThenAnswer('agent-0', 0, '看看 a.txt', '结论一', first)
    const answerAt = call1.findIndex(line => (line['event'] as { part?: { type?: string } } | undefined)?.part?.type === 'text')
    writeSubWire(s.homeDir, 'agent-0', call1.slice(0, answerAt))
    await mirror.tail()

    const grandchild = s.grandchild('agent-0')!
    expect(grandchild.header.parentSession).toBe(SessionId(MEMBER))
    expect(grandchild.header.delegationDepth).toBe(2)
    expect(steps(grandchild)).toEqual([['reasoning', 'tool-call']])
    expect(executions(grandchild).map(record => record.phase)).toEqual(['start'])
    const start = executions(grandchild)[0] as LocalAgentExecutionStartEvent
    expect(start).toMatchObject({ caller: 'cli', callerRef: 'call-1', operation: 'prompt', parentSessionId: MEMBER, admittedAt: 1_000_000, task: { sessionId: 'room-parent', id: 'task-1' } })
    expect(start.cause).toEqual({ kind: 'cli-subagent', sessionId: MEMBER, callId: 'call-1', executionId: 'member-exec-1', name: 'explore' })
    expect(mirror.open).toBe(true)

    // The answer lands and Kimi reports the call done.
    writeSubWire(s.homeDir, 'agent-0', call1.slice(answerAt), true)
    writeMainWire(s.homeDir, [completed('agent-0', totalOf(...first), 1_020)], true)
    await mirror.tail()
    expect(steps(grandchild)).toEqual([['reasoning', 'tool-call'], ['text']])
    expect(ends(grandchild)).toEqual([expect.objectContaining({ outcome: 'done', turns: [1], endedAt: 1_020_000, providerReportedUsage: asUsage(totalOf(...first)) })])
    expect((ofType(grandchild, 'user/message')[0]!.data as { content: Array<{ text: string }> }).content[0]!.text).toBe('看看 a.txt')
    expect((ofType(grandchild, 'request/header')[0]!.data as { header: { config: unknown } }).header.config).toEqual({ provider: 'kimi-cli', model: 'k-fixture', reasoningEffort: 'high', maxTokens: 32_768 })
    expect(JSON.stringify(ofType(grandchild, 'tool/result')[0]!.data)).toContain('文件内容占位')
    expect(mirror.open).toBe(false)

    // The member resumes it: the same session, a second execution, turn 2.
    writeMainWire(s.homeDir, [spawned({ id: 'agent-0', callId: 'call-2', description: '再看一次' }), completed('agent-0', totalOf(...first, ...second))], true)
    writeSubWire(s.homeDir, 'agent-0', readThenAnswer('agent-0', 1, '再看 b.txt', '结论二', second), true)
    await mirror.tail()
    expect(ofType(s.member, 'subagent/catalog')).toHaveLength(1)
    const records = executions(grandchild)
    expect(records.map(record => record.phase)).toEqual(['start', 'end', 'start', 'end'])
    expect((records[2] as LocalAgentExecutionStartEvent).cause).toMatchObject({ callId: 'call-2', resumed: true })
    expect(ends(grandchild)[1]).toMatchObject({ outcome: 'done', turns: [2] })

    // Usage equality: each execution's per-call sum = its share of Kimi's total.
    const readings = executionReadingsOf(grandchild.snapshotEvents())
    for (const end of ends(grandchild)) {
      const reading = readings.get(end.executionId)!
      expect(reading.callUsage).toEqual(end.providerReportedUsage)
    }
    expect(readings.get(ends(grandchild)[1]!.executionId)!.callUsage).toEqual(asUsage(totalOf(...second)))
    expectValidReleasedLog(grandchild)

    // A repeated pass writes nothing more.
    const count = grandchild.snapshotEvents().length
    await mirror.tail()
    await mirror.settleRound({ processExited: false })
    expect(grandchild.snapshotEvents().length).toBe(count)
  })

  it('an AgentSwarm call: three grandchildren under one call id, each with its place in the group', async () => {
    const s = await stage()
    const mirror = await s.mirror()
    const ids = ['agent-1', 'agent-2', 'agent-3']
    writeMainWire(s.homeDir, ids.flatMap((id, index) => [spawned({ id, callId: 'swarm-1', name: 'coder', swarmIndex: index + 1 }), started(id)]), true)
    for (const id of ids) writeSubWire(s.homeDir, id, readThenAnswer(id, 0, `任务 ${id}`, `结论 ${id}`, [usage(5, 1), usage(6, 2)]))
    writeMainWire(s.homeDir, ids.map(id => completed(id, usage(11, 3))), true)
    await mirror.tail()
    expect(ofType(s.member, 'subagent/catalog').map(event => (event.data as { label?: string }).label)).toEqual(['coder: 占位任务', 'coder: 占位任务', 'coder: 占位任务'])
    ids.forEach((id, index) => {
      const grandchild = s.grandchild(id)!
      expect((executions(grandchild)[0] as LocalAgentExecutionStartEvent).cause).toMatchObject({ callId: 'swarm-1', group: { index, size: 3 }, name: 'coder' })
      expect(ends(grandchild)).toEqual([expect.objectContaining({ outcome: 'done' })])
      expect(steps(grandchild)).toEqual([['reasoning', 'tool-call'], ['text']])
      expectValidReleasedLog(grandchild)
    })
  })

  it('a call Kimi never closed ends cancelled when the member\'s round settles, its cut-off step interrupted', async () => {
    const s = await stage()
    const mirror = await s.mirror()
    writeMainWire(s.homeDir, [spawned({ id: 'agent-5', callId: 'call-cut' }), started('agent-5')], true)
    writeSubWire(s.homeDir, 'agent-5', subTurn({
      id: 'agent-5', turnId: 0, prompt: '会被打断的任务', ended: false,
      steps: [
        { think: '读一下', tools: [{ id: 'r1', name: 'ReadFile' }], usage: usage(7, 1) },
        { think: '再跑个命令', tools: [{ id: 'b1', name: 'Bash', args: { command: 'sleep 99' } }], usage: usage(9, 2), closed: false },
      ],
    }))
    await mirror.tail()
    const grandchild = s.grandchild('agent-5')!
    expect(steps(grandchild)).toEqual([['reasoning', 'tool-call']])
    await mirror.settleRound({ processExited: false })
    expect(steps(grandchild)).toEqual([['reasoning', 'tool-call'], ['reasoning', 'tool-call']])
    const messages = ofType(grandchild, 'assistant/message').map(event => event.data as { interrupted?: boolean; usage?: TokenUsage })
    expect(messages.map(message => message.interrupted === true)).toEqual([false, true])
    expect(messages.map(message => message.usage?.inputTokens)).toEqual([7, 9])
    expect(ends(grandchild)).toEqual([expect.objectContaining({ outcome: 'cancelled', turns: [1] })])
    expect(ends(grandchild)[0]!.providerReportedUsage).toBeUndefined()
    expect(ofType(grandchild, 'turn/end').map(event => (event.data as { reason: { kind: string } }).reason.kind)).toEqual(['aborted'])
    expectValidReleasedLog(grandchild)
  })

  it('calls spawned before the mirror attached are history: never mirrored', async () => {
    const s = await stage()
    writeMainWire(s.homeDir, [spawned({ id: 'agent-old', callId: 'call-old' }), completed('agent-old', usage(1, 1))], true)
    writeSubWire(s.homeDir, 'agent-old', readThenAnswer('agent-old', 0, '旧任务', '旧结论', [usage(1, 0), usage(0, 1)]))
    const mirror = await s.mirror()
    await mirror.tail()
    expect(s.grandchild('agent-old')).toBeUndefined()
    expect(ofType(s.member, 'subagent/catalog')).toHaveLength(0)
  })
})

describe('kimi subagent mirror: background', () => {
  it('stays open past the member\'s round, links its task, and ends done when Kimi completes it', async () => {
    const s = await stage()
    const mirror = await s.mirror()
    const calls = [usage(50, 5), usage(60, 6)] as const
    writeMainWire(s.homeDir, [spawned({ id: 'agent-6', callId: 'call-bg', background: true, taskId: 'agent-bgtask' }), started('agent-6')], true)
    const lines = readThenAnswer('agent-6', 0, '后台任务', '后台结论', calls)
    writeSubWire(s.homeDir, 'agent-6', lines.slice(0, 6))
    await mirror.settleRound({ processExited: false })
    const grandchild = s.grandchild('agent-6')!
    expect((executions(grandchild)[0] as LocalAgentExecutionStartEvent).cause).toMatchObject({ background: true, callId: 'call-bg' })
    expect(ends(grandchild)).toEqual([])
    expect(mirror.open).toBe(true)
    expect(mirror.sessionOfTask('agent-bgtask')).toBe(grandchild.header.id)

    // The task read links the task to its grandchild (Kimi's task state names the subagent).
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const tasks = join(sessionDir(s.homeDir), 'agents', 'main', 'tasks')
    mkdirSync(tasks, { recursive: true })
    writeFileSync(join(tasks, 'agent-bgtask.json'), JSON.stringify({ taskId: 'agent-bgtask', kind: 'agent', status: 'running', detached: true, startedAt: Date.now(), description: '后台任务', agentId: 'agent-6', parentToolCallId: 'call-bg' }))
    const read = await readKimiBackgroundTasks(sessionDir(s.homeDir), {
      subagentSessionOf: id => cliSubagentSessionId(MEMBER, id),
    })
    expect(read.map(task => [task.id, task.kind, task.subagentSessionId])).toEqual([['agent-bgtask', 'agent', grandchild.header.id]])

    // Kimi finishes it after the member's round.
    writeSubWire(s.homeDir, 'agent-6', lines.slice(6), true)
    writeMainWire(s.homeDir, [completed('agent-6', totalOf(...calls))], true)
    await mirror.tail()
    expect(ends(grandchild)).toEqual([expect.objectContaining({ outcome: 'done', providerReportedUsage: asUsage(totalOf(...calls)) })])
    expect(executionReadingsOf(grandchild.snapshotEvents()).get(ends(grandchild)[0]!.executionId)!.callUsage).toEqual(asUsage(totalOf(...calls)))
    expect(mirror.open).toBe(false)
    expectValidReleasedLog(grandchild)
  })

  it('ends uncertain when the member\'s process goes away first', async () => {
    const s = await stage()
    const mirror = await s.mirror()
    writeMainWire(s.homeDir, [spawned({ id: 'agent-7', callId: 'call-bg2', background: true, taskId: 'agent-t2' })], true)
    writeSubWire(s.homeDir, 'agent-7', subTurn({ id: 'agent-7', turnId: 0, prompt: '跑很久', ended: false, steps: [{ think: '开始', tools: [{ id: 'x1', name: 'Bash' }], usage: usage(3, 1) }] }))
    await mirror.settleRound({ processExited: false })
    await mirror.lost()
    const grandchild = s.grandchild('agent-7')!
    expect(ends(grandchild)).toEqual([expect.objectContaining({ outcome: 'uncertain' })])
    expectValidReleasedLog(grandchild)
  })

  it('on the exec path a background subagent still open at settle ends cancelled', async () => {
    const s = await stage()
    const mirror = await s.mirror('exec')
    writeMainWire(s.homeDir, [spawned({ id: 'agent-8', callId: 'call-bg3', background: true })], true)
    await mirror.settleRound({ processExited: true })
    expect(ends(s.grandchild('agent-8')!)).toEqual([expect.objectContaining({ outcome: 'cancelled', turns: [] })])
  })
})

describe('kimi subagent mirror: degrade', () => {
  it('no session, no wire, an unknown line, or a sub-wire that never appears: nothing throws', async () => {
    const s = await stage()
    const detached = new KimiSubagentMirror({ ctx: s.ctx, member: s.member, homeDir: s.homeDir, transport: 'live' })
    mirrors.push(detached)
    await detached.tail()
    await detached.settleRound({ processExited: false })
    const mirror = await s.mirror()
    writeMainWire(s.homeDir, [{ type: 'subagent.spawned' }, { type: 'subagent.completed', subagentId: 'nobody' }], true)
    await mirror.tail()
    expect(ofType(s.member, 'subagent/catalog')).toHaveLength(0)
    writeMainWire(s.homeDir, [spawned({ id: 'agent-9', callId: 'call-nowire' })], true)
    await mirror.tail()
    expect(steps(s.grandchild('agent-9')!)).toEqual([])
    await mirror.settleRound({ processExited: false })
    expect(ends(s.grandchild('agent-9')!)).toEqual([expect.objectContaining({ outcome: 'cancelled' })])
  })
})

describe('kimi subagent mirror snapshot', () => {
  it('one resumed subagent (two calls) → the exact grandchild event sequence', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: SNAPSHOT_NOW })
    try {
      const s = await stage()
      const mirror = await s.mirror()
      const first = [usage(100, 10, 50), usage(120, 20, 150)] as const
      const second = [usage(30, 3, 300), usage(40, 4, 330)] as const
      writeMainWire(s.homeDir, [
        spawned({ id: 'agent-0', callId: 'call-1', description: '看目录' }), started('agent-0'), completed('agent-0', totalOf(...first)),
        spawned({ id: 'agent-0', callId: 'call-2', description: '看目录' }), started('agent-0'), completed('agent-0', totalOf(...first, ...second)),
      ], true)
      writeSubWire(s.homeDir, 'agent-0', [
        ...readThenAnswer('agent-0', 0, '看看 a.txt', '结论一', first),
        ...readThenAnswer('agent-0', 1, '再看 b.txt', '结论二', second),
      ])
      await mirror.tail()
      const grandchild = s.grandchild('agent-0')!
      expectValidReleasedLog(grandchild)
      expect(mirrorSnapshot(grandchild)).toMatchSnapshot()
      // The two executions' per-call sums add up to Kimi's final running total.
      const readings = [...executionReadingsOf(grandchild.snapshotEvents()).values()]
      expect(readings.reduce<TokenUsage | undefined>((sum, reading) => reading.callUsage === undefined ? sum : addUsage(sum, reading.callUsage), undefined)).toEqual(asUsage(totalOf(...first, ...second)))
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('kimi exec round mirrors the member\'s subagents', () => {
  it('member steps are the same as without the subagent; it lands in its grandchild, closed at settle', async () => {
    const run = async (withSubagent: boolean): Promise<{ member: Session; ctx: Context }> => {
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      const homeDir = mkdtempSync(join(tmpdir(), 'kimi-exec-subagents-'))
      const member = ctx.sessions.create(SessionId(MEMBER), {
        meta: { cwd: '/home/user/work', parentSession: SessionId('room-parent'), origin: 'subagent', delegationDepth: 1 },
      } as never)
      const loop = (time: number, event: Record<string, unknown>) => ({ type: 'context.append_loop_event', time, event })
      writeMainWire(homeDir, [
        memberPrompt('派活'),
        loop(1_000_100, { type: 'step.begin', step: 1 }),
        loop(1_000_200, { type: 'tool.call', step: 1, toolCallId: 'call-x', name: 'Agent', args: { description: '看目录', prompt: '看看' } }),
        ...withSubagent ? [spawned({ id: 'agent-0', callId: 'call-x' }), started('agent-0'), completed('agent-0', usage(11, 3))] : [],
        loop(1_000_300, { type: 'tool.result', toolCallId: 'call-x', result: { output: '子智能体结论' } }),
        loop(1_000_400, { type: 'step.end', step: 1 }),
        loop(1_000_500, { type: 'step.begin', step: 2 }),
        loop(1_000_600, { type: 'content.part', step: 2, part: { type: 'text', text: '完成。' } }),
        loop(1_000_700, { type: 'step.end', step: 2 }),
      ])
      if (withSubagent) writeSubWire(homeDir, 'agent-0', readThenAnswer('agent-0', 0, '看看', '子智能体结论', [usage(5, 1), usage(6, 2)]))
      const result = await (await startKimiCliRun({
        prompt: [{ type: 'text', text: '派活' }],
        parent: { session: { header: { cwd: '/home/user/work' } } },
        signal: new AbortController().signal,
      } as unknown as SubagentStartRequest, {
        cwd: '/home/user/work',
        env: {},
        disposeGraceMs: 1_000,
        spawn: () => execChild('完成。', `To resume this session: kimi -r session_${FIXTURE_SESSION}\n`),
        childSession: member,
        ctx,
        homeDir,
        liveMirrorIntervalMs: 60_000,
      })).result
      expect(result.stopReason).toBe('completed')
      const deadline = Date.now() + 5_000
      while (member.snapshotEvents().at(-1)?.type !== 'turn/end') {
        if (Date.now() > deadline) throw new Error('the member turn never closed')
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      return { member, ctx }
    }
    const without = await run(false)
    const withSubagents = await run(true)
    const content = (member: Session): unknown[] => member.snapshotEvents()
      .filter(event => event.type !== 'subagent/catalog')
      .map(event => ({ type: event.type, data: event.data }))
    const normalize = (value: unknown[]): unknown => JSON.parse(JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>').replace(/"(at|startedAt|endedAt|createdAt|timestamp)":\d+/g, '"$1":0'))
    expect(normalize(content(withSubagents.member))).toEqual(normalize(content(without.member)))
    const types = withSubagents.member.snapshotEvents().map(event => event.type)
    expect(types.filter(type => type === 'subagent/catalog')).toHaveLength(1)
    expect(types.indexOf('subagent/catalog')).toBeLessThan(types.lastIndexOf('turn/end'))
    const grandchild = withSubagents.ctx.sessions.get(SessionId(cliSubagentSessionId(MEMBER, 'agent-0')))!
    expect(steps(grandchild)).toEqual([['reasoning', 'tool-call'], ['text']])
    expect(ends(grandchild)).toEqual([expect.objectContaining({ outcome: 'done', providerReportedUsage: asUsage(usage(11, 3)) })])
    expectValidReleasedLog(grandchild)
  })
})

function execChild(stdoutText: string, stderrText: string): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  stdout.push(stdoutText)
  stdout.push(null)
  const stderr = new Readable({ read() {} })
  stderr.push(stderrText)
  stderr.push(null)
  return {
    pid: 4401,
    stdin: undefined,
    stdout,
    stderr,
    collected: {
      stdout: { readFrom: () => ({ text: stdoutText, nextOffset: 0, lossy: false }) },
      stderr: { readFrom: () => ({ text: stderrText, nextOffset: 0, lossy: false }) },
    },
    done: new Promise<{ exitCode: number; signal: null }>((resolve) => { setImmediate(() => { resolve({ exitCode: 0, signal: null }) }) }),
    terminate: () => undefined,
    waitForExit: async () => true,
  } as unknown as SubprocessHandle
}
