// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConfigFacts, ScopeConfigs, configRuns } from '../src/client/ConfigFacts.tsx'
import { CacheFacts } from '../src/client/RequestFacts.tsx'
import { prefixTextChange } from '../src/prefix-diff.ts'
import type { AgentScopeOverview, CapturedRequest, RequestListItem } from '../src/types.ts'
import type { InspectorTabProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
const t = ((key: keyof typeof zh, params?: Record<string, string>) => zh[key].replace(/\{(\w+)\}/g, (s, k: string) => params?.[k] ?? s)) as InspectorTabProps['t']
afterEach(cleanup)
const row = (seq: number, config?: RequestListItem['config']): RequestListItem => ({ seq, scopeId: 'main', startedAt: seq, status: 'ok', responseSummary: { kind: 'text' }, totalChars: 0, ...config === undefined ? {} : { config } })
const a = { model: 'model-a', provider: 'provider', reasoningEffort: 'high', maxTokens: 4096, temperature: 0 }
const b = { ...a, model: 'model-b', reasoningEffort: 'low', maxTokens: 8192 }
describe('per-request configuration', () => {
  it('shows explicit values including zero, without inventing missing defaults', () => {
    const { rerender } = render(<ConfigFacts config={a} t={t} />)
    expect(screen.getByText('4,096 tok')).toBeTruthy()
    expect(screen.getByText('high')).toBeTruthy()
    expect(screen.getByText('0')).toBeTruthy()
    rerender(<ConfigFacts t={t} />)
    expect(screen.getAllByText('未记录')).toHaveLength(3)
  })
  it('preserves chronological A → B → A switches and unknown snapshots', () => {
    const requests = [row(1, a), row(2, a), row(3, b), row(4, a), row(5)]
    expect(configRuns([...requests].reverse()).map(r => r.requests.map(q => q.seq))).toEqual([[1, 2], [3], [4], [5]])
    const scope: AgentScopeOverview = { scopeId: 'main', scopeSeq: 1, kind: 'main', status: 'ok', config: b, startedAt: 0, requests }
    const open = vi.fn()
    render(<ScopeConfigs scope={scope} onOpenRequest={open} t={t} />)
    expect(screen.getAllByText('model-a')).toHaveLength(2)
    expect(screen.getAllByText('model-b')).toHaveLength(1)
    expect(screen.getAllByText('未记录')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: '查看请求 #3 的配置' }))
    expect(open).toHaveBeenCalledWith(3, 'main')
  })
})
describe('cache comparison explanation', () => {
  const r = { seq: 1, config: {}, timing: {}, segments: { system: [], tools: [], history: [], added: [] }, usage: { inputTokens: 500, cacheReadTokens: 16128, outputTokens: 2 } } as unknown as CapturedRequest
  it('shows a normal baseline while retaining measured cache usage', () => {
    render(<CacheFacts request={r} t={t} />)
    expect(screen.getByText(/比较起点/)).toBeTruthy()
    expect(screen.getByText(/缓存命中 16,128/)).toBeTruthy()
    expect(screen.queryByText(/无法比较/)).toBeNull()
  })
  it('highlights only the changed range, not the shared opening', () => {
    const text = prefixTextChange('You are an AI agent. You are a coding agent.', 'You are an AI agent.')
    const request = { ...r, prefix: { previousSeq: 0, gapMs: 0, toolsChanged: false, changed: { index: 0, before: '', after: '', text } } }
    const { container } = render(<CacheFacts request={request} t={t} />)
    expect(container.querySelector('del')?.textContent).toBe(' You are a coding agent.')
    expect(container.querySelector('ins')).toBeNull()
    expect(screen.getByText(/变更范围从第 21 个字符开始/)).toBeTruthy()
  })
})
