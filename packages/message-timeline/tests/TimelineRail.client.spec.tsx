// @vitest-environment jsdom
/**
 * The header-utilities entry: the flat timeline panel (rows, reading-position
 * highlight, hover/focus brightening hooks, keyboard and click jumps,
 * scroll-top paging), and the conditions that keep the panel hidden.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  ChatConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-chat/client'
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

/** A ChatNodeStore stub exposing both `get` and `values` (the rail reads values). */
function nodeStore(...list: ChatConversationViewNode[]): { get: (key: string) => ChatConversationViewNode | undefined; values: () => readonly ChatConversationViewNode[] } {
  const byKey = new Map(list.map(n => [n.key, n]))
  return { get: (key: string) => byKey.get(key), values: () => list }
}

const ALL_NODES = Object.values(NODES)

/** The useChat slice: the visible order plus the node store. */
function chatSnapshot(overrides: { order?: readonly string[]; nodes?: ReturnType<typeof nodeStore> } = {}) {
  return {
    order: overrides.order ?? ['k1', 'k2', 'k3'],
    nodes: overrides.nodes ?? nodeStore(...ALL_NODES),
  }
}

/** The useSession slice: history paging state (chat data lives in useChat). */
function sessionSnapshot(overrides: { hasMore?: boolean; loadingOlder?: boolean } = {}) {
  return {
    hasMore: overrides.hasMore ?? false,
    loadingOlder: overrides.loadingOlder ?? false,
  }
}

const RAIL: TimelineRailState = {
  sessionId: 's1', ready: true, left: 10, top: 20, height: 300, scrollportWidth: 1200, flowLeft: 400,
  activeKey: 'k3', chatView: true,
}

function renderRail(overrides: Partial<TimelineRailProps> = {}) {
  const chatStore = createSnapshotStore(chatSnapshot())
  const sessionStore = createSnapshotStore(sessionSnapshot())
  const railStore = createSnapshotStore(RAIL)
  const jumpTo = vi.fn()
  const loadOlder = vi.fn(() => Promise.resolve())
  const props = {
    sessionId: 's1',
    useSession: bindSnapshotSelector(sessionStore),
    useChat: bindSnapshotSelector(chatStore),
    useRail: bindSnapshotSelector(railStore),
    jumpTo,
    loadOlder,
    includeSteering: true,
    panelWidth: 320,
    initialPages: 5,
    t: (key: keyof typeof en) => en[key],
  } as unknown as TimelineRailProps
  const view = render(<TimelineRail {...{ ...props, ...overrides }} />)
  return { view, sessionStore, chatStore, railStore, jumpTo, loadOlder }
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

  it('keeps the ordinary-session baseline: a normal session renders exactly its order rows', () => {
    // Regression guard: the fix must not change an ordinary (non-edited)
    // session. A plain order + store with no message-tools nodes renders the
    // three user/steering rows and nothing else.
    const sessionStore = createSnapshotStore(sessionSnapshot())
    renderRail({ useSession: bindSnapshotSelector(sessionStore) })
    expect(items()).toHaveLength(3)
    expect(panel().textContent).toContain('你好')
    expect(panel().textContent).toContain('继续')
    expect(panel().textContent).toContain('谢谢')
  })

  it('keeps the edited bubble when the host order omits it (an edit never drains the rail)', () => {
    // An in-place edit replaces the surface tail; the host's visible order can
    // come back without the `message-tools-edited` bubble even though it is in
    // the store and renders in the flow. The rail must surface it — editing the
    // first message must not drain the rail to zero rows.
    const edited = {
      key: 'ke', kind: 'message-tools-edited', target: 'chat', anchorSeq: 9, visibility: 'visible',
      data: { seq: 9, hiddenStartSeq: 5, content: [{ type: 'text', text: '改过的内容' }] },
    } as unknown as ChatConversationViewNode
    const withdrawn = {
      key: 'k2', kind: 'user', target: 'chat', anchorSeq: 5, visibility: 'hidden',
      data: { content: [{ type: 'text', text: '被撤回的原消息' }] },
    } as unknown as ChatConversationViewNode
    renderRail({
      useChat: bindSnapshotSelector(createSnapshotStore({
        // The host order no longer surfaces any user bubble (all withdrawn /
        // replaced); the edited bubble lives only in the store.
        order: [],
        nodes: nodeStore(edited, withdrawn),
      })),
    })

    expect(items()).toHaveLength(1)
    expect(panel().textContent).toContain('改过的内容')
    expect(panel().textContent).not.toContain('被撤回的原消息')
  })

  it('keeps the edited bubble and the still-visible user rows when the order surfaces both', () => {
    // A middle-message edit: order still lists the pre-edit user messages and
    // the appended edited bubble follows them.
    const edited = {
      key: 'ke', kind: 'message-tools-edited', target: 'chat', anchorSeq: 9, visibility: 'visible',
      data: { seq: 9, hiddenStartSeq: 5, content: [{ type: 'text', text: '改过的内容' }] },
    } as unknown as ChatConversationViewNode
    renderRail({
      useChat: bindSnapshotSelector(createSnapshotStore({
        order: ['k1', 'k3'],
        nodes: nodeStore(NODES.k1, NODES.k3, edited),
      })),
    })

    expect(items()).toHaveLength(3)
    expect(panel().textContent).toContain('你好')
    expect(panel().textContent).toContain('谢谢')
    expect(panel().textContent).toContain('改过的内容')
  })

  it('orders an appended bubble by its anchorSeq, not by store iteration order (the newest row stays last)', () => {
    // An in-place edit of an OLDER message materializes a `message-tools-edited`
    // bubble in the store; its anchorSeq is older than the newest user row.
    // The append loop walks the store, whose iteration order is not seq order,
    // so without a final sort the bubble would land AFTER the newer row. The
    // rail must keep transcript order: the old edited bubble first, the newer
    // user row last.
    const edited = {
      key: 'ke', kind: 'message-tools-edited', target: 'chat', anchorSeq: 5, visibility: 'visible',
      data: { seq: 5, hiddenStartSeq: 3, content: [{ type: 'text', text: '旧消息(编辑后)' }] },
    } as unknown as ChatConversationViewNode
    const newest = {
      key: 'k3', kind: 'user', target: 'chat', anchorSeq: 20, visibility: 'visible',
      data: { content: [{ type: 'text', text: '最新消息' }] },
    } as unknown as ChatConversationViewNode
    renderRail({
      useChat: bindSnapshotSelector(createSnapshotStore({
        // The host order surfaces only the newest user row; the edited bubble
        // lives only in the store (store iteration yields the bubble first,
        // the newest row second — the order loop keeps the row, the append
        // adds the bubble).
        order: ['k3'],
        nodes: nodeStore(edited, newest),
      })),
    })

    expect(items()).toHaveLength(2)
    expect(item('ke').compareDocumentPosition(item('k3')) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('drops a withdrawn original that still sits in the order (its row is hidden, so it cannot be jumped to)', () => {
    // A withdraw leaves the original user message visible in the host order and
    // a sibling `message-tools-withdrawn` divider carrying the span; the DOM
    // hider hides that row, so a rail row for it is a dead row. The rail must
    // skip it, while the untouched user message after the span still renders.
    const withdrawn = {
      key: 'kw', kind: 'user', target: 'chat', anchorSeq: 5, visibility: 'visible',
      data: { seq: 5, content: [{ type: 'text', text: '被撤回的消息' }] },
    } as unknown as ChatConversationViewNode
    const divider = {
      key: 'kd', kind: 'message-tools-withdrawn', target: 'chat', anchorSeq: 20, visibility: 'visible',
      data: { seq: 20, hiddenStartSeq: 5 },
    } as unknown as ChatConversationViewNode
    renderRail({
      useChat: bindSnapshotSelector(createSnapshotStore({
        // The host still lists the withdrawn original (no suppression seam),
        // plus one untouched user message and the divider.
        order: ['k1', 'kw', 'kd'],
        nodes: nodeStore(NODES.k1, withdrawn, divider),
      })),
    })

    expect(items()).toHaveLength(1)
    expect(panel().textContent).toContain('你好')
    expect(panel().textContent).not.toContain('被撤回的消息')
  })

  it('keeps an edited bubble anchored at the span end but drops the withdrawn original in the same span', () => {
    // The live edit replacement anchors at the span's exclusive end (its seq),
    // which is OUTSIDE the span, so it renders. The withdrawn original user
    // message — which the host order still lists — sits INSIDE the span and is
    // dropped. This is the withdraw path in one picture: one dead row removed,
    // the live replacement and untouched rows kept.
    const edited = {
      key: 'ke', kind: 'message-tools-edited', target: 'chat', anchorSeq: 9, visibility: 'visible',
      data: { seq: 9, hiddenStartSeq: 5, content: [{ type: 'text', text: '改过的内容' }] },
    } as unknown as ChatConversationViewNode
    const withdrawn = {
      key: 'kw', kind: 'user', target: 'chat', anchorSeq: 7, visibility: 'visible',
      data: { seq: 7, content: [{ type: 'text', text: '被撤回的原文' }] },
    } as unknown as ChatConversationViewNode
    renderRail({
      useChat: bindSnapshotSelector(createSnapshotStore({
        order: ['kw', 'ke'],
        nodes: nodeStore(withdrawn, edited),
      })),
    })

    expect(items()).toHaveLength(1)
    expect(panel().textContent).toContain('改过的内容')
    expect(panel().textContent).not.toContain('被撤回的原文')
  })

  it('degrades to the order rows when the store read fails (ordinary session still renders)', () => {
    // A store whose `values()` throws must not break the rail: the primary
    // order loop still renders, the append silently drops.
    const badStore = {
      get: (key: string) => NODES[key],
      values: () => { throw new Error('boom') },
    }
    renderRail({
      useChat: bindSnapshotSelector(createSnapshotStore({
        order: ['k1', 'k3'],
        nodes: badStore,
      })),
    })

    expect(items()).toHaveLength(2)
    expect(panel().textContent).toContain('你好')
    expect(panel().textContent).toContain('谢谢')
  })

  it('hides the panel when the useChat seat is absent (degrade, never a throw)', () => {
    // A host without the ui-chat standard prop leaves the rail an empty slice:
    // no rows, so the portal never mounts — the plugin stays invisible rather
    // than crashing the entry.
    renderRail({ useChat: undefined })
    expect(items()).toHaveLength(0)
    expect(document.body.querySelector('[data-timeline-panel]')).toBeNull()
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
      useChat: bindSnapshotSelector(createSnapshotStore({
        order: ['missing', 'k1', 'k3'],
        nodes: { get: (key: string) => NODES[key] },
      })),
    })
    // 'missing' has no node: only k1 and k3 produce rows.
    expect(items()).toHaveLength(2)
  })

  it('falls back to the empty copy when a message has no text', () => {
    const contentless = node('kc', 'user', '')
    ;(contentless.data as { content?: unknown }).content = undefined
    renderRail({
      useChat: bindSnapshotSelector(createSnapshotStore({
        order: ['kc'],
        nodes: { get: (key: string) => (key === 'kc' ? contentless : undefined) },
      })),
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
    const pagedChat = (withUser: boolean) => ({
      order: withUser ? ['k1', 'a1'] : ['a1'],
      nodes: { get: (key: string) => (key === 'k1' ? NODES.k1 : assistant) },
    })
    const pagedSession = (loading = false) => ({ hasMore: true, loadingOlder: loading })
    const chatStore = createSnapshotStore(pagedChat(false))
    const sessionStore = createSnapshotStore(pagedSession())
    const { loadOlder } = renderRail({
      useChat: bindSnapshotSelector(chatStore),
      useSession: bindSnapshotSelector(sessionStore),
    })

    expect(items()).toHaveLength(0)
    expect(loadOlder).toHaveBeenCalledTimes(1)

    // While no user message has materialized the initialPages cap does not
    // apply: more arrivals than the cap keep paging.
    for (let page = 2; page <= 7; page += 1) {
      act(() => { sessionStore.set(pagedSession(true)) })
      act(() => { sessionStore.set(pagedSession()) })
      expect(loadOlder).toHaveBeenCalledTimes(page)
    }

    // A user message materializes: the panel appears and the capped
    // prefetch stops (the bootstrap pages already exceed initialPages).
    act(() => { chatStore.set(pagedChat(true)) })
    act(() => { sessionStore.set(pagedSession(true)) })
    act(() => { sessionStore.set(pagedSession()) })
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

describe('width policy', () => {
  function railWith(overrides: Partial<TimelineRailState>): TimelineRailState {
    return { ...RAIL, ...overrides }
  }

  function renderWith(overrides: Partial<TimelineRailState>) {
    return renderRail({ useRail: bindSnapshotSelector(createSnapshotStore(railWith(overrides))) })
  }

  it('caps the width to the left gutter so the panel never covers the flow', () => {
    // flowLeft 300, panel left 10: the budget is 300 - 10 - 8 (padding) - 16 (gap) = 266.
    renderWith({ flowLeft: 300 })
    expect(panel().style.width).toBe('266px')
  })

  it('keeps the configured width when the gutter is wider than the panel', () => {
    renderWith({ flowLeft: 1200 })
    expect(panel().style.width).toBe('320px')
  })

  it('renders at the minimum width when the gutter exactly fits it', () => {
    // flowLeft 154, panel left 10: budget = 154 - 10 - 8 - 16 = 120.
    renderWith({ flowLeft: 154 })
    expect(panel().style.width).toBe('120px')
  })

  it('hides entirely when the gutter cannot hold the minimum width', () => {
    // flowLeft 153 would leave 119px — one pixel below the floor.
    renderWith({ flowLeft: 153 })
    expect(document.body.querySelector('[data-timeline-panel]')).toBeNull()
  })

  it('degrades to a scrollport fraction while the flow probe is unanswered', () => {
    // 40% of a 1200px scrollport (480) exceeds the configured 320px.
    renderWith({ flowLeft: null, scrollportWidth: 1200 })
    expect(panel().style.width).toBe('320px')
  })

  it('keeps the degraded floor while the flow probe is unanswered on a narrow scrollport', () => {
    // 40% of 200px (80) floors at the minimum panel width.
    renderWith({ flowLeft: null, scrollportWidth: 200 })
    expect(panel().style.width).toBe('120px')
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
      useChat: bindSnapshotSelector(createSnapshotStore(chatSnapshot({ order: ['a1'] }))),
      useRail: bindSnapshotSelector(createSnapshotStore({ ...RAIL, activeKey: null })),
    })
    expect(items()).toHaveLength(0)
  })
})
