// @vitest-environment jsdom
/**
 * The manuscript page and the board's 成稿 face, over injected Remote mocks.
 * Asserts the reading render and the source ledger (a deleted card is a
 * struck chip), the edit → ⌘⏎ save carrying the version it started from, the
 * lost race's banner and both of its ways out, the workspace save that stops
 * to ask before overwriting, the 「让 Agent 改」 quote, and the list's order.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { CanvasManuscriptViewProps } from '../src/client/contract.ts'
import { ManuscriptList, ManuscriptView } from '../src/client/manuscript/ManuscriptView.tsx'
import { CanvasSelectionStore } from '../src/client/space/selection.ts'
import { zh } from '../src/client/locales.ts'
import type {
  BoardManuscript, BoardReadOutcome, CanvasBoard, ManuscriptExportResult, ManuscriptReadOutcome,
  ManuscriptWriteRequest, ManuscriptWriteResult,
} from '../src/types.ts'
import { defaultCategories } from '../src/types.ts'

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

const NOW = '2026-09-27T08:00:00.000Z'
const CANVAS_ID = 'canvas_01234567abcdefgh'
const MS_ID = 'ms_0123456789abcdef'

const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as CanvasManuscriptViewProps['t']

function manuscript(overrides: Partial<BoardManuscript> = {}): BoardManuscript {
  return {
    id: MS_ID,
    title: '异议的代价',
    status: 'writing',
    version: 3,
    file: `manuscripts/${MS_ID}.md`,
    sources: { used: ['c_a'], unused: ['c_gone'] },
    createdBy: 'agent',
    lastWrittenBy: 'agent',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function board(manuscripts: BoardManuscript[], attachedWorkspaces: string[] = ['/ws/report']): CanvasBoard {
  return {
    id: CANVAS_ID,
    title: '为什么人们不愿表达异议',
    attachedWorkspaces,
    chat: { sessionId: null },
    cards: [{
      id: 'c_a', kind: 'fragment', text: '沉默螺旋', status: 'kept', comments: [],
      createdBy: 'user', createdAt: NOW, updatedAt: NOW,
    }] as CanvasBoard['cards'],
    categories: defaultCategories(),
    links: [],
    lanes: [],
    manuscripts,
    stats: { proposed: { accepted: 0, rejected: 0 }, kindCounts: {}, lastActiveAt: NOW },
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  } as CanvasBoard
}

function harness(options: {
  write?: (request: ManuscriptWriteRequest) => ManuscriptWriteResult
  exportAnswers?: ManuscriptExportResult[]
} = {}) {
  const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
  const current = { board: board([manuscript()]), body: '# 异议的代价\n\n正文第一段。' }
  sessionStorage.clear()
  const store = new CanvasSelectionStore()
  const exportAnswers = [...(options.exportAnswers ?? [])]
  const mocks = {
    readBoard: vi.fn(async (): Promise<Result<BoardReadOutcome>> => ok({ ok: true, board: current.board, version: '1' })),
    readManuscript: vi.fn(async (): Promise<Result<ManuscriptReadOutcome>> =>
      ok({ ok: true, manuscript: current.board.manuscripts[0]!, body: current.body })),
    writeManuscript: vi.fn(async (_sid: string, request: ManuscriptWriteRequest): Promise<Result<ManuscriptWriteResult>> => {
      if (options.write !== undefined) return ok(options.write(request))
      const next = manuscript({ version: 4, lastWrittenBy: 'user' })
      current.board = board([next])
      current.body = request.body
      return ok({ ok: true, manuscript: next, board: current.board, version: '2' })
    }),
    patchManuscript: vi.fn(),
    deleteManuscript: vi.fn(),
    exportManuscript: vi.fn(async (): Promise<Result<ManuscriptExportResult>> =>
      ok(exportAnswers.shift() ?? { ok: true, path: '/ws/report/异议的代价.md', images: 0, missingImages: 0, board: current.board, version: '2' })),
    openManuscript: vi.fn(),
    openCardDetail: vi.fn(),
    openFile: vi.fn(),
    talkAvailable: vi.fn(() => true),
    quoteToConversation: vi.fn(() => true),
    attachImage: vi.fn(),
  }
  const props = {
    t,
    sessionId: 's1',
    canvasId: CANVAS_ID,
    manuscriptId: MS_ID,
    crumbs: { canvasTitle: '为什么人们不愿表达异议', heading: '异议的代价', siblings: [], onBack: vi.fn(), onStep: vi.fn() },
    ...mocks,
    useSelection: function useSelection<S>(selector: (snapshot: ReturnType<typeof store.source.getSnapshot>) => S): S {
      return selector(useSyncExternalStore(store.source.subscribe, store.source.getSnapshot))
    },
  } as unknown as CanvasManuscriptViewProps
  return { props, mocks, current }
}

/** The edit pad is the one textarea on the page. */
function pad(): HTMLTextAreaElement {
  return document.querySelector('textarea')!
}

afterEach(() => { cleanup() })

describe('ManuscriptView', () => {
  it('reads the manuscript at its version, and ends with the source ledger', async () => {
    const { props } = harness()
    render(<ManuscriptView {...props} />)
    expect(await screen.findByText('正文第一段。')).toBeTruthy()
    expect(screen.getByText('写作中')).toBeTruthy()
    expect(screen.getByText('v3')).toBeTruthy()
    const used = screen.getByRole('button', { name: '沉默螺旋' })
    fireEvent.click(used)
    expect(props.openCardDetail).toHaveBeenCalledWith(CANVAS_ID, 'c_a', '沉默螺旋')
    // The card it left out has since been deleted: a struck, inert chip.
    expect((screen.getByTitle(zh['ms.cardGone']) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders a whole HTML block in a sandboxed frame, not as its source', async () => {
    const { props, current } = harness()
    current.body = '# 异议的代价\n\n正文第一段。\n\n<div style="border:1px solid #e2e5ea"><div>行为层</div></div>\n\n结尾一段。'
    render(<ManuscriptView {...props} />)
    expect(await screen.findByText('结尾一段。')).toBeTruthy()
    const frame = document.querySelector('iframe[data-html-block]') as HTMLIFrameElement
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain('<div>行为层</div>')
    expect(frame.getAttribute('srcdoc')).toContain('Content-Security-Policy')
    expect(screen.queryByText(/border:1px solid/)).toBeNull()
  })

  it('saves an edit with ⌘⏎, presenting the version the edit started from', async () => {
    const { props, mocks } = harness()
    render(<ManuscriptView {...props} />)
    await screen.findByText('正文第一段。')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.input(pad(), { target: { value: '# 异议的代价\n\n改过的正文。' } })
    fireEvent.keyDown(pad(), { key: 'Enter', metaKey: true })
    await waitFor(() => { expect(mocks.writeManuscript).toHaveBeenCalledTimes(1) })
    expect(mocks.writeManuscript.mock.calls[0]![1]).toEqual({
      canvasId: CANVAS_ID, manuscriptId: MS_ID, body: '# 异议的代价\n\n改过的正文。', baseVersion: 3,
    })
    expect(await screen.findByText('已保存 v4')).toBeTruthy()
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('keeps the words when a save loses the race, and 覆盖 re-saves over the version it lost to', async () => {
    let calls = 0
    const { props, mocks, current } = harness({
      write: request => {
        calls += 1
        if (calls === 1) return { ok: false, error: 'stale', currentVersion: 5 }
        const next = manuscript({ version: 6 })
        current.board = board([next])
        current.body = request.body
        return { ok: true, manuscript: next, board: current.board, version: '3' }
      },
    })
    render(<ManuscriptView {...props} />)
    await screen.findByText('正文第一段。')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.input(pad(), { target: { value: '我的版本' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    const banner = await screen.findByRole('alert')
    expect(banner.textContent).toContain('v5')
    expect(pad().value).toBe('我的版本')
    fireEvent.click(screen.getByRole('button', { name: zh['ms.overwrite'] }))
    await waitFor(() => { expect(mocks.writeManuscript).toHaveBeenCalledTimes(2) })
    expect(mocks.writeManuscript.mock.calls[1]![1]).toMatchObject({ body: '我的版本', baseVersion: 5 })
  })

  it('载入最新 drops the edit and re-reads', async () => {
    const { props, mocks } = harness({ write: () => ({ ok: false, error: 'stale', currentVersion: 5 }) })
    render(<ManuscriptView {...props} />)
    await screen.findByText('正文第一段。')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.input(pad(), { target: { value: '我的版本' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    fireEvent.click(await screen.findByRole('button', { name: zh['ms.loadLatest'] }))
    await waitFor(() => { expect(document.querySelector('textarea')).toBeNull() })
    expect(mocks.readBoard.mock.calls.length).toBeGreaterThan(1)
  })

  it('asks before a workspace save overwrites a file changed outside, then overwrites on 覆盖', async () => {
    const { props, mocks, current } = harness({
      exportAnswers: [{ ok: false, error: 'changed', path: '/ws/report/异议的代价.md' }],
    })
    render(<ManuscriptView {...props} />)
    await screen.findByText('正文第一段。')
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '保存到「report」' }))
    expect(await screen.findByText(zh['ms.exportChangedTitle'])).toBeTruthy()
    // Named from the workspace down: the absolute prefix only pushes the file off the line.
    expect(screen.getByText(/^report\/异议的代价\.md 在上次保存之后/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['ms.exportOverwrite'] }))
    await waitFor(() => { expect(mocks.exportManuscript).toHaveBeenCalledTimes(2) })
    expect(mocks.exportManuscript.mock.calls[0]![1]).toEqual({ canvasId: CANVAS_ID, manuscriptId: MS_ID, workspace: '/ws/report' })
    expect(mocks.exportManuscript.mock.calls[1]![1]).toMatchObject({ workspace: '/ws/report', overwrite: true })
    expect(current.board.manuscripts).toHaveLength(1)
  })

  it('quotes the handle and the version into the conversation for 让 Agent 改', async () => {
    const { props, mocks } = harness()
    render(<ManuscriptView {...props} />)
    await screen.findByText('正文第一段。')
    fireEvent.click(screen.getByRole('button', { name: '让 Agent 改' }))
    const quoted = mocks.quoteToConversation.mock.calls[0]![1] as string
    expect(quoted).toContain(MS_ID)
    expect(quoted).toContain('baseVersion 填 3')
  })
})

describe('ManuscriptList', () => {
  it('lists newest first and opens a row', () => {
    const onOpen = vi.fn()
    const older = manuscript({ id: 'ms_old', title: '旧稿', updatedAt: '2026-09-20T08:00:00.000Z' })
    const newer = manuscript({ id: 'ms_new', title: '新稿', status: 'final' })
    render(<ManuscriptList t={t} board={board([older, newer])} onOpen={onOpen} />)
    const rows = screen.getAllByRole('button')
    expect(rows.map(row => row.textContent?.slice(0, 2))).toEqual(['新稿', '旧稿'])
    fireEvent.click(rows[0]!)
    expect(onOpen).toHaveBeenCalledWith(newer)
  })

  it('says what a manuscript is when the board has none', () => {
    render(<ManuscriptList t={t} board={board([])} onOpen={vi.fn()} />)
    expect(screen.getByText(zh['ms.empty'])).toBeTruthy()
  })
})
