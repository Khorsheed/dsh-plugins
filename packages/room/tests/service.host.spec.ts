import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import RoomService from '../src/index.ts'

/** The REAL composition: a cordis root, the real SessionStore plugin, and the package's own service plugin. */
async function boot() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(RoomService)
  return { ctx, service: ctx.get('room') as RoomService }
}

/** Boot with one room created; returns its id. */
async function bootRoom() {
  const { ctx, service } = await boot()
  const { sessionId } = await service.createRoom({})
  return { ctx, service, sessionId }
}

describe('RoomService Remote surface (real composition)', () => {
  it('getState replays an empty room, and rejects plain/unknown sessions', async () => {
    const { ctx, service, sessionId } = await bootRoom()
    const state = await service.getState({ sessionId })
    expect(state).toEqual({ ok: true, value: { members: [], blackboard: [], cursors: [], runs: [] } })

    const plain = ctx.sessions.create(SessionId('plain'), { meta: {} })
    expect(await service.getState({ sessionId: plain.id }))
      .toEqual({ ok: false, error: { code: 'not-a-room' } })
    expect(await service.getState({ sessionId: SessionId('nope') }))
      .toEqual({ ok: false, error: { code: 'session-not-found' } })
  })

  it('invite lands a cli member on the roster and acknowledges a pending first task', async () => {
    const { service, sessionId } = await bootRoom()
    const invited = await service.invite({
      sessionId, provider: 'kimi', name: 'ada', instructions: '后端', firstTask: '搭骨架',
    })
    expect(invited).toEqual({ ok: true, value: { name: 'ada', pendingFirstTask: true } })
    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({
      ok: true,
      value: { members: [{ name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human', instructions: '后端' }] },
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
  })

  it('updateMember rewrites instructions and validates its inputs', async () => {
    const { service, sessionId } = await bootRoom()
    await service.invite({ sessionId, provider: 'kimi', name: 'ada', instructions: '后端' })
    expect(await service.updateMember({ sessionId, name: 'ada', instructions: '后端 + 评审' }))
      .toEqual({ ok: true, value: { name: 'ada' } })
    const state = await service.getState({ sessionId })
    expect(state).toMatchObject({ ok: true, value: { members: [{ name: 'ada', instructions: '后端 + 评审' }] } })

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
    expect(await service.getState({ sessionId })).toMatchObject({ ok: true, value: { members: [] } })
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
})
