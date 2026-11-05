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
import { LOCAL_AGENT_SERVICE, addUsage, executionReadingsOf } from '../src/index.ts'

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
})
