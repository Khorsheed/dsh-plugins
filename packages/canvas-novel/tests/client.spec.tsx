// @vitest-environment jsdom
/**
 * The genre's browser surfaces over a mocked `novel` Remote: the strip stays
 * out of every other genre, the pending gestures answer through the Remote and
 * refresh the board, the chapter page offers ✓ 审过 only once the chapter is
 * extracted and its pending items are handled, the plan block leads while
 * planning and folds once there is text, the book's contents filter and read
 * in place, the novel_write card opens its chapter from its own answer, and a
 * chapter heading never repeats the number its title already carries.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ChapterBook } from '../src/client/ChapterBook.tsx'
import { ChapterPage } from '../src/client/ChapterReader.tsx'
import { CHAPTER_PAGE, LEDGER_PAGE, type NovelRemote, type NovelSurfaceProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { chapterHeading, PendingStrip } from '../src/client/PendingStrip.tsx'
import { WriteToolRow } from '../src/client/WriteToolRow.tsx'
import { writeRowModel } from '../src/client/write-row.ts'
import { NOVEL_GENRE_ID, type ChapterPlan, type ChapterRecord, type EffectiveChapterPhase, type PendingView } from '../src/types.ts'

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

type Row = { chapter: ChapterRecord; phase: EffectiveChapterPhase; body?: string }

/** A Remote whose reads answer from mutable fixtures (`phase` alone: one chapter, 门与假门). */
function fakeRemote(fixture: { items: PendingView[]; phase?: EffectiveChapterPhase; rows?: Row[] }) {
  const rows = (): Row[] => fixture.rows ?? [{ chapter: chapter(1, '门与假门'), phase: fixture.phase ?? 'extracted', body: '# 门\n他推开门。' }]
  const pendingOf = (): Record<number, number> => {
    const counts: Record<number, number> = {}
    for (const entry of fixture.items) if (entry.chapter !== undefined) counts[entry.chapter] = (counts[entry.chapter] ?? 0) + 1
    return counts
  }
  const remote = {
    pending: vi.fn(() => ok({ ok: true, items: fixture.items })),
    chapters: vi.fn(() => ok({ ok: true, chapters: rows().map(({ chapter: record, phase }) => ({ chapter: record, phase })), pending: pendingOf() })),
    ledger: vi.fn(() => ok({ ok: true, counts: { active: 9, overdue: 0 }, marks: {} } as never)),
    chapter: vi.fn(({ n }: { n: number }) => {
      const row = rows().find(entry => entry.chapter.n === n)
      return ok(row === undefined
        ? { ok: false, error: 'missing' as const, pending: 0, names: {} }
        : { ok: true, chapter: row.chapter, phase: row.phase, body: row.body ?? '', pending: pendingOf()[n] ?? 0, names: { c1: '赵启明', f12: '#12 门缝里的东西' } })
    }),
    decidePending: vi.fn(() => ok({ ok: true })),
    reviewChapter: vi.fn(() => ok({ ok: true })),
    confirmPlan: vi.fn(() => ok({ ok: true })),
  } satisfies NovelRemote
  return remote
}

const PLAN: ChapterPlan = {
  summary: '赵启明找到门缝，决定推门。',
  beats: [{ at: '深夜', text: '数钟声找到门缝' }, { text: '叶子发光，他推门', mark: '落点' }],
  conflict: '想推门 vs 被劝阻',
  foreshadowOps: [{ op: '推进', id: 'f12', note: '门缝第一次被找到' }],
  cast: [{ who: 'c1', role: '推门' }],
  pov: 'c1',
  hook: '门后有人敲了三下',
}

/** `null` genre: a canvas without one; `null` session: a read-only canvas. */
function props(remote: NovelRemote | undefined, genre: string | null = NOVEL_GENRE_ID, sessionId: SessionId | null = SESSION) {
  const navigate = { openCard: vi.fn(), openPage: vi.fn(), openManuscripts: vi.fn(), refresh: vi.fn() }
  return {
    canvasId: CANVAS_ID,
    board: { id: CANVAS_ID, title: '梦境监护者', ...(genre === null ? {} : { genre: { id: genre } }) },
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

  it('shows the chapter to pick up at, the ledger door and the way into the book', async () => {
    const remote = fakeRemote({ items: [], phase: 'extracted' })
    const p = props(remote)
    render(<PendingStrip {...p} />)
    fireEvent.click(await screen.findByRole('button', { name: /门与假门/ }))
    expect(p.navigate.openPage).toHaveBeenCalledWith(CHAPTER_PAGE, '第1章 · 门与假门', '1')
    fireEvent.click(screen.getByRole('button', { name: /伏笔台账/ }))
    expect(p.navigate.openPage).toHaveBeenCalledWith(LEDGER_PAGE, zh['ledger.heading'])
    expect(screen.getByText('9 活跃')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '目录 · 共 1 章 ›' }))
    expect(p.navigate.openManuscripts).toHaveBeenCalled()
    expect(screen.queryByText(/待审/)).toBeNull()
  })

  it('the chapter to pick up at is the earliest one with pending items, else the last', async () => {
    const rows = [1, 2, 3].map(n => ({ chapter: chapter(n, `章${n}`), phase: 'extracted' as const }))
    const fixture = { items: [item('p1', { chapter: 2 })], rows }
    const { unmount } = render(<PendingStrip {...props(fakeRemote(fixture))} />)
    expect(await screen.findByRole('button', { name: /章2/ })).toBeTruthy()
    unmount()
    render(<PendingStrip {...props(fakeRemote({ items: [], rows }))} />)
    expect(await screen.findByRole('button', { name: /章3/ })).toBeTruthy()
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

describe('ChapterReader', () => {
  const rows = (): Row[] => [
    { chapter: chapter(1, '第1章 门与假门'), phase: 'reviewed', body: '他推开门。' },
    { chapter: chapter(2, '蓝叶'), phase: 'writing', body: '叶子亮了。\n第二段。' },
  ]

  it('pages forward and back, glimpses the next chapter, and 目录 leads to the book', async () => {
    const remote = fakeRemote({ items: [], rows: rows() })
    const p = { ...props(remote), page: CHAPTER_PAGE, param: '1' }
    render(<ChapterPage {...p} />)
    expect(await screen.findByRole('heading', { name: '门与假门' })).toBeTruthy()
    expect(screen.getByText('1 / 2')).toBeTruthy()
    expect(await screen.findByText('叶子亮了。第二段。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['reader.next'] }))
    expect(await screen.findByRole('heading', { name: '蓝叶' })).toBeTruthy()
    expect(await screen.findByText(zh['reader.last'])).toBeTruthy()
    expect((screen.getByRole('button', { name: zh['reader.next'] }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: zh['reader.contents'] }))
    expect(p.navigate.openManuscripts).toHaveBeenCalled()
  })
})

describe('PlanBlock', () => {
  function renderChapter(row: Row) {
    const remote = fakeRemote({ items: [], rows: [row] })
    render(<ChapterPage {...props(remote)} page={CHAPTER_PAGE} param="1" />)
    return remote
  }

  it('leads while planning: open, names resolved, and ✓ 确认计划 through the Remote', async () => {
    const remote = renderChapter({ chapter: chapter(1, '门', { phase: 'planning', plan: PLAN }), phase: 'planning' })
    expect(await screen.findByText(PLAN.summary)).toBeTruthy()
    expect(screen.getByText('数钟声找到门缝')).toBeTruthy()
    expect(screen.getByText('#12 门缝里的东西')).toBeTruthy()
    expect(screen.getByText('门缝第一次被找到')).toBeTruthy()
    expect(screen.getByText(zh['plan.pov'])).toBeTruthy()
    expect(screen.getByText(zh['chapter.noBodyConfirm'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['chapter.confirmPlan'] }))
    await waitFor(() => { expect(remote.confirmPlan).toHaveBeenCalledWith(SESSION, { canvasId: CANVAS_ID, n: 1 }) })
  })

  it('folds once there is text; after extraction it says what the text carried, ✗ where it did not', async () => {
    renderChapter({
      chapter: chapter(1, '门', { plan: PLAN, planConfirmedAt: NOW, delivery: { beats: [true, false], ops: [false] } }),
      phase: 'extracted',
      body: '他推开门。',
    })
    const head = await screen.findByRole('button', { name: /走向 1\/2 · 伏笔 0\/1/ })
    expect(head.textContent).toContain('1 项落空')
    expect(screen.queryByText(PLAN.summary)).toBeNull()
    fireEvent.click(head)
    expect(screen.getByText(zh['plan.beatMiss'])).toBeTruthy()
    expect(screen.getByText(zh['plan.opMiss'])).toBeTruthy()
    expect(screen.getByText(zh['plan.hit'])).toBeTruthy()
  })
})

describe('ChapterBook', () => {
  it('renders nothing on a canvas of another genre', () => {
    const { container } = render(<ChapterBook {...props(fakeRemote({ items: [] }), null)} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the contents, filters to the chapters that need the person, and reads in place', async () => {
    const rows: Row[] = [
      { chapter: chapter(1, '入职', { wordCount: 6000 }), phase: 'reviewed', body: '值夜。' },
      { chapter: chapter(2, '蓝叶', { wordCount: 5000 }), phase: 'extracted', body: '叶子。' },
      { chapter: chapter(3, '门后', { phase: 'planning' }), phase: 'planning' },
    ]
    render(<ChapterBook {...props(fakeRemote({ items: [], rows }))} />)
    expect(await screen.findByText('共 3 章 · 1.1 万 字 · 1 章已审过')).toBeTruthy()
    expect(screen.getByRole('button', { name: /第 1–3 章/ }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '待处理 1' }))
    expect(screen.queryByRole('button', { name: /入职/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /蓝叶/ }))
    expect(await screen.findByRole('heading', { name: '蓝叶' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['reader.toc'] }))
    expect(await screen.findByText(zh['toc.resume'])).toBeTruthy()
  })

  it('an empty work says how chapters arrive', async () => {
    render(<ChapterBook {...props(fakeRemote({ items: [], rows: [] }))} />)
    expect(await screen.findByText(zh['toc.empty'])).toBeTruthy()
  })
})

describe('novel_write tool row', () => {
  const settled = (text: string, isError = false) => ({ kind: 'tool-result', content: [{ type: 'text', text }], isError })
  const PLANNED = `已登记第 1 章《门》（画布 ${CANVAS_ID}）plan：走向 2 拍 / 伏笔 1 条 / 出场 1 人。完整计划已在会话卡片和章节页上。`

  it('reads the chapter and the canvas from the answer', () => {
    expect(writeRowModel(settled(PLANNED)).chapter).toEqual({ canvasId: CANVAS_ID, n: 1, title: '门', counts: { beats: 2, ops: 1, cast: 1 } })
    expect(writeRowModel(settled(`已建第 2 章《尾声》（画布 ${CANVAS_ID} · 规划中 · 第2章.md）。`)).chapter)
      .toEqual({ canvasId: CANVAS_ID, n: 2, title: '尾声', counts: null })
    expect(writeRowModel({}).state).toBe('running')
    expect(writeRowModel(settled('失败：没有第 9 章。')).state).toBe('failed')
    expect(writeRowModel(settled('已归档：#3。')).state).toBe('line')
  })

  it('a planned chapter is a card whose door opens the chapter page', async () => {
    const remote = fakeRemote({ items: [], rows: [{ chapter: chapter(1, '门', { phase: 'planning', plan: PLAN }), phase: 'planning' }] })
    const openPage = vi.fn()
    render(<WriteToolRow block={settled(PLANNED)} remote={() => remote} openPage={() => openPage} chapterPage={CHAPTER_PAGE} t={t} />)
    expect(await screen.findByText(PLAN.summary)).toBeTruthy()
    expect(screen.getByText(zh['card.awaiting'])).toBeTruthy()
    expect(screen.getByText('推进 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `${zh['card.confirm']} →` }))
    expect(openPage).toHaveBeenCalledWith(CANVAS_ID, CHAPTER_PAGE, '第1章 · 门', '1')
  })

  it('without the canvas the card keeps its answer counts and offers no door', () => {
    render(<WriteToolRow block={settled(PLANNED)} remote={() => undefined} openPage={() => undefined} chapterPage={CHAPTER_PAGE} t={t} />)
    expect(screen.getByText('走向 2 拍')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('any other write is one line, the full answer behind 详情', () => {
    render(<WriteToolRow block={settled('已落卡 [#19]。\n忽略了不认识的字段：bogus')} remote={() => undefined} openPage={() => undefined} chapterPage={CHAPTER_PAGE} t={t} />)
    expect(screen.getByText('已落卡 [#19]。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['card.inspect'] }))
    expect(screen.getByText(/忽略了不认识的字段/)).toBeTruthy()
  })
})
