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

describe('agent tabs', () => {
  it('groups views, folds a long group behind +N, and keeps the selected one visible', () => {
    const subs = Array.from({ length: 9 }, (_, i) => scope(`s${i}`, { label: `子任务${i}`, provider: 'dsh-cli', delegatedBy: { turnSeq: 1, scopeId: 'main', seq: 1, requestNumber: 30 + i } }))
    const external = scope('codex', { label: 'Codex', provider: 'codex-local' })
    const compaction = scope('compaction:-1', { kind: 'compaction', compaction: { replacedCount: 29, after: { turnSeq: 1, scopeId: 'main', seq: 1, requestNumber: 23 } } })
    const select = vi.fn(), open = vi.fn()
    const { rerender } = render(<AgentTabs scopes={[main, external, ...subs, compaction]} value="main" onSelect={select} onOpenRequest={open} t={t} />)
    expect(screen.getByText('外部 agent')).toBeTruthy()
    expect(screen.getAllByRole('tab').map(tab => tab.getAttribute('title'))).toEqual(['主对话', 'Codex', '子任务0', '子任务1', '压缩'])
    expect(screen.getByText('主对话 · 本轮 1 个请求 · 子会话 10 个 · 压缩 1 次')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '+9' }))
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(9)
    expect(options[5]!.textContent).toContain('#35')
    fireEvent.click(options[5]!)
    expect(select).toHaveBeenCalledWith('s5')
    rerender(<AgentTabs scopes={[main, external, ...subs, compaction]} value="s5" onSelect={select} onOpenRequest={open} t={t} />)
    expect(screen.getAllByRole('tab').map(tab => tab.getAttribute('title'))).toContain('子任务5')
    expect(screen.getByText('由主对话 #35 委派')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '回到 #35 ↩' }))
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ requestNumber: 35 }))
    rerender(<AgentTabs scopes={[main, external, ...subs, compaction]} value="compaction:-1" onSelect={select} onOpenRequest={open} t={t} />)
    expect(screen.getByText('压缩了 29 条消息')).toBeTruthy()
    expect(screen.getByText('发生在 #23 之后')).toBeTruthy()
    rerender(<AgentTabs scopes={[main, external]} value="codex" onSelect={select} onOpenRequest={open} t={t} />)
    expect(screen.getByText('外部 agent · codex-local')).toBeTruthy()
    expect(screen.getByText('不是由工具调用委派的')).toBeTruthy()
  })

  it('names the parent of a session opened on its own', () => {
    render(<ParentLine parent={{ sessionId: 'session-room', title: '邀请Claude、Kimi和Codex打招呼', hostTurn: 1, label: 'Codex' }} t={t} />)
    expect(screen.getByText('邀请Claude、Kimi和Codex打招呼')).toBeTruthy()
    expect(screen.getByText('· 第 1 轮')).toBeTruthy()
    expect(screen.getByText('· 以「Codex」加入')).toBeTruthy()
  })
})
