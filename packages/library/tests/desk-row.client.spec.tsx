// @vitest-environment jsdom
/**
 * The room's row for a book a member bound there (proposal
 * 2026-10-29-room-desk): the Definition claims only this package's
 * well-formed `room/desk-opened`; a coordinator's row seen arriving opens the
 * library on the book once, a member's never takes the front, a history row
 * and a settled reply only offer the door; the room's member presets join the
 * tab's visibility.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { zh } from '../src/client/locales.ts'
import { DeskOpenRow } from '../src/client/desk/DeskOpenRow.tsx'
import { DeskAttachment } from '../src/client/desk/DeskAttachment.tsx'
import { deskRowDefinition, LIVE_WINDOW_MS, setDeskRowSeated, type DeskRowData } from '../src/client/desk/desk-row.ts'
import { LibraryTabVisibility, type LibraryPluginInventorySnapshot } from '../src/client/preset-visibility.ts'
import { RevealedProject } from '../src/client/reveal.ts'

const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as TranslateNS<'library'>

afterEach(() => { cleanup() })

const OWNER = '@khorsheed/dsh-library'
const payload = (role: 'coordinator' | 'member', runId?: string) => ({
  version: 1, owner: OWNER, member: 'bill', role, ...runId === undefined ? {} : { runId },
  data: { projectId: 'p_neuro', projectName: '神经科学', resourceId: 'r_kandel', resourceTitle: '神经科学原理' },
})
const event = (seq: number, data: unknown, time = Date.now()) => ({ type: 'room/desk-opened', seq, time, data })
const row = (seq: number, role: 'coordinator' | 'member', time = Date.now()): DeskRowData =>
  ({ seq, time, projectId: 'p_neuro', projectName: '神经科学', resourceId: 'r_kandel', resourceTitle: '神经科学原理', member: 'bill', role })

describe('deskRowDefinition', () => {
  it('claims this package\'s well-formed desk events only', () => {
    expect(deskRowDefinition.match(event(7, payload('coordinator', 'r1')))).toEqual({ id: 'library-desk-7', role: 'start' })
    // The canvas's desk event is the canvas's to render.
    expect(deskRowDefinition.match(event(8, { ...payload('member'), owner: '@khorsheed/dsh-canvas' }))).toBeNull()
    expect(deskRowDefinition.match(event(9, { ...payload('member'), data: { projectName: '神经科学' } }))).toBeNull()
    expect(deskRowDefinition.match({ type: 'room/desk-wrote', seq: 10, time: 0, data: payload('member') })).toBeNull()
    expect(deskRowDefinition.start(undefined, { event: event(7, payload('coordinator', 'r1'), 5) }))
      .toEqual({ ...row(7, 'coordinator', 5), runId: 'r1' })
  })

  it('steps aside for a run\'s event once the room seats the row in the member\'s card', () => {
    const context = (runId?: string) => ({ key: 'k', id: 'i', state: { ...row(1, 'member'), ...runId === undefined ? {} : { runId } } })
    expect(deskRowDefinition.buildViewNode(context('r1'))).toMatchObject({ visibility: 'visible' })
    setDeskRowSeated(true)
    try {
      expect(deskRowDefinition.buildViewNode(context('r1'))).toMatchObject({ visibility: 'hidden' })
      expect(deskRowDefinition.buildViewNode(context())).toMatchObject({ visibility: 'visible' })
    } finally {
      setDeskRowSeated(false)
    }
  })
})

describe('DeskOpenRow', () => {
  it('the coordinator\'s bind opens the library on the book, once', () => {
    const openBook = vi.fn()
    const node = { data: row(1, 'coordinator') }
    const { unmount } = render(<DeskOpenRow t={t} node={node} sessionId="room-a" openBook={openBook} />)
    expect(screen.getByText('bill 打开了《神经科学原理》')).toBeTruthy()
    expect(openBook).toHaveBeenCalledExactlyOnceWith('p_neuro', 'r_kandel')
    unmount()
    render(<DeskOpenRow t={t} node={node} sessionId="room-a" openBook={openBook} />)
    expect(openBook).toHaveBeenCalledOnce()
  })

  it('a member\'s bind never takes the front; the door opens it', () => {
    const openBook = vi.fn()
    render(<DeskOpenRow t={t} node={{ data: { ...row(2, 'member'), resourceId: undefined, resourceTitle: undefined } as DeskRowData }} sessionId="room-a" openBook={openBook} />)
    expect(screen.getByText('bill 打开了项目「神经科学」')).toBeTruthy()
    expect(screen.getByText('只绑定了自己的会话')).toBeTruthy()
    expect(openBook).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('打开 →'))
    expect(openBook).toHaveBeenCalledExactlyOnceWith('p_neuro', undefined)
  })

  it('a history row only offers the door', () => {
    const openBook = vi.fn()
    render(<DeskOpenRow t={t} node={{ data: row(3, 'coordinator', Date.now() - LIVE_WINDOW_MS - 1) }} sessionId="room-a" openBook={openBook} />)
    expect(openBook).not.toHaveBeenCalled()
  })
})

describe('DeskAttachment', () => {
  it('names only the book inside the card, and only the live card follows', () => {
    const openBook = vi.fn()
    const attachment = { type: 'room/desk-opened', seq: 40, time: Date.now(), data: payload('coordinator', 'r1') }
    const foreign = { type: 'room/desk-opened', seq: 41, time: Date.now(), data: { ...payload('coordinator', 'r1'), owner: '@khorsheed/dsh-canvas' } }
    render(<DeskAttachment sessionId="room-b" attachments={[attachment, foreign]} live={false} t={t} openBook={openBook} />)
    expect(screen.getAllByText('打开了《神经科学原理》')).toHaveLength(1)
    expect(openBook).not.toHaveBeenCalled()
    cleanup()
    render(<DeskAttachment sessionId="room-b" attachments={[attachment]} live t={t} openBook={openBook} />)
    expect(openBook).toHaveBeenCalledExactlyOnceWith('p_neuro', 'r_kandel')
  })
})

describe('RevealedProject lands on a book', () => {
  it('hands over the book with its project, once', () => {
    const revealed = new RevealedProject()
    revealed.reveal('p_neuro', 'r_kandel')
    expect(revealed.takeTarget()).toEqual({ projectId: 'p_neuro', resourceId: 'r_kandel' })
    expect(revealed.takeTarget()).toBeUndefined()
  })
})

describe('the tab\'s visibility in a room', () => {
  const ROW = { moduleName: '@khorsheed/dsh-library/tool' }
  const composition: LibraryPluginInventorySnapshot = {
    entries: [],
    agentPresets: [
      { id: 'dev', rows: [{ moduleName: '@khorsheed/dsh-canvas/agent' }] },
      { id: 'learn', rows: [ROW] },
      { id: 'broken-learn', broken: 'x', rows: [ROW] },
    ],
  }

  /** A ctx whose sessions list holds one room in the 开发 mode, and an optional roomModes service. */
  function harness(presets: Record<string, readonly string[]> | undefined) {
    const roomListeners = new Set<() => void>()
    const modes = presets === undefined ? undefined : {
      presetsOf: (id: string) => presets[id],
      subscribe: (listener: () => void) => { roomListeners.add(listener); return () => { roomListeners.delete(listener) } },
    }
    let injected: ((scoped: unknown) => void) | undefined
    const ctx = {
      sessions: { list: { getSnapshot: () => ({ byId: { room: { id: 'room', agentPreset: 'dev' } } }), subscribe: () => () => {} } },
      effect: (fn: () => (() => void) | void) => { fn() },
      get: (name: string) => name === 'roomModes' ? modes : undefined,
      inject: (_deps: string[], callback: (scoped: unknown) => void) => { injected = callback },
    } as unknown as Context
    const visibility = new LibraryTabVisibility(ctx, { list: async () => ({ ok: true, value: composition }) as never })
    if (modes !== undefined) injected?.({ roomModes: modes, effect: (fn: () => unknown) => fn() })
    return { visibility, roomListeners }
  }

  it('a member\'s learning mode shows the tab in a 开发 room; a broken one does not', async () => {
    const { visibility, roomListeners } = harness({ room: ['learn'] })
    await Promise.resolve()
    await Promise.resolve()
    expect(visibility.show('room' as never)).toBe(true)
    expect(visibility.grants('room' as never)).toBe(true)
    expect(roomListeners.size).toBe(1)
    const broken = harness({ room: ['broken-learn'] })
    await Promise.resolve()
    await Promise.resolve()
    expect(broken.visibility.show('room' as never)).toBe(false)
  })

  it('without room the criterion is the room\'s own mode', async () => {
    const { visibility } = harness(undefined)
    await Promise.resolve()
    await Promise.resolve()
    expect(visibility.show('room' as never)).toBe(false)
    expect(visibility.grants('room' as never)).toBe(false)
  })
})
