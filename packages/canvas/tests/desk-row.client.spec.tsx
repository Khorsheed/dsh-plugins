// @vitest-environment jsdom
/**
 * The room's row for a canvas a member opened there (proposal
 * 2026-10-29-room-desk): the Definition claims only well-formed
 * `canvas/desk-opened` events; a row seen arriving follows once — the
 * coordinator's into the sidebar, a member's onto the strip beside — and a
 * history row only offers its door.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CanvasDetailProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { DeskOpenRow } from '../src/client/open/DeskOpenRow.tsx'
import { deskRowDefinition, LIVE_WINDOW_MS, type DeskRowData } from '../src/client/open/desk-row.ts'

const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as CanvasDetailProps['t']

afterEach(() => { cleanup() })

const event = (seq: number, data: unknown, time = Date.now()) => ({ type: 'canvas/desk-opened', seq, time, data })
const row = (seq: number, role: 'coordinator' | 'member', time = Date.now()): DeskRowData =>
  ({ seq, time, canvasId: 'canvas_r', title: '雨夜', created: role === 'member', member: 'bill', role })

describe('deskRowDefinition', () => {
  it('claims well-formed desk events only, one node each', () => {
    const data = { version: 1, canvasId: 'canvas_r', title: '雨夜', created: true, member: 'bill', role: 'coordinator' }
    expect(deskRowDefinition.match(event(7, data))).toEqual({ id: 'desk-7', role: 'start' })
    expect(deskRowDefinition.match(event(8, { title: '雨夜' }))).toBeNull()
    expect(deskRowDefinition.match({ type: 'room/speech', seq: 9, time: 0, data })).toBeNull()
    expect(deskRowDefinition.start(undefined, { event: event(7, data, 5) }))
      .toEqual({ seq: 7, time: 5, canvasId: 'canvas_r', title: '雨夜', created: true, member: 'bill', role: 'coordinator' })
  })
})

describe('DeskOpenRow', () => {
  it('the coordinator\'s open shows in the sidebar, once', () => {
    const openCanvas = vi.fn()
    const addCanvas = vi.fn()
    const node = { data: row(1, 'coordinator') }
    const { unmount } = render(<DeskOpenRow t={t} node={node} sessionId="room-a" openCanvas={openCanvas} addCanvas={addCanvas} />)
    expect(screen.getByText('bill 切到了画布《雨夜》')).toBeTruthy()
    expect(openCanvas).toHaveBeenCalledExactlyOnceWith('canvas_r')
    unmount()
    render(<DeskOpenRow t={t} node={node} sessionId="room-a" openCanvas={openCanvas} addCanvas={addCanvas} />)
    expect(openCanvas).toHaveBeenCalledOnce()
    expect(addCanvas).not.toHaveBeenCalled()
  })

  it('a member\'s open goes beside, and says so', () => {
    const openCanvas = vi.fn()
    const addCanvas = vi.fn()
    render(<DeskOpenRow t={t} node={{ data: row(2, 'member') }} sessionId="room-a" openCanvas={openCanvas} addCanvas={addCanvas} />)
    expect(screen.getByText('bill 新建了画布《雨夜》')).toBeTruthy()
    expect(screen.getByText('已放进侧栏的画布标签')).toBeTruthy()
    expect(addCanvas).toHaveBeenCalledExactlyOnceWith('canvas_r')
    expect(openCanvas).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('打开 →'))
    expect(openCanvas).toHaveBeenCalledExactlyOnceWith('canvas_r')
  })

  it('a history row only offers the door', () => {
    const openCanvas = vi.fn()
    const addCanvas = vi.fn()
    render(<DeskOpenRow t={t} node={{ data: row(3, 'coordinator', Date.now() - LIVE_WINDOW_MS - 1) }} sessionId="room-a" openCanvas={openCanvas} addCanvas={addCanvas} />)
    expect(openCanvas).not.toHaveBeenCalled()
    expect(addCanvas).not.toHaveBeenCalled()
  })
})
