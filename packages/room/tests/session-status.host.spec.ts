/**
 * The session list's status for a room: running while any member runs (the
 * host raises it only for its own agents), settled when the last one ends,
 * and the waiting question/approval cards served for 等你处理.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import RoomService from '../src/index.ts'
import { createRoom } from './promote.ts'

async function boot() {
  const ctx = new Context()
  const agent = { followup: vi.fn(), send: vi.fn(), whenIdle: vi.fn(async () => {}), cancel: vi.fn(), status: 'idle' }
  ctx.provide('agents', {
    get: () => agent,
    create: vi.fn(async (request: { sessionId: SessionId; meta?: Record<string, unknown> }) => {
      const session = ctx.sessions.create(request.sessionId, { meta: request.meta ?? {} })
      return { agent: { id: session.id, session }, dispose: async () => {} }
    }),
  } as never)
  ctx.provide('localAgent', { start: vi.fn(), resume: vi.fn(), cancel: vi.fn() } as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(RoomService)
  const service = ctx.get('room') as RoomService
  const sessionId = await createRoom(ctx, service)
  const flips: boolean[] = []
  ;(ctx as unknown as { on: (name: string, listener: (id: unknown, running: boolean) => void) => void })
    .on('api-session/status', (id, running) => { if (String(id) === String(sessionId)) flips.push(running) })
  return { ctx, service, sessionId, flips, room: ctx.sessions.get(sessionId)! }
}

describe('room session status', () => {
  it('runs while any member runs and settles when the last one ends', async () => {
    const bench = await boot()
    bench.room.append('room/run-state', { member: 'a', state: 'running', startedAt: 1, runId: 'r1' })
    bench.room.append('room/run-state', { member: 'b', state: 'running', startedAt: 2, runId: 'r2' })
    bench.room.append('room/run-state', { member: 'a', state: 'done', startedAt: 1, runId: 'r1' })
    expect(bench.flips).toEqual([true])
    bench.room.append('room/run-state', { member: 'b', state: 'failed', startedAt: 2, runId: 'r2' })
    expect(bench.flips).toEqual([true, false])
  })

  it('serves the cards still waiting for the human', async () => {
    const bench = await boot()
    bench.room.append('room/question', { id: 'q1', member: 'a', memberId: 'm', questions: [{ id: 'x', question: '?' }] })
    bench.room.append('room/approval', { id: 'p1', member: 'a', memberId: 'm', tool: 'bash' })
    expect(await bench.service.pendingCards({})).toEqual([
      { sessionId: String(bench.sessionId), id: 'q1', kind: 'question' },
      { sessionId: String(bench.sessionId), id: 'p1', kind: 'approval' },
    ])
    bench.room.append('room/question-resolved', { id: 'q1', outcome: 'answered', answers: [] })
    bench.room.append('room/approval-resolved', { id: 'p1', outcome: 'rejected' })
    expect(await bench.service.pendingCards({})).toEqual([])
  })

  it('a member\'s round ending expires its open question card, so a later answer goes out as a new message', async () => {
    const bench = await boot()
    await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi-cli', name: 'gm' })
    bench.room.append('room/member-updated', { name: 'gm', childSessionId: SessionId('child-gm') })
    const asked = bench.service.receiveMemberCommand({ childSessionId: 'child-gm', parentSessionId: String(bench.sessionId), provider: 'kimi-cli' }, { name: 'ask_user_question', arguments: { questions: [{ id: 'q', question: '?', options: [{ label: 'A' }, { label: 'B' }] }] } })
    await vi.waitFor(async () => expect(await bench.service.pendingCards({})).toHaveLength(1))
    bench.room.append('room/run-state', { member: 'gm', state: 'running', startedAt: 5, runId: 'r' })
    bench.room.append('room/run-state', { member: 'gm', state: 'done', startedAt: 5, runId: 'r' })
    expect((await asked).ok).toBe(false)
    await vi.waitFor(async () => expect(await bench.service.pendingCards({})).toEqual([]))
    const resolved = bench.room.snapshotEvents().filter(event => event.type === 'room/question-resolved').at(-1)!.data as { outcome: string }
    expect(resolved.outcome).toBe('cancelled')
  })
})
