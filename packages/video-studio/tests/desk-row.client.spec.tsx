// @vitest-environment jsdom
/**
 * The room's row for a project a member opened there (proposal
 * 2026-10-29-room-desk): the Definition claims only this package's
 * `room/desk-opened`; a coordinator's row seen arriving brings the room's
 * 剪辑 panel to the project once, a member's only offers the door, a settled
 * reply card never follows; the panel hand-off reaches a mounted pane at once
 * and a mounting one through the pending request.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { zh } from '../src/client/locales.ts'
import { DeskAttachment } from '../src/client/DeskAttachment.tsx'
import { DeskOpenRow } from '../src/client/DeskOpenRow.tsx'
import {
  deskRowDefinition, LIVE_WINDOW_MS, onPanelProject, requestPanelProject, setDeskRowSeated, takePanelProject, type DeskRowData,
} from '../src/client/desk-row.ts'

const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as TranslateNS<'videoStudio'>

afterEach(() => { cleanup() })

const OWNER = '@khorsheed/dsh-video-studio'
const payload = (role: 'coordinator' | 'member', extra: Record<string, unknown> = {}) =>
  ({ version: 1, owner: OWNER, member: 'bill', role, runId: 'r1', data: { projectId: 'p_1', title: '#23 老周', created: true }, ...extra })
const event = (seq: number, data: unknown, time = Date.now(), type = 'room/desk-opened') => ({ type, seq, time, data })
const row = (seq: number, role: 'coordinator' | 'member', time = Date.now()): DeskRowData =>
  ({ seq, time, projectId: 'p_1', title: '#23 老周', created: false, member: 'bill', role })

describe('deskRowDefinition', () => {
  it('claims this package\'s well-formed desk events only', () => {
    expect(deskRowDefinition.match(event(7, payload('coordinator')))).toEqual({ id: 'video-desk-7', role: 'start' })
    expect(deskRowDefinition.start(undefined, { event: event(7, payload('coordinator'), 5) }))
      .toEqual({ seq: 7, time: 5, projectId: 'p_1', title: '#23 老周', created: true, member: 'bill', role: 'coordinator', runId: 'r1' })
    // Another plugin's desk event is its own to render.
    expect(deskRowDefinition.match(event(8, payload('member', { owner: '@khorsheed/dsh-canvas' })))).toBeNull()
    expect(deskRowDefinition.match(event(9, payload('member', { data: { title: 'x' } })))).toBeNull()
    expect(deskRowDefinition.match(event(10, payload('member'), 0, 'room/desk-wrote'))).toBeNull()
    expect(deskRowDefinition.match(event(11, payload('member'), 0, 'room/speech'))).toBeNull()
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
})

describe('DeskOpenRow', () => {
  it('the coordinator\'s open seen arriving opens the panel, once', () => {
    const openProject = vi.fn()
    const node = { data: row(1, 'coordinator') }
    const { unmount } = render(<DeskOpenRow t={t} node={node} sessionId="room-a" openProject={openProject} />)
    expect(screen.getByText('bill 打开了剪辑工程「#23 老周」')).toBeTruthy()
    expect(openProject).toHaveBeenCalledExactlyOnceWith('room-a', 'p_1')
    unmount()
    render(<DeskOpenRow t={t} node={node} sessionId="room-a" openProject={openProject} />)
    expect(openProject).toHaveBeenCalledOnce()
  })

  it('a member\'s open never takes the front: only the door', () => {
    const openProject = vi.fn()
    render(<DeskOpenRow t={t} node={{ data: row(2, 'member') }} sessionId="room-a" openProject={openProject} />)
    expect(openProject).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('打开 →'))
    expect(openProject).toHaveBeenCalledExactlyOnceWith('room-a', 'p_1')
  })

  it('a history row only offers the door', () => {
    const openProject = vi.fn()
    render(<DeskOpenRow t={t} node={{ data: row(3, 'coordinator', Date.now() - LIVE_WINDOW_MS - 1) }} sessionId="room-a" openProject={openProject} />)
    expect(openProject).not.toHaveBeenCalled()
  })
})

describe('DeskAttachment', () => {
  it('in the member\'s card names only the project, and only the live card follows', () => {
    const openProject = vi.fn()
    const attachment = event(40, payload('coordinator'))
    render(<DeskAttachment sessionId="room-b" attachments={[attachment]} live={false} t={t} openProject={openProject} />)
    expect(screen.getByText('新建了工程「#23 老周」')).toBeTruthy()
    expect(screen.queryByText(/bill/)).toBeNull()
    expect(openProject).not.toHaveBeenCalled()
    cleanup()
    render(<DeskAttachment sessionId="room-b" attachments={[attachment, event(41, payload('member', { owner: 'x' }))]} live t={t} openProject={openProject} />)
    expect(openProject).toHaveBeenCalledExactlyOnceWith('room-b', 'p_1')
    expect(screen.getAllByText('打开 →')).toHaveLength(1)
  })
})

describe('the panel hand-off', () => {
  it('reaches a mounted pane at once, else waits for the next one while fresh', () => {
    const listener = vi.fn()
    const dispose = onPanelProject('room-c', listener)
    requestPanelProject('room-c', 'p_9')
    expect(listener).toHaveBeenCalledExactlyOnceWith('p_9')
    expect(takePanelProject('room-c')).toBeUndefined()
    dispose()
    requestPanelProject('room-c', 'p_10', 1_000)
    expect(takePanelProject('room-c', 1_000 + LIVE_WINDOW_MS + 1)).toBeUndefined()
    requestPanelProject('room-c', 'p_11')
    expect(takePanelProject('room-c')).toBe('p_11')
    expect(takePanelProject('room-c')).toBeUndefined()
  })
})
