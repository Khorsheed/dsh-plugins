// @vitest-environment jsdom
/**
 * The genre's browser surfaces over a mocked `novel` Remote: the book stays
 * out of every other genre and picks up at the right chapter, the pending
 * gestures answer through the Remote and refresh the board, the chapter page offers ✓ 审过 only once the chapter is
 * extracted and its pending items are handled, the plan block leads while
 * planning and folds once there is text, the book's contents filter and read
 * in place, the novel_write card opens its chapter from its own answer, a
 * relation card shows its ladder and a character its derived 关系, and a
 * chapter heading never repeats the number its title already carries, and
 * the story log draws its rows and opens a row's 现状 / 变化过程 beside them,
 * and the three faces' helpers (the 章节 badge, the 设定 scopes, the 连线
 * graph, the delete note) read which cards the story uses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { CardSection } from '../src/client/CardSection.tsx'
import { ChapterBook } from '../src/client/ChapterBook.tsx'
import { ChapterPage } from '../src/client/ChapterReader.tsx'
import { CHAPTER_PAGE, STORY_LOG_PAGE, type NovelRemote, type NovelSurfaceProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { CardScopes, ChaptersBadge, DeleteNote, FaceLabel, storyUsage } from '../src/client/NovelFaces.tsx'
import { chapterHeading } from '../src/client/PendingList.tsx'
import { StoryLogPage } from '../src/client/StoryLogPage.tsx'
import { WriteToolRow } from '../src/client/WriteToolRow.tsx'
import { writeRowModel } from '../src/client/write-row.ts'
import { NOVEL_GENRE_ID, type ChapterPlan, type ChapterRecord, type EffectiveChapterPhase, type PendingView, type StoryLogResult } from '../src/types.ts'

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
    ledger: vi.fn(() => ok({ ok: true, counts: { active: 9, overdue: 0 } } as never)),
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

describe('ChapterBook · 继续写 and the queue', () => {
  it('never reads on a canvas of another genre', () => {
    const remote = fakeRemote({ items: [], phase: 'extracted' })
    const { container } = render(<ChapterBook {...props(remote, null)} />)
    expect(container.innerHTML).toBe('')
    expect(remote.chapters).not.toHaveBeenCalled()
  })

  it('picks up at the earliest chapter with pending items, else the last; 继续写 reads it in place', async () => {
    const rows = [1, 2, 3].map(n => ({ chapter: chapter(n, `章${n}`), phase: 'extracted' as const, body: `正文${n}` }))
    const { unmount } = render(<ChapterBook {...props(fakeRemote({ items: [item('p1', { chapter: 2 })], rows }))} />)
    expect(await screen.findByText('第2章 · 章2')).toBeTruthy()
    unmount()
    render(<ChapterBook {...props(fakeRemote({ items: [], rows }))} />)
    expect(await screen.findByText('第3章 · 章3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['toc.continue'] }))
    expect(await screen.findByRole('heading', { name: '章3' })).toBeTruthy()
  })

  it('says the model reconciles waiting chapters first', async () => {
    const rows: Row[] = [{ chapter: chapter(1, '门'), phase: 'stale' }, { chapter: chapter(2, '叶'), phase: 'writing' }]
    render(<ChapterBook {...props(fakeRemote({ items: [], rows }))} />)
    expect(await screen.findByText('2 章待对账，模型下一步会先对完')).toBeTruthy()
    expect(screen.getAllByText(zh['toc.state.wait']).length).toBeGreaterThan(0)
  })

  it('accepts, discards and acknowledges through the Remote, refreshing the board each time', async () => {
    const remote = fakeRemote({
      items: [item('p1'), item('p2', { kind: 'plan-missed', payload: { op: '推进' }, subject: undefined, subjectCardId: undefined })],
      phase: 'extracted',
    })
    const p = props(remote)
    render(<ChapterBook {...p} />)
    const head = await screen.findByRole('button', { name: /待审 2/, expanded: false })
    fireEvent.click(head)
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
    render(<ChapterBook {...props(fakeRemote({ items: [item('p1')], phase: 'extracted' }), NOVEL_GENRE_ID, null)} />)
    fireEvent.click(await screen.findByRole('button', { name: /待审 1/, expanded: false }))
    expect(screen.getByText(zh['pending.readOnly'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: '采纳' })).toBeNull()
  })

  it('an empty work tells the canvas, which then opens on 设定', async () => {
    const onEmpty = vi.fn()
    render(<ChapterBook {...props(fakeRemote({ items: [], rows: [] }))} onEmpty={onEmpty} />)
    await waitFor(() => { expect(onEmpty).toHaveBeenCalled() })
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
    expect(screen.queryByRole('button', { name: zh['chapter.review'] })).toBeNull()
    expect(screen.getByText('他推开门。')).toBeTruthy()
  })

  it('holds it before the chapter is reconciled', async () => {
    renderPage(fakeRemote({ items: [], phase: 'writing' }))
    expect(await screen.findByText(zh['chapter.gate.writing'].replace('{n}', '1'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh['chapter.review'] })).toBeNull()
  })

  it('a text changed since its 对账 says how to reconcile again, at the top only', async () => {
    renderPage(fakeRemote({ items: [], phase: 'stale' }))
    expect(await screen.findByText(zh['chapter.gate.stale'].replace('{n}', '1'))).toBeTruthy()
    expect(screen.getByText(zh['phase.stale'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh['chapter.review'] })).toBeNull()
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
    expect(screen.queryByRole('button', { name: zh['chapter.review'] })).toBeNull()
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

describe('CardSection', () => {
  function renderCard(role: string, value: object) {
    const remote = { ...fakeRemote({ items: [] }), card: vi.fn(() => ok({ ok: true, role, ...value })) } as unknown as NovelRemote
    const p = props(remote)
    render(<CardSection {...p} card={{ id: 'c_r' }} category={{ id: 'cat_relation', role }} />)
    return p
  }

  it('a relation shows its type\'s four stages with the current one bold, and 可升 off a full bar', async () => {
    renderCard('relation', {
      relation: { cardId: 'c_r', ref: 'r1', name: '赵启明 × 艾文', pair: [], type: '同盟', stage: '合作', level: 2, progress: 3, ready: true, cardStatus: 'kept' },
    })
    await screen.findByText(zh['card.ready'])
    const current = screen.getByText('合作').closest('tr')!
    expect(current.dataset['current']).toBe('true')
    expect(screen.getByText('结盟').closest('tr')!.dataset['current']).toBeUndefined()
  })

  it('a relation in a rift says so instead of the bar', async () => {
    renderCard('relation', {
      relation: { cardId: 'c_r', ref: 'r1', name: '赵启明 × 艾文', pair: [], type: '同盟', stage: '裂痕', rift: '裂痕', progress: 2, ready: false, cardStatus: 'kept' },
    })
    await screen.findByText(zh['card.rift'].replace('{rift}', '裂痕'))
    expect(screen.queryByText(zh['card.bar'].replace('{points}', '2').replace('{full}', '3'))).toBeNull()
  })

  it('a character lists the 关系 read off the relation cards', async () => {
    renderCard('character', { currentState: {}, relations: ['艾文 · 同盟 · 合作 — 勉强信任'] })
    await screen.findByText('艾文 · 同盟 · 合作 — 勉强信任')
  })

  it('a character\'s 在故事里: one line for an unworked 此刻, the 出场 strip, and the way into the story log', async () => {
    const p = renderCard('character', {
      appearances: [
        { chapter: 1, pov: false, planned: false, experiences: [] },
        { chapter: 2, pov: false, planned: true, role: '章末小节', experiences: [] },
      ],
    })
    await screen.findByText(zh['card.story'])
    expect(screen.getByText(zh['card.nowUnset'])).toBeTruthy()
    expect(screen.queryByText(zh['card.state.where'])).toBeNull()
    expect(screen.getByText('第 1 章')).toBeTruthy()
    expect(screen.getByText('计划 · 章末小节')).toBeTruthy()
    expect(screen.getByText(zh['card.relationsNone'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['card.inLog'] }))
    expect(p.navigate.openPage).toHaveBeenCalledWith(STORY_LOG_PAGE, zh['log.heading'], 'c_r')
  })

  it('a worked 此刻 lists only the parts it has', async () => {
    renderCard('character', { currentState: { where: '第七工作站' } })
    await screen.findByText('第七工作站')
    expect(screen.getByText(zh['card.state.where'])).toBeTruthy()
    expect(screen.queryByText(zh['card.state.concern'])).toBeNull()
    expect(screen.getByText(zh['card.appearNone'])).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', { name: /^待处理/ }))
    expect(screen.queryByRole('button', { name: /入职/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /蓝叶/ }))
    expect(await screen.findByRole('heading', { name: '蓝叶' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['reader.toc'] }))
    expect(await screen.findByRole('button', { name: zh['toc.continue'] })).toBeTruthy()
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

const STORY_LOG: StoryLogResult = {
  ok: true,
  chapters: [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ n, title: `第${n}章`, phase: n === 8 ? 'planning' as const : 'extracted' as const })),
  foreshadows: [
    {
      cardId: 'f12', ref: '#12', question: '门缝里的东西', state: '推进中', plantedAt: 1, starred: false, slept: 6, cardStatus: 'kept',
      marks: [{ chapter: 1, kind: 'planted', planned: false }, { chapter: 8, kind: 'advanced', planned: true, note: '门后第一层' }],
    },
    {
      cardId: 'f9', ref: '#9', question: '钟楼为什么没有影子', state: '已揭晓', plantedAt: 1, answer: '它立在两层梦之间', starred: false, cardStatus: 'kept',
      marks: [{ chapter: 1, kind: 'planted', planned: false }, { chapter: 4, kind: 'resolved', planned: false }],
    },
  ],
  relations: [{
    cardId: 'r1', ref: '#1', name: '赵启明 × 艾文', pair: ['c1', 'c2'], names: ['赵启明', '艾文'], type: '同盟', stage: '合作', level: 2,
    views: [], progress: 3, ready: true, cardStatus: 'kept',
    journal: [
      { relationId: 'r1', chapter: 2, kind: 'stage', event: 'start', stage: '接触', level: 1, createdAt: NOW },
      { relationId: 'r1', chapter: 3, kind: 'stage', event: 'up', stage: '合作', level: 2, evidence: '两人一起找到半页守则', createdAt: NOW },
      { relationId: 'r1', chapter: 5, kind: 'points', delta: 2, evidence: '在二层梦边缘接住赵启明', createdAt: NOW },
    ],
  }],
  characters: [{
    cardId: 'c1', ref: '#1', name: '赵启明', plot: { identity: '见习监护员', voice: '短句；紧张时重复别人的话' },
    history: [{ cardId: 'c1', chapter: 7, source: 'user', kind: 'change', changes: [{ field: 'voice', op: '→', value: '短句；紧张时重复别人的话', from: '短句' }], createdAt: '' }],
    appearances: [{ chapter: 3, pov: true, planned: false, experiences: ['发现半页守则'] }],
  }],
  world: [],
}

function storyLogRemote() {
  return { storyLog: vi.fn(() => ok(STORY_LOG)), starForeshadow: vi.fn(() => ok({ ok: true })) } as unknown as NovelRemote & {
    storyLog: ReturnType<typeof vi.fn>
    starForeshadow: ReturnType<typeof vi.fn>
  }
}

describe('StoryLogPage', () => {
  const page = (remote: NovelRemote, genre: string | null = NOVEL_GENRE_ID, sessionId: SessionId | null = SESSION) =>
    ({ ...props(remote, genre, sessionId), page: STORY_LOG_PAGE })

  it('renders nothing on a canvas of another genre, and never reads', () => {
    const remote = storyLogRemote()
    const { container } = render(<StoryLogPage {...page(remote, null)} />)
    expect(container.innerHTML).toBe('')
    expect(remote.storyLog).not.toHaveBeenCalled()
  })

  it('opens on 伏笔 · 未收 with the sleeper\'s detail beside the table; 全部 brings the revealed back', async () => {
    render(<StoryLogPage {...page(storyLogRemote())} />)
    expect(await screen.findByRole('heading', { name: '门缝里的东西' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /伏笔/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByText('钟楼为什么没有影子')).toBeNull()
    expect(screen.getAllByText('沉睡 6 章').length).toBeGreaterThan(0)
    expect(screen.getByText('已经 6 章没有动它（当前第 7 章）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /星标/ }))
    expect(screen.getByText('这一筛选下没有伏笔。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^全部/ }))
    fireEvent.click(screen.getByTitle('钟楼为什么没有影子'))
    expect(screen.getByRole('heading', { name: '钟楼为什么没有影子' })).toBeTruthy()
    expect(screen.getByText('它立在两层梦之间')).toBeTruthy()
  })

  it('stars a foreshadow through the Remote and refreshes; read-only without a session', async () => {
    const remote = storyLogRemote()
    const p = page(remote)
    render(<StoryLogPage {...p} />)
    fireEvent.click(await screen.findByRole('button', { name: '☆' }))
    await waitFor(() => { expect(p.navigate.refresh).toHaveBeenCalled() })
    expect(remote.starForeshadow).toHaveBeenCalledWith(SESSION, { canvasId: CANVAS_ID, cardId: 'f12', starred: true })
    cleanup()
    render(<StoryLogPage {...page(storyLogRemote(), NOVEL_GENRE_ID, null)} />)
    expect(((await screen.findByRole('button', { name: '☆' })) as HTMLButtonElement).disabled).toBe(true)
  })

  it('the 关系 tab tells the pair\'s story in plain words: 确立, 进入新阶段 with 原文, 加深', async () => {
    render(<StoryLogPage {...page(storyLogRemote())} />)
    fireEvent.click(await screen.findByRole('tab', { name: /关系/ }))
    expect(screen.getByRole('heading', { name: '赵启明 × 艾文' })).toBeTruthy()
    expect(screen.getByText('确立')).toBeTruthy()
    expect(screen.getAllByText('进入新阶段').length).toBeGreaterThan(0)
    expect(screen.getByText('接触 → 合作')).toBeTruthy()
    expect(screen.getByText('原文「两人一起找到半页守则」')).toBeTruthy()
    expect(screen.getByText('明显加深')).toBeTruthy()
    expect(screen.getByText(/已加深到位/)).toBeTruthy()
    expect(screen.queryByText(/积分/)).toBeNull()
  })

  it('opens on a card it was given: its tab and row, the track led by what the chapter left them, 读第 N 章', async () => {
    const p = page(storyLogRemote())
    render(<StoryLogPage {...p} param="c1" />)
    expect(await screen.findByRole('heading', { name: '赵启明' })).toBeTruthy()
    expect(screen.getByText('发现半页守则')).toBeTruthy()
    expect(screen.queryByText(zh['log.m.appear'], { selector: 'b' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /读第 3 章/ }))
    expect(p.navigate.openPage).toHaveBeenCalledWith(CHAPTER_PAGE, expect.any(String), '3')
  })

  it('the 人物 tab shows where each value came from and the pair; 在画布中打开 opens the card', async () => {
    const p = page(storyLogRemote())
    render(<StoryLogPage {...p} />)
    fireEvent.click(await screen.findByRole('tab', { name: /人物/ }))
    expect(screen.getByRole('heading', { name: '赵启明' })).toBeTruthy()
    expect(screen.getByText('你改的 · 第 7 章前后')).toBeTruthy()
    expect(screen.getByText('艾文 · 同盟 · 合作')).toBeTruthy()
    expect(screen.getByText('发现半页守则')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /在画布中打开/ }))
    expect(p.navigate.openCard).toHaveBeenCalledWith('c1', '赵启明')
  })

  it('an empty tab explains how its cards arrive, without the bar', async () => {
    render(<StoryLogPage {...page(storyLogRemote())} />)
    fireEvent.click(await screen.findByRole('tab', { name: /世界/ }))
    expect(screen.getByText('还没有世界卡')).toBeTruthy()
    expect(screen.getByText('地点、势力、规则这些设定写成卡片后出现在这里。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '图例' })).toBeNull()
  })

  it('a chapter number opens that chapter\'s page; 图例 folds open with the hollow rule', async () => {
    const p = page(storyLogRemote())
    render(<StoryLogPage {...p} />)
    fireEvent.click(await screen.findByRole('button', { name: /^1\D*已对账$/ }))
    expect(p.navigate.openPage).toHaveBeenCalledWith(CHAPTER_PAGE, chapterHeading(t, 1, '第1章'), '1')
    expect(screen.queryByText('空心 = 计划里，还没写到')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '图例' }))
    expect(screen.getByText('空心 = 计划里，还没写到')).toBeTruthy()
  })
})

describe('the three faces', () => {
  /** Two characters joined by r1, so the graph has a line; 艾文 is in no chapter yet. */
  const LOG: StoryLogResult = {
    ...STORY_LOG,
    characters: [...STORY_LOG.characters, { cardId: 'c2', ref: '#2', name: '艾文', plot: {}, history: [], appearances: [{ chapter: 9, pov: false, planned: true, experiences: [] }] }],
  }
  const remote = () => ({ ...fakeRemote({ items: [item('p1')], rows: [{ chapter: chapter(1, '门'), phase: 'stale' }] }), storyLog: vi.fn(() => ok(LOG)) }) as unknown as NovelRemote

  it('a card is in the story by its reconciled chapters only — never a plan line, never the person\'s edit', () => {
    const usage = storyUsage(LOG)
    expect(usage.get('f12')).toEqual([1])
    expect(usage.get('f9')).toEqual([1, 4])
    expect(usage.get('r1')).toEqual([2, 3, 5])
    expect(usage.get('c1')).toEqual([3])
    expect(usage.has('c2')).toBe(false)
  })

  it('章节 labels the face and its badge counts what waits (chapters to reconcile + items); another genre keeps the canvas label', async () => {
    render(<FaceLabel {...props(remote())} face="manuscripts" label="成稿" />)
    expect(screen.getByText(zh['face.chapters'])).toBeTruthy()
    cleanup()
    // The count is the tab's badge, not part of the label (outside the underline).
    render(<ChaptersBadge {...props(remote())} />)
    expect(await screen.findByText('2')).toBeTruthy()
    cleanup()
    render(<FaceLabel {...props(remote(), null)} face="manuscripts" label="成稿" />)
    expect(screen.getByText('成稿')).toBeTruthy()
    cleanup()
    const { container } = render(<ChaptersBadge {...props(remote(), null)} />)
    expect(container.textContent).toBe('')
  })

  it('设定 scopes: 已进入故事 archives first; 灵感 is the unused story cards, principles left out', async () => {
    const onScopes = vi.fn()
    const p = props(remote())
    const board = {
      ...p.board,
      cards: [{ id: 'f12', kind: 'cat_f' }, { id: 'c2', kind: 'cat_c' }, { id: 'p1', kind: 'cat_p' }],
      categories: [{ id: 'cat_f', role: 'foreshadow' }, { id: 'cat_c', role: 'character' }, { id: 'cat_p', role: 'principle' }],
    }
    render(<CardScopes {...p} board={board} onScopes={onScopes} />)
    await waitFor(() => { expect(onScopes).toHaveBeenCalled() })
    expect(onScopes).toHaveBeenLastCalledWith([
      { id: 'story', label: zh['scope.story'], cardIds: ['f12'], archiveFirst: true },
      { id: 'idea', label: zh['scope.idea'], cardIds: ['c2'] },
    ])
  })

  it('the delete note lists the chapters using a card, says an idea goes for good, and skips principles', async () => {
    const p = props(remote())
    const { unmount } = render(<DeleteNote {...p} card={{ id: 'r1' }} category={{ id: 'cat_r', role: 'relation' }} />)
    expect(await screen.findByText(zh['delete.used'])).toBeTruthy()
    expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual(['第2章', '第3章', '第5章'])
    unmount()
    const idea = render(<DeleteNote {...p} card={{ id: 'c2' }} category={{ id: 'cat_c', role: 'character' }} />)
    expect(await screen.findByText(zh['delete.idea'])).toBeTruthy()
    idea.unmount()
    const { container } = render(<DeleteNote {...p} card={{ id: 'x' }} category={{ id: 'cat_p', role: 'principle' }} />)
    expect(container.innerHTML).toBe('')
  })
})
