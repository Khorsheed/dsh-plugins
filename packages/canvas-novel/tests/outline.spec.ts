/**
 * 规划: the outline (one page + volumes) as the model proposes it and the
 * person adopts it, chapters filed under volumes, the plan's word budget,
 * and core suspenses — foreshadows set to reveal in a volume, paced by
 * volume instead of by chapters asleep.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { renderPlanBrief } from '../src/brief.ts'
import { assignVolumeIds, NovelService } from '../src/store.ts'
import { novelToolDefinitions } from '../src/tools.ts'
import {
  capacityOf, coreSuspenseNudge, isOverdue, parseReveal, parseVolumeToken, volumeNumeral,
  type ChapterRecord, type ForeshadowView, type OutlineVolume,
} from '../src/types.ts'
import { provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { CARD, DREAM, seedDreamKeeper } from './seed-dream.ts'

const SESSION = { id: 's-outline' } as unknown as Session

async function bench() {
  const fs = new FakeFs()
  seedDreamKeeper(fs)
  const ctx = new Context()
  ctx.provide('fs', fs as never)
  const canvas = provideCanvas(ctx)
  const store = new NovelService(ctx, { stateRoot: DREAM.stateRoot })
  canvas.bind('s-outline', DREAM.workId)
  const [read, write] = novelToolDefinitions(store)
  const call = async (tool: typeof read, args: Record<string, unknown>): Promise<string> =>
    String(await tool!.execute(args as never, { agent: { session: SESSION, sessionId: 's-outline' } } as never))
  return { store, read: (args: Record<string, unknown>) => call(read, args), write: (args: Record<string, unknown>) => call(write, args) }
}

const VOLUMES: OutlineVolume[] = [
  { id: 'v1', title: '入梦', chapters: 6, goal: '赵启明察觉监护所的异常' },
  { id: 'v2', title: '门后', chapters: 10, landing: '推开那扇门' },
  { id: 'v3', title: '真名', chapters: 10 },
]

function chapter(n: number, volume: string | undefined, phase: ChapterRecord['phase'] = 'extracted'): ChapterRecord {
  return { n, seq: n, title: `第${n}章`, file: `第${n}章.md`, phase, ...(volume === undefined ? {} : { volume }), sessionIds: [], createdAt: '', updatedAt: '' }
}

function foreshadow(extra: Partial<ForeshadowView>): ForeshadowView {
  return { cardId: 'c_f', ref: '#1', question: '废域居民是谁', state: '已埋', starred: false, cardStatus: 'kept', ...extra }
}

describe('reveal timing and volumes', () => {
  it('reads 揭晓时机 the way people type it', () => {
    expect(parseReveal('本章内')).toEqual({ kind: 'chapter' })
    expect(parseReveal('卷三')).toEqual({ kind: 'volume', index: 3 })
    expect(parseReveal('第 12 卷')).toEqual({ kind: 'volume', index: 12 })
    expect(parseReveal('卷十二揭晓')).toEqual({ kind: 'volume', index: 12 })
    expect(parseReveal('终局')).toEqual({ kind: 'final' })
    expect(parseReveal('以后再说')).toBeUndefined()
    expect(volumeNumeral(3)).toBe('三')
    expect(volumeNumeral(12)).toBe('十二')
    expect(volumeNumeral(20)).toBe('二十')
    expect(parseVolumeToken('卷二', VOLUMES)).toBe('v2')
    expect(parseVolumeToken('真名', VOLUMES)).toBe('v3')
    expect(parseVolumeToken('3', VOLUMES)).toBe('v3')
    expect(parseVolumeToken('卷九', VOLUMES)).toBeUndefined()
  })

  it('keeps volume ids across a renamed list: a matching title keeps its id, new ones take fresh ids', () => {
    const next = assignVolumeIds(
      [{ id: '', title: '入梦' }, { id: '', title: '迷宫' }, { id: 'v2', title: '门后（改）' }],
      VOLUMES,
    )
    expect(next.map(volume => volume.id)).toEqual(['v1', 'v4', 'v2'])
  })

  it('never flags a core suspense by chapters asleep; a 本章内 hook is flagged at two', () => {
    expect(isOverdue({ slept: 9, reveal: { kind: 'final' } })).toBe(false)
    expect(isOverdue({ slept: 9, reveal: { kind: 'volume', index: 3 } })).toBe(false)
    expect(isOverdue({ slept: 2, reveal: { kind: 'chapter' } })).toBe(true)
    expect(isOverdue({ slept: 6 })).toBe(true)
  })

  it('paces a core suspense by volume: hint before, reveal in, soft nudges near the edges', () => {
    const early = [chapter(1, 'v1'), chapter(2, 'v1')]
    expect(coreSuspenseNudge(foreshadow({ reveal: { kind: 'volume', index: 3 } }), VOLUMES, early))
      .toEqual({ text: '定在卷三揭晓，现在卷一：可以暗示，不能揭', nudge: false })
    // Near the end of volume one and not touched in it.
    const late = [1, 2, 3, 4, 5].map(n => chapter(n, 'v1'))
    expect(coreSuspenseNudge(foreshadow({ reveal: { kind: 'final' }, mentionChapters: [] }), VOLUMES, late)?.nudge).toBe(true)
    expect(coreSuspenseNudge(foreshadow({ reveal: { kind: 'final' }, mentionChapters: [4] }), VOLUMES, late)?.nudge).toBe(false)
    // In its volume with only one touch so far.
    const inThree = [chapter(1, 'v1'), chapter(2, 'v3')]
    expect(coreSuspenseNudge(foreshadow({ reveal: { kind: 'final' }, mentionChapters: [1] }), VOLUMES, inThree)?.text).toContain('本卷揭晓；揭晓前只碰过 1 次')
    // A hook, or a resolved one, has no pacing line.
    expect(coreSuspenseNudge(foreshadow({ reveal: { kind: 'chapter' } }), VOLUMES, early)).toBeUndefined()
    expect(coreSuspenseNudge(foreshadow({ reveal: { kind: 'final' }, state: '已揭晓' }), VOLUMES, early)).toBeUndefined()
  })

  it('sizes a chapter by its words', () => {
    expect(capacityOf(3000)).toEqual({ beats: [3, 4], ops: 2, cast: 4 })
    expect(capacityOf(6000).beats).toEqual([6, 8])
  })
})

describe('the outline through the tools', () => {
  it('proposes, waits for adoption, then files chapters by volume and budgets the plan', async () => {
    const { store, read, write } = await bench()
    expect(await read({ what: 'outline' })).toContain('还没有采用过的大纲')
    // The protagonist must be a character card.
    expect(await write({ what: 'outline', sheet: { protagonist: '无名氏' } })).toContain('主角要是一张人物卡')

    const proposed = await write({
      what: 'outline',
      sheet: { logline: '监护者要守住梦境，却发现自己就是梦主的锚', conflict: '赵启明要查清真相 ⟷ 监护所要他守规矩', protagonist: '赵启明', length: { words: '30万', volumes: 3, perChapter: 3000 } },
      volumes: [{ title: '入梦', chapters: 6, goal: '察觉异常' }, { title: '门后', chapters: 10, landing: '推开那扇门' }, { title: '真名', chapters: 10 }],
      rationale: '先把主线立住',
    })
    expect(proposed).toContain('已提交大纲提议')
    expect(await read({ what: 'outline' })).toContain('等用户采用的提议')
    // Nothing counts before adoption: the plan brief carries no outline yet.
    expect((await read({ what: 'brief', for: 'plan' }))).not.toContain('## 一页纸')

    expect((await store.decideOutline({ workId: DREAM.workId, action: 'accept' }, SESSION)).ok).toBe(true)
    const outline = await read({ what: 'outline' })
    expect(outline).toContain('# 一页纸（v1）')
    expect(outline).toContain('主角：赵启明')
    expect(outline).toContain('篇幅：目标 300000 字 · 3 卷 · 单章 3000 字')
    expect(outline).toContain('卷二 门后（v2 · 约 10 章）')
    expect(outline).not.toContain('等用户采用')
    expect((await store.decideOutline({ workId: DREAM.workId, action: 'accept' }, SESSION)).error).toBe('no-proposal')

    // A core suspense: set 门缝 to reveal in volume three.
    expect((await store.writeCard({ workId: DREAM.workId, role: 'foreshadow', id: CARD.doorGap, fields: { reveal: '卷三' } }, SESSION)).ok).toBe(true)

    // A new chapter files under the volume asked for; an unknown one is refused.
    expect(await write({ what: 'chapter', title: '无此卷', volume: '卷九' })).toContain('大纲里没有「卷九」这一卷')
    const answer = await write({
      what: 'chapter', title: '迷宫', volume: '卷二',
      plan: {
        summary: '赵启明推门进入迷宫。',
        beats: [1, 2, 3, 4, 5, 6, 7].map(i => ({ text: `第${i}拍` })),
        foreshadowOps: [{ op: '揭晓', id: CARD.doorGap, note: '门后是谁' }],
      },
    })
    expect(answer).toContain('卷二')
    expect(answer).toContain('目标 3000 字')
    expect(answer).toContain('走向 7 拍，按 3000 字建议至多 4 拍')
    expect(answer).toMatch(/揭晓 #\d+ 提前了：它定在卷三揭晓，这章在卷二/)
    const chapters = await store.listChapters({ workId: DREAM.workId })
    expect(chapters.at(-1)?.chapter.volume).toBe('v2')

    // The plan brief leads with the budget and the outline, and paces the core suspense.
    const brief = await read({ what: 'brief', for: 'plan', chapter: chapters.at(-1)!.chapter.n })
    expect(brief).toContain('目标字数 3000')
    expect(brief).toContain('一句话主线：监护者要守住梦境')
    expect(brief).toContain('## 本卷：卷二 · 门后')
    expect(brief).toContain('定在卷三揭晓，现在卷二：可以暗示，不能揭')
  })

  it('renders the plan brief exactly as before for a work without an outline', async () => {
    const { store } = await bench()
    const gathered = await store.gatherBrief({ workId: DREAM.workId })
    const text = renderPlanBrief(gathered.data!)
    expect(text).not.toContain('## 一页纸')
    expect(text).not.toContain('## 篇幅')
  })
})
