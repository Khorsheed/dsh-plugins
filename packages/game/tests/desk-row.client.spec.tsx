// @vitest-environment jsdom
/**
 * The room's row for a game project a member opened there (proposal
 * 2026-10-29-room-desk): the Definition claims only this package's
 * `room/desk-opened`; a coordinator's row seen arriving opens the game tab on
 * that project once, a member's never takes the foreground, a history row and
 * a settled reply only offer the door; the member's card names only the
 * project.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { zh } from '../src/client/locales.ts'
import { DeskAttachment } from '../src/client/DeskAttachment.tsx'
import { DeskOpenRow } from '../src/client/DeskOpenRow.tsx'
import { deskDestinationsOf, deskRowDefinition, setDeskRowSeated, type DeskRowData } from '../src/client/desk-row.ts'

const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as unknown as PropsLocale<'game'>['t']

afterEach(() => { cleanup() })

const payload = (over: Record<string, unknown> = {}) => ({
  version: 1, owner: '@khorsheed/dsh-game', member: 'codex', role: 'coordinator', runId: 'r1',
  data: { projectId: 'g_1', title: '灯塔', created: true }, ...over,
})
const event = (seq: number, data: unknown, time = Date.now()) => ({ type: 'room/desk-opened', seq, time, data })
const row = (seq: number, role: 'coordinator' | 'member', time = Date.now()): DeskRowData =>
  ({ seq, time, projectId: 'g_1', title: '灯塔', created: false, member: 'codex', role })

describe('deskRowDefinition', () => {
  it('claims this package\'s desk events only, one node each', () => {
    expect(deskRowDefinition.match(event(7, payload()))).toEqual({ id: 'game-desk-7', role: 'start' })
    // The canvas's (or any other plugin's) desk event is its own to render.
    expect(deskRowDefinition.match(event(8, payload({ owner: '@khorsheed/dsh-canvas', data: { canvasId: 'c', title: 'x' } })))).toBeNull()
    expect(deskRowDefinition.match(event(9, payload({ data: { title: '灯塔' } })))).toBeNull()
    expect(deskRowDefinition.match({ type: 'room/desk-wrote', seq: 10, time: 0, data: payload() })).toBeNull()
    expect(deskRowDefinition.start(undefined, { event: event(7, payload(), 5) }))
      .toEqual({ seq: 7, time: 5, projectId: 'g_1', title: '灯塔', created: true, member: 'codex', role: 'coordinator', runId: 'r1' })
  })

  it('steps aside for a run\'s event once the room seats the row in the member\'s card', () => {
    const context = (runId?: string) => ({ key: 'k', id: 'i', state: { ...row(1, 'member'), ...runId === undefined ? {} : { runId } } })
    expect(deskRowDefinition.buildViewNode(context('r1'))).toMatchObject({ visibility: 'visible', kind: 'game-desk-open' })
    setDeskRowSeated(true)
    try {
      expect(deskRowDefinition.buildViewNode(context('r1'))).toMatchObject({ visibility: 'hidden' })
      // No run to sit in: it keeps its own row.
      expect(deskRowDefinition.buildViewNode(context())).toMatchObject({ visibility: 'visible' })
    } finally {
      setDeskRowSeated(false)
    }
  })
})

describe('DeskOpenRow', () => {
  it('never opens by itself, even the coordinator\'s live open: the follower reads the event', () => {
    const openProject = vi.fn()
    render(<DeskOpenRow t={t} node={{ data: row(1, 'coordinator') }} sessionId="room-a" openProject={openProject} />)
    expect(screen.getByText('codex 切到了游戏项目《灯塔》')).toBeTruthy()
    expect(openProject).not.toHaveBeenCalled()
    expect(deskDestinationsOf('game', event(1, payload()))).toEqual([{
      destination: { id: 'desk:@khorsheed/dsh-game:1', kind: 'game', params: { projectId: 'g_1', view: 'play' }, label: '灯塔' }, role: 'coordinator',
    }])
    expect(deskDestinationsOf('game', event(2, payload({ role: 'member' })))[0]?.role).toBe('member')
    expect(deskDestinationsOf('game', event(3, payload({ owner: '@khorsheed/dsh-canvas' })))).toEqual([])
  })

  it('a member\'s open never takes the foreground; its door opens it', () => {
    const openProject = vi.fn()
    render(<DeskOpenRow t={t} node={{ data: row(2, 'member') }} sessionId="room-a" openProject={openProject} />)
    expect(openProject).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('打开 →'))
    expect(openProject).toHaveBeenCalledExactlyOnceWith('room-a', 'g_1')
  })

  it('a history row only offers the door', () => {
    const openProject = vi.fn()
    render(<DeskOpenRow t={t} node={{ data: row(3, 'coordinator', 0) }} sessionId="room-a" openProject={openProject} />)
    expect(openProject).not.toHaveBeenCalled()
  })
})

describe('DeskAttachment', () => {
  it('in the member\'s card names only the project, and never opens by itself', () => {
    const openProject = vi.fn()
    const attachment = { type: 'room/desk-opened', seq: 40, time: Date.now(), data: payload() }
    const other = { type: 'room/desk-wrote', seq: 41, time: Date.now(), data: payload() }
    render(<DeskAttachment sessionId="room-b" attachments={[attachment, other]} live={false} t={t} openProject={openProject} />)
    expect(screen.getByText('新建了游戏项目《灯塔》')).toBeTruthy()
    expect(screen.queryByText(/codex/)).toBeNull()
    expect(screen.getAllByText('打开 →')).toHaveLength(1)
    expect(openProject).not.toHaveBeenCalled()
    cleanup()
    render(<DeskAttachment sessionId="room-b" attachments={[attachment]} live t={t} openProject={openProject} />)
    expect(openProject).not.toHaveBeenCalled()
  })
})
