// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { SegmentBlocks } from '../src/client/SegmentBlocks.tsx'
import { ToolCatalog } from '../src/client/ToolCatalog.tsx'
import type { CapturedRequest, SegmentItem } from '../src/types.ts'
import type { InspectorTabProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
const t = ((key: keyof typeof zh, params?: Record<string, string>) => zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as InspectorTabProps['t']
const originalScroll = Element.prototype.scrollIntoView
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); if (originalScroll) Element.prototype.scrollIntoView = originalScroll; else Reflect.deleteProperty(Element.prototype, 'scrollIntoView') })
const message = (index: number, category: SegmentItem['category'] = 'user'): SegmentItem => ({ index, category, source: 'test', preview: `preview-${index}`, full: `Body ${index}\n${'Long prose line.\n'.repeat(60)}`, chars: 1000, freshness: 'new' })
const request = { seq: 1, scopeId: 'main', sessionId: 's', status: 'ok', startedAt: 0, config: {}, timing: {}, segments: { system: [], tools: [], history: [], added: [message(1), message(2, 'assistant'), message(3)] } } satisfies CapturedRequest
const summary = (text: string) => screen.getByText(text).closest('summary')!
describe('composition reading', () => {
  it('links exact duplicates across categories and collapsed layers, then returns with focus', () => {
    const first = { ...message(1), source: 'user', sourceTurn: 1 }
    const second = { ...message(7, 'plugin-injection'), full: first.full }
    const third = { ...message(8, 'system'), full: first.full }
    const captured = { ...request, segments: { ...request.segments, system: [third], history: [second], added: [first] } }
    const scroll = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll })
    render(<SegmentBlocks request={captured} filterCat={null} previousResponseNumber={null} t={t} />)
    fireEvent.click(summary('preview-1'))
    expect(screen.getByText('user · 来源轮次 1')).toBeTruthy()
    expect(screen.getByText('×3')).toBeTruthy()
    expect(screen.getByRole('button', { name: '008 · 系统提示词 ↗' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '007 · 插件注入 ↗' }))
    expect(summary('preview-7').closest('details')?.open).toBe(true)
    expect(summary('preview-1').closest('details')?.open).toBe(false)
    expect(document.activeElement).toBe(summary('preview-7'))
    expect(summary('preview-7').closest('details')?.dataset.jump).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '008 · 系统提示词 ↗' }))
    expect(document.activeElement).toBe(summary('preview-8'))
    fireEvent.click(screen.getByRole('button', { name: '返回 007 ↩' }))
    expect(document.activeElement).toBe(summary('preview-7'))
    fireEvent.click(screen.getByRole('button', { name: '返回 001 ↩' }))
    expect(document.activeElement).toBe(summary('preview-1'))
    expect(screen.queryByRole('button', { name: /返回/ })).toBeNull()
    expect(scroll).toHaveBeenCalled()
  })
  it('reveals a duplicate hidden by a category filter, and leaves duplicates-only filtering intact', () => {
    const first = message(1)
    const second = { ...message(7, 'plugin-injection'), full: first.full }
    const captured = { ...request, segments: { ...request.segments, history: [second], added: [first] } }
    const clear = vi.fn()
    function Filtered() {
      const [filter, setFilter] = useState<'user' | null>('user')
      return <SegmentBlocks request={captured} filterCat={filter} onClearFilter={() => { clear(); setFilter(null) }} previousResponseNumber={null} t={t} />
    }
    const view = render(<Filtered />)
    fireEvent.click(summary('preview-1'))
    expect(screen.queryByText('preview-7')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '007 · 插件注入 ↗' }))
    expect(clear).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(summary('preview-7'))
    view.unmount(); clear.mockClear()
    render(<SegmentBlocks request={captured} filterCat="__dup" onClearFilter={clear} previousResponseNumber={null} t={t} />)
    fireEvent.click(summary('preview-1'))
    fireEvent.click(screen.getByRole('button', { name: '007 · 插件注入 ↗' }))
    expect(clear).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(summary('preview-7'))
  })
  it('never links short repeated text or matching previews with different full content', () => {
    const short = { ...message(1), full: 'short' }
    const shortCopy = { ...message(2), full: 'short' }
    const samePreview = { ...message(3), preview: short.preview }
    render(<SegmentBlocks request={{ ...request, segments: { ...request.segments, added: [short, shortCopy, samePreview] } }} filterCat={null} previousResponseNumber={null} t={t} />)
    fireEvent.click(screen.getAllByText('preview-1')[0]!.closest('summary')!)
    expect(screen.queryByText('全文一致')).toBeNull()
    expect(screen.queryByText('×2')).toBeNull()
  })
  it('jumps directly to the next visible message and preserves filter order', () => {
    const scroll = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scroll })
    const { rerender } = render(<SegmentBlocks request={request} filterCat={null} previousResponseNumber={null} t={t} />)
    expect(screen.queryByText(/Body 1/)).toBeNull()
    fireEvent.click(summary('preview-1'))
    expect(screen.getByText(/Body 1/).textContent).toBe(request.segments.added[0]!.full)
    fireEvent.click(screen.getByRole('button', { name: /下一条/ }))
    expect(screen.queryByText(/Body 1/)).toBeNull()
    expect(screen.getByText(/Body 2/)).toBeTruthy()
    expect(document.activeElement).toBe(summary('preview-2'))
    expect(scroll).toHaveBeenCalled()
    rerender(<SegmentBlocks request={request} filterCat="user" previousResponseNumber={null} t={t} />)
    fireEvent.click(summary('preview-1'))
    fireEvent.click(screen.getByRole('button', { name: /下一条/ }))
    expect(screen.getByText(/Body 3/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /下一条/ }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText(/Body 2/)).toBeNull()
  })
  it('keeps unusual parameter schemas intact and supports structured/raw toggling', () => {
    const parameters = JSON.stringify({ type: 'object', properties: { path: { type: 'string', description: 'File path', minLength: 1 }, mode: { anyOf: [{ const: 'read' }, { const: 'write' }] }, flag: false }, required: ['path'], additionalProperties: false })
    render(<ToolCatalog tools={[{ name: 'read', description: 'Read a file', parameters, chars: 450, added: false }]} t={t} />)
    fireEvent.click(summary('read'))
    expect(screen.getByText('必填')).toBeTruthy()
    expect(screen.getByText('File path')).toBeTruthy()
    expect(screen.getByText('最短长度')).toBeTruthy()
    expect(screen.getByText('至少满足一个分支')).toBeTruthy()
    expect(screen.getByText('不接受任何值')).toBeTruthy()
    expect(screen.getByText('不允许')).toBeTruthy()
    expect(document.querySelector('pre')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '原始 JSON' }))
    expect(screen.getByText(parameters).textContent).toBe(parameters)
    fireEvent.click(screen.getByRole('button', { name: '结构化' }))
    expect(screen.getByText('File path')).toBeTruthy()
  })
  it('keeps raw capture behind its toggle, even for malformed or boolean schemas', () => {
    const tools = ['{truncated', 'false', '{"oneOf":[{"type":"string"},{"type":"number"}]}'].map((parameters, index) => ({ name: `tool-${index}`, description: 'Schema', parameters, chars: parameters.length, added: false }))
    render(<ToolCatalog tools={tools} t={t} />)
    for (const tool of tools) {
      const head = summary(tool.name)
      expect(within(head).queryByText(/参数/)).toBeNull()
      fireEvent.click(head)
      const row = head.closest('details')!
      expect(row.querySelector('pre')).toBeNull()
      fireEvent.click(within(row).getByRole('button', { name: '原始 JSON' }))
      expect(within(row).getByText(tool.parameters).textContent).toBe(tool.parameters)
    }
  })
  it('copies the complete original capture, including whitespace, and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const parameters = ' {\n "description": "' + '原始内容 '.repeat(500) + '"\n} '
    render(<ToolCatalog tools={[{ name: 'copy-tool', description: 'Tool description', parameters, chars: parameters.length, added: false }]} t={t} />)
    fireEvent.click(summary('copy-tool'))
    fireEvent.click(screen.getByRole('button', { name: '原始 JSON' }))
    const codeRegion = screen.getByRole('region', { name: '原始 JSON' })
    expect(codeRegion.querySelector('pre')?.textContent).toBe(parameters)
    fireEvent.click(within(codeRegion).getByRole('button', { name: '复制 JSON' }))
    await waitFor(() => expect(within(codeRegion).getByRole('status').textContent).toBe('已复制'))
    expect(writeText).toHaveBeenCalledWith(parameters)
  })
  it('reports blocked clipboard access without hiding the raw text and permits retry', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('Permission denied')).mockResolvedValueOnce(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(<ToolCatalog tools={[{ name: 'blocked-copy', description: '', parameters: '{truncated', chars: 10, added: false }]} t={t} />)
    fireEvent.click(summary('blocked-copy'))
    fireEvent.click(screen.getByRole('button', { name: '原始 JSON' }))
    fireEvent.click(screen.getByRole('button', { name: '复制 JSON' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('复制失败，请手动选择内容'))
    expect(document.querySelector('pre')?.textContent).toBe('{truncated')
    fireEvent.click(screen.getByRole('button', { name: '复制 JSON' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('已复制'))
    expect(writeText).toHaveBeenCalledTimes(2)
  })
})


describe('recursive tool definitions', () => {
  const show = (schema: unknown) => {
    const parameters = JSON.stringify(schema)
    const view = render(<ToolCatalog tools={[{ name: 'library_binding', description: 'Bind the session', parameters, chars: parameters.length, added: false }]} t={t} />)
    fireEvent.click(summary('library_binding'))
    return view
  }
  it('reads nullable objects and nested arrays without raw blocks or duplicate required lists', () => {
    const { container } = show({ type: 'object', properties: { binding: { description: 'A binding or null', oneOf: [
      { type: 'object', additionalProperties: true, properties: { project: { type: 'string', description: 'Project id' }, resource: { type: 'string' }, targets: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } }, required: ['project'] },
      { type: 'null' },
    ] } }, required: ['binding'] })
    expect(screen.getByText('object | null')).toBeTruthy()
    expect(screen.getByText('恰好满足一个分支')).toBeTruthy()
    expect(screen.getByText('数组元素')).toBeTruthy()
    expect(screen.getByText('Project id')).toBeTruthy()
    expect(screen.getAllByText('必填')).toHaveLength(3)
    expect(container.textContent).not.toContain('required')
    expect(container.textContent).not.toContain('完整约束')
    expect(container.querySelector('pre')).toBeNull()
    expect(screen.getByText('额外字段')).toBeTruthy()
  })
  it('keeps union/allOf distinctions, root types, orphan required fields and extension metadata', () => {
    const { container } = show({ type: ['object', 'null'], properties: { item: { allOf: [{ type: 'number', minimum: 1 }, { maximum: 5 }] } }, required: ['undeclared'], constructor: 'extension metadata', 'x-extra': { options: ['a', 'b'], enabled: true }, additionalProperties: false })
    expect(screen.getByText('object | null')).toBeTruthy()
    expect(screen.getByText('同时满足所有分支')).toBeTruthy()
    expect(screen.getByText('最小值')).toBeTruthy()
    expect(screen.getByText('最大值')).toBeTruthy()
    expect(screen.getByText('其他必填字段')).toBeTruthy()
    expect(screen.getByText('"undeclared"')).toBeTruthy()
    expect(screen.getByText('x-extra')).toBeTruthy()
    expect(screen.getByText('constructor')).toBeTruthy()
    expect(screen.getByText('"b"')).toBeTruthy()
    expect(screen.getByText('不允许')).toBeTruthy()
    expect(container.querySelector('pre')).toBeNull()
  })
  it('leaves references explicit and bounds deeply nested rendering with a raw escape hatch', () => {
    let nested: unknown = { type: 'string' }
    for (let i = 0; i < 20; i++) nested = { type: 'object', properties: { child: nested } }
    const { container } = show({ type: 'object', properties: { tree: nested, ref: { $ref: '#/$defs/node' } }, $defs: { node: { $ref: '#/$defs/node' } } })
    expect(screen.getAllByText('"#/$defs/node"')).toHaveLength(2)
    expect(screen.getByText(/更深层的定义请查看原始 JSON/)).toBeTruthy()
    expect(container.querySelector('pre')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '原始 JSON' }))
    expect(container.querySelector('pre')?.textContent).toContain('"type":"string"')
  })
})

describe('pruned result provenance', () => {
  it('shows the count change and navigates to an existing original without including it in totals', () => {
    const open = vi.fn()
    const item: SegmentItem = { ...message(1, 'tool-result'), full: 'short', chars: 5, pruning: { beforeChars: 5000, afterChars: 5, before: { turnSeq: 1, scopeId: 'main', seq: 7 } } }
    render(<SegmentBlocks request={{ ...request, segments: { ...request.segments, added: [item] } }} filterCat={null} previousResponseNumber={null} onOpenRequest={open} t={t} />)
    expect(screen.getByText('已裁剪')).toBeTruthy()
    fireEvent.click(summary('preview-1'))
    expect(screen.getByText('已裁剪 · 5,000 → 5 字符')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看裁剪前请求 ↗' }))
    expect(open).toHaveBeenCalledWith({ turnSeq: 1, scopeId: 'main', seq: 7 })
    expect(screen.queryByText('5000')).toBeNull()
  })
})
