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
import { STORY_LOG_PAGE, type NovelRemote, type NovelSurfaceProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { CardScopes, ChaptersBadge, DeleteNote, FaceLabel, storyUsage } from '../src/client/NovelFaces.tsx'
import { chapterHeading } from '../src/client/PendingList.tsx'
import { PlanBlock } from '../src/client/PlanBlock.tsx'
import { StoryLogPage } from '../src/client/StoryLogPage.tsx'
import { TimelineView } from '../src/client/TimelineView.tsx'
import { IdeasView } from '../src/client/IdeasView.tsx'
import { emptyOutline, NOVEL_GENRE_ID, type ChapterPlan, type ChapterRecord, type EffectiveChapterPhase, type NovelTimelineResult, type PendingView, type StoryLogResult } from '../src/types.ts'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

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
    recentUpdates: vi.fn(() => ok({ ok: true, cards: {} })),
    outline: vi.fn(() => ok({ ok: true, outline: emptyOutline(), chapters: [], cores: [] })),
    worldMap: vi.fn(() => ok({ ok: true, shelves: [], principles: [], unorganized: 0 })),
    timeline: vi.fn(() => ok(TIMELINE)),
    setRecallPins: vi.fn(() => ok({ ok: true })),
    ideas: vi.fn(() => ok({ ok: true, ideas: [], events: [] })),
    changeIdea: vi.fn(() => ok({ ok: true })),
    editChapterBody: vi.fn(() => ok({ ok: true, changed: 3, kept: true })),
    newOwnChapter: vi.fn(() => ok({ ok: true, n: 9 })),
  } as unknown as NovelRemote & Record<string, ReturnType<typeof vi.fn>>
  return remote
}

const TIMELINE: NovelTimelineResult = {
  ok: true, chapter: 6, past: [], names: { c1: '赵启明' }, candidates: ['e1'],
  future: [
    { id: 'e1', title: '赵启明推开门', status: 'preset', source: '打算', who: ['c1'], ideas: 0, tier: 'near', reason: '离时间窗口还有约 1 章', tension: 0.8, V: 0.8, E: 1, D: 1, Z: 0, S: 0 },
    { id: 'e2', title: '前任监护者现身', status: 'preset', source: '预设', ideas: 0, tier: 'hold', reason: '还缺：找到档案', tension: 0, V: 0.9, E: 0, Z: 0, S: 0 },
  ],
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

/** An outside ask for the 章节 face (each one a fresh number: the face answers an ask once per page). */
let asks = 0
function ask(item: string, focus?: string): { item: string; focus?: string; n: number } {
  asks += 1
  return { item, ...(focus === undefined ? {} : { focus }), n: asks }
}

describe('the 章节 face asked for a chapter', () => {
  function renderPage(remote: NovelRemote, sessionId: SessionId | null = SESSION) {
    const p = props(remote, NOVEL_GENRE_ID, sessionId)
    render(<ChapterBook {...p} target={ask('1')} />)
    return p
  }

  it('a reconciled chapter is done: no 审过, the next step points at 设定 · 最近更新', async () => {
    renderPage(fakeRemote({ items: [], phase: 'extracted' }))
    expect(await screen.findByText(zh['chapter.gate.ready'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: /审过/ })).toBeNull()
    expect(screen.getByText('他推开门。')).toBeTruthy()
  })

  it('pending items left from before still show, and hold nothing', async () => {
    renderPage(fakeRemote({ items: [item('p1', { kind: 'experience', payload: { characterId: 'c_a', entry: '推门' } })], phase: 'extracted' }))
    expect(await screen.findByText(zh['chapter.gate.pending'].replace('{count}', '1'))).toBeTruthy()
    expect(screen.getByText(zh['chapter.pendingHeading'])).toBeTruthy()
  })

  it('says how to reconcile before the chapter is reconciled', async () => {
    renderPage(fakeRemote({ items: [], phase: 'writing' }))
    expect(await screen.findByText(zh['chapter.gate.writing'].replace('{n}', '1'))).toBeTruthy()
  })

  it('a text changed since its 对账 says how to reconcile again, at the top only', async () => {
    renderPage(fakeRemote({ items: [], phase: 'stale' }))
    expect(await screen.findByText(zh['chapter.gate.stale'].replace('{n}', '1'))).toBeTruthy()
    expect(screen.getByText(zh['phase.stale'])).toBeTruthy()
  })

  it('a chapter closed under the old 审过 reads as reconciled', async () => {
    renderPage(fakeRemote({ items: [], phase: 'reviewed' }))
    expect(await screen.findByText(zh['chapter.gate.ready'])).toBeTruthy()
    expect(screen.getAllByText(zh['phase.reviewed']).length).toBeGreaterThan(0)
  })

  it('a read-only canvas says so', async () => {
    renderPage(fakeRemote({ items: [], phase: 'extracted' }), null)
    expect(await screen.findByText(zh['chapter.gate.readOnly'])).toBeTruthy()
  })
})

describe('the 章节 face asked for a chapter\'s plan', () => {
  it('opens the plan block even on a written chapter, where it would fold under the text', async () => {
    const remote = fakeRemote({ items: [], rows: [{ chapter: chapter(1, '门与假门', { plan: PLAN, planConfirmedAt: NOW }), phase: 'writing', body: '他推开门。' }] })
    render(<ChapterBook {...props(remote)} target={ask('1', 'plan')} />)
    expect(await screen.findByText(PLAN.summary)).toBeTruthy()
    cleanup()
    render(<ChapterBook {...props(remote)} target={ask('1', 'body')} />)
    await screen.findByText('他推开门。')
    expect(screen.queryByText(PLAN.summary)).toBeNull()
  })
})

describe('ChapterReader', () => {
  const rows = (): Row[] => [
    { chapter: chapter(1, '第1章 门与假门'), phase: 'reviewed', body: '他推开门。' },
    { chapter: chapter(2, '蓝叶'), phase: 'writing', body: '叶子亮了。\n第二段。' },
  ]

  it('pages forward and back, glimpses the next chapter, and 目录 leads to the book', async () => {
    const remote = fakeRemote({ items: [], rows: rows() })
    const p = props(remote)
    render(<ChapterBook {...p} target={ask('1')} />)
    expect(await screen.findByRole('heading', { name: '门与假门' })).toBeTruthy()
    expect(screen.getByText('1 / 2')).toBeTruthy()
    expect(await screen.findByText('叶子亮了。第二段。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['reader.next'] }))
    expect(await screen.findByRole('heading', { name: '蓝叶' })).toBeTruthy()
    expect(await screen.findByText(zh['reader.last'])).toBeTruthy()
    expect((screen.getByRole('button', { name: zh['reader.next'] }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: zh['reader.contents'] }))
    expect(await screen.findByRole('button', { name: zh['toc.continue'] })).toBeTruthy()
  })

  it('answers each ask once: a remount with the same ask stays on the contents', async () => {
    const remote = fakeRemote({ items: [], rows: rows() })
    const target = ask('2')
    const { unmount } = render(<ChapterBook {...props(remote)} target={target} />)
    expect(await screen.findByRole('heading', { name: '蓝叶' })).toBeTruthy()
    unmount()
    render(<ChapterBook {...props(remote)} target={target} />)
    expect(await screen.findByRole('button', { name: zh['toc.continue'] })).toBeTruthy()
  })
})

describe('PlanBlock', () => {
  function renderChapter(row: Row, sendToConversation?: ReturnType<typeof vi.fn>) {
    const remote = fakeRemote({ items: [], rows: [row] })
    render(<ChapterBook {...props(remote)} {...(sendToConversation === undefined ? {} : { sendToConversation })} target={ask('1')} />)
    return remote
  }

  it('leads while planning: open, names resolved, and 按计划开写 confirms then sends the go-ahead', async () => {
    const send = vi.fn(() => 'sent' as const)
    const remote = renderChapter({ chapter: chapter(1, '门', { phase: 'planning', plan: PLAN }), phase: 'planning' }, send)
    expect(await screen.findByText(PLAN.summary)).toBeTruthy()
    expect(screen.getByText('数钟声找到门缝')).toBeTruthy()
    expect(screen.getByText('#12 门缝里的东西')).toBeTruthy()
    expect(screen.getByText('门缝第一次被找到')).toBeTruthy()
    expect(screen.getByText(zh['plan.pov'])).toBeTruthy()
    expect(screen.getByText(zh['chapter.noBodyConfirm'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['chapter.confirmPlan'] }))
    await waitFor(() => { expect(remote.confirmPlan).toHaveBeenCalledWith(SESSION, { canvasId: CANVAS_ID, n: 1 }) })
    await waitFor(() => { expect(send).toHaveBeenCalledWith(SESSION, '第 1 章计划确认，按计划开写。') })
  })

  it('folds once there is text; after extraction it says what the text carried, ✗ where it did not', async () => {
    renderChapter({
      chapter: chapter(1, '门', { plan: PLAN, planConfirmedAt: NOW, delivery: { beats: [true, false], ops: [false] } }),
      phase: 'extracted',
      body: '他推开门。',
    })
    const head = await screen.findByRole('button', { name: /情节 1\/2 · 伏笔 0\/1/ })
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
      { chapter: chapter(2, '蓝叶', { wordCount: 5000 }), phase: 'stale', body: '叶子。' },
      { chapter: chapter(3, '门后', { phase: 'planning' }), phase: 'planning' },
    ]
    render(<ChapterBook {...props(fakeRemote({ items: [], rows }))} />)
    expect(await screen.findByText('共 3 章 · 1.1 万 字 · 1 章已对账')).toBeTruthy()
    expect(screen.getByRole('button', { name: /第 1–3 章/ }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /^待处理/ }))
    expect(screen.queryByRole('button', { name: /入职/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /蓝叶/ }))
    expect(await screen.findByRole('heading', { name: '蓝叶' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['reader.back'] }))
    expect(await screen.findByRole('button', { name: zh['toc.continue'] })).toBeTruthy()
  })

  it('an empty work says how chapters arrive', async () => {
    render(<ChapterBook {...props(fakeRemote({ items: [], rows: [] }))} />)
    expect(await screen.findByText(zh['toc.empty'])).toBeTruthy()
  })
})

describe('PlanBlock on a written chapter re-planned', () => {
  it('leads with the plan and offers the confirm while it waits, whatever the phase', () => {
    const waiting = chapter(2, '光', { plan: PLAN })
    render(<PlanBlock chapter={waiting} phase="writing" names={{}} canConfirm busy={false} onConfirm={() => {}} t={t} />)
    expect(screen.getByRole('button', { name: zh['chapter.confirmPlan'] })).toBeTruthy()
  })

  it('edits the plan as its lines, and saving hands the text over', async () => {
    const waiting = chapter(2, '光', { plan: PLAN })
    const onSave = vi.fn(async () => null)
    render(<PlanBlock chapter={waiting} phase="planning" names={{}} canConfirm busy={false} onConfirm={() => {}} planText={'梗概：原来的'} onSave={onSave} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: zh['plan.edit'] }))
    const box = screen.getByRole('textbox', { name: zh['plan.edit'] }) as HTMLTextAreaElement
    expect(box.value).toBe('梗概：原来的')
    fireEvent.change(box, { target: { value: '梗概：改了' } })
    fireEvent.click(screen.getByRole('button', { name: zh['plan.saveConfirm'] }))
    expect(onSave).toHaveBeenCalledWith('梗概：改了')
    await waitFor(() => { expect(screen.queryByRole('textbox')).toBeNull() })
  })

  it('keeps the edit box open with the reason when saving fails', async () => {
    const waiting = chapter(2, '光', { plan: PLAN })
    render(<PlanBlock chapter={waiting} phase="planning" names={{}} canConfirm busy={false} onConfirm={() => {}} planText={'梗概：x'} onSave={async () => '对不上'} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: zh['plan.edit'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['plan.saveConfirm'] }))
    expect(await screen.findByText('对不上')).toBeTruthy()
    expect(screen.getByRole('textbox')).toBeTruthy()
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
    expect(p.navigate.openManuscripts).toHaveBeenCalledWith('3')
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
    fireEvent.click(await screen.findByRole('tab', { name: /设定/ }))
    expect(screen.getByText('还没有在正文里出现过的设定')).toBeTruthy()
    expect(screen.getByText('体系、地点、势力、物种与道具在对账时被正文用到后出现在这里。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '图例' })).toBeNull()
  })

  it('a chapter number opens that chapter in the 章节 face; 图例 folds open with the hollow rule', async () => {
    const p = page(storyLogRemote())
    render(<StoryLogPage {...p} />)
    fireEvent.click(await screen.findByRole('button', { name: /^1\D*已对账$/ }))
    expect(p.navigate.openManuscripts).toHaveBeenCalledWith('1')
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

  it('章节 labels the face and its badge counts the chapters to reconcile (nothing else waits); another genre keeps the canvas label', async () => {
    render(<FaceLabel {...props(remote())} face="manuscripts" label="成稿" />)
    expect(screen.getByText(zh['face.chapters'])).toBeTruthy()
    cleanup()
    // The count is the tab's badge, not part of the label (outside the underline).
    render(<ChaptersBadge {...props(remote())} />)
    expect(await screen.findByText('1')).toBeTruthy()
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

  it('设定 scopes: 最近更新 lists the cards the newest 对账 touched, each with its line', async () => {
    const onScopes = vi.fn()
    const p = props({
      ...remote(),
      recentUpdates: vi.fn(() => ok({ ok: true, chapter: 5, title: '门后', at: 't', cards: {
        f12: [{ kind: 'mention', mention: 'advanced', text: '门缝又宽了一指' }],
        c2: [{ kind: 'create', text: '门后传来一个女人的声音' }, { kind: 'experience', text: '在门后哼歌' }],
        gone: [{ kind: 'create' }],
      } })),
    } as unknown as NovelRemote)
    const board = {
      ...p.board,
      cards: [{ id: 'f12', kind: 'cat_f' }, { id: 'c2', kind: 'cat_c' }, { id: 'p1', kind: 'cat_p' }],
      categories: [{ id: 'cat_f', role: 'foreshadow' }, { id: 'cat_c', role: 'character' }, { id: 'cat_p', role: 'principle' }],
    }
    render(<CardScopes {...p} board={board} onScopes={onScopes} />)
    await waitFor(() => { expect(onScopes.mock.lastCall?.[0]).toHaveLength(3) })
    expect(onScopes.mock.lastCall![0][2]).toEqual({
      id: 'recent', label: '最近更新 · 第 5 章', cardIds: ['f12', 'c2'], archiveFirst: true,
      notes: {
        f12: { label: zh['pending.mention.advanced'], text: '门缝又宽了一指' },
        c2: { label: '新建 · 经历', text: '门后传来一个女人的声音' },
      },
    })
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

const FIVE: Row[] = [1, 2, 3, 4, 5].map(n => ({ chapter: chapter(n, `第${n}章`), phase: 'extracted' as const, body: '他推开门。' }))

describe('the timeline, ideas, candidates and editing (2026-11-01)', () => {
  it('draws the timeline by priority with the formula, and the chapter view switches to the table', async () => {
    const remote = fakeRemote({ items: [], rows: FIVE })
    render(<TimelineView {...props(remote)} />)
    expect(await screen.findByText('赵启明推开门')).toBeTruthy()
    expect(screen.getByText('离时间窗口还有约 1 章')).toBeTruthy()
    expect(screen.getByText(zh['tl.ruleHead'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /赵启明推开门/ }))
    expect(await screen.findByText(zh['tl.V'])).toBeTruthy()
    remote.storyLog = vi.fn(() => ok({ ok: true, chapters: [], foreshadows: [], characters: [], relations: [], world: [] }))
    fireEvent.click(screen.getByRole('button', { name: zh['tl.byChapter'] }))
    await waitFor(() => { expect(remote.storyLog).toHaveBeenCalled() })
  })

  it("lists the next chapter's candidates in 章节 and saves 优先推进 / 本章屏蔽 as pins", async () => {
    const remote = fakeRemote({ items: [], rows: FIVE })
    render(<ChapterBook {...props(remote)} />)
    fireEvent.click(await screen.findByRole('button', { name: /下一章候选/ }))
    fireEvent.click(screen.getAllByRole('button', { name: zh['cand.block'] })[0]!)
    await waitFor(() => { expect(remote.setRecallPins).toHaveBeenCalledWith(SESSION, { canvasId: CANVAS_ID, chapter: 6, prefer: [], block: ['e1'] }) })
  })

  it('switches modes in the top bar, previews the draft, and only discards it on cancel', async () => {
    const remote = fakeRemote({ items: [], rows: FIVE })
    render(<ChapterBook {...props(remote)} target={ask('1')} />)
    const preview = await screen.findByRole('tab', { name: zh['edit.preview'] })
    const edit = screen.getByRole('tab', { name: zh['edit.mode'] })
    expect(preview.getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('button', { name: zh['edit.open'] })).toBeNull()
    expect(document.body.textContent).not.toContain('✎')
    fireEvent.click(edit)
    const box = screen.getByRole('textbox', { name: zh['edit.open'] }) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '新的正文。' } })
    fireEvent.click(preview)
    expect(await screen.findByText('新的正文。')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: zh['edit.open'] })).toBeNull()
    fireEvent.click(edit)
    expect((screen.getByRole('textbox', { name: zh['edit.open'] }) as HTMLTextAreaElement).value).toBe('新的正文。')
    fireEvent.click(screen.getByRole('button', { name: zh['edit.cancel'] }))
    expect(screen.queryByText('新的正文。')).toBeNull()
    fireEvent.click(edit)
    expect((screen.getByRole('textbox', { name: zh['edit.open'] }) as HTMLTextAreaElement).value).toBe('他推开门。')
  })

  it('saves from the editor, returns to preview, and says the chapter stayed reconciled', async () => {
    const remote = fakeRemote({ items: [], rows: FIVE })
    render(<ChapterBook {...props(remote)} target={ask('1')} />)
    fireEvent.click(await screen.findByRole('tab', { name: zh['edit.mode'] }))
    const box = screen.getByRole('textbox', { name: zh['edit.open'] })
    fireEvent.change(box, { target: { value: '新的正文。' } })
    fireEvent.click(screen.getByRole('button', { name: zh['edit.save'] }))
    await waitFor(() => { expect(remote.editChapterBody).toHaveBeenCalledWith(SESSION, expect.objectContaining({ canvasId: CANVAS_ID, n: 1, text: '新的正文。' })) })
    expect(await screen.findByText(zh['edit.kept'].replace('{count}', '3'))).toBeTruthy()
    expect(screen.getByRole('tab', { name: zh['edit.preview'] }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('textbox', { name: zh['edit.open'] })).toBeNull()
  })

  it('does not offer an edit mode on a read-only canvas', async () => {
    const remote = fakeRemote({ items: [], rows: FIVE })
    render(<ChapterBook {...props(remote, NOVEL_GENRE_ID, null)} target={ask('1')} />)
    expect(await screen.findByRole('heading', { name: '第1章' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: zh['edit.mode'] })).toBeNull()
    expect(screen.queryByRole('tabpanel')).toBeNull()
    expect(screen.queryByRole('textbox', { name: zh['edit.open'] })).toBeNull()
  })

  it('opens a new own chapter directly in edit mode', async () => {
    const own: Row = { chapter: chapter(9, '我自己的章节', { byUser: true }), phase: 'writing', body: '' }
    const remote = fakeRemote({ items: [], rows: [...FIVE, own] })
    render(<ChapterBook {...props(remote)} />)
    fireEvent.click(await screen.findByRole('button', { name: zh['toc.newOwn'] }))
    fireEvent.change(screen.getByRole('textbox', { name: zh['toc.newOwnTitle'] }), { target: { value: '我自己的章节' } })
    fireEvent.click(screen.getByRole('button', { name: zh['toc.newOwnGo'] }))
    expect(await screen.findByRole('textbox', { name: zh['edit.open'] })).toBeTruthy()
    expect(screen.getByRole('tab', { name: zh['edit.mode'] }).getAttribute('aria-selected')).toBe('true')
  })

  it('records an idea without asking the agent, sends chosen ideas to the conversation, and binds one by the names it mentions', async () => {
    const remote = fakeRemote({ items: [], rows: FIVE })
    remote.ideas.mockImplementation(() => ok({
      ok: true,
      ideas: [{ id: 'i1', text: '赵启明把手按在门上', createdAt: NOW }],
      events: [{ id: 'e1', title: '赵启明推开门', tier: 'near', mentions: ['赵启明'] }, { id: 'e2', title: '别的事', tier: 'ready', mentions: [] }],
    }))
    const send = vi.fn(() => 'sent' as const)
    render(<IdeasView {...props(remote)} sendToConversation={send} />)
    expect(await screen.findByText('赵启明把手按在门上')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['ideas.toTimeline'] }))
    expect(send).toHaveBeenCalledWith(SESSION, expect.stringContaining('[i1]'))
    fireEvent.click(screen.getByRole('button', { name: zh['ideas.bindByHand'] }))
    fireEvent.click(screen.getByRole('button', { name: '赵启明推开门' }))
    await waitFor(() => { expect(remote.changeIdea).toHaveBeenCalledWith(SESSION, { canvasId: CANVAS_ID, id: 'i1', eventId: 'e1' }) })
    fireEvent.click(screen.getByRole('button', { name: zh['ideas.new'] }))
    fireEvent.change(screen.getByRole('textbox', { name: zh['ideas.new'] }), { target: { value: '一句对白' } })
    fireEvent.click(screen.getByRole('button', { name: zh['ideas.save'] }))
    await waitFor(() => { expect(remote.changeIdea).toHaveBeenCalledWith(SESSION, { canvasId: CANVAS_ID, add: '一句对白' }) })
  })
})
