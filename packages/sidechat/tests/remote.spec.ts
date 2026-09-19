/**
 * The side-chat Remote service: the wire's calling-agent convention. The two
 * mutating verbs (`send`, `quoteMessage`) write plugin state fenced by the
 * caller's own session, so they must forward the agent untouched — a verb
 * that dropped it would write unfenced and send from nobody. The reads take
 * no agent: a cold context answers from persistence, and no read ever
 * resumes an agent.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { SideChatRemoteService } from '../src/remote.ts'
import type { SideChatService } from '../src/service.ts'
import type { SideChatQuoteRequest, SideChatSendRequest } from '../src/types.ts'

/** The session that owns the gesture, reachable only through the agent. */
const SESSION = { id: 's1', header: { cwd: '/home/user/work/main' } } as unknown as Session

/** One service-core call the fake saw, with whatever agent it was handed. */
interface Seen {
  method: string
  agent: unknown
}

/** Mount the Remote over a recording service core in a bare context. */
async function bench(): Promise<{ seen: Seen[]; remote: SideChatRemoteService; dispose: () => Promise<void> }> {
  const seen: Seen[] = []
  const core = {
    getState: async () => ({ ok: false as const, error: 'not-found' as const }),
    listContexts: async () => ({ items: [] }),
    surfaceHints: async () => ({ items: [{ contextKey: 'k', rev: 2 }] }),
    send: async (agent: Agent, _request: SideChatSendRequest) => {
      seen.push({ method: 'send', agent })
      return { ok: true as const, state: { contextKey: 'k', label: 'k', status: 'running' as const, refs: [], transcript: [] } }
    },
    quoteMessage: async (agent: Agent, _request: SideChatQuoteRequest) => {
      seen.push({ method: 'quoteMessage', agent })
      return { ok: true as const, contextKey: 's1', refs: 1 }
    },
  }
  const ctx = new Context()
  ctx.provide('sideChat', core as unknown as SideChatService)
  const fiber = ctx.plugin(SideChatRemoteService, {})
  await fiber.await()
  return {
    seen,
    remote: ctx.get('sidechatRemote') as SideChatRemoteService,
    dispose: async () => { await fiber.dispose() },
  }
}

describe('SideChatRemoteService', () => {
  it('forwards the calling agent untouched on both mutating verbs', async () => {
    const { remote, seen, dispose } = await bench()
    const agent = { session: SESSION } as unknown as Agent
    expect(await remote.send(agent, { contextKey: 'k', text: '问' })).toMatchObject({ ok: true, state: { status: 'running' } })
    expect(await remote.quoteMessage(agent, { messageId: 'm1' })).toEqual({ ok: true, contextKey: 's1', refs: 1 })
    expect(seen).toEqual([
      { method: 'send', agent },
      { method: 'quoteMessage', agent },
    ])
    await dispose()
  })

  it('serves the reads without an agent', async () => {
    const { remote, dispose } = await bench()
    expect(await remote.getState({ contextKey: 'k' })).toEqual({ ok: false, error: 'not-found' })
    expect(await remote.listContexts()).toEqual({ items: [] })
    expect(await remote.surfaceHints()).toEqual({ items: [{ contextKey: 'k', rev: 2 }] })
    await dispose()
  })
})
