/**
 * The two main-session canvas tools: both definitions carry the community
 * origin tag (the `Symbol.for('dsh.tool.origin')` property, the documented
 * no-import path), target the canvas the session's tab has open, and delegate
 * to the board service's propose/comment paths (the SAME fence as every other
 * write).
 */
import { dirname, join, normalize } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { CanvasService } from '../src/service.ts'
import { CanvasBoardService } from '../src/store.ts'
import { canvasMainSessionToolDefinitions } from '../src/tools.ts'
import type { CanvasBoard } from '../src/types.ts'

type Entry = { kind: 'dir' } | { kind: 'file'; content: string; version: number }

/** The minimal `ctx.fs` the services touch, over a path → entry map. */
class FakeFs {
  private readonly entries = new Map<string, Entry>([['/', { kind: 'dir' }]])
  private seq = 0

  async resolve(path: string, opts?: { cwd?: string }): Promise<string> {
    return path.startsWith('/') ? normalize(path) : normalize(join(opts?.cwd ?? '/', path))
  }

  processPath(target: string): string {
    return target
  }

  contains(parent: string, child: string): boolean {
    return child === parent || child.startsWith(`${parent}/`)
  }

  async stat(target: string): Promise<{ version: string; type: 'file'; size: number } | undefined> {
    const entry = this.entries.get(target)
    if (entry === undefined || entry.kind !== 'file') return undefined
    return { version: String(entry.version), type: 'file', size: entry.content.length }
  }

  async readText(target: string): Promise<string> {
    const entry = this.entries.get(target)
    if (entry === undefined || entry.kind !== 'file') {
      throw new FsError(`no file at ${target}`, 'FS_NOT_FOUND')
    }
    return entry.content
  }

  async writeText(
    target: string,
    content: string,
    expected?: { kind: string; version?: string },
  ): Promise<{ operation: 'create' | 'update'; version: string; before: string | null; after: string }> {
    const existing = this.entries.get(target)
    if (expected?.kind === 'createIfAbsent' && existing !== undefined) {
      throw new FsError(`already exists: ${target}`, 'FS_NOT_OBSERVED')
    }
    if (expected?.kind === 'replaceIfVersion') {
      if (existing === undefined || existing.kind !== 'file' || String(existing.version) !== expected.version) {
        throw new FsError(`stale: ${target}`, 'FS_STALE_VERSION')
      }
    }
    this.mkdirp(dirname(target))
    const before = existing !== undefined && existing.kind === 'file' ? existing.content : null
    this.entries.set(target, { kind: 'file', content, version: ++this.seq })
    return {
      operation: existing === undefined ? 'create' : 'update',
      version: String(this.seq),
      before,
      after: content,
    }
  }

  async listDir(target: string): Promise<Array<{ name: string; type: 'file' | 'directory'; target: string }>> {
    if (this.entries.get(target) === undefined) {
      throw new FsError(`no directory at ${target}`, 'FS_NOT_FOUND')
    }
    const prefix = target === '/' ? '/' : `${target}/`
    const out = new Map<string, { name: string; type: 'file' | 'directory'; target: string }>()
    for (const [path, entry] of this.entries) {
      if (!path.startsWith(prefix) || path === target) continue
      const rest = path.slice(prefix.length)
      const name = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : rest
      if (out.has(name)) continue
      const childPath = `${prefix}${name}`
      const isDirectory = rest.includes('/') || entry.kind === 'dir'
      out.set(name, { name, type: isDirectory ? 'directory' : 'file', target: childPath })
    }
    return [...out.values()]
  }

  private mkdirp(dir: string): void {
    if (dir === '/' || dir === '.') return
    if (this.entries.get(dir)?.kind === 'dir') return
    this.mkdirp(dirname(dir))
    this.entries.set(dir, { kind: 'dir' })
  }
}

const WS = '/ws'
const STATE = '/state'
const FALLBACK = { id: 's-main', header: { cwd: WS } } as unknown as Session

type ToolName = 'canvas_read' | 'canvas_write' | 'canvas_propose_type' | 'canvas_open'

interface Bench {
  canvasId: string
  execute: (name: ToolName, args: Record<string, unknown>) => Promise<unknown>
  readCurrent: () => Promise<CanvasBoard>
  board: CanvasBoardService
}

/** One board the main session has open, the two tools built over it, plus an execute helper. */
async function harness(): Promise<Bench> {
  const fs = new FakeFs()
  const ctx = { fs, get: () => undefined, emit: () => {} } as unknown as Context
  const pad = new CanvasService(ctx)
  ;(ctx as { canvasStore?: CanvasService }).canvasStore = pad
  const board = new CanvasBoardService(ctx, { stateRoot: STATE })
  const created = await board.createCanvas({ title: '主题' }, FALLBACK)
  if (!created.ok) throw new Error('expected a created canvas')
  const canvasId = created.board.id
  expect(await board.focusCanvas({ canvasId }, FALLBACK)).toEqual({ ok: true })
  const tools = canvasMainSessionToolDefinitions(board)
  const agent = { session: FALLBACK } as unknown as Agent
  const execute = async (name: ToolName, args: Record<string, unknown>): Promise<unknown> => {
    const tool = tools.find(def => def.name === name)
    if (tool === undefined) throw new Error(`no tool ${name}`)
    const answer = await tool.execute(args, { agent } as never)
    // canvas_read answers { text, images }; these specs only read its text.
    return typeof answer === 'object' && answer !== null && 'text' in answer ? (answer as { text: string }).text : answer
  }
  const readCurrent = async (): Promise<CanvasBoard> => {
    const outcome = await board.readBoard({ canvasId })
    if (!outcome.ok) throw new Error('expected a readable board')
    return outcome.board
  }
  return { canvasId, execute, readCurrent, board }
}

describe('the canvas tools on the open canvas', () => {
  it('canvas_write op=card lands a proposed agent card with its source and rationale', async () => {
    const { execute, readCurrent } = await harness()
    const answer = await execute('canvas_write', {
      op: 'card', kind: 'reference', text: '效能假说综述',
      source: { type: 'url', ref: 'https://example.org/paper' },
      comment: '为支撑论点而找',
    }) as string
    const current = await readCurrent()
    expect(current.cards).toHaveLength(1)
    expect(current.cards[0]).toMatchObject({
      kind: 'reference', status: 'proposed', createdBy: 'agent', text: '效能假说综述',
    })
    expect(current.cards[0]?.comments[0]).toMatchObject({ author: 'agent', text: '为支撑论点而找' })
    expect(answer).toBe(`完成：${current.cards[0]!.id}`)
  })

  it('canvas_write op=comment moves an open question to exploring', async () => {
    const { execute, readCurrent } = await harness()
    await execute('canvas_write', { op: 'card', kind: 'question', text: '效能感被忽视了吗？' })
    const cardId = (await readCurrent()).cards[0]!.id
    expect(await execute('canvas_write', { op: 'comment', cardId, text: '有数据吗？' })).toBe('完成')
    expect((await readCurrent()).cards[0]?.question).toEqual({ state: 'exploring' })
  })

  it('canvas_write patches nothing on a plain canvas, archives by id, and canvas_read shows one card in full', async () => {
    const { execute, readCurrent } = await harness()
    await execute('canvas_write', { op: 'card', kind: 'fragment', text: '雨夜的钟声', comment: '开头的意象' })
    const cardId = (await readCurrent()).cards[0]!.id
    expect(await execute('canvas_write', { op: 'card', cardId, text: '改' })).toBe('失败：这张卡由用户来改；要补充就 op=comment 在这张卡上留言，或 op=card 另提一张。')
    expect(await execute('canvas_read', { cardId })).toBe(`${cardId}　[灵感]　待确认　雨夜的钟声\n---\n雨夜的钟声\n---\n评论：\n- 你：开头的意象`)
    expect(await execute('canvas_write', { op: 'archive', cardId })).toBe(`已归档：${cardId}（用户在画布的「已归档」里能找回）。`)
    expect((await readCurrent()).cards[0]?.status).toBe('archived')
    expect(await execute('canvas_write', { op: 'archive', cardId: 'c_nope' })).toBe('失败：没有卡片「c_nope」。')
  })

  it('hands a genre canvas\'s own categories to the genre\'s agent hooks, and keeps the rest generic', async () => {
    const { canvasId, execute, readCurrent, board } = await harness()
    // A card from before the genre: its built-in category stays on (it holds a card), and stays generic.
    await execute('canvas_write', { op: 'card', kind: 'fragment', text: '雨夜' })
    const calls: unknown[] = []
    board.registerGenre({
      id: 'novel', label: '长篇小说', version: 'novel@1', description: '', ownsManuscripts: true,
      categories: [{ role: 'character', label: '人物' }],
      agent: {
        cardLines: async request => { calls.push(['lines', request]); return ['- [c1] 人物 老周'] },
        cardDetail: async request => request.cardId === 'c1' ? '[c1] 老周（钟表匠）' : undefined,
        writeCard: async request => {
          calls.push(['write', request])
          return request.kind === '人物' || request.cardId === 'c1' ? '已落卡 [c2]' : undefined
        },
        resolveCard: async request => request.token === 'c1' ? (await readCurrent()).cards[0]?.id : undefined,
        manuscripts: async () => '章节（1 章，按章号）：\n- 第1章 雨夜',
        manuscriptGuide: '这块画布的成稿是章节：用 novel_write(what=chapter) 写。',
      },
    })
    expect(await board.selectGenre({ canvasId, genreId: 'novel' }, FALLBACK)).toMatchObject({ ok: true })
    expect(await execute('canvas_write', { op: 'card', kind: '人物', fields: { name: '小满' } })).toBe('已落卡 [c2]')
    expect(await execute('canvas_write', { op: 'card', cardId: 'c1', fields: { identity: '学徒' } })).toBe('已落卡 [c2]')
    expect(calls).toContainEqual(['write', { canvasId, kind: '人物', fields: { name: '小满' } }])
    // Not the genre's: the hook answers undefined and the card is proposed the generic way.
    expect(await execute('canvas_write', { op: 'card', kind: 'fragment', text: '钟声' })).toMatch(/^完成：c_/)
    const read = await execute('canvas_read', {}) as string
    expect(read).toContain('长篇小说卡片（1 张）：\n- [c1] 人物 老周')
    expect(read).toContain('卡片（2 张）：')
    expect(read).toContain('章节（1 章，按章号）：\n- 第1章 雨夜')
    expect(read).not.toContain('成稿：')
    expect(await execute('canvas_read', { cardId: 'c1' })).toBe('[c1] 老周（钟表匠）')
    expect(await execute('canvas_write', { op: 'manuscript', text: '# 第一章' })).toBe('这块画布的成稿是章节：用 novel_write(what=chapter) 写。')
    expect(await execute('canvas_write', { op: 'archive', cardId: 'c1' })).toBe('已归档：c1（用户在画布的「已归档」里能找回）。')
    expect((await readCurrent()).cards[0]?.status).toBe('archived')
  })

  it('answers the failure code instead of throwing on a bad card reference', async () => {
    const { execute } = await harness()
    expect(await execute('canvas_write', { op: 'comment', cardId: 'c_nope', text: 'x' })).toBe('失败：没有卡片「c_nope」。')
  })
})

describe('the board read and custom categories', () => {
  it('canvas_read lists the catalog with names and counts, and the cards', async () => {
    const { canvasId, execute, readCurrent, board } = await harness()
    const person = { id: 'cat_person0001', label: '人物', order: 60, enabled: true }
    const categories = [...(await readCurrent()).categories, person]
    expect(await board.setCategories({ canvasId, categories }, FALLBACK)).toMatchObject({ ok: true })
    expect(await execute('canvas_write', { op: 'card', kind: person.id, text: '**林默**：退役刑警' })).toMatch(/^完成：c_/)
    await execute('canvas_write', { op: 'card', kind: 'fragment', text: '雨夜' })
    const [, rain] = (await readCurrent()).cards
    await board.patchCard({ canvasId, cardId: rain!.id, status: 'archived' }, FALLBACK)
    const read = await execute('canvas_read', {}) as string
    expect(read).toContain('- fragment　灵感　0 张')
    expect(read).toContain(`- ${person.id}　人物　1 张`)
    expect(read).toContain('卡片（1 张，另有 1 张已归档未列出）：')
    expect(read).toMatch(/- c_\S+　\[人物\]　待确认　林默：退役刑警/)
    expect(await execute('canvas_read', { kind: 'fragment', includeArchived: true })).toMatch(/\[灵感\]　已归档　雨夜/)
    // kind also takes the name the board shows.
    expect(await execute('canvas_read', { kind: '人物' })).toMatch(/\[人物\]　待确认　林默/)
  })

  it('answers an unknown kind with the valid ids instead of a bare code', async () => {
    const { execute } = await harness()
    const answer = await execute('canvas_write', { op: 'card', kind: '人物', text: '林默' }) as string
    expect(answer).toContain('失败：这块画布没有 id 为「人物」的分类')
    expect(answer).toContain('fragment（灵感）、question（问题）')
    expect(answer).toContain('从这里挑对应的 id')
  })
})

describe('the manuscript tools on the open canvas', () => {
  it('writes a manuscript, lists it, reads it back with version and sources', async () => {
    const { execute, readCurrent } = await harness()
    await execute('canvas_write', { op: 'card', kind: 'fragment', text: '雨夜\n正文' })
    await execute('canvas_write', { op: 'card', kind: 'fragment', text: '晴天' })
    const [used, unused] = (await readCurrent()).cards
    expect(await execute('canvas_read', {})).toContain('成稿：（还没有）')
    const answer = await execute('canvas_write', {
      op: 'manuscript', text: '# 第一章\n\n正文', sources: { used: [used!.id], unused: [unused!.id] },
    }) as string
    const manuscript = (await readCurrent()).manuscripts[0]!
    expect(answer).toBe(`完成：${manuscript.id} v1`)
    expect(manuscript).toMatchObject({ title: '第一章', createdBy: 'agent', status: 'writing' })
    expect(await execute('canvas_read', {})).toContain(`成稿：\n- ${manuscript.id}　第一章　v1　写作中`)
    const read = await execute('canvas_read', { manuscriptId: manuscript.id }) as string
    expect(read).toContain(`用到的素材：${used!.id}（雨夜）`)
    expect(read).toContain(`没用到的素材：${unused!.id}（晴天）`)
    expect(read.endsWith('---\n# 第一章\n\n正文')).toBe(true)
  })

  it('answers a conflict with the current version instead of overwriting', async () => {
    const { execute, readCurrent } = await harness()
    await execute('canvas_write', { op: 'manuscript', text: '# 稿\n\n一' })
    const id = (await readCurrent()).manuscripts[0]!.id
    expect(await execute('canvas_write', { op: 'manuscript', manuscriptId: id, text: '二', baseVersion: 1 })).toBe(`完成：${id} v2`)
    expect(await execute('canvas_write', { op: 'manuscript', manuscriptId: id, text: '三', baseVersion: 1 }))
      .toBe('冲突：这篇成稿当前是 v2，已被改过。先用 canvas_read 带 manuscriptId 读最新版，再在它上面改。')
    expect(await execute('canvas_read', { manuscriptId: 'ms_nopenope' })).toBe('失败：missing')
  })
})

describe('the main-session canvas tools (M3 second entrance)', () => {
  it('answers the no-canvas message instead of failing when nothing is open', async () => {
    const fs = new FakeFs()
    const ctx = { fs, get: () => undefined } as unknown as Context
    const pad = new CanvasService(ctx)
    ;(ctx as { canvasStore?: CanvasService }).canvasStore = pad
    const board = new CanvasBoardService(ctx, { stateRoot: STATE })
    const tools = canvasMainSessionToolDefinitions(board)
    expect(tools.map(def => def.name)).toEqual([
      'canvas_read', 'canvas_write', 'canvas_propose_type', 'canvas_open',
    ])
    for (const def of tools) {
      expect((def as unknown as Record<PropertyKey, unknown>)[Symbol.for('dsh.tool.origin')]).toEqual({
        channel: 'plugin', owner: '@khorsheed/dsh-canvas',
      })
    }
    const agent = { session: FALLBACK } as unknown as Agent
    expect(await tools[0]!.execute({}, { agent } as never))
      .toEqual({ text: '本会话还没有目标画布：先用 canvas_open() 列出已有画布并切过去；没有合适的，在用户同意后用 canvas_open(create=标题) 新建。', images: [] })
    expect(await tools[1]!.execute({ op: 'card', kind: 'fragment', text: 'x' }, { agent } as never))
      .toBe('本会话还没有目标画布：先用 canvas_open() 列出已有画布并切过去；没有合适的，在用户同意后用 canvas_open(create=标题) 新建。')
    expect(await tools[2]!.execute({ label: '人物', definition: {}, rationale: '' }, { agent } as never))
      .toBe('本会话还没有目标画布：先用 canvas_open() 列出已有画布并切过去；没有合适的，在用户同意后用 canvas_open(create=标题) 新建。')
    // And nothing was written.
    expect(await board.listCanvases()).toEqual({ items: [] })
  })

  it('targets the focused canvas once the tab reports it, fencing with the main session', async () => {
    const fs = new FakeFs()
    const ctx = { fs, get: () => undefined } as unknown as Context
    const pad = new CanvasService(ctx)
    ;(ctx as { canvasStore?: CanvasService }).canvasStore = pad
    const board = new CanvasBoardService(ctx, { stateRoot: STATE })
    const created = await board.createCanvas({ title: '主题' }, FALLBACK)
    if (!created.ok) throw new Error('expected a created canvas')
    expect(await board.focusCanvas({ canvasId: created.board.id }, FALLBACK)).toEqual({ ok: true })
    const tools = canvasMainSessionToolDefinitions(board)
    const agent = { session: FALLBACK } as unknown as Agent
    const answer = await tools[1]!.execute({ op: 'card', kind: 'reference', text: '效能假说综述' }, { agent } as never)
    const read = await board.readBoard({ canvasId: created.board.id })
    if (!read.ok) throw new Error('expected a readable board')
    expect(read.board.cards).toHaveLength(1)
    expect(read.board.cards[0]).toMatchObject({ kind: 'reference', status: 'proposed', createdBy: 'agent' })
    expect(answer).toBe(`完成：${read.board.cards[0]!.id}`)
    expect(await tools[1]!.execute({ op: 'comment', cardId: read.board.cards[0]!.id, text: '这里隐含一个假设。有数据吗？' }, { agent } as never)).toBe('完成')
    const after = await board.readBoard({ canvasId: created.board.id })
    if (!after.ok) throw new Error('expected a readable board')
    expect(after.board.cards[0]?.comments[0]).toMatchObject({ author: 'agent', text: '这里隐含一个假设。有数据吗？' })
  })

  it('answers the no-canvas message when the run context carries no agent at all', async () => {
    const fs = new FakeFs()
    const ctx = { fs, get: () => undefined } as unknown as Context
    const pad = new CanvasService(ctx)
    ;(ctx as { canvasStore?: CanvasService }).canvasStore = pad
    const board = new CanvasBoardService(ctx, { stateRoot: STATE })
    const tools = canvasMainSessionToolDefinitions(board)
    expect(await tools[1]!.execute({ op: 'card', kind: 'fragment', text: 'x' }, {} as never))
      .toBe('本会话还没有目标画布：先用 canvas_open() 列出已有画布并切过去；没有合适的，在用户同意后用 canvas_open(create=标题) 新建。')
  })
})

describe('canvas_open: list, switch to, or create the session\'s canvas', () => {
  /** A board service with no canvas focused, the tools over it, and one main session. */
  function bench(): { board: CanvasBoardService; open: (args: Record<string, unknown>) => Promise<string>; write: (args: Record<string, unknown>) => Promise<string> } {
    const fs = new FakeFs()
    const ctx = { fs, get: () => undefined, emit: () => {} } as unknown as Context
    ;(ctx as { canvasStore?: CanvasService }).canvasStore = new CanvasService(ctx)
    const board = new CanvasBoardService(ctx, { stateRoot: STATE })
    const tools = canvasMainSessionToolDefinitions(board)
    const agent = { session: FALLBACK } as unknown as Agent
    const run = (name: string) => async (args: Record<string, unknown>): Promise<string> =>
      String(await tools.find(def => def.name === name)!.execute(args, { agent } as never))
    return { board, open: run('canvas_open'), write: run('canvas_write') }
  }

  it('creates a canvas, makes it the session\'s target, and the write tools land on it', async () => {
    const { board, open, write } = bench()
    expect(await open({})).toContain('还没有画布。')
    const answer = await open({ create: '《雨夜》' })
    const { items } = await board.listCanvases()
    expect(items).toHaveLength(1)
    expect(items[0]!.title).toBe('雨夜')
    expect(answer).toBe(`完成：已新建画布《雨夜》（${items[0]!.id}）并切过去。接下来用 canvas_write 落卡。`)
    expect(board.focusedCanvasId(FALLBACK)).toBe(items[0]!.id)
    expect(await write({ op: 'card', kind: 'fragment', text: '雨声' })).toMatch(/^完成：c_/)
    expect(await open({})).toContain(`- ${items[0]!.id}　《雨夜》　1 张卡　← 本会话当前`)
  })

  it('switches to a live namesake instead of creating a twin', async () => {
    const { board, open } = bench()
    const first = await board.createCanvas({ title: '雨夜' }, FALLBACK)
    if (!first.ok) throw new Error('expected a created canvas')
    expect(await open({ create: '雨夜' })).toContain(`已切到画布《雨夜》（${first.board.id}）——已有同名画布，没有新建`)
    expect((await board.listCanvases()).items).toHaveLength(1)
    expect(board.focusedCanvasId(FALLBACK)).toBe(first.board.id)
  })

  it('switches by title or id, asks when two fit, and refuses an archived canvas', async () => {
    const { board, open } = bench()
    const a = await board.createCanvas({ title: '雨夜·上' }, FALLBACK)
    const b = await board.createCanvas({ title: '雨夜·下' }, FALLBACK)
    const old = await board.createCanvas({ title: '旧稿' }, FALLBACK)
    if (!a.ok || !b.ok || !old.ok) throw new Error('expected created canvases')
    expect(await open({ canvas: '雨夜' })).toContain('对应多块画布')
    expect(await open({ canvas: '雨夜·下' })).toBe(`完成：已切到画布《雨夜·下》（${b.board.id}）。`)
    expect(board.focusedCanvasId(FALLBACK)).toBe(b.board.id)
    expect(await open({ canvas: a.board.id })).toContain('已切到画布《雨夜·上》')
    await board.archiveCanvas({ canvasId: old.board.id, archived: true }, FALLBACK)
    expect(await open({ canvas: '旧稿' })).toContain('已归档（只读）')
    expect(await open({ canvas: '没有这块' })).toContain('失败：没有叫「没有这块」的画布。')
  })

  it('creates a genre canvas bound to the session, and a plain switch unbinds it', async () => {
    const { board, open } = bench()
    board.registerGenre({
      id: 'novel', label: '长篇小说', version: 'novel@1', description: '',
      categories: [{ role: 'character', label: '人物' }],
    })
    expect(await open({ create: '雾港', genre: '武侠' })).toContain('失败：没有体裁「武侠」。可选：novel（长篇小说）。')
    const answer = await open({ create: '雾港', genre: '长篇小说' })
    expect(answer).toContain('已绑定（体裁：长篇小说）')
    const novel = (await board.listCanvases()).items.find(item => item.title === '雾港')!
    expect(novel.genre).toBe('novel')
    expect(await board.boundCanvasId(String(FALLBACK.id))).toBe(novel.id)
    const plain = await board.createCanvas({ title: '杂记' }, FALLBACK)
    if (!plain.ok) throw new Error('expected a created canvas')
    expect(await open({ canvas: '杂记' })).toBe(`完成：已切到画布《杂记》（${plain.board.id}）。已解除与《雾港》的绑定。`)
    expect(await board.boundCanvasId(String(FALLBACK.id))).toBeUndefined()
    expect(await board.targetCanvasId(FALLBACK)).toBe(plain.board.id)
  })
})
