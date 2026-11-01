// @vitest-environment jsdom
/**
 * The room's row for a canvas a member opened there (proposal
 * 2026-10-29-room-desk): the Definition claims only well-formed
 * canvas desk events (room's `room/desk-opened` with this owner, and the
 * first `canvas/desk-opened` spelling); a row seen arriving follows once — the
 * coordinator's into the sidebar, a member's onto the strip beside — and a
 * history row only offers its door.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CanvasDetailProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { DeskOpenRow } from '../src/client/open/DeskOpenRow.tsx'
import { deskDestinationsOf, deskRowDefinition, setDeskRowSeated, type DeskRowData } from '../src/client/open/desk-row.ts'
import { DeskAttachment } from '../src/client/open/DeskAttachment.tsx'

const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as CanvasDetailProps['t']

afterEach(() => { cleanup() })

const event = (seq: number, data: unknown, time = Date.now()) => ({ type: 'room/desk-opened', seq, time, data })
const row = (seq: number, role: 'coordinator' | 'member', time = Date.now()): DeskRowData =>
  ({ seq, time, canvasId: 'canvas_r', title: '雨夜', created: role === 'member', member: 'bill', role })

describe('deskRowDefinition', () => {
  it('claims well-formed canvas desk events only, one node each, in both spellings', () => {
    const data = { version: 1, owner: '@khorsheed/dsh-canvas', member: 'bill', role: 'coordinator', runId: 'r1', data: { canvasId: 'canvas_r', title: '雨夜', created: true } }
    expect(deskRowDefinition.match(event(7, data))).toEqual({ id: 'desk-7', role: 'start' })
    expect(deskRowDefinition.match(event(8, { ...data, data: { title: '雨夜' } }))).toBeNull()
    // Another plugin's desk event is its own to render.
    expect(deskRowDefinition.match(event(8, { ...data, owner: '@khorsheed/dsh-game' }))).toBeNull()
    expect(deskRowDefinition.match({ type: 'room/speech', seq: 9, time: 0, data })).toBeNull()
    expect(deskRowDefinition.start(undefined, { event: event(7, data, 5) }))
      .toEqual({ seq: 7, time: 5, canvasId: 'canvas_r', title: '雨夜', created: true, member: 'bill', role: 'coordinator', runId: 'r1' })
    // The first spelling (canvas 0.6.0, 2026-10-29): flat fields, still a row.
    const flat = { type: 'canvas/desk-opened', seq: 3, time: 5, data: { version: 1, canvasId: 'canvas_r', title: '雨夜', created: false, member: 'bill', role: 'member' } }
    expect(deskRowDefinition.start(undefined, { event: flat }))
      .toEqual({ seq: 3, time: 5, canvasId: 'canvas_r', title: '雨夜', created: false, member: 'bill', role: 'member' })
  })

  it('steps aside for a run\'s event once the room seats the row in the member\'s card', () => {
    const context = (runId?: string) => ({ key: 'k', id: 'i', state: { ...row(1, 'member'), ...runId === undefined ? {} : { runId } } })
    expect(deskRowDefinition.buildViewNode(context('r1'))).toMatchObject({ visibility: 'visible' })
    setDeskRowSeated(true)
    try {
      expect(deskRowDefinition.buildViewNode(context('r1'))).toMatchObject({ visibility: 'hidden' })
      // No run to sit in: it keeps its own row.
      expect(deskRowDefinition.buildViewNode(context())).toMatchObject({ visibility: 'visible' })
    } finally {
      setDeskRowSeated(false)
    }
  })

  it('in the member\'s card the row names only the canvas, and never opens by itself', () => {
    const openCanvas = vi.fn()
    const addCanvas = vi.fn()
    const go = vi.fn()
    const attachment = { type: 'room/desk-opened', seq: 40, time: Date.now(), data: { version: 1, owner: '@khorsheed/dsh-canvas', member: 'bill', role: 'coordinator', runId: 'r1', data: { canvasId: 'canvas_r', title: '潜梦者', created: true } } }
    render(<DeskAttachment sessionId="room-b" attachments={[attachment]} live={false} t={t} openCanvas={openCanvas} go={go} addCanvas={addCanvas} />)
    expect(screen.getByText('新建了《潜梦者》')).toBeTruthy()
    expect(openCanvas).not.toHaveBeenCalled()
    cleanup()
    render(<DeskAttachment sessionId="room-b" attachments={[attachment]} live t={t} openCanvas={openCanvas} go={go} addCanvas={addCanvas} />)
    expect(openCanvas).not.toHaveBeenCalled()
  })

  it('folds a turn\'s writes into one line per canvas: a new card counts once, the door lands where the writes are', () => {
    const openCanvas = vi.fn()
    const go = vi.fn()
    const addCanvas = vi.fn()
    const wrote = (seq: number, items: unknown[]) => ({ type: 'room/desk-wrote', seq, time: Date.now(), data: { version: 1, owner: '@khorsheed/dsh-canvas', member: 'bill', role: 'member', runId: 'r2', data: { canvasId: 'canvas_q', title: '潜梦者', items } } })
    const added = { action: 'added', cardId: 'c1', title: '数据标注员（姓名待定）', kind: '人物' }
    render(<DeskAttachment sessionId="room-c" attachments={[
      wrote(50, [added]),
      // The same card edited later in the turn: still one new card.
      wrote(51, [{ action: 'changed', cardId: 'c1', title: '数据标注员（姓名待定）', kind: '人物' }]),
    ]} live t={t} openCanvas={openCanvas} go={go} addCanvas={addCanvas} />)
    expect(screen.getByText('《潜梦者》 新增人物卡「数据标注员（姓名待定）」')).toBeTruthy()
    // The row itself never moves the strip: the follower reads the write (a member's marks the canvas).
    expect(addCanvas).not.toHaveBeenCalled()
    expect(deskDestinationsOf('canvas', wrote(50, [added]))).toEqual([{
      destination: { id: 'desk:@khorsheed/dsh-canvas:50', kind: 'canvas', params: { canvasId: 'canvas_q', card: 'c1', heading: '数据标注员（姓名待定）' }, label: '潜梦者' },
      role: 'member',
    }])
    fireEvent.click(screen.getByText('查看 →'))
    expect(go).toHaveBeenLastCalledWith({ canvasId: 'canvas_q', card: 'c1', heading: '数据标注员（姓名待定）' })
    cleanup()
    render(<DeskAttachment sessionId="room-c" attachments={[wrote(60, [
      { action: 'added', cardId: 'w1', title: 'A', kind: '世界' }, { action: 'added', cardId: 'w2', title: 'B', kind: '世界' },
      { action: 'commented', cardId: 'p1', title: '全书命题' },
    ])]} live={false} t={t} openCanvas={openCanvas} go={go} addCanvas={addCanvas} />)
    expect(screen.getByText('《潜梦者》 新增 2 张世界卡 · 批注「全书命题」')).toBeTruthy()
    // Several cards: the board, narrowed to every card the turn touched.
    fireEvent.click(screen.getByText('查看 →'))
    expect(go).toHaveBeenLastCalledWith({ canvasId: 'canvas_q', face: 'board', cards: ['w1', 'w2', 'p1'] })
    cleanup()
    // A novel turn: a chapter written, a card that nothing names, two unnamed edits.
    render(<DeskAttachment sessionId="room-c" attachments={[wrote(70, [
      { action: 'chapter', title: '第 1 章《别替我起名》' },
      { action: 'added', cardId: 'q1', title: '', kind: '原则' },
      { action: 'changed', cardId: 'c1', title: '' },
    ])]} live={false} t={t} openCanvas={openCanvas} go={go} addCanvas={addCanvas} />)
    expect(screen.getByText('《潜梦者》 新增 1 张原则卡 · 写了第 1 章《别替我起名》 · 修改 1 张卡')).toBeTruthy()
    // A chapter written (an older event: the number only in the title): that chapter's text.
    fireEvent.click(screen.getByText('查看 →'))
    expect(go).toHaveBeenLastCalledWith({ canvasId: 'canvas_q', face: 'manuscripts', item: '1', focus: 'body' })
    expect(openCanvas).not.toHaveBeenCalled()
  })
})

describe('DeskOpenRow', () => {
  it('never opens by itself; the follower reads the event with its role (a coordinator\'s write needs nothing)', () => {
    const openCanvas = vi.fn()
    const addCanvas = vi.fn()
    render(<DeskOpenRow t={t} node={{ data: row(1, 'coordinator') }} sessionId="room-a" openCanvas={openCanvas} addCanvas={addCanvas} />)
    expect(screen.getByText('bill 切到了画布《雨夜》')).toBeTruthy()
    expect(openCanvas).not.toHaveBeenCalled()
    const opened = (role: string) => event(1, { version: 1, owner: '@khorsheed/dsh-canvas', member: 'bill', role, data: { canvasId: 'canvas_r', title: '雨夜', created: false } })
    expect(deskDestinationsOf('canvas', opened('coordinator'))).toEqual([{
      destination: { id: 'desk:@khorsheed/dsh-canvas:1', kind: 'canvas', params: { canvasId: 'canvas_r' }, label: '雨夜' }, role: 'coordinator',
    }])
    expect(deskDestinationsOf('canvas', opened('member'))[0]?.role).toBe('member')
    const wrote = { type: 'room/desk-wrote', seq: 2, time: Date.now(), data: { version: 1, owner: '@khorsheed/dsh-canvas', member: 'bill', role: 'coordinator', data: { canvasId: 'canvas_r', title: '雨夜', items: [{ action: 'added', cardId: 'c1', title: 'x' }] } } }
    expect(deskDestinationsOf('canvas', wrote)).toEqual([])
  })

  it('a member\'s open goes beside, and says so', () => {
    const openCanvas = vi.fn()
    const addCanvas = vi.fn()
    render(<DeskOpenRow t={t} node={{ data: row(2, 'member') }} sessionId="room-a" openCanvas={openCanvas} addCanvas={addCanvas} />)
    // The same shell as every card: the line says it went beside.
    expect(screen.getByText('bill 新建了画布《雨夜》 · 已放进侧栏的画布标签')).toBeTruthy()
    expect(openCanvas).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('打开 →'))
    expect(openCanvas).toHaveBeenCalledExactlyOnceWith('canvas_r')
  })

  it('a history row only offers the door', () => {
    const openCanvas = vi.fn()
    const addCanvas = vi.fn()
    render(<DeskOpenRow t={t} node={{ data: row(3, 'coordinator', 0) }} sessionId="room-a" openCanvas={openCanvas} addCanvas={addCanvas} />)
    expect(openCanvas).not.toHaveBeenCalled()
    expect(addCanvas).not.toHaveBeenCalled()
  })
})
