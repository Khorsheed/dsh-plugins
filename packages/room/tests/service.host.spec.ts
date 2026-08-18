import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import RoomService from '../src/index.ts'
import type { LocalAgentFacade } from '../src/adapter.ts'

interface BenchOptions {
  /** false: no localAgent service at all (facade probe misses). */
  facade?: boolean
}

/**
 * The REAL composition: a cordis root, the real SessionStore plugin, and the
 * package's own service plugin. `agents` and `localAgent` are external
 * services to this package; their faces are stubbed. The facade stub's runs
 * never settle (service-surface tests assert the journal, not the run).
 */
async function boot(options: BenchOptions = {}) {
  const ctx = new Context()
  ctx.provide('agents', { get: () => undefined } as never)
  const facade: LocalAgentFacade = {
    start: vi.fn(async (): Promise<SubagentRun> => ({
      id: SessionId('child-1'),
      localAgent: undefined,
      result: new Promise(() => {}),
      dispose: async () => {},
    })),
    resume: vi.fn(async (): Promise<SubagentRun> => ({
      id: SessionId('child-1'),
      localAgent: undefined,
      result: new Promise(() => {}),
      dispose: async () => {},
    })),
    cancel: vi.fn(() => false),
  }
  if (options.facade !== false) ctx.provide('localAgent', facade as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(RoomService)
  return { ctx, service: ctx.get('room') as RoomService, facade }
}

/** Boot with one room created; returns its id. */
async function bootRoom(options: BenchOptions = {}) {
  const { ctx, service, facade } = await boot(options)
  const { sessionId } = await service.createRoom({})
  return { ctx, service, facade, sessionId }
}

/** The roster row every fresh room seats: its own main agent. */
const MAIN_MEMBER = { name: 'main', kind: 'main-agent', invitedBy: 'human' }

describe('RoomService Remote surface (real composition)', () => {
  it('getState replays a fresh room (main agent seated), and rejects plain/unknown sessions', async () => {
    const { ctx, service, sessionId } = await bootRoom()
    const state = await service.getState({ sessionId })
    expect(state).toEqual({ ok: true, value: { members: [MAIN_MEMBER], blackboard: [], cursors: [], runs: [] } })

    const plain = ctx.sessions.create(SessionId('plain'), { meta: {} })
    expect(await service.getState({ sessionId: plain.id }))
      .toEqual({ ok: false, error: { code: 'not-a-room' } })
    expect(await service.getState({ sessionId: SessionId('nope') }))
      .toEqual({ ok: false, error: { code: 'session-not-found' } })
  })

  it('invite lands a cli member on the roster and acknowledges a dispatched first task', async () => {
    const { service, sessionId } = await bootRoom()
    const invited = await service.invite({
      sessionId, provider: 'kimi', name: 'ada', instructions: '后端', firstTask: '搭骨架',
    })
    expect(invited).toEqual({ ok: true, value: { name: 'ada', pendingFirstTask: true } })
    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: {
        members: [
          MAIN_MEMBER,
          { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human', instructions: '后端' },
        ],
        // The first task is journaled as a dispatch record (no longer volatile).
        blackboard: [{ kind: 'dispatch', targets: ['ada'], text: '搭骨架' }],
      },
    })

    const idle = await service.invite({ sessionId, provider: 'codex', name: 'bill' })
    expect(idle).toEqual({ ok: true, value: { name: 'bill', pendingFirstTask: false } })
  })

  it('invite rejects bad names, duplicates, blank providers, and blank texts', async () => {
    const { service, sessionId } = await bootRoom()
    expect(await service.invite({ sessionId, provider: 'kimi', name: 'a b' }))
      .toEqual({ ok: false, error: { code: 'invalid-name' } })
    expect(await service.invite({ sessionId, provider: 'kimi', name: 'a@b' }))
      .toEqual({ ok: false, error: { code: 'invalid-name' } })
    expect(await service.invite({ sessionId, provider: 'kimi', name: '' }))
      .toEqual({ ok: false, error: { code: 'invalid-name' } })
    expect(await service.invite({ sessionId, provider: '  ', name: 'ada' }))
      .toEqual({ ok: false, error: { code: 'empty-provider' } })
    expect(await service.invite({ sessionId, provider: 'kimi', name: 'ada', instructions: ' ' }))
      .toEqual({ ok: false, error: { code: 'empty-text' } })
    expect(await service.invite({ sessionId, provider: 'kimi', name: 'ada', firstTask: '' }))
      .toEqual({ ok: false, error: { code: 'empty-text' } })

    await service.invite({ sessionId, provider: 'kimi', name: 'ada' })
    expect(await service.invite({ sessionId, provider: 'codex', name: 'ada' }))
      .toEqual({ ok: false, error: { code: 'duplicate-name' } })
    // The room's own main agent is seated at creation; its name is taken too.
    expect(await service.invite({ sessionId, provider: 'kimi', name: 'main' }))
      .toEqual({ ok: false, error: { code: 'duplicate-name' } })
  })

  it('invite degrades to local-agent-unavailable without the facade', async () => {
    const { service, sessionId } = await bootRoom({ facade: false })
    expect(await service.invite({ sessionId, provider: 'kimi', name: 'ada' }))
      .toEqual({ ok: false, error: { code: 'local-agent-unavailable' } })
    // The room itself and its main-agent member are unaffected.
    expect(await service.getState({ sessionId })).toMatchObject({ ok: true, value: { members: [MAIN_MEMBER] } })
  })

  it('updateMember rewrites instructions and validates its inputs', async () => {
    const { service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada', instructions: '后端' })
    expect(await service.updateMember({ sessionId, name: 'ada', instructions: '后端 + 评审' }))
      .toEqual({ ok: true, value: { name: 'ada' } })
    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({ ok: true, value: { members: [MAIN_MEMBER, { name: 'ada', instructions: '后端 + 评审' }] } })

    expect(await service.updateMember({ sessionId, name: 'ghost', instructions: 'x' }))
      .toEqual({ ok: false, error: { code: 'member-not-found' } })
    expect(await service.updateMember({ sessionId, name: 'ada' }))
      .toEqual({ ok: false, error: { code: 'nothing-to-update' } })
    expect(await service.updateMember({ sessionId, name: 'ada', instructions: ' ' }))
      .toEqual({ ok: false, error: { code: 'empty-text' } })
  })

  it('removeMember drops the member from the roster and validates its inputs', async () => {
    const { service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada' })
    expect(await service.removeMember({ sessionId, name: 'ada' })).toEqual({ ok: true, value: { name: 'ada' } })
    expect(await service.getState({ sessionId })).toMatchObject({ ok: true, value: { members: [MAIN_MEMBER] } })
    expect(await service.removeMember({ sessionId, name: 'ada' }))
      .toEqual({ ok: false, error: { code: 'member-not-found' } })
  })

  it('postMessage without a mention appends a blackboard note', async () => {
    const { service, sessionId } = await bootRoom()
    const posted = await service.postMessage({ sessionId, text: '今天先讨论方向' })
    expect(posted).toMatchObject({ ok: true, value: { parsed: { targets: [], text: '今天先讨论方向' } } })
    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: { blackboard: [{ kind: 'note', text: '今天先讨论方向' }] },
    })
  })

  it('postMessage with mentions appends a dispatch and validates the roster', async () => {
    const { service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada' })
    await service.invite({ sessionId, provider: 'codex', name: 'bill' })

    const single = await service.postMessage({ sessionId, text: '@ada 出方案' })
    expect(single).toMatchObject({ ok: true, value: { parsed: { targets: ['ada'], text: '出方案' } } })
    const fanout = await service.postMessage({ sessionId, text: '@ada @bill 对齐接口' })
    expect(fanout).toMatchObject({ ok: true, value: { parsed: { targets: ['ada', 'bill'], text: '对齐接口' } } })
    if (!fanout.ok) throw new Error('narrowing')

    expect(await service.postMessage({ sessionId, text: '@ada @ghost 干活' }))
      .toEqual({ ok: false, error: { code: 'unknown-targets', names: ['ghost'] } })
    expect(await service.postMessage({ sessionId, text: '@ada' }))
      .toEqual({ ok: false, error: { code: 'empty-text' } })
    expect(await service.postMessage({ sessionId, text: '   ' }))
      .toEqual({ ok: false, error: { code: 'empty-text' } })

    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: {
        blackboard: [
          { kind: 'dispatch', targets: ['ada'], text: '出方案' },
          { kind: 'dispatch', targets: ['ada', 'bill'], text: '对齐接口' },
        ],
        // Cursors track each member's latest dispatch.
        cursors: [{ member: 'ada', seq: fanout.value.seq }, { member: 'bill', seq: fanout.value.seq }],
      },
    })
  })

  it('cancel reports a miss when the member never ran (and nothing is journaled)', async () => {
    const { service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada' })
    expect(await service.cancel({ sessionId, name: 'ada' })).toEqual({ ok: true, value: { cancelled: false } })
    expect(await service.cancel({ sessionId, name: 'ghost' }))
      .toEqual({ ok: false, error: { code: 'member-not-found' } })
    expect(await service.getState({ sessionId })).toMatchObject({ ok: true, value: { runs: [] } })
  })
})
