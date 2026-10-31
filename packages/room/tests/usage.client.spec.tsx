// @vitest-environment jsdom
/** Member usage: per-member rows from the execution records, the stats row's members chip and its breakdown. */
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { memberUsage, RoomStatsLine } from '../src/client/RoomStatsLine.tsx'
import { zh } from '../src/client/locales.ts'
import type { RoomStatsLineProps } from '../src/client/RoomStatsLine.tsx'
import type { RoomState } from '../src/types.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(zh) as unknown as RoomStatsLineProps['t']

const STATE: RoomState = {
  members: [
    { id: 'm-dsh', name: 'dsh', kind: 'main-agent', invitedBy: 'human' },
    { id: 'm-gm', name: '游戏大师', kind: 'cli', provider: 'claude-local', invitedBy: 'agent' },
    { id: 'm-cut', name: '剪刀手', kind: 'cli', provider: 'codex-local', invitedBy: 'human' },
  ],
  relays: [], tasks: [], runs: [],
  executions: [
    { id: '3:m-cut', memberId: 'm-cut', member: '剪子', state: 'done', startedAt: 1, elapsedMs: 10_000, tokens: 2_000, usage: { inputTokens: 500, cacheReadTokens: 1_000, outputTokens: 500 } },
    { id: '4:m-cut', memberId: 'm-cut', member: '剪刀手', state: 'done', startedAt: 1, elapsedMs: 20_000, tokens: 10_000, model: 'gpt-6.1', usage: { inputTokens: 1_000, cacheReadTokens: 8_000, outputTokens: 1_000 } },
    { id: '1:m-gm', memberId: 'm-gm', member: '游戏大师', state: 'done', startedAt: 1, elapsedMs: 60_000, tokens: 100_000 },
    { id: '5:m-gm', memberId: 'm-gm', member: '游戏大师', state: 'done', startedAt: 2, elapsedMs: 42_000, tokens: 44_000, model: 'claude-opus-5-5' },
    { id: '0:m-dsh', memberId: 'm-dsh', member: 'dsh', state: 'done', startedAt: 0, elapsedMs: 9_000, tokens: 9_999 },
  ],
}

describe('member usage', () => {
  it('sums each member\'s runs in roster order, leaving the main agent to the projected figures', () => {
    expect(memberUsage(STATE)).toEqual([
      { member: '游戏大师', model: 'claude-opus-5-5', rounds: 2, tokens: 144_000, elapsedMs: 102_000 },
      // A rename keeps one row under the current name; the split sums the rounds that recorded one.
      { member: '剪刀手', model: 'gpt-6.1', rounds: 2, tokens: 12_000, input: 10_500, cacheRead: 9_000, output: 1_500, elapsedMs: 30_000 },
    ])
    expect(memberUsage(undefined)).toEqual([])
  })

  it('the stats row adds a members chip whose breakdown lists each member', () => {
    const useProjection = (() => undefined) as unknown as RoomStatsLineProps['useProjection']
    render(<RoomStatsLine useProjection={useProjection} state={STATE} t={t} />)
    const chip = screen.getByRole('button', { name: /成员 2 位 · 156K tok/ })
    fireEvent.click(chip)
    const breakdown = screen.getByRole('dialog', { name: '成员用量' })
    expect(breakdown.textContent).toContain('游戏大师')
    // The total column carries a member whose records hold no split.
    expect(breakdown.textContent).toContain('144K')
    expect(breakdown.textContent).toContain('1m42s')
    expect(breakdown.textContent).toContain('剪刀手')
    expect(breakdown.textContent).not.toContain('剪子')
    expect(breakdown.textContent).toContain('10.5K')
    expect(breakdown.textContent).toContain('86%')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a room with no member runs keeps the plain row', () => {
    const useProjection = (() => undefined) as unknown as RoomStatsLineProps['useProjection']
    const { container } = render(<RoomStatsLine useProjection={useProjection} state={{ ...STATE, executions: [] }} t={t} />)
    expect(container.textContent).toBe('')
  })

  it('with CLI member sessions: a 上下文 column (ring + row tools), the chip\'s attention dots, and the coordinator\'s ring', () => {
    const useProjection = (() => undefined) as unknown as RoomStatsLineProps['useProjection']
    const state: RoomState = { ...STATE, members: STATE.members.map(member => member.kind === 'cli' ? { ...member, childSessionId: `child-${member.id}` as never } : member) }
    const calls: string[] = []
    const renderMemberTools = (id: string, placement: string, options?: { readonly memberName?: string | undefined }) => {
      calls.push(`${id}:${placement}:${options?.memberName ?? ''}`)
      return <span data-testid={`${placement}-${id}`} />
    }
    render(<RoomStatsLine useProjection={useProjection} state={state} t={t} renderMemberTools={renderMemberTools} coordinatorSession="child-m-gm" />)
    // The coordinator's ring ends the line; each CLI member feeds the chip's dot.
    expect(screen.getByTestId('meter-child-m-gm')).toBeTruthy()
    expect(calls).toContain('child-m-gm:dot:游戏大师')
    expect(calls).toContain('child-m-cut:dot:剪刀手')
    fireEvent.click(screen.getByRole('button', { name: /成员 2 位/ }))
    const breakdown = screen.getByRole('dialog', { name: '成员用量' })
    expect(breakdown.textContent).toContain('上下文')
    expect(breakdown.querySelector('[data-testid="row-child-m-cut"]')).not.toBeNull()
    expect(breakdown.querySelector('[data-testid="meter-child-m-cut"]')).not.toBeNull()
  })
})
