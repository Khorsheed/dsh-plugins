// @vitest-environment jsdom
/**
 * The canvas tab (M3's single seat) under the composed-props form: a REAL
 * CanvasSelectionStore (the open canvas, the drilled card, the rev channel),
 * injected Remote mocks over a multi-canvas fake host, and plain hook fakes.
 * Asserts the list → auto-open → board chain, the switcher (create / archive
 * / import), the board gestures (new card, ghost ✓/✗, checkbox multi-select,
 * talk quotes, follow-up, their full-hide degrade), the drill (body click →
 * detail page → back, the tri-state source save), the new-card draft (the
 * ⏎-or-⌘⏎ save that returns to the board, the one discard question), focus reporting, the
 * once-per-session wide-mode suggestion, and the read-only degrade.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect, useSyncExternalStore } from 'react'
import type { CanvasTabProps } from '../src/client/contract.ts'
import { CanvasImageSrcs } from '../src/client/images.ts'
import { CanvasSelectionStore } from '../src/client/space/selection.ts'
import { CanvasTab } from '../src/client/tab/CanvasTab.tsx'
import { zh } from '../src/client/locales.ts'
import { defaultCategories } from '../src/types.ts'
import type {
  BoardAttachImageOutcome, BoardFocusResult,
  BoardListResult, BoardMutationResult, BoardReadOutcome,
  BoardCategory, CanvasBoard, CanvasSummary,
} from '../src/types.ts'

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

const NOW = '2026-09-16T08:00:00.000Z'
const CANVAS_ID = 'canvas_01234567abcdefgh'
/** One stored image's id: the digest shape a card-held pointer insists on. */
const IMG_ID = `sha256:${'0123456789abcdef'.repeat(4)}`
/** The same image's pointer, as a card holds it (§10.3). */
const IMG_SRC = `attachment://${IMG_ID}?mediaType=image/png&bytes=3&width=2&height=1`

/** A plain translate over the zh dictionary (the key-set source of truth). */
const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as CanvasTabProps['t']

/** The board's dashed new-card tile, named for the kind it starts (新增灵感卡片). */
const NEW_TILE = /^新增.*卡片$/

/** One board fixture; cards land in array order. */
function board(id = CANVAS_ID, cards: CanvasBoard['cards'] = [], overrides: Partial<CanvasBoard> = {}): CanvasBoard {
  return {
    id,
    title: '为什么人们不愿表达异议',
    attachedWorkspaces: [],
    chat: { sessionId: null },
    cards,
    categories: defaultCategories(),
    links: [],
    lanes: [],
    manuscripts: [],
    stats: { proposed: { accepted: 0, rejected: 0 }, kindCounts: {}, lastActiveAt: NOW },
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
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
    cardCount: value.cards.filter(card => card.status !== 'archived').length,
    openQuestions: 0,
    archivedAt: value.archivedAt,
    lastActiveAt: value.stats.lastActiveAt,
  }
}

interface Harness {
  readonly store: CanvasSelectionStore
  readonly mocks: {
    listCanvases: ReturnType<typeof vi.fn>
    createCanvas: ReturnType<typeof vi.fn>
    readBoard: ReturnType<typeof vi.fn>
    putCard: ReturnType<typeof vi.fn>
    patchCard: ReturnType<typeof vi.fn>
    setCategories: ReturnType<typeof vi.fn>
    addComment: ReturnType<typeof vi.fn>
    archiveCanvas: ReturnType<typeof vi.fn>
    openFile: ReturnType<typeof vi.fn>
    openCardDetail: ReturnType<typeof vi.fn>
    openCardDraft: ReturnType<typeof vi.fn>
    focusCanvas: ReturnType<typeof vi.fn>
    talkAvailable: ReturnType<typeof vi.fn>
    quoteToConversation: ReturnType<typeof vi.fn>
    refreshBoards: ReturnType<typeof vi.fn>
    suggestWideMode: ReturnType<typeof vi.fn>
    deleteCanvas: ReturnType<typeof vi.fn>
    deleteCard: ReturnType<typeof vi.fn>
  }
  readonly props: CanvasTabProps
  /** The fake host's boards by id (mutations apply to them). */
  readonly boards: Map<string, CanvasBoard>
}

/** Mount the tab over a fake host holding the given boards. */
function makeHarness(options: {
  sessionId?: string | 'none'
  boards?: CanvasBoard[]
  workspaces?: readonly { workspaceId: string; path: string; title: string }[]
  chatAvailable?: boolean
} = {}): Harness {
  const boards = new Map((options.boards ?? [board()]).map(value => [value.id, value]))
  const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
  // A bench starts on an empty strip, every time: the store restores the rows a
  // previous bench left in sessionStorage, and those name cards its board has not.
  sessionStorage.clear()
  const store = new CanvasSelectionStore()
  // The REAL image cache over a fake read leg (§10.3): the tab reads its feed
  // as a subscription, so the feed is exercised here rather than faked away.
  const images = new CanvasImageSrcs(async () => ({
    ok: true as const,
    value: { ok: true as const, data: 'AAEC', mediaType: 'image/png' as const },
  }))
  const mutationFor = (canvasId: string): Result<BoardMutationResult> => {
    const current = boards.get(canvasId)
    if (current === undefined) return { ok: true, value: { ok: false, error: 'missing' } }
    return ok({ ok: true, board: current, version: '2' })
  }
  const mocks = {
    listCanvases: vi.fn(async (): Promise<Result<BoardListResult>> =>
      ok({ items: [...boards.values()].map(rowOf) })),
    createCanvas: vi.fn(async (_sid: string, request: { title: string; attachedWorkspaces?: readonly string[] }): Promise<Result<BoardMutationResult>> => {
      const minted = board('canvas_new00000abcdefgh', [], {
        title: request.title,
        attachedWorkspaces: [...(request.attachedWorkspaces ?? [])],
      })
      boards.set(minted.id, minted)
      return ok({ ok: true, board: minted, version: '1' })
    }),
    readBoard: vi.fn(async (request: { canvasId: string }): Promise<Result<BoardReadOutcome>> => {
      const current = boards.get(request.canvasId)
      if (current === undefined) return ok({ ok: false, error: 'missing' })
      return ok({ ok: true, board: current, version: '1' })
    }),
    putCard: vi.fn(async (sid: string, request: { canvasId: string }): Promise<Result<BoardMutationResult>> => mutationFor(request.canvasId)),
    patchCard: vi.fn(async (sid: string, request: { canvasId: string; cardId: string; kind?: string; text?: string; status?: 'proposed' | 'kept' | 'archived'; question?: { state: 'open' | 'exploring' | 'answered' } }): Promise<Result<BoardMutationResult>> => {
      const current = boards.get(request.canvasId)
      const target = current?.cards.find(candidate => candidate.id === request.cardId)
      if (target !== undefined) {
        if (request.kind !== undefined) target.kind = request.kind as typeof target.kind
        if (request.text !== undefined) target.text = request.text
        if (request.status !== undefined) target.status = request.status
        if (request.question !== undefined && target.question !== undefined) target.question.state = request.question.state
      }
      return mutationFor(request.canvasId)
    }),
    setCategories: vi.fn(async (sid: string, request: { canvasId: string; categories: BoardCategory[]; archiveCardIds?: string[] }): Promise<Result<BoardMutationResult>> => {
      const current = boards.get(request.canvasId)
      if (current !== undefined) {
        current.categories = request.categories.map(row => ({ ...row }))
        const gone = new Set(request.archiveCardIds ?? [])
        for (const candidate of current.cards) {
          if (gone.has(candidate.id)) candidate.status = 'archived'
        }
      }
      return mutationFor(request.canvasId)
    }),
    addComment: vi.fn(async (sid: string, request: { canvasId: string; cardId: string; text: string }): Promise<Result<BoardMutationResult>> => {
      const target = boards.get(request.canvasId)?.cards.find(candidate => candidate.id === request.cardId)
      target?.comments.push({ id: `m_${request.text.length}`, author: 'user', text: request.text, createdAt: NOW })
      return mutationFor(request.canvasId)
    }),
    setWorkspace: vi.fn(async (): Promise<Result<BoardMutationResult>> => ({ ok: true, value: { ok: false, error: 'missing' } })),
    archiveCanvas: vi.fn(async (sid: string, request: { canvasId: string; archived: boolean }): Promise<Result<BoardMutationResult>> => {
      const current = boards.get(request.canvasId)
      if (current !== undefined) current.archivedAt = request.archived ? NOW : null
      return mutationFor(request.canvasId)
    }),
    // The deletes forget their strip rows, exactly as the production face does.
    deleteCanvas: vi.fn(async (_sid: string, request: { canvasId: string }): Promise<Result<{ ok: true }>> => {
      boards.delete(request.canvasId)
      store.forget(request.canvasId)
      return ok({ ok: true })
    }),
    deleteCard: vi.fn(async (_sid: string, request: { canvasId: string; cardId: string }): Promise<Result<BoardMutationResult>> => {
      const current = boards.get(request.canvasId)
      if (current !== undefined) current.cards = current.cards.filter(candidate => candidate.id !== request.cardId)
      store.forget(request.canvasId, request.cardId)
      return mutationFor(request.canvasId)
    }),
    openFile: vi.fn(),
    // Stage ⑧: a card click hands the HOST an address, it does not change what
    // this tab renders. The mocks record the call; the board stays on screen.
    openCardDetail: vi.fn(),
    openCardDraft: vi.fn(),
    backToBoard: vi.fn(),
    // The category page is a place in the canvas's row, so the harness seats it
    // the way the production face does — these specs drive the page itself.
    openCategoriesPage: (canvasId: string, heading: string) => { store.openCategoriesTab(canvasId, heading) },
    // The strip's own two verbs are the store's, exactly as the production face
    // wires them; the detail openings stay recorders, because these specs assert
    // what the gesture PASSES, not what the strip then renders.
    activateTab: (id: string) => { store.activate(id) },
    closeTab: (id: string) => { store.close(id) },
    openCanvas: (canvasId: string) => { store.openCanvas(canvasId) },
    focusCanvas: vi.fn(async (): Promise<Result<BoardFocusResult>> => ok({ ok: true })),
    // No genre installed: the 创作体裁 entry and every genre seat stay away.
    listGenres: vi.fn(async () => ok([])),
    selectGenre: vi.fn(),
    openPage: vi.fn(),
    renderSlot: vi.fn(() => null),
    talkAvailable: vi.fn((): boolean => options.chatAvailable ?? true),
    quoteToConversation: vi.fn((): boolean => true),
    refreshBoards: vi.fn(),
    suggestWideMode: vi.fn(),
    attachImage: vi.fn(async (): Promise<Result<BoardAttachImageOutcome>> =>
      ok({ ok: true, ref: { attachmentId: IMG_ID, mediaType: 'image/png', bytes: 3, width: 2, height: 1 } })),
    images,
  }
  const sessionId = options.sessionId === 'none' ? undefined : (options.sessionId ?? 's1')
  const props = {
    t,
    sessionId,
    ...mocks,
    useSessions: ((selector: (snapshot: { byId: Record<string, { cwd: string }> }) => unknown) =>
      selector({ byId: sessionId === undefined ? {} : { [sessionId]: { cwd: '/ws' } } })) as CanvasTabProps['useSessions'],
    useWorkspaces: ((selector: (snapshot: { items: readonly unknown[] }) => unknown) =>
      selector({ items: options.workspaces ?? [] })) as CanvasTabProps['useWorkspaces'],
    useSelection: function useSelection<S>(selector: (snapshot: ReturnType<typeof store.source.getSnapshot>) => S): S {
      return selector(useSyncExternalStore(store.source.subscribe, store.source.getSnapshot))
    } as CanvasTabProps['useSelection'],
    useImageRev: function useImageRev<S>(selector: (snapshot: number) => S): S {
      return selector(useSyncExternalStore(images.source.subscribe, images.source.getSnapshot))
    } as CanvasTabProps['useImageRev'],
  } as unknown as CanvasTabProps
  return { store, mocks, props, boards }
}

afterEach(() => { cleanup() })

describe('CanvasTab — list, switcher, board', () => {
  it('leads a note that opens with a markdown heading with the heading, never its #', async () => {
    const { props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_h', { text: '## 雨夜的车站\n她没有回头' })])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('雨夜的车站')
    expect(screen.queryByText(/##/)).toBeNull()
    expect(screen.getByText('她没有回头')).toBeTruthy()
  })

  it('loads the list, auto-opens the first canvas, and renders its board', async () => {
    const { props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
  })

  // The notice used to test only "is the list known", so the whole
  // list-landed-but-board-still-out window read to the user as 还没有画布 —
  // the account does have a canvas, and the auto-open has already named it.
  it('waits on the board it already opened, instead of claiming an empty account', async () => {
    const { mocks, props, boards } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
    let release!: (value: Result<BoardReadOutcome>) => void
    mocks.readBoard.mockReturnValue(new Promise(resolve => { release = resolve }))
    render(<CanvasTab {...props} />)
    await waitFor(() => { expect(mocks.readBoard).toHaveBeenCalledWith({ canvasId: CANVAS_ID }) })
    expect(screen.getByText('加载中…')).toBeTruthy()
    expect(screen.queryByText('还没有画布')).toBeNull()
    const current = boards.get(CANVAS_ID)
    release({ ok: true, value: { ok: true, board: current as CanvasBoard, version: '1' } })
    await screen.findByText('卡片 c_1')
  })

  it('claims an empty account only once the list is known and empty', async () => {
    const { props } = makeHarness({ boards: [] })
    render(<CanvasTab {...props} />)
    expect(await screen.findByText('还没有画布')).toBeTruthy()
    expect(screen.queryByText('加载中…')).toBeNull()
  })

  it('opens the first canvas and reports the focus to the host', async () => {
    const { mocks, props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    await waitFor(() => {
      expect(mocks.focusCanvas).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID })
    })
  })

  it('switches canvases from the switcher and re-reports the focus', async () => {
    const other = board('canvas_second01abcdef', [card('c_x')], { title: '第二块画布' })
    const { mocks, props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')]), other] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getByRole('button', { name: '打开或新建画布' }))
    fireEvent.click(await screen.findByText('第二块画布'))
    await screen.findByText('卡片 c_x')
    await waitFor(() => {
      expect(mocks.focusCanvas).toHaveBeenCalledWith('s1', { canvasId: 'canvas_second01abcdef' })
    })
  })

  it('creates a canvas from the switcher form, attaching the picked workspaces', async () => {
    const { mocks, props } = makeHarness({
      workspaces: [{ workspaceId: 'w1', path: '/ws/report', title: 'report' }],
    })
    render(<CanvasTab {...props} />)
    await screen.findByRole('button', { name: '打开或新建画布' })
    fireEvent.click(screen.getByRole('button', { name: '打开或新建画布' }))
    fireEvent.click(screen.getByRole('button', { name: /新画布/ }))
    fireEvent.change(screen.getByPlaceholderText('这块画布思考什么主题？'), { target: { value: '远程团队的书面沟通礼仪' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'report' }))
    fireEvent.click(screen.getByRole('button', { name: '建立' }))
    await waitFor(() => {
      expect(mocks.createCanvas).toHaveBeenCalledWith('s1', { title: '远程团队的书面沟通礼仪', attachedWorkspaces: ['/ws/report'], genreId: null })
    })
    // No genre installed: the form carries no genre pick.
    expect(screen.queryByRole('radiogroup', { name: '体裁' })).toBeNull()
    // A created canvas is a NEW ROW and the showing one: the strip is where a
    // canvas appears now (its name is on the row and on the board header, so
    // the row is the only thing that identifies the event).
    await screen.findByRole('tab', { name: '远程团队的书面沟通礼仪', selected: true })
  })

  it('archives a canvas row from the switcher and restores it from the well', async () => {
    const { mocks, props, boards } = makeHarness()
    render(<CanvasTab {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: '打开或新建画布' }))
    fireEvent.click(screen.getByRole('button', { name: '归档' }))
    await waitFor(() => {
      expect(mocks.archiveCanvas).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, archived: true })
    })
    expect(boards.get(CANVAS_ID)?.archivedAt).not.toBeNull()
  })


  /** Whether this seat renders a drawing: the logical box is the give-away. */
  function hasFigure(container: HTMLElement): boolean {
    return Array.from(container.querySelectorAll('svg'))
      .some(candidate => candidate.getAttribute('viewBox') === '0 0 600 400')
  }

  it('shows a drawn card’s ink on the board, where an empty body would read as blank', async () => {
    const drawn = card('c_ink', {
      text: '',
      drawings: { main: [{ pts: [{ x: 100, y: 100, w: 5 }, { x: 300, y: 200, w: 4 }], color: 'ink' }] },
    })
    const { props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1'), drawn])] })
    const { container } = render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    expect(hasFigure(container)).toBe(true)
  })

  it('wires ghost proposals to patchCard status transitions (accept AND reject)', async () => {
    const ghostA = card('c_a', { kind: 'reference', status: 'proposed', createdBy: 'agent', text: '效能假说综述' })
    const ghostB = card('c_b', { kind: 'fragment', status: 'proposed', createdBy: 'agent', text: '反例笔记' })
    const { mocks, props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1'), ghostA, ghostB])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('效能假说综述')
    fireEvent.click(screen.getAllByRole('button', { name: /收下/ })[0]!)
    await waitFor(() => {
      expect(mocks.patchCard).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, cardId: 'c_a', status: 'kept' })
    })
    fireEvent.click(screen.getByRole('button', { name: /拒绝/ }))
    await waitFor(() => {
      expect(mocks.patchCard).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, cardId: 'c_b', status: 'archived' })
    })
  })

  it('selects cards through the hover checkbox and batch-archives them', async () => {
    const { mocks, props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1'), card('c_2')])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    const boxes = screen.getAllByRole('checkbox', { name: '选择' })
    fireEvent.click(boxes[0]!)
    fireEvent.click(boxes[1]!)
    await screen.findByText('已选 2 张')
    fireEvent.click(screen.getByRole('button', { name: '与 Agent 对谈' }))
    expect(mocks.quoteToConversation).toHaveBeenCalledTimes(1)
    const [sessionId, block] = mocks.quoteToConversation.mock.calls[0] as [string, string]
    expect(sessionId).toBe('s1')
    // Both picked cards, quoted in board order, each with its handle.
    expect(block.indexOf('> 卡片 c_1')).toBeLessThan(block.indexOf('> 卡片 c_2'))
    expect(block).toContain('c_1')
    expect(block).toContain('c_2')
    await screen.findByText('已放进对话输入框')
    fireEvent.click(screen.getByRole('button', { name: '让 Agent 写成稿' }))
    const written = mocks.quoteToConversation.mock.calls[1]?.[1] as string
    expect(written.startsWith(block)).toBe(true)
    expect(written.length).toBeGreaterThan(block.length)
    fireEvent.click(screen.getByRole('button', { name: /归档所选/ }))
    await waitFor(() => {
      expect(mocks.patchCard).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, cardId: 'c_1', status: 'archived' })
      expect(mocks.patchCard).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, cardId: 'c_2', status: 'archived' })
    })
  })

  it('shows a compact placeholder for an html card on the board, never the raw markup', async () => {
    const htmlCard = card('c_h', {
      kind: 'document',
      text: '<!DOCTYPE html><html><head><title>三次排期反馈记录</title></head><body><table><tr><td>1</td></tr><tr><td>2</td></tr></table></body></html>',
    })
    const { props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1'), htmlCard])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('三次排期反馈记录')
    expect(screen.queryByText(/DOCTYPE/)).toBeNull()
    expect(screen.queryByText(/<tr>/)).toBeNull()
  })

  it('hides every chat entry when the seam is absent, and the board keeps working', async () => {
    const commented = card('c_1', {
      comments: [{ id: 'm_1', author: 'agent', text: '这里隐含一个假设', createdAt: NOW }],
    })
    const { props } = makeHarness({ boards: [board(CANVAS_ID, [commented])], chatAvailable: false })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getAllByRole('checkbox', { name: '选择' })[0]!)
    await screen.findByText('已选 1 张')
    expect(screen.queryByRole('button', { name: '与 Agent 对谈' })).toBeNull()
    expect(screen.queryByRole('button', { name: '让 Agent 写成稿' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '1 条评论' }))
    await screen.findByText(/这里隐含一个假设/)
    expect(screen.queryByRole('button', { name: /追问/ })).toBeNull()
    expect(screen.getByRole('button', { name: /归档所选/ })).toBeTruthy()
  })
})

describe('CanvasTab — the category catalog (stage ⑤)', () => {
  /** One custom row, in the shape the page mints. */
  const custom: BoardCategory = { id: 'cat_01234567abc', label: '反方观点', order: 60, enabled: true }

  /** The default five with `document` retired and `custom` appended. */
  function catalog(): BoardCategory[] {
    return [...defaultCategories().map(row => (row.id === 'document' ? { ...row, enabled: false } : { ...row })), custom]
  }

  /** Mount a board over that catalog and open its category page. */
  async function mountCatalog(cards: CanvasBoard['cards'] = []): Promise<ReturnType<typeof makeHarness>> {
    const bench = makeHarness({ boards: [board(CANVAS_ID, cards, { categories: catalog() })] })
    render(<CanvasTab {...bench.props} />)
    await screen.findByRole('button', { name: /管理分类/ })
    fireEvent.click(screen.getByRole('button', { name: /管理分类/ }))
    await screen.findByText('只作用于这块画板')
    // The retired rows sit behind their disclosure; open it so every row is live.
    fireEvent.click(screen.getByRole('button', { name: /已停用/ }))
    return bench
  }

  it('strips the enabled rows onto the filter bar, and a chip filters its own cards', async () => {
    const { props } = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1'), card('c_2', { kind: custom.id }), card('c_3', { kind: 'document' })], { categories: catalog() })],
    })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    // The custom row is a chip like any other, the retired one is gone, and so
    // is the 「文档」 label — the card it files still shows its own chip.
    fireEvent.click(screen.getByRole('button', { name: /^反方观点/ }))
    await screen.findByText('卡片 c_2')
    expect(screen.queryByText('卡片 c_1')).toBeNull()
    expect(screen.queryByText('卡片 c_3')).toBeNull()
  })

  it('renames a row with one catalog write that touches no card', async () => {
    const { mocks } = await mountCatalog([card('c_1')])
    const rows = screen.getAllByRole('textbox', { name: '改这个名字' })
    // Five enabled rows first (the retired 「文档」 sits below them, in its own section).
    expect(rows).toHaveLength(6)
    // Enter blurs the field, and the blur is what commits it — focus first, so
    // jsdom has an activeElement to blur.
    rows[0]!.focus()
    fireEvent.change(rows[0]!, { target: { value: '  闪念  ' } })
    fireEvent.keyDown(rows[0]!, { key: 'Enter' })
    await waitFor(() => {
      expect(mocks.setCategories).toHaveBeenCalledWith('s1', expect.anything())
    })
    const request = mocks.setCategories.mock.calls[0]![1] as { canvasId: string; categories: BoardCategory[]; archiveCardIds?: string[] }
    expect(request.canvasId).toBe(CANVAS_ID)
    expect(request.categories.find(row => row.id === 'fragment')).toMatchObject({ label: '闪念' })
    // The id, the order and the enabled flag all ride through unchanged: a
    // rename is display-only, and cards store the id.
    expect(request.categories.find(row => row.id === 'fragment')).toMatchObject({ order: 10, enabled: true })
    expect(request.archiveCardIds).toBeUndefined()
    expect(mocks.patchCard).not.toHaveBeenCalled()
  })

  it('mints a cat_ row for a new category, last in the strip', async () => {
    const { mocks } = await mountCatalog([card('c_1')])
    const input = screen.getByRole('textbox', { name: '加一个' })
    expect((screen.getByRole('button', { name: '加一个' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: '待办' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(mocks.setCategories).toHaveBeenCalledWith('s1', expect.anything())
    })
    const request = mocks.setCategories.mock.calls[0]![1] as { categories: BoardCategory[] }
    const added = request.categories[request.categories.length - 1]!
    expect(added).toMatchObject({ label: '待办', enabled: true })
    expect(added.id.startsWith('cat_')).toBe(true)
    expect(added.order).toBeGreaterThan(Math.max(...request.categories.slice(0, -1).map(row => row.order)))
    // The field clears for the next one.
    expect((screen.getByRole('textbox', { name: '加一个' }) as HTMLInputElement).value).toBe('')
  })

  it('retires an empty row straight through, and asks once for a row that holds cards', async () => {
    const { mocks } = await mountCatalog([card('c_1'), card('c_2')])
    const off = screen.getAllByRole('button', { name: '停用' })
    // Row order: 灵感 问题 共识 来源 ＋custom. 问题 holds nothing → no question.
    fireEvent.click(off[1]!)
    await waitFor(() => {
      expect(mocks.setCategories).toHaveBeenCalledWith('s1', expect.anything())
    })
    expect(screen.queryByText('停用这个分类？')).toBeNull()
    let request = mocks.setCategories.mock.calls[0]![1] as { categories: BoardCategory[]; archiveCardIds?: string[] }
    expect(request.categories.find(row => row.id === 'question')).toMatchObject({ enabled: false })
    expect(request.archiveCardIds).toBeUndefined()

    // 灵感 holds both cards: the write waits for the answer.
    fireEvent.click(screen.getAllByRole('button', { name: '停用' })[0]!)
    await screen.findByText('停用这个分类？')
    expect(screen.getByText(/这个分类下还有 2 张卡/)).toBeTruthy()
    expect(mocks.setCategories).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => { expect(screen.queryByText('停用这个分类？')).toBeNull() })
    expect(mocks.setCategories).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getAllByRole('button', { name: '停用' })[0]!)
    await screen.findByText('停用这个分类？')
    fireEvent.click(screen.getAllByRole('button', { name: '停用' }).at(-1)!)
    await waitFor(() => { expect(mocks.setCategories).toHaveBeenCalledTimes(2) })
    request = mocks.setCategories.mock.calls[1]![1] as { categories: BoardCategory[]; archiveCardIds?: string[] }
    expect(request.categories.find(row => row.id === 'fragment')).toMatchObject({ enabled: false })
    // One rewrite carries both halves, so the chip can never retire while its
    // cards are still on the board.
    expect(request.archiveCardIds).toEqual(['c_1', 'c_2'])
  })

  it('brings a retired row back without touching its archived cards', async () => {
    const { mocks } = await mountCatalog([card('c_1', { kind: 'document', status: 'archived' })])
    expect(screen.getByRole('button', { name: /已停用 1 个/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重新启用' }))
    await waitFor(() => {
      expect(mocks.setCategories).toHaveBeenCalledWith('s1', expect.anything())
    })
    const request = mocks.setCategories.mock.calls[0]![1] as { categories: BoardCategory[]; archiveCardIds?: string[] }
    expect(request.categories.find(row => row.id === 'document')).toMatchObject({ enabled: true })
    expect(request.archiveCardIds).toBeUndefined()
  })

  it('moves a selection to another category, hiding the one it already has', async () => {
    const { mocks, props } = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1'), card('c_2')], { categories: catalog() })],
    })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getAllByRole('checkbox', { name: '选择' })[0]!)
    await screen.findByText('已选 1 张')
    fireEvent.click(screen.getByRole('button', { name: '改分类' }))
    await screen.findByText('把这 1 张移到')
    // The selection's own category is not a destination.
    expect(screen.queryByRole('button', { name: '灵感' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '来源' }))
    await waitFor(() => {
      expect(mocks.patchCard).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, cardId: 'c_1', kind: 'reference' })
    })
  })

  it('starts the new card in the filtered category, by this board\'s own name for it', async () => {
    const { mocks, props } = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1'), card('c_2', { kind: custom.id })], { categories: catalog() })],
    })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getByRole('button', { name: /^反方观点/ }))
    fireEvent.click(await screen.findByRole('button', { name: '新增反方观点卡片' }))
    expect(mocks.openCardDraft).toHaveBeenCalledWith(CANVAS_ID, custom.id, '反方观点')
  })
})

describe('CanvasTab — the detail openings (stage ⑧)', () => {
  it('hands a card body click to the host as that card\'s address, and keeps showing the board', async () => {
    const { mocks, props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getByText('卡片 c_1'))
    // The heading travels with it: the host freezes a chip's title at open time.
    expect(mocks.openCardDetail).toHaveBeenCalledWith(CANVAS_ID, 'c_1', '卡片 c_1')
    // Opening a tab is not a drill — the board is still here, ＋ tile included.
    await screen.findByRole('button', { name: NEW_TILE })
    expect(screen.queryByRole('button', { name: /返回画布/ })).toBeNull()
  })

  it('is a reader on the board: no editor and no pencil sit on the card', async () => {
    const { props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    // The card's text is never a textarea on the board, and the body click is
    // the one way in (the pencil went with the slimmer card, 2026-09-27).
    expect(screen.queryByDisplayValue('卡片 c_1')).toBeNull()
    expect(screen.queryByRole('button', { name: '打开' })).toBeNull()
  })

  it('quotes an agent comment into the input for 追问', async () => {
    const commented = card('c_1', {
      comments: [{ id: 'm_1', author: 'agent', text: '这里隐含一个假设', createdAt: NOW }],
    })
    const { mocks, props } = makeHarness({ boards: [board(CANVAS_ID, [commented])] })
    render(<CanvasTab {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: '1 条评论' }))
    fireEvent.click(await screen.findByRole('button', { name: /追问/ }))
    const block = mocks.quoteToConversation.mock.calls[0]?.[1] as string
    expect(block.startsWith('> 这里隐含一个假设')).toBe(true)
    expect(block).toContain('c_1')
  })

  it('shows no comment badge on a card nobody has commented on', async () => {
    const { props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    expect(screen.queryByRole('button', { name: /写评论/ })).toBeNull()
  })

  it('titles the address with the card\'s display title, never its markup', async () => {
    const { mocks, props } = makeHarness({
      boards: [board(CANVAS_ID, [card('c_page', {
        kind: 'document',
        text: '<!doctype html><html><head><title>大模型心理学</title></head><body><p>正文</p></body></html>',
      })])],
    })
    render(<CanvasTab {...props} />)
    fireEvent.click(await screen.findByText('大模型心理学'))
    expect(mocks.openCardDetail).toHaveBeenCalledWith(CANVAS_ID, 'c_page', '大模型心理学')
  })

  it('opens an archived card from the well too, instead of swallowing the click', async () => {
    const { mocks, props } = makeHarness({
      boards: [board(CANVAS_ID, [card('c_old', { status: 'archived', text: '归档掉的旧卡' })])],
    })
    render(<CanvasTab {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: /已归档的卡/ }))
    fireEvent.click(screen.getByText('归档掉的旧卡'))
    expect(mocks.openCardDetail).toHaveBeenCalledWith(CANVAS_ID, 'c_old', '归档掉的旧卡')
  })

  it('opens the ＋ tile straight onto the draft page, never a draft on the board', async () => {
    const { mocks, props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getByRole('button', { name: NEW_TILE }))
    expect(mocks.openCardDraft).toHaveBeenCalledWith(CANVAS_ID, 'fragment', '灵感')
    expect(screen.queryByPlaceholderText(/写点什么/)).toBeNull()
  })

  it('makes the ＋ tile the first cell of an empty board, carrying the invitation', async () => {
    const { mocks, props } = makeHarness({ boards: [board(CANVAS_ID, [])] })
    render(<CanvasTab {...props} />)
    const tile = await screen.findByText('记下一条灵感、问题、共识或来源')
    expect(tile.closest('button')?.textContent).toContain('新增灵感卡片')
    fireEvent.click(tile)
    expect(mocks.openCardDraft).toHaveBeenCalledWith(CANVAS_ID, 'fragment', '灵感')
  })
})

describe('CanvasTab — freshness from the main session', () => {
  it('re-reads the open board every few seconds while the page is in view', async () => {
    // Fake timers from the start (the interval is armed on mount), still
    // advancing on their own so the async reads settle.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { mocks, props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
      render(<CanvasTab {...props} />)
      await screen.findByText('卡片 c_1')
      mocks.refreshBoards.mockClear()
      vi.advanceTimersByTime(4000)
      expect(mocks.refreshBoards).toHaveBeenCalledTimes(1)
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
      vi.advanceTimersByTime(4000)
      expect(mocks.refreshBoards).toHaveBeenCalledTimes(1)
      visibility.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('CanvasTab — wide mode and read-only', () => {
  it('fires the wide-mode suggestion exactly once per mount', async () => {
    const { mocks, props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    await waitFor(() => {
      expect(mocks.suggestWideMode).toHaveBeenCalledTimes(1)
    })
    expect(mocks.suggestWideMode).toHaveBeenCalledWith('s1')
  })

  it('is read-only without a session: every mutating control stays away', async () => {
    const { props } = makeHarness({ sessionId: 'none', boards: [board(CANVAS_ID, [card('c_1')])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    expect(screen.queryByRole('button', { name: NEW_TILE })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '打开或新建画布' }))
    // Read-only: the 新画布 row is not even offered.
    expect(screen.queryByRole('button', { name: /新画布/ })).toBeNull()
  })
})

describe('CanvasTab — round-4 dismissal, undo and the archived canvas', () => {
  it('closes the canvas switcher like every floating surface', async () => {
    const { props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    const switcher = screen.getByRole('button', { name: '打开或新建画布' })
    fireEvent.click(switcher)
    expect(switcher.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(switcher.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens 管理分类 as a page in the row, and retiring the filtered category falls back to 全部', async () => {
    const { mocks, props, store } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    // Filter the board to 问题 (empty), then retire it from the category page.
    fireEvent.click(screen.getByRole('button', { name: /^问题/ }))
    fireEvent.click(screen.getByRole('button', { name: /管理分类/ }))
    await screen.findByText('只作用于这块画板')
    expect(screen.queryByText('卡片 c_1')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: '停用' })[1]!)
    await waitFor(() => { expect(mocks.setCategories).toHaveBeenCalledTimes(1) })
    // The crumb asks the host to go back; the board it lands on is on 全部 again.
    fireEvent.click(screen.getByRole('button', { name: '回到卡板' }))
    expect(mocks.backToBoard).toHaveBeenCalledWith(CANVAS_ID)
    act(() => { store.backToBoard(CANVAS_ID) })
    await screen.findByText('卡片 c_1')
  })

  it('offers 撤销 after archiving a kept card, and the undo restores it', async () => {
    const { mocks, props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '归档' }))
    fireEvent.click(await screen.findByText('撤销'))
    await waitFor(() => {
      expect(mocks.patchCard).toHaveBeenLastCalledWith('s1', { canvasId: CANVAS_ID, cardId: 'c_1', status: 'kept' })
    })
  })

  it('shows an archived canvas read-only under a banner that restores it', async () => {
    const { mocks, props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')], { archivedAt: NOW })] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    const banner = screen.getByRole('status')
    expect(banner.textContent).toContain('已归档')
    expect(screen.queryByRole('button', { name: NEW_TILE })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: '选择' })).toBeNull()
    fireEvent.click(within(banner).getByRole('button', { name: '恢复' }))
    await waitFor(() => {
      expect(mocks.archiveCanvas).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, archived: false })
    })
  })
})

describe('CanvasTab — true delete (round 5)', () => {
  it('deletes a card from its ⋯ menu only after the confirmation', async () => {
    const { mocks, props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1'), card('c_2')])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getAllByRole('button', { name: '更多' })[0]!)
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('删除这张卡片')
    expect(mocks.deleteCard).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    await waitFor(() => {
      expect(mocks.deleteCard).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, cardId: 'c_1' })
    })
    await waitFor(() => { expect(screen.queryByText('卡片 c_1')).toBeNull() })
    expect(screen.getByText('卡片 c_2')).toBeTruthy()
  })

  it('cancelling the confirmation deletes nothing', async () => {
    const { mocks, props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getAllByRole('button', { name: '更多' })[0]!)
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '取消' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(mocks.deleteCard).not.toHaveBeenCalled()
  })

  it('deletes the open canvas from the canvas ⋯ menu', async () => {
    const { mocks, props, boards } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getByRole('button', { name: '画布操作' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除画布…' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '删除' }))
    await waitFor(() => {
      expect(mocks.deleteCanvas).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID })
    })
    expect(boards.has(CANVAS_ID)).toBe(false)
    await waitFor(() => { expect(screen.queryByText('卡片 c_1')).toBeNull() })
  })

  it('offers 永久删除 on the archived canvas banner', async () => {
    const { mocks, props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')], { archivedAt: NOW })] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    // Read-only: no per-card ⋯, no canvas ⋯ — the banner is the only door.
    expect(screen.queryByRole('button', { name: '更多' })).toBeNull()
    expect(screen.queryByRole('button', { name: '画布操作' })).toBeNull()
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: '永久删除…' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '删除' }))
    await waitFor(() => {
      expect(mocks.deleteCanvas).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID })
    })
  })
})

describe('CanvasTab — genre seats (创作体裁)', () => {
  /** A renderSlot that names what it was asked for, or falls back like the host's keyed miss. */
  function namingSlot() {
    return vi.fn((key: string, _owner: unknown, options?: { entryKey?: string; fallback?: unknown }) =>
      key === 'canvas.page' && options?.entryKey !== 'novel:ledger'
        ? options?.fallback ?? null
        : <div>{`seat ${key} ${options?.entryKey ?? ''}`}</div>)
  }

  const NOVEL_SUMMARY = {
    id: 'novel', label: '长篇小说', version: 'novel@1', description: '', roles: [], agentRow: '@khorsheed/dsh-canvas-novel/agent',
  }

  it('picks a genre in the create form when one is installed', async () => {
    const { mocks, props } = makeHarness()
    render(<CanvasTab {...props} listGenres={vi.fn(async () => ({ ok: true, value: [NOVEL_SUMMARY] })) as never} />)
    fireEvent.click(await screen.findByRole('button', { name: '打开或新建画布' }))
    fireEvent.click(screen.getByRole('button', { name: /新画布/ }))
    fireEvent.change(screen.getByPlaceholderText('这块画布思考什么主题？'), { target: { value: '灯塔' } })
    expect(await screen.findByRole('radio', { name: '日常创作' })).toHaveProperty('checked', true)
    fireEvent.click(screen.getByRole('radio', { name: NOVEL_SUMMARY.label }))
    fireEvent.click(screen.getByRole('button', { name: '建立' }))
    await waitFor(() => {
      expect(mocks.createCanvas).toHaveBeenCalledWith('s1', { title: '灯塔', attachedWorkspaces: [], genreId: NOVEL_SUMMARY.id })
    })
  })

  it('dispatches no seat on a canvas without a genre, and the ⋯ menu stays the one it was', async () => {
    const { props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
    const renderSlot = namingSlot()
    render(<CanvasTab {...props} renderSlot={renderSlot as unknown as CanvasTabProps['renderSlot']} />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getByRole('button', { name: '画布操作' }))
    await screen.findByRole('menuitem', { name: '删除画布…' })
    expect(screen.queryByText('创作体裁')).toBeNull()
    expect(renderSlot).not.toHaveBeenCalled()
  })

  it('offers 创作体裁 once a genre is installed, and picking one selects it', async () => {
    const { props, mocks } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
    const selectGenre = vi.fn(async () => ({ ok: true, value: { ok: true, board: board(), version: '2' } }))
    render(<CanvasTab {...props} listGenres={vi.fn(async () => ({ ok: true, value: [NOVEL_SUMMARY] })) as never} selectGenre={selectGenre as never} />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getByRole('button', { name: '画布操作' }))
    // The choices sit inline under the heading — no submenu to open.
    await screen.findByText('创作体裁')
    fireEvent.click(await screen.findByRole('menuitem', { name: '长篇小说' }))
    await waitFor(() => {
      expect(selectGenre).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, genreId: 'novel' })
    })
    expect(mocks.readBoard).toHaveBeenCalled()
  })

  it('attaches a registered workspace from the ⋯ menu, ticking the attached ones', async () => {
    const { props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])], workspaces: [{ workspaceId: 'w1', title: 'Writing', path: '/home/user/Writing' }] })
    const setWorkspace = vi.fn(async () => ({ ok: true, value: { ok: true, board: board(), version: '2' } }))
    render(<CanvasTab {...props} setWorkspace={setWorkspace as never} />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getByRole('button', { name: '画布操作' }))
    await screen.findByText(zh['workspace.menu'])
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Writing' }))
    await waitFor(() => {
      expect(setWorkspace).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, workspace: '/home/user/Writing', attached: true })
    })
  })

  it('hands a role card its face and the board its strip on a canvas with a genre', async () => {
    const categories = [...defaultCategories(), { id: 'cat_char', label: '人物', enabled: true, role: 'character' } as BoardCategory]
    const novel = board(CANVAS_ID, [card('c_1'), card('c_2', { kind: 'cat_char', text: '林澈' })], {
      categories, genre: { id: 'novel', version: 'novel@1', selectedAt: NOW },
    })
    const { props } = makeHarness({ boards: [novel] })
    render(<CanvasTab {...props} renderSlot={namingSlot() as unknown as CanvasTabProps['renderSlot']} />)
    await screen.findByText('卡片 c_1')
    expect(screen.getByText('seat canvas.card.face novel:character')).toBeTruthy()
    expect(screen.getByText('seat canvas.board.strip')).toBeTruthy()
    // The role card wears the genre face (its plain summary is gone); 卡片 c_1, no role, kept its own.
    expect(screen.queryByText('林澈')).toBeNull()
  })

  it('hands the 成稿 face to a genre that owns it, and keeps the plain list for one that does not', async () => {
    const novel = board(CANVAS_ID, [card('c_1')], { genre: { id: 'novel', version: 'novel@1', selectedAt: NOW } })
    const owning = makeHarness({ boards: [novel] })
    render(<CanvasTab
      {...owning.props}
      renderSlot={namingSlot() as unknown as CanvasTabProps['renderSlot']}
      listGenres={vi.fn(async () => ({ ok: true, value: [{ ...NOVEL_SUMMARY, ownsManuscripts: true }] })) as never}
    />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getByRole('tab', { name: zh['view.manuscripts'] }))
    await screen.findByText('seat canvas.board.manuscripts novel')
    expect(screen.queryByText(zh['ms.empty'])).toBeNull()
    cleanup()

    const plain = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')], { genre: { id: 'novel', version: 'novel@1', selectedAt: NOW } })] })
    render(<CanvasTab
      {...plain.props}
      renderSlot={namingSlot() as unknown as CanvasTabProps['renderSlot']}
      listGenres={vi.fn(async () => ({ ok: true, value: [NOVEL_SUMMARY] })) as never}
    />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getByRole('tab', { name: zh['view.manuscripts'] }))
    await screen.findByText(zh['ms.empty'])
    expect(screen.queryByText('seat canvas.board.manuscripts novel')).toBeNull()
  })

  it('routes a page row to the genre page, and stands in a notice when nothing serves it', async () => {
    const novel = board(CANVAS_ID, [card('c_1')], { genre: { id: 'novel', version: 'novel@1', selectedAt: NOW } })
    const { props, store } = makeHarness({ boards: [novel] })
    render(<CanvasTab {...props} renderSlot={namingSlot() as unknown as CanvasTabProps['renderSlot']} />)
    await screen.findByText('卡片 c_1')
    act(() => { store.openPageTab(CANVAS_ID, 'novel:ledger', '伏笔账本') })
    await screen.findByText('seat canvas.page novel:ledger')
    act(() => { store.openPageTab(CANVAS_ID, 'thesis:outline', '大纲') })
    await screen.findByText(zh['genre.pageMissing'])
  })
})

describe('CanvasTab — a genre with faces (章节 · 设定 · 故事)', () => {
  const FACES_SUMMARY = {
    id: 'novel', label: '长篇小说', version: 'novel@1', description: '', roles: [], agentRow: '@khorsheed/dsh-canvas-novel/agent',
    ownsManuscripts: true, faces: { view: 'story' },
  }

  /** Reports through an owner callback once mounted, the way a genre entry would. */
  function Report({ run }: { readonly run: () => void }) {
    useEffect(() => { run() }, [run])
    return null
  }

  /** A genre that labels its faces, reports an empty book, and scopes c_1 as in use. */
  function facesSlot(written: boolean) {
    return vi.fn((key: string, owner: Record<string, unknown>, options?: { entryKey?: string; fallback?: unknown }) => {
      if (key === 'canvas.board.tab') return `tab:${String(owner.face)}`
      if (key === 'canvas.board.tab.badge') return owner.face === 'manuscripts' ? <b data-testid="face-badge">3</b> : null
      if (key === 'canvas.board.manuscripts') {
        return written
          ? <div>seat manuscripts</div>
          : <Report run={owner.onEmpty as () => void} />
      }
      if (key === 'canvas.board.scopes') {
        const onScopes = owner.onScopes as (rows: unknown[]) => void
        return <Report run={() => { onScopes([{ id: 'story', label: '已进入故事', cardIds: ['c_1'], archiveFirst: true }]) }} />
      }
      if (key === 'canvas.card.deleteNote') return <div>{`note for ${(owner.card as { id: string }).id}`}</div>
      if (key.startsWith('canvas.board.') || key === 'canvas.card.section') return <div>{`seat ${key} ${options?.entryKey ?? ''}`}</div>
      return options?.fallback ?? null
    })
  }

  function renderFaces(written: boolean) {
    const novel = board(CANVAS_ID, [card('c_1'), card('c_2')], { genre: { id: 'novel', version: 'novel@1', selectedAt: NOW } })
    const harness = makeHarness({ boards: [novel] })
    render(<CanvasTab
      {...harness.props}
      renderSlot={facesSlot(written) as unknown as CanvasTabProps['renderSlot']}
      listGenres={vi.fn(async () => ({ ok: true, value: [FACES_SUMMARY] })) as never}
    />)
    return harness
  }

  it('opens on 成稿 once something is written, and the genre labels all three faces', async () => {
    renderFaces(true)
    await screen.findByText('seat manuscripts')
    const chapters = screen.getByRole('tab', { name: /^tab:manuscripts\s*3$/ })
    expect(chapters.getAttribute('aria-selected')).toBe('true')
    // The genre's count is the tab's badge: beside the label, not inside it (under the underline).
    expect(screen.getByText('tab:manuscripts').contains(screen.getByTestId('face-badge'))).toBe(false)
    expect(screen.getByRole('tab', { name: 'tab:board' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'tab:story' }))
    await screen.findByText('seat canvas.board.view novel:story')
    // 连线 is no longer a face of its own here.
    expect(screen.queryByRole('tab', { name: '连线' })).toBeNull()
  })

  it('falls back to 卡板 while nothing is written, with 连线 as its second layout drawn by the genre', async () => {
    renderFaces(false)
    await screen.findByText('卡片 c_1')
    expect(screen.getByRole('tab', { name: 'tab:board' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '连线' }))
    await screen.findByText('seat canvas.board.graph novel')
    // The 卡板 tab stays the selected face under either layout.
    expect(screen.getByRole('tab', { name: 'tab:board' }).getAttribute('aria-selected')).toBe('true')
  })

  it('narrows the board to a scope in the face\'s tools row, apart from the category chips', async () => {
    renderFaces(false)
    const scopes = await screen.findByRole('group', { name: '故事筛选' })
    fireEvent.click(within(scopes).getByRole('button', { name: '已进入故事1' }))
    await waitFor(() => { expect(screen.queryByText('卡片 c_2')).toBeNull() })
    expect(screen.getByText('卡片 c_1')).toBeTruthy()
    // The scope is not one of the category chips.
    expect(within(screen.getByRole('group', { name: '筛选卡片' })).queryByRole('button', { name: /已进入故事/ })).toBeNull()
    fireEvent.click(within(scopes).getByRole('button', { name: /^全部/ }))
    await screen.findByText('卡片 c_2')
  })

  it('offers 归档 when deleting a card in use, with the genre\'s note, and none for an unused one', async () => {
    const { mocks } = renderFaces(false)
    await screen.findByRole('button', { name: '已进入故事1' })
    fireEvent.click(screen.getAllByRole('button', { name: '更多' })[0]!)
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除' }))
    let dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('note for c_1')
    fireEvent.click(within(dialog).getByRole('button', { name: '归档' }))
    await waitFor(() => {
      expect(mocks.patchCard).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, cardId: 'c_1', status: 'archived' })
    })
    expect(mocks.deleteCard).not.toHaveBeenCalled()

    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    fireEvent.click(screen.getAllByRole('button', { name: '更多' })[0]!)
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除' }))
    dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('note for c_2')
    expect(within(dialog).queryByRole('button', { name: '归档' })).toBeNull()
  })
})

describe('CanvasTab — a genre with a lead face (规划 · 章节 · 设定 · 故事)', () => {
  const LEAD_SUMMARY = {
    id: 'novel', label: '长篇小说', version: 'novel@1', description: '', roles: [], agentRow: '@khorsheed/dsh-canvas-novel/agent',
    ownsManuscripts: true, faces: { view: 'story', lead: 'plan' },
  }

  function Empty({ onEmpty }: { readonly onEmpty: () => void }) {
    useEffect(() => { onEmpty() }, [onEmpty])
    return null
  }

  it('puts the lead face first and opens on it while nothing is written', async () => {
    const novel = board(CANVAS_ID, [card('c_1')], { genre: { id: 'novel', version: 'novel@1', selectedAt: NOW } })
    const harness = makeHarness({ boards: [novel] })
    const slot = vi.fn((key: string, owner: Record<string, unknown>, options?: { entryKey?: string; fallback?: unknown }) => {
      if (key === 'canvas.board.tab') return `tab:${String(owner.face)}`
      if (key === 'canvas.board.manuscripts') return <Empty onEmpty={owner.onEmpty as () => void} />
      if (key === 'canvas.board.view') return <div>{`seat view ${options?.entryKey ?? ''}`}</div>
      return options?.fallback ?? null
    })
    render(<CanvasTab
      {...harness.props}
      renderSlot={slot as unknown as CanvasTabProps['renderSlot']}
      listGenres={vi.fn(async () => ({ ok: true, value: [LEAD_SUMMARY] })) as never}
    />)
    await screen.findByText('seat view novel:plan')
    const tabs = screen.getAllByRole('tab').map(tab => tab.textContent).filter(text => text?.startsWith('tab:'))
    expect(tabs).toEqual(['tab:plan', 'tab:manuscripts', 'tab:board', 'tab:story'])
    expect(screen.getByRole('tab', { name: 'tab:plan' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'tab:story' }))
    await screen.findByText('seat view novel:story')
  })
})

describe('CanvasSelectionStore — the genre page row', () => {
  it('brings a page place back after a reload, parameter and all', () => {
    sessionStorage.clear()
    new CanvasSelectionStore().openPageTab(CANVAS_ID, 'novel:chapter', '第三章', 'ms_3')
    const restored = new CanvasSelectionStore().source.getSnapshot()
    expect(restored.tabs[0]?.at).toEqual({ kind: 'page', page: 'novel:chapter', param: 'ms_3', heading: '第三章' })
  })
})
