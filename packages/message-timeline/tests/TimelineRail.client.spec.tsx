// @vitest-environment jsdom
/**
 * The header-utilities entry: the flat timeline panel (rows, reading-position
 * highlight, hover/focus brightening hooks, keyboard and click jumps,
 * scroll-top paging), and the conditions that keep the panel hidden.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import {
  createSnapshotStore,
  type ChatConversationViewNode, type ConversationSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import { en } from '../src/client/locales.ts'
import { TimelineRail } from '../src/client/TimelineRail.tsx'
import type { TimelineRailProps, TimelineRailState } from '../src/client/slots.ts'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  scrollIntoViewMock.mockClear()
})

// jsdom does not implement scrollIntoView; the opening-position effect calls
// it on a real element.
const scrollIntoViewMock = vi.fn()
Element.prototype.scrollIntoView = scrollIntoViewMock as never

function node(key: string, kind: 'user' | 'steering', text: string): ChatConversationViewNode {
  return {
    key, kind, target: 'chat', anchorSeq: 1,
    data: { time: 1_700_000_000_000, content: [{ type: 'text', text }] },
  } as unknown as ChatConversationViewNode
}

const NODES: Record<string, ChatConversationViewNode> = {
  k1: node('k1', 'user', '你好'),
  k2: node('k2', 'steering', '继续'),
  k3: node('k3', 'user', '谢谢'),
}

function sessionSnapshot(overrides: { order?: readonly string[]; hasMore?: boolean; loadingOlder?: boolean } = {}) {
  return {
    chat: {
      order: overrides.order ?? ['k1', 'k2', 'k3'],
      nodes: { get: (key: string) => NODES[key] },
    },
    hasMore: overrides.hasMore ?? false,
    loadingOlder: overrides.loadingOlder ?? false,
  } as unknown as ConversationSnapshot
}

const RAIL: TimelineRailState = {
  sessionId: 's1', ready: true, left: 10, top: 20, height: 300, activeKey: 'k3', chatView: true,
}

function renderRail(overrides: Partial<TimelineRailProps> = {}) {
  const sessionStore = createSnapshotStore(sessionSnapshot())
  const railStore = createSnapshotStore(RAIL)
  const jumpTo = vi.fn()
  const loadOlder = vi.fn(() => Promise.resolve())
  const props = {
    sessionId: 's1',
    useSession: bindSnapshotSelector(sessionStore),
    useRail: bindSnapshotSelector(railStore),
    jumpTo,
    loadOlder,
    includeSteering: true,
    panelWidth: 320,
    initialPages: 5,
    t: (key: keyof typeof en) => en[key],
  } as unknown as TimelineRailProps
  const view = render(<TimelineRail {...{ ...props, ...overrides }} />)
  return { view, sessionStore, railStore, jumpTo, loadOlder }
}

function items(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[data-item-key]'))
}

function panel(): HTMLElement {
  return document.body.querySelector<HTMLElement>('[data-timeline-panel]')!
}

function item(key: string): HTMLElement {
  return document.body.querySelector<HTMLElement>(`[data-item-key="${key}"]`)!
}

describe('the flat timeline panel', () => {
  it('renders one row per included user message, each a tick plus a one-line preview', () => {
    renderRail()
    expect(items()).toHaveLength(3)
    expect(panel().textContent).toContain('你好')
    expect(panel().textContent).toContain('继续')
    expect(panel().textContent).toContain('谢谢')
  })

  it('drops steering rows when includeSteering is off', () => {
    renderRail({ includeSteering: false })
    expect(items()).toHaveLength(2)
  })

  it('lights the reading position the tracker publishes', () => {
    renderRail()
    expect(item('k3').className).toContain('itemCurrent')
    expect(item('k3').getAttribute('aria-current')).toBe('true')
    expect(item('k3').querySelector('[aria-hidden]')!.className).toContain('tickCurrent')
    expect(item('k1').className).not.toContain('itemCurrent')
  })

  it('selects the latest message by default before the tracker answers', () => {
    renderRail({ useRail: bindSnapshotSelector(createSnapshotStore({ ...RAIL, activeKey: null })) })
    expect(item('k3').className).toContain('itemCurrent')
  })

  it('jumps when a row is clicked and the highlight follows the tracker', () => {
    const { jumpTo, railStore } = renderRail()
    fireEvent.click(item('k1'))
    expect(jumpTo).toHaveBeenCalledWith('k1')

    // The jump writes scrollTop; the tracker republishes the reading position
    // and the lit row settles on the jumped message.
    act(() => { railStore.set({ ...RAIL, activeKey: 'k1' }) })
    expect(item('k1').className).toContain('itemCurrent')
    expect(item('k3').className).not.toContain('itemCurrent')
  })

  it('positions itself at the reading position when it opens', () => {
    renderRail()
    expect(scrollIntoViewMock).toHaveBeenCalled()
  })

  it('follows the reading position as it moves', () => {
    const { railStore } = renderRail()
    scrollIntoViewMock.mockClear()

    // The tracker publishes a new reading position (e.g. a sent message
    // bottom-follows the chat); the panel scrolls the lit row into view.
    act(() => { railStore.set({ ...RAIL, activeKey: 'k1' }) })

    expect(item('k1').className).toContain('itemCurrent')
    expect(scrollIntoViewMock).toHaveBeenCalled()
  })

  it('does not yank the list while a row is hovered', () => {
    const { railStore } = renderRail()
    fireEvent.mouseEnter(item('k1'))
    scrollIntoViewMock.mockClear()

    // The tracker moving elsewhere does not move the highlight or the scroll:
    // the hovered row is the current one.
    act(() => { railStore.set({ ...RAIL, activeKey: 'k2' }) })

    expect(item('k1').className).toContain('itemFocused')
    expect(scrollIntoViewMock).not.toHaveBeenCalled()
  })

  it('moves a bold focus while hovering and jumps on click', () => {
    const { jumpTo } = renderRail()

    fireEvent.mouseEnter(item('k1'))

    expect(item('k1').className).toContain('itemFocused')
    expect(item('k1').className).not.toContain('itemCurrent')

    fireEvent.click(item('k1'))

    expect(jumpTo).toHaveBeenCalledWith('k1')
    // The click clears the preselection; the highlight returns to the reading
    // position until the tracker republishes.
    expect(item('k3').className).toContain('itemCurrent')
  })

  it('settles the highlight back on the reading position when the hover leaves', () => {
    renderRail()
    fireEvent.mouseEnter(item('k1'))

    // The pointer leaves the row but stays inside the panel.
    fireEvent.mouseOut(item('k1'), { relatedTarget: panel() })

    expect(item('k3').className).toContain('itemCurrent')
  })

  it('keeps the focus when leaving a different row', () => {
    renderRail()
    fireEvent.mouseEnter(item('k1'))
    fireEvent.mouseOut(item('k2'), { relatedTarget: item('k1') })

    expect(item('k1').className).toContain('itemFocused')
  })

  it('moves the focus with arrow keys and jumps with Enter', () => {
    const { jumpTo } = renderRail()

    // The reading position is k3; ArrowUp preselects k2 in bold.
    fireEvent.keyDown(panel(), { key: 'ArrowUp' })
    expect(item('k2').className).toContain('itemFocused')

    // ArrowDown returns to k3.
    fireEvent.keyDown(panel(), { key: 'ArrowDown' })
    expect(item('k3').className).toContain('itemFocused')

    // Enter confirms the preselected row and jumps.
    fireEvent.keyDown(panel(), { key: 'ArrowUp' })
    fireEvent.keyDown(panel(), { key: 'Enter' })
    expect(jumpTo).toHaveBeenCalledWith('k2')
  })

  it('jumps to the reading position with Enter and accepts Space', () => {
    const { jumpTo } = renderRail()

    // Enter without moving jumps to the reading position (k3).
    fireEvent.keyDown(panel(), { key: 'Enter' })
    expect(jumpTo).toHaveBeenCalledWith('k3')

    // Space confirms the moved preselection too.
    fireEvent.keyDown(panel(), { key: 'ArrowUp' })
    fireEvent.keyDown(panel(), { key: ' ' })
    expect(jumpTo).toHaveBeenLastCalledWith('k2')
  })

  it('clears the focus when the panel loses focus', () => {
    renderRail()
    fireEvent.keyDown(panel(), { key: 'ArrowUp' })
    expect(item('k2').className).toContain('itemFocused')

    fireEvent.blur(panel())

    expect(item('k2').className).not.toContain('itemFocused')
  })

  it('ignores unrelated keys on the panel', () => {
    const { jumpTo } = renderRail()

    fireEvent.keyDown(panel(), { key: 'x' })

    expect(jumpTo).not.toHaveBeenCalled()
  })

  it('skips nodes that do not resolve', () => {
    renderRail({
      useSession: bindSnapshotSelector(createSnapshotStore({
        chat: {
          order: ['missing', 'k1', 'k3'],
          nodes: { get: (key: string) => NODES[key] },
        },
        hasMore: false,
        loadingOlder: false,
      } as unknown as ConversationSnapshot)),
    })
    // 'missing' has no node: only k1 and k3 produce rows.
    expect(items()).toHaveLength(2)
  })

  it('falls back to the empty copy when a message has no text', () => {
    const contentless = node('kc', 'user', '')
    ;(contentless.data as { content?: unknown }).content = undefined
    renderRail({
      useSession: bindSnapshotSelector(createSnapshotStore({
        chat: {
          order: ['kc'],
          nodes: { get: (key: string) => (key === 'kc' ? contentless : undefined) },
        },
        hasMore: false,
        loadingOlder: false,
      } as unknown as ConversationSnapshot)),
    })
    expect(panel().textContent).toContain(en['rail.empty'])
  })

  it('renders no load-more chrome: older history pages on scroll alone', () => {
    renderRail({
      useSession: bindSnapshotSelector(createSnapshotStore(sessionSnapshot({ hasMore: true }))),
    })
    expect(Array.from(panel().children).every(child => child.hasAttribute('data-item-key'))).toBe(true)
  })

  it('prefetches recent history up to initialPages when more exists', () => {
    // The component subscribes to the store passed through useSession, so the
    // test owns that store to drive the arriving-page pulses.
    const sessionStore = createSnapshotStore(sessionSnapshot({ hasMore: true }))
    const { loadOlder } = renderRail({ useSession: bindSnapshotSelector(sessionStore) })
    // The panel opens and pulls the first page immediately.
    expect(loadOlder).toHaveBeenCalledTimes(1)

    // Each arriving page (loadingOlder pulse) keeps pulling until initialPages.
    for (let page = 2; page <= 5; page += 1) {
      act(() => { sessionStore.set(sessionSnapshot({ hasMore: true, loadingOlder: true })) })
      act(() => { sessionStore.set(sessionSnapshot({ hasMore: true })) })
      expect(loadOlder).toHaveBeenCalledTimes(page)
    }

    // The cap stops further prefetching.
    act(() => { sessionStore.set(sessionSnapshot({ hasMore: true, loadingOlder: true })) })
    act(() => { sessionStore.set(sessionSnapshot({ hasMore: true })) })
    expect(loadOlder).toHaveBeenCalledTimes(5)
  })

  it('does not prefetch when the session has no older history', () => {
    const { loadOlder } = renderRail()
    expect(loadOlder).not.toHaveBeenCalled()
  })

  it('bootstraps history pages until the first user message materializes', () => {
    // A huge assistant turn can push every user message past the loaded
    // event window: no rows render, but paging must still run.
    const assistant = {
      key: 'a1', kind: 'assistant', target: 'chat', anchorSeq: 1, data: {},
    } as unknown as ChatConversationViewNode
    const paged = (withUser: boolean, loading = false) => ({
      chat: {
        order: withUser ? ['k1', 'a1'] : ['a1'],
        nodes: { get: (key: string) => (key === 'k1' ? NODES.k1 : assistant) },
      },
      hasMore: true,
      loadingOlder: loading,
    }) as unknown as ConversationSnapshot
    const sessionStore = createSnapshotStore(paged(false))
    const { loadOlder } = renderRail({ useSession: bindSnapshotSelector(sessionStore) })

    expect(items()).toHaveLength(0)
    expect(loadOlder).toHaveBeenCalledTimes(1)

    // While no user message has materialized the initialPages cap does not
    // apply: more arrivals than the cap keep paging.
    for (let page = 2; page <= 7; page += 1) {
      act(() => { sessionStore.set(paged(false, true)) })
      act(() => { sessionStore.set(paged(false)) })
      expect(loadOlder).toHaveBeenCalledTimes(page)
    }

    // A user message materializes: the panel appears and the capped
    // prefetch stops (the bootstrap pages already exceed initialPages).
    act(() => { sessionStore.set(paged(true, true)) })
    act(() => { sessionStore.set(paged(true)) })
    expect(items()).toHaveLength(1)
    expect(loadOlder).toHaveBeenCalledTimes(7)
  })

  it('loads an older page when the panel is scrolled to its top', () => {
    const { loadOlder } = renderRail({
      useSession: bindSnapshotSelector(createSnapshotStore(sessionSnapshot({ hasMore: true }))),
    })
    loadOlder.mockClear()

    fireEvent.scroll(panel())

    expect(loadOlder).toHaveBeenCalledTimes(1)
  })

  it('does not page when the panel is scrolled away from its top', () => {
    const { loadOlder } = renderRail({
      useSession: bindSnapshotSelector(createSnapshotStore(sessionSnapshot({ hasMore: true }))),
    })
    loadOlder.mockClear()

    panel().scrollTop = 40
    fireEvent.scroll(panel())

    expect(loadOlder).not.toHaveBeenCalled()
  })

  it('does not page on scroll while a page is already loading', () => {
    const { loadOlder } = renderRail({
      useSession: bindSnapshotSelector(createSnapshotStore(sessionSnapshot({ hasMore: true, loadingOlder: true }))),
    })
    loadOlder.mockClear()

    fireEvent.scroll(panel())

    expect(loadOlder).not.toHaveBeenCalled()
  })

  it('does not page on scroll when no older history exists', () => {
    const { loadOlder } = renderRail()

    fireEvent.scroll(panel())

    expect(loadOlder).not.toHaveBeenCalled()
  })
})

describe('hidden conditions', () => {
  it('tolerates a null active marker', () => {
    renderRail({ useRail: bindSnapshotSelector(createSnapshotStore({ ...RAIL, activeKey: null })) })
    expect(items()).toHaveLength(3)
  })

  it('renders nothing while a non-chat view is active', () => {
    renderRail({ useRail: bindSnapshotSelector(createSnapshotStore({ ...RAIL, chatView: false })) })
    expect(items()).toHaveLength(0)
  })

  it('renders nothing when the probe is not ready', () => {
    renderRail({ useRail: bindSnapshotSelector(createSnapshotStore({ ...RAIL, ready: false })) })
    expect(items()).toHaveLength(0)
  })

  it('renders nothing when the panel belongs to another session', () => {
    renderRail({ useRail: bindSnapshotSelector(createSnapshotStore({ ...RAIL, sessionId: 'other' })) })
    expect(items()).toHaveLength(0)
  })

  it('renders nothing when the session has no user messages', () => {
    renderRail({
      useSession: bindSnapshotSelector(createSnapshotStore(sessionSnapshot({ order: ['a1'] }))),
      useRail: bindSnapshotSelector(createSnapshotStore({ ...RAIL, activeKey: null })),
    })
    expect(items()).toHaveLength(0)
  })
})
