// @vitest-environment jsdom
/**
 * The side-chat surfaces under composed-props fakes: the tab body's mount →
 * fetch → render chain (empty state, transcript, ref chips), the send flow
 * (⌘⏎ chord, textarea clear, state update), the IME composition hard stop,
 * the running poll, the navigation-params context switch, the host-missing
 * notice; M2's ref-chip inline expansion, the context selector with its
 * unread marks, the floating dock (store-driven open, close-to-tab hand-off,
 * read-only without a session, drag clamping); and the quote action's
 * success/failure wiring.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SideChatViewProps, QuoteActionProps, SideChatDockProps } from '../src/client/contract.ts'
import type { SideChatTabParams } from '../src/client/definition.ts'
import { createSideChatDockStore } from '../src/client/dock-store.ts'
import { zh } from '../src/client/locales.ts'
import { QuoteAction } from '../src/client/QuoteAction.tsx'
import { SideChatDock } from '../src/client/SideChatDock.tsx'
import { SideChatView } from '../src/client/SideChatView.tsx'
import type { SideChatState, SideChatStateOutcome, SideChatQuoteOutcome, SideChatListResult } from '../src/types.ts'

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** A plain translate over the zh dictionary (the key-set source of truth). */
const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as SideChatViewProps['t']

const EMPTY: SideChatState = { contextKey: 's-main', label: '主会话', status: 'new', refs: [], transcript: [] }

const BUSY: SideChatState = {
  contextKey: 's-main',
  label: '主会话',
  status: 'idle',
  refs: [{ label: '第一条引用', text: '引用的正文' }],
  transcript: [
    { kind: 'user', text: '这句话什么意思？', refs: [], time: 1 },
    { kind: 'tool', name: 'read', state: 'done', time: 2 },
    { kind: 'assistant', text: '意思是**这样**。', time: 3 },
  ],
}

interface ViewHarness {
  readonly mocks: {
    getState: ReturnType<typeof vi.fn>
    listContexts: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
    dockAvailable: ReturnType<typeof vi.fn>
    openDock: ReturnType<typeof vi.fn>
  }
}

/** Render the tab body over mock faces; params drives the navigation fake. */
function viewBench(
  state: SideChatState | Error = EMPTY,
  params?: SideChatTabParams,
  opts: { dockAvailable?: boolean } = {},
): ViewHarness {
  const mocks = {
    getState: vi.fn(async (): Promise<Result<SideChatStateOutcome>> => {
      if (state instanceof Error) throw state
      return { ok: true, value: { ok: true, state } }
    }),
    listContexts: vi.fn(async () => ({ ok: true, value: { items: [] as SideChatListResult['items'] } })),
    send: vi.fn(async () => ({ ok: true, value: { ok: true, state: { ...EMPTY, status: 'running' as const } } })),
    dockAvailable: vi.fn(() => opts.dockAvailable ?? true),
    openDock: vi.fn(),
  }
  const props: SideChatViewProps = {
    sessionId: 's-main' as SideChatViewProps['sessionId'],
    useSessions: (selector) => selector({ byId: { 's-main': { displayTitle: '主会话' } } } as never),
    useTabInfo: () => ({
      sidebar: { expanded: true, fullscreen: false },
      panel: { id: 'p1' },
      tab: { navigation: { address: 'dsh-page://sidechat', params, revision: 0 } },
    }) as ReturnType<SideChatViewProps['useTabInfo']>,
    t,
    getState: mocks.getState as SideChatViewProps['getState'],
    listContexts: mocks.listContexts as SideChatViewProps['listContexts'],
    send: mocks.send as SideChatViewProps['send'],
    dockAvailable: mocks.dockAvailable as SideChatViewProps['dockAvailable'],
    openDock: mocks.openDock as SideChatViewProps['openDock'],
  }
  render(<SideChatView {...props} />)
  return { mocks }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('SideChatView', () => {
  it('renders the empty state with the session display title for a not-found context', async () => {
    viewBench(EMPTY)
    await waitFor(() => expect(screen.getByText(zh['state.empty'])).toBeTruthy())
    expect(screen.getByText('主会话')).toBeTruthy()
  })

  it('renders the transcript rows, the folded tool status, and the ref chips', async () => {
    viewBench(BUSY)
    await waitFor(() => expect(screen.getByText('这句话什么意思？')).toBeTruthy())
    expect(screen.getByText(zh['tool.done'].replace('{name}', 'read'))).toBeTruthy()
    expect(screen.getByText('第一条引用')).toBeTruthy()
  })

  it('sends on ⌘⏎: the wire request, the deliberate clear, and the fresh state', async () => {
    const { mocks } = viewBench(EMPTY)
    const input = await screen.findByPlaceholderText(zh['composer.placeholder'])
    fireEvent.input(input, { target: { value: '  问题  ' } })
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))
    expect(mocks.send).toHaveBeenCalledWith('s-main', { contextKey: 's-main', text: '问题', label: '主会话' })
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(''))
  })

  it('sends on the button too, and never on a bare Enter', async () => {
    const { mocks } = viewBench(EMPTY)
    const input = await screen.findByPlaceholderText(zh['composer.placeholder'])
    fireEvent.input(input, { target: { value: '问题' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mocks.send).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: zh['composer.send'] }))
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))
  })

  it('hard-stops while an IME composition is open, resumes at compositionEnd', async () => {
    const { mocks } = viewBench(EMPTY)
    const input = await screen.findByPlaceholderText(zh['composer.placeholder'])
    fireEvent.compositionStart(input)
    fireEvent.input(input, { target: { value: '拼音' } })
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
    expect(mocks.send).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input, { target: { value: '拼音' } })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))
  })

  it('polls getState while the agent runs', async () => {
    vi.useFakeTimers()
    const { mocks } = viewBench({ ...BUSY, status: 'running' })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(mocks.getState).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(2600) })
    expect(mocks.getState.mock.calls.length).toBeGreaterThanOrEqual(3)
    for (const call of mocks.getState.mock.calls) expect(call[0]).toBe('s-main')
  })

  it('follows navigation params: the tab shows the context it was opened with', async () => {
    const { mocks } = viewBench({ ...EMPTY, contextKey: 'canvas:c1', label: '画布 A' }, { contextKey: 'canvas:c1' })
    await waitFor(() => expect(mocks.getState).toHaveBeenCalledWith('canvas:c1'))
    await waitFor(() => expect(screen.getByText('画布 A')).toBeTruthy())
  })

  it('offers the dock entry only when the overlay seat exists, and opens the dock on the current context', async () => {
    const { mocks } = viewBench(EMPTY)
    await waitFor(() => expect(screen.getByText('主会话')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: zh['dock.open'] }))
    expect(mocks.openDock).toHaveBeenCalledWith('s-main')
    cleanup()
    viewBench(EMPTY, undefined, { dockAvailable: false })
    await waitFor(() => expect(screen.getByText('主会话')).toBeTruthy())
    expect(screen.queryByRole('button', { name: zh['dock.open'] })).toBeNull()
  })

  it('reports the missing host half instead of throwing', async () => {
    viewBench(new Error('sidechat: the host half is not installed'))
    await waitFor(() => expect(screen.getByText(zh['state.hostMissing'])).toBeTruthy())
  })
})

describe('RefChips — inline expand', () => {
  it('expands a pending ref chip to the full quoted block and collapses it back', async () => {
    viewBench(BUSY)
    const chip = await screen.findByRole('button', { name: '第一条引用' })
    expect(screen.queryByText('引用的正文')).toBeNull()
    fireEvent.click(chip)
    await waitFor(() => expect(screen.getByText('引用的正文')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: zh['refs.collapse'] }))
    await waitFor(() => expect(screen.queryByText('引用的正文')).toBeNull())
  })

  it('expands a quoted ref on a transcript user row (the fold round-trips)', async () => {
    const quoted: SideChatState = {
      ...EMPTY,
      transcript: [
        { kind: 'user', text: '怎么看？', refs: [{ label: '沉默并不总是…', text: '沉默并不总是金的。' }], time: 1 },
        { kind: 'assistant', text: '这样看。', time: 2 },
      ],
    }
    viewBench(quoted)
    const chip = await screen.findByRole('button', { name: '沉默并不总是…' })
    fireEvent.click(chip)
    await waitFor(() => expect(screen.getByText('沉默并不总是金的。')).toBeTruthy())
  })
})

describe('context selector', () => {
  const K2 = {
    contextKey: 'canvas:c1', label: '画布 A', status: 'idle' as const, refs: 0,
    updatedAt: '2026-09-16T09:00:00.000Z', lastAssistantAt: 42, lastActivityAt: 42,
  }

  it('lists contexts, marks an unseen reply as unread, and switches on click', async () => {
    const { mocks } = viewBench(BUSY)
    mocks.listContexts.mockResolvedValue({ ok: true, value: { items: [K2] } })
    await waitFor(() => expect(screen.getByText('主会话')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: zh['context.switch'] }))
    const row = await screen.findByRole('option', { name: /画布 A/ })
    // The current context never carries a dot; the unseen canvas context does.
    expect(row.querySelector('[class*="unreadDot"]')).not.toBeNull()
    expect(screen.getByRole('option', { name: /主会话/ }).querySelector('[class*="unreadDot"]')).toBeNull()
    fireEvent.click(row)
    await waitFor(() => expect(mocks.getState).toHaveBeenCalledWith('canvas:c1'))
  })

  it('clears the unread mark of the context being viewed', async () => {
    // BUSY has an assistant row at time 3: viewing marks 's-main' seen to 3.
    const { mocks } = viewBench(BUSY)
    await waitFor(() => expect(screen.getByText('这句话什么意思？')).toBeTruthy())
    const K1 = { ...K2, contextKey: 's-main', label: '主会话', lastAssistantAt: 3, lastActivityAt: 3 }
    mocks.listContexts.mockResolvedValue({ ok: true, value: { items: [K1, K2] } })
    fireEvent.click(screen.getByRole('button', { name: zh['context.switch'] }))
    await screen.findByRole('option', { name: /画布 A/ })
    expect(screen.getByRole('option', { name: /主会话/ }).querySelector('[class*="unreadDot"]')).toBeNull()
  })
})

describe('SideChatDock', () => {
  interface DockHarness {
    readonly instance: ReturnType<ReturnType<typeof createSideChatDockStore>['create']>
    readonly mocks: {
      getState: ReturnType<typeof vi.fn>
      listContexts: ReturnType<typeof vi.fn>
      send: ReturnType<typeof vi.fn>
      closeToTab: ReturnType<typeof vi.fn>
    }
  }

  /** Render the dock over a real store instance and mock remote faces. */
  function dockBench(opts: { open?: boolean; current?: string | undefined } = {}): DockHarness {
    const instance = createSideChatDockStore().create(`spec-${Math.random().toString(36).slice(2)}`)
    if (opts.open === true) instance.actions.open('s-main')
    const mocks = {
      getState: vi.fn(async (): Promise<Result<SideChatStateOutcome>> => ({ ok: true, value: { ok: true, state: EMPTY } })),
      listContexts: vi.fn(async () => ({ ok: true, value: { items: [] as SideChatListResult['items'] } })),
      send: vi.fn(async () => ({ ok: true, value: { ok: true, state: EMPTY } })),
      closeToTab: vi.fn(),
    }
    const useStore = ((selector: (state: ReturnType<typeof instance.store.getSnapshot>) => unknown) =>
      // The framework's PropsStore binding, minimal: subscribe + snapshot.
       
      useSyncExternalStore(instance.store.subscribe, () => selector(instance.store.getSnapshot()))) as SideChatDockProps['useStore']
    const current = opts.current
    const props = {
      useStore,
      actions: instance.actions,
      useSessions: ((selector: (state: unknown) => unknown) =>
        selector({ current, byId: current === undefined ? {} : { [current]: { displayTitle: '主会话' } } })) as SideChatDockProps['useSessions'],
      t,
      getState: mocks.getState as SideChatDockProps['getState'],
      listContexts: mocks.listContexts as SideChatDockProps['listContexts'],
      send: mocks.send as SideChatDockProps['send'],
      closeToTab: mocks.closeToTab as SideChatDockProps['closeToTab'],
    } as SideChatDockProps
    render(<SideChatDock {...props} />)
    return { instance, mocks }
  }

  it('renders nothing while closed, and the shared panel once the store opens it', async () => {
    const { instance } = dockBench({ current: 's-main' })
    expect(document.querySelector('[class*="frame"]')).toBeNull()
    act(() => { instance.actions.open('s-main') })
    await waitFor(() => expect(screen.getByText(zh['state.empty'])).toBeTruthy())
  })

  it('close hands the context back to the tab', async () => {
    const { mocks } = dockBench({ open: true, current: 's-main' })
    await waitFor(() => expect(screen.getByText(zh['state.empty'])).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: zh['dock.backToTab'] }))
    expect(mocks.closeToTab).toHaveBeenCalledWith('s-main')
  })

  it('reads only when no session is selected', async () => {
    dockBench({ open: true, current: undefined })
    await waitFor(() => expect(screen.getByPlaceholderText(zh['dock.readonly'])).toBeTruthy())
    expect(screen.getByRole('button', { name: zh['composer.send'] })).toHaveProperty('disabled', true)
  })

  it('drags the frame by its handle, clamped into the viewport', async () => {
    const { instance } = dockBench({ open: true, current: 's-main' })
    const handle = document.querySelector('[class*="handle"]') as HTMLElement
    const before = instance.store.getSnapshot()
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: before.x + 10, clientY: before.y + 10 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300, clientY: 260 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    const after = instance.store.getSnapshot()
    expect({ x: after.x, y: after.y }).not.toEqual({ x: before.x, y: before.y })
    expect(after.x).toBeGreaterThanOrEqual(8)
    expect(after.y).toBeGreaterThanOrEqual(8)
  })
})
describe('QuoteAction', () => {
  interface QuoteHarness {
    readonly mocks: {
      quote: ReturnType<typeof vi.fn>
      openSideChat: ReturnType<typeof vi.fn>
    }
  }

  function quoteBench(outcome: Result<SideChatQuoteOutcome>): QuoteHarness {
    const mocks = {
      quote: vi.fn(async () => outcome),
      openSideChat: vi.fn(),
    }
    const props: QuoteActionProps = {
      messageId: 'm1' as QuoteActionProps['messageId'],
      sessionId: 's-main' as QuoteActionProps['sessionId'],
      quote: mocks.quote as QuoteActionProps['quote'],
      openSideChat: mocks.openSideChat,
      useSessions: ((selector: (state: unknown) => unknown) =>
        selector({ byId: { 's-main': { displayTitle: '主会话' } } })) as QuoteActionProps['useSessions'],
      t,
    } as QuoteActionProps
    render(<QuoteAction {...props} />)
    return { mocks }
  }

  it('quotes the message and surfaces the tab on success', async () => {
    const { mocks } = quoteBench({ ok: true, value: { ok: true, contextKey: 's-main', refs: 1 } })
    fireEvent.click(screen.getByRole('button', { name: zh['action.quote'] }))
    await waitFor(() => expect(screen.getByText(zh['action.quoted'])).toBeTruthy())
    expect(mocks.quote).toHaveBeenCalledWith('s-main', { messageId: 'm1', label: '主会话' })
    expect(mocks.openSideChat).toHaveBeenCalledWith('s-main')
  })

  it('shows the failure and never surfaces the tab on a rejection', async () => {
    const { mocks } = quoteBench({ ok: true, value: { ok: false, error: 'message-not-found' } })
    fireEvent.click(screen.getByRole('button', { name: zh['action.quote'] }))
    await waitFor(() => expect(screen.getByText(zh['action.quoteFailed'])).toBeTruthy())
    expect(mocks.openSideChat).not.toHaveBeenCalled()
  })
})
