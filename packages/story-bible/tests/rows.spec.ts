/**
 * The toolview row models: one settled answer per shape, parsed the way the
 * rows render it (running / failed / plan card / prepare pack / reconcile
 * summary / the review gate's refusal).
 */
import { describe, expect, it } from 'vitest'
import { storyExtractRowModel, storyWriteRowModel } from '../src/client/rows.ts'

/** A settled tool block. */
function block(text: string, isError = false): { kind: string; content: { type: string; text: string }[]; isError: boolean } {
  return { kind: 'tool-result', content: [{ type: 'text', text }], isError }
}

describe('storyWriteRowModel', () => {
  it('reads running, failed, the plan card, and a plan-less registration', () => {
    expect(storyWriteRowModel(null).state).toBe('running')
    expect(storyWriteRowModel(block('失败：what=memory 要给 content。')).state).toBe('failed')
    const plan = storyWriteRowModel(block('已登记第 7 章《回响》plan：POV 赵启明 / 目标 穿过第一层 / 伏笔操作 1 条 / 钩子 无。用户确认后开写。'))
    expect(plan).toMatchObject({ state: 'chapter-plan', n: 7, title: '回响' })
    const plain = storyWriteRowModel(block('已建第 7 章《回响》（规划中，正文文件 第7章.md，编号自动 max+1）。'))
    expect(plain).toMatchObject({ state: 'plain', n: 7, title: '回响' })
    expect(storyWriteRowModel(block('已落幽灵卡 m19（世界）：「梦境有层数」')).state).toBe('plain')
  })
})

describe('storyExtractRowModel', () => {
  it('reads the import summary, the prepare pack, and the review gate', () => {
    const summary = storyExtractRowModel(block('计划命中 ✓×1 / 计划落空 ×1 / 自动入库 ×3 / 待你确认 ×4'))
    expect(summary).toMatchObject({ state: 'imported', verified: 1, missed: 1, auto: 3, pending: 4 })
    const prepared = storyExtractRowModel(block('你是长篇小说的记忆对账员。输入是第5章正文、本章计划、活跃伏笔榜、角色花名册。\n…'))
    expect(prepared).toMatchObject({ state: 'prepared', n: 5 })
    expect(storyExtractRowModel(block('这章还没有被用户「审过」——不满意的正文不进记忆。')).state).toBe('refused')
    expect(storyExtractRowModel(block('boom', true)).state).toBe('failed')
    expect(storyExtractRowModel(null).state).toBe('running')
  })
})
