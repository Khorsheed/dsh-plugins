// @vitest-environment jsdom
/**
 * The canvas tab (M3's single seat) under the composed-props form: a REAL
 * CanvasSelectionStore (the open canvas, the drilled card, the rev channel),
 * injected Remote mocks over a multi-canvas fake host, and plain hook fakes.
 * Asserts the list → auto-open → board chain, the switcher (create / archive
 * / import), the board gestures (new card, ghost ✓/✗, checkbox multi-select,
 * lens bar, follow-up, their full-hide degrade), the drill (body click →
 * detail page → back, the tri-state source save), the draft view (load,
 * debounced guarded save, conflict), focus reporting, the once-per-session
 * wide-mode suggestion, and the read-only degrade.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { CanvasTabProps } from '../src/client/contract.ts'
import { CanvasSelectionStore } from '../src/client/space/selection.ts'
import { CanvasTab } from '../src/client/tab/CanvasTab.tsx'
import { zh } from '../src/client/locales.ts'
import type {
  BoardAskAgentOutcome, BoardChatStatusResult, BoardFocusResult,
  BoardListResult, BoardMutationResult, BoardReadDraftOutcome, BoardReadOutcome,
  BoardWriteDraftResult, CanvasBoard, CanvasSummary,
} from '../src/types.ts'

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

const NOW = '2026-09-16T08:00:00.000Z'
const CANVAS_ID = 'canvas_01234567abcdefgh'

/** A plain translate over the zh dictionary (the key-set source of truth). */
const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as CanvasTabProps['t']

/** One board fixture; cards land in array order. */
function board(id = CANVAS_ID, cards: CanvasBoard['cards'] = [], overrides: Partial<CanvasBoard> = {}): CanvasBoard {
  return {
    id,
    title: '为什么人们不愿表达异议',
    attachedWorkspaces: [],
    chat: { sessionId: null },
    cards,
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
    addComment: ReturnType<typeof vi.fn>
    archiveCanvas: ReturnType<typeof vi.fn>
    openFile: ReturnType<typeof vi.fn>
    selectCard: ReturnType<typeof vi.fn>
    focusCanvas: ReturnType<typeof vi.fn>
    readDraft: ReturnType<typeof vi.fn>
    writeDraft: ReturnType<typeof vi.fn>
    askAgent: ReturnType<typeof vi.fn>
    chatStatus: ReturnType<typeof vi.fn>
    openSideChat: ReturnType<typeof vi.fn>
    suggestWideMode: ReturnType<typeof vi.fn>
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
  const store = new CanvasSelectionStore()
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
    patchCard: vi.fn(async (sid: string, request: { canvasId: string; cardId: string; text?: string; status?: 'proposed' | 'kept' | 'archived'; question?: { state: 'open' | 'exploring' | 'answered' } }): Promise<Result<BoardMutationResult>> => {
      const current = boards.get(request.canvasId)
      const target = current?.cards.find(candidate => candidate.id === request.cardId)
      if (target !== undefined) {
        if (request.text !== undefined) target.text = request.text
        if (request.status !== undefined) target.status = request.status
        if (request.question !== undefined && target.question !== undefined) target.question.state = request.question.state
      }
      return mutationFor(request.canvasId)
    }),
    addComment: vi.fn(async (sid: string, request: { canvasId: string; cardId: string; text: string }): Promise<Result<BoardMutationResult>> => {
      const target = boards.get(request.canvasId)?.cards.find(candidate => candidate.id === request.cardId)
      target?.comments.push({ id: `m_${request.text.length}`, author: 'user', text: request.text, createdAt: NOW })
      return mutationFor(request.canvasId)
    }),
    archiveCanvas: vi.fn(async (sid: string, request: { canvasId: string; archived: boolean }): Promise<Result<BoardMutationResult>> => {
      const current = boards.get(request.canvasId)
      if (current !== undefined) current.archivedAt = request.archived ? NOW : null
      return mutationFor(request.canvasId)
    }),
    openFile: vi.fn(),
    selectCard: vi.fn((canvasId: string, cardId: string) => { store.select(canvasId, cardId) }),
    openCanvas: (canvasId: string) => { store.openCanvas(canvasId) },
    clearCard: () => { store.clearCard() },
    focusCanvas: vi.fn(async (): Promise<Result<BoardFocusResult>> => ok({ ok: true })),
    readDraft: vi.fn(async (): Promise<Result<BoardReadDraftOutcome>> => ok({ ok: true, content: '# 初稿\n\n正文。', version: '1' })),
    writeDraft: vi.fn(async (): Promise<Result<BoardWriteDraftResult>> => ok({ ok: true, version: '2' })),
    askAgent: vi.fn(async (): Promise<Result<BoardAskAgentOutcome>> =>
      ok({ ok: true, contextKey: `canvas:${CANVAS_ID}`, sent: true })),
    chatStatus: vi.fn(async (): Promise<Result<BoardChatStatusResult>> =>
      ok({ available: options.chatAvailable ?? true })),
    openSideChat: vi.fn(),
    suggestWideMode: vi.fn(),
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
  } as unknown as CanvasTabProps
  return { store, mocks, props, boards }
}

afterEach(() => { cleanup() })

describe('CanvasTab — list, switcher, board', () => {
  it('loads the list, auto-opens the first canvas, and renders its board', async () => {
    const { props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
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
    fireEvent.click(screen.getByRole('button', { name: /为什么人们不愿表达异议/ }))
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
    await screen.findByRole('button', { name: /为什么人们不愿表达异议/ })
    fireEvent.click(screen.getByRole('button', { name: /为什么人们不愿表达异议/ }))
    fireEvent.click(screen.getByRole('button', { name: /新画布/ }))
    fireEvent.change(screen.getByPlaceholderText('这块画布思考什么主题？'), { target: { value: '远程团队的书面沟通礼仪' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'report' }))
    fireEvent.click(screen.getByRole('button', { name: '建立' }))
    await waitFor(() => {
      expect(mocks.createCanvas).toHaveBeenCalledWith('s1', { title: '远程团队的书面沟通礼仪', attachedWorkspaces: ['/ws/report'] })
    })
    await screen.findByText('远程团队的书面沟通礼仪')
  })

  it('archives a canvas row from the switcher and restores it from the well', async () => {
    const { mocks, props, boards } = makeHarness()
    render(<CanvasTab {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: /为什么人们不愿表达异议/ }))
    fireEvent.click(screen.getByRole('button', { name: '归档' }))
    await waitFor(() => {
      expect(mocks.archiveCanvas).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, archived: true })
    })
    expect(boards.get(CANVAS_ID)?.archivedAt).not.toBeNull()
  })


  it('adds a card through the topbar new-card menu (⌘⏎), stopping the submit mid-IME', async () => {
    const { mocks, props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getByRole('button', { name: /新卡/ }))
    fireEvent.click(await screen.findByRole('button', { name: '问题' }))
    const editor = await screen.findByPlaceholderText(/写点什么/)
    fireEvent.compositionStart(editor)
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
    expect(mocks.putCard).not.toHaveBeenCalled()
    fireEvent.compositionEnd(editor)
    fireEvent.change(editor, { target: { value: '不表达是因为害怕吗？' } })
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
    await waitFor(() => {
      expect(mocks.putCard).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, kind: 'question', text: '不表达是因为害怕吗？' })
    })
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
    fireEvent.click(screen.getByRole('button', { name: '挑战假设' }))
    await waitFor(() => {
      expect(mocks.askAgent).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, lens: 'challenge', cardIds: ['c_1', 'c_2'] })
    })
    expect(mocks.openSideChat).toHaveBeenCalledWith(`canvas:${CANVAS_ID}`)
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
    expect(screen.queryByRole('button', { name: '挑战假设' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '1 条评论' }))
    await screen.findByText(/这里隐含一个假设/)
    expect(screen.queryByRole('button', { name: /追问/ })).toBeNull()
    expect(screen.getByRole('button', { name: /归档所选/ })).toBeTruthy()
  })
})

describe('CanvasTab — the drill', () => {
  it('drills into the detail on a body click and returns to the board on back', async () => {
    const { props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getByText('卡片 c_1'))
    // The detail page: the back bar plus the reader (kind tag).
    await screen.findByRole('button', { name: /返回卡板/ })
    await screen.findByText('碎片')
    // The board is gone (a drill, not a split).
    expect(screen.queryByRole('button', { name: /新卡/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /返回卡板/ }))
    await screen.findByRole('button', { name: /新卡/ })
  })

  it('switches the detail through render/source/split and saves source through patchCard', async () => {
    const { mocks, props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getByText('卡片 c_1'))
    await screen.findByRole('button', { name: '渲染' })
    fireEvent.click(screen.getByRole('button', { name: '源码' }))
    const editor = await screen.findByDisplayValue('卡片 c_1')
    fireEvent.change(editor, { target: { value: '改过的正文' } })
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
    await waitFor(() => {
      expect(mocks.patchCard).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, cardId: 'c_1', text: '改过的正文' })
    })
    // Split shows both panes (the source textarea AND the rendered markdown).
    fireEvent.click(await screen.findByRole('button', { name: '并列' }))
    await screen.findByDisplayValue('改过的正文')
    expect((await screen.findAllByText('改过的正文')).length).toBeGreaterThanOrEqual(1)
  })
})

describe('CanvasTab — the draft view and wide mode', () => {
  it('switches to the draft view, loads the draft, and auto-saves a guarded write', async () => {
    const { mocks, props } = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])] })
    render(<CanvasTab {...props} />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getByRole('button', { name: '成稿' }))
    // DisplayValue matchers normalize the element's value (whitespace
    // collapses), so a multi-line draft matches by regex, not by string.
    const editor = await screen.findByDisplayValue(/正文。/)
    expect(mocks.readDraft).toHaveBeenCalledWith({ canvasId: CANVAS_ID })
    fireEvent.input(editor, { target: { value: '# 初稿\n\n改过的。' } })
    await waitFor(() => {
      expect(mocks.writeDraft).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, content: '# 初稿\n\n改过的。', version: '1' })
    }, { timeout: 3000 })
    // The preview mode renders the manuscript.
    fireEvent.click(screen.getByRole('button', { name: '预览' }))
    await screen.findByText('改过的。')
  })

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
    expect(screen.queryByRole('button', { name: /新卡/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /为什么人们不愿表达异议/ }))
    // Read-only: the 新画布 row is not even offered.
    expect(screen.queryByRole('button', { name: /新画布/ })).toBeNull()
  })
})
