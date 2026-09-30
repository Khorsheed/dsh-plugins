// @vitest-environment jsdom
/**
 * The canvas_propose_type row in the conversation: it reads the call's own
 * answer, opens the canvas that answer names, and offers no door while the
 * call runs, when it failed, or when the answer predates the canvas id.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CanvasDetailProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { ProposeTypeRow } from '../src/client/type/ProposeTypeRow.tsx'
import { proposeRowModel } from '../src/client/type/propose-row.ts'

const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as CanvasDetailProps['t']

const ANSWER = '完成：cat_person（人物）的类型提议已放到类型页（画布 canvas_t1abcdefgh），5 个字段，等用户采用。'
const settled = (text: string, isError = false) => ({ kind: 'tool-result', content: [{ type: 'text', text }], isError })

afterEach(() => { cleanup() })

describe('proposeRowModel', () => {
  it('reads the kind, the category and the canvas out of the answer', () => {
    expect(proposeRowModel(settled(ANSWER))).toMatchObject({
      state: 'ready', kind: 'cat_person', label: '人物', canvasId: 'canvas_t1abcdefgh',
    })
  })

  it('is running until the block settles, on either host line', () => {
    expect(proposeRowModel({}).state).toBe('running')
    expect(proposeRowModel({}, 'start').state).toBe('running')
  })

  it('names a failure, and an answer without a canvas is unreadable', () => {
    expect(proposeRowModel(settled('失败：没有这个分类', true))).toMatchObject({ state: 'failed', text: '失败：没有这个分类' })
    expect(proposeRowModel(settled('完成：cat_person（人物）的类型提议已放到类型页，5 个字段，等用户采用。')).state).toBe('unreadable')
  })
})

describe('ProposeTypeRow', () => {
  it('opens the named canvas on the kind’s type page', () => {
    const openType = vi.fn()
    render(<ProposeTypeRow t={t} block={settled(ANSWER)} openType={openType} />)
    fireEvent.click(screen.getByRole('button', { name: zh['toolview.open'] }))
    expect(openType).toHaveBeenCalledWith('canvas_t1abcdefgh', 'cat_person', '人物')
  })

  it('offers no door while running or after a failure', () => {
    const { rerender } = render(<ProposeTypeRow t={t} block={{}} phase="preparing" openType={vi.fn()} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(zh['toolview.running'])).toBeTruthy()
    rerender(<ProposeTypeRow t={t} block={settled('失败：没有这个分类', true)} openType={vi.fn()} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('失败：没有这个分类')).toBeTruthy()
  })
})
