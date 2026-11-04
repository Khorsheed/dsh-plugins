// @vitest-environment jsdom
/**
 * Usage in one place (batch 5 S6): the room's usage line, compaction row and
 * member totals read the core's execution reading (attached by getState)
 * instead of stored copies. A claude-code/codex round shows the CLI's own
 * total with a quiet hint when the per-call sum drifts from it; a kimi/dsh
 * round shows the per-call sum; a run from before S6 keeps its stored numbers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { LocalAgentExecutionReading } from '@khorsheed/dsh-local-agent/types'
import { RoomSpeechView } from '../src/client/RoomSpeechView.tsx'
import { RoomCompactionView } from '../src/client/RoomCompactionView.tsx'
import { memberUsage } from '../src/client/RoomStatsLine.tsx'
import { roundUsage, usageGapTolerance } from '../src/client/round-usage.ts'
import { RoomStore, type RoomGateway } from '../src/client/room-store.ts'
import { en, zh } from '../src/client/locales.ts'
import type { RoomCompactionViewProps, RoomSpeechViewProps } from '../src/client/slots.ts'
import type { RoomExecution, RoomState } from '../src/types.ts'

afterEach(() => { cleanup() })

const reading = (over: Partial<LocalAgentExecutionReading>): LocalAgentExecutionReading => ({
  executionId: 'e1', operation: 'prompt', outcome: 'done', turns: [1], calls: 1, unrecorded: [], compactions: [], ...over,
})
const run = (over: Partial<RoomExecution>): RoomExecution => ({
  id: 'r1', memberId: 'm-ada', member: 'ada', state: 'done', startedAt: 1, executionId: 'e1', childSessionId: 'child-1' as SessionId, ...over,
})

const CLI = { inputTokens: 2_000, cacheReadTokens: 10_000, outputTokens: 400 }
const STATE: RoomState = {
  members: [
    { name: 'main', kind: 'main-agent', invitedBy: 'human' },
    { id: 'm-ada', name: 'ada', kind: 'cli', provider: 'claude-local', invitedBy: 'human', childSessionId: 'child-1' as SessionId },
  ],
  relays: [], tasks: [], runs: [],
}

async function storeOf(state: RoomState): Promise<RoomStore> {
  const list = createSnapshotStore<{ current: SessionId | undefined }>({ current: undefined })
  const gateway: RoomGateway = {
    isRoom: async () => ({ ok: true, value: true }),
    getState: async () => ({ ok: true, value: { ok: true, value: state } }),
  }
  const store = new RoomStore({ sessions: { list } } as unknown as Context, gateway)
  await store.ensure('room-1' as SessionId)
  return store
}

async function speech(execution: RoomExecution, locale: Record<string, string> = zh): Promise<void> {
  const roomStore = await storeOf({ ...STATE, executions: [execution] })
  const data = { seq: 7, time: 1007, member: 'ada', text: 'done', childSessionId: 'child-1', durationMs: 1200, runId: execution.id }
  render(<RoomSpeechView {...{
    node: { key: 'k', kind: 'room-speech', id: '7', target: 'chat', anchorSeq: 7, location: { kind: 'unresolved' }, visibility: 'visible', data },
    sessionId: 'room-1', roomStore, openSession: vi.fn(), t: makeTranslate(locale),
  } as unknown as RoomSpeechViewProps} />)
}

describe('roundUsage', () => {
  it('the CLI total heads the line; a sum within the tolerance raises no hint', () => {
    const line = roundUsage(run({ reading: reading({ providerReportedUsage: CLI, callUsage: { inputTokens: 1_990, cacheReadTokens: 10_000, outputTokens: 400 } }) }))
    expect(line).toEqual({ tokens: 12_400, breakdown: CLI, source: 'cli', callTokens: 12_390 })
    expect(usageGapTolerance(12_400)).toBe(124)
  })

  it('a gap beyond the tolerance is carried, signed', () => {
    expect(roundUsage(run({ reading: reading({ providerReportedUsage: CLI, callUsage: { inputTokens: 800, cacheReadTokens: 10_000, outputTokens: 400 } }) }))?.gap).toBe(-1_200)
    expect(roundUsage(run({ reading: reading({ providerReportedUsage: CLI, callUsage: { inputTokens: 3_000, cacheReadTokens: 10_000, outputTokens: 400 } }) }))?.gap).toBe(1_000)
  })

  it('no CLI total (kimi, dsh): the per-call sum; nothing at all: no line', () => {
    expect(roundUsage(run({ reading: reading({ callUsage: { inputTokens: 300, outputTokens: 50 } }) }))).toEqual({ tokens: 350, breakdown: { inputTokens: 300, outputTokens: 50 }, source: 'calls' })
    expect(roundUsage(run({ reading: reading({ calls: 0 }) }))).toBeUndefined()
  })

  it('a reading wins over a stored copy (never mixed); a run without one keeps its stored numbers', () => {
    expect(roundUsage(run({ tokens: 99_999, reading: reading({ callUsage: { inputTokens: 300, outputTokens: 50 } }) }))?.tokens).toBe(350)
    expect(roundUsage(run({ executionId: undefined, tokens: 4_200 }))).toEqual({ tokens: 4_200, source: 'stored' })
  })
})

describe('the reply\'s usage line, fed by the reading', () => {
  it('matching totals: the CLI total, both figures in the breakdown, no hint', async () => {
    await speech(run({ model: 'claude-opus-5-5', reading: reading({ providerReportedUsage: CLI, callUsage: CLI, calls: 3 }) }))
    expect(screen.getByText('用量 12.4K tok')).toBeDefined()
    expect(screen.queryByTestId('usage-gap')).toBeNull()
    fireEvent.mouseEnter(screen.getByText('用量 12.4K tok').parentElement!)
    const panel = screen.getByRole('tooltip').textContent ?? ''
    expect(panel).toContain('本轮用量（CLI 报告）12,400 tok')
    expect(panel).toContain('逐次合计12,400 tok')
  })

  it('a mismatch: a quiet hint next to the round, in both languages', async () => {
    const execution = run({ reading: reading({ providerReportedUsage: CLI, callUsage: { inputTokens: 800, cacheReadTokens: 10_000, outputTokens: 400 } }) })
    await speech(execution)
    expect(screen.getByTestId('usage-gap').textContent).toBe('逐次合计比 CLI 报告少 1.2K，可能有未记录的内部调用')
    // The breakdown repeats it in full (the row's copy truncates on a phone).
    fireEvent.mouseEnter(screen.getByText('用量 12.4K tok').parentElement!)
    const panel = screen.getByRole('tooltip').textContent ?? ''
    expect(panel).toContain('逐次合计11,200 tok')
    expect(panel).toContain('逐次合计比 CLI 报告少 1.2K，可能有未记录的内部调用')
    cleanup()
    await speech(execution, en)
    expect(screen.getByTestId('usage-gap').textContent).toBe('Calls sum to 1.2K less than the CLI total; possibly unrecorded internal calls')
  })

  it('kimi (no CLI total): the per-call sum, titled as such', async () => {
    await speech(run({ reading: reading({ callUsage: { inputTokens: 3_000, cacheReadTokens: 5_000, outputTokens: 200 }, calls: 4 }) }))
    fireEvent.mouseEnter(screen.getByText('用量 8.2K tok').parentElement!)
    expect(screen.getByRole('tooltip').textContent).toContain('本轮用量（逐次合计）8,200 tok')
    expect(screen.queryByTestId('usage-gap')).toBeNull()
  })

  it('an old run (no execution id, no reading) still shows its stored numbers', async () => {
    await speech(run({ executionId: undefined, tokens: 29_234, usage: { inputTokens: 9_110, outputTokens: 1_180, cacheReadTokens: 18_944 } }))
    fireEvent.mouseEnter(screen.getByText('用量 29.2K tok').parentElement!)
    expect(screen.getByRole('tooltip').textContent).toContain('本轮用量29,234 tok')
  })
})

describe('the compaction row, fed by the reading', () => {
  async function row(data: Record<string, unknown>, execution?: RoomExecution): Promise<void> {
    const roomStore = execution === undefined ? undefined : await storeOf({ ...STATE, executions: [execution] })
    render(<RoomCompactionView {...{ node: { data: { seq: 1, time: 1, member: 'ada', ...data } }, sessionId: 'room-1', roomStore, t: makeTranslate(zh) } as unknown as RoomCompactionViewProps} />)
  }
  const fact = { source: 'manual' as const, outcome: 'completed' as const, provider: 'kimi-cli', beforeTokens: 560_000, afterTokens: 41_000, usage: { inputTokens: 20_000, outputTokens: 1_000 }, startedAt: 1, endedAt: 2, boundarySeq: 3 }

  it('a new row (no stored numbers) shows the core fact: sizes as sizes, the spend as 用量', async () => {
    await row({ outcome: 'completed', runId: 'c1' }, run({ id: 'c1', reading: reading({ executionId: 'c1', operation: 'compact', turns: [], calls: 0, compactions: [fact] }) }))
    expect(screen.getByText(/ada 已压缩上下文/).textContent).toBe('ada 已压缩上下文 · 560K → 41K tok · 用量 21K')
  })

  it('a fact marked as reporting nothing reads as "does not report"', async () => {
    await row({ outcome: 'completed', runId: 'c1' }, run({ id: 'c1', reading: reading({ operation: 'compact', compactions: [{ ...fact, beforeTokens: undefined as never, afterTokens: undefined as never, usage: undefined as never, unrecorded: ['usage', 'before-after', 'summary'] }] }) }))
    expect(screen.getByText(/ada/).textContent).toContain('该成员不报告压缩数据')
  })

  it('an old row keeps the numbers it stored', async () => {
    await row({ outcome: 'completed', beforeTokens: 300_000, afterTokens: 20_000, usage: { inputTokens: 5_000, outputTokens: 500 } })
    expect(screen.getByText(/ada 已压缩上下文/).textContent).toBe('ada 已压缩上下文 · 300K → 20K tok · 用量 5.5K')
  })
})

describe('member totals read the same line', () => {
  it('each round counts what its reply shows: CLI total, per-call sum, or a legacy stored copy', () => {
    const state: RoomState = { ...STATE, executions: [
      run({ id: 'a', reading: reading({ providerReportedUsage: CLI, callUsage: { inputTokens: 800, outputTokens: 400 } }) }),
      run({ id: 'b', reading: reading({ executionId: 'e2', callUsage: { inputTokens: 1_000, outputTokens: 100 } }) }),
      run({ id: 'c', executionId: undefined, tokens: 500 }),
    ] }
    expect(memberUsage(state)).toEqual([expect.objectContaining({ member: 'ada', rounds: 3, tokens: 12_400 + 1_100 + 500 })])
  })
})
