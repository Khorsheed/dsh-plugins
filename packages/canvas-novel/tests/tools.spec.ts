/**
 * The three novel tools against the seeded store: the binding resolution
 * (guidance without a bound novel canvas, never a throw), the no-workspace
 * refusal, the review verb, and the extract two-phase with the
 * review gate held.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { NovelService } from '../src/store.ts'
import { novelBindDefinition, novelToolDefinitions } from '../src/tools.ts'
import { provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { readDestinations } from '@khorsheed/dsh-client-ui-agent-nav/src/destination.ts'
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

describe('novel_bind in a room', () => {
  it('the coordinator binds the room and tells it; a member binds itself and reads the room\'s until then', async () => {
    const { store, canvas, read } = await bench()
    const events: { type: string; data: unknown }[] = []
    const room = { id: 's-room', append: (type: string, data: unknown) => { events.push({ type, data }) } }
    const as = (role: 'coordinator' | 'member') => ({
      agent: { session: { id: 's-bill' }, [Symbol.for('dsh.agent.desk')]: { session: room, role, member: 'bill' } },
    })
    const bind = novelBindDefinition(store, async () => {})
    expect(String(await bind.execute({ work: '梦境监护者' } as never, as('coordinator') as never))).toContain('房间侧栏已切到这部作品')
    expect(canvas.bindings.get('s-room')).toBe(DREAM.workId)
    expect(canvas.bindings.get('s-bill')).toBeUndefined()
    expect(events).toEqual([{ type: 'room/desk-opened', data: { version: 1, owner: '@khorsheed/dsh-canvas', member: 'bill', role: 'coordinator', data: { canvasId: DREAM.workId, title: DREAM.title, created: false } } }])
    // A member with no binding of its own works on the room's novel.
    expect(String(await read.execute({ what: 'brief' } as never, as('member') as never))).toContain('梦境监护者')
    canvas.addBoard({ id: 'canvas_novel0002', title: '外传' })
    expect(String(await bind.execute({ work: '外传' } as never, as('member') as never))).toContain('已放进房间侧栏的画布标签里')
    expect(canvas.bindings.get('s-bill')).toBe('canvas_novel0002')
    expect(canvas.bindings.get('s-room')).toBe(DREAM.workId)
  })
})

describe('a room member\'s novel writes are told to the room', () => {
  it('a chapter the coordinator plans lands on the room\'s novel and is told as a chapter; outside a room nothing is told', async () => {
    const { canvas, write } = await bench()
    const events: { type: string; data: { data: { items: { action: string; title: string }[] } } }[] = []
    const room = { id: 's-room', append: (type: string, data: never) => { events.push({ type, data }) } }
    canvas.bind('s-room', DREAM.workId)
    const exec = { agent: { session: { id: 's-bill' }, [Symbol.for('dsh.agent.desk')]: { session: room, role: 'coordinator', member: 'bill', runId: 'r9' } } }
    const answer = String(await write.execute({ what: 'chapter', title: '雨夜来客', plan: { summary: '来客敲门。' } } as never, exec as never))
    expect(answer).not.toMatch(/^失败/)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'room/desk-wrote', data: { owner: '@khorsheed/dsh-canvas', role: 'coordinator', runId: 'r9', data: { canvasId: DREAM.workId } } })
    expect(events[0]!.data.data.items.some(item => item.action === 'chapter' && item.title.includes('《雨夜来客》'))).toBe(true)
    // No desk: the same call tells no one.
    canvas.bind('s-tools', DREAM.workId)
    await call(write, { what: 'chapter', title: '雨夜之后', plan: { summary: '雨停了。' } })
    expect(events).toHaveLength(1)
  })
})

describe('the novel tools', () => {
  it('answers guidance (never a throw) when the session is bound to no novel canvas or no agent is there', async () => {
    const { read, write, extract, canvas } = await bench()
    expect(await call(read, { what: 'brief' })).toContain('还没有绑定「长篇小说」画布')
    expect(await call(write, { what: 'review', id: 'p1', action: 'accept' })).toContain('还没有绑定「长篇小说」画布')
    expect(await call(extract, { chapter: 5, phase: 'prepare' })).toContain('还没有绑定「长篇小说」画布')
    expect(await call(read, { what: 'brief' }, false)).toContain('还没有绑定「长篇小说」画布')
    // A binding to a canvas whose genre is not 长篇小说 is no work either.
    canvas.addBoard({ id: 'canvas_plain0001', title: '杂记', genre: null }).bind('s-tools', 'canvas_plain0001')
    expect(await call(read, { what: 'brief' })).toContain('还没有绑定「长篇小说」画布')
    // Bound to the novel canvas: the tools act on it.
    canvas.bind('s-tools', DREAM.workId)
    expect(await call(read, { what: 'brief' })).toContain('梦境监护者')
  })

  it('searches settings by keyword and kind, and reads a requested ref in full', async () => {
    const { read } = await bench({ bound: true })
    expect(await call(read, { what: 'settings', query: '真名', kind: '规则' })).toContain('[w1]')
    expect(await call(read, { what: 'settings', refs: ['w2'] })).toContain('蓝色叶子是梦主意识碎片的载体')
    expect(await call(read, { what: 'settings', query: '不存在的名字' })).toContain('没有匹配的设定')
  })

  it('refuses a chapter body on a canvas without a workspace, and says how to fix it', async () => {
    const { write, canvas } = await bench()
    canvas.addBoard({ id: 'canvas_bare00001', title: '无处' }).bind('s-tools', 'canvas_bare00001')
    expect(await call(write, { what: 'chapter', title: '第一章' })).not.toContain('失败')
    expect(await call(write, { what: 'chapter', chapter: 1, title: '第一章', content: '没地方放。' })).toContain('还没有挂工作区')
  })

  it('refuses a body before the plan is confirmed, and registers 用户原稿 with byUser', async () => {
    const { write } = await bench({ bound: true })
    expect(await call(write, { what: 'chapter', title: '新的一章', content: '抢跑。' })).toContain('正文只能写进已确认计划的章节')
    const body = await call(write, { what: 'chapter', title: '新的一章', byUser: true, content: '我自己写的。' })
    expect(body).toContain(`已写入第 7 章《新的一章》正文（画布 ${DREAM.workId} · 6 字）`)
    expect(readDestinations(String(body))[0]?.params).toEqual({ canvasId: DREAM.workId, face: 'manuscripts', item: '7', focus: 'body' })
  })

  it('novel_read / novel_write carry no cards (canvas_read / canvas_write do); review is the pending queue only', async () => {
    const { write, read } = await bench({ bound: true })
    await expect(call(read, { what: 'cards' })).rejects.toThrow('must be one of')
    await expect(call(write, { what: 'card', role: '人物', fields: { name: 'x' } })).rejects.toThrow('must be one of')
    await expect(call(write, { what: 'review', id: 'p1', action: 'archive' })).rejects.toThrow('must be one of')
    expect(await call(write, { what: 'review', id: 'p1' })).toContain('要给 id（待审项）和 action')
  })

  it('novel_write(chapter) files a 信息差 by card, whether the model typed a ref or a name', async () => {
    const { write, fs } = await bench({ bound: true })
    await call(write, {
      what: 'chapter', title: '回响',
      plan: { summary: '穿过第一层', cast: [{ who: 'c1' }], infoGaps: [{ who: 'c1', fact: '门后有人' }, { who: '没这个人', fact: '随便' }] },
    })
    const table = JSON.parse(fs.read(`${DREAM.stateRoot}/${DREAM.workId}/chapters.json`)) as { chapters: { n: number; plan?: { infoGaps?: { who: string }[] } }[] }
    const gaps = table.chapters.find(row => row.n === 7)?.plan?.infoGaps ?? []
    expect(gaps.map(gap => gap.who)).toEqual([CARD.zhao, '没这个人'])
  })

  it('novel_write(chapter) numbers max+1 and stores the plan; re-planning keeps the number', async () => {
    const { write } = await bench({ bound: true })
    const created = await call(write, {
      what: 'chapter', title: '回响',
      plan: { summary: '穿过第一层', beats: [{ text: '推门' }, { text: '回头', mark: '转折' }], foreshadowOps: [{ op: '推进', id: '#12', note: '门后第一层' }], cast: [{ who: 'c1' }] },
    })
    // The answer names the canvas: the conversation card opens the chapter from it.
    expect(created).toContain(`已登记第 7 章《回响》（画布 ${DREAM.workId}）plan：情节 2 段 / 伏笔 1 条 / 出场 1 人。`)
    // …and its destination is that chapter in the 章节 face, on its plan — never a list or a detail page.
    // The plugin hands the card's words with it: it waits for the person.
    expect(readDestinations(String(created))).toEqual([expect.objectContaining({
      kind: 'canvas', label: '第 7 章《回响》计划',
      params: { canvasId: DREAM.workId, face: 'manuscripts', item: '7', focus: 'plan' },
      card: { status: '等你确认', awaiting: true, door: '查看并确认计划 →' },
    })])
    const replanned = await call(write, { what: 'chapter', chapter: 7, title: '回响·改', plan: { summary: '退回门缝' } })
    expect(replanned).toContain('第 7 章')
    expect(await call(write, { what: 'chapter', chapter: 7, title: '回响', plan: { goal: '旧形状' } })).toContain('至少要有 summary')
    // A question where the number goes is refused, naming it; 新埋 needs no number.
    const unnumbered = await call(write, {
      what: 'chapter', chapter: 7, title: '回响',
      plan: { summary: '退回门缝', foreshadowOps: [{ op: '推进', id: '门缝里的东西', note: '多一道划痕' }, { op: '新埋', question: '哼歌的女人是谁' }] },
    })
    expect(unnumbered).toContain('对不上伏笔卡：「门缝里的东西」。')
    expect(await call(write, {
      what: 'chapter', chapter: 7, title: '回响',
      plan: { summary: '退回门缝', foreshadowOps: [{ op: '推进', id: '#12', note: '多一道划痕' }, { op: '新埋', question: '哼歌的女人是谁' }] },
    })).toContain('伏笔 2 条')
    const bare = await call(write, { what: 'chapter', title: '尾声' })
    expect(bare).toContain(`已建第 8 章《尾声》（画布 ${DREAM.workId} · 规划中 · 第8章.md）。`)
    expect(readDestinations(String(bare))[0]?.params).toEqual({ canvasId: DREAM.workId, face: 'manuscripts', item: '8', focus: 'plan' })
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
    expect(ledger).toContain('伏笔健康度：活跃 3 / 超期⚠ 1 / 已揭 1 / 弃置 0')
    const body = await call(read, { what: 'chapter', chapter: 5 })
    expect(body).toContain('门缝里飘出一片蓝色的叶子')
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
    expect(again).toContain('不用再对')
  })

  it('novel_extract import that cannot be quoted says 未对完 with a reason per quote, and lists 待对账 chapters', async () => {
    const { extract, read } = await bench({ bound: true, ch5Phase: 'planning' })
    const report = await call(extract, {
      chapter: 5,
      phase: 'import',
      payload: { experiences: [{ character_id: 'c1', entry: '推门', confidence: 'high', evidence_in_text: '赵启明想起妹妹……指尖碰到门缝的边缘' }] },
    })
    expect(report).toContain('未对完')
    expect(report).toContain('省略号')
    expect(report).not.toContain('计划命中')
    expect(await call(read, { what: 'chapters' })).toContain('待对账：第5章')
  })
})
