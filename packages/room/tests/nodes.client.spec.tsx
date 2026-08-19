// @vitest-environment jsdom
/** The room chat-flow nodes: Definition claiming/lifecycle and the renderers. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  roomEventDefinition, roomRelayDefinition, roomRunDefinition, roomSpeechDefinition,
  type RoomEventData, type RoomRelayData, type RoomRunData, type RoomSpeechData,
} from '../src/client/nodes.ts'
import { RoomSpeechView } from '../src/client/RoomSpeechView.tsx'
import { RoomRunView } from '../src/client/RoomRunView.tsx'
import { RoomEventView } from '../src/client/RoomEventView.tsx'
import { RoomRelayView } from '../src/client/RoomRelayView.tsx'
import { RoomStore, type RoomGateway } from '../src/client/room-store.ts'
import { zh } from '../src/client/locales.ts'
import type {
  RoomEventViewProps, RoomRelayViewProps, RoomRunViewProps, RoomSpeechViewProps,
} from '../src/client/slots.ts'
import type { RoomState } from '../src/types.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const t = makeTranslate(zh)

/** A journal event fixture. */
function ev(type: string, seq: number, data: unknown): SessionEvent {
  return { type, seq, time: 1000 + seq, data } as SessionEvent
}

/** A minimal match/context stand-in for driving a Definition by hand. */
function matchOf(event: SessionEvent) {
  return { event, role: 'start', location: { kind: 'unresolved' } } as never
}

function contextOf<State>(state: State | undefined) {
  return { key: 'k', id: '1', state, start: undefined } as never
}

const STATE: RoomState = {
  members: [
    { name: 'main', kind: 'main-agent', invitedBy: 'human' },
    { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human', childSessionId: 'child-1' as SessionId },
  ],
  relays: [],
  tasks: [],
  runs: [],
}

/** A store pre-primed with the STATE fixture. */
async function primedStore(): Promise<RoomStore> {
  const list = createSnapshotStore<{ current: SessionId | undefined }>({ current: undefined })
  const gateway: RoomGateway = {
    isRoom: async () => ({ ok: true, value: true }),
    getState: async () => ({ ok: true, value: { ok: true, value: STATE } }),
  }
  const store = new RoomStore({ sessions: { list } } as unknown as ClientContext, gateway)
  await store.ensure('room-1' as SessionId)
  return store
}

/** A chat-node prop stand-in carrying the given data. */
function nodeOf<Data>(kind: string, data: Data) {
  return {
    key: 'k', kind, id: String(data && (data as { seq: number }).seq), target: 'chat',
    anchorSeq: (data as { seq: number }).seq,
    location: { kind: 'unresolved' }, visibility: 'visible', data,
  }
}

describe('room node Definitions', () => {
  it('room-speech claims room/speech events only and materializes the node', () => {
    const event = ev('room/speech', 7, { member: 'ada', text: '方案 A', childSessionId: 'child-1', durationMs: 1200 })
    expect(roomSpeechDefinition.match(event)).toEqual({ id: '7', role: 'start' })
    expect(roomSpeechDefinition.match(ev('room/dispatch', 1, { targets: [], text: 'x' }))).toBeNull()
    expect(roomSpeechDefinition.match(ev('user/message', 2, {}))).toBeNull()

    const state = roomSpeechDefinition.start(contextOf(undefined), matchOf(event), undefined as never)
    expect(state).toEqual({
      seq: 7, time: 1007, member: 'ada', text: '方案 A', childSessionId: 'child-1', durationMs: 1200,
    })
    const node = roomSpeechDefinition.buildViewNode!(contextOf(state))
    expect(node).toMatchObject({ kind: 'room-speech', anchorSeq: 7, visibility: 'visible', data: state })
  })

  it('room-run keys on member+startedAt: running starts, terminals update', () => {
    const running = ev('room/run-state', 3, { member: 'ada', state: 'running', startedAt: 100 })
    const done = ev('room/run-state', 4, { member: 'ada', state: 'done', startedAt: 100, elapsedMs: 900 })
    expect(roomRunDefinition.match(running)).toEqual({ id: 'ada:100', role: 'start' })
    expect(roomRunDefinition.match(done)).toEqual({ id: 'ada:100', role: 'update' })
    expect(roomRunDefinition.match(ev('room/speech', 5, { member: 'ada', text: 'x' }))).toBeNull()

    const started = roomRunDefinition.start(contextOf(undefined), matchOf(running), undefined as never)
    expect(started).toEqual({ seq: 3, time: 1003, member: 'ada', startedAt: 100, state: 'running' })
    expect(roomRunDefinition.buildViewNode!(contextOf(started))).toMatchObject({ kind: 'room-run' })

    const settled = roomRunDefinition.update(
      contextOf(started) as never,
      { event: done, role: 'update', location: { kind: 'unresolved' } } as never,
    )
    expect(settled).toEqual({ seq: 3, time: 1003, member: 'ada', startedAt: 100, state: 'done', elapsedMs: 900 })
    // done/cancelled dematerialize; failed stays.
    expect(roomRunDefinition.buildViewNode!(contextOf(settled))).toBeNull()
    const cancelled = roomRunDefinition.update(
      contextOf(started) as never,
      { event: ev('room/run-state', 4, { member: 'ada', state: 'cancelled', startedAt: 100 }), role: 'update', location: { kind: 'unresolved' } } as never,
    )
    expect(roomRunDefinition.buildViewNode!(contextOf(cancelled))).toBeNull()
    const failed = roomRunDefinition.update(
      contextOf(started) as never,
      { event: ev('room/run-state', 4, { member: 'ada', state: 'failed', startedAt: 100 }), role: 'update', location: { kind: 'unresolved' } } as never,
    )
    expect(roomRunDefinition.buildViewNode!(contextOf(failed))).toMatchObject({ data: { state: 'failed' } })
  })

  it('room-event claims boundaries only: no dispatch, no user/message, no auto-seated main agent', () => {
    const joined = ev('room/member-added', 1, { name: 'bill', kind: 'cli', provider: 'claude-code', invitedBy: 'agent' })
    const mainSeated = ev('room/member-added', 0, { name: 'main', kind: 'main-agent', invitedBy: 'human' })
    expect(roomEventDefinition.match(joined)).toEqual({ id: '1', role: 'start' })
    expect(roomEventDefinition.match(mainSeated)).toBeNull()
    expect(roomEventDefinition.match(ev('room/member-removed', 2, { name: 'bill' }))).toEqual({ id: '2', role: 'start' })
    // Dispatch records are bookkeeping: the human's @-message renders through
    // the official user node (postMessage also appends a user/message).
    expect(roomEventDefinition.match(ev('room/dispatch', 3, { targets: ['ada'], text: '干活' }))).toBeNull()
    expect(roomEventDefinition.match(ev('room/created', 0, { version: 1 }))).toBeNull()
    expect(roomEventDefinition.match(ev('room/run-state', 5, { member: 'ada', state: 'running', startedAt: 1 }))).toBeNull()
    // The dropped blackboard note is legacy: never claimed.
    expect(roomEventDefinition.match(ev('room/note', 6, { text: '旧' }))).toBeNull()

    const state = roomEventDefinition.start(contextOf(undefined), matchOf(joined), undefined as never)
    expect(state).toEqual({
      seq: 1, time: 1001, sub: 'member-added', member: 'bill', invitedBy: 'agent', provider: 'claude-code',
    })
  })

  it('no room Definition claims a user/message event (the official user node owns it)', () => {
    const message = ev('user/message', 9, {
      id: 'm1', role: 'user', content: [{ type: 'text', text: '@ada 出方案' }], source: { kind: 'user' },
    })
    expect(roomSpeechDefinition.match(message)).toBeNull()
    expect(roomRunDefinition.match(message)).toBeNull()
    expect(roomEventDefinition.match(message)).toBeNull()
    expect(roomRelayDefinition.match(message)).toBeNull()
  })

  it('room-relay keys on the relay id: the gate row folds its resolutions in place', () => {
    const relay = ev('room/relay', 3, { id: 'r1', from: 'ada', to: 'bill', content: '接口定稿' })
    const resolved = ev('room/relay-resolved', 4, { id: 'r1', state: 'sent' })
    expect(roomRelayDefinition.match(relay)).toEqual({ id: 'r1', role: 'start' })
    expect(roomRelayDefinition.match(resolved)).toEqual({ id: 'r1', role: 'update' })
    expect(roomRelayDefinition.match(ev('room/speech', 5, { member: 'ada', text: 'x' }))).toBeNull()

    const started = roomRelayDefinition.start(contextOf(undefined), matchOf(relay), undefined as never)
    expect(started).toEqual({
      seq: 3, time: 1003, relayId: 'r1', from: 'ada', to: 'bill', content: '接口定稿', state: 'pending',
    })
    expect(roomRelayDefinition.buildViewNode!(contextOf(started))).toMatchObject({ kind: 'room-relay' })

    const updated = roomRelayDefinition.update(
      contextOf(started) as never,
      { event: resolved, role: 'update', location: { kind: 'unresolved' } } as never,
    )
    expect(updated).toEqual({ ...started, seq: 4, state: 'sent' })
    expect(roomRelayDefinition.buildViewNode!(contextOf(updated))).toMatchObject({ data: { state: 'sent' } })
  })
})

describe('RoomSpeechView', () => {
  const speech: RoomSpeechData = {
    seq: 7, time: 1007, member: 'ada', text: '方案 A 如下', childSessionId: 'child-1' as SessionId, durationMs: 1200,
  }

  async function bench(data: RoomSpeechData = speech) {
    const roomStore = await primedStore()
    const openSession = vi.fn()
    const props = {
      node: nodeOf('room-speech', data), sessionId: 'room-1' as SessionId,
      roomStore, openSession, t,
    } as unknown as RoomSpeechViewProps
    render(<RoomSpeechView {...props} />)
    return { openSession }
  }

  it('renders the identity row, the unframed body, and the action row', async () => {
    await bench()
    expect(screen.getByText('ada')).toBeDefined()
    expect(screen.getByText('kimi')).toBeDefined()
    expect(screen.getByText('方案 A 如下')).toBeDefined()
    expect(screen.getByRole('button', { name: '复制' })).toBeDefined()
    expect(screen.getByRole('button', { name: '查看成员会话' })).toBeDefined()
    expect(screen.getByText('1.2s')).toBeDefined()
  })

  it('the jump button opens the child session; no handle, no button', async () => {
    const { openSession } = await bench()
    fireEvent.click(screen.getByRole('button', { name: '查看成员会话' }))
    expect(openSession).toHaveBeenCalledWith('child-1')

    cleanup()
    await bench({ seq: 8, time: 1008, member: 'ada', text: '无句柄' })
    expect(screen.queryByRole('button', { name: '查看成员会话' })).toBeNull()
  })
})

describe('RoomRunView', () => {
  async function bench(data: RoomRunData) {
    const roomStore = await primedStore()
    const openSession = vi.fn()
    const cancelMember = vi.fn(async () => {})
    const props = {
      node: nodeOf('room-run', data), sessionId: 'room-1' as SessionId,
      roomStore, openSession, cancelMember, t,
    } as unknown as RoomRunViewProps
    render(<RoomRunView {...props} />)
    return { openSession, cancelMember }
  }

  it('renders the running row with a ticking elapsed and jumps on click', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const { openSession } = await bench({ seq: 3, time: 1003, member: 'ada', startedAt: 10_000, state: 'running' })
    expect(screen.getByText('ada 正在工作…')).toBeDefined()
    expect(screen.getByText('· 0.0s')).toBeDefined()
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(screen.getByText('· 2.0s')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /ada 正在工作/ }))
    expect(openSession).toHaveBeenCalledWith('child-1')
  })

  it('the stop button cancels without triggering the row jump', async () => {
    vi.useFakeTimers()
    const { openSession, cancelMember } = await bench({ seq: 3, time: 1003, member: 'ada', startedAt: 1_000, state: 'running' })
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(cancelMember).toHaveBeenCalledWith('ada')
    expect(openSession).not.toHaveBeenCalled()
  })

  it('a failed run stays as a dim error row without a stop button', async () => {
    await bench({ seq: 3, time: 1003, member: 'ada', startedAt: 1_000, state: 'failed', elapsedMs: 500 })
    expect(screen.getByText('ada 运行失败')).toBeDefined()
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull()
  })
})

describe('RoomEventView', () => {
  function bench(data: RoomEventData) {
    const props = { node: nodeOf('room-event', data), t } as unknown as RoomEventViewProps
    render(<RoomEventView {...props} />)
  }

  it('renders the join/leave lines', () => {
    bench({ seq: 1, time: 1001, sub: 'member-added', member: 'bill', provider: 'claude-code', invitedBy: 'agent' })
    expect(screen.getByText('bill（claude-code）加入了 room · 由主 agent 邀请')).toBeDefined()
    cleanup()
    bench({ seq: 2, time: 1002, sub: 'member-removed', member: 'bill' })
    expect(screen.getByText('bill 离开了 room')).toBeDefined()
  })
})

describe('RoomRelayView', () => {
  const relay: RoomRelayData = {
    seq: 3, time: 1003, relayId: 'r1', from: 'ada', to: 'bill', content: '接口定稿', state: 'pending',
  }

  async function bench(data: RoomRelayData) {
    const roomStore = await primedStore()
    const confirmRelay = vi.fn(async () => {})
    const dismissRelay = vi.fn(async () => {})
    const props = {
      node: nodeOf('room-relay', data), sessionId: 'room-1' as SessionId,
      roomStore, confirmRelay, dismissRelay, t,
    } as unknown as RoomRelayViewProps
    render(<RoomRelayView {...props} />)
    return { confirmRelay, dismissRelay }
  }

  it('a pending relay renders the gate row with confirm/dismiss actions', async () => {
    const { confirmRelay, dismissRelay } = await bench(relay)
    expect(screen.getByText(/⇢ ada → bill：接口定稿/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '确认派发' }))
    expect(confirmRelay).toHaveBeenCalledWith('r1')
    fireEvent.click(screen.getByRole('button', { name: '忽略' }))
    expect(dismissRelay).toHaveBeenCalledWith('r1')
  })

  it('a resolved relay folds to a plain dim line (no actions)', async () => {
    await bench({ ...relay, seq: 4, state: 'sent' })
    expect(screen.getByText(/⇢ ada → bill：接口定稿/)).toBeDefined()
    expect(screen.getByText(/（已送达）/)).toBeDefined()
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()
    await bench({ ...relay, seq: 4, state: 'dismissed' })
    expect(screen.getByText(/（已忽略）/)).toBeDefined()
  })
})
