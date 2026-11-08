/**
 * What the member session's subagent cards read for a Kimi member
 * (member-cli-subagents M5 over M3): the grandchildren the Kimi mirror
 * writes from the synthetic wires (subagent-fixtures.ts) fold, through the
 * core's `memberSubagentCalls` fold, into one call per execution — a resumed
 * subagent as ordinal 2 of the same session, an `AgentSwarm` as three
 * entries on one call id whose group place is 0-based (the wire's
 * `swarmIndex` counts from 1).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { grandchildIdsOf, openMirrorTurn, subagentCallsOf } from '@khorsheed/dsh-local-agent'
import { afterEach, describe, expect, it } from 'vitest'
import { KimiSubagentMirror } from '../src/subagent-mirror.ts'
import {
  completed, FIXTURE_SESSION, memberPrompt, readThenAnswer, spawned, started, totalOf, usage, writeMainWire, writeSubWire,
} from './subagent-fixtures.ts'

const MEMBER = 'member-kimi'
const mirrors: KimiSubagentMirror[] = []
afterEach(() => { for (const mirror of mirrors.splice(0)) mirror.dispose() })

async function stage(): Promise<{ ctx: Context; member: Session; homeDir: string; mirror: KimiSubagentMirror }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const homeDir = mkdtempSync(join(tmpdir(), 'kimi-subagent-cards-'))
  const member = ctx.sessions.create(SessionId(MEMBER), {
    meta: { cwd: '/home/user/work', parentSession: SessionId('room-parent'), origin: 'subagent', delegationDepth: 1 },
  } as never)
  member.append('local-agent/execution' as never, {
    phase: 'start', executionId: 'member-exec-1', caller: 'room', callerRef: 'run-1', operation: 'prompt',
    task: { sessionId: 'room-parent', id: 'task-1' }, parentSessionId: 'room-parent', admittedAt: 1,
  } as never)
  openMirrorTurn(member, 1, 'live')
  writeMainWire(homeDir, [memberPrompt('派个子智能体')])
  const mirror = new KimiSubagentMirror({ ctx, member, homeDir, transport: 'live', pollMs: 60_000 })
  await mirror.attach(FIXTURE_SESSION)
  mirrors.push(mirror)
  return { ctx, member, homeDir, mirror }
}

const read = (ctx: Context, member: Session) => subagentCallsOf(grandchildIdsOf(MEMBER, member.snapshotEvents())
  .map(sessionId => ({ sessionId, events: ctx.sessions.get(SessionId(sessionId))!.snapshotEvents() })))

describe('Kimi subagents as the member session cards read them', () => {
  it('a call and its resume: one session, ordinals 1 and 2, type and description, steps ending in the reply', async () => {
    const s = await stage()
    const first = [usage(100, 10, 50), usage(120, 20, 150)] as const
    const second = [usage(30, 3, 300), usage(40, 4, 330)] as const
    writeMainWire(s.homeDir, [spawned({ id: 'agent-0', callId: 'call-1', description: '看目录' }), started('agent-0')], true)
    writeSubWire(s.homeDir, 'agent-0', readThenAnswer('agent-0', 0, '看看 a.txt', '结论一', first))
    writeMainWire(s.homeDir, [completed('agent-0', totalOf(...first), 1_020)], true)
    await s.mirror.tail()
    writeMainWire(s.homeDir, [spawned({ id: 'agent-0', callId: 'call-2', description: '再看一次' }), completed('agent-0', totalOf(...first, ...second))], true)
    writeSubWire(s.homeDir, 'agent-0', readThenAnswer('agent-0', 1, '再看 b.txt', '结论二', second), true)
    await s.mirror.tail()

    const calls = read(s.ctx, s.member)
    expect(calls.map(c => [c.callId, c.ordinal, c.state, c.turn, c.sessionId, c.name, c.description])).toEqual([
      ['call-1', 1, 'done', 1, `${MEMBER}.sub.agent-0`, 'explore', '看目录'],
      ['call-2', 2, 'done', 2, `${MEMBER}.sub.agent-0`, 'explore', '看目录'],
    ])
    expect(calls[0]!.steps).toEqual([
      { kind: 'request', index: 1, text: '先看文件', durationMs: 250 },
      { kind: 'tool', name: 'ReadFile', summary: 'a.txt', durationMs: 100 },
      { kind: 'request', index: 2, durationMs: 150 },
      { kind: 'reply', text: '结论一' },
    ])
    expect(calls[1]!.usage).toEqual({ inputTokens: 70, outputTokens: 7, cacheReadTokens: 630 })
  })

  it('an AgentSwarm: three entries on one call id, group places 0..2 from swarmIndex 1..3', async () => {
    const s = await stage()
    const ids = ['agent-1', 'agent-2', 'agent-3']
    // Spawned out of order: the place comes from swarmIndex, not from the spawn order.
    const order = [2, 0, 1]
    writeMainWire(s.homeDir, order.flatMap(index => [spawned({ id: ids[index]!, callId: 'swarm-1', name: 'coder', swarmIndex: index + 1 }), started(ids[index]!)]), true)
    for (const id of ids) writeSubWire(s.homeDir, id, readThenAnswer(id, 0, `任务 ${id}`, `结论 ${id}`, [usage(5, 1), usage(6, 2)]))
    writeMainWire(s.homeDir, [completed('agent-1', usage(11, 3)), completed('agent-3', usage(11, 3))], true)
    await s.mirror.tail()

    const calls = read(s.ctx, s.member).filter(c => c.callId === 'swarm-1')
    expect(calls).toHaveLength(3)
    const byId = new Map(calls.map(c => [c.sessionId.split('.sub.')[1], c]))
    expect(ids.map(id => byId.get(id)!.group)).toEqual([{ index: 0, size: 3 }, { index: 1, size: 3 }, { index: 2, size: 3 }])
    expect(ids.map(id => byId.get(id)!.state)).toEqual(['done', 'running', 'done'])
    expect(calls.every(c => c.name === 'coder' && c.ordinal === 1)).toBe(true)
  })
})
