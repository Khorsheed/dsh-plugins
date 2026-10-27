// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Exchange, OutputBlock } from '../src/client/SegmentBlocks.tsx'
import { TokenView } from '../src/client/TokenView.tsx'
import { zh } from '../src/client/locales.ts'
import type { CapturedRequest } from '../src/types.ts'
import type { InspectorTabProps } from '../src/client/contract.ts'
const t = ((key: keyof typeof zh, params?: Record<string, string>) => zh[key].replace(/\{(\w+)\}/g, (s, k: string) => params?.[k] ?? s)) as InspectorTabProps['t']
const request: CapturedRequest = {
  seq: 198, requestNumber: 8, sessionId: 's', scopeId: 'main', startedAt: 0, status: 'ok', config: {}, timing: {},
  responseSummary: { kind: 'tool', name: 'library_write' },
  response: { toolCalls: [
    { callId: 'a', name: 'library_write', arguments: '{"title":"example"}', execution: { status: 'ok', result: 'earlier success' } },
    { callId: 'b', name: 'library_write', arguments: '{}', execution: { status: 'failed', result: 'Missing required field: title\n' + 'error detail '.repeat(100) } },
  ] },
  segments: { system: [], tools: [], history: [], added: [
    { index: 1, category: 'tool-result', source: 'library_write', toolCallId: 'previous', sourceRequestNumber: 7, full: '{"ok":true}', preview: '{"ok":true}', chars: 11, freshness: 'new' },
  ] },
}
afterEach(cleanup)
describe('tool execution detail', () => {
  it('shows failure text immediately, keeps success collapsed and expands each independently', () => {
    const { container } = render(<OutputBlock request={request} t={t} />)
    expect(screen.getByText('执行失败')).toBeTruthy()
    expect(screen.getByText(/Missing required field/)).toBeTruthy()
    expect(screen.queryByText('earlier success')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /查看结果/ }))
    expect(screen.getByText('earlier success')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /展开全文/ }))
    expect(container.querySelectorAll('pre[data-open="true"]')).toHaveLength(2)
    expect(screen.queryByText('请求失败')).toBeNull()
  })
  it('distinguishes running, unrecorded, missing body and empty recorded results', () => {
    const r: CapturedRequest = { ...request, response: { toolCalls: [
      { name: 'unknown', arguments: '{}' },
      { name: 'running', arguments: '{}', execution: { status: 'running' } },
      { name: 'missing', arguments: '{}', execution: { status: 'failed' } },
      { name: 'empty', arguments: '{}', execution: { status: 'ok', result: '' } },
    ] } }
    render(<OutputBlock request={r} t={t} />)
    expect(screen.getByText('结果未记录')).toBeTruthy()
    expect(screen.getByText('执行中')).toBeTruthy()
    expect(screen.getByText('已记录执行状态，未保留结果正文。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看结果 · 0 字符' }))
    expect(screen.getByText('（空结果）')).toBeTruthy()
  })
  it('labels input result provenance without moving it into the current call', () => {
    render(<Exchange request={request} previousResponseNumber={7} t={t} />)
    expect(screen.getByText('library_write · ← #7 的调用')).toBeTruthy()
    expect(screen.getByText('{"ok":true}')).toBeTruthy()
    expect(screen.getByText(/Missing required field/)).toBeTruthy()
  })
  it('names the sidebar failure as a tool failure, not a model request failure', () => {
    render(<TokenView scope={{ scopeId: 'main', scopeSeq: 1, kind: 'main', status: 'ok', config: {}, startedAt: 0,
      requests: [{ seq: request.seq, requestNumber: 8, scopeId: 'main', status: 'ok', responseSummary: request.responseSummary, startedAt: 0, totalChars: 11, toolErrors: 1, usage: { inputTokens: 100, outputTokens: 20 } }],
    }} request={request} selectedSeq={request.seq} filterCat={null} previousResponseNumber={7} onSelect={() => {}} onToggleFilter={() => {}} t={t} />)
    expect(screen.getByText('工具失败 1')).toBeTruthy()
    expect(screen.queryByText('报错 1')).toBeNull()
    expect(screen.queryByText('请求失败')).toBeNull()
  })
  it('never labels a settled row without usage as failed — only a failed status earns the label', () => {
    // A mirrored pure-thinking segment carries no usage; calling it 请求失败 is a false alarm.
    render(<TokenView scope={{ scopeId: 'main', scopeSeq: 1, kind: 'main', status: 'ok', config: {}, startedAt: 0,
      requests: [
        { seq: 1, requestNumber: 1, scopeId: 'main', status: 'ok', responseSummary: { kind: 'reasoning' }, startedAt: 0, totalChars: 0 },
        { seq: 2, requestNumber: 2, scopeId: 'main', status: 'failed', responseSummary: { kind: 'none' }, startedAt: 0, totalChars: 0 },
      ],
    }} request={null} selectedSeq={1} filterCat={null} previousResponseNumber={null} onSelect={() => {}} onToggleFilter={() => {}} t={t} />)
    const thinkingRow = screen.getByRole('button', { name: '#1 · 思考' })
    expect(thinkingRow.textContent).not.toContain('请求失败')
    expect(thinkingRow.textContent).toContain('—')
    expect(screen.getByRole('button', { name: '#2 · —' }).textContent).toContain('请求失败')
  })
})

describe('ask_user_question card', () => {
  it('shows the question, the options with the chosen one marked, the answer, the other text and the wait', () => {
    const r: CapturedRequest = { ...request, response: { toolCalls: [{
      callId: 'q', name: 'mcp__dsh-member__ask_user_question', arguments: '',
      execution: { status: 'ok', result: '{"answers":[]}' },
      ask: {
        outcome: 'answered', late: true, waitMs: 12900, source: 'room',
        questions: [{ id: 'style', header: '美术方向', question: '整体风格往哪走？', options: [{ label: '水墨绘本（推荐）', description: '线条清楚' }, { label: '写实' }] }],
        answers: [{ id: 'style', selected: ['水墨绘本（推荐）'], custom: '再粗一点' }],
      },
    }] } }
    const { container } = render(<OutputBlock request={r} t={t} />)
    expect(screen.getByText('问你')).toBeTruthy()
    expect(screen.getByText('已补答')).toBeTruthy()
    expect(screen.getByText('等了 12.9s')).toBeTruthy()
    expect(screen.getByText('美术方向')).toBeTruthy()
    expect(screen.getByText('整体风格往哪走？')).toBeTruthy()
    expect(container.querySelector('li[data-selected="true"]')?.textContent).toContain('水墨绘本（推荐）')
    expect(screen.getByText('你的回答')).toBeTruthy()
    expect(screen.getByText('其他：再粗一点')).toBeTruthy()
    // The raw JSON result is not shown in its place.
    expect(screen.queryByText('{"answers":[]}')).toBeNull()
  })

  it('an expired question reads as still answerable; a question with no recorded text says so', () => {
    const r: CapturedRequest = { ...request, response: { toolCalls: [
      { callId: 'e', name: 'ask_user_question', arguments: '', ask: { outcome: 'expired' } },
    ] } }
    render(<OutputBlock request={r} t={t} />)
    expect(screen.getByText('已过期，仍可回答')).toBeTruthy()
    expect(screen.getByText('这次调用没有记录问题内容')).toBeTruthy()
  })
})
