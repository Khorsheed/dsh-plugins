/**
 * The three story tools against the seeded store: the binding resolution
 * (guidance without a bound novel canvas, never a throw), the no-workspace
 * refusal, the ghost-card write, the review verb, and the extract two-phase with the
 * review gate held.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { StoryBibleService } from '../src/store.ts'
import { storyMainSessionToolDefinitions } from '../src/tools.ts'
import { provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { DREAM, seedDreamKeeper } from './seed-dream.ts'

const SESSION = { id: 's-tools' } as unknown as Session

/** The exec context the host hands a tool call. */
function exec(agent: boolean = true): { agent?: { session: Session; sessionId: string } } {
  return agent ? { agent: { session: SESSION, sessionId: 's-tools' } } : {}
}

/** A store over the seed plus its three tools. */
async function bench(options: { ch5Phase?: 'extracted' | 'reviewed'; bound?: boolean } = {}) {
  const fs = new FakeFs()
  seedDreamKeeper(fs, { ...(options.ch5Phase === undefined ? {} : { ch5Phase: options.ch5Phase }) })
  const ctx = new Context()
  ctx.provide('fs', fs as never)
  const canvas = provideCanvas(ctx)
  const store = new StoryBibleService(ctx, { stateRoot: DREAM.stateRoot })
  if (options.bound === true) canvas.bind('s-tools', DREAM.workId)
  const [read, write, extract] = storyMainSessionToolDefinitions(store)
  return { store, fs, canvas, read: read!, write: write!, extract: extract! }
}

/** Run one tool call and return its text answer. */
async function call(tool: { execute: (args: never, exec: never) => Promise<unknown> }, args: Record<string, unknown>, agent = true): Promise<string> {
  const outcome = await tool.execute(args as never, exec(agent) as never)
  return typeof outcome === 'string' ? outcome : String(outcome)
}

describe('the story tools', () => {
  it('answers guidance (never a throw) when the session is bound to no novel canvas or no agent is there', async () => {
    const { read, write, extract, canvas } = await bench()
    expect(await call(read, { what: 'brief' })).toContain('还没有绑定「长篇小说」画布')
    expect(await call(write, { what: 'memory', content: 'x' })).toContain('还没有绑定「长篇小说」画布')
    expect(await call(extract, { chapter: 5, phase: 'prepare' })).toContain('还没有绑定「长篇小说」画布')
    expect(await call(read, { what: 'brief' }, false)).toContain('还没有绑定「长篇小说」画布')
    // A binding to a canvas whose genre is not 长篇小说 is no work either.
    canvas.addBoard({ id: 'canvas_plain0001', title: '杂记', genre: null }).bind('s-tools', 'canvas_plain0001')
    expect(await call(read, { what: 'brief' })).toContain('还没有绑定「长篇小说」画布')
    // Bound to the novel canvas: the tools act on it.
    canvas.bind('s-tools', DREAM.workId)
    expect(await call(read, { what: 'brief' })).toContain('梦境监护者')
  })

  it('refuses a chapter body on a canvas without a workspace, and says how to fix it', async () => {
    const { write, canvas } = await bench()
    canvas.addBoard({ id: 'canvas_bare00001', title: '无处' }).bind('s-tools', 'canvas_bare00001')
    expect(await call(write, { what: 'chapter', title: '第一章' })).not.toContain('失败')
    expect(await call(write, { what: 'chapter', chapter: 1, title: '第一章', content: '没地方放。' })).toContain('还没有挂工作区')
  })

  it('story_write(memory) lands a ghost card that stays out of the brief until accepted', async () => {
    const { store, write, read } = await bench({ bound: true })
    const answer = await call(write, { what: 'memory', content: '梦主可能是赵启明的妹妹。', kind: '伏笔点子' })
    expect(answer).toContain('已落卡 m19')
    expect(answer).toContain('提议中')
    // 短事实行：界面自己会显示，模型不代为通知（降噪规则）。
    expect(answer).not.toContain('不进 brief')
    const brief = await call(read, { what: 'brief', for: 'write' })
    expect(brief).not.toContain('梦主可能是')
    const accepted = await call(write, { what: 'review', target: 'memory', id: 'm19', action: 'accept' })
    expect(accepted).toContain('已采纳')
    const memories = await store.listMemories({ workId: DREAM.workId })
    expect(memories.find(memory => memory.id === 'm19')).toMatchObject({ intentStatus: 'active', reviewed: true })
  })

  it('story_write(chapter) numbers max+1 and stores the plan; re-planning keeps the number', async () => {
    const { write } = await bench({ bound: true })
    const created = await call(write, { what: 'chapter', title: '回响', plan: { goal: '穿过第一层', foreshadowOps: [{ op: '推进', id: '#12' }], characters: ['c1'] } })
    expect(created).toContain('已登记第 7 章《回响》plan')
    const replanned = await call(write, { what: 'chapter', chapter: 7, title: '回响·改', plan: { goal: '退回门缝' } })
    expect(replanned).toContain('第 7 章')
    const missing = await call(write, { what: 'chapter', chapter: 42, title: '不存在' })
    expect(missing).toContain('没有第 42 章')
  })

  it('story_read(brief) needs a chapter to target; chapter/ledger/pending/chapters read back', async () => {
    const { read } = await bench({ bound: true })
    const brief = await call(read, { what: 'brief', for: 'write' })
    expect(brief).toContain('写作约束 · 第6章 门后')
    const chapters = await call(read, { what: 'chapters' })
    expect(chapters).toContain('第6章 门后（规划中）')
    const ledger = await call(read, { what: 'ledger' })
    expect(ledger).toContain('伏笔健康度：活跃 3 / 超期⚠ 3 / 已揭 1 / 弃置 0')
    const body = await call(read, { what: 'chapter', chapter: 5 })
    expect(body).toContain('门缝里飘出一片蓝色的叶子')
    const character = await call(read, { what: 'character', id: '赵启明' })
    expect(character).toContain('秘密：他在梦里见过走失的妹妹')
    const pending = await call(read, { what: 'pending' })
    expect(pending).toBe('待审队列为空。')
  })

  it('story_extract holds the extract gate, then prepares and imports (the two phases)', async () => {
    const { extract } = await bench({ bound: true })
    // Chapter 6 is planning with no body: the gate refuses with guidance, never a crash.
    expect(await call(extract, { chapter: 6, phase: 'prepare' })).toContain('没有什么可对账')
    const unseeded = await call(extract, { chapter: 42, phase: 'prepare' })
    expect(unseeded).toContain('没有第 42 章')
  })

  it('story_extract on a writing chapter returns the pack, then files the subagent JSON', async () => {
    const { extract } = await bench({ bound: true, ch5Phase: 'planning' })
    const pack = await call(extract, { chapter: 5, phase: 'prepare' })
    expect(pack).toContain('你是长篇小说的记忆对账员。输入是第5章正文')
    expect(pack).toContain('[#12] 门缝里的东西')
    expect(pack).toContain('- [c1] 赵启明（梦境监护者新人）')
    const report = await call(extract, {
      chapter: 5,
      phase: 'import',
      payload: {
        foreshadow_mentions: [{ foreshadow_id: '#12', kind: 'advanced', confidence: 'high', evidence_in_text: '指尖碰到门缝的边缘' }],
        recap: '赵启明推开了门缝。',
      },
    })
    expect(report).toContain('计划命中 ✓×1')
    expect(report).toContain('计划落空 ×1')
    const again = await call(extract, { chapter: 5, phase: 'import', payload: {} })
    expect(again).toContain('已对过账')
  })
})
