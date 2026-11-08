// @vitest-environment jsdom
/**
 * A member CLI's own subagents in the existing Context Lens look
 * (member-cli-subagents M7): no new component, only content — a tab right
 * after its caller with 「由 X #n 派出」, a timing lane 「› name」 with thin
 * dashed marks at its run's ends and the caller's tool call titled 「等 name」,
 * the caller request's 「派出 name →」, the session map's dashed bars, and the
 * turn menu row saying the subagents' part of the totals.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AgentTabs } from '../src/client/AgentTabs.tsx'
import { TimingView } from '../src/client/TimingView.tsx'
import { SpawnLinks } from '../src/client/TokenView.tsx'
import { Trend } from '../src/client/Trend.tsx'
import { TurnMenu } from '../src/client/TurnMenu.tsx'
import type { AgentScopeOverview, RequestListItem, SessionTrend, TurnListItem, TurnTiming } from '../src/types.ts'
import type { InspectorTabProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
const t = ((key: keyof typeof zh, params?: Record<string, string>) => zh[key].replace(/\{(\w+)\}/g, (s, k: string) => params?.[k] ?? s)) as InspectorTabProps['t']
afterEach(cleanup)

const row = (seq: number, scopeId: string, extra: Partial<RequestListItem> = {}): RequestListItem =>
  ({ seq, requestNumber: seq, scopeId, status: 'ok', responseSummary: { kind: 'text' }, startedAt: seq * 100, totalChars: 0, usage: { inputTokens: 1000, outputTokens: 10 }, ...extra })
const scope = (scopeId: string, extra: Partial<AgentScopeOverview> = {}): AgentScopeOverview =>
  ({ scopeId, scopeSeq: 1, kind: 'subagent', status: 'ok', config: {}, startedAt: 0, requests: [], ...extra })

const memberId = 'child-ada'
const member = scope(memberId, { label: '人物建模大师', startedAt: 0, endedAt: 1000, requests: [row(1186, memberId, { spawns: [{ scopeId: 'sub-explore', name: '探索' }] }), row(1187, memberId)] })
const explore = scope('sub-explore', {
  label: '人物建模大师 › 探索', startedAt: 260, endedAt: 780,
  delegatedBy: { turnSeq: -100, scopeId: memberId, seq: 1186, requestNumber: 1186 },
  cliSubagent: { parentScopeId: memberId, parentName: '人物建模大师', name: '探索', callId: 'call-1' },
  requests: [row(3, 'sub-explore', { spawnedFrom: memberId })],
})
const other = scope('child-game', { label: '游戏大师', startedAt: 100, requests: [row(2, 'child-game')] })
const main = scope('main', { kind: 'main', requests: [row(1, 'main')] })

describe('CLI subagents in the existing lens look', () => {
  it('tabs: the subagent sits right after the member that called it, and says which request started it', () => {
    const open = vi.fn()
    // The member started first, the other member later, the subagent last: still right after its member.
    const { rerender } = render(<AgentTabs scopes={[main, other, explore, member]} value="main" onSelect={vi.fn()} onOpenRequest={open} t={t} />)
    expect(screen.getAllByRole('tab').map(tab => tab.getAttribute('title'))).toEqual(['主对话', '人物建模大师', '人物建模大师 › 探索', '游戏大师'])
    rerender(<AgentTabs scopes={[main, other, explore, member]} value="sub-explore" onSelect={vi.fn()} onOpenRequest={open} t={t} />)
    expect(screen.getByText('由 人物建模大师 #1186 派出')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '回到 #1186 ↩' }))
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ scopeId: memberId, seq: 1186 }))
  })

  it('tabs: in the member\'s own lens the caller is 主对话', () => {
    const own = scope('sub-explore', { ...explore, label: '探索', delegatedBy: { turnSeq: 14, scopeId: 'main', seq: 1, requestNumber: 1186 }, cliSubagent: { parentScopeId: 'main', name: '探索', callId: 'call-1' } })
    render(<AgentTabs scopes={[main, own]} value="sub-explore" onSelect={vi.fn()} onOpenRequest={vi.fn()} t={t} />)
    expect(screen.getByText('由 主对话 #1186 派出')).toBeTruthy()
  })

  it('the caller request\'s 「派出 X →」 opens the subagent view', () => {
    const openScope = vi.fn()
    render(<SpawnLinks spawns={member.requests[0]!.spawns} onOpenScope={openScope} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '派出 探索 →' }))
    expect(openScope).toHaveBeenCalledWith('sub-explore')
  })

  it('timing: one more lane 「› 探索」 with dashed marks at its run\'s ends; the member\'s call is titled 等 探索', () => {
    const timing: TurnTiming = {
      turnSeq: -100, startedAt: 0, totalMs: 1000,
      buckets: { waitMs: 0, reasoningMs: 0, toolArgsMs: 0, textMs: 0, toolExecMs: 520, otherMs: 0 },
      lanes: [
        { kind: 'other', requestSeq: 1186, scopeId: memberId, startedAt: 100, durationMs: 150 },
        { kind: 'tool-exec', requestSeq: 1186, scopeId: memberId, startedAt: 260, durationMs: 520, tool: 'Agent', callId: 'call-1' },
        { kind: 'other', requestSeq: 3, scopeId: 'sub-explore', startedAt: 270, durationMs: 400 },
      ],
      tools: [{ tool: 'Agent', calls: 1, totalMs: 520, argsMs: 0 }],
    }
    const { container } = render(<TimingView timing={timing} scopes={[member, explore]} filterScopeId={memberId} filterIsSubagent config={undefined} onOpenRequest={vi.fn()} t={t} />)
    expect(screen.getByRole('button', { name: '› 探索' })).toBeTruthy()
    expect(container.querySelectorAll('i[class*="link"]')).toHaveLength(2)
    expect(container.querySelector('[title*="Agent · 等 探索"]')).toBeTruthy()
  })

  it('the session map draws the subagent\'s requests in its caller\'s turn, outlined', () => {
    const data: SessionTrend = {
      turns: [{ sessionId: 's', turnSeq: 14, hostTurn: 14, query: 'q', startedAt: 0, requestCount: 3, scopeCount: 2, failedScopeCount: 0, totalInputTokens: 3000, totalOutputTokens: 30 }],
      backfill: { state: 'complete' },
      requests: [{ ...row(1, 'main'), turnSeq: 14 }, { ...row(2, 'main'), turnSeq: 14 }, { ...row(3, 'sub-explore', { spawnedFrom: 'main' }), turnSeq: 14 }],
    }
    const { container } = render(<Trend data={data} turnSeq={14} selectedSeq={null} scopeId="main" scopeLabel="主对话" onSelect={vi.fn()} t={t} />)
    const bars = [...container.querySelectorAll('span[class*="trendBar"]')]
    expect(bars).toHaveLength(3)
    expect(bars.map(bar => bar.getAttribute('data-sub'))).toEqual([null, null, 'true'])
  })

  it('the turn menu row says the subagents\' part of the totals', () => {
    const turn: TurnListItem = { sessionId: 's', turnSeq: 14, hostTurn: 14, query: '找穿模点', startedAt: 0, requestCount: 11, scopeCount: 2, failedScopeCount: 0,
      totalInputTokens: 300_000, totalOutputTokens: 4_000, subagents: { requestCount: 5, inputTokens: 120_000, outputTokens: 1_500 } }
    render(<TurnMenu turns={[turn]} turnSeq={14} onSelect={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '切换 turn' }))
    expect(screen.getByText(/其中子智能体 5 请求/)).toBeTruthy()
  })
})
