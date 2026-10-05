/**
 * The CP1 deliverable: the three brief variants rendered off the
 * 《梦境监护者》seed — printed in full for the user's copy review (run
 * `pnpm --filter @khorsheed/dsh-canvas-novel test -- brief` and read the
 * output), snapshotted for regression, and asserted against the proposal's
 * budgets (write ~2k / plan ~2.5k estimated tokens) and the iron rules (no
 * full previous chapters, no whole foreshadow history, drafts never leak).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { BRIEF_BUDGETS, estimateTokens, renderExtractBrief, renderPlanBrief, renderWriteBrief, type BriefData } from '../src/brief.ts'
import { NovelService } from '../src/store.ts'
import { provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { DREAM, CHAPTER_5_BODY, seedDreamKeeper } from './seed-dream.ts'

/** A store over the seeded FakeFs. */
async function seededBrief(chapter?: number): Promise<BriefData> {
  const fs = new FakeFs()
  seedDreamKeeper(fs)
  const ctx = new Context()
  ctx.provide('fs', fs as never)
  provideCanvas(ctx)
  const store = new NovelService(ctx, { stateRoot: DREAM.stateRoot })
  const gathered = await store.gatherBrief({ workId: DREAM.workId, ...(chapter === undefined ? {} : { chapter }) })
  if (!gathered.ok || gathered.data === undefined) throw new Error(`gatherBrief failed: ${gathered.error ?? 'io'}`)
  return gathered.data
}

describe('the three brief variants on the《梦境监护者》seed (CP1)', () => {
  it('renders the write brief for the planning chapter, in full', async () => {
    const text = renderWriteBrief(await seededBrief())
    console.log(`\n${'='.repeat(28)} brief · for=write ${'='.repeat(28)}\n${text}\n${'='.repeat(70)}\n`)
    expect(text).toMatchSnapshot()
    expect(estimateTokens(text)).toBeLessThanOrEqual(BRIEF_BUDGETS.write)
    // The target is the planning chapter (第6章), the plan rides along.
    expect(text).toContain('写作约束 · 第6章 门后')
    expect(text).toContain('梗概：赵启明跟着艾文穿过门缝')
    expect(text).toContain('  - 推进 [#12 门缝里的东西]：门后第一层')
    expect(text).toContain('章末钩子：门后传来妹妹的声音')
    // The ledger carries ids; the iron rule: topK, never the whole history.
    expect(text).toContain('[#12] 门缝里的东西（埋于第1章 · 最后活跃第3章）')
    expect(text).not.toContain('已揭')
    // The in-scene blocks bind to the plan's characters, with the POV boundary fields.
    expect(text).toContain('### 赵启明（梦境监护者新人）')
    expect(text).toContain('知道 监护守则的全部条文、二层梦的基本规则；不知道 门缝里有什么、蓝色叶子的来历、艾文的真实身份；秘密 他在梦里见过走失的妹妹')
    expect(text).toContain('（非 POV 角色只写可观察的外在言行。）')
    // Recaps are summaries, and the previous chapter arrives as a ~200-char tail — never full text.
    expect(text).toContain('- 第5章 赵启明按半页守则找到档案室的门缝')
    expect(text).toContain('## 上一章末段（原文）')
    expect(text).toContain('微微发烫，像一句还没来得及说出口的回答。')
    expect(text).not.toContain(CHAPTER_5_BODY.slice(0, 60))
    // A canvas-native proposed card (未采纳) never leaks into the brief.
    expect(text).not.toContain('梦境有层数')
  })

  it('renders the plan brief with the whole live ledger and resolved answers', async () => {
    const text = renderPlanBrief(await seededBrief())
    console.log(`\n${'='.repeat(28)} brief · for=plan ${'='.repeat(29)}\n${text}\n${'='.repeat(70)}\n`)
    expect(text).toMatchSnapshot()
    expect(estimateTokens(text)).toBeLessThanOrEqual(BRIEF_BUDGETS.plan)
    expect(text).toContain('第6章规划参考')
    // Sleeping rows show 已 n 章未动 with the ⚠ at 3+; resolved rows carry their answers.
    expect(text).toContain('[#18] ★ 失踪的前任监护者是谁（埋于第1章 · 已 4 章未动 ⚠）')
    expect(text).toContain('[已揭 #9] 钟楼为什么没有影子 → 钟楼立在两层梦之间，影子落在了下一层。')
    // The roster is one line each.
    expect(text).toContain('- 赵启明：梦境监护者新人')
    expect(text).toContain('- 艾文：活了三百年的梦引者')
    // No character blocks and no previous tail here (proposal §4.2).
    expect(text).not.toContain('### 赵启明')
    expect(text).not.toContain('上一章末段')
    expect(text).not.toContain('梦境有层数')
  })

  it('renders the extract pack with the chapter body in full and the id whitelists', async () => {
    const data = await seededBrief(5)
    const text = renderExtractBrief(data, CHAPTER_5_BODY)
    console.log(`\n${'='.repeat(27)} brief · for=extract ${'='.repeat(27)}\n${text}\n${'='.repeat(70)}\n`)
    expect(text).toMatchSnapshot()
    // The one full-text scene: the whole manuscript is in the pack.
    expect(text).toContain(CHAPTER_5_BODY)
    // The instructions, the ledger/roster with ids, and the output schema.
    expect(text).toContain('你是长篇小说的记忆对账员。输入是第5章正文')
    expect(text).toContain('【活跃伏笔榜】')
    expect(text).toContain('[#12] 门缝里的东西（埋于第1章 · 最后活跃第3章）')
    expect(text).toContain('【角色花名册】')
    expect(text).toContain('- [c1] 赵启明（梦境监护者新人）')
    expect(text).toContain('- [c2] 艾文（活了三百年的梦引者）')
    expect(text).toContain('【输出 schema】')
    expect(text).toContain('"evidence_in_text"')
    // Resolved foreshadows stay out of the active board (the subagent must not re-touch them).
    expect(text).not.toContain('[#9]')
  })
})
