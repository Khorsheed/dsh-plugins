/**
 * The canvas Remote service: the wire's calling-agent convention on the three
 * mutating methods. A pad write is fenced by the CALLER's file policy and
 * workspace, which only the calling session knows, so every mutating method
 * must forward `agent.session` into the service core — a method that dropped it
 * would write at the deployment's own root (denied, or worse: somewhere else),
 * which is exactly the bug this convention fixes.
 *
 * The reads take no agent: a fence is a write fence, so a pad stays browsable
 * for a session that is only being read.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { CanvasRemoteService } from '../src/remote.ts'
import type { CanvasService } from '../src/service.ts'
import type { CanvasBoardService } from '../src/store.ts'
import type {
  BoardAddCommentRequest, BoardArchiveRequest, BoardAskAgentRequest, BoardCreateRequest,
  BoardPatchCardRequest, BoardPutCardRequest,
  CanvasArchiveRequest, CanvasCreateRequest, CanvasWriteRequest,
} from '../src/types.ts'

const WS = '/ws'
const NAME = '文章/第一章 雨夜.md'
const CANVAS_ID = 'canvas_01234567abcdefgh'

const CREATE: CanvasCreateRequest = { dir: WS, kind: 'article', title: '第一章 雨夜', content: '' }
const WRITE: CanvasWriteRequest = { dir: WS, name: NAME, content: 'a', version: '1' }
const ARCHIVE: CanvasArchiveRequest = { dir: WS, name: NAME, archived: true }

/** The session that owns the gesture, reachable only through the agent. */
const SESSION = { id: 's1', header: { cwd: WS } } as unknown as Session

/** One store call the fake saw, with whatever session it was handed. */
interface Seen {
  method: string
  session: unknown
}

/** A bare board receipt the fake board hands back for every mutation. */
function boardReceipt() {
  const now = '2026-09-16T00:00:00.000Z'
  return {
    ok: true as const,
    board: {
      id: CANVAS_ID, title: '主题', attachedWorkspaces: [], chat: { sessionId: null },
      cards: [], stats: { proposed: { accepted: 0, rejected: 0 }, kindCounts: {}, lastActiveAt: now },
      archivedAt: null, createdAt: now, updatedAt: now,
    },
    version: '2',
  }
}

/** Mount the Remote over recording service cores in a bare context. */
async function bench(): Promise<{ seen: Seen[]; remote: CanvasRemoteService; dispose: () => Promise<void> }> {
  const seen: Seen[] = []
  const receipt = {
    ok: true as const,
    name: NAME,
    title: '第一章 雨夜',
    version: '2',
    operation: 'create' as const,
    absolutePath: `${WS}/灵感画布/${NAME}`,
    relativePath: `灵感画布/${NAME}`,
  }
  const store = {
    list: async () => ({ items: [], archived: [] }),
    read: async () => ({ ok: false as const, error: 'missing' as const }),
    create: async (_request: CanvasCreateRequest, session: Session) => { seen.push({ method: 'create', session }); return receipt },
    write: async (_request: CanvasWriteRequest, session: Session) => { seen.push({ method: 'write', session }); return { ...receipt, operation: 'update' as const } },
    setArchived: async (_request: CanvasArchiveRequest, session: Session) => { seen.push({ method: 'setArchived', session }); return { ok: true as const } },
  }
  const board = {
    listCanvases: async () => ({ items: [] }),
    createCanvas: async (_request: BoardCreateRequest, session: Session) => { seen.push({ method: 'createCanvas', session }); return boardReceipt() },
    readBoard: async () => ({ ok: false as const, error: 'missing' as const }),
    putCard: async (_request: BoardPutCardRequest, session: Session) => { seen.push({ method: 'putCard', session }); return boardReceipt() },
    patchCard: async (_request: BoardPatchCardRequest, session: Session) => { seen.push({ method: 'patchCard', session }); return boardReceipt() },
    addComment: async (_request: BoardAddCommentRequest, session: Session) => { seen.push({ method: 'addComment', session }); return boardReceipt() },
    archiveCanvas: async (_request: BoardArchiveRequest, session: Session) => { seen.push({ method: 'archiveCanvas', session }); return boardReceipt() },
    deleteCanvas: async (_request: { canvasId: string }, session: Session) => { seen.push({ method: 'deleteCanvas', session }); return { ok: true as const } },
    deleteCard: async (_request: { canvasId: string; cardId: string }, session: Session) => { seen.push({ method: 'deleteCard', session }); return boardReceipt() },
    askAgent: async (_request: BoardAskAgentRequest, session: Session) => { seen.push({ method: 'askAgent', session }); return { ok: true as const, contextKey: `canvas:${CANVAS_ID}`, sent: true } },
    chatAvailable: () => ({ available: true }),
    focusCanvas: async (_request: { canvasId: string }, session: Session) => { seen.push({ method: 'focusCanvas', session }); return { ok: true as const } },
  }
  const ctx = new Context()
  ctx.provide('canvasStore', store as unknown as CanvasService)
  ctx.provide('canvasBoard', board as unknown as CanvasBoardService)
  const fiber = ctx.plugin(CanvasRemoteService, {})
  await fiber.await()
  return {
    seen,
    remote: ctx.get('canvasRemote') as CanvasRemoteService,
    dispose: async () => { await fiber.dispose() },
  }
}

describe('CanvasRemoteService', () => {
  it('forwards the calling agent\'s session on every mutating method', async () => {
    const { remote, seen, dispose } = await bench()
    const agent = { session: SESSION } as unknown as Agent
    expect(await remote.create(agent, CREATE)).toMatchObject({ ok: true, operation: 'create' })
    expect(await remote.write(agent, WRITE)).toMatchObject({ ok: true, operation: 'update' })
    expect(await remote.setArchived(agent, ARCHIVE)).toEqual({ ok: true })
    expect(seen).toEqual([
      { method: 'create', session: SESSION },
      { method: 'write', session: SESSION },
      { method: 'setArchived', session: SESSION },
    ])
    await dispose()
  })

  it('serves the reads without an agent', async () => {
    const { remote, dispose } = await bench()
    expect(await remote.list({ dir: WS })).toEqual({ items: [], archived: [] })
    expect(await remote.read({ dir: WS, name: NAME })).toEqual({ ok: false, error: 'missing' })
    await dispose()
  })
})

describe('CanvasRemoteService — the canvas space verbs', () => {
  it('forwards the calling agent\'s session on every mutating board verb', async () => {
    const { remote, seen, dispose } = await bench()
    const agent = { session: SESSION } as unknown as Agent
    expect(await remote.createCanvas(agent, { title: '主题' })).toMatchObject({ ok: true })
    expect(await remote.putCard(agent, { canvasId: CANVAS_ID, kind: 'fragment', text: 'x' })).toMatchObject({ ok: true })
    expect(await remote.patchCard(agent, { canvasId: CANVAS_ID, cardId: 'c_1', status: 'archived' })).toMatchObject({ ok: true })
    expect(await remote.addComment(agent, { canvasId: CANVAS_ID, cardId: 'c_1', text: 'x' })).toMatchObject({ ok: true })
    expect(await remote.archiveCanvas(agent, { canvasId: CANVAS_ID, archived: true })).toMatchObject({ ok: true })
    expect(await remote.deleteCard(agent, { canvasId: CANVAS_ID, cardId: 'c_1' })).toMatchObject({ ok: true })
    expect(await remote.deleteCanvas(agent, { canvasId: CANVAS_ID })).toEqual({ ok: true })
    expect(await remote.askAgent(agent, { canvasId: CANVAS_ID, lens: 'challenge' })).toMatchObject({ ok: true, sent: true })
    expect(await remote.focusCanvas(agent, { canvasId: CANVAS_ID })).toEqual({ ok: true })
    expect(seen).toEqual([
      { method: 'createCanvas', session: SESSION },
      { method: 'putCard', session: SESSION },
      { method: 'patchCard', session: SESSION },
      { method: 'addComment', session: SESSION },
      { method: 'archiveCanvas', session: SESSION },
      { method: 'deleteCard', session: SESSION },
      { method: 'deleteCanvas', session: SESSION },
      { method: 'askAgent', session: SESSION },
      { method: 'focusCanvas', session: SESSION },
    ])
    await dispose()
  })

  it('serves the board reads without an agent', async () => {
    const { remote, dispose } = await bench()
    expect(await remote.listCanvases()).toEqual({ items: [] })
    expect(await remote.readBoard({ canvasId: CANVAS_ID })).toEqual({ ok: false, error: 'missing' })
    expect(await remote.chatStatus()).toEqual({ available: true })
    await dispose()
  })
})
