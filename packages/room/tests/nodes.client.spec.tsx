// @vitest-environment jsdom
/** The room chat-flow nodes: Definition claiming/lifecycle and the renderers. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationViewDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  roomEventDefinition, roomRelayDefinition, roomRunDefinition, roomSpeechDefinition, roomTaskLineDefinition,
  type RoomEventData, type RoomRelayData, type RoomRunData, type RoomSpeechData, type RoomTaskLineData,
} from '../src/client/nodes.ts'
import { RoomSpeechView } from '../src/client/RoomSpeechView.tsx'
import { RoomRunView } from '../src/client/RoomRunView.tsx'
import { RoomEventView } from '../src/client/RoomEventView.tsx'
import { RoomRelayView } from '../src/client/RoomRelayView.tsx'
import { RoomTaskLineView } from '../src/client/RoomTaskLineView.tsx'
import { RoomStore, type RoomGateway } from '../src/client/room-store.ts'
import { memberColor } from '../src/client/member-color.ts'
import { zh } from '../src/client/locales.ts'
import type {
  RoomEventViewProps, RoomRelayViewProps, RoomRunViewProps, RoomSpeechViewProps, RoomTaskLineViewProps,
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
  const store = new RoomStore({ sessions: { list } } as unknown as Context, gateway)
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
    // done/cancelled hide in place (the assembler forbids withdrawing a
    // materialized node with null); failed stays visible.
    expect(roomRunDefinition.buildViewNode!(contextOf(settled)))
      .toMatchObject({ visibility: 'hidden', data: { state: 'done' } })
    const cancelled = roomRunDefinition.update(
      contextOf(started) as never,
      { event: ev('room/run-state', 4, { member: 'ada', state: 'cancelled', startedAt: 100 }), role: 'update', location: { kind: 'unresolved' } } as never,
    )
    expect(roomRunDefinition.buildViewNode!(contextOf(cancelled)))
      .toMatchObject({ visibility: 'hidden', data: { state: 'cancelled' } })
    const failed = roomRunDefinition.update(
      contextOf(started) as never,
      { event: ev('room/run-state', 4, { member: 'ada', state: 'failed', startedAt: 100, error: 'boom' }), role: 'update', location: { kind: 'unresolved' } } as never,
    )
    expect(roomRunDefinition.buildViewNode!(contextOf(failed)))
      .toMatchObject({ data: { state: 'failed', error: 'boom' } })
  })

  it('a settled run folds away through the REAL assembler live path (regression: null withdrawal threw)', () => {
    // A minimal chat-target view keeping the latest node per key.
    const chatView: ConversationViewDefinition = {
      target: 'chat',
      create: () => {
        const nodes = new Map<string, ChatConversationViewNode>()
        const snapshot = () => [...nodes.values()]
        return {
          empty: snapshot(),
          replace: ({ nodes: list }: { nodes: readonly ChatConversationViewNode[] }) => {
            nodes.clear()
            for (const node of list) nodes.set(node.key, node)
            return snapshot()
          },
          apply: ({ upserts }: { upserts: readonly ChatConversationViewNode[] }) => {
            for (const node of upserts) nodes.set(node.key, node)
            return snapshot()
          },
        }
      },
    }
    const assembler = new ConversationNodeAssembler(
      { entries: () => [roomRunDefinition], fallbackEntry: () => undefined },
      { entries: () => [chatView] },
    )
    // The 0.1.2 assembler publishes only to ACTIVATED targets.
    assembler.activateTarget('chat')
    const running = ev('room/run-state', 3, { member: 'ada', state: 'running', startedAt: 100 })
    const done = ev('room/run-state', 4, { member: 'ada', state: 'done', startedAt: 100, elapsedMs: 900 })
    // Open on the running edge (the live row materializes)…
    assembler.replaceWindow([{ type: 'event', event: running }], false)
    assembler.flush()
    let chat = assembler.snapshot('chat') as ChatConversationViewNode[]
    expect(chat).toHaveLength(1)
    expect(chat[0]).toMatchObject({ kind: 'room-run', visibility: 'visible', data: { state: 'running' } })
    // …then the terminal edge lands live: the row must fold away WITHOUT the
    // assembler's "withdrew materialized target" throw freezing the session.
    assembler.append({ type: 'event', event: done })
    expect(() => assembler.flush()).not.toThrow()
    chat = assembler.snapshot('chat') as ChatConversationViewNode[]
    expect(chat).toHaveLength(1)
    expect(chat[0]).toMatchObject({ kind: 'room-run', visibility: 'hidden', data: { state: 'done', elapsedMs: 900 } })
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
    expect(roomTaskLineDefinition.match(message)).toBeNull()
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

  it('room-task-line keys on the task id: hidden while open, materializes at the done edge', () => {
    const added = ev('room/task-added', 3, { id: 't1', member: 'ada', title: 'API 定稿', status: 'in_progress' })
    const progressed = ev('room/task-updated', 4, { id: 't1', status: 'done' })
    const cancelled = ev('room/task-updated', 5, { id: 't1', status: 'cancelled' })
    expect(roomTaskLineDefinition.match(added)).toEqual({ id: 't1', role: 'start' })
    expect(roomTaskLineDefinition.match(progressed)).toEqual({ id: 't1', role: 'update' })
    expect(roomTaskLineDefinition.match(ev('room/goal', 6, { text: 'x' }))).toBeNull()

    const started = roomTaskLineDefinition.start(contextOf(undefined), matchOf(added), undefined as never)
    expect(started).toEqual({
      seq: 3, time: 1003, taskId: 't1', member: 'ada', title: 'API 定稿', status: 'in_progress',
    })
    // Open: the node stays hidden.
    expect(roomTaskLineDefinition.buildViewNode!(contextOf(started)))
      .toMatchObject({ kind: 'room-task-line', visibility: 'hidden' })

    const done = roomTaskLineDefinition.update(
      contextOf(started) as never,
      { event: progressed, role: 'update', location: { kind: 'unresolved' } } as never,
    )
    // The anchor moves to the closing edge: the line sits at the moment of completion.
    expect(done).toEqual({ ...started, seq: 4, time: 1004, status: 'done' })
    expect(roomTaskLineDefinition.buildViewNode!(contextOf(done)))
      .toMatchObject({ visibility: 'visible', anchorSeq: 4 })

    // A cancelled task never produces an advance line.
    const folded = roomTaskLineDefinition.update(
      contextOf(started) as never,
      { event: cancelled, role: 'update', location: { kind: 'unresolved' } } as never,
    )
    expect(roomTaskLineDefinition.buildViewNode!(contextOf(folded)))
      .toMatchObject({ visibility: 'hidden', data: { status: 'cancelled' } })
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
    const { container } = render(<RoomSpeechView {...props} />)
    return { openSession, container }
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

  it('bands the whole speech with the member-color rail', async () => {
    const { container } = await bench()
    const root = container.firstElementChild as HTMLElement
    // jsdom normalizes the hex to rgb(); compare on that form.
    const [r, g, b] = [1, 3, 5].map(i => parseInt(memberColor('ada').slice(i, i + 2), 16))
    expect(root.style.borderLeft).toBe(`2px solid rgb(${r}, ${g}, ${b})`)
    // The rail anchors the whole block: identity row, body, and action row
    // all live under it.
    expect(root.contains(screen.getByText('ada'))).toBe(true)
    expect(root.contains(screen.getByRole('button', { name: '复制' }))).toBe(true)
  })

  it('a short speech renders in full with no expand toggle', async () => {
    await bench()
    expect(screen.queryByRole('button', { name: '展开全部' })).toBeNull()
    expect(screen.queryByRole('button', { name: '收起' })).toBeNull()
  })

  it('a long speech starts collapsed and toggles expand/collapse', async () => {
    const tail = '末尾标记'
    const long = `${'很长的回复。'.repeat(120)}\n\n${tail}`
    await bench({ ...speech, text: long })
    // The full text is in the DOM (the clamp is visual); the toggle offers
    // the expansion.
    expect(screen.getByText(tail)).toBeDefined()
    const expand = screen.getByRole('button', { name: '展开全部' })
    fireEvent.click(expand)
    expect(screen.queryByRole('button', { name: '展开全部' })).toBeNull()
    const collapse = screen.getByRole('button', { name: '收起' })
    fireEvent.click(collapse)
    expect(screen.getByRole('button', { name: '展开全部' })).toBeDefined()
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
    // Sub-100ms reads as <0.1s, never a flat 0.0s.
    expect(screen.getByText('· <0.1s')).toBeDefined()
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

  it('a failed run shows the journaled reason (truncated, full text on hover)', async () => {
    await bench({
      seq: 3, time: 1003, member: 'ada', startedAt: 1_000, state: 'failed', elapsedMs: 6,
      error: 'unknown delegation provider "kimi"',
    })
    expect(screen.getByText('ada 运行失败')).toBeDefined()
    // The 6ms failure reads <0.1s, never 0.0s.
    expect(screen.getByText('· <0.1s')).toBeDefined()
    const reason = screen.getByText('unknown delegation provider "kimi"')
    expect(reason.getAttribute('title')).toBe('unknown delegation provider "kimi"')
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

describe('RoomTaskLineView', () => {
  const line: RoomTaskLineData = {
    seq: 4, time: 1004, taskId: 't1', member: 'ada', title: 'API 定稿', status: 'done',
  }

  /** A store primed with the given task board (or left unpulled). */
  async function storeWith(tasks: RoomState['tasks'] | undefined): Promise<RoomStore> {
    const list = createSnapshotStore<{ current: SessionId | undefined }>({ current: undefined })
    const gateway: RoomGateway = {
      isRoom: async () => ({ ok: true, value: true }),
      getState: async () => ({
        ok: true,
        value: { ok: true, value: { ...STATE, tasks: tasks ?? [] } },
      }),
    }
    const store = new RoomStore({ sessions: { list } } as unknown as Context, gateway)
    if (tasks !== undefined) await store.ensure('room-1' as SessionId)
    return store
  }

  async function bench(data: RoomTaskLineData, tasks: RoomState['tasks'] | undefined) {
    const roomStore = await storeWith(tasks)
    const props = {
      node: nodeOf('room-task-line', data), sessionId: 'room-1' as SessionId, roomStore, t,
    } as unknown as RoomTaskLineViewProps
    render(<RoomTaskLineView {...props} />)
  }

  it('renders the advance line with the live goal progress (cancelled leaves the denominator)', async () => {
    await bench(line, [
      { id: 't1', member: 'ada', title: 'API 定稿', status: 'done', updatedAt: 1004 },
      { id: 't2', member: 'bill', title: '搭页面', status: 'done', updatedAt: 1002 },
      { id: 't3', member: 'bill', title: '补测试', status: 'pending', updatedAt: 1003 },
      { id: 't4', member: 'bill', title: '砍掉的', status: 'cancelled', updatedAt: 1001 },
    ])
    expect(screen.getByText(/✓ ada 完成了「API 定稿」/)).toBeDefined()
    expect(screen.getByText(/── 目标进度 2\/3/)).toBeDefined()
  })

  it('drops the progress suffix while the store has no state for the session', async () => {
    await bench(line, undefined)
    expect(screen.getByText(/✓ ada 完成了「API 定稿」/)).toBeDefined()
    expect(screen.queryByText(/目标进度/)).toBeNull()
  })
})
