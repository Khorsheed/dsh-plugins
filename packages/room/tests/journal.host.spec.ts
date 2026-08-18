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

describe('RoomService journal (real composition)', () => {
  it('createRoom appends the room/created marker and isRoom recovers identity from the log', async () => {
    const { ctx, service } = await boot()
    const { sessionId } = await service.createRoom({})

    expect(await service.isRoom({ sessionId })).toBe(true)
    const session = ctx.sessions.get(sessionId)!
    expect(session).toBeDefined()
    const marker = session.events.find(event => event.type === 'room/created')
    expect(marker).toMatchObject({ type: 'room/created', data: { version: 1 } })
    // The marker is log-only: it never lands on the model-visible surface.
    expect(session.surface.nodes).toEqual([])
  })

  it('createRoom records the cwd in the session header when given', async () => {
    const { ctx, service } = await boot()
    const { sessionId } = await service.createRoom({ cwd: '/home/user/work' })
    expect(ctx.sessions.get(sessionId)!.header.cwd).toBe('/home/user/work')
  })

  it('isRoom is false for a plain session and for an unknown session id', async () => {
    const { ctx, service } = await boot()
    const plain = ctx.sessions.create(SessionId('plain'), { meta: {} })
    expect(await service.isRoom({ sessionId: plain.id })).toBe(false)
    expect(await service.isRoom({ sessionId: SessionId('nope') })).toBe(false)
  })
})
