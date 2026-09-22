// @vitest-environment jsdom
/**
 * The card-detail reader under the composed-props form: a REAL
 * CanvasSelectionStore (the board↔detail contract is the store itself, so it
 * is exercised here, not mocked), injected Remote mocks over a mutable fake
 * host, and plain selector-hook fakes. Asserts the empty state, the
 * full-text render (no summary clamp in the reader), the selection and rev
 * following, the ghost ✓/✗ wiring, the edit toggle's ⌘⏎ save through
 * patchCard, the comment form, the attachment gestures (url link, file →
 * openFile), the archived card's restore, and every paste arm — sheet to
 * table, page to its words, and an image FILE to a pointer line whose pixels
 * stayed in the store (§10.3).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { CanvasDetailProps } from '../src/client/contract.ts'
import { CanvasDetailView } from '../src/client/detail/CanvasDetailView.tsx'
import { CanvasImageSrcs } from '../src/client/images.ts'
import { CanvasSelectionStore } from '../src/client/space/selection.ts'
import { imageSrcOf } from '../src/image-token.ts'
import { zh } from '../src/client/locales.ts'
import type {
  BoardAskAgentOutcome, BoardAttachImageOutcome, BoardChatStatusResult, BoardMutationResult,
  BoardReadOutcome, CanvasBoard, CanvasImageRef,
} from '../src/types.ts'

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

const NOW = '2026-09-16T08:00:00.000Z'
const CANVAS_ID = 'canvas_01234567abcdefgh'
/** One stored image's pointer parts: the digest the read leg re-derives. */
const IMG_ID = `sha256:${'0123456789abcdef'.repeat(4)}`
const IMG_REF: CanvasImageRef = {
  attachmentId: IMG_ID, mediaType: 'image/png', bytes: 3, width: 2, height: 1,
}

/** A plain translate over the zh dictionary (the key-set source of truth). */
const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as CanvasDetailProps['t']

/** One board fixture; cards land in array order. */
function board(cards: CanvasBoard['cards'] = []): CanvasBoard {
  return {
    id: CANVAS_ID,
    title: '为什么人们不愿表达异议',
    attachedWorkspaces: [],
    chat: { sessionId: null },
    cards,
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
    text: `卡片 ${id} 的正文`,
    status: 'kept',
    comments: [],
    createdBy: 'user',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as CanvasBoard['cards'][number]
}

/**
 * Fires a paste carrying the given clipboard flavors (and files), and reports
 * whether the handler took the event over (jsdom ships no DataTransfer, so the
 * flavors are the object the handler reads).
 */
function pasteInto(element: HTMLElement, flavors: Record<string, string>, files: readonly File[] = []): boolean {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string): string => flavors[type] ?? '',
      files: [...files],
    },
  })
  element.dispatchEvent(event)
  return event.defaultPrevented
}

interface Harness {
  readonly store: CanvasSelectionStore
  readonly images: CanvasImageSrcs
  readonly mocks: {
    readBoard: ReturnType<typeof vi.fn>
    patchCard: ReturnType<typeof vi.fn>
    addComment: ReturnType<typeof vi.fn>
    openFile: ReturnType<typeof vi.fn>
    askAgent: ReturnType<typeof vi.fn>
    chatStatus: ReturnType<typeof vi.fn>
    openSideChat: ReturnType<typeof vi.fn>
    attachImage: ReturnType<typeof vi.fn>
  }
  readonly props: CanvasDetailProps
  readonly current: { board: CanvasBoard }
}

/** Mount the reader over a fake host whose mutations apply to its board. */
function makeHarness(cards: CanvasBoard['cards'], options: { chatAvailable?: boolean } = {}): Harness {
  const current = { board: board(cards) }
  const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
  const store = new CanvasSelectionStore()
  // The REAL pointer cache (§10.3): the read leg is a fake store that hands
  // back three bytes, so a resolve is asynchronous exactly as in the browser.
  const images = new CanvasImageSrcs(async () => ({
    ok: true as const,
    value: { ok: true as const, data: 'AAEC', mediaType: 'image/png' as const },
  }))
  const mocks = {
    readBoard: vi.fn(async (): Promise<Result<BoardReadOutcome>> => ok({ ok: true, board: current.board, version: '1' })),
    patchCard: vi.fn(async (_sessionId: string, request: { cardId: string; text?: string; status?: 'kept' | 'archived' }): Promise<Result<BoardMutationResult>> => {
      const target = current.board.cards.find(candidate => candidate.id === request.cardId)
      if (target !== undefined) {
        if (request.text !== undefined) target.text = request.text
        if (request.status !== undefined) target.status = request.status
      }
      return ok({ ok: true, board: current.board, version: '2' })
    }),
    addComment: vi.fn(async (_sessionId: string, request: { cardId: string; text: string }): Promise<Result<BoardMutationResult>> => {
      const target = current.board.cards.find(candidate => candidate.id === request.cardId)
      target?.comments.push({ id: `m_${request.text.length}`, author: 'user', text: request.text, createdAt: NOW })
      return ok({ ok: true, board: current.board, version: '2' })
    }),
    openFile: vi.fn(),
    askAgent: vi.fn(async (): Promise<Result<BoardAskAgentOutcome>> =>
      ok({ ok: true, contextKey: `canvas:${CANVAS_ID}`, sent: true })),
    chatStatus: vi.fn(async (): Promise<Result<BoardChatStatusResult>> =>
      ok({ available: options.chatAvailable ?? true })),
    openSideChat: vi.fn(),
    attachImage: vi.fn(async (): Promise<Result<BoardAttachImageOutcome>> => ok({ ok: true, ref: IMG_REF })),
  }
  const props = {
    t,
    sessionId: 's1',
    images,
    ...mocks,
    useSelection: function useSelection<S>(selector: (snapshot: ReturnType<typeof store.source.getSnapshot>) => S): S {
      return selector(useSyncExternalStore(store.source.subscribe, store.source.getSnapshot))
    },
    useSessions: ((selector: (snapshot: { byId: Record<string, { cwd: string }> }) => unknown) =>
      selector({ byId: { s1: { cwd: '/ws' } } })) as CanvasDetailProps['useSessions'],
  } as CanvasDetailProps
  return { store, images, mocks, props, current }
}

afterEach(() => { cleanup() })

describe('CanvasDetailView', () => {
  it('shows the empty state until the board selects a card', async () => {
    const { props } = makeHarness([card('c_1')])
    render(<CanvasDetailView {...props} />)
    await screen.findByText('在画布空间点一张卡，在这里读全文')
  })

  it('renders the selected card in full — no summary clamp in the reader', async () => {
    const longText = `长文全文。\n${'这是一段很长的正文，用来证明详情里不做摘要折叠。\n'.repeat(10)}结尾。`
    const { store, props } = makeHarness([card('c_1', { text: longText })])
    store.select(CANVAS_ID, 'c_1')
    render(<CanvasDetailView {...props} />)
    await screen.findByText(/结尾。/)
    expect(screen.queryByText(/字$/)).toBeNull()
  })

  it('shows the document card\'s derived heading, and the kind/state/source meta', async () => {
    const { store, props } = makeHarness([
      card('c_doc', {
        kind: 'document',
        text: '# 大模型心理学：综述\n\n正文。',
        source: { type: 'url', ref: 'https://example.org/paper', title: 'paper' },
      }),
    ])
    store.select(CANVAS_ID, 'c_doc')
    render(<CanvasDetailView {...props} />)
    // The header's derived heading AND the full text's own h1 both carry it.
    expect((await screen.findAllByText('大模型心理学：综述')).length).toBeGreaterThanOrEqual(1)
    await screen.findByText('文档')
    const link = await screen.findByRole('link', { name: /paper/ })
    expect(link.getAttribute('href')).toBe('https://example.org/paper')
    await screen.findByText(/创建于/)
  })

  it('follows the selection to another card (same canvas: no refetch, the board already holds it)', async () => {
    const { store, mocks, props } = makeHarness([card('c_1'), card('c_2')])
    store.select(CANVAS_ID, 'c_1')
    render(<CanvasDetailView {...props} />)
    await screen.findByText('卡片 c_1 的正文')
    act(() => { store.select(CANVAS_ID, 'c_2') })
    await screen.findByText('卡片 c_2 的正文')
    expect(mocks.readBoard).toHaveBeenCalledTimes(1)
  })

  it('re-reads when the shared rev is touched (the other seat mutated the board)', async () => {
    const { store, mocks, props } = makeHarness([card('c_1')])
    store.select(CANVAS_ID, 'c_1')
    render(<CanvasDetailView {...props} />)
    await screen.findByText('卡片 c_1 的正文')
    const before = mocks.readBoard.mock.calls.length
    act(() => { store.touch() })
    await waitFor(() => {
      expect(mocks.readBoard.mock.calls.length).toBeGreaterThan(before)
    })
  })

  it('wires the ghost proposal to patchCard, from the detail too', async () => {
    const ghost = card('c_g', { status: 'proposed', createdBy: 'agent', text: '效能假说综述' })
    const { store, props } = makeHarness([ghost])
    store.select(CANVAS_ID, 'c_g')
    render(<CanvasDetailView {...props} />)
    await screen.findByText('AGENT 提议 · 待你确认')
    fireEvent.click(screen.getByRole('button', { name: /收下/ }))
    await waitFor(() => {
      expect(screen.queryByText('AGENT 提议 · 待你确认')).toBeNull()
    })
    expect(ghost.status).toBe('kept')
  })

  it('saves the source mode through patchCard and returns to reading', async () => {
    const { store, mocks, props } = makeHarness([card('c_1')])
    store.select(CANVAS_ID, 'c_1')
    render(<CanvasDetailView {...props} />)
    await screen.findByText('卡片 c_1 的正文')
    fireEvent.click(screen.getByRole('button', { name: '源码' }))
    const editor = await screen.findByDisplayValue('卡片 c_1 的正文')
    fireEvent.change(editor, { target: { value: '改过的正文' } })
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
    await waitFor(() => {
      expect(mocks.patchCard).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, cardId: 'c_1', text: '改过的正文' })
    })
    await screen.findByText('改过的正文')
    expect(screen.queryByDisplayValue('改过的正文')).toBeNull()
  })

  it('pastes a sheet as a markdown table, into the caret, and reports it', async () => {
    const { store, props } = makeHarness([card('c_1')])
    store.select(CANVAS_ID, 'c_1')
    render(<CanvasDetailView {...props} />)
    await screen.findByText('卡片 c_1 的正文')
    fireEvent.click(screen.getByRole('button', { name: '源码' }))
    const editor = await screen.findByDisplayValue('卡片 c_1 的正文')
    const taken = pasteInto(editor, {
      'text/html': '<html><body><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table></body></html>',
      'text/plain': 'a\tb\n1\t2',
    })
    expect(taken).toBe(true)
    expect((editor as HTMLTextAreaElement).value).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |卡片 c_1 的正文')
    await screen.findByText(/表格转成了 markdown 表/)
  })

  it('leaves a page pasted into prose to the browser, and says why in its place', async () => {
    const { store, props } = makeHarness([card('c_1')])
    store.select(CANVAS_ID, 'c_1')
    render(<CanvasDetailView {...props} />)
    await screen.findByText('卡片 c_1 的正文')
    fireEvent.click(screen.getByRole('button', { name: '源码' }))
    const editor = await screen.findByDisplayValue('卡片 c_1 的正文')
    // The caret sits where a reader leaves it: after the card's own words, so
    // the card the paste would produce still holds prose.
    const area = editor as HTMLTextAreaElement
    area.setSelectionRange(area.value.length, area.value.length)
    const taken = pasteInto(area, {
      'text/html': '<!doctype html><html><head><title>雨</title></head><body><p>一整页</p></body></html>',
      'text/plain': '雨\n\n一整页',
    })
    // Not taken over: the browser pastes its own text flavor, with its undo entry.
    expect(taken).toBe(false)
    expect(area.value).toBe('卡片 c_1 的正文')
    await screen.findByText(/落的是网页里的文字那一份/)
  })

  it('keeps markup as a page when the card it produces still reads as one', async () => {
    const { store, props } = makeHarness([card('c_h', {
      kind: 'document',
      text: '<!doctype html><html><head><title>报告</title></head><body><p>正文</p></body></html>',
    })])
    store.select(CANVAS_ID, 'c_h')
    render(<CanvasDetailView {...props} />)
    await screen.findByText('文档')
    fireEvent.click(screen.getByRole('button', { name: '源码' }))
    const editor = await screen.findByDisplayValue(/<title>报告<\/title>/)
    const taken = pasteInto(editor, {
      'text/html': '<div><p>又一段</p><span>还有一句</span></div>',
      'text/plain': '又段一句',
    })
    expect(taken).toBe(true)
    expect((editor as HTMLTextAreaElement).value.startsWith('<div>')).toBe(true)
    await screen.findByText(/这张卡按网页渲染/)
  })

  it('pastes an image file as a pointer line — the pixels never enter the card', async () => {
    const { store, mocks, props } = makeHarness([card('c_1')])
    store.select(CANVAS_ID, 'c_1')
    render(<CanvasDetailView {...props} />)
    await screen.findByText('卡片 c_1 的正文')
    fireEvent.click(screen.getByRole('button', { name: '源码' }))
    const area = (await screen.findByDisplayValue('卡片 c_1 的正文')) as HTMLTextAreaElement
    area.setSelectionRange(0, 0)
    const taken = pasteInto(area, {}, [new File([new Uint8Array([0, 1, 2])], '截图.png', { type: 'image/png' })])
    // Taken over at once (before the store call), so the browser adds nothing.
    expect(taken).toBe(true)
    await waitFor(() => {
      expect(area.value).toBe(`![截图.png](${imageSrcOf(IMG_REF)})卡片 c_1 的正文`)
    })
    expect(mocks.attachImage).toHaveBeenCalledWith({ data: 'AAEC', mediaType: 'image/png', name: '截图.png' })
    await screen.findByText(/卡片正文里存的不是图/)
    // The pointer is the whole of what the card carries.
    expect(area.value).not.toContain('AAEC')
  })

  it('pastes the tag form when the card it lands in is a page', async () => {
    const { store, props } = makeHarness([card('c_page', {
      kind: 'document',
      text: '<!doctype html><html><head><title>报告</title></head><body><p>正文</p></body></html>',
    })])
    store.select(CANVAS_ID, 'c_page')
    render(<CanvasDetailView {...props} />)
    await screen.findByText('文档')
    fireEvent.click(screen.getByRole('button', { name: '源码' }))
    const area = (await screen.findByDisplayValue(/<title>报告<\/title>/)) as HTMLTextAreaElement
    area.setSelectionRange(area.value.length, area.value.length)
    pasteInto(area, {}, [new File([new Uint8Array([0, 1, 2])], '图 1.png', { type: 'image/png' })])
    await waitFor(() => {
      expect(area.value).toBe(
        `<!doctype html><html><head><title>报告</title></head><body><p>正文</p></body></html><img src="${imageSrcOf(IMG_REF)}" alt="图 1.png">`,
      )
    })
  })

  it('says which refusal stopped an image, and pastes nothing for it', async () => {
    const { store, mocks, props } = makeHarness([card('c_1')])
    store.select(CANVAS_ID, 'c_1')
    render(<CanvasDetailView {...props} />)
    await screen.findByText('卡片 c_1 的正文')
    fireEvent.click(screen.getByRole('button', { name: '源码' }))
    const area = (await screen.findByDisplayValue('卡片 c_1 的正文')) as HTMLTextAreaElement
    mocks.attachImage.mockResolvedValue({ ok: true, value: { ok: false, error: 'too-large' } })
    pasteInto(area, {}, [new File([new Uint8Array([0, 1, 2])], '大图.png', { type: 'image/png' })])
    await screen.findByText(/这张图太大/)
    expect(area.value).toBe('卡片 c_1 的正文')
  })

  it('posts a comment from the thread', async () => {
    const { store, mocks, props } = makeHarness([card('c_1')])
    store.select(CANVAS_ID, 'c_1')
    render(<CanvasDetailView {...props} />)
    await screen.findByText('卡片 c_1 的正文')
    const box = screen.getByPlaceholderText('写条评论…（⏎ 发送）')
    fireEvent.change(box, { target: { value: '这里隐含一个假设' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => {
      expect(mocks.addComment).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, cardId: 'c_1', text: '这里隐含一个假设' })
    })
    await screen.findByText(/这里隐含一个假设/)
  })

  it('opens a file attachment through openFile with the tab\'s session and cwd', async () => {
    const { store, mocks, props } = makeHarness([
      card('c_1', { source: { type: 'file', ref: '/ws/灵感画布/文章/第一章.md', title: '第一章 雨夜' } }),
    ])
    store.select(CANVAS_ID, 'c_1')
    render(<CanvasDetailView {...props} />)
    await screen.findByText('卡片 c_1 的正文')
    fireEvent.click(screen.getByRole('button', { name: /预览 第一章 雨夜/ }))
    expect(mocks.openFile).toHaveBeenCalledWith('s1', '/ws', '/ws/灵感画布/文章/第一章.md')
  })

  it('follows up on an agent comment, and hides the chat entries when the seam is absent', async () => {
    const commented = card('c_1', {
      comments: [{ id: 'm_1', author: 'agent', text: '这里隐含一个假设', createdAt: NOW }],
    })
    const { store, mocks, props } = makeHarness([commented])
    store.select(CANVAS_ID, 'c_1')
    render(<CanvasDetailView {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: /追问/ }))
    await waitFor(() => {
      expect(mocks.askAgent).toHaveBeenCalledWith('s1', {
        canvasId: CANVAS_ID,
        lens: 'ask',
        cardIds: ['c_1'],
        text: '就这条评论继续追问：「这里隐含一个假设」',
      })
    })
  })

  it('hides 追问 and the selection offer when side-chat is absent', async () => {
    const commented = card('c_1', {
      comments: [{ id: 'm_1', author: 'agent', text: '这里隐含一个假设', createdAt: NOW }],
    })
    const { store, props } = makeHarness([commented], { chatAvailable: false })
    store.select(CANVAS_ID, 'c_1')
    render(<CanvasDetailView {...props} />)
    await screen.findByText(/这里隐含一个假设/)
    expect(screen.queryByRole('button', { name: /追问/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /问 Agent/ })).toBeNull()
  })

  it('renders an html card in the sandboxed frame (CSP inside) and keeps markdown on MarkdownText', async () => {
    const htmlCard = card('c_h', {
      kind: 'document',
      text: '<!DOCTYPE html><html><head><title>报告</title></head><body><p>正文</p></body></html>',
    })
    const { store, props } = makeHarness([htmlCard])
    store.select(CANVAS_ID, 'c_h')
    render(<CanvasDetailView {...props} />)
    await screen.findByText('文档')
    await screen.findByText('HTML')
    const frame = document.querySelector('iframe')
    expect(frame).not.toBeNull()
    expect(frame!.getAttribute('sandbox')).toBe('allow-scripts')
    const srcDoc = frame!.getAttribute('srcdoc') ?? ''
    expect(srcDoc).toContain('default-src')
    expect(srcDoc).toContain('<title>报告</title>')
    expect(srcDoc).toContain('<p>正文</p>')
    // The raw markup never renders as text.
    expect(screen.queryByText(/DOCTYPE/)).toBeNull()
  })

  it('shows an archived card with its tag and restores it', async () => {
    const gone = card('c_x', { status: 'archived', text: '归档的旧卡' })
    const { store, mocks, props } = makeHarness([gone])
    store.select(CANVAS_ID, 'c_x')
    render(<CanvasDetailView {...props} />)
    await screen.findByText('已归档')
    fireEvent.click(screen.getByRole('button', { name: /恢复/ }))
    await waitFor(() => {
      expect(mocks.patchCard).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, cardId: 'c_x', status: 'kept' })
    })
  })
})
