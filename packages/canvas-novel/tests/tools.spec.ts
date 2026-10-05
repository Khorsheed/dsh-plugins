/**
 * The three novel tools against the seeded store: the binding resolution
 * (guidance without a bound novel canvas, never a throw), the no-workspace
 * refusal, the ghost-card write, the review verb, and the extract two-phase with the
 * review gate held.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { NovelService } from '../src/store.ts'
import { novelBindDefinition, novelToolDefinitions } from '../src/tools.ts'
import { provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { CARD, DREAM, seedDreamKeeper } from './seed-dream.ts'

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
  const store = new NovelService(ctx, { stateRoot: DREAM.stateRoot })
  if (options.bound === true) canvas.bind('s-tools', DREAM.workId)
  const [read, write, extract] = novelToolDefinitions(store)
  return { store, fs, canvas, read: read!, write: write!, extract: extract! }
}

/** Run one tool call and return its text answer. */
async function call(tool: { execute: (args: never, exec: never) => Promise<unknown> }, args: Record<string, unknown>, agent = true): Promise<string> {
  const outcome = await tool.execute(args as never, exec(agent) as never)
  return typeof outcome === 'string' ? outcome : String(outcome)
}

describe('novel_bind', () => {
  it('lists the works, binds by title (exact, then unique part), and refuses what it cannot resolve', async () => {
    const { store, canvas, read } = await bench()
    const granted: string[] = []
    const bind = novelBindDefinition(store, async (agent) => { granted.push(String(agent.session.id)) })
    canvas.addBoard({ id: 'canvas_plain0001', title: '杂记', genre: null })
    canvas.addBoard({ id: 'canvas_novel0002', title: '梦境监护者外传' })
    const listed = await call(bind, {})
    expect(listed).toContain('《梦境监护者》')
    expect(listed).not.toContain('杂记')
    expect(listed).toContain('本会话未绑定')
    // A part shared by two works is ambiguous: the model asks the user.
    expect(await call(bind, { work: '梦境' })).toContain('对应多部作品')
    expect(await call(bind, { work: '杂记' })).toContain('没有叫「杂记」')
    // The exact title wins over the longer one containing it.
    expect(await call(bind, { work: '《梦境监护者》' })).toContain('已绑定《梦境监护者》')
    expect(canvas.bindings.get('s-tools')).toBe(DREAM.workId)
    // The grant settles before the reply promises the tools; refusals never reach it.
    expect(granted).toEqual(['s-tools'])
    expect(await call(read, { what: 'brief' })).not.toContain('还没有绑定')
    expect(await call(bind, {})).toContain('本会话已绑定《梦境监护者》')
    expect(await call(bind, { work: '外传' })).toContain('已绑定《梦境监护者外传》')
    expect(await call(bind, { work: '外传' }, false)).toContain('没有会话')
  })
})

describe('the novel tools', () => {
  it('answers guidance (never a throw) when the session is bound to no novel canvas or no agent is there', async () => {
    const { read, write, extract, canvas } = await bench()
    expect(await call(read, { what: 'brief' })).toContain('还没有绑定「长篇小说」画布')
    expect(await call(write, { what: 'card', role: '世界', fields: { rule: 'x' } })).toContain('还没有绑定「长篇小说」画布')
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

  it('novel_write(card) lands a ghost card that stays out of the brief until accepted', async () => {
    const { canvas, write, read } = await bench({ bound: true })
    const answer = await call(write, { what: 'card', role: '伏笔', fields: { question: '梦主可能是赵启明的妹妹？', bogus: 1 } })
    expect(answer).toContain('已落幽灵卡 [#19]（伏笔·待用户采纳）')
    expect(answer).toContain('忽略了不认识的字段：bogus')
    const brief = await call(read, { what: 'brief', for: 'write' })
    expect(brief).not.toContain('梦主可能是')
    expect(await call(write, { what: 'review', target: 'card', id: '#19', action: 'accept' })).toContain('已采纳')
    // An edit by ref merges into the card in place.
    expect(await call(write, { what: 'card', role: '人物', id: 'c1', fields: { voice: '说话更短了' } })).toContain('已更新 [c1]')
    expect(canvas.card(DREAM.workId, CARD.zhao)?.fields?.voice).toBe('说话更短了')
    expect(canvas.card(DREAM.workId, CARD.zhao)?.fields?.name).toBe('赵启明')
    expect(await call(write, { what: 'card', fields: { rule: 'x' } })).toContain('要给 role')
  })

  it('novel_write(chapter) numbers max+1 and stores the plan; re-planning keeps the number', async () => {
    const { write } = await bench({ bound: true })
    const created = await call(write, { what: 'chapter', title: '回响', plan: { goal: '穿过第一层', foreshadowOps: [{ op: '推进', id: '#12' }], characters: ['c1'] } })
    expect(created).toContain('已登记第 7 章《回响》plan')
    const replanned = await call(write, { what: 'chapter', chapter: 7, title: '回响·改', plan: { goal: '退回门缝' } })
    expect(replanned).toContain('第 7 章')
    const missing = await call(write, { what: 'chapter', chapter: 42, title: '不存在' })
    expect(missing).toContain('没有第 42 章')
  })

  it('novel_read(brief) needs a chapter to target; chapter/ledger/pending/chapters read back', async () => {
    const { read } = await bench({ bound: true })
    const brief = await call(read, { what: 'brief', for: 'write' })
    expect(brief).toContain('写作约束 · 第6章 门后')
    const chapters = await call(read, { what: 'chapters' })
    expect(chapters).toContain('第6章 门后（规划中）')
    const ledger = await call(read, { what: 'ledger' })
    expect(ledger).toContain('伏笔健康度：活跃 3 / 超期⚠ 3 / 已揭 1 / 弃置 0')
    const body = await call(read, { what: 'chapter', chapter: 5 })
    expect(body).toContain('门缝里飘出一片蓝色的叶子')
    const character = await call(read, { what: 'card', id: '赵启明' })
    expect(character).toContain('秘密：他在梦里见过走失的妹妹')
    const pending = await call(read, { what: 'pending' })
    expect(pending).toContain('待审队列为空')
  })

  it('novel_extract holds the extract gate, then prepares and imports (the two phases)', async () => {
    const { extract } = await bench({ bound: true })
    // Chapter 6 is planning with no body: the gate refuses with guidance, never a crash.
    expect(await call(extract, { chapter: 6, phase: 'prepare' })).toContain('没有什么可对账')
    const unseeded = await call(extract, { chapter: 42, phase: 'prepare' })
    expect(unseeded).toContain('没有第 42 章')
  })

  it('novel_extract on a writing chapter returns the pack, then files the subagent JSON', async () => {
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
