/**
 * The M2 chat integration host side: `askAgent` primes the canvas's context
 * through the probed side-chat seam (contextKey, label, per-turn prompt
 * segment, the two tagged tools, selected cards as opaque refs), auto-sends
 * the lens template or the gesture's free text, primes-only for `ask`, and
 * answers `unavailable` when no sideChat-shaped service is mounted. Also the
 * agent's card entrance `proposeCard` (proposed, createdBy agent, a question
 * starting OPEN even with a rationale comment).
 *
 * The fake sideChat records `openWith`'s input verbatim — the prompt contract
 * is asserted from it, never by string-matching inside the renderer.
 */
import { dirname, join, normalize } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { CanvasService } from '../src/service.ts'
import { CanvasBoardService, type SideChatMirror } from '../src/store.ts'
import type { BoardRef, CanvasBoard } from '../src/types.ts'

type Entry = { kind: 'dir' } | { kind: 'file'; content: string; version: number }

/** The minimal `ctx.fs` the services touch, over a path → entry map. */
class FakeFs {
  private readonly entries = new Map<string, Entry>([['/', { kind: 'dir' }]])
  private seq = 0

  seed(path: string, content: string): void {
    this.mkdirp(dirname(path))
    this.entries.set(path, { kind: 'file', content, version: ++this.seq })
  }

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
const SESSION = { id: 's1', header: { cwd: WS } } as unknown as Session

/** One recorded openWith call, verbatim. */
interface SeenOpen {
  contextKey: string
  label: string
  systemPrompt?: string
  tools?: readonly ToolDefinition[]
  refs?: readonly BoardRef[]
}

/** One recorded send call. */
interface SeenSend {
  calling: { session: unknown }
  request: { contextKey: string; text: string }
}

/** The fake side-chat seam: records, and can be told to throw. */
class FakeSideChat implements SideChatMirror {
  readonly opens: SeenOpen[] = []
  readonly sends: SeenSend[] = []
  failOn: 'openWith' | 'send' | null = null

  async openWith(input: SeenOpen): Promise<void> {
    if (this.failOn === 'openWith') throw new Error('boom')
    this.opens.push(input)
  }

  async send(calling: { session: unknown }, request: { contextKey: string; text: string }): Promise<void> {
    if (this.failOn === 'send') throw new Error('boom')
    this.sends.push({ calling, request })
  }
}

interface Bench {
  board: CanvasBoardService
  sideChat: FakeSideChat
  create: (title?: string) => Promise<CanvasBoard>
}

/** One board service over a fresh fake fs, with the fake seam mounted (or not). */
function harness(options: { withSideChat?: boolean } = {}): Bench {
  const fs = new FakeFs()
  const sideChat = new FakeSideChat()
  const ctx = {
    fs,
    get: (key: string) => key === 'sideChat' && options.withSideChat !== false ? sideChat : undefined,
  } as unknown as Context
  const pad = new CanvasService(ctx)
  ;(ctx as { canvasStore?: CanvasService }).canvasStore = pad
  const board = new CanvasBoardService(ctx, { stateRoot: STATE })
  const create = async (title = '为什么人们不愿表达异议'): Promise<CanvasBoard> => {
    const created = await board.createCanvas({ title, attachedWorkspaces: [WS] }, SESSION)
    if (!created.ok) throw new Error(`expected a created canvas, got ${created.error}`)
    return created.board
  }
  return { board, sideChat, create }
}

describe('CanvasBoardService.askAgent — the priming contract', () => {
  it('primes the context: key, label, prompt segment, tagged tools, selected cards as refs', async () => {
    const { board, sideChat, create } = harness()
    const created = await create()
    const put = await board.putCard({ canvasId: created.id, kind: 'fragment', text: '沉默并不总是因为恐惧' }, SESSION)
    if (!put.ok) throw new Error('expected the card to land')
    const cardId = put.board.cards[0]!.id

    const asked = await board.askAgent({ canvasId: created.id, cardIds: [cardId, 'c_missing'] }, SESSION)
    expect(asked).toEqual({ ok: true, contextKey: `canvas:${created.id}`, sent: false })

    expect(sideChat.opens).toHaveLength(1)
    const open = sideChat.opens[0]!
    expect(open.contextKey).toBe(`canvas:${created.id}`)
    expect(open.label).toBe('为什么人们不愿表达异议')
    // The missing card id dropped out; the real one became an opaque ref.
    expect(open.refs).toEqual([
      { label: '沉默并不总是因为恐惧', text: '[fragment] 沉默并不总是因为恐惧' },
    ])
    // The prompt segment: topic, board summary, tool contract, lens semantics.
    expect(open.systemPrompt).toContain('画布「为什么人们不愿表达异议」')
    expect(open.systemPrompt).toContain('fragment 1')
    expect(open.systemPrompt).toContain('沉默并不总是因为恐惧')
    expect(open.systemPrompt).toContain('canvas_propose_card')
    expect(open.systemPrompt).toContain('canvas_comment')
    expect(open.systemPrompt).toContain('透镜语义')
    // Two tools, both origin-tagged the documented no-import way.
    expect(open.tools?.map(def => def.name)).toEqual(['canvas_propose_card', 'canvas_comment'])
    for (const def of open.tools ?? []) {
      expect((def as unknown as Record<PropertyKey, unknown>)[Symbol.for('dsh.tool.origin')]).toEqual({
        channel: 'plugin', owner: '@khorsheed/dsh-canvas',
      })
    }
  })

  it('lists open questions and guards grounding in the segment', async () => {
    const { board, sideChat, create } = harness()
    const created = await create()
    await board.putCard({ canvasId: created.id, kind: 'question', text: '不表达是因为害怕吗？' }, SESSION)
    await board.putCard({ canvasId: created.id, kind: 'grounding', text: '沉默可能源于效能感丧失' }, SESSION)
    await board.askAgent({ canvasId: created.id }, SESSION)
    const segment = sideChat.opens[0]!.systemPrompt!
    expect(segment).toContain('未决问题')
    expect(segment).toContain('待探索')
    expect(segment).toContain('不可违背')
    expect(segment).toContain('沉默可能源于效能感丧失')
  })

  it('adds the stats feedback section only when the samples say so', async () => {
    const { board, sideChat, create } = harness()
    const created = await create()
    // Six rejections and one accept put the rate under 30% at ≥5 samples.
    for (let index = 0; index < 7; index += 1) {
      const proposed = await board.proposeCard({ canvasId: created.id, kind: 'fragment', text: `提议 ${index}` }, SESSION)
      if (!proposed.ok) throw new Error('expected the proposal to land')
      const cardId = proposed.board.cards[proposed.board.cards.length - 1]!.id
      await board.patchCard({ canvasId: created.id, cardId, status: index === 0 ? 'kept' : 'archived' }, SESSION)
    }
    await board.askAgent({ canvasId: created.id }, SESSION)
    expect(sideChat.opens[0]!.systemPrompt).toContain('收紧提议')
  })
})

describe('CanvasBoardService.askAgent — send rules and degradation', () => {
  it('auto-sends the lens template for a non-ask lens', async () => {
    const { board, sideChat, create } = harness()
    const created = await create()
    const asked = await board.askAgent({ canvasId: created.id, lens: 'challenge' }, SESSION)
    expect(asked).toMatchObject({ ok: true, sent: true })
    expect(sideChat.sends).toHaveLength(1)
    expect(sideChat.sends[0]!.request.contextKey).toBe(`canvas:${created.id}`)
    expect(sideChat.sends[0]!.request.text).toContain('挑战假设')
    expect(sideChat.sends[0]!.request.text).toContain('canvas_comment')
    expect(sideChat.sends[0]!.calling.session).toBe(SESSION)
  })

  it('sends the free text when given (it outranks the lens template)', async () => {
    const { board, sideChat, create } = harness()
    const created = await create()
    const asked = await board.askAgent({ canvasId: created.id, lens: 'evidence', text: '就这条评论继续追问：有数据吗？' }, SESSION)
    expect(asked).toMatchObject({ ok: true, sent: true })
    expect(sideChat.sends[0]!.request.text).toBe('就这条评论继续追问：有数据吗？')
  })

  it('primes only for the ask lens (the user types the question in the tab)', async () => {
    const { board, sideChat, create } = harness()
    const created = await create()
    const asked = await board.askAgent({ canvasId: created.id, lens: 'ask', refs: [{ label: '选区', text: '选中的一段原文' }] }, SESSION)
    expect(asked).toMatchObject({ ok: true, sent: false })
    expect(sideChat.sends).toHaveLength(0)
    expect(sideChat.opens[0]!.refs).toEqual([{ label: '选区', text: '选中的一段原文' }])
  })

  it('answers unavailable when no sideChat-shaped service is mounted', async () => {
    const { board, create } = harness({ withSideChat: false })
    const created = await create()
    expect(await board.askAgent({ canvasId: created.id, lens: 'challenge' }, SESSION))
      .toEqual({ ok: false, error: 'unavailable' })
    expect(board.chatAvailable()).toEqual({ available: false })
  })

  it('reports the mounted seam in chatAvailable', async () => {
    const { board } = harness()
    expect(board.chatAvailable()).toEqual({ available: true })
  })

  it('refuses an unusable canvas id, a missing board, and a foreign lens', async () => {
    const { board, create } = harness()
    const created = await create()
    expect(await board.askAgent({ canvasId: '../etc' }, SESSION)).toEqual({ ok: false, error: 'invalid-name' })
    expect(await board.askAgent({ canvasId: 'canvas_01234567abcdefgh' }, SESSION)).toEqual({ ok: false, error: 'missing' })
    expect(await board.askAgent({ canvasId: created.id, lens: 'destroy' as never }, SESSION)).toEqual({ ok: false, error: 'invalid-name' })
  })

  it('maps a seam failure to io instead of throwing', async () => {
    const { board, sideChat, create } = harness()
    const created = await create()
    sideChat.failOn = 'openWith'
    expect(await board.askAgent({ canvasId: created.id }, SESSION)).toEqual({ ok: false, error: 'io' })
  })
})

describe('CanvasBoardService.proposeCard — the agent entrance', () => {
  it('lands proposed with createdBy agent and the rationale hung as a comment', async () => {
    const { board, create } = harness()
    const created = await create()
    const proposed = await board.proposeCard({
      canvasId: created.id, kind: 'reference', text: '效能假说综述（2023）',
      source: { type: 'url', ref: 'https://example.org/paper', title: 'paper' },
      comment: '为「效能感」论点找的支撑',
    }, SESSION)
    if (!proposed.ok) throw new Error('expected the proposal to land')
    const card = proposed.board.cards[0]!
    expect(card).toMatchObject({
      kind: 'reference', status: 'proposed', createdBy: 'agent',
      source: { type: 'url', ref: 'https://example.org/paper', title: 'paper' },
    })
    expect(card.comments).toEqual([
      expect.objectContaining({ author: 'agent', text: '为「效能感」论点找的支撑' }),
    ])
    // Proposed cards are visible but not counted as verdicts yet.
    expect(proposed.board.stats.kindCounts).toEqual({ reference: 1 })
    expect(proposed.board.stats.proposed).toEqual({ accepted: 0, rejected: 0 })
  })

  it('starts a proposed question card OPEN even with a rationale comment', async () => {
    const { board, create } = harness()
    const created = await create()
    const proposed = await board.proposeCard({
      canvasId: created.id, kind: 'question', text: '效能感被忽视了吗？', comment: '值得追问',
    }, SESSION)
    if (!proposed.ok) throw new Error('expected the proposal to land')
    expect(proposed.board.cards[0]?.question).toEqual({ state: 'open' })
  })

  it('refuses an empty text and a foreign kind', async () => {
    const { board, create } = harness()
    const created = await create()
    expect(await board.proposeCard({ canvasId: created.id, kind: 'fragment', text: '  ' }, SESSION))
      .toEqual({ ok: false, error: 'invalid-name' })
    expect(await board.proposeCard({ canvasId: created.id, kind: 'misc' as never, text: 'x' }, SESSION))
      .toEqual({ ok: false, error: 'invalid-name' })
  })
})
