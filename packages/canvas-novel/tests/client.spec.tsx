// @vitest-environment jsdom
/**
 * The genre's browser surfaces over a mocked `novel` Remote: the strip stays
 * out of every other genre, the pending gestures answer through the Remote and
 * refresh the board, the chapter page offers ✓ 审过 only once the chapter is
 * extracted and its pending items are handled, and a chapter heading never
 * repeats the number its title already carries.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ChapterPage } from '../src/client/ChapterPage.tsx'
import { CHAPTER_PAGE, LEDGER_PAGE, type NovelRemote, type NovelSurfaceProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { chapterHeading, PendingStrip } from '../src/client/PendingStrip.tsx'
import { NOVEL_GENRE_ID, type ChapterRecord, type EffectiveChapterPhase, type PendingView } from '../src/types.ts'

afterEach(cleanup)

const CANVAS_ID = 'canvas_novel'
const SESSION = 's-1' as SessionId
const NOW = '2026-10-05T08:00:00.000Z'

/** A plain translate over the zh dictionary (the key-set source of truth). */
const t = ((key: keyof typeof zh, params?: Record<string, string | number>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match))) as NovelSurfaceProps['t']

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })

function chapter(n: number, title: string, overrides: Partial<ChapterRecord> = {}): ChapterRecord {
  return { n, seq: n, title, file: `第${n}章.md`, phase: 'extracted', sessionIds: [], createdAt: NOW, updatedAt: NOW, ...overrides }
}

function item(id: string, overrides: Partial<PendingView> = {}): PendingView {
  return {
    id, kind: 'mention', confidence: 'medium', chapter: 1, reason: '置信度中等',
    payload: { foreshadowId: 'c_f', kind: 'advanced' }, status: 'pending', createdAt: NOW,
    subject: '#10 门后是谁？', subjectCardId: 'c_f', ...overrides,
  }
}

/** A Remote whose reads answer from mutable fixtures. */
function fakeRemote(fixture: { items: PendingView[]; phase: EffectiveChapterPhase }) {
  const remote = {
    pending: vi.fn(() => ok({ ok: true, items: fixture.items })),
    chapters: vi.fn(() => ok({ ok: true, chapters: [{ chapter: chapter(1, '第1章 门与假门'), phase: fixture.phase }], pending: {} })),
    ledger: vi.fn(() => ok({ ok: true, counts: { active: 9, overdue: 0 }, marks: {} } as never)),
    chapter: vi.fn(() => ok({ ok: true, chapter: chapter(1, '门与假门'), phase: fixture.phase, body: '# 门\n他推开门。', pending: fixture.items.length, names: {} })),
    decidePending: vi.fn(() => ok({ ok: true })),
    reviewChapter: vi.fn(() => ok({ ok: true })),
    confirmPlan: vi.fn(() => ok({ ok: true })),
  } satisfies NovelRemote
  return remote
}

/** `null` genre: a canvas without one; `null` session: a read-only canvas. */
function props(remote: NovelRemote | undefined, genre: string | null = NOVEL_GENRE_ID, sessionId: SessionId | null = SESSION) {
  const navigate = { openCard: vi.fn(), openPage: vi.fn(), refresh: vi.fn() }
  return {
    canvasId: CANVAS_ID,
    board: { id: CANVAS_ID, ...(genre === null ? {} : { genre: { id: genre } }) },
    rev: 0,
    navigate,
    sessionId: sessionId ?? undefined,
    remote: () => remote,
    t,
  }
}

describe('chapterHeading', () => {
  it('prefixes the number unless the title already carries it', () => {
    expect(chapterHeading(t, 3, '回声')).toBe('第3章 · 回声')
    expect(chapterHeading(t, 1, '第1章 门与假门')).toBe('第1章 门与假门')
    expect(chapterHeading(t, 2, '')).toBe('第2章')
  })
})

describe('PendingStrip', () => {
  it('renders nothing on a canvas of another genre, and never reads', () => {
    const remote = fakeRemote({ items: [], phase: 'extracted' })
    const { container } = render(<PendingStrip {...props(remote, null)} />)
    expect(container.innerHTML).toBe('')
    expect(remote.pending).not.toHaveBeenCalled()
  })

  it('shows the chapters and the ledger door; the pending toggle only while there is something to review', async () => {
    const remote = fakeRemote({ items: [], phase: 'extracted' })
    const p = props(remote)
    render(<PendingStrip {...p} />)
    fireEvent.click(await screen.findByRole('button', { name: /第1章/ }))
    expect(p.navigate.openPage).toHaveBeenCalledWith(CHAPTER_PAGE, '第1章 门与假门', '1')
    fireEvent.click(screen.getByRole('button', { name: /伏笔台账/ }))
    expect(p.navigate.openPage).toHaveBeenCalledWith(LEDGER_PAGE, zh['ledger.heading'])
    expect(screen.getByText('9 活跃')).toBeTruthy()
    expect(screen.queryByText(/待审/)).toBeNull()
  })

  it('accepts, discards and acknowledges through the Remote, refreshing the board each time', async () => {
    const remote = fakeRemote({
      items: [item('p1'), item('p2', { kind: 'plan-missed', payload: { op: '推进' }, subject: undefined, subjectCardId: undefined })],
      phase: 'extracted',
    })
    const p = props(remote)
    render(<PendingStrip {...p} />)
    fireEvent.click(await screen.findByRole('button', { name: /待审 2/ }))
    fireEvent.click(screen.getByRole('button', { name: '丢弃' }))
    await waitFor(() => { expect(p.navigate.refresh).toHaveBeenCalledTimes(1) })
    expect(remote.decidePending).toHaveBeenLastCalledWith(SESSION, { canvasId: CANVAS_ID, id: 'p1', action: 'discard' })
    fireEvent.click(screen.getByRole('button', { name: '知道了' }))
    await waitFor(() => { expect(p.navigate.refresh).toHaveBeenCalledTimes(2) })
    expect(remote.decidePending).toHaveBeenLastCalledWith(SESSION, { canvasId: CANVAS_ID, id: 'p2', action: 'accept' })
    fireEvent.click(screen.getByRole('button', { name: '#10 门后是谁？' }))
    expect(p.navigate.openCard).toHaveBeenCalledWith('c_f', '#10 门后是谁？')
  })

  it('a read-only canvas lists the queue without answers', async () => {
    const remote = fakeRemote({ items: [item('p1')], phase: 'extracted' })
    render(<PendingStrip {...props(remote, NOVEL_GENRE_ID, null)} />)
    fireEvent.click(await screen.findByRole('button', { name: /待审 1/ }))
    expect(screen.getByText(zh['pending.readOnly'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: '采纳' })).toBeNull()
  })
})

describe('ChapterPage', () => {
  function renderPage(remote: NovelRemote, sessionId: SessionId | null = SESSION) {
    const p = { ...props(remote, NOVEL_GENRE_ID, sessionId), page: CHAPTER_PAGE, param: '1' }
    render(<ChapterPage {...p} />)
    return p
  }

  it('holds ✓ 审过 while this chapter still has pending items', async () => {
    const remote = fakeRemote({ items: [item('p1')], phase: 'extracted' })
    renderPage(remote)
    expect(await screen.findByText('还有 1 条待审，处理完才能审过')).toBeTruthy()
    expect((screen.getByRole('button', { name: zh['chapter.review'] }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('他推开门。')).toBeTruthy()
  })

  it('holds it before the chapter is reconciled', async () => {
    renderPage(fakeRemote({ items: [], phase: 'writing' }))
    expect(await screen.findByText(zh['chapter.gate.writing'])).toBeTruthy()
    expect((screen.getByRole('button', { name: zh['chapter.review'] }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers it once extracted and handled, and closes the chapter through the Remote', async () => {
    const remote = fakeRemote({ items: [], phase: 'extracted' })
    const p = renderPage(remote)
    const button = await screen.findByRole('button', { name: zh['chapter.review'] })
    await waitFor(() => { expect((button as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.click(button)
    await waitFor(() => { expect(p.navigate.refresh).toHaveBeenCalled() })
    expect(remote.reviewChapter).toHaveBeenCalledWith(SESSION, { canvasId: CANVAS_ID, n: 1 })
  })

  it('a reviewed chapter shows the closed state instead of the button', async () => {
    renderPage(fakeRemote({ items: [], phase: 'reviewed' }))
    expect(await screen.findByText(`✓ ${zh['chapter.reviewed']}`)).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh['chapter.review'] })).toBeNull()
  })

  it('a read-only canvas never offers it', async () => {
    renderPage(fakeRemote({ items: [], phase: 'extracted' }), null)
    expect(await screen.findByText(zh['chapter.gate.readOnly'])).toBeTruthy()
    expect((screen.getByRole('button', { name: zh['chapter.review'] }) as HTMLButtonElement).disabled).toBe(true)
  })
})
