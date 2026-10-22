/**
 * Native DSH members: a child agent in this host composing a chosen preset,
 * created on its first round, reused afterwards, mirrored into the room as
 * speech, and able to use the room tools as itself.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import RoomService from '../src/index.ts'
import { createRoom } from './promote.ts'

function textOf(blocks: readonly ContentBlock[]): string {
  return blocks.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('\n')
}

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
  ctx.provide('localAgent', { start: vi.fn(), resume: vi.fn(), cancel: vi.fn(() => false) } as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(RoomService)
  const service = ctx.get('room') as RoomService
  const sessionId = await createRoom(ctx, service)
  return { ctx, service, sessionId, agents, live, created, mounted, setReply: (text: string) => { reply = text } }
}

describe('native DSH members', () => {
  it('lists the host presets and rejects an undeclared one', async () => {
    const bench = await boot()
    const providers = await bench.service.listProviders({})
    expect(providers.presets).toEqual([
      { id: 'standard', name: '标准模式', isDefault: true },
      { id: 'review', name: '审查模式', description: '只读', isDefault: false },
    ])
    expect(await bench.service.invite({ sessionId: bench.sessionId, provider: 'dsh', kind: 'native', preset: 'ghost', name: 'rev' }))
      .toEqual({ ok: false, error: { code: 'unknown-preset', preset: 'ghost', available: ['standard', 'review'] } })
  })

  it('creates a child agent with the chosen preset on the first round, then reuses it', async () => {
    const bench = await boot()
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'dsh', kind: 'native', preset: 'review', name: 'rev', role: '审查', firstTask: '读一遍代码' })
    await bench.service.engine.idle()
    const child = bench.created.find(request => request.meta?.['parentSession'] === bench.sessionId)!
    expect(child.meta).toMatchObject({ parentSession: bench.sessionId, origin: 'subagent', agentPreset: 'review' })
    expect(child.parentAgent).toBe(bench.live.get(bench.sessionId))
    expect(bench.mounted).toEqual(['review'])
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    if (!state.ok) throw new Error('room unavailable')
    expect(state.value.members.find(member => member.name === 'rev')).toMatchObject({ kind: 'native', provider: 'dsh', preset: 'review', childSessionId: child.sessionId })
    // The reply mirrors into the room like a CLI member's.
    const speech = bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents().filter(event => event.type === 'room/speech')
    expect(speech).toMatchObject([{ data: { member: 'rev', text: '我是 reviewer，已读完代码', childSessionId: child.sessionId } }])
    const agent = bench.live.get(child.sessionId) as ReturnType<typeof scriptedAgent>
    expect(textOf(agent.followup.mock.calls[0]![0].content)).toContain('【房间简报】')

    bench.setReply('复审通过')
    await bench.service.postMessage({ sessionId: bench.sessionId, text: '@rev 再看一下' })
    await bench.service.engine.idle()
    expect(bench.agents.create).toHaveBeenCalledTimes(2)
    expect(agent.followup).toHaveBeenCalledTimes(2)
    expect(textOf(agent.followup.mock.calls[1]![0].content)).not.toContain('【房间简报】')
  })

  it('a native member\'s room tools act as itself in the parent room, never promoting its own session', async () => {
    const bench = await boot()
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'dsh', kind: 'native', name: 'rev', firstTask: '准备' })
    await bench.service.engine.idle()
    const state = await bench.service.getState({ sessionId: bench.sessionId })
    if (!state.ok) throw new Error('room unavailable')
    const childId = state.value.members.find(member => member.name === 'rev')!.childSessionId!
    // The child session as a real session (the factory would have created it).
    bench.ctx.sessions.create(SessionId(childId), { meta: { parentSession: bench.sessionId } })
    const sent = await bench.service.messageMember({ sessionId: childId, member: 'dsh', text: '我看完了，有两处问题' })
    expect(sent).toMatchObject({ ok: true, value: { member: 'dsh', messageId: expect.stringMatching(/^m\d+$/) } })
    expect(bench.ctx.sessions.get(SessionId(childId))!.snapshotEvents().some(event => event.type === 'room/created')).toBe(false)
    const read = JSON.parse(await bench.service.readRoomContext(childId)) as { self: string }
    expect(read.self).toBe('rev')
  })
})
