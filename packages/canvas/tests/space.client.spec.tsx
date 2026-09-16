// @vitest-environment jsdom
/**
 * The canvas space page under the composed-props form: injected Remote mocks
 * and plain selector-hook fakes. Asserts the mount → list → board chain, the
 * create-canvas and new-card flows, the ghost proposal's accept/reject wiring
 * to patchCard status transitions, selection with batch archive, the question
 * card's mark-answered, the IME hard stop on a card editor, read-only mode
 * without a session, and the v1 import probe → import chain.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { CanvasSpacePageProps } from '../src/client/contract.ts'
import { CanvasSpacePage } from '../src/client/space/CanvasSpacePage.tsx'
import { zh } from '../src/client/locales.ts'
import type {
  BoardListResult, BoardMutationResult, BoardReadOutcome, CanvasBoard, CanvasListResult,
  BoardImportResult,
} from '../src/types.ts'

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

const NOW = '2026-09-16T08:00:00.000Z'
const CANVAS_ID = 'canvas_01234567abcdefgh'

/** A plain translate over the zh dictionary (the key-set source of truth). */
const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as CanvasSpacePageProps['t']

/** One board fixture; cards land in array order. */
function board(cards: CanvasBoard['cards'] = [], overrides: Partial<CanvasBoard> = {}): CanvasBoard {
  return {
    id: CANVAS_ID,
    title: '为什么人们不愿表达异议',
    attachedWorkspaces: ['/ws/report'],
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

/** The row the list surface reports for the fixture board. */
function rowOf(value: CanvasBoard): BoardListResult['items'][number] {
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
  readonly mocks: {
    listCanvases: ReturnType<typeof vi.fn>
    createCanvas: ReturnType<typeof vi.fn>
    readBoard: ReturnType<typeof vi.fn>
    putCard: ReturnType<typeof vi.fn>
    patchCard: ReturnType<typeof vi.fn>
    addComment: ReturnType<typeof vi.fn>
    archiveCanvas: ReturnType<typeof vi.fn>
    importV1: ReturnType<typeof vi.fn>
    probeV1Pad: ReturnType<typeof vi.fn>
  }
  readonly props: CanvasSpacePageProps
  /** Current board the fake host holds (mutations answer it back). */
  current: { board: CanvasBoard }
}

/** Mount the page over a fake host: one board, every verb a mock. */
function makeHarness(options: {
  /** Explicit session id; 'none' renders the page session-less (read-only). */
  sessionId?: string | 'none'
  board?: CanvasBoard
  workspaces?: readonly { workspaceId: string; path: string; title: string }[]
} = {}): Harness {
  const current = { board: options.board ?? board() }
  const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
  const mutation = (): Result<BoardMutationResult> => ok({ ok: true, board: current.board, version: '2' })
  // create/import mint a NEW canvas, so their receipts carry a fresh id (the
  // real service never echoes the open board back).
  const minted = { ...current.board, id: 'canvas_new00000abcdefgh' }
  const mocks = {
    listCanvases: vi.fn(async (): Promise<Result<BoardListResult>> => ok({ items: [rowOf(current.board)] })),
    createCanvas: vi.fn(async (): Promise<Result<BoardMutationResult>> => ok({ ok: true, board: minted, version: '2' })),
    readBoard: vi.fn(async (): Promise<Result<BoardReadOutcome>> => ok({ ok: true, board: current.board, version: '1' })),
    putCard: vi.fn(async (): Promise<Result<BoardMutationResult>> => mutation()),
    patchCard: vi.fn(async (): Promise<Result<BoardMutationResult>> => mutation()),
    addComment: vi.fn(async (): Promise<Result<BoardMutationResult>> => mutation()),
    archiveCanvas: vi.fn(async (): Promise<Result<BoardMutationResult>> => mutation()),
    importV1: vi.fn(async (): Promise<Result<BoardImportResult>> => ok({ ok: true, board: minted, version: '2', imported: 2 })),
    probeV1Pad: vi.fn(async (): Promise<Result<CanvasListResult>> => ok({ items: [{ name: '卡片/雨伞的意象.md' }, { name: '文章/第一章.md' }] as never, archived: [] })),
  }
  const sessionId = options.sessionId === 'none' ? undefined : (options.sessionId ?? 's1')
  const props = {
    t,
    ...mocks,
    useSessions: ((selector: (snapshot: { current: string | undefined }) => unknown) =>
      selector({ current: sessionId })) as CanvasSpacePageProps['useSessions'],
    useWorkspaces: ((selector: (snapshot: { items: readonly unknown[] }) => unknown) =>
      selector({ items: options.workspaces ?? [] })) as CanvasSpacePageProps['useWorkspaces'],
  } as CanvasSpacePageProps
  return { mocks, props, current }
}

afterEach(() => { cleanup() })

describe('CanvasSpacePage', () => {
  it('loads the list and opens the first canvas\'s board', async () => {
    const { mocks, props } = makeHarness({ board: board([card('c_1')]) })
    render(<CanvasSpacePage {...props} />)
    await screen.findByText('为什么人们不愿表达异议')
    await screen.findByText('卡片 c_1')
    expect(mocks.listCanvases).toHaveBeenCalled()
    expect(mocks.readBoard).toHaveBeenCalledWith({ canvasId: CANVAS_ID })
  })

  it('creates a canvas from the list form, attaching the picked workspaces', async () => {
    const { mocks, props } = makeHarness({
      workspaces: [{ workspaceId: 'w1', path: '/ws/report', title: 'report' }],
    })
    render(<CanvasSpacePage {...props} />)
    await screen.findByText('为什么人们不愿表达异议')
    fireEvent.click(screen.getByRole('button', { name: /新画布/ }))
    fireEvent.change(screen.getByPlaceholderText('这块画布思考什么主题？'), { target: { value: '远程团队的书面沟通礼仪' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'report' }))
    fireEvent.click(screen.getByRole('button', { name: '建立' }))
    await waitFor(() => {
      expect(mocks.createCanvas).toHaveBeenCalledWith('s1', { title: '远程团队的书面沟通礼仪', attachedWorkspaces: ['/ws/report'] })
    })
  })

  it('adds a card through the draft editor (⌘⏎), and stops the submit mid-IME', async () => {
    const { mocks, props } = makeHarness({ board: board([card('c_1')]) })
    render(<CanvasSpacePage {...props} />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getByRole('button', { name: /新卡/ }))
    // The filter chip reads "问题 0" — the exact name lands the menu item only.
    fireEvent.click(await screen.findByRole('button', { name: '问题' }))
    const editor = await screen.findByPlaceholderText(/写点什么/)
    // Mid-composition the chord is a hard stop.
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

  it('wires the ghost proposal to patchCard status transitions (accept AND reject)', async () => {
    const ghost = card('c_g', { kind: 'reference', status: 'proposed', createdBy: 'agent', text: '效能假说综述' })
    const { mocks, props } = makeHarness({ board: board([card('c_1'), ghost]) })
    render(<CanvasSpacePage {...props} />)
    await screen.findByText('效能假说综述')
    fireEvent.click(screen.getByRole('button', { name: /收下/ }))
    await waitFor(() => {
      expect(mocks.patchCard).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, cardId: 'c_g', status: 'kept' })
    })
    fireEvent.click(screen.getByRole('button', { name: /拒绝/ }))
    await waitFor(() => {
      expect(mocks.patchCard).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, cardId: 'c_g', status: 'archived' })
    })
  })

  it('selects cards and batch-archives them, sequentially', async () => {
    const { mocks, props } = makeHarness({ board: board([card('c_1'), card('c_2')]) })
    render(<CanvasSpacePage {...props} />)
    await screen.findByText('卡片 c_1')
    fireEvent.click(screen.getByText('卡片 c_1'))
    fireEvent.click(screen.getByText('卡片 c_2'))
    await screen.findByText('已选 2 张')
    fireEvent.click(screen.getByRole('button', { name: /归档所选/ }))
    await waitFor(() => {
      expect(mocks.patchCard).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, cardId: 'c_1', status: 'archived' })
      expect(mocks.patchCard).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, cardId: 'c_2', status: 'archived' })
    })
  })

  it('marks a question card answered from its hover action', async () => {
    const question = card('c_q', { kind: 'question', question: { state: 'open' }, text: '为什么？' })
    const { mocks, props } = makeHarness({ board: board([question]) })
    render(<CanvasSpacePage {...props} />)
    await screen.findByText('为什么？')
    fireEvent.click(screen.getByRole('button', { name: '标记已回答' }))
    await waitFor(() => {
      expect(mocks.patchCard).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, cardId: 'c_q', question: { state: 'answered' } })
    })
  })

  it('is read-only without a session: every mutating control stays away', async () => {
    const { props } = makeHarness({ sessionId: 'none', board: board([card('c_1')]) })
    render(<CanvasSpacePage {...props} />)
    await screen.findByText('卡片 c_1')
    expect(screen.getByRole('button', { name: /新画布/ })).toHaveProperty('disabled', true)
    expect(screen.queryByRole('button', { name: /新卡/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '标记已回答' })).toBeNull()
  })

  it('probes a picked workspace and imports its v1 pad as a new canvas', async () => {
    const { mocks, props } = makeHarness({
      workspaces: [{ workspaceId: 'w1', path: '/ws/report', title: 'report' }],
    })
    render(<CanvasSpacePage {...props} />)
    await screen.findByText('为什么人们不愿表达异议')
    fireEvent.click(screen.getByRole('button', { name: /导入 v1 灵感画布/ }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '/ws/report' } })
    await screen.findByText(/发现 2 条灵感/)
    fireEvent.click(screen.getByRole('button', { name: '导入为画布' }))
    await waitFor(() => {
      expect(mocks.probeV1Pad).toHaveBeenCalledWith({ dir: '/ws/report' })
      expect(mocks.importV1).toHaveBeenCalledWith('s1', { dir: '/ws/report' })
    })
  })

  it('filters the grid by kind from the chips', async () => {
    const { props } = makeHarness({
      board: board([
        card('c_1'),
        card('c_q', { kind: 'question', question: { state: 'open' }, text: '为什么？' }),
      ]),
    })
    render(<CanvasSpacePage {...props} />)
    await screen.findByText('卡片 c_1')
    const chips = screen.getByRole('button', { name: /问题/ })
    fireEvent.click(chips)
    await waitFor(() => {
      expect(screen.queryByText('卡片 c_1')).toBeNull()
      expect(screen.getByText('为什么？')).toBeTruthy()
    })
  })

  it('restores an archived card from the well', async () => {
    const gone = card('c_x', { status: 'archived', text: '归档的旧卡' })
    const { mocks, props } = makeHarness({ board: board([card('c_1'), gone]) })
    render(<CanvasSpacePage {...props} />)
    await screen.findByText('卡片 c_1')
    expect(screen.queryByText('归档的旧卡')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /已归档的卡/ }))
    await screen.findByText('归档的旧卡')
    fireEvent.click(screen.getByRole('button', { name: /恢复/ }))
    await waitFor(() => {
      expect(mocks.patchCard).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, cardId: 'c_x', status: 'kept' })
    })
  })
})
