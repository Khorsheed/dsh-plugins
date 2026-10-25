// @vitest-environment jsdom
/** The room composer takeover: chain selector (room election + interaction yield), mention completion, dispatch submit, bare-message release, error line, the inherited environment surfaces (Stop, todo strip, queue strip, task capsule and tag, stats row). */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { useSyncExternalStore } from 'react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RoomComposer, selectRoomComposer } from '../src/client/RoomComposer.tsx'
import type { DraftChip } from '../src/client/draft-chips.ts'
import { RoomStore, type RoomGateway } from '../src/client/room-store.ts'
import { RoomTaskTags } from '../src/client/task-tag.ts'
import { zh } from '../src/client/locales.ts'
import type {
  RoomComposerProps, RoomModelDirectory, RoomModelDirectoryState, RoomModelSelection, RoomMutationOutcome,
} from '../src/client/slots.ts'
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
  tasks: [],
  runs: [],
  deliveries: [
    { id: '3:ada', dispatchSeq: 3, memberId: 'ada', status: 'running', origin: 'human', text: '出方案', task: 'msg-1', queuedAt: 1000, startedAt: 1100 },
    { id: '4:bill', dispatchSeq: 4, memberId: 'bill', status: 'uncertain', origin: 'human', text: '查日志', task: 'msg-2', queuedAt: 1200, startedAt: 1300 },
  ],
  jobs: [
    { id: 'msg-2', number: 2, title: '查日志', messages: [{ id: 'msg-2', time: 1200, text: '@bill 查日志' }], status: 'attention', startedAt: 1200, deliveries: ['4:bill'], members: ['bill'] },
    { id: 'msg-1', number: 1, title: '出方案', messages: [{ id: 'msg-1', time: 1000, text: '@ada 出方案' }], status: 'running', startedAt: 1000, deliveries: ['3:ada'], members: ['ada'] },
  ],
}

/** A store pre-primed with the STATE fixture. */
async function primedStore(state: RoomState = STATE): Promise<RoomStore> {
  const list = createSnapshotStore<{ current: SessionId | undefined }>({ current: undefined })
  const gateway: RoomGateway = {
    isRoom: async () => ({ ok: true, value: true }),
    getState: async () => ({ ok: true, value: { ok: true, value: state } }),
  }
  const store = new RoomStore({ sessions: { list } } as unknown as Context, gateway)
  await store.ensure(SESSION)
  return store
}

/** The session-snapshot slice the composer's inherited duties read. */
interface SessionSlice {
  readonly running: boolean
  readonly queue: readonly { readonly id: string; readonly placement: string; readonly preview: string }[]
}

const IDLE: SessionSlice = { running: false, queue: [] }

/** The input-machine slice the composer reads and writes (the draft only). */
interface InputSlice {
  readonly draft: string
  /** The machine's reference chips (newer hosts); absent = the plain path. */
  readonly occurrences?: readonly DraftChip[]
}

type InputStore = ReturnType<typeof createSnapshotStore<InputSlice>>

interface Bench {
  roomStore: RoomStore
  area: HTMLTextAreaElement
  /**
   * The fake official input machine: setDraft writes the store (the draft IS
   * the machine now), submit must NEVER be called (busy admission stays out
   * of the dispatch path), persistDraft is a best-effort flush spy.
   */
  inputActions: { setDraft: ReturnType<typeof vi.fn>; submit: ReturnType<typeof vi.fn>; persistDraft: ReturnType<typeof vi.fn> }
  /** The machine's store — external writers (the quote path) push into it. */
  inputStore: InputStore
  /** The injected main-agent turn Stop (stubbed). */
  stop: ReturnType<typeof vi.fn>
  /** Re-render with some props replaced. */
  rerenderWith: (patch: Partial<RoomComposerProps>) => void
}

/** Render the composer with the framework shares stubbed (a stateful fake input machine backs the draft; stop is a spy). */
async function bench(
  submit: (sessionId: SessionId, text: string, targets?: readonly string[], task?: string) => Promise<RoomMutationOutcome>,
  options: {
    useProjection?: UseProjection | undefined
    t?: RoomComposerProps['t']
    session?: SessionSlice
    state?: RoomState
    /** Prime (or share, across remounts) the machine's draft. */
    inputStore?: InputStore
    renderMemberConfiguration?: RoomComposerProps['renderMemberConfiguration']
    renderMemberInbox?: RoomComposerProps['renderMemberInbox']
    stopMember?: (name: string) => void
    modelDirectory?: RoomModelDirectory
    openTasks?: (task?: string) => void
    taskTags?: RoomTaskTags
    /** Extra input actions (the chip-mode span edit). */
    extraInputActions?: Record<string, unknown>
    openReference?: (source: string, ref: string) => boolean
    listSessions?: RoomComposerProps['listSessions']
    insertSessionReference?: RoomComposerProps['insertSessionReference']
  } = {},
): Promise<Bench> {
  const roomStore = await primedStore(options.state)
  const inputStore = options.inputStore ?? createSnapshotStore<InputSlice>({ draft: '' })
  const inputActions = {
    setDraft: vi.fn((text: string) => { inputStore.set({ draft: text }) }),
    submit: vi.fn(),
    persistDraft: vi.fn(),
    ...options.extraInputActions,
  }
  // The session standard kit's useInput: a reactive selector over the fake machine.
  const useInput = (<T,>(selector: (snapshot: InputSlice) => T): T =>
    // eslint-disable-next-line react-hooks/rules-of-hooks -- the framework hook contract, faked
    useSyncExternalStore(inputStore.subscribe, () => selector(inputStore.getSnapshot()))) as unknown as RoomComposerProps['useInput']
  const stop = vi.fn()
  const slice = options.session ?? IDLE
  const useSession = (<T,>(selector: (snapshot: SessionSlice) => T): T => selector(slice)) as unknown as RoomComposerProps['useSession']
  const props = {
    sessionId: SESSION,
    matched: { room: true },
    inputActions,
    useInput,
    roomStore,
    submit,
    stop,
    setGoal: vi.fn(async () => ({ ok: true as const })),
    openTasks: options.openTasks,
    taskTags: options.taskTags,
    roomCwd: '/home/user/room',
    invite: vi.fn(async () => ({ ok: true as const, pendingFirstTask: false })),
    listProviders: vi.fn(async () => ({ localAgentAvailable: true, providers: [] })),
    browseDirectory: vi.fn(async () => null),
    renderMemberConfiguration: options.renderMemberConfiguration,
    renderMemberInbox: options.renderMemberInbox,
    stopMember: options.stopMember,
    modelDirectory: options.modelDirectory,
    openReference: options.openReference,
    listSessions: options.listSessions,
    insertSessionReference: options.insertSessionReference,
    useSession,
    // Default: a projection seat that serves nothing (no stats row, no todo strip).
    useProjection: options.useProjection === undefined
      ? (() => undefined) as unknown as UseProjection
      : options.useProjection,
    t: options.t ?? ((key: string) => key),
  } as unknown as RoomComposerProps
  const rendered = render(<RoomComposer {...props} />)
  const area = screen.getByRole('textbox') as HTMLTextAreaElement
  /** Re-render with some props replaced (a fresh injected face). */
  const rerenderWith = (patch: Partial<RoomComposerProps>): void => { rendered.rerender(<RoomComposer {...props} {...patch} />) }
  return { roomStore, area, inputActions, inputStore, stop, rerenderWith }
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

  it('lists other sessions under the members — recent five (rooms marked) — and inserts a picked one as the host\'s chip', async () => {
    const sessions = [
      { sessionId: 's1', label: '开发剪辑插件', mention: '@[开发剪辑插件](dsh-session:czE)', createdAt: Date.now() },
      { sessionId: 'room-2', label: '读书会', mention: '@[读书会](dsh-session:x)', room: true },
      { sessionId: 's2', label: '山海经 3D 游戏共创', mention: '@[山海经](dsh-session:y)' },
      ...['a', 'b', 'c', 'd', 'e'].map(id => ({ sessionId: id, label: `会话 ${id}`, mention: `@[${id}](dsh-session:${id})` })),
    ]
    const listSessions = vi.fn(async () => sessions)
    const insertSessionReference = vi.fn(() => true)
    const { area } = await bench(vi.fn(), { listSessions, insertSessionReference, extraInputActions: { captureInsertion: () => ({ start: 0, end: 0, draftRev: 7 }), insertText: vi.fn() } })
    type(area, '去问问 @')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3 + 5))
    expect(screen.getByText('composer.at.members')).toBeDefined()
    expect(screen.getByText('composer.at.recent')).toBeDefined()
    expect(screen.getByText('composer.at.more')).toBeDefined()
    expect(screen.getByText('读书会').parentElement!.textContent).toContain('composer.at.room')

    // Fuzzy: the characters in order find the title.
    type(area, '去问问 @剪插')
    await waitFor(() => expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([expect.stringContaining('开发剪辑插件')]))
    fireEvent.keyDown(area, { key: 'Enter' })
    expect(insertSessionReference).toHaveBeenCalledWith(sessions[0], { start: 4, end: 7, draftRev: 7 })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('lists a room folded; → shows its members and picking one inserts the room under a 「成员（房间）」 label', async () => {
    const room = { sessionId: 'z', label: '游戏开发', mention: '@[游戏开发](dsh-session:eg)', room: true, members: [{ name: '游戏大师', kind: 'cli', provider: 'claude-local' }] }
    const insertSessionReference = vi.fn(() => true)
    const { area } = await bench(vi.fn(), { listSessions: vi.fn(async () => [room]), insertSessionReference, extraInputActions: { captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }), insertText: vi.fn() } })
    type(area, '@')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(4))
    expect(screen.getAllByRole('option')[3]!.textContent).toContain('composer.at.room')
    for (let step = 0; step < 3; step += 1) fireEvent.keyDown(area, { key: 'ArrowDown' })
    fireEvent.keyDown(area, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(5))
    fireEvent.keyDown(area, { key: 'ArrowDown' })
    fireEvent.keyDown(area, { key: 'Enter' })
    expect(insertSessionReference).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'z', mention: '@[游戏大师（游戏开发）](dsh-session:eg)', displayTitle: '游戏大师（游戏开发）' }), { start: 0, end: 1, draftRev: 1 })
  })

  it('puts sessions kept on the member list in the members group, as the host\'s session mention', async () => {
    const insertSessionReference = vi.fn(() => true)
    const state = { members: [{ id: 'm-main', name: 'main', kind: 'main-agent', invitedBy: 'human' }], relays: [], tasks: [], runs: [], linked: [{ sessionId: 's1', title: '开发剪辑插件', time: 0 }] } as unknown as RoomState
    const { area } = await bench(vi.fn(), { state, listSessions: vi.fn(async () => [{ sessionId: 's1', label: '开发剪辑插件', mention: 'x' }]), insertSessionReference, extraInputActions: { captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }), insertText: vi.fn() } })
    type(area, '@开')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    expect(screen.getByRole('option').textContent).toContain('team.external.linked')
    fireEvent.keyDown(area, { key: 'Enter' })
    expect(insertSessionReference).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', mention: `@[开发剪辑插件](dsh-session:${Buffer.from(JSON.stringify('s1')).toString('base64url')})` }), expect.anything())
  })

  it('a re-render with a fresh face (the room ticks every second) does not cancel the session lookup', async () => {
    let resolve!: (rows: unknown[]) => void
    const listSessions = vi.fn(() => new Promise<never>((res) => { resolve = res as never }))
    const { area, rerenderWith } = await bench(vi.fn(), { listSessions })
    type(area, '@')
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(1))
    const signal = (listSessions.mock.calls[0] as unknown as [string, AbortSignal])[1]
    // The room's per-second tick re-renders with a freshly built face.
    rerenderWith({ listSessions: vi.fn(async () => []) })
    expect(signal.aborted).toBe(false)
    resolve([{ sessionId: 's1', label: '开发剪辑插件', mention: 'x' }])
    await waitFor(() => expect(screen.getByText('开发剪辑插件')).toBeDefined())
  })

  it('falls back to the mention text when the host takes no chip', async () => {
    const listSessions = vi.fn(async () => [{ sessionId: 's1', label: '开发剪辑插件', mention: '@[开发剪辑插件](dsh-session:czE)' }])
    const { area } = await bench(vi.fn(), { listSessions })
    type(area, '@开发')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    fireEvent.keyDown(area, { key: 'Enter' })
    expect(area.value).toBe('@[开发剪辑插件](dsh-session:czE) ')
  })

  it('submits an @-message as a dispatch and clears the draft', async () => {
    const submit = vi.fn(async (): Promise<RoomMutationOutcome> => ({ ok: true }))
    const { area, inputActions } = await bench(submit)
    type(area, '@ada 出方案')
    fireEvent.keyDown(area, { key: 'Enter' })
    await waitFor(() => { expect(submit).toHaveBeenCalledWith(SESSION, '@ada 出方案') })
    await waitFor(() => { expect(area.value).toBe('') })
    // The draft lives in the official machine: typing wrote it there and the
    // successful send cleared it there. The SUBMISSION never touches the
    // machine — busy admission stays out of the dispatch path.
    expect(inputActions.setDraft).toHaveBeenLastCalledWith('')
    expect(inputActions.submit).not.toHaveBeenCalled()
  })

  it('routes bare input through the room service', async () => {
    const submit = vi.fn(async (): Promise<RoomMutationOutcome> => ({ ok: true }))
    const { area, inputActions } = await bench(submit)
    type(area, '随便聊聊')
    fireEvent.keyDown(area, { key: 'Enter' })
    await waitFor(() => { expect(area.value).toBe('') })
    // Bare text dispatches through the room Remote (the host routes it to the
    // current coordinator) — the official machine carries the draft only,
    // never the submission.
    expect(inputActions.submit).not.toHaveBeenCalled()
    expect(submit).toHaveBeenCalledWith(SESSION, '随便聊聊')
  })

  it('reflects external machine-draft writes (the quote path) in the textarea', async () => {
    const inputStore = createSnapshotStore<InputSlice>({ draft: '' })
    const { area } = await bench(vi.fn(), { inputStore })
    expect(area.value).toBe('')
    // An external writer — quote-anything's 引用到当前会话 — drives the same
    // official input machine the fallback bar renders; the takeover follows.
    act(() => { inputStore.set({ draft: '> 况开场，从展开 Thinking 的日常体验切入。\n> —— 引用自「大模型心理学文章初稿组织」' }) })
    expect(area.value).toBe('> 况开场，从展开 Thinking 的日常体验切入。\n> —— 引用自「大模型心理学文章初稿组织」')
  })

  it('keeps the draft across a remount (the machine owns it, not the component)', async () => {
    const inputStore = createSnapshotStore<InputSlice>({ draft: '' })
    const first = await bench(vi.fn(), { inputStore })
    type(first.area, '写到一半')
    cleanup()
    const second = await bench(vi.fn(), { inputStore })
    expect(second.area.value).toBe('写到一半')
  })

  it('triggers the menu on a whitespace-preceded @ anywhere (line start, mid-sentence, sentence end), never on a glued @', async () => {
    const { area } = await bench(vi.fn())
    // Mid-sentence, whitespace-preceded.
    type(area, '让 @')
    expect(screen.getAllByRole('option')).toHaveLength(3)
    // Sentence end after CJK prose.
    type(area, '你现在在哪个目录 @')
    expect(screen.getAllByRole('option')).toHaveLength(3)
    // A glued @ (an email-style token) never opens the menu.
    type(area, '邮我 a@b')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('matches a CJK member prefix mid-sentence', async () => {
    const state: RoomState = {
      ...STATE,
      members: [...STATE.members, { name: 'K酱', kind: 'cli', provider: 'kimi', invitedBy: 'human' }],
    }
    const { area } = await bench(vi.fn(), { state })
    type(area, '你现在在哪个目录 @K')
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]!.textContent).toContain('K酱')
  })

  it('a menu pick mid-sentence addresses the member and dispatches the text verbatim', async () => {
    const submit = vi.fn(async (): Promise<RoomMutationOutcome> => ({ ok: true }))
    const { area, inputActions } = await bench(submit)
    type(area, 'K酱 你在哪个目录 @')
    // The mouse path: pick bill (third roster row) from the menu.
    fireEvent.mouseDown(screen.getAllByRole('option')[2]!)
    expect(area.value).toBe('K酱 你在哪个目录 @bill ')
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.keyDown(area, { key: 'Enter' })
    await waitFor(() => {
      expect(submit).toHaveBeenCalledWith(SESSION, 'K酱 你在哪个目录 @bill', ['bill'])
    })
    await waitFor(() => { expect(area.value).toBe('') })
    expect(inputActions.submit).not.toHaveBeenCalled()
  })

  it('a hand-typed mid-sentence mention stays prose for the coordinator', async () => {
    const submit = vi.fn(async (): Promise<RoomMutationOutcome> => ({ ok: true }))
    const { area, inputActions } = await bench(submit)
    // The caret sits after 吧: no active mention, Enter sends. The @ada inside
    // the sentence is prose, not addressing.
    type(area, '你去问 @ada 吧')
    fireEvent.keyDown(area, { key: 'Enter' })
    await waitFor(() => { expect(submit).toHaveBeenCalledWith(SESSION, '你去问 @ada 吧') })
    expect(inputActions.submit).not.toHaveBeenCalled()
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

  it('Enter while an IME composes (or the one closing it) commits the candidate, never sends', async () => {
    const submit = vi.fn(async () => ({ ok: true as const }))
    const { area } = await bench(submit)
    type(area, 'dsh')
    fireEvent.compositionStart(area)
    fireEvent.keyDown(area, { key: 'Enter', isComposing: true })
    fireEvent.compositionEnd(area)
    // Safari: the closing keydown arrives after compositionend.
    fireEvent.keyDown(area, { key: 'Enter' })
    fireEvent.keyUp(area, { key: 'Enter' })
    fireEvent.keyDown(area, { key: 'Enter', keyCode: 229 })
    expect(submit).not.toHaveBeenCalled()
    fireEvent.keyDown(area, { key: 'Enter' })
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce())
  })

  it('renders the task capsule above the card; it and the amber attention capsule open the task page', async () => {
    const openTasks = vi.fn()
    await bench(vi.fn(), { openTasks, t: makeTranslate(zh) as RoomComposerProps['t'] })
    const taskCapsule = screen.getByTestId('room-task-capsule')
    expect(taskCapsule.textContent).toBe('1 个任务进行中')
    // The capsule sits before the composer card's textarea in tree order.
    const area = screen.getByRole('textbox')
    expect(taskCapsule.compareDocumentPosition(area) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(taskCapsule)
    expect(openTasks).toHaveBeenLastCalledWith()
    // The uncertain delivery needs the human: straight to its task.
    fireEvent.click(screen.getByRole('button', { name: '⚠ 1 件需要处理' }))
    expect(openTasks).toHaveBeenLastCalledWith('msg-2')
  })

  it('names the coordinator a bare message goes to, with its provider', async () => {
    await bench(vi.fn(), { t: makeTranslate(zh) as RoomComposerProps['t'] })
    // STATE has no coordinator record: the room's own agent (main) coordinates.
    expect(screen.getByText('main')).toBeDefined()
    expect(screen.getByText('· 协调者 · DSH')).toBeDefined()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).placeholder).toBe('跟main对话；@ 指定其他成员')
  })

  it('a fresh room shows only the invite capsule', async () => {
    await bench(vi.fn(), { state: { ...STATE, deliveries: [], jobs: [] }, openTasks: vi.fn() })
    expect(screen.getByRole('button', { name: 'members.invite' })).toBeDefined()
    expect(screen.queryByTestId('room-task-capsule')).toBeNull()
  })

  it('the task tag rides the next send as its task and clears; removing it leaves the filing to dsh', async () => {
    const taskTags = new RoomTaskTags()
    const submit = vi.fn(async () => ({ ok: true as const }))
    const { area } = await bench(submit, { taskTags })
    act(() => { taskTags.set(SESSION, { task: 'msg-1', label: '任务 1' }) })
    expect(screen.getByText('任务 1')).toBeDefined()
    expect(document.activeElement).toBe(area)
    type(area, '再补一个接口')
    fireEvent.keyDown(area, { key: 'Enter' })
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith(SESSION, '再补一个接口', [], 'msg-1'))
    await vi.waitFor(() => expect(screen.queryByText('任务 1')).toBeNull())

    act(() => { taskTags.set(SESSION, { task: 'new', label: '新任务' }) })
    fireEvent.click(screen.getByRole('button', { name: 'job.tagRemove' }))
    expect(screen.queryByText('新任务')).toBeNull()
    type(area, '随便聊聊')
    fireEvent.keyDown(area, { key: 'Enter' })
    await vi.waitFor(() => expect(submit).toHaveBeenLastCalledWith(SESSION, '随便聊聊'))
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
    const inputStore = createSnapshotStore<InputSlice>({ draft: '' })
    const useSession = (<T,>(selector: (snapshot: SessionSlice) => T): T => selector(IDLE)) as unknown as RoomComposerProps['useSession']
    const props = {
      sessionId: SESSION,
      matched: { room: true },
      inputActions: { setDraft: vi.fn(), submit: vi.fn(), persistDraft: vi.fn() },
      useInput: (<T,>(selector: (snapshot: InputSlice) => T): T =>
        // eslint-disable-next-line react-hooks/rules-of-hooks -- the framework hook contract, faked
        useSyncExternalStore(inputStore.subscribe, () => selector(inputStore.getSnapshot()))) as unknown as RoomComposerProps['useInput'],
      roomStore,
      submit: vi.fn(),
      stop: vi.fn(),
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

/** A minimal chain-currency owner: no pending interaction, an ordinary session. */
function owner(overrides: Partial<ComposerChainProps> = {}): ComposerChainProps {
  return {
    pendingInteraction: undefined,
    sessionId: SESSION,
    ...overrides,
  }
}

describe('selectRoomComposer', () => {
  it('elects a cached room session and declines a cache miss or a sessionless owner', () => {
    const cached = (id: SessionId): boolean => id === SESSION
    expect(selectRoomComposer(owner(), cached)).toEqual({ room: true })
    expect(selectRoomComposer(owner(), () => false)).toBeNull()
    expect(selectRoomComposer(owner({ sessionId: undefined }), cached)).toBeNull()
  })

  it('declines while an interaction is pending — the ApprovalPanel elects at priority 1', () => {
    const pending = owner({ pendingInteraction: { kind: 'question' } as never })
    expect(selectRoomComposer(pending, () => true)).toBeNull()
  })
})

describe('RoomComposer inherited environment duties', () => {
  it('keeps Send beside Stop while the coordinator runs and stops only the current turn', async () => {
    const { stop } = await bench(vi.fn(), {
      session: { running: true, queue: [] },
      t: makeTranslate(zh) as RoomComposerProps['t'],
    })
    expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(true)
    const stopButton = screen.getByRole('button', { name: '停止生成' }) as HTMLButtonElement
    expect(stopButton.disabled).toBe(false)
    fireEvent.click(stopButton)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('accepts bare messages through the room while the coordinator is running', async () => {
    const submit = vi.fn(async (): Promise<RoomMutationOutcome> => ({ ok: true }))
    const { area, inputActions } = await bench(submit, { session: { running: true, queue: [] } })
    type(area, '排队等我')
    fireEvent.keyDown(area, { key: 'Enter' })
    await waitFor(() => { expect(area.value).toBe('') })
    expect(inputActions.submit).not.toHaveBeenCalled()
    expect(submit).toHaveBeenCalledWith(SESSION, '排队等我')
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

  it('renders the queued-messages strip from the legacy snapshot queue on 0.1.5 hosts (count header over one)', async () => {
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

  it('renders the queued-messages strip from the inbox projection on alpha.2 hosts', async () => {
    const useProjection = ((key: string) => key === 'inbox'
      ? {
        'next-turn': [
          { id: 'q1', content: [{ type: 'text', text: '第一条跟进' }], source: { kind: 'user' } },
          // Attachment blocks drop out of the preview; other non-text blocks flatten to [type].
          {
            id: 'q2',
            content: [
              { type: 'text', text: '带图  跟进' },
              { type: 'image', attachment: { attachmentId: 'a1' } },
              { type: 'tool_reference' },
            ],
            source: { kind: 'user', rpcId: 'r2' },
          },
        ],
        'next-step': [],
      }
      : undefined) as unknown as UseProjection
    await bench(vi.fn(), {
      // A legacy queue alongside the projection is shadowed — the projection wins.
      session: { running: true, queue: [{ id: 'legacy', placement: 'queued', preview: '旧队列不应出现' }] },
      useProjection,
      t: makeTranslate(zh) as RoomComposerProps['t'],
    })
    const strip = screen.getByTestId('room-queue-strip')
    expect(strip.textContent).toContain('2 条排队消息')
    fireEvent.click(screen.getByRole('button', { name: /排队消息/ }))
    expect(screen.getByText('第一条跟进')).toBeDefined()
    expect(screen.getByText('带图 跟进 [tool_reference]')).toBeDefined()
    expect(screen.queryByText('旧队列不应出现')).toBeNull()
  })

  it('a served-but-empty inbox projection hides the strip and shadows the legacy queue', async () => {
    const useProjection = ((key: string) => key === 'inbox'
      ? { 'next-turn': [], 'next-step': [] }
      : undefined) as unknown as UseProjection
    await bench(vi.fn(), {
      session: { running: true, queue: [{ id: 'q1', placement: 'queued', preview: '旧队列' }] },
      useProjection,
    })
    expect(screen.queryByTestId('room-queue-strip')).toBeNull()
  })

  it('renders a single legacy queued message directly and nothing for an empty queue', async () => {
    await bench(vi.fn(), {
      session: { running: true, queue: [{ id: 'q1', placement: 'queued', preview: '唯一一条' }] },
    })
    expect(screen.getByTestId('room-queue-strip').textContent).toContain('唯一一条')
    cleanup()
    await bench(vi.fn())
    expect(screen.queryByTestId('room-queue-strip')).toBeNull()
  })
})

/** A stubbed official per-session directory: the shared store is real, select/load are spies. */
function modelDirectory(over: Partial<RoomModelDirectoryState> = {}) {
  const store = createSnapshotStore<RoomModelDirectoryState>({
    current: { provider: 'p1', model: 'm1' },
    groups: [
      {
        id: 'p1',
        name: 'Provider One',
        models: [
          { id: 'm1', name: 'Model One' },
          { id: 'm2', name: 'Model Two' },
        ],
      },
    ],
    status: 'ready',
    error: null,
    ...over,
  })
  return {
    store,
    load: vi.fn(async () => store.getSnapshot()),
    // Promise<unknown>: the both-lines face (0.1.5 resolves void, alpha.2 a RemoteResult).
    select: vi.fn(async (selection: RoomModelSelection): Promise<unknown> => {
      store.set({ ...store.getSnapshot(), current: selection })
      return undefined
    }),
  }
}

describe('RoomComposer main-agent model picker', () => {
  it('renders no picker when the modelDirectories service is absent (silent degrade)', async () => {
    await bench(vi.fn())
    expect(screen.queryByRole('button', { name: 'composer.model.picker' })).toBeNull()
  })

  it('shows the current selection on the trigger, immediately before the send circle', async () => {
    await bench(vi.fn(), { modelDirectory: modelDirectory() })
    const trigger = screen.getByRole('button', { name: 'composer.model.picker' })
    expect(trigger.textContent).toContain('Model One')
    // The official composer's order: model seat → send, adjacent siblings.
    expect(trigger.parentElement!.nextElementSibling).toBe(screen.getByRole('button', { name: 'composer.send' }))
  })

  it('lists the directory models in the drilled-in model pane', async () => {
    await bench(vi.fn(), { modelDirectory: modelDirectory() })
    fireEvent.click(screen.getByRole('button', { name: 'composer.model.picker' }))
    // The root pane is the Model / Effort cell pair; drill into the model list.
    fireEvent.click(screen.getByRole('menuitem', { name: /composer\.model\.menu\.model/ }))
    const options = screen.getAllByRole('menuitemradio')
    expect(options.map(option => option.textContent)).toEqual(['Model One', 'Model Two'])
    // The current selection carries the checked radio.
    expect(options[0]!.getAttribute('aria-checked')).toBe('true')
    expect(options[1]!.getAttribute('aria-checked')).toBe('false')
  })

  it('selects through directory.select and re-labels from the shared store', async () => {
    const directory = modelDirectory()
    await bench(vi.fn(), { modelDirectory: directory })
    const trigger = screen.getByRole('button', { name: 'composer.model.picker' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /composer\.model\.menu\.model/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Model Two' }))

    await waitFor(() => { expect(trigger.textContent).toContain('Model Two') })
    expect(directory.select).toHaveBeenCalledWith({ provider: 'p1', model: 'm2' })
  })

  it('shows the effort suffix in the trigger when the directory exposes reasoning metadata', async () => {
    const directory = modelDirectory({
      current: { provider: 'p1', model: 'm1', reasoningEffort: 'high' },
      groups: [
        {
          id: 'p1',
          name: 'Provider One',
          models: [
            {
              id: 'm1',
              name: 'Model One',
              reasoning: { efforts: [{ id: 'high', name: 'High' }, { id: 'low', name: 'Low' }] },
            },
          ],
        },
      ],
    })
    await bench(vi.fn(), { modelDirectory: directory })
    expect(screen.getByRole('button', { name: 'composer.model.picker' }).textContent).toContain('High')
  })

  it('surfaces a refused switch on the composer error line', async () => {
    const directory = modelDirectory()
    directory.select.mockRejectedValue(new Error('selectModel failed'))
    await bench(vi.fn(), { modelDirectory: directory, t: makeTranslate(zh) as RoomComposerProps['t'] })
    fireEvent.click(screen.getByRole('button', { name: zh['composer.model.picker'] }))
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(zh['composer.model.menu.model']) }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Model Two' }))
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toBe(zh['composer.model.failed'])
  })

  it('surfaces a refused switch answered as a settled RemoteResult (alpha.2 semantics) and keeps the menu open', async () => {
    const directory = modelDirectory()
    directory.select.mockResolvedValue({ ok: false, error: { code: 'session/writer-held', message: 'held' } })
    await bench(vi.fn(), { modelDirectory: directory, t: makeTranslate(zh) as RoomComposerProps['t'] })
    fireEvent.click(screen.getByRole('button', { name: zh['composer.model.picker'] }))
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(zh['composer.model.menu.model']) }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Model Two' }))
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toBe(zh['composer.model.failed'])
    // The failure branch never closes the menu (a mistaken close was the alpha.2 regression).
    expect(screen.getByRole('menu')).toBeDefined()
  })

  it('a settled ok RemoteResult closes the menu (alpha.2 success)', async () => {
    const directory = modelDirectory()
    directory.select.mockResolvedValue({ ok: true, value: undefined })
    await bench(vi.fn(), { modelDirectory: directory, t: makeTranslate(zh) as RoomComposerProps['t'] })
    fireEvent.click(screen.getByRole('button', { name: zh['composer.model.picker'] }))
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(zh['composer.model.menu.model']) }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Model Two' }))
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})


describe('external coordinator composer', () => {
  it('binds configuration and Stop to the coordinator and hides the former native todo/queue', async () => {
    const stopMember = vi.fn()
    const renderMemberConfiguration = vi.fn((id: string) => <div>Configuration for {id}</div>)
    const renderMemberInbox = vi.fn((id: string) => <div>Inbox for {id}</div>)
    const state: RoomState = { ...STATE,
      members: STATE.members.map(member => ({ ...member, id: member.name, ...member.name === 'ada' ? { childSessionId: 'child-ada' as SessionId } : {} })),
      coordinator: { version: 1, memberId: 'ada', previousMemberId: 'main', revision: 1, handoff: 'goal' },
      runs: [{ member: 'ada', state: 'running', startedAt: Date.now() }],
    }
    const submit = vi.fn(async () => ({ ok: true as const }))
    const { area, stop, inputActions } = await bench(submit, { state, stopMember, renderMemberConfiguration, renderMemberInbox,
      session: { running: true, queue: [{ id: 'old', placement: 'queued', preview: 'old DSH input' }] },
      useProjection: (() => [{ content: 'old DSH todo', status: 'in_progress' }]) as unknown as UseProjection,
    })
    expect(screen.getByText('Configuration for child-ada')).toBeDefined()
    expect(screen.getByText('Inbox for child-ada')).toBeDefined()
    expect(screen.queryByText('old DSH todo')).toBeNull()
    expect(screen.queryByText('old DSH input')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'composer.stop' }))
    expect(stopMember).toHaveBeenCalledWith('ada')
    expect(stop).not.toHaveBeenCalled()
    type(area, 'next coordinator input')
    fireEvent.click(screen.getByRole('button', { name: 'composer.send' }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith(SESSION, 'next coordinator input'))
    expect(inputActions.submit).not.toHaveBeenCalled()
  })
})

/**
 * A fake chip-aware machine: the draft is the clipboard projection, chips
 * fold to one character in detect coordinates, and `insertText` replaces a
 * detect span (deleting any chip inside it) under the revision CAS — the
 * host editor's contract, reduced to strings.
 */
function chipMachine(draft: string, chips: readonly DraftChip[]) {
  const inputStore = createSnapshotStore<InputSlice>({ draft, occurrences: chips })
  let rev = 0
  /** Detect index → clipboard index (a span edge never sits inside a chip). */
  const toClipboard = (detect: number, list: readonly DraftChip[]): number => {
    let shift = 0
    for (const item of list) {
      const at = item.offset - shift
      if (detect <= at) break
      shift += item.length - 1
    }
    return detect + shift
  }
  const insertText = vi.fn((text: string, span: { start: number; end: number; draftRev: number }) => {
    if (span.draftRev !== rev) return false
    const current = inputStore.getSnapshot()
    const list = current.occurrences ?? []
    const start = toClipboard(span.start, list)
    const end = toClipboard(span.end, list)
    const delta = text.length - (end - start)
    const next = list
      .filter(item => item.offset + item.length <= start || item.offset >= end)
      .map(item => item.offset >= end ? { ...item, offset: item.offset + delta } : item)
    rev += 1
    inputStore.set({ draft: current.draft.slice(0, start) + text + current.draft.slice(end), occurrences: next })
    return true
  })
  const captureInsertion = () => ({ start: 0, end: 0, draftRev: rev })
  return { inputStore, extraInputActions: { insertText, captureInsertion }, insertText }
}

describe('RoomComposer reference chips (chip-aware hosts)', () => {
  const QUOTE = '> 滚轮拉远拉近。\n> —— 引用\n'
  const quoteChip: DraftChip = { occurrenceId: 1, source: 'quote', ref: '{"v":1}', offset: 0, length: QUOTE.length, label: '引用「滚轮拉远拉近。」' }

  it('shows a chip row and only the typed text; typing after it keeps the chip', async () => {
    const machine = chipMachine(`${QUOTE} `, [quoteChip])
    const { area } = await bench(vi.fn(), { inputStore: machine.inputStore, extraInputActions: machine.extraInputActions })
    expect(screen.getByRole('button', { name: /引用「滚轮拉远拉近。」/ })).toBeTruthy()
    // The raw quote block never shows in the textarea — only the chip's trailing space.
    expect(area.value).toBe(' ')
    type(area, ' 镜头太晃')
    expect(machine.inputStore.getSnapshot()).toEqual({
      draft: `${QUOTE} 镜头太晃`,
      occurrences: [quoteChip],
    })
    expect(area.value).toBe(' 镜头太晃')
  })

  it('sends the full projection (the quote text included) through room dispatch', async () => {
    const submit = vi.fn(async () => ({ ok: true as const }))
    const machine = chipMachine(`${QUOTE} 镜头太晃`, [quoteChip])
    const { area } = await bench(submit, { inputStore: machine.inputStore, extraInputActions: machine.extraInputActions })
    fireEvent.keyDown(area, { key: 'Enter' })
    await waitFor(() => expect(submit).toHaveBeenCalledWith(SESSION, `${QUOTE} 镜头太晃`.trim()))
  })

  it('✕ removes the chip and keeps the typed text; a click previews through its source', async () => {
    const openReference = vi.fn(() => true)
    const machine = chipMachine(`${QUOTE} 镜头太晃`, [quoteChip])
    const { area } = await bench(vi.fn(), { inputStore: machine.inputStore, extraInputActions: machine.extraInputActions, openReference })
    fireEvent.click(screen.getByRole('button', { name: /引用「滚轮拉远拉近。」/ }))
    expect(openReference).toHaveBeenCalledWith('quote', '{"v":1}')
    fireEvent.click(screen.getByRole('button', { name: 'composer.chipRemove' }))
    expect(machine.inputStore.getSnapshot()).toEqual({ draft: ' 镜头太晃', occurrences: [] })
    expect(screen.queryByRole('button', { name: /引用「/ })).toBeNull()
    expect(area.value).toBe(' 镜头太晃')
  })

  it('falls back to the plain projection on a face without insertText', async () => {
    const inputStore = createSnapshotStore<InputSlice>({ draft: QUOTE, occurrences: [quoteChip] })
    const { area } = await bench(vi.fn(), { inputStore })
    expect(area.value).toBe(QUOTE)
    expect(screen.queryByRole('button', { name: /引用「/ })).toBeNull()
  })
})
