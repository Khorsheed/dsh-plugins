// @vitest-environment jsdom
/**
 * The selection quote menu under composed-props fakes: the degrade matrix
 * (no selection, no current session, no side-chat — each hides its item or
 * the whole card), the three routes (composer insert with the formatted
 * block, side-chat ref + tab surface, clipboard copy), the consumed echo
 * that keeps an acted selection from re-arming the menu, the source-label
 * fallback, and contributed rows from the `ctx.quoteActions` registry
 * (rendered after the built-ins, gated per open, hot-add/dispose live). The
 * selection source is a manual fake — these tests never touch the real
 * `window.getSelection()`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { QuoteMenuProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { QuoteActionRegistryRuntime, type QuoteActionContribution } from '../src/client/registry.ts'
import type { SelectionListener, SelectionSnapshot } from '../src/client/selection.ts'
import { SelectionQuoteMenu } from '../src/client/SelectionMenu.tsx'

/** A plain translate over the zh dictionary (the key-set source of truth). */
const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as QuoteMenuProps['t']

const SNAPSHOT: SelectionSnapshot = { text: '两行\n文本', rect: { left: 100, top: 100, width: 50, height: 20 } }

interface MenuHarness {
  readonly emit: (snapshot: SelectionSnapshot | null) => void
  /** The real registry runtime feeding the menu's contributed rows. */
  readonly registry: QuoteActionRegistryRuntime
  readonly mocks: {
    sideChatAvailable: ReturnType<typeof vi.fn>
    insertQuote: ReturnType<typeof vi.fn>
    addSideChatRef: ReturnType<typeof vi.fn>
    openSideChat: ReturnType<typeof vi.fn>
    copyText: ReturnType<typeof vi.fn>
  }
}

/** Render the menu over a manual selection source and mock route faces. */
function menuBench(opts: {
  current?: string | undefined
  title?: string | undefined
  /** Render the session with no displayTitle (the source-label fallback case). */
  noTitle?: boolean
  /** Model the 0.1.6 shape: no legacy `current`; the row carries retainedBy.mainView. */
  mainView?: boolean
  sideChat?: boolean
  addRefResult?: boolean
  /** Contributions registered before render. */
  contribute?: readonly QuoteActionContribution[]
} = {}): MenuHarness {
  let listener: SelectionListener | undefined
  const mocks = {
    sideChatAvailable: vi.fn(() => opts.sideChat ?? false),
    insertQuote: vi.fn(),
    addSideChatRef: vi.fn(async () => opts.addRefResult ?? true),
    openSideChat: vi.fn(),
    copyText: vi.fn(async () => true),
  }
  const registry = new QuoteActionRegistryRuntime(vi.fn())
  for (const contribution of opts.contribute ?? []) registry.registerAction(contribution)
  const current = opts.current
  const row = current === undefined
    ? undefined
    : {
      ...opts.mainView === true ? { id: current, retainedBy: { mainView: 1 } } : {},
      ...opts.noTitle === true ? {} : { displayTitle: opts.title ?? '主会话' },
    }
  const props = {
    useSessions: ((selector: (state: unknown) => unknown) =>
      selector({
        ...opts.mainView === true ? {} : { current },
        byId: row === undefined ? {} : { [current as string]: row },
      })) as QuoteMenuProps['useSessions'],
    t,
    selection: { start: (next: SelectionListener) => { listener = next; return () => {} } },
    sideChatAvailable: mocks.sideChatAvailable,
    insertQuote: mocks.insertQuote as QuoteMenuProps['insertQuote'],
    addSideChatRef: mocks.addSideChatRef as QuoteMenuProps['addSideChatRef'],
    openSideChat: mocks.openSideChat,
    copyText: mocks.copyText,
    actions: registry,
  } as QuoteMenuProps
  render(<SelectionQuoteMenu {...props} />)
  return {
    emit: (snapshot) => { act(() => { listener?.(snapshot) }) },
    registry,
    mocks,
  }
}

afterEach(cleanup)

describe('SelectionQuoteMenu visibility (the degrade matrix)', () => {
  it('renders nothing before a selection snapshot', () => {
    menuBench({ current: 's-1', sideChat: true })
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('shows only 复制 with no current session (both route items hide)', () => {
    const { emit } = menuBench({ current: undefined, sideChat: true })
    emit(SNAPSHOT)
    expect(screen.queryByRole('button', { name: zh['menu.quoteToConversation'] })).toBeNull()
    expect(screen.queryByRole('button', { name: zh['menu.quoteToSideChat'] })).toBeNull()
    expect(screen.getByRole('button', { name: zh['menu.copy'] })).toBeTruthy()
  })

  it('hides 引用到侧边对话 when the side-chat namespaces are absent', () => {
    const { emit } = menuBench({ current: 's-1', sideChat: false })
    emit(SNAPSHOT)
    expect(screen.getByRole('button', { name: zh['menu.quoteToConversation'] })).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh['menu.quoteToSideChat'] })).toBeNull()
    expect(screen.getByRole('button', { name: zh['menu.copy'] })).toBeTruthy()
  })

  it('shows all three actions with a session and the side-chat seam wired', () => {
    const { emit } = menuBench({ current: 's-1', sideChat: true })
    emit(SNAPSHOT)
    expect(screen.getByRole('button', { name: zh['menu.quoteToConversation'] })).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['menu.quoteToSideChat'] })).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['menu.copy'] })).toBeTruthy()
  })

  it('reads the 0.1.6 main-view marker (retainedBy.mainView, no legacy current)', () => {
    const { emit, mocks } = menuBench({ current: 's-1', mainView: true, title: '主会话' })
    emit(SNAPSHOT)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.quoteToConversation'] }))
    expect(mocks.insertQuote).toHaveBeenCalledWith('s-1', '> 两行\n> 文本\n> —— 引用自「主会话」')
  })

  it('hides again when the selection collapses', () => {
    const { emit } = menuBench({ current: 's-1' })
    emit(SNAPSHOT)
    emit(null)
    expect(screen.queryByRole('toolbar')).toBeNull()
  })
})

describe('SelectionQuoteMenu routes', () => {
  it('引用到当前会话 inserts the formatted block (quote lines + attribution) and closes', () => {
    const { emit, mocks } = menuBench({ current: 's-1', title: '主会话' })
    emit(SNAPSHOT)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.quoteToConversation'] }))
    expect(mocks.insertQuote).toHaveBeenCalledWith('s-1', '> 两行\n> 文本\n> —— 引用自「主会话」')
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('引用到侧边对话 queues the ref on the session context, surfaces the tab, and closes', async () => {
    const { emit, mocks } = menuBench({ current: 's-1', title: '主会话', sideChat: true })
    emit(SNAPSHOT)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.quoteToSideChat'] }))
    expect(screen.queryByRole('toolbar')).toBeNull()
    expect(mocks.addSideChatRef).toHaveBeenCalledWith('s-1', '主会话', '两行\n文本')
    await waitFor(() => expect(mocks.openSideChat).toHaveBeenCalledWith('s-1'))
  })

  it('a side-chat refusal no-ops silently (no tab surface, no throw)', async () => {
    const { emit, mocks } = menuBench({ current: 's-1', sideChat: true, addRefResult: false })
    emit(SNAPSHOT)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.quoteToSideChat'] }))
    await waitFor(() => expect(mocks.addSideChatRef).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(mocks.openSideChat).not.toHaveBeenCalled()
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('复制 writes the selected text and closes', () => {
    const { emit, mocks } = menuBench({ current: undefined })
    emit(SNAPSHOT)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.copy'] }))
    expect(mocks.copyText).toHaveBeenCalledWith('两行\n文本')
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('falls back to the generic source label when the session has no display title', () => {
    const { emit, mocks } = menuBench({ current: 's-1', noTitle: true })
    emit(SNAPSHOT)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.quoteToConversation'] }))
    expect(mocks.insertQuote).toHaveBeenCalledWith('s-1', `> 两行\n> 文本\n> —— 引用自「${zh['source.fallback']}」`)
  })
})

describe('the consumed echo', () => {
  it('ignores the acted selection re-report, then re-arms on the next distinct selection', () => {
    const { emit } = menuBench({ current: 's-1' })
    emit(SNAPSHOT)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.copy'] }))
    expect(screen.queryByRole('toolbar')).toBeNull()
    // The click's own mouseup re-reports the still-intact selection: ignored.
    emit(SNAPSHOT)
    expect(screen.queryByRole('toolbar')).toBeNull()
    // A different selection re-arms the menu.
    emit({ text: '别的话', rect: { left: 40, top: 200, width: 30, height: 20 } })
    expect(screen.getByRole('toolbar')).toBeTruthy()
  })
})

describe('contributed actions (the ctx.quoteActions registry)', () => {
  const saveCard = (run = vi.fn()): QuoteActionContribution => ({
    id: 'canvas.save',
    label: () => '存为画布卡片',
    run,
  })

  it('renders contributed rows after the built-ins, in registration order', () => {
    const { emit } = menuBench({
      current: 's-1',
      sideChat: true,
      contribute: [saveCard(), { id: 'reader.excerpt', label: () => '摘录到灵感空间', run: vi.fn() }],
    })
    emit(SNAPSHOT)
    const ids = screen.getAllByRole('button').map(button => button.getAttribute('data-action'))
    expect(ids).toEqual(['conversation', 'sidechat', 'copy', 'canvas.save', 'reader.excerpt'])
  })

  it('a contributed row runs with the opaque target and closes the menu', () => {
    const run = vi.fn()
    const { emit } = menuBench({ current: 's-1', title: '主会话', contribute: [saveCard(run)] })
    emit(SNAPSHOT)
    fireEvent.click(screen.getByRole('button', { name: '存为画布卡片' }))
    expect(screen.queryByRole('toolbar')).toBeNull()
    expect(run).toHaveBeenCalledWith({ text: '两行\n文本', label: '主会话', sessionId: 's-1' })
  })

  it('gates contributed rows per menu open (sessionId-aware)', () => {
    const gate = vi.fn((target: { sessionId?: string }) => target.sessionId !== undefined)
    const contribution: QuoteActionContribution = { ...saveCard(), available: gate }
    const withSession = menuBench({ current: 's-1', contribute: [contribution] })
    withSession.emit(SNAPSHOT)
    expect(screen.getByRole('button', { name: '存为画布卡片' })).toBeTruthy()
    cleanup()
    const noSession = menuBench({ current: undefined, contribute: [contribution] })
    noSession.emit(SNAPSHOT)
    expect(screen.queryByRole('button', { name: '存为画布卡片' })).toBeNull()
    expect(screen.getByRole('button', { name: zh['menu.copy'] })).toBeTruthy()
    expect(gate).toHaveBeenCalled()
  })

  it('a hot-added row appears on the open menu, and its disposal removes it', () => {
    const { emit, registry } = menuBench({ current: 's-1' })
    emit(SNAPSHOT)
    expect(screen.queryByRole('button', { name: '存为画布卡片' })).toBeNull()
    let dispose: () => void = () => {}
    act(() => { dispose = registry.registerAction(saveCard()) })
    expect(screen.getByRole('button', { name: '存为画布卡片' })).toBeTruthy()
    act(() => { dispose() })
    expect(screen.queryByRole('button', { name: '存为画布卡片' })).toBeNull()
  })
})
