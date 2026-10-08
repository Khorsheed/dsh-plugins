// @vitest-environment jsdom
/**
 * 规划, the novel's lead face: the empty invitation, the adopted one page
 * with the protagonist's card fields, a proposal the person adopts, the
 * volumes with their chapters, sketches and fold, and the core suspenses
 * with the clues the text laid. Also the plan card's word budget.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { NovelRemote, NovelSurfaceProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { FaceLabel } from '../src/client/NovelFaces.tsx'
import { PlanBlock } from '../src/client/PlanBlock.tsx'
import { PlanView } from '../src/client/PlanView.tsx'
import { emptyOutline, NOVEL_GENRE_ID, type ChapterRecord, type NovelOutlineResult, type OutlineDoc } from '../src/types.ts'

afterEach(cleanup)

const CANVAS_ID = 'canvas_novel'
const SESSION = 's-1' as SessionId
const NOW = '2026-10-08T08:00:00.000Z'

const t = ((key: keyof typeof zh, params?: Record<string, string | number>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match))) as NovelSurfaceProps['t']

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })

function chapter(n: number, overrides: Partial<ChapterRecord> = {}): ChapterRecord {
  return { n, seq: n, title: `第${n}章标题`, file: `第${n}章.md`, phase: 'extracted', sessionIds: [], createdAt: NOW, updatedAt: NOW, ...overrides }
}

const ADOPTED: OutlineDoc = {
  version: 1,
  revision: 2,
  sheet: {
    logline: '做梦者想弄清自己是不是活在真实世界里',
    conflict: '林眠要验证世界 ⟷ 制造者要他继续当样本',
    protagonist: 'c_hero',
    arc: '只信自己验证过的 → 把选择交还给别人',
    ending: '知道真相后仍选择醒来',
    length: { words: 300_000, volumes: 3, chapters: 100, perChapter: 3000 },
  },
  volumes: [
    { id: 'v1', title: '梦醒', chapters: 6, goal: '察觉世界的异常', landing: '第一次进入废域' },
    { id: 'v2', title: '废域', chapters: 20 },
  ],
  sketches: [{ n: 4, line: '回到现实，发现有人在看他' }],
  history: [{ revision: 1, at: NOW, summary: '改了一句话主线' }, { revision: 2, at: NOW, summary: '改了篇幅' }],
}

function outlineResult(outline: OutlineDoc, extra: Partial<NovelOutlineResult> = {}): NovelOutlineResult {
  return {
    ok: true,
    outline,
    hero: { cardId: 'c_hero', ref: 'c1', name: '林眠', identity: '夜班数据标注员', want: '弄清世界是不是真的', ambition: '过自己选的生活', values: '不替别人做选择' },
    chapters: [
      { chapter: chapter(1, { volume: 'v1', wordCount: 3120 }), phase: 'extracted' },
      { chapter: chapter(2, { volume: 'v1', wordCount: 2980 }), phase: 'reviewed' },
      { chapter: chapter(3, { volume: 'v1', plan: { summary: 's', beats: [], foreshadowOps: [], cast: [], words: 3000 } }), phase: 'planning' },
    ],
    cores: [{
      cardId: 'c_f1', ref: '#1', question: '废域居民是谁？', state: '已埋', starred: true, reveal: '卷二', revealVolume: 2,
      touches: [{ chapter: 1, kind: 'planted' }, { chapter: 2, kind: 'hinted', note: '不属于自己的记忆' }],
      line: '定在卷二揭晓，现在卷一：可以暗示，不能揭', nudge: false,
    }],
    ...extra,
  }
}

function surface(result: NovelOutlineResult) {
  const remote = {
    outline: vi.fn(() => ok(result)),
    decideOutline: vi.fn(() => ok({ ok: true })),
  } as unknown as NovelRemote & { outline: ReturnType<typeof vi.fn>; decideOutline: ReturnType<typeof vi.fn> }
  const navigate = { openCard: vi.fn(), openPage: vi.fn(), openManuscripts: vi.fn(), refresh: vi.fn() }
  const props = {
    canvasId: CANVAS_ID,
    board: { id: CANVAS_ID, genre: { id: NOVEL_GENRE_ID } },
    rev: 0,
    navigate,
    sessionId: SESSION,
    remote: () => remote,
    t,
  } satisfies NovelSurfaceProps
  return { props, remote, navigate }
}

describe('PlanView', () => {
  it('labels the lead face 规划', () => {
    const { props } = surface(outlineResult(ADOPTED))
    render(<>{FaceLabel({ ...props, face: 'plan', label: 'x' })}</>)
    expect(screen.getByText('规划')).toBeTruthy()
  })

  it('invites the first outline when there is none', async () => {
    const { props } = surface({ ok: true, outline: emptyOutline(), chapters: [], cores: [] })
    render(<PlanView {...props} />)
    await screen.findByText(zh['outline.empty'])
    expect(screen.getByText(zh['outline.noVolumes'])).toBeTruthy()
    expect(screen.getByText(zh['outline.coresEmpty'])).toBeTruthy()
  })

  it('shows the adopted page, the protagonist off their card, volumes and the core suspense', async () => {
    const { props, navigate } = surface(outlineResult(ADOPTED))
    render(<PlanView {...props} />)
    await screen.findByText('做梦者想弄清自己是不是活在真实世界里')
    expect(screen.getByText('已采用 · v2')).toBeTruthy()
    expect(screen.getByText('过自己选的生活')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '林眠' }))
    expect(navigate.openCard).toHaveBeenCalledWith('c_hero', '林眠')
    // Volume one: its three chapters, the sketch ahead, the fold, the landing.
    expect(screen.getByText('卷一 · 梦醒')).toBeTruthy()
    expect(screen.getByText('回到现实，发现有人在看他')).toBeTruthy()
    expect(screen.getByText('约 2 章，写到附近再细化')).toBeTruthy()
    expect(screen.getByText('第一次进入废域')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /第 3 章/ }))
    expect(navigate.openPage).toHaveBeenCalledWith('novel:chapter', '第3章标题', '3')
    // The core suspense: its reveal, the two clues, the pacing line; volume two names it.
    expect(screen.getByText('揭晓：卷二')).toBeTruthy()
    expect(screen.getByText('暗示：不属于自己的记忆')).toBeTruthy()
    expect(screen.getByText('定在卷二揭晓，现在卷一：可以暗示，不能揭')).toBeTruthy()
    expect(screen.getByText('#1', { selector: 'span' })).toBeTruthy()
  })

  it('adopts a proposal through the person\'s gesture', async () => {
    const pending = { ...ADOPTED, proposal: { sheet: { ending: '知道真相后仍选择醒来，把选择权还给废域居民' }, rationale: '和主题更贴', at: NOW } }
    const { props, remote, navigate } = surface(outlineResult(pending))
    render(<PlanView {...props} />)
    const block = (await screen.findByText(zh['outline.proposal'])).parentElement!
    expect(within(block).getByText('知道真相后仍选择醒来，把选择权还给废域居民')).toBeTruthy()
    expect(within(block).getByText('理由：和主题更贴')).toBeTruthy()
    fireEvent.click(within(block).getByRole('button', { name: zh['outline.adopt'] }))
    await waitFor(() => { expect(remote.decideOutline).toHaveBeenCalledWith(SESSION, { canvasId: CANVAS_ID, action: 'accept' }) })
    await waitFor(() => { expect(navigate.refresh).toHaveBeenCalled() })
  })
})

describe('PlanBlock word budget', () => {
  const plan = (beats: number) => ({ summary: '梗概', beats: Array.from({ length: beats }, (_, i) => ({ text: `第${i + 1}拍` })), foreshadowOps: [], cast: [], words: 3000 })

  it('shows the target and the room, and warns past it', () => {
    const fits = chapter(4, { phase: 'planning', plan: plan(4) })
    const { rerender } = render(<PlanBlock chapter={fits} phase="planning" names={{}} words={3000} canConfirm busy={false} onConfirm={() => {}} t={t} />)
    expect(screen.getByText('目标 3,000 字')).toBeTruthy()
    expect(screen.getByText('按字数建议 3–4 拍')).toBeTruthy()
    const over = chapter(4, { phase: 'planning', plan: plan(7) })
    rerender(<PlanBlock chapter={over} phase="planning" names={{}} words={3000} canConfirm busy={false} onConfirm={() => {}} t={t} />)
    expect(screen.getByText('走向 7 拍，按 3,000 字建议至多 4 拍')).toBeTruthy()
  })
})
