/**
 * The canvas space service core against an in-memory filesystem: board
 * creation and listing, the version-guarded whole-board mutation (a stale
 * write re-reads and re-applies once, never overwrites unconditionally), the
 * card CRUD and the proposed/acceptance counters, the question lifecycle's
 * exploring rule, archive-never-deletes at both levels, the v1 pad import
 * (read-only; archived pad items stay behind), the canvas-id traversal guard,
 * and the re-rooted fence every mutation carries.
 *
 * The fence tests pin the state-dir probe's outcome: the caller's session
 * resolves the MODE (read-only still denies) and lends its id, while the
 * writable boundary is the plugin's own state root — never the session's
 * workspace, which can never hold deployment-level state.
 */
import { dirname, join, normalize } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { CanvasService } from '../src/service.ts'
import { CanvasBoardService } from '../src/store.ts'
import type { CanvasBoard } from '../src/types.ts'

type Entry = { kind: 'dir' } | { kind: 'file'; content: string; version: number }

/** The fence one write carried, as the service passed it. */
type SeenPolicy = { mode: string; workspaceRoot: string; sessionId?: string } | undefined

/** The deployment fallback root (a call with no policy lands here). */
const HOST_CWD = '/host-cwd'

/** The minimal `ctx.fs` the services touch, over a path → entry map. */
class FakeFs {
  private readonly entries = new Map<string, Entry>([['/', { kind: 'dir' }]])
  private seq = 0

  /** Present only when this fake stands in for a confining backend (dsh-fs-sandbox). */
  sandboxMode: 'workspace-write' | 'read-only' | 'danger-full-access' | undefined

  /** The fence each write carried, in call order (the fifth `writeText` argument). */
  readonly policies: SeenPolicy[] = []

  /** Plant a file directly (setup for corruption cases). */
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
    _signal?: unknown,
    policy?: SeenPolicy,
  ): Promise<{ operation: 'create' | 'update'; version: string; before: string | null; after: string }> {
    this.policies.push(policy)
    // Mirrors dsh-fs-sandbox's fence, mode included: read-only denies
    // everything; workspace-write contains under the policy's root (the
    // deployment's own when the call carries none).
    if (this.sandboxMode === 'read-only') {
      throw new FsError(`denied: ${target}`, 'FS_SANDBOX_DENIED')
    }
    if (this.sandboxMode !== undefined) {
      const root = policy?.workspaceRoot
        ?? (this.sandboxMode === 'danger-full-access' ? undefined : HOST_CWD)
      if (root !== undefined && target !== root && !target.startsWith(`${root}/`)) {
        throw new FsError(`denied: ${target}`, 'FS_SANDBOX_DENIED')
      }
    }
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

interface Bench {
  fs: FakeFs
  pad: CanvasService
  board: CanvasBoardService
}

/** One board service over a fresh fake filesystem — a backend that does not confine. */
function harness(): Bench {
  const fs = new FakeFs()
  const ctx = { fs } as unknown as Context
  const pad = new CanvasService(ctx)
  ;(ctx as { canvasStore?: CanvasService }).canvasStore = pad
  return { fs, pad, board: new CanvasBoardService(ctx, { stateRoot: STATE }) }
}

/**
 * One service pair over a confining fake plus the policy home: the caller's
 * session resolves the mode and id; the deployment default is workspace-write.
 */
function confiningHarness(mode: 'workspace-write' | 'read-only' = 'workspace-write'): Bench {
  const fs = new FakeFs()
  fs.sandboxMode = mode
  const sandboxPolicy = {
    resolve: (request?: { session?: { id: string; header: { cwd: string } } }) => ({
      mode,
      workspaceRoot: request?.session?.header.cwd ?? HOST_CWD,
      ...(request?.session === undefined ? {} : { sessionId: request.session.id }),
    }),
  }
  const ctx = { fs, get: (key: string) => key === 'sandboxPolicy' ? sandboxPolicy : undefined } as unknown as Context
  const pad = new CanvasService(ctx)
  ;(ctx as { canvasStore?: CanvasService }).canvasStore = pad
  return { fs, pad, board: new CanvasBoardService(ctx, { stateRoot: STATE }) }
}

/** Create one board and unwrap the success half (tests fail loud otherwise). */
async function createBoard(board: CanvasBoardService, title = '为什么人们不愿表达异议'): Promise<CanvasBoard> {
  const created = await board.createCanvas({ title, attachedWorkspaces: [WS] }, SESSION)
  if (!created.ok) throw new Error(`expected a created canvas, got ${created.error}`)
  return created.board
}

/** Read one board back and unwrap it. */
async function readBoard(board: CanvasBoardService, canvasId: string): Promise<CanvasBoard> {
  const read = await board.readBoard({ canvasId })
  if (!read.ok) throw new Error(`expected a readable board, got ${read.error}`)
  return read.board
}

describe('CanvasBoardService.createCanvas + readBoard', () => {
  it('round-trips a new board with a state-dir-shaped id', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    expect(created.id).toMatch(/^canvas_[a-z0-9]+$/)
    expect(created).toMatchObject({
      title: '为什么人们不愿表达异议',
      attachedWorkspaces: [WS],
      chat: { sessionId: null },
      cards: [],
      archivedAt: null,
      stats: { proposed: { accepted: 0, rejected: 0 }, kindCounts: {} },
    })
    expect(await readBoard(board, created.id)).toEqual(created)
  })

  it('refuses an empty title', async () => {
    const { board } = harness()
    expect(await board.createCanvas({ title: '   ' }, SESSION)).toEqual({ ok: false, error: 'invalid-name' })
  })

  it('reports a missing board and refuses an id that would escape the state root', async () => {
    const { board } = harness()
    expect(await board.readBoard({ canvasId: 'canvas_01234567abcdefgh' })).toEqual({ ok: false, error: 'missing' })
    expect(await board.readBoard({ canvasId: '../etc' })).toEqual({ ok: false, error: 'invalid-name' })
    expect(await board.putCard({ canvasId: '../etc', kind: 'fragment', text: 'x' }, SESSION))
      .toEqual({ ok: false, error: 'invalid-name' })
  })

  it('reports a corrupt canvas.json instead of rewriting it', async () => {
    const { fs, board } = harness()
    const created = await createBoard(board)
    fs.seed(`${STATE}/${created.id}/canvas.json`, '{ not json')
    const writesBefore = fs.policies.length
    expect(await board.readBoard({ canvasId: created.id })).toEqual({ ok: false, error: 'io' })
    expect(await board.putCard({ canvasId: created.id, kind: 'fragment', text: 'x' }, SESSION))
      .toEqual({ ok: false, error: 'io' })
    // The corrupt file survived — the mutation refused to clobber it.
    expect(fs.policies).toHaveLength(writesBefore)
  })
})

describe('CanvasBoardService.listCanvases', () => {
  it('reports an empty state root rather than failing', async () => {
    const { board } = harness()
    expect(await board.listCanvases()).toEqual({ items: [] })
  })

  it('lists newest-active first and skips foreign directories and corrupt files', async () => {
    const { fs, board } = harness()
    const first = await createBoard(board, 'first')
    const second = await createBoard(board, 'second')
    // first is older: a mutation on it makes it the most recently active.
    await board.putCard({ canvasId: first.id, kind: 'fragment', text: 'revived' }, SESSION)
    fs.seed(`${STATE}/not-a-canvas/canvas.json`, '{}')
    fs.seed(`${STATE}/canvas_broken01abcd/canvas.json`, '{ nope')
    const listed = await board.listCanvases()
    expect(listed.items.map(item => item.title)).toEqual(['first', 'second'])
    expect(listed.items[0]).toMatchObject({ id: first.id, cardCount: 1, openQuestions: 0, archivedAt: null })
  })
})

describe('CanvasBoardService.putCard', () => {
  it('adds a kept user card and feeds the kind counts', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    const put = await board.putCard({ canvasId: created.id, kind: 'fragment', text: '  沉默并不总是因为恐惧  ' }, SESSION)
    if (!put.ok) throw new Error('expected the card to land')
    expect(put.board.cards).toHaveLength(1)
    expect(put.board.cards[0]).toMatchObject({
      kind: 'fragment', text: '沉默并不总是因为恐惧', status: 'kept', createdBy: 'user', comments: [],
    })
    expect(put.board.cards[0]?.question).toBeUndefined()
    expect(put.board.stats.kindCounts).toEqual({ fragment: 1 })
  })

  it('starts a question card open', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    const put = await board.putCard({ canvasId: created.id, kind: 'question', text: '不表达是因为害怕吗？' }, SESSION)
    if (!put.ok) throw new Error('expected the card to land')
    expect(put.board.cards[0]?.question).toEqual({ state: 'open' })
  })

  it('refuses an empty text and a foreign kind', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    expect(await board.putCard({ canvasId: created.id, kind: 'fragment', text: '   ' }, SESSION))
      .toEqual({ ok: false, error: 'invalid-name' })
    expect(await board.putCard({ canvasId: created.id, kind: 'misc' as never, text: 'x' }, SESSION))
      .toEqual({ ok: false, error: 'invalid-name' })
  })
})

describe('CanvasBoardService.patchCard', () => {
  it('edits text and refuses an empty replacement', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    const put = await board.putCard({ canvasId: created.id, kind: 'fragment', text: '初稿' }, SESSION)
    if (!put.ok) throw new Error('expected the card to land')
    const cardId = put.board.cards[0]!.id
    const patched = await board.patchCard({ canvasId: created.id, cardId, text: '改过的' }, SESSION)
    if (!patched.ok) throw new Error('expected the patch to land')
    expect(patched.board.cards[0]?.text).toBe('改过的')
    expect(await board.patchCard({ canvasId: created.id, cardId, text: '  ' }, SESSION))
      .toEqual({ ok: false, error: 'invalid-name' })
    expect(await board.patchCard({ canvasId: created.id, cardId: 'c_nope', text: 'x' }, SESSION))
      .toEqual({ ok: false, error: 'missing' })
  })

  it('counts the ghost verdicts: proposed → kept is accepted, → archived is rejected', async () => {
    const { fs, board } = harness()
    const created = await createBoard(board)
    // Two proposed cards land the way M3's agent path will: planted directly.
    const current = await readBoard(board, created.id)
    const now = new Date().toISOString()
    const withProposed: CanvasBoard = {
      ...current,
      cards: [
        { id: 'c_a', kind: 'reference', text: '效能假说综述', status: 'proposed', comments: [], createdBy: 'agent', createdAt: now, updatedAt: now },
        { id: 'c_b', kind: 'fragment', text: '反例笔记', status: 'proposed', comments: [], createdBy: 'agent', createdAt: now, updatedAt: now },
      ],
    }
    const read = await board.readBoard({ canvasId: created.id })
    if (!read.ok) throw new Error('expected a readable board')
    await fs.writeText(`${STATE}/${created.id}/canvas.json`, `${JSON.stringify(withProposed)}\n`, { kind: 'replaceIfVersion', version: read.version })

    const accepted = await board.patchCard({ canvasId: created.id, cardId: 'c_a', status: 'kept' }, SESSION)
    if (!accepted.ok) throw new Error('expected accept to land')
    expect(accepted.board.stats.proposed).toEqual({ accepted: 1, rejected: 0 })
    expect(accepted.board.stats.kindCounts).toEqual({ reference: 1, fragment: 1 })

    const rejected = await board.patchCard({ canvasId: created.id, cardId: 'c_b', status: 'archived' }, SESSION)
    if (!rejected.ok) throw new Error('expected reject to land')
    expect(rejected.board.stats.proposed).toEqual({ accepted: 1, rejected: 1 })
    // Rejection archives, never deletes — the card is still on the board.
    expect(rejected.board.cards).toHaveLength(2)
    expect(rejected.board.stats.kindCounts).toEqual({ reference: 1 })
  })

  it('does not count a kept → archived transition as a ghost verdict', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    const put = await board.putCard({ canvasId: created.id, kind: 'fragment', text: '自己的卡' }, SESSION)
    if (!put.ok) throw new Error('expected the card to land')
    const archived = await board.patchCard({ canvasId: created.id, cardId: put.board.cards[0]!.id, status: 'archived' }, SESSION)
    if (!archived.ok) throw new Error('expected archive to land')
    expect(archived.board.stats.proposed).toEqual({ accepted: 0, rejected: 0 })
    expect(archived.board.stats.kindCounts).toEqual({})
  })

  it('settles a question answered; refuses a foreign status', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    const put = await board.putCard({ canvasId: created.id, kind: 'question', text: '为什么？' }, SESSION)
    if (!put.ok) throw new Error('expected the card to land')
    const cardId = put.board.cards[0]!.id
    const settled = await board.patchCard({ canvasId: created.id, cardId, question: { state: 'answered' } }, SESSION)
    if (!settled.ok) throw new Error('expected settle to land')
    expect(settled.board.cards[0]?.question).toEqual({ state: 'answered' })
    expect(await board.patchCard({ canvasId: created.id, cardId, status: 'deleted' as never }, SESSION))
      .toEqual({ ok: false, error: 'invalid-name' })
  })
})

describe('CanvasBoardService.addComment', () => {
  it('appends a user comment without touching the question state', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    const put = await board.putCard({ canvasId: created.id, kind: 'question', text: '为什么？' }, SESSION)
    if (!put.ok) throw new Error('expected the card to land')
    const commented = await board.addComment({ canvasId: created.id, cardId: put.board.cards[0]!.id, text: '我自己先记一笔' }, SESSION)
    if (!commented.ok) throw new Error('expected the comment to land')
    expect(commented.board.cards[0]?.comments).toHaveLength(1)
    expect(commented.board.cards[0]?.comments[0]).toMatchObject({ author: 'user', text: '我自己先记一笔' })
    expect(commented.board.cards[0]?.question).toEqual({ state: 'open' })
  })

  it('moves an open question to exploring on an AGENT comment (the §4 rule), never to answered', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    const put = await board.putCard({ canvasId: created.id, kind: 'question', text: '为什么？' }, SESSION)
    if (!put.ok) throw new Error('expected the card to land')
    const commented = await board.addComment({ canvasId: created.id, cardId: put.board.cards[0]!.id, text: '这里隐含一个假设', author: 'agent' }, SESSION)
    if (!commented.ok) throw new Error('expected the comment to land')
    expect(commented.board.cards[0]?.question).toEqual({ state: 'exploring' })
    // A second agent comment does not push it further — answered is the user's.
    const again = await board.addComment({ canvasId: created.id, cardId: put.board.cards[0]!.id, text: '再追问一层', author: 'agent' }, SESSION)
    if (!again.ok) throw new Error('expected the comment to land')
    expect(again.board.cards[0]?.question).toEqual({ state: 'exploring' })
  })

  it('refuses an empty comment and a missing card', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    const put = await board.putCard({ canvasId: created.id, kind: 'fragment', text: 'x' }, SESSION)
    if (!put.ok) throw new Error('expected the card to land')
    expect(await board.addComment({ canvasId: created.id, cardId: put.board.cards[0]!.id, text: ' ' }, SESSION))
      .toEqual({ ok: false, error: 'invalid-name' })
    expect(await board.addComment({ canvasId: created.id, cardId: 'c_nope', text: 'x' }, SESSION))
      .toEqual({ ok: false, error: 'missing' })
  })
})

describe('CanvasBoardService.archiveCanvas', () => {
  it('hides a canvas and restores it; the file is never deleted', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    const archived = await board.archiveCanvas({ canvasId: created.id, archived: true }, SESSION)
    if (!archived.ok) throw new Error('expected archive to land')
    expect(archived.board.archivedAt).not.toBeNull()
    expect((await board.listCanvases()).items[0]?.archivedAt).not.toBeNull()
    const restored = await board.archiveCanvas({ canvasId: created.id, archived: false }, SESSION)
    if (!restored.ok) throw new Error('expected restore to land')
    expect(restored.board.archivedAt).toBeNull()
    // And the board content rode through both transitions untouched.
    expect(await readBoard(board, created.id)).toMatchObject({ title: '为什么人们不愿表达异议' })
  })
})

describe('the whole-board version guard', () => {
  it('re-reads and re-applies once on a stale write — never an unconditional overwrite', async () => {
    const { fs, board } = harness()
    const created = await createBoard(board)
    // An external writer moves the file between our read and our write.
    const read = await board.readBoard({ canvasId: created.id })
    if (!read.ok) throw new Error('expected a readable board')
    const external: CanvasBoard = {
      ...read.board,
      cards: [{ id: 'c_ext', kind: 'fragment', text: '另一个窗口加的', status: 'kept', comments: [], createdBy: 'user', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    }
    await fs.writeText(`${STATE}/${created.id}/canvas.json`, `${JSON.stringify(external)}\n`, { kind: 'replaceIfVersion', version: read.version })
    const put = await board.putCard({ canvasId: created.id, kind: 'question', text: '这边的问题' }, SESSION)
    if (!put.ok) throw new Error('expected the retry to land')
    // Both cards survive: the mutation re-applied onto the fresh board.
    expect(put.board.cards.map(card => card.text)).toEqual(['另一个窗口加的', '这边的问题'])
    expect(put.board.stats.kindCounts).toEqual({ fragment: 1, question: 1 })
  })
})

describe('CanvasBoardService.importV1', () => {
  it('copies the pad read-only: cards become fragments, articles documents, sources point back', async () => {
    const { fs, pad, board } = harness()
    await pad.create({ dir: WS, kind: 'card', title: '雨伞的意象', content: '卡片正文' }, SESSION)
    await pad.create({ dir: WS, kind: 'article', title: '第一章 雨夜', content: '文章正文' }, SESSION)
    await pad.create({ dir: WS, kind: 'card', title: '归档的旧卡', content: '不进新画布' }, SESSION)
    await pad.setArchived({ dir: WS, name: '卡片/归档的旧卡.md', archived: true }, SESSION)

    const imported = await board.importV1({ dir: WS }, SESSION)
    if (!imported.ok) throw new Error(`expected the import to land, got ${imported.error}`)
    expect(imported.imported).toBe(2)
    expect(imported.board.title).toBe('导入：ws')
    expect(imported.board.attachedWorkspaces).toEqual([WS])
    const byKind = Object.fromEntries(imported.board.cards.map(card => [card.kind, card]))
    expect(byKind['fragment']).toMatchObject({
      text: '卡片正文',
      status: 'kept',
      source: { type: 'file', ref: `${WS}/灵感画布/卡片/雨伞的意象.md`, title: '雨伞的意象' },
    })
    expect(byKind['document']).toMatchObject({
      text: '文章正文',
      source: { type: 'file', ref: `${WS}/灵感画布/文章/第一章 雨夜.md`, title: '第一章 雨夜' },
    })
    expect(imported.board.stats.kindCounts).toEqual({ fragment: 1, document: 1 })
    // The pad itself is untouched — import is a read-only copy.
    expect(await pad.read({ dir: WS, name: '卡片/雨伞的意象.md' })).toMatchObject({ ok: true, content: '卡片正文' })
    expect((await pad.list(WS)).items).toHaveLength(2)
    expect(fs.policies.every(policy => policy === undefined)).toBe(true)
  })

  it('honors an explicit title and reports a workspace with no pad items', async () => {
    const { pad, board } = harness()
    expect(await board.importV1({ dir: WS }, SESSION)).toEqual({ ok: false, error: 'missing' })
    await pad.create({ dir: WS, kind: 'card', title: '雨伞的意象', content: '卡片正文' }, SESSION)
    const imported = await board.importV1({ dir: WS, title: '我的主题画布' }, SESSION)
    if (!imported.ok) throw new Error('expected the import to land')
    expect(imported.board.title).toBe('我的主题画布')
    expect(imported.imported).toBe(1)
  })
})

describe('CanvasBoardService fencing', () => {
  it('re-roots the fence at the state dir: the session resolves mode and id, never the boundary', async () => {
    const { fs, board } = confiningHarness()
    expect(await board.createCanvas({ title: '主题' }, SESSION)).toMatchObject({ ok: true })
    expect(fs.policies).toEqual([
      { mode: 'workspace-write', workspaceRoot: STATE, sessionId: 's1' },
    ])
  })

  it('stays fail-closed under read-only: the mode the session resolves still denies', async () => {
    const { board } = confiningHarness('read-only')
    expect(await board.createCanvas({ title: '主题' }, SESSION))
      .toEqual({ ok: false, error: 'denied' })
  })

  it('writes inside the state root for a session whose own workspace is elsewhere', async () => {
    const { fs, board } = confiningHarness()
    const foreign = { id: 's2', header: { cwd: '/other-ws' } } as unknown as Session
    // Deployment-level state is every session's to reach; the boundary is the
    // state dir itself, so a foreign workspace is not a denial here (it is
    // the pad service that denies this same session).
    expect(await board.createCanvas({ title: '主题' }, foreign)).toMatchObject({ ok: true })
    expect(fs.policies[0]).toMatchObject({ workspaceRoot: STATE, sessionId: 's2' })
  })

  it('carries no policy at all when the mounted filesystem does not confine', async () => {
    const { fs, board } = harness()
    await board.createCanvas({ title: '主题' }, SESSION)
    expect(fs.policies).toEqual([undefined])
  })
})

describe('CanvasBoardService.focusCanvas', () => {
  it('records the open canvas per session and answers it back', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    expect(board.focusedCanvasId(SESSION)).toBeUndefined()
    expect(await board.focusCanvas({ canvasId: created.id }, SESSION)).toEqual({ ok: true })
    expect(board.focusedCanvasId(SESSION)).toBe(created.id)
    // Another session has its own focus, or none.
    const other = { id: 's2', header: { cwd: WS } } as unknown as Session
    expect(board.focusedCanvasId(other)).toBeUndefined()
  })

  it('refuses a missing canvas and an unusable id', async () => {
    const { board } = harness()
    expect(await board.focusCanvas({ canvasId: 'canvas_01234567abcdefgh' }, SESSION))
      .toEqual({ ok: false, error: 'missing' })
    expect(await board.focusCanvas({ canvasId: '../etc' }, SESSION))
      .toEqual({ ok: false, error: 'invalid-name' })
  })
})

describe('CanvasBoardService draft', () => {
  it('reads an absent draft as empty with a null token, and errors a missing canvas', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    expect(await board.readDraft({ canvasId: created.id })).toEqual({ ok: true, content: '', version: null })
    expect(await board.readDraft({ canvasId: 'canvas_01234567abcdefgh' })).toEqual({ ok: false, error: 'missing' })
    expect(await board.readDraft({ canvasId: '../etc' })).toEqual({ ok: false, error: 'invalid-name' })
  })

  it('creates the draft on a null token and round-trips it', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    const written = await board.writeDraft({ canvasId: created.id, content: '# 初稿\n\n正文。', version: null }, SESSION)
    if (!written.ok) throw new Error(`expected the draft to land, got ${written.error}`)
    expect(await board.readDraft({ canvasId: created.id }))
      .toEqual({ ok: true, content: '# 初稿\n\n正文。', version: written.version })
  })

  it('refuses a second create and a stale overwrite — the manuscript is never clobbered', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    const first = await board.writeDraft({ canvasId: created.id, content: '一', version: null }, SESSION)
    if (!first.ok) throw new Error('expected the draft to land')
    expect(await board.writeDraft({ canvasId: created.id, content: '二', version: null }, SESSION))
      .toEqual({ ok: false, error: 'exists' })
    expect(await board.writeDraft({ canvasId: created.id, content: '二', version: '999' }, SESSION))
      .toEqual({ ok: false, error: 'stale' })
    const second = await board.writeDraft({ canvasId: created.id, content: '二', version: first.version }, SESSION)
    if (!second.ok) throw new Error('expected the guarded write to land')
    expect(await board.readDraft({ canvasId: created.id })).toEqual({ ok: true, content: '二', version: second.version })
  })

  it('fences the draft write at the state dir (the re-rooted fence, mode preserved)', async () => {
    const { fs, board } = confiningHarness()
    const created = await createBoard(board)
    fs.policies.length = 0
    expect(await board.writeDraft({ canvasId: created.id, content: 'x', version: null }, SESSION))
      .toEqual({ ok: true, version: expect.any(String) })
    expect(fs.policies).toEqual([{ mode: 'workspace-write', workspaceRoot: STATE, sessionId: 's1' }])
  })

  it('refuses the draft write under read-only', async () => {
    const { fs, board } = confiningHarness('read-only')
    // Seed the canvas itself directly (its creation would also be denied here).
    const now = new Date().toISOString()
    fs.seed(`${STATE}/canvas_01234567abcdefgh/canvas.json`, `${JSON.stringify({
      id: 'canvas_01234567abcdefgh', title: '主题', attachedWorkspaces: [], chat: { sessionId: null },
      cards: [], stats: { proposed: { accepted: 0, rejected: 0 }, kindCounts: {}, lastActiveAt: now },
      archivedAt: null, createdAt: now, updatedAt: now,
    })}\n`)
    expect(await board.writeDraft({ canvasId: 'canvas_01234567abcdefgh', content: 'x', version: null }, SESSION))
      .toEqual({ ok: false, error: 'denied' })
  })
})
