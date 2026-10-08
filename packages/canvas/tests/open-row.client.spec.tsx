// @vitest-environment jsdom
/**
 * The canvas_open row in the conversation: it reads the call's own answer,
 * follows a switch it watched land (opens that canvas once), leaves a history
 * row alone apart from its door, and offers no door for a listing or failure.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CanvasDetailProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { OpenCanvasRow } from '../src/client/open/OpenCanvasRow.tsx'
import { openRowModel } from '../src/client/open/open-row.ts'

const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as CanvasDetailProps['t']

const CREATED = '完成：已新建画布《雨夜》（canvas_t1abcdefgh）并切过去。接下来用 canvas_write 落卡。'
const SWITCHED = '完成：已切到画布《雨夜》（canvas_t1abcdefgh）——已有同名画布，没有新建；确要另建一块就换个标题。'
const settled = (text: string, isError = false) => ({ kind: 'tool-result', content: [{ type: 'text', text }], isError })

afterEach(() => { cleanup() })

describe('openRowModel', () => {
  it('reads created and switched answers with their canvas', () => {
    expect(openRowModel(settled(CREATED))).toMatchObject({ state: 'created', title: '雨夜', canvasId: 'canvas_t1abcdefgh' })
    expect(openRowModel(settled(SWITCHED))).toMatchObject({ state: 'switched', title: '雨夜', canvasId: 'canvas_t1abcdefgh' })
  })

  it('is running until settled; a listing is listed, a 失败 answer failed', () => {
    expect(openRowModel({}).state).toBe('running')
    expect(openRowModel(settled('画布（2 块，最近活动在前）：')).state).toBe('listed')
    expect(openRowModel(settled('失败：没有叫「x」的画布。')).state).toBe('failed')
  })
})

describe('OpenCanvasRow', () => {
  it('opens the canvas once when it watched the call settle', () => {
    const openCanvas = vi.fn()
    const { rerender } = render(<OpenCanvasRow t={t} block={{}} phase="preparing" openCanvas={openCanvas} />)
    expect(openCanvas).not.toHaveBeenCalled()
    rerender(<OpenCanvasRow t={t} block={settled(CREATED)} openCanvas={openCanvas} />)
    rerender(<OpenCanvasRow t={t} block={settled(CREATED)} openCanvas={openCanvas} />)
    expect(openCanvas).toHaveBeenCalledTimes(1)
    expect(openCanvas).toHaveBeenCalledWith('canvas_t1abcdefgh')
    expect(screen.getByText('新建了《雨夜》')).toBeTruthy()
  })

  it('leaves a history row alone, but its door still opens the canvas', () => {
    const openCanvas = vi.fn()
    render(<OpenCanvasRow t={t} block={settled(SWITCHED)} openCanvas={openCanvas} />)
    expect(openCanvas).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: zh['openrow.open'] }))
    expect(openCanvas).toHaveBeenCalledWith('canvas_t1abcdefgh')
  })

  it('offers no door for a listing or a failure', () => {
    const { rerender } = render(<OpenCanvasRow t={t} block={settled('画布（2 块）：')} openCanvas={vi.fn()} />)
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<OpenCanvasRow t={t} block={settled('失败：《旧稿》已归档（只读）。')} openCanvas={vi.fn()} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('《旧稿》已归档（只读）。')).toBeTruthy()
  })
})
