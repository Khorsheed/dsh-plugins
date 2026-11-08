// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ChapterDeletionView } from '../src/chapter-deletion.ts'
import { DeleteChaptersDialog, RecycleBinPage } from '../src/client/ChapterDeletion.tsx'
import type { NovelRemote, NovelSurfaceProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

const SESSION = 's-delete' as SessionId
const t = ((key: keyof typeof zh, params?: Record<string, string | number>): string => zh[key].replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match))) as NovelSurfaceProps['t']
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
const operation: ChapterDeletionView = {
  id: 'del-1', status: 'active', updatedAt: '2026-11-08T15:00:00.000Z', size: 108_500,
  chapters: [
    { n: 3, title: '无名之地', words: 2379, hasBody: true, size: 42_800 },
    { n: 4, title: '神眷者', words: 2344, hasBody: true, size: 40_600 },
    { n: 5, title: '别替我起名', words: 0, hasBody: false, size: 12_700 },
    { n: 6, title: '名字留下以后', words: 0, hasBody: false, size: 12_400 },
  ],
  counts: { bodies: 2, plans: 4, words: 4723, mentions: 2, experiences: 5, relations: 2, history: 13, minds: 0, pending: 0, feedback: 0 },
  cascadeCards: [{ id: 'c-old-setting', name: '命名可令失稳者暂时稳定', status: 'kept' }, { id: 'c-old-rule', name: '命名需要日常维护', status: 'kept' }],
  reviewCards: [{ id: 'c-linchuan', name: '林川' }],
}

function props(api: Partial<NovelRemote>, onClose = vi.fn()): NovelSurfaceProps & { onClose: () => void } {
  const withReads = {
    chapterDeletions: vi.fn(() => ok({ ok: true, operations: [operation], size: operation.size })),
    ...api,
  }
  return {
    canvasId: 'canvas_dream0001', board: { id: 'canvas_dream0001', title: '潜梦者', genre: { id: 'novel' } }, rev: 0,
    navigate: { openCard: vi.fn(), openPage: vi.fn(), openManuscripts: vi.fn(), refresh: vi.fn() },
    sessionId: SESSION, remote: () => withReads as NovelRemote, t, onClose,
  }
}

describe('chapter deletion surfaces', () => {
  afterEach(cleanup)

  it('applies only the cascade cards the person leaves selected', async () => {
    const applyChapterDeletion = vi.fn(() => ok({ ok: true, deleted: 4, cleanupPending: false }))
    const onDone = vi.fn()
    render(<DeleteChaptersDialog {...props({ applyChapterDeletion })} operation={operation} onDone={onDone} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /命名需要日常维护/ }))
    fireEvent.click(screen.getByRole('button', { name: zh['delete.confirm'] }))
    await vi.waitFor(() => expect(applyChapterDeletion).toHaveBeenCalledWith(SESSION, { canvasId: 'canvas_dream0001', deletionId: 'del-1', cards: ['c-old-setting'] }))
    expect(onDone).toHaveBeenCalledWith(false)
  })

  it('restores one chapter to the next free number and optionally restores its cards', async () => {
    const restoreChapters = vi.fn(() => ok({ ok: true, restored: 1, cardErrors: [] }))
    const surface = props({ restoreChapters })
    render(<RecycleBinPage {...surface} rev={0} />)
    await screen.findByText('第3章 · 无名之地')
    const row = screen.getByRole('checkbox', { name: zh['recycle.selectChapter'].replace('{n}', '3') })
    fireEvent.click(row)
    fireEvent.click(screen.getAllByRole('button', { name: zh['recycle.restore'] })[0]!)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'next' } })
    fireEvent.click(screen.getByRole('checkbox', { name: zh['recycle.restoreCards'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['recycle.confirmRestore'] }))
    await vi.waitFor(() => expect(restoreChapters).toHaveBeenCalledWith(SESSION, {
      canvasId: 'canvas_dream0001', deletionId: 'del-1', chapters: [3], cards: ['c-old-setting', 'c-old-rule'], position: 'next',
    }))
    expect(surface.navigate.openManuscripts).toHaveBeenCalled()
  })

  it('requires acknowledgement before purging only the selected chapter', async () => {
    const purgeChapters = vi.fn(() => ok({ ok: true, purged: 1, cardErrors: [] }))
    render(<RecycleBinPage {...props({ purgeChapters })} rev={0} />)
    await screen.findByText('第3章 · 无名之地')
    fireEvent.click(screen.getByRole('checkbox', { name: zh['recycle.selectChapter'].replace('{n}', '4') }))
    fireEvent.click(screen.getByRole('button', { name: zh['recycle.purgeSelected'].replace('{count}', '1') }))
    expect(screen.getByRole('button', { name: zh['recycle.confirmPurge'] }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: zh['recycle.purgeAck'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['recycle.confirmPurge'] }))
    await vi.waitFor(() => expect(purgeChapters).toHaveBeenCalledWith(SESSION, { canvasId: 'canvas_dream0001', deletionId: 'del-1', chapters: [4] }))
  })

  it('empties every operation without restoring deleted chapters', async () => {
    const purgeChapters = vi.fn(() => ok({ ok: true, purged: 4, cardErrors: [] }))
    render(<RecycleBinPage {...props({ purgeChapters })} rev={0} />)
    await screen.findByText('第3章 · 无名之地')
    fireEvent.click(screen.getByRole('button', { name: zh['recycle.emptyAll'] }))
    fireEvent.click(screen.getByRole('checkbox', { name: zh['recycle.purgeAck'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['recycle.confirmPurge'] }))
    await vi.waitFor(() => expect(purgeChapters).toHaveBeenCalledWith(SESSION, { canvasId: 'canvas_dream0001', deletionId: 'del-1', chapters: [3, 4, 5, 6] }))
  })

  it('loads a real manuscript snapshot without exposing derived records', async () => {
    const chapterDeletionSnapshot = vi.fn(() => ok({ ok: true, snapshot: { n: 3, title: '无名之地', body: '第三章的真实正文。' } }))
    render(<RecycleBinPage {...props({ chapterDeletionSnapshot })} rev={0} />)
    await screen.findByText('第3章 · 无名之地')
    fireEvent.click(screen.getAllByRole('button', { name: zh['recycle.snapshot'] })[0]!)
    expect(await screen.findByText('第三章的真实正文。')).toBeTruthy()
    expect(chapterDeletionSnapshot).toHaveBeenCalledWith({ canvasId: 'canvas_dream0001', deletionId: 'del-1', chapter: 3 })
    expect(screen.getByText(zh['recycle.snapshotReadonly'])).toBeTruthy()
  })

  it('shows the summary and beats for a plan-only snapshot', async () => {
    const chapterDeletionSnapshot = vi.fn(() => ok({ ok: true, snapshot: { n: 5, title: '别替我起名', body: '', plan: { summary: '重复规划的摘要', beats: [{ at: '深夜', text: '第一拍' }, { text: '第二拍' }] } } }))
    render(<RecycleBinPage {...props({ chapterDeletionSnapshot })} rev={0} />)
    await screen.findByText('第3章 · 无名之地')
    fireEvent.click(screen.getAllByRole('button', { name: zh['recycle.snapshot'] })[2]!)
    expect(await screen.findByText('重复规划的摘要')).toBeTruthy()
    expect(screen.getByText('深夜｜第一拍')).toBeTruthy()
    expect(screen.getByText('第二拍')).toBeTruthy()
    expect(chapterDeletionSnapshot).toHaveBeenCalledWith({ canvasId: 'canvas_dream0001', deletionId: 'del-1', chapter: 5 })
  })

  it('shows the empty state and a read failure without custom page navigation', async () => {
    const { unmount } = render(<RecycleBinPage {...props({ chapterDeletions: vi.fn(() => ok({ ok: true, operations: [], size: 0 })) })} rev={0} />)
    expect(await screen.findByText(zh['recycle.empty'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh['recycle.restore'] })).toBeNull()
    unmount()
    render(<RecycleBinPage {...props({ chapterDeletions: vi.fn(() => Promise.resolve({ ok: false as const, error: { code: 'io', message: '读取失败' } })) })} rev={0} />)
    expect(await screen.findByText(/读取失败/)).toBeTruthy()
  })
})
