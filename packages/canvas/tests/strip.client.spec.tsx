// @vitest-environment jsdom
/**
 * The canvas surface's own tab strip (round-3 review, item ⑥): the store that
 * holds its rows, and the page that routes a row to its body.
 *
 * Stage ⑧ put a card's detail in the HOST dock; item ⑥ moved it in here; the
 * 2026-09-27 review (scheme B) made the strip hold canvases only, with a card or
 * the draft standing INSIDE its canvas's row. What these specs lock: one row per
 * canvas that remembers where in it you stood, the crumb row as the way back
 * (and its ‹n/m› through the board's order), the ＋ tile's kind re-categorizing
 * the one draft, the discard question on both × and ‹, the per-canvas view
 * memory, the eviction order when the strip fills up, and the stash that
 * survives a reload — including one written by the older card-row strip.
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
  BoardAttachImageOutcome, BoardFocusResult,
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
    manuscripts: [],
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

  it('holds one row per canvas, and a card opens inside it', () => {
    const store = new CanvasSelectionStore()
    store.openCanvas(CANVAS_ID)
    store.openCardTab(CANVAS_ID, 'c_1', '第一版标题')
    store.openCardTab(CANVAS_ID, 'c_2', '第二张')
    store.openCardTab(CANVAS_ID, 'c_1', '改过的标题')
    const state = store.source.getSnapshot()
    expect(state.tabs.map(row => row.id)).toEqual([boardTabId(CANVAS_ID)])
    // The row takes the new place with its payload: the heading is what the
    // card is called NOW.
    expect(state.tabs[0]?.at).toEqual({ kind: 'card', cardId: 'c_1', heading: '改过的标题' })
    store.backToBoard(CANVAS_ID)
    expect(store.source.getSnapshot().tabs[0]?.at).toEqual({ kind: 'board' })
  })

  it('returns to the card a canvas was left on', () => {
    const store = new CanvasSelectionStore()
    store.openCardTab(CANVAS_ID, 'c_1', '一')
    store.openCanvas(OTHER_ID)
    expect(store.source.getSnapshot().canvasId).toBe(OTHER_ID)
    store.openCanvas(CANVAS_ID)
    const state = store.source.getSnapshot()
    expect(state.active).toBe(boardTabId(CANVAS_ID))
    expect(state.tabs.find(row => row.canvasId === CANVAS_ID)?.at).toMatchObject({ kind: 'card', cardId: 'c_1' })
  })

  it('re-categorizes the open draft instead of seating a second blank one', () => {
    const store = new CanvasSelectionStore()
    store.openCanvas(CANVAS_ID)
    store.openDraftTab(CANVAS_ID, 'question', '问题')
    store.openDraftTab(CANVAS_ID, custom.id, '反方观点')
    const state = store.source.getSnapshot()
    expect(state.tabs).toHaveLength(1)
    const at = state.tabs[0]?.at
    expect(at?.kind === 'draft' && at.catKind).toBe(custom.id)
  })

  it('activates the left neighbour on a close, and goes quiet on the last row', () => {
    const store = new CanvasSelectionStore()
    const third = 'canvas_thirdzzzabcdefgh'
    store.openCanvas(CANVAS_ID)
    store.openCanvas(OTHER_ID)
    store.openCanvas(third)
    store.close(boardTabId(third))
    expect(store.source.getSnapshot().active).toBe(boardTabId(OTHER_ID))
    // Closing a row that is not showing leaves the view alone.
    store.close(boardTabId(CANVAS_ID))
    expect(store.source.getSnapshot().active).toBe(boardTabId(OTHER_ID))
    store.close(boardTabId(OTHER_ID))
    const state = store.source.getSnapshot()
    expect(state.tabs).toHaveLength(0)
    expect(state.active).toBe('')
    // No row means no canvas, so the session's tools have no target either.
    expect(state.canvasId).toBeNull()
  })

  it('sends a row standing on a deleted card back to its board, and leaves other rows alone', () => {
    const store = new CanvasSelectionStore()
    store.openCardTab(OTHER_ID, 'c_9', '九')
    store.openCardTab(CANVAS_ID, 'c_1', '一')
    // Another card of the canvas: the row's place does not move.
    store.forget(CANVAS_ID, 'c_2')
    expect(store.source.getSnapshot().tabs[1]?.at).toMatchObject({ kind: 'card', cardId: 'c_1' })
    store.forget(CANVAS_ID, 'c_1')
    const state = store.source.getSnapshot()
    expect(state.tabs.map(row => row.at.kind)).toEqual(['card', 'board'])
    expect(state.active).toBe(boardTabId(CANVAS_ID))
  })

  it('forgets a deleted canvas\'s row and shows the neighbour', () => {
    const store = new CanvasSelectionStore()
    store.openCanvas(OTHER_ID)
    store.openCardTab(CANVAS_ID, 'c_1', '一')
    store.forget(CANVAS_ID)
    const state = store.source.getSnapshot()
    expect(state.tabs.map(row => row.id)).toEqual([boardTabId(OTHER_ID)])
    expect(state.active).toBe(boardTabId(OTHER_ID))
    store.forget(OTHER_ID)
    expect(store.source.getSnapshot().active).toBe('')
  })

  it('caps the strip by evicting the oldest canvas, sparing a draft, the showing row and the new one', () => {
    const store = new CanvasSelectionStore()
    store.openDraftTab(CANVAS_ID, 'question', '问题')
    for (let index = 0; index < 20; index += 1) {
      store.openCanvas(`canvas_n${String(index).padStart(2, '0')}abcdefgh`)
    }
    const state = store.source.getSnapshot()
    expect(state.tabs).toHaveLength(16)
    // The draft's row costs words, so it outlives canvases opened after it.
    expect(state.tabs.some(row => row.canvasId === CANVAS_ID && row.at.kind === 'draft')).toBe(true)
    expect(state.active).toBe(boardTabId('canvas_n19abcdefgh'))
    expect(state.tabs.some(row => row.canvasId === 'canvas_n00abcdefgh')).toBe(false)
  })

  it('brings the strip back through sessionStorage, and drops what it cannot vouch for', () => {
    const first = new CanvasSelectionStore()
    first.openCanvas(OTHER_ID)
    first.openCardTab(CANVAS_ID, 'c_1', '一张卡')
    const restored = new CanvasSelectionStore().source.getSnapshot()
    expect(restored.tabs.map(row => row.id)).toEqual([boardTabId(OTHER_ID), boardTabId(CANVAS_ID)])
    expect(restored.tabs[1]?.at).toEqual({ kind: 'card', cardId: 'c_1', heading: '一张卡' })
    expect(restored.active).toBe(boardTabId(CANVAS_ID))

    // A draft's words never rode the stash, so its row comes back on its board.
    first.openDraftTab(OTHER_ID, 'question', '问题')
    expect(new CanvasSelectionStore().source.getSnapshot().tabs[0]?.at).toEqual({ kind: 'board' })

    sessionStorage.setItem('dsh-canvas.tabs', JSON.stringify({ tabs: [{ id: 'x', kind: 'who-knows' }], active: 'x' }))
    expect(new CanvasSelectionStore().source.getSnapshot().tabs).toHaveLength(0)
    sessionStorage.setItem('dsh-canvas.tabs', '{not json')
    expect(new CanvasSelectionStore().source.getSnapshot().tabs).toHaveLength(0)
  })

  it('folds a stash from the card-row strip into one board row per canvas', () => {
    sessionStorage.setItem('dsh-canvas.tabs', JSON.stringify({
      tabs: [
        { id: boardTabId(CANVAS_ID), kind: 'board', canvasId: CANVAS_ID },
        { id: cardTabId(CANVAS_ID, 'c_1'), kind: 'card', canvasId: CANVAS_ID, cardId: 'c_1', heading: '一' },
        { id: draftTabId(OTHER_ID), kind: 'draft', canvasId: OTHER_ID, catKind: 'question', heading: '问题' },
      ],
      active: draftTabId(OTHER_ID),
    }))
    const state = new CanvasSelectionStore().source.getSnapshot()
    expect(state.tabs).toEqual([
      { id: boardTabId(CANVAS_ID), canvasId: CANVAS_ID, at: { kind: 'board' } },
      { id: boardTabId(OTHER_ID), canvasId: OTHER_ID, at: { kind: 'board' } },
    ])
    expect(state.active).toBe(boardTabId(OTHER_ID))
    expect(state.canvasId).toBe(OTHER_ID)
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
    talkAvailable: vi.fn((): boolean => false),
    quoteToConversation: vi.fn((): boolean => true),
    refreshBoards: vi.fn(),
    suggestWideMode: vi.fn(),
    images,
    // The production wiring, verb for verb (src/client/index.ts).
    openCanvas: (canvasId: string) => { store.openCanvas(canvasId) },
    openCardDetail: (canvasId: string, cardId: string, heading: string) => { store.openCardTab(canvasId, cardId, heading) },
    openCardDraft: (canvasId: string, kind: Parameters<typeof store.openDraftTab>[1], heading: string) => {
      store.openDraftTab(canvasId, kind, heading)
    },
    backToBoard: (canvasId: string) => { store.backToBoard(canvasId) },
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
/** The board's dashed new-card tile, named for the kind it starts (新增灵感卡片). */
const NEW_TILE = /^新增.*卡片$/

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

/** Click a card on the board. */
async function clickCard(words: string): Promise<void> {
  fireEvent.click(await screen.findByText(words))
}

/** The crumb row's ‹: back to the board. */
function backToBoard(): void {
  fireEvent.click(screen.getByRole('button', { name: '回到卡板' }))
}

/** The crumb row's current place (the card's or the draft's name). */
function crumbHere(): string {
  return within(screen.getByRole('navigation', { name: '所在位置' })).getByText((_, node) =>
    node?.getAttribute('aria-current') === 'page').textContent ?? ''
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

  it('opens a card inside the canvas row, and the crumb goes back to the board', async () => {
    const { props, store } = makeBench([board(CANVAS_ID, [card('c_1', { text: '会上没人开口' })])])
    render(<CanvasTab {...props} />)
    await clickCard('会上没人开口')
    // Still one row: the card stands inside its canvas, named by the crumb.
    expect(stripLabels()).toEqual(['为什么人们不愿表达异议'])
    await waitFor(() => { expect(crumbHere()).toBe('会上没人开口') })
    // The canvas's name in the crumb is a way back too.
    fireEvent.click(within(screen.getByRole('navigation', { name: '所在位置' }))
      .getByRole('button', { name: '为什么人们不愿表达异议' }))
    await screen.findByRole('button', { name: NEW_TILE })
    expect(store.source.getSnapshot().tabs[0]?.at).toEqual({ kind: 'board' })
    await clickCard('会上没人开口')
    backToBoard()
    await screen.findByRole('button', { name: NEW_TILE })
  })

  it('steps through the board’s shown order, and hides the stepper for a lone card', async () => {
    const { props } = makeBench([board(CANVAS_ID, [
      card('c_1', { text: '第一张的正文', kind: 'question' }),
      card('c_2', { text: '第二张的正文' }),
      card('c_3', { text: '第三张的正文', kind: 'question' }),
    ])])
    render(<CanvasTab {...props} />)
    await clickCard('第一张的正文')
    await screen.findByText('1/3')
    expect(screen.getByRole('button', { name: '上一张' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: '下一张' }))
    await waitFor(() => { expect(crumbHere()).toBe('第二张的正文') })
    expect(screen.getByText('2/3')).toBeTruthy()

    // The order is the board's CURRENT one: filtered to 问题, the second card
    // is not on the way, and a card the filter hides has no stepper at all.
    backToBoard()
    fireEvent.click(await screen.findByRole('button', { name: '问题 2' }))
    await clickCard('第三张的正文')
    await screen.findByText('2/2')
    fireEvent.click(screen.getByRole('button', { name: '上一张' }))
    await waitFor(() => { expect(crumbHere()).toBe('第一张的正文') })
    expect(screen.getByRole('button', { name: '下一张' })).toHaveProperty('disabled', false)
  })

  it('keeps the reader for the card it shows: stepping never carries the text across', async () => {
    const { props } = makeBench([board(CANVAS_ID, [
      card('c_1', { text: '甲的正文' }), card('c_2', { text: '乙的正文' }),
    ])])
    render(<CanvasTab {...props} />)
    await clickCard('甲的正文')
    fireEvent.click(await screen.findByRole('button', { name: '源码' }))
    const editor = await screen.findByDisplayValue('甲的正文')
    typeInto(editor, '甲被改了一半')
    // Step to the other card mid-edit: the pad it shows is ITS own, not the
    // uncontrolled textarea this card was typing in.
    fireEvent.click(screen.getByRole('button', { name: '下一张' }))
    await waitFor(() => {
      expect(screen.queryByDisplayValue('甲被改了一半')).toBeNull()
    })
    fireEvent.click(await screen.findByRole('button', { name: '源码' }))
    await screen.findByDisplayValue('乙的正文')
  })

  it('remembers each canvas’s filter across a card and across another canvas', async () => {
    const { props, store } = makeBench([
      board(CANVAS_ID, [card('c_1', { text: '甲的问题卡', kind: 'question' })]),
      board(OTHER_ID, [card('c_9', { text: '乙的正文' })]),
    ])
    render(<CanvasTab {...props} />)
    await screen.findByText('甲的问题卡')
    fireEvent.click(screen.getByRole('button', { name: '问题 1' }))
    await clickCard('甲的问题卡')
    backToBoard()
    expect((await screen.findByRole('button', { name: '问题 1' })).getAttribute('data-active')).toBe('true')
    // Another canvas's board starts fresh…
    act(() => { store.openCanvas(OTHER_ID) })
    await screen.findByText('乙的正文')
    expect(screen.getByRole('button', { name: '全部 1' }).getAttribute('data-active')).toBe('true')
    // …and coming back finds the filter this canvas was left with.
    act(() => { store.openCanvas(CANVAS_ID) })
    await screen.findByText('甲的问题卡')
    expect(screen.getByRole('button', { name: '问题 1' }).getAttribute('data-active')).toBe('true')
  })

  it('re-files a card from its category tag', async () => {
    const { props, mocks } = makeBench([board(CANVAS_ID, [card('c_1', { text: '会上没人开口' })])])
    const patchCard = (props as unknown as { patchCard: ReturnType<typeof vi.fn> }).patchCard
    render(<CanvasTab {...props} />)
    await clickCard('会上没人开口')
    fireEvent.click(await screen.findByRole('button', { name: /灵感/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '问题' }))
    await waitFor(() => {
      expect(patchCard).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, cardId: 'c_1', kind: 'question' })
    })
    expect(mocks.putCard).not.toHaveBeenCalled()
  })
})

describe('CanvasTab — the draft row', () => {
  /**
   * Open the ＋新卡 menu, pick one of its rows, and take the in-place draft to
   * the full editor (展开) — the draft row these tests are about.
   */
  async function pickCategory(label: string, cardText = '卡片 c_1'): Promise<void> {
    await screen.findByText(cardText)
    fireEvent.click(screen.getByRole('button', { name: NEW_TILE }))
    const kind = await screen.findByRole('combobox', { name: '新卡的分类' })
    const option = within(kind).getByRole('option', { name: label }) as HTMLOptionElement
    fireEvent.change(kind, { target: { value: option.value } })
    fireEvent.click(await screen.findByRole('button', { name: '展开' }))
  }

  it('opens the menu’s pick inside the canvas row, and a second pick re-categorizes it', async () => {
    const { props, store } = makeBench([board(CANVAS_ID, [card('c_1')])])
    render(<CanvasTab {...props} />)
    await pickCategory('问题')
    await screen.findByPlaceholderText(/写点什么/)
    expect(store.source.getSnapshot().tabs.map(row => row.id)).toEqual([boardTabId(CANVAS_ID)])
    expect(stripLabels()).toEqual(['为什么人们不愿表达异议'])
    expect(crumbHere()).toBe('新卡片')

    // The draft's category tag is the other way to re-file it before it exists.
    fireEvent.click(screen.getByRole('button', { name: /问题/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '反方观点' }))
    await waitFor(() => {
      const at = store.source.getSnapshot().tabs[0]?.at
      expect(at?.kind === 'draft' && at.catKind).toBe(custom.id)
    })
    expect(store.source.getSnapshot().tabs).toHaveLength(1)
  })

  it('files a one-line draft on bare ⏎ and returns to the board it landed on', async () => {
    const { mocks, store, props } = makeBench([board(CANVAS_ID, [card('c_1')])])
    render(<CanvasTab {...props} />)
    await pickCategory('反方观点')
    const editor = await screen.findByPlaceholderText(/写点什么/)
    // One line: the hint promises ⏎.
    screen.getByText('⏎ 建卡 · Esc 回到卡板')
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
    // The draft's work is done: the row goes back to the board that took the card.
    expect(store.source.getSnapshot().tabs).toEqual([
      { id: boardTabId(CANVAS_ID), canvasId: CANVAS_ID, at: { kind: 'board' } },
    ])
    await screen.findByText('卡片 c_1')
  })

  it('treats ⏎ as the newline it is once the draft runs to two lines — ⌘⏎ still files', async () => {
    const { mocks, store, props } = makeBench([board(CANVAS_ID, [card('c_1')])])
    render(<CanvasTab {...props} />)
    await pickCategory('反方观点')
    const editor = await screen.findByPlaceholderText(/写点什么/)
    typeInto(editor, '第一行\n第二行')
    // Two lines: ⏎ is a newline and the hint says so.
    screen.getByText('⌘⏎ 建卡（⏎ 已是换行）· Esc 回到卡板')
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
    expect(store.source.getSnapshot().tabs[0]?.at).toEqual({ kind: 'board' })
  })

  it('saves a draft that is only ink, with the drawing placed by its pointer line', async () => {
    const { mocks, props } = makeBench([board(CANVAS_ID, [card('c_1')])])
    const { container } = render(<CanvasTab {...props} />)
    await pickCategory('灵感')
    await screen.findByPlaceholderText(/写点什么/)
    // 手绘 adds a drawing block with the pen already out.
    const add = screen.getByRole('button', { name: '手绘' })
    fireEvent.click(add)
    drawOneStroke(container)
    fireEvent.keyDown(add, { key: 'Enter', metaKey: true })
    await waitFor(() => {
      expect(mocks.putCard).toHaveBeenCalledWith('s1', expect.objectContaining({
        canvasId: CANVAS_ID, kind: 'fragment', text: '![](draw://d1)',
      }))
    })
    const request = mocks.putCard.mock.calls[0]![1] as { drawings?: Record<string, readonly unknown[]> }
    expect(request.drawings?.d1).toHaveLength(1)
  })

  it('leaves an untouched draft without a question, and asks once about a drafted one', async () => {
    const { mocks, store, props } = makeBench([board(CANVAS_ID, [card('c_1')])])
    render(<CanvasTab {...props} />)
    await pickCategory('问题')
    const place = () => store.source.getSnapshot().tabs[0]?.at.kind

    // Nothing written: ‹ goes back and asks nothing.
    await screen.findByPlaceholderText(/写点什么/)
    backToBoard()
    await waitFor(() => { expect(place()).toBe('board') })
    expect(screen.queryByRole('dialog')).toBeNull()

    // With words this time: the question names them, and 继续编辑 keeps every
    // character.
    await pickCategory('问题')
    typeInto(await screen.findByPlaceholderText(/写点什么/), '不表达是因为害怕吗？')
    backToBoard()
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('10')
    fireEvent.click(within(dialog).getByRole('button', { name: '继续编辑' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(place()).toBe('draft')
    expect(mocks.putCard).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText(/写点什么/)).toHaveProperty('value', '不表达是因为害怕吗？')

    // The strip's × asks the same question before the canvas row goes.
    fireEvent.click(screen.getByRole('button', { name: '关闭这块画布' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '继续编辑' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(store.source.getSnapshot().tabs).toHaveLength(1)

    // Esc is the same exit, and 丢掉 goes back without writing anything.
    fireEvent.keyDown(screen.getByPlaceholderText(/写点什么/), { key: 'Escape' })
    fireEvent.click(await screen.findByRole('button', { name: '丢掉' }))
    await waitFor(() => { expect(place()).toBe('board') })
    expect(mocks.putCard).not.toHaveBeenCalled()
    // The words went with it: the next draft starts blank.
    await pickCategory('问题')
    expect(await screen.findByPlaceholderText(/写点什么/)).toHaveProperty('value', '')
  })

  it('keeps one draft per canvas across a switch to another canvas', async () => {
    const { store, props } = makeBench([
      board(CANVAS_ID, [card('c_1')]), board(OTHER_ID, [card('c_9')]),
    ])
    render(<CanvasTab {...props} />)
    await pickCategory('问题')
    typeInto(await screen.findByPlaceholderText(/写点什么/), '甲块的草稿')
    fireEvent.click(screen.getByRole('button', { name: '画布' }))
    fireEvent.click(await screen.findByText('第二块画布'))
    await pickCategory('共识', '卡片 c_9')
    // Two canvas rows, each standing on its own draft with its own words.
    expect(store.source.getSnapshot().tabs.map(row => row.at.kind)).toEqual(['draft', 'draft'])
    expect(stripLabels()).toEqual(['为什么人们不愿表达异议', '第二块画布'])
    fireEvent.click(screen.getByRole('tab', { name: '为什么人们不愿表达异议' }))
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
    fireEvent.click(screen.getByRole('button', { name: '关闭这块画布' }))
    await screen.findByText(/没有打开的画布了/)
    expect(store.source.getSnapshot().tabs).toHaveLength(0)
    // The auto-open is a convenience for a fresh surface, not an argument: it
    // does not put the row back.
    await new Promise(resolve => { setTimeout(resolve, 20) })
    expect(store.source.getSnapshot().tabs).toHaveLength(0)
    expect(screen.getByText('没有打开的画布了，点上面的「画布」挑一块或新建一块')).toBeTruthy()
  })

  it('still says 还没有画布 when the account genuinely has none', async () => {
    const { props } = makeBench([])
    render(<CanvasTab {...props} />)
    expect(await screen.findByText('还没有画布')).toBeTruthy()
    expect(screen.queryByText(/没有打开的画布了/)).toBeNull()
  })
})

describe('CanvasTabTitle — the dock chip', () => {
  it('reads 画布 on a board and names the card a canvas row stands on', async () => {
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
