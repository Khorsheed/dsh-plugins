/**
 * The text-only forms (a provider that delivers only flat strings): an
 * outline and a chapter plan written as lines in `content`, and a relation
 * card whose 双方 arrives as one string naming characters with asides.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { NovelService, refTokensOf } from '../src/store.ts'
import { changedPlanFields, isPlanText, outlineFromText, planFromText, planToText } from '../src/text-forms.ts'
import { novelToolDefinitions } from '../src/tools.ts'
import { normalizePlan } from '../src/types.ts'
import { provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { DREAM, seedDreamKeeper } from './seed-dream.ts'

const SESSION = { id: 's-text' } as unknown as Session

async function bench() {
  const fs = new FakeFs()
  seedDreamKeeper(fs)
  const ctx = new Context()
  ctx.provide('fs', fs as never)
  const canvas = provideCanvas(ctx)
  const store = new NovelService(ctx, { stateRoot: DREAM.stateRoot })
  canvas.bind('s-text', DREAM.workId)
  const [, write] = novelToolDefinitions(store)
  const call = async (args: Record<string, unknown>): Promise<string> =>
    String(await write!.execute(args as never, { agent: { session: SESSION, sessionId: 's-text' } } as never))
  return { store, write: call }
}

const OUTLINE = [
  '一句话主线：做梦者想弄清自己是不是活在真实世界里',
  '核心冲突：江眠要验证世界 ⟷ 制造者要他继续当样本',
  '主角：赵启明',
  '成长弧线：只信自己验证过的 → 把选择交还给别人',
  '篇幅：30万字 / 3卷 / 约100章 / 单章3000字',
  '卷一：梦醒｜约12章｜要完成：察觉世界的异常｜卷末：第一次进入废域',
  '卷二：废域｜约20章｜见到第一个居民',
  '第7章：回到现实，发现有人在看他',
  '理由：先把主线立住',
].join('\n')

const PLAN = [
  '梗概：赵启明第一次主动入梦，遇见神灵。',
  '目标字数：3000',
  '走向：',
  '1. 入夜｜按上一章摸到的办法入梦',
  '2. 相遇｜神灵叫出他的名字（转折）',
  '3. 醒来｜手心里多了一片叶子（落点）',
  '伏笔：推进 #5：叶子发光；新埋：另一个做梦者是谁',
  '出场：',
  '- 赵启明（视角）：慌但好奇',
  '- 艾文：说话留半句',
  '章末钩子：叶子在白天也没有熄灭。',
].join('\n')

describe('text forms', () => {
  it('reads an outline written as lines', () => {
    expect(outlineFromText(OUTLINE)).toEqual({
      sheet: {
        logline: '做梦者想弄清自己是不是活在真实世界里',
        conflict: '江眠要验证世界 ⟷ 制造者要他继续当样本',
        protagonist: '赵启明',
        arc: '只信自己验证过的 → 把选择交还给别人',
        length: { words: '30万', volumes: '3', chapters: '100', perChapter: '3000' },
      },
      volumes: [
        { title: '梦醒', chapters: '12', goal: '察觉世界的异常', landing: '第一次进入废域' },
        { title: '废域', chapters: '20', goal: '见到第一个居民' },
      ],
      sketches: [{ n: '7', line: '回到现实，发现有人在看他' }],
      rationale: '先把主线立住',
    })
  })

  it('reads a chapter plan written as lines, and tells it from a manuscript', () => {
    expect(isPlanText(PLAN)).toBe(true)
    expect(isPlanText('# 第三章\n他推开门。')).toBe(false)
    const plan = normalizePlan(planFromText(PLAN))!
    expect(plan.summary).toBe('赵启明第一次主动入梦，遇见神灵。')
    expect(plan.words).toBe(3000)
    expect(plan.beats).toEqual([
      { at: '入夜', text: '按上一章摸到的办法入梦' },
      { at: '相遇', text: '神灵叫出他的名字', mark: '转折' },
      { at: '醒来', text: '手心里多了一片叶子', mark: '落点' },
    ])
    expect(plan.foreshadowOps).toEqual([{ op: '推进', id: '#5', note: '叶子发光' }, { op: '新埋', question: '另一个做梦者是谁' }])
    expect(plan.cast).toEqual([{ who: '赵启明', role: '慌但好奇' }, { who: '艾文', role: '说话留半句' }])
    expect(plan.pov).toBe('赵启明')
    expect(plan.hook).toBe('叶子在白天也没有熄灭。')
  })

  it('lands an outline and a plan through novel_write with only flat strings', async () => {
    const { store, write } = await bench()
    expect(await write({ what: 'outline' })).toContain('改用纯文本')
    expect(await write({ what: 'outline', content: OUTLINE })).toContain('已提交大纲提议')
    const proposal = (await store.readOutline(DREAM.workId)).proposal!
    expect(proposal.sheet?.length).toEqual({ words: 300_000, volumes: 3, chapters: 100, perChapter: 3000 })
    expect(proposal.volumes?.map(volume => volume.title)).toEqual(['梦醒', '废域'])
    // 「第 N 章」 for the next N is a create, not a miss.
    const next = (await store.listChapters({ workId: DREAM.workId })).length + 1
    const answer = await write({ what: 'chapter', title: '入梦', chapter: next, content: PLAN.replace('#5', 'c_doorGap') })
    expect(answer).toContain('走向 3 拍')
    // The plan text is a plan, never a manuscript body.
    const chapters = await store.listChapters({ workId: DREAM.workId })
    expect(chapters.at(-1)?.phase).toBe('planning')
  })
})

describe('relation cards from one string', () => {
  it('splits 双方, matches names past their asides, and says what is wrong', async () => {
    expect(refTokensOf('c1，c2')).toEqual(['c1', 'c2'])
    expect(refTokensOf('江眠、许岩')).toEqual(['江眠', '许岩'])
    expect(refTokensOf('["c_a", "c_b"]')).toEqual(['c_a', 'c_b'])
    const { store } = await bench()
    const hero = await store.writeCard({ workId: DREAM.workId, role: 'character', fields: { name: '小满（提议名，可换）' } }, SESSION)
    expect(hero.ok).toBe(true)
    const made = await store.writeCard({ workId: DREAM.workId, role: 'relation', fields: { pair: '赵启明，小满', type: '友情' } }, SESSION)
    expect(made).toMatchObject({ ok: true })
    const lonely = await store.writeCard({ workId: DREAM.workId, role: 'relation', fields: { pair: '赵启明', type: '友情' } }, SESSION)
    expect(lonely.problem).toContain('双方要正好两张人物卡')
    const typeless = await store.writeCard({ workId: DREAM.workId, role: 'relation', fields: { pair: '艾文，小满', type: '死党' } }, SESSION)
    expect(typeless.problem).toContain('类型要从 爱情 / 亲情 / 友情')
  })
})

describe('confirming and editing a plan', () => {
  it('confirms through novel_write(what=confirm), and the body then lands', async () => {
    const { store, write } = await bench()
    const answer = await write({ what: 'chapter', title: '入梦', content: PLAN.replace('#5', 'c_doorGap') })
    expect(answer).toContain('novel_write(what=confirm')
    const n = (await store.listChapters({ workId: DREAM.workId })).at(-1)!.chapter.n
    expect(await write({ what: 'chapter', chapter: n, title: '入梦', content: '他推开门。' })).toContain(`novel_write(what=confirm, chapter=${n})`)
    expect(await write({ what: 'confirm', chapter: n })).toContain(`已确认第 ${n} 章的计划`)
    expect(await write({ what: 'confirm', chapter: 99 })).toBe('失败：没有第 99 章。')
  })

  it('saves the person\'s edit as the plan and confirms it in one gesture', async () => {
    const { store, write } = await bench()
    await write({ what: 'chapter', title: '入梦', content: PLAN.replace('#5', 'c_doorGap') })
    const n = (await store.listChapters({ workId: DREAM.workId })).at(-1)!.chapter.n
    const edited = await store.editPlan({ workId: DREAM.workId, n, plan: planFromText('梗概：改过的梗概。\n走向：\n- 一拍') }, SESSION)
    expect(edited.ok).toBe(true)
    expect(edited.chapter?.plan?.summary).toBe('改过的梗概。')
    expect(edited.chapter?.planConfirmedAt).toBeDefined()
    expect(edited.changed).toEqual(expect.arrayContaining(['summary', 'beats', 'foreshadowOps', 'cast', 'hook']))
    expect((await store.editPlan({ workId: DREAM.workId, n, plan: planFromText('梗概：x\n伏笔：推进 #99：y') }, SESSION)).error).toBe('unknown-foreshadow')
  })

  it('writes a plan back as the lines it reads, cards by ref and name', () => {
    const plan = normalizePlan(planFromText(PLAN))!
    const text = planToText(plan, id => id === '#5' ? '#5' : id)
    expect(text).toContain('- 入夜｜按上一章摸到的办法入梦')
    expect(text).toContain('- 相遇｜神灵叫出他的名字（转折）')
    expect(text).toContain('- 推进 #5：叶子发光')
    expect(text).toContain('- 新埋：另一个做梦者是谁')
    expect(text).toContain('- 赵启明（视角）：慌但好奇')
    expect(normalizePlan(planFromText(text))).toEqual(plan)
    expect(changedPlanFields(plan, normalizePlan(planFromText(text.replace('叶子在白天', '叶子在夜里')))!)).toEqual(['hook'])
  })

  it('takes an edit of a re-plan still waiting on the person, never of a plan the text was checked against', async () => {
    const { store, write } = await bench()
    await write({ what: 'chapter', title: '入梦', content: PLAN.replace('#5', 'c_doorGap') })
    const n = (await store.listChapters({ workId: DREAM.workId })).at(-1)!.chapter.n
    await store.confirmChapterPlan({ workId: DREAM.workId, n }, SESSION)
    // Confirmed and still in planning (no text yet): the person may still edit.
    expect((await store.editPlan({ workId: DREAM.workId, n, plan: planFromText('梗概：再改。') }, SESSION)).ok).toBe(true)
  })
})
