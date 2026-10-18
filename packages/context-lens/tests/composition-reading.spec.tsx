// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { SegmentBlocks } from '../src/client/SegmentBlocks.tsx'
import { ToolCatalog } from '../src/client/ToolCatalog.tsx'
import type { CapturedRequest, SegmentItem } from '../src/types.ts'
import type { InspectorTabProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
const t = ((key: keyof typeof zh, params?: Record<string, string>) => zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as InspectorTabProps['t']
const originalScroll = Element.prototype.scrollIntoView
afterEach(() => { cleanup(); vi.restoreAllMocks(); if (originalScroll) Element.prototype.scrollIntoView = originalScroll; else Reflect.deleteProperty(Element.prototype, 'scrollIntoView') })
const message = (index: number, category: SegmentItem['category'] = 'user'): SegmentItem => ({ index, category, source: 'test', preview: `preview-${index}`, full: `Body ${index}\n${'Long prose line.\n'.repeat(60)}`, chars: 1000, freshness: 'new' })
const request = { seq: 1, scopeId: 'main', sessionId: 's', status: 'ok', startedAt: 0, config: {}, timing: {}, segments: { system: [], tools: [], history: [], added: [message(1), message(2, 'assistant'), message(3)] } } satisfies CapturedRequest
const summary = (text: string) => screen.getByText(text).closest('summary')!
describe('composition reading', () => {
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
    expect(screen.getByText(/"minLength": 1/)).toBeTruthy()
    expect(screen.getByText(/"anyOf"/)).toBeTruthy()
    expect(screen.getByText('false')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '原始 JSON' }))
    expect(screen.getByText(parameters).textContent).toBe(parameters)
    fireEvent.click(screen.getByRole('button', { name: '结构化' }))
    expect(screen.getByText('File path')).toBeTruthy()
  })
  it('shows malformed, boolean and unrecognized schemas verbatim without inventing a parameter count', () => {
    const tools = ['{truncated', 'false', '{"oneOf":[{"type":"string"},{"type":"number"}]}'].map((parameters, index) => ({ name: `tool-${index}`, description: 'Schema', parameters, chars: parameters.length, added: false }))
    render(<ToolCatalog tools={tools} t={t} />)
    for (const tool of tools) {
      const head = summary(tool.name)
      expect(within(head).queryByText(/参数/)).toBeNull()
      fireEvent.click(head)
      expect(screen.getByText(tool.parameters).textContent).toBe(tool.parameters)
    }
  })
})
