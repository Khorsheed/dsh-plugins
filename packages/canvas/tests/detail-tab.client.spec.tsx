// @vitest-environment jsdom
/**
 * The card-detail TAB (stage ⑧, §11.2 row 7): the seat that turns one address
 * into one card, and the owner of the single draft a canvas can be drafting.
 *
 * What is exercised HERE is everything the tab itself holds, which before this
 * stage sat in the board tab as a drill-down: the address resolution (a card, a
 * draft, or a string that is not our grammar at all), the draft's ⌘⏎-only save
 * and its one discard question with the tab's own × as the exit, the category
 * that travels as navigation params, and the image subscription the tab now
 * owns — a pointer paints in THIS tab because this tab reads the feed. The
 * reader's own behaviour (pasting, comments, the ghost proposal) is
 * `detail.client.spec.tsx`; the board's clicks are `tab.client.spec.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { CanvasTabProps } from '../src/client/contract.ts'
import type { CanvasDetailParams } from '../src/client/definition.ts'
import { CanvasDetailTab } from '../src/client/detail/CanvasDetailTab.tsx'
import { cardDetailAddress, draftDetailAddress } from '../src/client/detail/detail-address.ts'
import { CanvasImageSrcs } from '../src/client/images.ts'
import { CanvasSelectionStore } from '../src/client/space/selection.ts'
import { zh } from '../src/client/locales.ts'
import { defaultCategories } from '../src/types.ts'
import type {
  BoardAskAgentOutcome, BoardAttachImageOutcome, BoardChatStatusResult, BoardMutationResult,
  BoardReadOutcome, BoardCategory, CanvasBoard, CanvasStroke,
} from '../src/types.ts'

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

const NOW = '2026-09-16T08:00:00.000Z'
const CANVAS_ID = 'canvas_01234567abcdefgh'
/** One card id in the shape the store mints (the address grammar insists on it). */
const CARD_ID = 'c_0123456789ab'
/** One custom category row, in the shape the panel mints. */
const custom: BoardCategory = { id: 'cat_01234567abc', label: '反方观点', order: 60, enabled: true }
/** The same image's pointer, as a card holds it (§10.3). */
const IMG_ID = `sha256:${'0123456789abcdef'.repeat(4)}`
const IMG_SRC = `attachment://${IMG_ID}?mediaType=image/png&bytes=3&width=2&height=1`

/** A plain translate over the zh dictionary (the key-set source of truth). */
const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as CanvasTabProps['t']

/** One board fixture; cards land in array order. */
function board(cards: CanvasBoard['cards'] = []): CanvasBoard {
  return {
    id: CANVAS_ID,
    title: '为什么人们不愿表达异议',
    attachedWorkspaces: [],
    chat: { sessionId: null },
    cards,
    categories: [...defaultCategories().map(row => (row.id === 'document' ? { ...row, enabled: false } : { ...row })), custom],
    links: [],
    lanes: [],
    stats: { proposed: { accepted: 0, rejected: 0 }, kindCounts: {}, lastActiveAt: NOW },
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

/** One card fixture. */
function card(id = CARD_ID, overrides: Record<string, unknown> = {}): CanvasBoard['cards'][number] {
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

interface Bench {
  readonly store: CanvasSelectionStore
  readonly mocks: {
    readBoard: ReturnType<typeof vi.fn>
    putCard: ReturnType<typeof vi.fn>
    patchCard: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }
  readonly props: CanvasTabProps
  readonly current: { board: CanvasBoard }
}

/**
 * Mount one detail TAB over a fake host: its address, its navigation params,
 * and a fake `useTabInfo` whose `actions.close` is the only exit a tab has.
 */
function makeBench(options: {
  address?: string
  params?: CanvasDetailParams
  cards?: CanvasBoard['cards']
} = {}): Bench {
  const current = { board: board(options.cards ?? []) }
  const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
  const store = new CanvasSelectionStore()
  // The REAL pointer cache over a fake read leg (§10.3): this tab subscribes to
  // its feed, which is what repaints the markdown renderer with the bytes.
  const images = new CanvasImageSrcs(async () => ({
    ok: true as const,
    value: { ok: true as const, data: 'AAEC', mediaType: 'image/png' as const },
  }))
  const mutation = (): Result<BoardMutationResult> => ok({ ok: true, board: current.board, version: '2' })
  const close = vi.fn()
  const mocks = {
    readBoard: vi.fn(async (): Promise<Result<BoardReadOutcome>> =>
      ok({ ok: true, board: current.board, version: '1' })),
    putCard: vi.fn(async (_sid: string, request: { canvasId: string; kind: string; text: string; draw?: readonly CanvasStroke[] }): Promise<Result<BoardMutationResult>> => {
      current.board.cards.push(card('c_0new0000000', { kind: request.kind, text: request.text, ...(request.draw === undefined ? {} : { draw: request.draw }) }))
      return mutation()
    }),
    patchCard: vi.fn(async (_sid: string, request: { cardId: string; text?: string; draw?: readonly CanvasStroke[] }): Promise<Result<BoardMutationResult>> => {
      const target = current.board.cards.find(candidate => candidate.id === request.cardId)
      if (target !== undefined && request.text !== undefined) target.text = request.text
      return mutation()
    }),
    addComment: vi.fn(mutation),
    openFile: vi.fn(),
    askAgent: vi.fn(async (): Promise<Result<BoardAskAgentOutcome>> =>
      ok({ ok: true, contextKey: `canvas:${CANVAS_ID}`, sent: true })),
    chatStatus: vi.fn(async (): Promise<Result<BoardChatStatusResult>> => ok({ available: true })),
    openSideChat: vi.fn(),
    attachImage: vi.fn(async (): Promise<Result<BoardAttachImageOutcome>> =>
      ok({ ok: true, ref: { attachmentId: IMG_ID, mediaType: 'image/png', bytes: 3, width: 2, height: 1 } })),
    close,
  }
  const props = {
    t,
    sessionId: 's1',
    images,
    readBoard: mocks.readBoard,
    putCard: mocks.putCard,
    patchCard: mocks.patchCard,
    addComment: mocks.addComment,
    openFile: mocks.openFile,
    askAgent: mocks.askAgent,
    chatStatus: mocks.chatStatus,
    openSideChat: mocks.openSideChat,
    attachImage: mocks.attachImage,
    useSessions: ((selector: (snapshot: { byId: Record<string, { cwd: string }> }) => unknown) =>
      selector({ byId: { s1: { cwd: '/ws' } } })) as CanvasTabProps['useSessions'],
    useSelection: function useSelection<S>(selector: (snapshot: ReturnType<typeof store.source.getSnapshot>) => S): S {
      return selector(useSyncExternalStore(store.source.subscribe, store.source.getSnapshot))
    } as CanvasTabProps['useSelection'],
    useImageRev: function useImageRev<S>(selector: (snapshot: number) => S): S {
      return selector(useSyncExternalStore(images.source.subscribe, images.source.getSnapshot))
    } as CanvasTabProps['useImageRev'],
    useTabInfo: () => ({
      sidebar: { expanded: true, fullscreen: false },
      panel: { id: 'pane1' },
      tab: {
        id: 'tab1',
        kind: 'canvasDetail',
        contentId: options.address ?? draftDetailAddress(CANVAS_ID),
        title: '卡片',
        visible: true,
        navigation: { address: options.address ?? draftDetailAddress(CANVAS_ID), revision: 1, params: options.params },
        signal: new AbortController().signal,
        actions: { close, openResource: vi.fn(), openTab: vi.fn() },
      },
    }),
  } as unknown as CanvasTabProps
  return { store, mocks: { readBoard: mocks.readBoard, putCard: mocks.putCard, patchCard: mocks.patchCard, close }, props, current }
}

/** The draft's pad field, with jsdom's missing layout and pointer capture supplied. */
function padField(container: HTMLElement): HTMLElement {
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
  return box
}


afterEach(() => { cleanup() })

describe('CanvasDetailTab — the address', () => {
  it('shows the card its address names', async () => {
    const { props } = makeBench({
      address: cardDetailAddress(CANVAS_ID, CARD_ID),
      cards: [card(CARD_ID, { text: '会上没人开口，是因为没有安全感' })],
    })
    render(<CanvasDetailTab {...props} />)
    await screen.findByText('会上没人开口，是因为没有安全感')
  })

  it('answers a string outside its own grammar with the empty notice, and no board read', async () => {
    const { mocks, props } = makeBench({ address: `dsh-resource://canvas/${CANVAS_ID}/c_1` })
    render(<CanvasDetailTab {...props} />)
    await screen.findByText('这张标签没有指向任何卡：回画布点一张')
    expect(mocks.readBoard).not.toHaveBeenCalled()
  })

  it('reads the card again when the shared rev says the board moved', async () => {
    const { store, mocks, props } = makeBench({
      address: cardDetailAddress(CANVAS_ID, CARD_ID),
      cards: [card(CARD_ID, { text: '第一版正文' })],
    })
    render(<CanvasDetailTab {...props} />)
    await screen.findByText('第一版正文')
    const before = mocks.readBoard.mock.calls.length
    act(() => { store.touch() })
    await waitFor(() => { expect(mocks.readBoard.mock.calls.length).toBeGreaterThan(before) })
  })

  it('switches the reader through render/source/split and saves source through patchCard', async () => {
    const { mocks, props } = makeBench({
      address: cardDetailAddress(CANVAS_ID, CARD_ID),
      cards: [card(CARD_ID, { text: '卡片正文' })],
    })
    render(<CanvasDetailTab {...props} />)
    await screen.findByRole('button', { name: '渲染' })
    fireEvent.click(screen.getByRole('button', { name: '源码' }))
    const editor = await screen.findByDisplayValue('卡片正文')
    fireEvent.change(editor, { target: { value: '改过的正文' } })
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
    await waitFor(() => {
      expect(mocks.patchCard).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, cardId: CARD_ID, text: '改过的正文' })
    })
    // Split shows both panes (the source textarea AND the rendered markdown).
    fireEvent.click(await screen.findByRole('button', { name: '并列' }))
    await screen.findByDisplayValue('改过的正文')
    expect((await screen.findAllByText('改过的正文')).length).toBeGreaterThanOrEqual(1)
  })

  it('paints a pointer the moment THIS tab\'s image read lands', async () => {
    const { props } = makeBench({
      address: cardDetailAddress(CANVAS_ID, CARD_ID),
      cards: [card(CARD_ID, { text: `![截图](${IMG_SRC})` })],
    })
    render(<CanvasDetailTab {...props} />)
    // The first paint only STARTS the read; the cache's feed repaints this tab,
    // and the fresh vocabulary is what the memoized renderer needs.
    const image = await screen.findByRole('img', { name: '截图' })
    await waitFor(() => {
      expect(image.getAttribute('src')).toBe('data:image/png;base64,AAEC')
    })
  })

  it('inlines a pointer held by an HTML card, inside the sandbox CSP', async () => {
    const page = `<!doctype html><html><head><title>页</title></head><body><img src="${IMG_SRC}"></body></html>`
    const { props } = makeBench({
      address: cardDetailAddress(CANVAS_ID, CARD_ID),
      cards: [card(CARD_ID, { kind: 'document', text: page })],
    })
    render(<CanvasDetailTab {...props} />)
    await waitFor(() => {
      const frame = document.querySelector('iframe')
      expect(frame?.getAttribute('srcdoc') ?? '').toContain('src="data:image/png;base64,AAEC"')
    })
    // The frame still runs the strict policy — inlining bytes did not open it.
    expect(document.querySelector('iframe')?.getAttribute('srcdoc')).toContain('img-src data: blob:')
  })
})

describe('CanvasDetailTab — the draft', () => {
  /** The draft tab, filed under one category (what the ＋新卡 menu passes). */
  function draft(kind: string) {
    return makeBench({ params: { heading: '新卡', kind: kind as CanvasDetailParams['kind'] } })
  }

  it('saves on ⌘⏎ only, and stops the submit mid-IME', async () => {
    const { mocks, props } = draft('question')
    render(<CanvasDetailTab {...props} />)
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
    // A stray blur is never a create.
    fireEvent.blur(editor)
    expect(mocks.putCard).toHaveBeenCalledTimes(1)
  })

  it('saves into the category that travelled as params', async () => {
    const { mocks, props } = draft(custom.id)
    render(<CanvasDetailTab {...props} />)
    const editor = await screen.findByPlaceholderText(/写点什么/)
    fireEvent.change(editor, { target: { value: '会上其实有人想反对' } })
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
    await waitFor(() => {
      expect(mocks.putCard).toHaveBeenCalledWith('s1', {
        canvasId: CANVAS_ID, kind: custom.id, text: '会上其实有人想反对',
      })
    })
  })

  it('saves a card that is only a drawing, with the ink and an empty body', async () => {
    const { mocks, props } = draft('fragment')
    const { container } = render(<CanvasDetailTab {...props} />)
    await screen.findByPlaceholderText(/写点什么/)
    fireEvent.click(screen.getByRole('button', { name: '铅笔' }))
    const box = padField(container)
    // The pad is 300×200 screen px for a 600×400 logical box, so every pointer
    // position below lands at twice its pixel reading; the pen's first point
    // carries its resting width, and speed decides the rest (see `sampleWidth`).
    fireEvent.pointerDown(box, { pointerId: 1, clientX: 60, clientY: 40 })
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 120, clientY: 80 })
    fireEvent.pointerUp(box, { pointerId: 1 })
    // ⌘⏎ belongs to the pen too: the textarea that carries it is put away while
    // the field is up, and a shortcut that quits with a tool is a trap.
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
    await waitFor(() => {
      expect(mocks.putCard).toHaveBeenCalledWith('s1', expect.objectContaining({
        canvasId: CANVAS_ID,
        kind: 'fragment',
        text: '',
        draw: [expect.objectContaining({
          color: 'ink',
          pts: [
            { x: 120, y: 80, w: 5 },
            expect.objectContaining({ x: 240, y: 160 }),
          ],
        })],
      }))
    })
  })

  it('leaves an untouched draft without asking, and guards a drafted one exactly once', async () => {
    const { mocks, props } = draft('question')
    render(<CanvasDetailTab {...props} />)
    const editor = await screen.findByPlaceholderText(/写点什么/)

    // Nothing written, so Esc closes the tab with no question.
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(mocks.close).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()

    // A drafted one asks; 继续编辑 keeps every character.
    fireEvent.input(editor, { target: { value: '不表达是因为害怕吗？' } })
    fireEvent.keyDown(editor, { key: 'Escape' })
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('10')
    fireEvent.click(within(dialog).getByRole('button', { name: '继续编辑' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(mocks.close).toHaveBeenCalledTimes(1)
    expect(mocks.putCard).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText(/写点什么/)).toHaveProperty('value', '不表达是因为害怕吗？')

    // 丢掉 closes the tab and writes nothing.
    fireEvent.keyDown(screen.getByPlaceholderText(/写点什么/), { key: 'Escape' })
    fireEvent.click(await screen.findByRole('button', { name: '丢掉' }))
    await waitFor(() => { expect(mocks.close).toHaveBeenCalledTimes(2) })
    expect(mocks.putCard).not.toHaveBeenCalled()
  })

  it('names the ink in the discard question, not just the words', async () => {
    const { props } = draft('fragment')
    const { container } = render(<CanvasDetailTab {...props} />)
    await screen.findByPlaceholderText(/写点什么/)
    fireEvent.click(screen.getByRole('button', { name: '铅笔' }))
    const box = padField(container)
    fireEvent.pointerDown(box, { pointerId: 1, clientX: 60, clientY: 40 })
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 120, clientY: 80 })
    fireEvent.pointerUp(box, { pointerId: 1 })
    // The pen holds the page, and its first exit is its own: this Escape puts
    // the tool away without touching the tab.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    // The textarea is back, so the second one is the tab's leaving gesture.
    fireEvent.keyDown(await screen.findByPlaceholderText(/写点什么/), { key: 'Escape' })
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('1 笔')
    expect(dialog.textContent).not.toContain('个字')
  })
})
