/**
 * The blank-room registry behind createRoom's reuse-or-create: same-cwd blank
 * rooms reuse (the official startSession blank contract — a blank session is
 * invisible unless current, so 新建 Room must not stack a fresh one), a first
 * turn ends blankness, stale records drop lazily, and the JSON backing file
 * carries the registry across a restart (validated against the REAL jsonl
 * session backend).
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import RoomService from '../src/index.ts'
import { stubAgents } from './agents-stub.ts'

/** A real composition with the package's service; config carries no registry file unless given. */
async function boot(registryFile?: string) {
  const ctx = new Context()
  const agents = stubAgents(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(RoomService, registryFile === undefined ? {} : { registryFile })
  return { ctx, service: ctx.get('room') as RoomService, agents }
}

describe('createRoom reuse-or-create', () => {
  it('reuses a still-blank room under the same cwd (and creates only once)', async () => {
    const { service, agents } = await boot()
    const first = await service.createRoom({ cwd: '/a' })
    const second = await service.createRoom({ cwd: '/a' })
    expect(second.sessionId).toBe(first.sessionId)
    expect(agents.create).toHaveBeenCalledTimes(1)
  })

  it('creates fresh under a different cwd', async () => {
    const { service, agents } = await boot()
    const a = await service.createRoom({ cwd: '/a' })
    const b = await service.createRoom({ cwd: '/b' })
    expect(b.sessionId).not.toBe(a.sessionId)
    expect(agents.create).toHaveBeenCalledTimes(2)
  })

  it('ends blankness at the first turn/start: the next same-cwd create starts fresh', async () => {
    const { ctx, service } = await boot()
    const first = await service.createRoom({ cwd: '/a' })
    // The registry listener drops the id as the turn/start event lands.
    ctx.sessions.get(first.sessionId)!.append('turn/start', { turn: 1 })
    const second = await service.createRoom({ cwd: '/a' })
    expect(second.sessionId).not.toBe(first.sessionId)
  })

  it('lazily drops a stale record (the session is gone) and persists the fresh one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'room-registry-'))
    try {
      const file = join(dir, 'blank-rooms.json')
      writeFileSync(file, JSON.stringify({ 'session-ghost': '/a' }))
      const { service } = await boot(file)
      const created = await service.createRoom({ cwd: '/a' })
      expect(created.sessionId).not.toBe(SessionId('session-ghost'))
      // The ghost is out; the fresh blank room is tracked.
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ [created.sessionId]: '/a' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('carries the registry across a restart: a cold blank room reuses from its durable log', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'room-registry-'))
    const file = join(dir, 'blank-rooms.json')
    const sessionsRoot = join(dir, 'sessions')
    const bootWithPersistence = async () => {
      const ctx = new Context()
      stubAgents(ctx)
      await ctx.plugin(SessionStore)
      const fiber = await ctx.plugin(JsonlSessionPersistence, { root: sessionsRoot, compression: 'none' })
      await ctx.plugin(RoomService, { registryFile: file })
      return { fiber, service: ctx.get('room') as RoomService }
    }
    try {
      const first = await bootWithPersistence()
      const created = await first.service.createRoom({ cwd: '/a' })
      await first.fiber.dispose()
      // Second boot: nothing is live; the registry record must validate
      // against the durable log (room marker present, no turn/start).
      const second = await bootWithPersistence()
      const reused = await second.service.createRoom({ cwd: '/a' })
      expect(reused.sessionId).toBe(created.sessionId)
      await second.fiber.dispose()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
