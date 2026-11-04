/**
 * Native DSH sub-members were retired on 2026-10-29 (a dsh command-line
 * member is their successor): the host presets still serve as members'
 * modes, an invite no longer makes a native member, and an older journal's
 * native member stays off the roster — its rows remain, nothing dispatches
 * to it.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import RoomService from '../src/index.ts'
import { createRoom } from './promote.ts'
import { withRunEntry } from './run-entry-shim.ts'

/** A live agent whose turn "answers" with a scripted assistant text. */
function scriptedAgent(id: SessionId, reply: () => string) {
  const events: { seq: number; type: string; data: unknown }[] = []
  const agent = {
    id,
    session: { id, snapshotEvents: () => events },
    followup: vi.fn((_message: UserMessage) => {
      events.push({ seq: events.length, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: reply() }] } } })
    }),
    whenIdle: vi.fn(async () => {}),
    cancel: vi.fn(),
  }
  return agent
}

async function boot() {
  const ctx = new Context()
  const live = new Map<string, unknown>()
  const created: { sessionId: SessionId; parentAgent?: unknown; meta?: Record<string, unknown>; setup?: unknown }[] = []
  let reply = '我是 reviewer，已读完代码'
  const agents = {
    get: (id: string) => live.get(id),
    create: vi.fn(async (request: { sessionId: SessionId; parentAgent?: unknown; meta?: Record<string, unknown>; setup?: (agentCtx: Context) => Promise<void> }) => {
      created.push(request)
      if (request.meta?.['parentSession'] === undefined) {
        // The room itself: a real session, a passive agent.
        const session = ctx.sessions.create(request.sessionId, { meta: request.meta ?? {} })
        const agent = { id: session.id, session, followup: vi.fn(), whenIdle: vi.fn(async () => {}) }
        live.set(session.id, agent)
        return { agent, dispose: async () => {} }
      }
      await request.setup?.(ctx)
      const agent = scriptedAgent(request.sessionId, () => reply)
      live.set(request.sessionId, agent)
      return { agent, dispose: async () => {} }
    }),
  }
  ctx.provide('agents', agents as never)
  const mounted: string[] = []
  ctx.provide('agentPresets', {
    resolve: async (id?: string) => {
      if (id !== undefined && !['standard', 'review'].includes(id)) throw new Error(`Unknown agent preset: ${id}`)
      return { id: id ?? 'standard' }
    },
    mount: async (_ctx: Context, id?: string) => { mounted.push(id ?? 'standard'); return { id: id ?? 'standard' } },
    list: async () => [{ id: 'standard', name: '标准模式' }, { id: 'review', name: '审查模式', description: '只读' }],
  } as never)
  ctx.provide('localAgent', withRunEntry({ start: vi.fn(), resume: vi.fn(), cancel: vi.fn(() => false) }, ctx) as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(RoomService)
  const service = ctx.get('room') as RoomService
  const sessionId = await createRoom(ctx, service)
  return { ctx, service, sessionId, agents, live, created, mounted, setReply: (text: string) => { reply = text } }
}

describe('members\' modes, after native members were retired', () => {
  it('lists the host presets as modes and rejects an undeclared one', async () => {
    const bench = await boot()
    const providers = await bench.service.listProviders({})
    expect(providers.presets).toEqual([
      { id: 'standard', name: '标准模式', isDefault: true },
      { id: 'review', name: '审查模式', description: '只读', isDefault: false },
    ])
    expect(await bench.service.invite({ sessionId: bench.sessionId, provider: 'codex', preset: 'ghost', name: 'rev' }))
      .toEqual({ ok: false, error: { code: 'unknown-preset', preset: 'ghost', available: ['standard', 'review'] } })
  })

  it('an older journal\'s native member stays off the roster, and nothing is created for it', async () => {
    const bench = await boot()
    const room = bench.ctx.sessions.get(bench.sessionId)!
    room.append('room/member-added', { id: 'old-native', name: 'rev', kind: 'native', provider: 'dsh', preset: 'review', invitedBy: 'human' })
    room.append('room/speech', { member: 'rev', text: '旧发言' })
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    if (!state.ok) throw new Error('narrowing')
    expect(state.value.members.map(member => member.name)).not.toContain('rev')
    const createdBefore = bench.created.length
    expect(await bench.service.messageMember({ sessionId: bench.sessionId, member: 'rev', text: '还在吗' }))
      .toMatchObject({ ok: false })
    expect(bench.created).toHaveLength(createdBefore)
    // No child agent, no mounted mode: the retired member never comes back to life.
    expect(bench.mounted).toEqual([])
  })
})
