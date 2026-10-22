// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AgentTabs, ParentLine } from '../src/client/AgentTabs.tsx'
import type { AgentScopeOverview } from '../src/types.ts'
import type { InspectorTabProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
const t = ((key: keyof typeof zh, params?: Record<string, string>) => zh[key].replace(/\{(\w+)\}/g, (s, k: string) => params?.[k] ?? s)) as InspectorTabProps['t']
afterEach(cleanup)

const scope = (scopeId: string, extra: Partial<AgentScopeOverview> = {}): AgentScopeOverview =>
  ({ scopeId, scopeSeq: 1, kind: 'subagent', status: 'ok', config: {}, startedAt: 0, requests: [], ...extra })
const main = scope('main', { kind: 'main', requests: [{ seq: 1, requestNumber: 1, scopeId: 'main', status: 'ok', responseSummary: { kind: 'text' }, startedAt: 0, totalChars: 0 }] })
const titles = () => screen.getAllByRole('tab').map(tab => tab.getAttribute('title'))

describe('agent tabs', () => {
  it('shows the turn participants flat, with no grouping and no explanatory text', () => {
    const codex = scope('codex', { label: 'Codex', provider: 'codex-local', startedAt: 2 })
    const sub = scope('s1', { label: '查资料', provider: 'dsh-cli', startedAt: 1, delegatedBy: { turnSeq: 1, scopeId: 'main', seq: 1, requestNumber: 3 } })
    const compaction = scope('compaction:-1', { kind: 'compaction', compaction: { replacedCount: 29, after: { turnSeq: 1, scopeId: 'main', seq: 1, requestNumber: 23 } } })
    const open = vi.fn()
    const { rerender } = render(<AgentTabs scopes={[main, codex, sub, compaction]} value="main" onSelect={vi.fn()} onOpenRequest={open} t={t} />)
    expect(titles()).toEqual(['主对话', '查资料', 'Codex', '压缩'])
    expect(screen.queryByText(/外部 agent|子 agent|codex-local/)).toBeNull()
    // The main conversation has no relation line.
    expect(screen.queryByText(/委派|压缩了/)).toBeNull()
    rerender(<AgentTabs scopes={[main, codex, sub, compaction]} value="s1" onSelect={vi.fn()} onOpenRequest={open} t={t} />)
    expect(screen.getByText('由主对话 #3 委派')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '回到 #3 ↩' }))
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ requestNumber: 3 }))
    rerender(<AgentTabs scopes={[main, codex, sub, compaction]} value="codex" onSelect={vi.fn()} onOpenRequest={open} t={t} />)
    expect(screen.queryByText(/委派|codex-local/)).toBeNull()
    rerender(<AgentTabs scopes={[main, codex, sub, compaction]} value="compaction:-1" onSelect={vi.fn()} onOpenRequest={open} t={t} />)
    expect(screen.getByText('压缩了 29 条消息')).toBeTruthy()
    expect(screen.getByText('发生在 #23 之后')).toBeTruthy()
  })

  it('folds participants past four behind +N and keeps the selected one visible', () => {
    const subs = Array.from({ length: 9 }, (_, i) => scope(`s${i}`, { label: `子任务${i}`, startedAt: i, delegatedBy: { turnSeq: 1, scopeId: 'main', seq: 1, requestNumber: 30 + i } }))
    const select = vi.fn()
    const { rerender } = render(<AgentTabs scopes={[main, ...subs]} value="main" onSelect={select} onOpenRequest={vi.fn()} t={t} />)
    expect(titles()).toEqual(['主对话', '子任务0', '子任务1', '子任务2'])
    fireEvent.click(screen.getByRole('button', { name: '+6' }))
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(9)
    expect(options[6]!.textContent).toContain('#36')
    fireEvent.click(options[6]!)
    expect(select).toHaveBeenCalledWith('s6')
    rerender(<AgentTabs scopes={[main, ...subs]} value="s6" onSelect={select} onOpenRequest={vi.fn()} t={t} />)
    expect(titles()).toEqual(['主对话', '子任务0', '子任务1', '子任务6'])
  })

  it('names the parent of a session opened on its own', () => {
    render(<ParentLine parent={{ sessionId: 'session-room', title: '邀请Claude、Kimi和Codex打招呼', hostTurn: 1, label: 'Codex' }} t={t} />)
    expect(screen.getByText('邀请Claude、Kimi和Codex打招呼')).toBeTruthy()
    expect(screen.getByText('· 第 1 轮')).toBeTruthy()
    expect(screen.getByText('· 以「Codex」加入')).toBeTruthy()
  })
})
