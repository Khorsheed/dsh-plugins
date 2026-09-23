/**
 * The two canvas tools handed to side-chat: both definitions carry the
 * community origin tag (the `Symbol.for('dsh.tool.origin')` property, the
 * documented no-import path), delegate to the board service's propose/comment
 * paths (the SAME fence as every other write), and fence with the executing
 * agent's own session when the run context carries one — falling back to the
 * session whose ask primed the context.
 */
import { dirname, join, normalize } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { CanvasService } from '../src/service.ts'
import { CanvasBoardService } from '../src/store.ts'
import { canvasMainSessionToolDefinitions, canvasToolDefinitions } from '../src/tools.ts'
import { defaultCategories, type CanvasBoard } from '../src/types.ts'

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
const FALLBACK = { id: 's-ask', header: { cwd: WS } } as unknown as Session
const CANVAS_AGENT_SESSION = { id: 's-canvas-agent', header: { cwd: WS } } as unknown as Session

interface Bench {
  canvasId: string
  execute: (name: 'canvas_propose_card' | 'canvas_comment', args: Record<string, unknown>, agent?: Agent) => Promise<unknown>
  readCurrent: () => Promise<CanvasBoard>
}

/** One board with the two tools built over it, plus an execute helper. */
async function harness(): Promise<Bench> {
  const fs = new FakeFs()
  const ctx = { fs, get: () => undefined } as unknown as Context
  const pad = new CanvasService(ctx)
  ;(ctx as { canvasStore?: CanvasService }).canvasStore = pad
  const board = new CanvasBoardService(ctx, { stateRoot: STATE })
  const created = await board.createCanvas({ title: '主题' }, FALLBACK)
  if (!created.ok) throw new Error('expected a created canvas')
  const canvasId = created.board.id
  const tools = canvasToolDefinitions(board, canvasId, FALLBACK, created.board.categories)
  const execute = async (name: 'canvas_propose_card' | 'canvas_comment', args: Record<string, unknown>, agent?: Agent): Promise<unknown> => {
    const tool = tools.find(def => def.name === name)
    if (tool === undefined) throw new Error(`no tool ${name}`)
    return tool.execute(args, { agent } as never)
  }
  const readCurrent = async (): Promise<CanvasBoard> => {
    const outcome = await board.readBoard({ canvasId })
    if (!outcome.ok) throw new Error('expected a readable board')
    return outcome.board
  }
  return { canvasId, execute, readCurrent }
}

describe('the canvas tools', () => {
  it('are named, described, and origin-tagged the documented no-import way', async () => {
    const fs = new FakeFs()
    const ctx = { fs, get: () => undefined } as unknown as Context
    const pad = new CanvasService(ctx)
    ;(ctx as { canvasStore?: CanvasService }).canvasStore = pad
    const board = new CanvasBoardService(ctx, { stateRoot: STATE })
    const tools = canvasToolDefinitions(board, 'canvas_01234567abcdefgh', FALLBACK, defaultCategories())
    expect(tools.map(def => def.name)).toEqual(['canvas_propose_card', 'canvas_comment'])
    for (const def of tools) {
      expect(def.description.length).toBeGreaterThan(0)
      expect((def as unknown as Record<PropertyKey, unknown>)[Symbol.for('dsh.tool.origin')]).toEqual({
        channel: 'plugin', owner: '@khorsheed/dsh-canvas',
      })
    }
  })

  it('canvas_propose_card lands a proposed agent card and answers its id', async () => {
    const { execute, readCurrent } = await harness()
    const answer = await execute('canvas_propose_card', {
      kind: 'reference', text: '效能假说综述',
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

  it('canvas_comment hangs an agent comment and moves an open question to exploring', async () => {
    const { execute, readCurrent } = await harness()
    await execute('canvas_propose_card', { kind: 'question', text: '效能感被忽视了吗？' })
    const withQuestion = await readCurrent()
    const cardId = withQuestion.cards[0]!.id
    expect(await execute('canvas_comment', { cardId, text: '这里隐含一个假设：效能感比恐惧解释力更强。有数据吗？' })).toBe('完成')
    const current = await readCurrent()
    expect(current.cards[0]?.comments[0]).toMatchObject({ author: 'agent', text: '这里隐含一个假设：效能感比恐惧解释力更强。有数据吗？' })
    expect(current.cards[0]?.question).toEqual({ state: 'exploring' })
  })

  it('answers the failure code instead of throwing on a bad card reference', async () => {
    const { execute } = await harness()
    expect(await execute('canvas_comment', { cardId: 'c_nope', text: 'x' })).toBe('失败：missing')
  })

  it('fences with the executing agent\'s own session when the run context carries one', async () => {
    const seen: Session[] = []
    const fs = new FakeFs()
    const ctx = { fs, get: () => undefined } as unknown as Context
    const pad = new CanvasService(ctx)
    ;(ctx as { canvasStore?: CanvasService }).canvasStore = pad
    const board = new CanvasBoardService(ctx, { stateRoot: STATE })
    const spy = new Proxy(board, {
      get(target, prop, receiver) {
        if (prop === 'proposeCard') {
          return async (request: unknown, session: Session) => {
            seen.push(session)
            return Reflect.get(target, prop, receiver).call(target, request, session)
          }
        }
        return Reflect.get(target, prop, receiver)
      },
    })
    const created = await board.createCanvas({ title: '主题' }, FALLBACK)
    if (!created.ok) throw new Error('expected a created canvas')
    const tools = canvasToolDefinitions(spy, created.board.id, FALLBACK, created.board.categories)
    const propose = tools.find(def => def.name === 'canvas_propose_card')!
    // No agent in the run context: the ask's session fences.
    await propose.execute({ kind: 'fragment', text: 'a' }, {} as never)
    expect(seen).toEqual([FALLBACK])
    // With one: the canvas agent's own session fences.
    const agent = { session: CANVAS_AGENT_SESSION } as unknown as Agent
    await propose.execute({ kind: 'fragment', text: 'b' }, { agent } as never)
    expect(seen).toEqual([FALLBACK, CANVAS_AGENT_SESSION])
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
    expect(tools.map(def => def.name)).toEqual(['canvas_propose_card', 'canvas_comment'])
    for (const def of tools) {
      expect((def as unknown as Record<PropertyKey, unknown>)[Symbol.for('dsh.tool.origin')]).toEqual({
        channel: 'plugin', owner: '@khorsheed/dsh-canvas',
      })
    }
    const agent = { session: FALLBACK } as unknown as Agent
    expect(await tools[0]!.execute({ kind: 'fragment', text: 'x' }, { agent } as never))
      .toBe('没有打开的画布：请先在右栏「画布详情」tab 打开一块画布，再让我改它。')
    expect(await tools[1]!.execute({ cardId: 'c_1', text: 'x' }, { agent } as never))
      .toBe('没有打开的画布：请先在右栏「画布详情」tab 打开一块画布，再让我改它。')
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
    const answer = await tools[0]!.execute({ kind: 'reference', text: '效能假说综述' }, { agent } as never)
    const read = await board.readBoard({ canvasId: created.board.id })
    if (!read.ok) throw new Error('expected a readable board')
    expect(read.board.cards).toHaveLength(1)
    expect(read.board.cards[0]).toMatchObject({ kind: 'reference', status: 'proposed', createdBy: 'agent' })
    expect(answer).toBe(`完成：${read.board.cards[0]!.id}`)
    expect(await tools[1]!.execute({ cardId: read.board.cards[0]!.id, text: '这里隐含一个假设。有数据吗？' }, { agent } as never)).toBe('完成')
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
    expect(await tools[0]!.execute({ kind: 'fragment', text: 'x' }, {} as never))
      .toBe('没有打开的画布：请先在右栏「画布详情」tab 打开一块画布，再让我改它。')
  })
})
