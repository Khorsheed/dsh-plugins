// @vitest-environment jsdom
/** The room composer takeover: chain selector (room election + interaction yield), mention completion, dispatch submit, bare-message release, error line, the inherited environment surfaces (Stop, todo strip, queue strip, dock capsules, stats row). */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientContext, SessionId, UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RoomComposer, selectRoomComposer } from '../src/client/RoomComposer.tsx'
import { RoomStore, type RoomGateway } from '../src/client/room-store.ts'
import { zh } from '../src/client/locales.ts'
import type { RoomComposerProps, RoomMutationOutcome } from '../src/client/slots.ts'
import type { RoomState } from '../src/types.ts'

afterEach(() => {
  cleanup()
})

const SESSION = 'room-1' as SessionId

const STATE: RoomState = {
  members: [
    { name: 'main', kind: 'main-agent', invitedBy: 'human' },
    { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human' },
    { name: 'bill', kind: 'cli', provider: 'codex', invitedBy: 'agent' },
  ],
  relays: [],
  tasks: [
    { id: 't1', member: 'ada', title: '出方案', status: 'in_progress', updatedAt: 1000 },
  ],
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
  await store.ensure(SESSION)
  return store
}

/** The session-snapshot slice the composer's inherited duties read. */
interface SessionSlice {
  readonly running: boolean
  readonly queue: readonly { readonly id: string; readonly placement: string; readonly preview: string }[]
}

const IDLE: SessionSlice = { running: false, queue: [] }

interface Bench {
  roomStore: RoomStore
  area: HTMLTextAreaElement
  /** The session standard kit's official input actions (stubbed). */
  inputActions: { setDraft: ReturnType<typeof vi.fn>; submit: ReturnType<typeof vi.fn> }
  /** The injected main-agent turn Stop (stubbed). */
  stop: ReturnType<typeof vi.fn>
}

/** Render the composer with the framework shares stubbed (inputActions/stop are spies). */
async function bench(
  submit: (sessionId: SessionId, text: string) => Promise<RoomMutationOutcome>,
  options: {
    useProjection?: UseProjection | undefined
    t?: RoomComposerProps['t']
    session?: SessionSlice
  } = {},
): Promise<Bench> {
  const roomStore = await primedStore()
  const inputActions = { setDraft: vi.fn(), submit: vi.fn() }
  const stop = vi.fn()
  const slice = options.session ?? IDLE
  const useSession = (<T,>(selector: (snapshot: SessionSlice) => T): T => selector(slice)) as unknown as RoomComposerProps['useSession']
  const props = {
    sessionId: SESSION,
    matched: { room: true },
    inputActions,
    roomStore,
    submit,
    stop,
    addTask: vi.fn(async () => ({ ok: true as const })),
    closeTask: vi.fn(async () => ({ ok: true as const })),
    setGoal: vi.fn(async () => ({ ok: true as const })),
    useSession,
    // Default: a projection seat that serves nothing (no stats row, no todo strip).
    useProjection: options.useProjection === undefined
      ? (() => undefined) as unknown as UseProjection
      : options.useProjection,
    t: options.t ?? ((key: string) => key),
  } as unknown as RoomComposerProps
  render(<RoomComposer {...props} />)
  const area = screen.getByRole('textbox') as HTMLTextAreaElement
  return { roomStore, area, inputActions, stop }
}

/** Change the draft with the caret at the end (a real typing position). */
function type(area: HTMLTextAreaElement, value: string): void {
  fireEvent.change(area, { target: { value, selectionStart: value.length, selectionEnd: value.length } })
}

describe('RoomComposer', () => {
  it('renders the textarea and a disabled send button on an empty draft', async () => {
    await bench(vi.fn())
    expect(screen.getByRole('textbox')).toBeDefined()
    expect((screen.getByRole('button', { name: 'composer.send' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('lists roster members on @ and inserts the picked name', async () => {
    const { area } = await bench(vi.fn())
    type(area, '@')
    // Only existing members — main agent included, no invite entry.
    const options = screen.getAllByRole('option')
    expect(options.map(option => option.textContent)).toEqual([
      'mainmember.kind.main', 'ada' + 'kimi', 'bill' + 'codex',
    ])
    // Keyboard: down to ada, Enter picks.
    fireEvent.keyDown(area, { key: 'ArrowDown' })
    fireEvent.keyDown(area, { key: 'Enter' })
    expect(area.value).toBe('@ada ')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('filters candidates by the typed prefix and Esc closes the menu', async () => {
    const { area } = await bench(vi.fn())
    type(area, '@b')
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]!.textContent).toContain('bill')
    fireEvent.keyDown(area, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    // A later complete token re-opens completion after it.
    type(area, '@ada @')
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('submits an @-message as a dispatch and clears the draft', async () => {
    const submit = vi.fn(async (): Promise<RoomMutationOutcome> => ({ ok: true }))
    const { area, inputActions } = await bench(submit)
    type(area, '@ada 出方案')
    fireEvent.keyDown(area, { key: 'Enter' })
    await waitFor(() => { expect(submit).toHaveBeenCalledWith(SESSION, '@ada 出方案') })
    await waitFor(() => { expect(area.value).toBe('') })
    // The dispatch path never touches the official input machine.
    expect(inputActions.setDraft).not.toHaveBeenCalled()
    expect(inputActions.submit).not.toHaveBeenCalled()
  })

  it('releases a bare message to the official submit path (a normal main-agent turn)', async () => {
    const submit = vi.fn(async (): Promise<RoomMutationOutcome> => ({ ok: true }))
    const { area, inputActions } = await bench(submit)
    type(area, '随便聊聊')
    fireEvent.keyDown(area, { key: 'Enter' })
    await waitFor(() => { expect(area.value).toBe('') })
    // The official input machine received the text and the submission —
    // the room Remote was never called.
    expect(inputActions.setDraft).toHaveBeenCalledWith('随便聊聊')
    expect(inputActions.submit).toHaveBeenCalledTimes(1)
    expect(submit).not.toHaveBeenCalled()
  })

  it('shows the structured error line and keeps the draft on rejection', async () => {
    const submit = vi.fn(async (): Promise<RoomMutationOutcome> => ({ ok: false, message: '未知成员：ghost' }))
    const { area } = await bench(submit)
    type(area, '@ghost 干活')
    fireEvent.keyDown(area, { key: 'Enter' })
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toBe('未知成员：ghost')
    expect(area.value).toBe('@ghost 干活')
  })

  it('renders the dock capsules above the card (the dock seat hides with the official fallback)', async () => {
    await bench(vi.fn())
    // The collapsed row carries the goal guide state (no goal in the fixture)
    // and the task capsule with its running member (key-passthrough t).
    const goalCapsule = screen.getByRole('button', { name: 'goal.label' })
    expect(goalCapsule.textContent).toContain('goal.set')
    const taskCapsule = screen.getByRole('button', { name: 'tasks.capsule' })
    expect(taskCapsule.textContent).toContain('tasks.doing')
    // The capsules sit before the composer card's textarea in tree order.
    const area = screen.getByRole('textbox')
    expect(taskCapsule.compareDocumentPosition(area) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Expanding the task capsule reveals the fixture task.
    fireEvent.click(taskCapsule)
    expect(screen.getByText('出方案')).toBeDefined()
  })

  it('renders the stats row from the sessionStats and tokenUsage projections', async () => {
    const useProjection = ((key: string) => key === 'sessionStats'
      ? { turns: 2, steps: 3, llmMs: 45_200, toolMs: 0, ttftMs: 600, ttftSteps: 2, decodeMs: 2_000, decodeTokens: 80 }
      : key === 'tokenUsage'
        ? { uncachedInputTokens: 400, cacheReadTokens: 400, cacheWriteTokens: 200, outputTokens: 500 }
        : undefined) as unknown as UseProjection
    await bench(vi.fn(), { useProjection, t: makeTranslate(zh) as RoomComposerProps['t'] })
    expect(screen.getByText('2 轮 · 3 步')).toBeDefined()
    expect(screen.getByText('LLM 45.2s')).toBeDefined()
    // The speeds pair renders as one group.
    expect(screen.getByText('首 token 平均 0.3s · 40 tok/s')).toBeDefined()
    expect(screen.getByText('缓存命中 40%')).toBeDefined()
    expect(screen.getByText('输入 1K tok · 输出 500 tok')).toBeDefined()
  })

  it('renders no stats row when no projection value is served (silent degrade)', async () => {
    await bench(vi.fn(), { t: makeTranslate(zh) as RoomComposerProps['t'] })
    expect(screen.queryByText(/轮 · /)).toBeNull()
    expect(screen.queryByText(/tok/)).toBeNull()
  })

  it('renders no stats row when the framework omits the projection seat entirely', async () => {
    const roomStore = await primedStore()
    const useSession = (<T,>(selector: (snapshot: SessionSlice) => T): T => selector(IDLE)) as unknown as RoomComposerProps['useSession']
    const props = {
      sessionId: SESSION,
      matched: { room: true },
      inputActions: { setDraft: vi.fn(), submit: vi.fn() },
      roomStore,
      submit: vi.fn(),
      stop: vi.fn(),
      addTask: vi.fn(),
      closeTask: vi.fn(),
      useSession,
      useProjection: undefined,
      t: makeTranslate(zh),
    } as unknown as RoomComposerProps
    render(<RoomComposer {...props} />)
    expect(screen.queryByText(/轮 · /)).toBeNull()
    expect(screen.queryByText(/tok/)).toBeNull()
    // The todo strip degrades with the same seat.
    expect(screen.queryByTestId('room-todo-strip')).toBeNull()
  })
})

/** A minimal chain-currency owner: no interactions, an ordinary session. */
function owner(overrides: Partial<ComposerChainProps> = {}): ComposerChainProps {
  return {
    interactions: [],
    session: { sessionId: SESSION } as unknown as ComposerChainProps['session'],
    ...overrides,
  }
}

describe('selectRoomComposer', () => {
  it('elects a cached room session and declines a cache miss or a sessionless owner', () => {
    const cached = (id: SessionId): boolean => id === SESSION
    expect(selectRoomComposer(owner(), cached)).toEqual({ room: true })
    expect(selectRoomComposer(owner(), () => false)).toBeNull()
    expect(selectRoomComposer(owner({ session: undefined }), cached)).toBeNull()
  })

  it('declines while an interaction is pending — the ApprovalPanel elects at priority 1', () => {
    const pending = owner({ interactions: [{ kind: 'question' } as never] })
    expect(selectRoomComposer(pending, () => true)).toBeNull()
  })
})

describe('RoomComposer inherited environment duties', () => {
  it('swaps Send for Stop while the main agent turn runs, and Stop calls the injected cancel', async () => {
    const { stop } = await bench(vi.fn(), {
      session: { running: true, queue: [] },
      t: makeTranslate(zh) as RoomComposerProps['t'],
    })
    expect(screen.queryByRole('button', { name: '发送' })).toBeNull()
    const stopButton = screen.getByRole('button', { name: '停止生成' }) as HTMLButtonElement
    expect(stopButton.disabled).toBe(false)
    fireEvent.click(stopButton)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('keeps releasing bare messages to the official submit path while running (busy admission enqueues)', async () => {
    const submit = vi.fn(async (): Promise<RoomMutationOutcome> => ({ ok: true }))
    const { area, inputActions } = await bench(submit, { session: { running: true, queue: [] } })
    type(area, '排队等我')
    fireEvent.keyDown(area, { key: 'Enter' })
    await waitFor(() => { expect(area.value).toBe('') })
    expect(inputActions.setDraft).toHaveBeenCalledWith('排队等我')
    expect(inputActions.submit).toHaveBeenCalledTimes(1)
    expect(submit).not.toHaveBeenCalled()
  })

  it('renders the todo strip from the todos projection and expands to the item list', async () => {
    const useProjection = ((key: string) => key === 'todos'
      ? [
        { content: '读代码', status: 'completed' },
        { content: '写补丁', status: 'in_progress' },
        { content: '跑测试', status: 'pending' },
      ]
      : undefined) as unknown as UseProjection
    await bench(vi.fn(), { useProjection, t: makeTranslate(zh) as RoomComposerProps['t'] })
    const strip = screen.getByTestId('room-todo-strip')
    expect(strip.textContent).toContain('任务')
    expect(strip.textContent).toContain('1 已完成')
    expect(strip.textContent).toContain('1 进行中')
    expect(strip.textContent).toContain('1 待处理')
    // Collapsed by default; the header expands to the status-glyph list.
    expect(screen.queryByText('写补丁')).toBeNull()
    fireEvent.click(within(strip).getByRole('button'))
    expect(screen.getByText('写补丁')).toBeDefined()
    expect(screen.getByText('跑测试').closest('li')?.getAttribute('data-status')).toBe('pending')
  })

  it('renders no todo strip when the projection is unserved, null, or an empty list', async () => {
    for (const value of [undefined, null, []]) {
      cleanup()
      const useProjection = ((key: string) => key === 'todos' ? value : undefined) as unknown as UseProjection
      await bench(vi.fn(), { useProjection, t: makeTranslate(zh) as RoomComposerProps['t'] })
      expect(screen.queryByTestId('room-todo-strip')).toBeNull()
    }
  })

  it('renders the queued-messages strip from the session snapshot (count header over one)', async () => {
    await bench(vi.fn(), {
      session: {
        running: true,
        queue: [
          { id: 'q1', placement: 'queued', preview: '第一条跟进' },
          { id: 'q2', placement: 'queued', preview: '第二条跟进' },
          // A steering row is not queue business — filtered out.
          { id: 'q3', placement: 'steering', preview: 'steering 不算' },
        ],
      },
      t: makeTranslate(zh) as RoomComposerProps['t'],
    })
    const strip = screen.getByTestId('room-queue-strip')
    expect(strip.textContent).toContain('2 条排队消息')
    fireEvent.click(screen.getByRole('button', { name: /排队消息/ }))
    expect(screen.getByText('第一条跟进')).toBeDefined()
    expect(screen.getByText('第二条跟进')).toBeDefined()
    expect(screen.queryByText('steering 不算')).toBeNull()
  })

  it('renders a single queued message directly and nothing for an empty queue', async () => {
    await bench(vi.fn(), {
      session: { running: true, queue: [{ id: 'q1', placement: 'queued', preview: '唯一一条' }] },
    })
    expect(screen.getByTestId('room-queue-strip').textContent).toContain('唯一一条')
    cleanup()
    await bench(vi.fn())
    expect(screen.queryByTestId('room-queue-strip')).toBeNull()
  })
})
