// @vitest-environment jsdom
/**
 * The selection quote menu under composed-props fakes: the degrade matrix
 * (no selection, no current session, no side-chat — each hides its item or
 * the whole card), the three routes (composer insert with the formatted
 * block, side-chat ref + tab surface, clipboard copy), the consumed echo
 * that keeps an acted selection from re-arming the menu, and the source-label
 * fallback. The selection source is a manual fake — these tests never touch
 * the real `window.getSelection()`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { QuoteMenuProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import type { SelectionListener, SelectionSnapshot } from '../src/client/selection.ts'
import { SelectionQuoteMenu } from '../src/client/SelectionMenu.tsx'

/** A plain translate over the zh dictionary (the key-set source of truth). */
const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as QuoteMenuProps['t']

const SNAPSHOT: SelectionSnapshot = { text: '两行\n文本', rect: { left: 100, top: 100, width: 50, height: 20 } }

interface MenuHarness {
  readonly emit: (snapshot: SelectionSnapshot | null) => void
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
  sideChat?: boolean
  addRefResult?: boolean
} = {}): MenuHarness {
  let listener: SelectionListener | undefined
  const mocks = {
    sideChatAvailable: vi.fn(() => opts.sideChat ?? false),
    insertQuote: vi.fn(),
    addSideChatRef: vi.fn(async () => opts.addRefResult ?? true),
    openSideChat: vi.fn(),
    copyText: vi.fn(async () => true),
  }
  const current = opts.current
  const props = {
    useSessions: ((selector: (state: unknown) => unknown) =>
      selector({
        current,
        byId: current === undefined
          ? {}
          : { [current]: opts.noTitle === true ? {} : { displayTitle: opts.title ?? '主会话' } },
      })) as QuoteMenuProps['useSessions'],
    t,
    selection: { start: (next: SelectionListener) => { listener = next; return () => {} } },
    sideChatAvailable: mocks.sideChatAvailable,
    insertQuote: mocks.insertQuote as QuoteMenuProps['insertQuote'],
    addSideChatRef: mocks.addSideChatRef as QuoteMenuProps['addSideChatRef'],
    openSideChat: mocks.openSideChat,
    copyText: mocks.copyText,
  } as QuoteMenuProps
  render(<SelectionQuoteMenu {...props} />)
  return {
    emit: (snapshot) => { act(() => { listener?.(snapshot) }) },
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
