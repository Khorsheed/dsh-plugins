/**
 * Members' tool approvals: a CLI member's mode tool that needs the human
 * asks in the room; the human's answer (or the call ending) resolves it.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import RoomService from '../src/index.ts'
import { createRoom } from './promote.ts'

async function boot() {
  const ctx = new Context()
  const agent = { followup: vi.fn(), send: vi.fn(), whenIdle: vi.fn(async () => {}), cancel: vi.fn() }
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
  await service.invite({ sessionId, provider: 'codex-local', name: 'coco', preset: 'dsh-video' })
  ctx.sessions.get(sessionId)!.append('room/member-updated', { name: 'coco', childSessionId: SessionId('child-coco') })
  const run = { childSessionId: 'child-coco', parentSessionId: String(sessionId), provider: 'codex-local' }
  const state = async () => {
    const result = await service.getState({ sessionId })
    if (!result.ok) throw new Error('room unavailable')
    return result.value
  }
  return { ctx, service, sessionId, run, state }
}

describe('member tool approvals', () => {
  it('asks in the room and hands the human\'s answer to the waiting call', async () => {
    const bench = await boot()
    const asked = bench.service.askMemberApproval(bench.run, { toolName: 'video_render', reason: '导出 11 分钟视频' })
    await vi.waitFor(async () => expect((await bench.state()).approvals).toHaveLength(1))
    const [approval] = (await bench.state()).approvals!
    expect(approval).toMatchObject({ member: 'coco', tool: 'video_render', reason: '导出 11 分钟视频' })
    expect(await bench.service.answerApproval({ sessionId: bench.sessionId, id: approval!.id, outcome: 'allowed-once' })).toEqual({ ok: true })
    expect(await asked).toBe('allowed-once')
    expect((await bench.state()).approvals).toBeUndefined()
    // Answered once: a second answer is refused.
    expect(await bench.service.answerApproval({ sessionId: bench.sessionId, id: approval!.id, outcome: 'rejected' }))
      .toEqual({ ok: false, error: { code: 'approval-not-pending' } })
  })

  it('a call that ends first closes the approval as cancelled; strangers are not asked', async () => {
    const bench = await boot()
    const controller = new AbortController()
    const asked = bench.service.askMemberApproval(bench.run, { toolName: 'video_render', signal: controller.signal })
    await vi.waitFor(async () => expect((await bench.state()).approvals).toHaveLength(1))
    controller.abort()
    expect(await asked).toBe('cancelled')
    const events = bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents()
    expect(events.filter(event => event.type === 'room/approval-resolved').map(event => event.data)).toMatchObject([{ outcome: 'cancelled' }])
    expect(await bench.service.askMemberApproval({ ...bench.run, childSessionId: 'child-ghost' }, { toolName: 'video_render' })).toBe('unavailable')
  })

  it('an approval no waiting call stands behind (a restart) expires on the next access', async () => {
    const bench = await boot()
    bench.ctx.sessions.get(bench.sessionId)!.append('room/approval', { id: 'orphan', member: 'coco', memberId: 'm', tool: 'video_render' })
    await bench.service.setGoal({ sessionId: bench.sessionId, text: '剪完第三期' })
    expect((await bench.state()).approvals).toBeUndefined()
  })
})
