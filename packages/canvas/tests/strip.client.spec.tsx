// @vitest-environment jsdom
/**
 * The canvas surface's own tab strip (round-3 review, item ⑥): the store that
 * holds its rows, and the page that routes a row to its body.
 *
 * Stage ⑧ put a card's detail in the HOST dock; item ⑥ moved it in here, so
 * what these specs lock is what that move is made of: row ids derived from their
 * subject (one card clicked twice is one row), the ＋新卡 menu re-categorizing
 * the draft row instead of seating a second blank, the strip's own × gating the
 * discard question the dock's × could never intercept, the eviction order when
 * the strip fills up, and the stash that survives a reload.
 *
 * The store gets its own section because its rules (which row gets evicted, what
 * a foreign sessionStorage payload is worth) are not reachable from a render.
 * The reader's own behaviour is `detail.client.spec.tsx`; the board's gestures
 * are `tab.client.spec.tsx`; what a card click PASSES is locked there too — here
 * the verbs are the real ones, so the strip actually moves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { CanvasTabProps, CanvasTabTitleProps } from '../src/client/contract.ts'
import { CanvasImageSrcs } from '../src/client/images.ts'
import {
  CanvasSelectionStore, boardTabId, cardTabId, draftTabId,
} from '../src/client/space/selection.ts'
import { CanvasTab } from '../src/client/tab/CanvasTab.tsx'
import { CanvasTabTitle } from '../src/client/tab/CanvasTabTitle.tsx'
import { zh } from '../src/client/locales.ts'
import { defaultCategories, type BoardCategory } from '../src/types.ts'
import type {
  BoardAskAgentOutcome, BoardAttachImageOutcome, BoardChatStatusResult, BoardFocusResult,
  BoardListResult, BoardMutationResult, BoardReadOutcome,
  CanvasBoard, CanvasSummary,
} from '../src/types.ts'

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

const NOW = '2026-09-16T08:00:00.000Z'
const CANVAS_ID = 'canvas_01234567abcdefgh'
const OTHER_ID = 'canvas_second01abcdef'
/** One custom category row, in the shape the panel mints. */
const custom: BoardCategory = { id: 'cat_01234567abc', label: '反方观点', order: 60, enabled: true }

/** A plain translate over the zh dictionary (the key-set source of truth). */
const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as CanvasTabProps['t']

/** One board fixture; cards land in array order. */
function board(id = CANVAS_ID, cards: CanvasBoard['cards'] = []): CanvasBoard {
  return {
    id,
    title: id === CANVAS_ID ? '为什么人们不愿表达异议' : '第二块画布',
    attachedWorkspaces: [],
    chat: { sessionId: null },
    cards,
    categories: [...defaultCategories(), custom],
    links: [],
    lanes: [],
    stats: { proposed: { accepted: 0, rejected: 0 }, kindCounts: {}, lastActiveAt: NOW },
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

/** One card fixture. */
function card(id: string, overrides: Record<string, unknown> = {}): CanvasBoard['cards'][number] {
  return {
    id,
    kind: 'fragment',
    text: `卡片 ${id}`,
    status: 'kept',
    comments: [],
    createdBy: 'user',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as CanvasBoard['cards'][number]
}

/** The row the list surface reports for one board. */
function rowOf(value: CanvasBoard): CanvasSummary {
  return {
    id: value.id,
    title: value.title,
    cardCount: value.cards.filter(candidate => candidate.status !== 'archived').length,
    openQuestions: 0,
    archivedAt: value.archivedAt,
    lastActiveAt: value.stats.lastActiveAt,
  }
}

/* ------------------------------------------------------------------ the store */

describe('CanvasSelectionStore — the rows', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('derives the id from the subject, so one card clicked twice is one row', () => {
    const store = new CanvasSelectionStore()
    store.openCanvas(CANVAS_ID)
    store.openCardTab(CANVAS_ID, 'c_1', '第一版标题')
    store.openCanvas(CANVAS_ID)
    store.openCardTab(CANVAS_ID, 'c_1', '改过的标题')
    const state = store.source.getSnapshot()
    expect(state.tabs.map(row => row.id)).toEqual([boardTabId(CANVAS_ID), cardTabId(CANVAS_ID, 'c_1')])
    // The re-open keeps the row's PLACE but takes the new payload: the strip's
    // label is what the card is called NOW, and showing it is what the click said.
    expect(state.active).toBe(cardTabId(CANVAS_ID, 'c_1'))
    const row = state.tabs[1]
    expect(row?.kind === 'card' && row.heading).toBe('改过的标题')
  })

  it('re-categorizes the open draft instead of seating a second blank one', () => {
    const store = new CanvasSelectionStore()
    store.openCanvas(CANVAS_ID)
    store.openDraftTab(CANVAS_ID, 'question', '问题')
    store.openDraftTab(CANVAS_ID, custom.id, '反方观点')
    const state = store.source.getSnapshot()
    expect(state.tabs.map(row => row.id)).toEqual([boardTabId(CANVAS_ID), draftTabId(CANVAS_ID)])
    const row = state.tabs[1]
    expect(row?.kind === 'draft' && row.catKind).toBe(custom.id)
  })

  it('activates the left neighbour on a close, and goes quiet on the last row', () => {
    const store = new CanvasSelectionStore()
    store.openCanvas(CANVAS_ID)
    store.openCardTab(CANVAS_ID, 'c_1', '一')
    store.openCardTab(CANVAS_ID, 'c_2', '二')
    store.close(cardTabId(CANVAS_ID, 'c_2'))
    expect(store.source.getSnapshot().active).toBe(cardTabId(CANVAS_ID, 'c_1'))
    // Closing a row that is not showing leaves the view alone.
    store.close(boardTabId(CANVAS_ID))
    expect(store.source.getSnapshot().active).toBe(cardTabId(CANVAS_ID, 'c_1'))
    store.close(cardTabId(CANVAS_ID, 'c_1'))
    const state = store.source.getSnapshot()
    expect(state.tabs).toHaveLength(0)
    expect(state.active).toBe('')
    // No row means no canvas, so the session's tools have no target either.
    expect(state.canvasId).toBeNull()
  })

  it('caps the strip by evicting a card, never the board nor the row just added', () => {
    const store = new CanvasSelectionStore()
    store.openCanvas(CANVAS_ID)
    store.openDraftTab(CANVAS_ID, 'question', '问题')
    for (let index = 0; index < 20; index += 1) {
      store.openCardTab(CANVAS_ID, `c_${index}`, `卡 ${index}`)
    }
    const state = store.source.getSnapshot()
    // 16 rows: the board and the draft survive a full strip (one costs a click
    // in the ＋ menu, the other costs words), and the newest card is in it.
    expect(state.tabs).toHaveLength(16)
    expect(state.tabs.some(row => row.kind === 'board')).toBe(true)
    expect(state.tabs.some(row => row.kind === 'draft')).toBe(true)
    expect(state.active).toBe(cardTabId(CANVAS_ID, 'c_19'))
    // The cards that went are the oldest ones.
    expect(state.tabs.some(row => row.id === cardTabId(CANVAS_ID, 'c_0'))).toBe(false)
  })

  it('brings the strip back through sessionStorage, and drops what it cannot vouch for', () => {
    const first = new CanvasSelectionStore()
    first.openCanvas(CANVAS_ID)
    first.openCardTab(CANVAS_ID, 'c_1', '一张卡')
    const restored = new CanvasSelectionStore()
    expect(restored.source.getSnapshot().tabs.map(row => row.id))
      .toEqual([boardTabId(CANVAS_ID), cardTabId(CANVAS_ID, 'c_1')])
    expect(restored.source.getSnapshot().active).toBe(cardTabId(CANVAS_ID, 'c_1'))

    sessionStorage.setItem('dsh-canvas.tabs', JSON.stringify({ tabs: [{ id: 'x', kind: 'who-knows' }], active: 'x' }))
    expect(new CanvasSelectionStore().source.getSnapshot().tabs).toHaveLength(0)
    sessionStorage.setItem('dsh-canvas.tabs', '{not json')
    expect(new CanvasSelectionStore().source.getSnapshot().tabs).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ the page */

interface Bench {
  readonly store: CanvasSelectionStore
  readonly mocks: {
    putCard: ReturnType<typeof vi.fn>
    readBoard: ReturnType<typeof vi.fn>
    focusCanvas: ReturnType<typeof vi.fn>
  }
  readonly props: CanvasTabProps
  readonly titleProps: CanvasTabTitleProps
}

/**
 * Mount the surface over a fake host with the REAL strip verbs: a card click
 * moves the strip here, which is the whole point of the change.
 */
function makeBench(boards: CanvasBoard[] = [board()]): Bench {
  const current = new Map(boards.map(value => [value.id, value]))
  const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
  const store = new CanvasSelectionStore()
  const images = new CanvasImageSrcs(async () => ({
    ok: true as const,
    value: { ok: true as const, data: 'AAEC', mediaType: 'image/png' as const },
  }))
  const mutationFor = (canvasId: string): Result<BoardMutationResult> => {
    const value = current.get(canvasId)
    if (value === undefined) return { ok: true, value: { ok: false, error: 'missing' } }
    return ok({ ok: true, board: value, version: '2' })
  }
  const mocks = {
    putCard: vi.fn(async (_sid: string, request: { canvasId: string; kind: string; text: string }): Promise<Result<BoardMutationResult>> => {
      const value = current.get(request.canvasId)
      value?.cards.push(card(`c_new${request.text.length}`, { kind: request.kind, text: request.text }))
      return mutationFor(request.canvasId)
    }),
    readBoard: vi.fn(async (request: { canvasId: string }): Promise<Result<BoardReadOutcome>> => {
      const value = current.get(request.canvasId)
      if (value === undefined) return ok({ ok: false, error: 'missing' })
      return ok({ ok: true, board: value, version: '1' })
    }),
    focusCanvas: vi.fn(async (): Promise<Result<BoardFocusResult>> => ok({ ok: true })),
  }
  const face = {
    t,
    sessionId: 's1',
    listCanvases: vi.fn(async (): Promise<Result<BoardListResult>> => ok({ items: [...current.values()].map(rowOf) })),
    createCanvas: vi.fn(),
    ...mocks,
    patchCard: vi.fn(async (_sid: string, request: { canvasId: string }): Promise<Result<BoardMutationResult>> => mutationFor(request.canvasId)),
    addComment: vi.fn(async (_sid: string, request: { canvasId: string }): Promise<Result<BoardMutationResult>> => mutationFor(request.canvasId)),
    archiveCanvas: vi.fn(async (_sid: string, request: { canvasId: string }): Promise<Result<BoardMutationResult>> => mutationFor(request.canvasId)),
    setCategories: vi.fn(async (_sid: string, request: { canvasId: string }): Promise<Result<BoardMutationResult>> => mutationFor(request.canvasId)),
    setLayout: vi.fn(async (_sid: string, request: { canvasId: string }): Promise<Result<BoardMutationResult>> => mutationFor(request.canvasId)),
    openFile: vi.fn(),
    attachImage: vi.fn(async (): Promise<Result<BoardAttachImageOutcome>> =>
      ok({ ok: true, ref: { attachmentId: 'x', mediaType: 'image/png', bytes: 3, width: 2, height: 1 } })),
    askAgent: vi.fn(async (): Promise<Result<BoardAskAgentOutcome>> => ok({ ok: true, contextKey: 'k', sent: true })),
    chatStatus: vi.fn(async (): Promise<Result<BoardChatStatusResult>> => ok({ available: false })),
    openSideChat: vi.fn(),
    suggestWideMode: vi.fn(),
    images,
    // The production wiring, verb for verb (src/client/index.ts).
    openCanvas: (canvasId: string) => { store.openCanvas(canvasId) },
    openCardDetail: (canvasId: string, cardId: string, heading: string) => { store.openCardTab(canvasId, cardId, heading) },
    openCardDraft: (canvasId: string, kind: Parameters<typeof store.openDraftTab>[1], heading: string) => {
      store.openDraftTab(canvasId, kind, heading)
    },
    activateTab: (id: string) => { store.activate(id) },
    closeTab: (id: string) => { store.close(id) },
    useSessions: ((selector: (snapshot: { byId: Record<string, { cwd: string }> }) => unknown) =>
      selector({ byId: { s1: { cwd: '/ws' } } })) as CanvasTabProps['useSessions'],
    useWorkspaces: ((selector: (snapshot: { items: readonly unknown[] }) => unknown) =>
      selector({ items: [] })) as CanvasTabProps['useWorkspaces'],
    useSelection: function useSelection<S>(selector: (snapshot: ReturnType<typeof store.source.getSnapshot>) => S): S {
      return selector(useSyncExternalStore(store.source.subscribe, store.source.getSnapshot))
    } as CanvasTabProps['useSelection'],
    useImageRev: function useImageRev<S>(selector: (snapshot: number) => S): S {
      return selector(useSyncExternalStore(images.source.subscribe, images.source.getSnapshot))
    } as CanvasTabProps['useImageRev'],
  }
  const props = face as unknown as CanvasTabProps
  const titleProps = {
    useSelection: face.useSelection,
    useTabInfo: () => ({
      sidebar: { expanded: true, fullscreen: false },
      panel: { id: 'pane1' },
      tab: {
        id: 'tab1', kind: CANVAS_KIND_PAGE, contentId: CANVAS_KIND_PAGE, title: '画布',
        visible: true, navigation: { address: '', revision: 0, params: undefined },
        signal: new AbortController().signal, actions: {},
      },
    }),
  } as unknown as CanvasTabTitleProps
  return { store, mocks, props, titleProps }
}

/** The registry's own kind string (the chip's fallback text lives there). */
const CANVAS_KIND_PAGE = 'canvas'

/** One drag: press, sweep, release, in the pad's screen box. */
function drawOneStroke(container: HTMLElement): void {
  const svg = Array.from(container.querySelectorAll('svg'))
    .find(candidate => candidate.getAttribute('viewBox') === '0 0 600 400')
  const box = svg?.parentElement
  if (box === undefined) throw new Error('expected the draft to offer a pad')
  box.setPointerCapture = () => {}
  box.releasePointerCapture = () => {}
  box.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200, x: 0, y: 0,
    toJSON: () => ({}),
  }) as DOMRect
  fireEvent.pointerDown(box, { pointerId: 1, clientX: 60, clientY: 40 })
  fireEvent.pointerMove(box, { pointerId: 1, clientX: 120, clientY: 80 })
  fireEvent.pointerUp(box, { pointerId: 1 })
}

/** The strip's rows, left to right, as the user reads them. */
function stripLabels(): string[] {
  return screen.getAllByRole('tab').map(node => node.textContent ?? '')
}

/**
 * Click a card on the board. Once its row is on the strip the same words appear
 * TWICE — the row's label and the card — and the strip sits first in the DOM, so
 * the last match is the card.
 */
async function clickCard(words: string): Promise<void> {
  const matches = await screen.findAllByText(words)
  fireEvent.click(matches[matches.length - 1]!)
}

/** Click the board row back into view. */
function backToBoard(): void {
  fireEvent.click(screen.getByRole('tab', { name: '为什么人们不愿表达异议' }))
}

/**
 * Words as they appear in the BODY, not as a strip label. A card's heading is on
 * its row for as long as the row is open, so "this row is not showing" is only
 * observable below the strip — and the strip is exactly what a plain query
 * would keep finding.
 */
function bodyMatches(words: string): HTMLElement[] {
  const strip = screen.getByRole('tablist')
  return screen.queryAllByText(words).filter(node => !strip.contains(node))
}

/**
 * Type into a card editor. It is the uncontrolled `CardTextarea`, and the owner's
 * copy of its text (a draft's dirty flag, its words after a tab turn) rides the
 * native `input` event — a `change` event updates the box and nothing else.
 */
function typeInto(node: HTMLElement, words: string): void {
  fireEvent.input(node, { target: { value: words } })
}

beforeEach(() => { sessionStorage.clear() })
afterEach(() => { cleanup() })

describe('CanvasTab — the strip routes its rows', () => {
  it('seats a row for the canvas it auto-opened, labelled with the canvas title', async () => {
    const { props } = makeBench([board(CANVAS_ID, [card('c_1')])])
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    expect(stripLabels()).toEqual(['为什么人们不愿表达异议'])
    // The canvas name is no longer a door: the strip is where you move between
    // canvases now, and the header's copy of the name is plain text.
    expect(screen.queryByRole('button', { name: '为什么人们不愿表达异议' })).toBeNull()
  })

  it('opens a card as a row and comes back to the board through the strip', async () => {
    const { props } = makeBench([board(CANVAS_ID, [card('c_1', { text: '会上没人开口' })])])
    render(<CanvasTab {...props} />)
    await screen.findByText('会上没人开口')
    await clickCard('会上没人开口')
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('会上没人开口')
    expect(stripLabels()).toEqual(['为什么人们不愿表达异议', '会上没人开口'])

    backToBoard()
    await clickCard('会上没人开口')
    // Two clicks on one card: the row id is derived from the card, so the strip
    // still holds two rows, not three.
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    backToBoard()
    // The board page is back (its ＋新卡 is the only button of its kind here).
    await screen.findByRole('button', { name: /新卡/ })
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('为什么人们不愿表达异议')
  })

  it('shows two cards as two rows, each reading its own card', async () => {
    const { props } = makeBench([board(CANVAS_ID, [
      card('c_1', { text: '第一张的正文' }), card('c_2', { text: '第二张的正文' }),
    ])])
    render(<CanvasTab {...props} />)
    await screen.findByText('第一张的正文')
    await clickCard('第一张的正文')
    backToBoard()
    await clickCard('第二张的正文')
    expect(stripLabels()).toEqual(['为什么人们不愿表达异议', '第一张的正文', '第二张的正文'])
    fireEvent.click(screen.getByRole('tab', { name: '第一张的正文' }))
    await waitFor(() => {
      expect(bodyMatches('第二张的正文')).toHaveLength(0)
    })
    expect(bodyMatches('第一张的正文')).toHaveLength(1)
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('第一张的正文')
  })

  it('keeps the reader for the row it shows: switching rows never carries the text across', async () => {
    const { props } = makeBench([board(CANVAS_ID, [
      card('c_1', { text: '甲的正文' }), card('c_2', { text: '乙的正文' }),
    ])])
    render(<CanvasTab {...props} />)
    await screen.findByText('甲的正文')
    await clickCard('甲的正文')
    fireEvent.click(await screen.findByRole('button', { name: '源码' }))
    const editor = await screen.findByDisplayValue('甲的正文')
    typeInto(editor, '甲被改了一半')
    // Turn to the other card mid-edit: the pad it shows is ITS own, not the
    // uncontrolled textarea this row was typing in.
    backToBoard()
    await clickCard('乙的正文')
    await waitFor(() => {
      expect(screen.queryByDisplayValue('甲被改了一半')).toBeNull()
    })
    fireEvent.click(await screen.findByRole('button', { name: '源码' }))
    await screen.findByDisplayValue('乙的正文')
  })

  it('leaves the board’s filters alone while a card row is open, and resets them for another canvas', async () => {
    const { props, store } = makeBench([
      board(CANVAS_ID, [card('c_1', { text: '甲的问题卡', kind: 'question' })]),
      board(OTHER_ID, [card('c_9', { text: '乙的正文' })]),
    ])
    render(<CanvasTab {...props} />)
    await screen.findByText('甲的问题卡')
    fireEvent.click(screen.getByRole('button', { name: '问题 1' }))
    await clickCard('甲的问题卡')
    backToBoard()
    // The filter you left is still there (stage ⑧'s one win, kept by the row).
    expect(screen.getByRole('button', { name: '问题 1' }).getAttribute('data-active')).toBe('true')
    // Another canvas's board is a fresh page: no filter carried over.
    act(() => { store.openCanvas(OTHER_ID) })
    await screen.findByText('乙的正文')
    expect(screen.getByRole('button', { name: '全部 1' }).getAttribute('data-active')).toBe('true')
  })
})

describe('CanvasTab — the draft row', () => {
  /** Open the ＋新卡 menu and pick one of its rows. */
  async function pickCategory(label: string): Promise<void> {
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getByRole('button', { name: /新卡/ }))
    fireEvent.click(await screen.findByRole('button', { name: label }))
  }

  it('turns the menu’s pick into a row, and a second pick re-categorizes that row', async () => {
    const { props, store } = makeBench([board(CANVAS_ID, [card('c_1')])])
    render(<CanvasTab {...props} />)
    await pickCategory('问题')
    await screen.findByPlaceholderText(/写点什么/)
    expect(store.source.getSnapshot().tabs.map(row => row.id))
      .toEqual([boardTabId(CANVAS_ID), draftTabId(CANVAS_ID)])
    expect(stripLabels()).toEqual(['为什么人们不愿表达异议', '问题'])

    fireEvent.click(screen.getByRole('tab', { name: '为什么人们不愿表达异议' }))
    await pickCategory('反方观点')
    expect(store.source.getSnapshot().tabs).toHaveLength(2)
    expect(stripLabels()).toEqual(['为什么人们不愿表达异议', '反方观点'])
  })

  it('files a one-line draft on bare ⏎ and returns to the board it landed on', async () => {
    const { mocks, store, props } = makeBench([board(CANVAS_ID, [card('c_1')])])
    render(<CanvasTab {...props} />)
    await pickCategory('反方观点')
    const editor = await screen.findByPlaceholderText(/写点什么/)
    // One line: the hint promises ⏎.
    screen.getByText('⏎ 建卡 · Esc 关掉这张标签')
    fireEvent.compositionStart(editor)
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
    expect(mocks.putCard).not.toHaveBeenCalled()
    fireEvent.compositionEnd(editor)
    typeInto(editor, '会上其实有人想反对')
    // A stray blur is never a create.
    fireEvent.blur(editor)
    expect(mocks.putCard).not.toHaveBeenCalled()
    fireEvent.keyDown(editor, { key: 'Enter' })
    await waitFor(() => {
      expect(mocks.putCard).toHaveBeenCalledWith('s1', {
        canvasId: CANVAS_ID, kind: custom.id, text: '会上其实有人想反对',
      })
    })
    await screen.findByText('已建卡')
    // The row's work is done: it comes off the strip, and the board that took
    // the card is what shows.
    expect(store.source.getSnapshot().tabs.map(row => row.id)).toEqual([boardTabId(CANVAS_ID)])
    expect(store.source.getSnapshot().active).toBe(boardTabId(CANVAS_ID))
    await screen.findByText('卡片 c_1')
  })

  it('treats ⏎ as the newline it is once the draft runs to two lines — ⌘⏎ still files', async () => {
    const { mocks, store, props } = makeBench([board(CANVAS_ID, [card('c_1')])])
    render(<CanvasTab {...props} />)
    await pickCategory('反方观点')
    const editor = await screen.findByPlaceholderText(/写点什么/)
    typeInto(editor, '第一行\n第二行')
    // Two lines: ⏎ is a newline and the hint says so.
    screen.getByText('⌘⏎ 建卡（⏎ 已是换行）· Esc 关掉这张标签')
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(mocks.putCard).not.toHaveBeenCalled()
    // Shift+⏎ is the explicit newline even while the words are one line.
    typeInto(editor, '只有一行')
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true })
    expect(mocks.putCard).not.toHaveBeenCalled()
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
    await waitFor(() => {
      expect(mocks.putCard).toHaveBeenCalledWith('s1', {
        canvasId: CANVAS_ID, kind: custom.id, text: '只有一行',
      })
    })
    await screen.findByText('已建卡')
    expect(store.source.getSnapshot().active).toBe(boardTabId(CANVAS_ID))
  })

  it('saves a draft that is only ink, with the strokes and an empty body', async () => {
    const { mocks, props } = makeBench([board(CANVAS_ID, [card('c_1')])])
    const { container } = render(<CanvasTab {...props} />)
    await pickCategory('灵感')
    await screen.findByPlaceholderText(/写点什么/)
    fireEvent.click(screen.getByRole('button', { name: '铅笔' }))
    drawOneStroke(container)
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
    await waitFor(() => {
      expect(mocks.putCard).toHaveBeenCalledWith('s1', expect.objectContaining({
        canvasId: CANVAS_ID, kind: 'fragment', text: '',
      }))
    })
    const request = mocks.putCard.mock.calls[0]![1] as { draw?: readonly unknown[] }
    expect(request.draw).toHaveLength(1)
  })

  it('closes an untouched draft without a question, and asks once about a drafted one', async () => {
    const { mocks, store, props } = makeBench([board(CANVAS_ID, [card('c_1')])])
    render(<CanvasTab {...props} />)
    await pickCategory('问题')
    const closeBox = () => screen.getAllByRole('button', { name: '关闭这张标签' }).at(-1)!

    // Nothing written: the × takes the row off and asks nothing.
    fireEvent.click(closeBox())
    await waitFor(() => {
      expect(store.source.getSnapshot().tabs.map(row => row.id)).toEqual([boardTabId(CANVAS_ID)])
    })
    expect(screen.queryByRole('dialog')).toBeNull()

    // Back in the menu, with words this time: the question names them, and
    // 继续编辑 keeps every character.
    fireEvent.click(screen.getByRole('tab', { name: '为什么人们不愿表达异议' }))
    await pickCategory('问题')
    typeInto(await screen.findByPlaceholderText(/写点什么/), '不表达是因为害怕吗？')
    fireEvent.click(closeBox())
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('10')
    fireEvent.click(within(dialog).getByRole('button', { name: '继续编辑' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(store.source.getSnapshot().active).toBe(draftTabId(CANVAS_ID))
    expect(mocks.putCard).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText(/写点什么/)).toHaveProperty('value', '不表达是因为害怕吗？')

    // Esc is the same exit, and 丢掉 takes the row off without writing anything.
    fireEvent.keyDown(screen.getByPlaceholderText(/写点什么/), { key: 'Escape' })
    fireEvent.click(await screen.findByRole('button', { name: '丢掉' }))
    await waitFor(() => {
      expect(store.source.getSnapshot().tabs.map(row => row.id)).toEqual([boardTabId(CANVAS_ID)])
    })
    expect(mocks.putCard).not.toHaveBeenCalled()
  })

  it('holds one draft per canvas while another canvas’s draft is open', async () => {
    const { store, props } = makeBench([
      board(CANVAS_ID, [card('c_1')]), board(OTHER_ID, [card('c_9')]),
    ])
    render(<CanvasTab {...props} />)
    await pickCategory('问题')
    typeInto(await screen.findByPlaceholderText(/写点什么/), '甲块的草稿')
    fireEvent.click(screen.getByRole('button', { name: '画布' }))
    fireEvent.click(await screen.findByText('第二块画布'))
    await screen.findByText('卡片 c_9')
    fireEvent.click(screen.getByRole('button', { name: /新卡/ }))
    fireEvent.click(await screen.findByRole('button', { name: '共识' }))
    // Two draft rows, one per canvas, each holding its own words.
    expect(store.source.getSnapshot().tabs.map(row => row.kind))
      .toEqual(['board', 'draft', 'board', 'draft'])
    fireEvent.click(screen.getByRole('tab', { name: '问题' }))
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/写点什么/)).toHaveProperty('value', '甲块的草稿')
    })
  })
})

describe('CanvasTab — an empty strip', () => {
  it('says where the ＋ is once the user has closed every row, and does not re-open one', async () => {
    const { props, store } = makeBench([board(CANVAS_ID, [card('c_1')])])
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getByRole('button', { name: '关闭这张标签' }))
    await screen.findByText(/没有打开的标签了/)
    expect(store.source.getSnapshot().tabs).toHaveLength(0)
    // The auto-open is a convenience for a fresh surface, not an argument: it
    // does not put the row back.
    await new Promise(resolve => { setTimeout(resolve, 20) })
    expect(store.source.getSnapshot().tabs).toHaveLength(0)
    expect(screen.getByText('没有打开的标签了，点上面的「＋ 画布」挑一块或新建一块')).toBeTruthy()
  })

  it('still says 还没有画布 when the account genuinely has none', async () => {
    const { props } = makeBench([])
    render(<CanvasTab {...props} />)
    expect(await screen.findByText('还没有画布')).toBeTruthy()
    expect(screen.queryByText(/没有打开的标签了/)).toBeNull()
  })
})

describe('CanvasTabTitle — the dock chip', () => {
  it('reads 画布 for a board row and names the card for a card row', async () => {
    const { store, titleProps } = makeBench([board(CANVAS_ID, [card('c_1')])])
    const { rerender } = render(<CanvasTabTitle {...titleProps} />)
    store.openCanvas(CANVAS_ID)
    rerender(<CanvasTabTitle {...titleProps} />)
    expect(screen.getByText('画布')).toBeTruthy()
    store.openCardTab(CANVAS_ID, 'c_1', '会上没人开口')
    rerender(<CanvasTabTitle {...titleProps} />)
    await waitFor(() => {
      expect(screen.getByText('画布 · 会上没人开口')).toBeTruthy()
    })
  })
})
