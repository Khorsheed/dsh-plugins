// @vitest-environment jsdom
/**
 * The side-chat tab body and the「引用到侧边对话」action under composed-props
 * fakes: the mount → fetch → render chain (empty state, transcript, ref
 * chips), the send flow (⌘⏎ chord, textarea clear, state update), the IME
 * composition hard stop, the running poll, the navigation-params context
 * switch, the host-missing notice, and the quote action's success/failure
 * wiring.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SideChatViewProps, QuoteActionProps } from '../src/client/contract.ts'
import type { SideChatTabParams } from '../src/client/definition.ts'
import { zh } from '../src/client/locales.ts'
import { QuoteAction } from '../src/client/QuoteAction.tsx'
import { SideChatView } from '../src/client/SideChatView.tsx'
import type { SideChatState, SideChatStateOutcome, SideChatQuoteOutcome } from '../src/types.ts'

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
    { kind: 'user', text: '这句话什么意思？', time: 1 },
    { kind: 'tool', name: 'read', state: 'done', time: 2 },
    { kind: 'assistant', text: '意思是**这样**。', time: 3 },
  ],
}

interface ViewHarness {
  readonly mocks: {
    getState: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
  }
}

/** Render the tab body over mock faces; params drives the navigation fake. */
function viewBench(state: SideChatState | Error = EMPTY, params?: SideChatTabParams): ViewHarness {
  const mocks = {
    getState: vi.fn(async (): Promise<Result<SideChatStateOutcome>> => {
      if (state instanceof Error) throw state
      return { ok: true, value: { ok: true, state } }
    }),
    send: vi.fn(async () => ({ ok: true, value: { ok: true, state: { ...EMPTY, status: 'running' as const } } })),
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
    send: mocks.send as SideChatViewProps['send'],
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

  it('reports the missing host half instead of throwing', async () => {
    viewBench(new Error('sidechat: the host half is not installed'))
    await waitFor(() => expect(screen.getByText(zh['state.hostMissing'])).toBeTruthy())
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
