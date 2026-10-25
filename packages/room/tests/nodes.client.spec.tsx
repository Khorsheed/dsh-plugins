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
  roomEventDefinition, roomInboxDefinition, roomRelayDefinition, roomRunDefinition, roomSpeechDefinition,
  type RoomEventData, type RoomRelayData, type RoomRunData, type RoomSpeechData,
} from '../src/client/nodes.ts'
import { RoomSpeechView } from '../src/client/RoomSpeechView.tsx'
import { RoomRunView } from '../src/client/RoomRunView.tsx'
import { RoomEventView } from '../src/client/RoomEventView.tsx'
import { RoomRelayView } from '../src/client/RoomRelayView.tsx'
import { RoomStore, type RoomGateway } from '../src/client/room-store.ts'
import { memberColor } from '../src/client/member-color.ts'
import { zh } from '../src/client/locales.ts'
import type {
  RoomEventViewProps, RoomRelayViewProps, RoomRunViewProps, RoomSpeechViewProps,
} from '../src/client/slots.ts'
import type { RoomState } from '../src/types.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  globalThis.localStorage?.clear()
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
async function primedStore(state: RoomState = STATE): Promise<RoomStore> {
  const list = createSnapshotStore<{ current: SessionId | undefined }>({ current: undefined })
  const gateway: RoomGateway = {
    isRoom: async () => ({ ok: true, value: true }),
    getState: async () => ({ ok: true, value: { ok: true, value: state } }),
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

  it('cold-replays a stopped partial with its member-session link and explicit status', async () => {
    const event = ev('room/speech', 9, { member: 'ada', text: 'Partial answer', childSessionId: 'child-1', interrupted: 'cancelled' })
    const data = roomSpeechDefinition.start(contextOf(undefined), matchOf(event), undefined as never)
    expect(data.interrupted).toBe('cancelled')
    const openSession = vi.fn()
    render(<RoomSpeechView {...{ node: nodeOf('room-speech', data), sessionId: 'room-1', roomStore: await primedStore(), openSession, t } as RoomSpeechViewProps} />)
    expect(screen.getByText('Partial answer')).toBeTruthy()
    expect(screen.getByText('已停止 · 部分输出')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看成员会话' }))
    expect(openSession).toHaveBeenCalledWith('child-1')
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
    const reconciled = roomRunDefinition.update(contextOf({ ...started, state: 'failed', error: 'unknown outcome', elapsedMs: 900 }) as never,
      { event: ev('room/run-state', 6, { member: 'ada', state: 'done', startedAt: 100 }), role: 'update', location: { kind: 'unresolved' } } as never)
    expect(reconciled.error).toBeUndefined()
    expect(reconciled.elapsedMs).toBeUndefined()
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

  it('room-inbox shows while the gate holds reports for a member and hides once they are released', () => {
    const hold = (seq: number, dispatchSeq: number) => ev('room/report-gate', seq, { dispatchSeq, memberId: 'm-dsh', member: 'dsh', verdict: 'hold', reason: 'model', probability: 0.12 })
    expect(roomInboxDefinition.match(hold(10, 9))).toEqual({ id: 'm-dsh', role: 'start' })
    expect(roomInboxDefinition.match(ev('room/report-gate', 11, { dispatchSeq: 9, memberId: 'm-dsh', member: 'dsh', verdict: 'deliver', reason: 'last' }))).toBeNull()
    const one = roomInboxDefinition.start(contextOf(undefined), matchOf(hold(10, 9)), undefined as never)
    expect(one).toEqual({ seq: 10, time: 1010, member: 'dsh', held: [9], probability: 0.12 })
    const two = roomInboxDefinition.update(contextOf(one) as never, { event: hold(13, 12), role: 'start', location: { kind: 'unresolved' } } as never)
    expect(two).toMatchObject({ seq: 13, held: [9, 12] })
    expect(roomInboxDefinition.buildViewNode!(contextOf(two))).toMatchObject({ kind: 'room-inbox', visibility: 'visible', anchorSeq: 13 })
    let released = two
    for (const [seq, dispatchSeq] of [[14, 9], [15, 12]] as const) {
      released = roomInboxDefinition.update(contextOf(released) as never,
        { event: ev('room/report-gate', seq, { dispatchSeq, memberId: 'm-dsh', member: 'dsh', verdict: 'release', reason: 'carried' }), role: 'update', location: { kind: 'unresolved' } } as never)!
    }
    expect(roomInboxDefinition.buildViewNode!(contextOf(released))).toMatchObject({ visibility: 'hidden' })
  })

})

describe('RoomSpeechView', () => {
  const speech: RoomSpeechData = {
    seq: 7, time: 1007, member: 'ada', text: '方案 A 如下', childSessionId: 'child-1' as SessionId, durationMs: 1200,
  }

  async function bench(data: RoomSpeechData = speech, state: RoomState = STATE) {
    const roomStore = await primedStore(state)
    const openSession = vi.fn()
    const props = {
      node: nodeOf('room-speech', data), sessionId: 'room-1' as SessionId,
      roomStore, openSession, t,
    } as unknown as RoomSpeechViewProps
    const { container } = render(<RoomSpeechView {...props} />)
    return { openSession, container }
  }

  it('shows the run\'s billed tokens once its execution record carries them', async () => {
    await bench({ ...speech, runId: '7:m-ada' }, { ...STATE, executions: [{ id: '7:m-ada', memberId: 'm-ada', member: 'ada', state: 'done', startedAt: 1, tokens: 4_200 }] })
    expect(screen.getByText('用量 4.2K tok')).toBeDefined()
    cleanup()
    await bench({ ...speech, runId: '7:m-ada' })
    expect(screen.queryByText(/用量/)).toBeNull()
  })

  it('renders the identity row, the unframed body, and the action row', async () => {
    await bench()
    expect(screen.getByText('ada')).toBeDefined()
    expect(screen.getByText('kimi')).toBeDefined()
    expect(screen.getByText('方案 A 如下')).toBeDefined()
    expect(screen.getByRole('button', { name: '复制' })).toBeDefined()
    expect(screen.getByRole('button', { name: '查看成员会话' })).toBeDefined()
    expect(screen.getByText('1.2s')).toBeDefined()
  })

  it('reads as a conversation entry: a member-color avatar beside one card holding header, body and actions', async () => {
    const { container } = await bench()
    const root = container.firstElementChild as HTMLElement
    expect(root.style.getPropertyValue('--member-color')).toBe(memberColor('ada'))
    const [avatar, card] = [...root.children] as HTMLElement[]
    expect(avatar!.textContent).toBe('A')
    expect(card!.contains(screen.getByText('ada'))).toBe(true)
    expect(card!.contains(screen.getByText('方案 A 如下'))).toBe(true)
    expect(card!.contains(screen.getByRole('button', { name: '复制' }))).toBe(true)
  })

  it('a short speech renders in full with no expand toggle', async () => {
    await bench()
    expect(screen.queryByRole('button', { name: '展开全部' })).toBeNull()
    expect(screen.queryByRole('button', { name: '收起' })).toBeNull()
  })

  const tail = '末尾标记'
  const long = `${'很长的回复。'.repeat(120)}\n\n${tail}`

  it('the newest reply to the room starts unfolded; an older reply and a report start folded', async () => {
    await bench({ ...speech, text: long }, { ...STATE, latestReplySeq: 7 })
    expect(screen.getByRole('button', { name: '收起' })).toBeDefined()
    cleanup()
    // Newer than the (debounced) cached state: already the newest.
    await bench({ ...speech, seq: 9, text: long }, { ...STATE, latestReplySeq: 7 })
    expect(screen.getByRole('button', { name: '收起' })).toBeDefined()
    cleanup()
    await bench({ ...speech, seq: 5, text: long }, { ...STATE, latestReplySeq: 7 })
    expect(screen.getByRole('button', { name: '展开全部' })).toBeDefined()
    cleanup()
    await bench({ ...speech, seq: 9, text: long, reportedTo: 'dsh' }, { ...STATE, latestReplySeq: 7 })
    expect(screen.getByRole('button', { name: '展开全部' })).toBeDefined()
  })

  it('the human\'s expand/collapse is remembered per speech; the fade expands too', async () => {
    const { container } = await bench({ ...speech, seq: 5, text: long }, { ...STATE, latestReplySeq: 7 })
    fireEvent.click(container.querySelector('[aria-hidden][class*="fade"]')!)
    expect(screen.getByRole('button', { name: '收起' })).toBeDefined()
    cleanup()
    await bench({ ...speech, seq: 5, text: long }, { ...STATE, latestReplySeq: 7 })
    expect(screen.getByRole('button', { name: '收起' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    cleanup()
    // A folded newest reply stays folded.
    await bench({ ...speech, seq: 5, text: long }, { ...STATE, latestReplySeq: 5 })
    expect(screen.getByRole('button', { name: '展开全部' })).toBeDefined()
  })

  it('a long speech toggles expand/collapse', async () => {
    await bench({ ...speech, seq: 3, text: long }, { ...STATE, latestReplySeq: 7 })
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
  it('projects a crashed running node as unknown without a ticking stop control', async () => {
    const roomStore = await primedStore({ ...STATE, runs: [{ member: 'ada', startedAt: 1000, state: 'failed', error: 'Unknown outcome after restart' }] })
    const output = vi.fn()
    const props = { node: nodeOf('room-run', { seq: 3, time: 1003, member: 'ada', startedAt: 1000, state: 'running' }), sessionId: 'room-1' as SessionId,
      roomStore, openSession: vi.fn(), cancelMember: vi.fn(), renderMemberOutput: output, t } as unknown as RoomRunViewProps
    render(<RoomRunView {...props} />)
    expect(screen.getByText('Unknown outcome after restart')).toBeDefined()
    expect(screen.getByText('· 耗时未知')).toBeDefined()
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull()
    expect(output).not.toHaveBeenCalled()
  })
  async function bench(data: RoomRunData, renderMemberOutput?: RoomRunViewProps['renderMemberOutput']) {
    const roomStore = await primedStore()
    const openSession = vi.fn()
    const cancelMember = vi.fn(async () => {})
    const props = {
      node: nodeOf('room-run', data), sessionId: 'room-1' as SessionId,
      roomStore, openSession, cancelMember, renderMemberOutput, t,
    } as unknown as RoomRunViewProps
    render(<RoomRunView {...props} />)
    return { openSession, cancelMember }
  }

  it('renders native output outside the navigation button with the exact run boundary', async () => {
    const output = vi.fn(() => <p>incremental answer</p>)
    await bench({ seq: 3, time: 1003, member: 'ada', startedAt: 1000, state: 'running' }, output)
    expect(output).toHaveBeenCalledWith('child-1', 1000)
    expect(screen.getByText('incremental answer').closest('[role="button"]')).toBeNull()
    cleanup()
    output.mockClear()
    await bench({ seq: 4, time: 1004, member: 'ada', startedAt: 1000, state: 'failed' }, output)
    expect(output).not.toHaveBeenCalled()
  })

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

