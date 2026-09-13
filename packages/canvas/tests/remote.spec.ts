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
import type {
  CanvasArchiveRequest, CanvasCreateRequest, CanvasWriteRequest,
} from '../src/types.ts'

const WS = '/ws'
const NAME = '文章/第一章 雨夜.md'

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

/** Mount the Remote over a recording store core in a bare context. */
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
  const ctx = new Context()
  ctx.provide('canvasStore', store as unknown as CanvasService)
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
