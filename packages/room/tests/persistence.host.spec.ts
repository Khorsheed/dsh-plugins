/**
 * Persistence round-trip: the room journal survives the session-persistence
 * read path. The read path refuses logs carrying event types outside
 * KNOWN_SESSION_EVENT_TYPES — RoomService registers the room vocabulary at
 * apply time, and this spec proves both directions against the REAL jsonl
 * backend: unmounted, a room log refuses to load (the control — it also
 * pins the test order dependency: it runs BEFORE any RoomService mount in
 * this file); mounted, a room written through the service reloads intact.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { KNOWN_SESSION_EVENT_TYPES, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import RoomService, { ROOM_EVENT_TYPES } from '../src/index.ts'

/** A hand-written log covering every room event type (the control's payload). */
function roomLogFixture(): SessionEvent[] {
  const rows: Array<[string, unknown]> = [
    ['room/created', { version: 1 }],
    ['room/member-added', { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human' }],
    ['room/member-updated', { name: 'ada', instructions: '后端' }],
    ['room/dispatch', { targets: ['ada'], text: '出方案' }],
    ['room/note', { text: '笔记' }],
    ['room/speech', { member: 'ada', text: '方案 A' }],
    ['room/run-state', { member: 'ada', state: 'done', startedAt: 1, elapsedMs: 2 }],
    ['room/member-removed', { name: 'ada' }],
  ]
  return rows.map(([type, data], seq) => ({ type, seq, time: 1000 + seq, data }) as SessionEvent)
}

interface Fixture {
  ctx: Context
  dir: string
  cleanup: () => Promise<void>
}

/** A real composition with the jsonl backend over a scratch directory. */
async function makeFixture(mountRoom: boolean): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), 'room-persistence-'))
  const ctx = new Context()
  ctx.provide('agents', { get: () => undefined } as never)
  await ctx.plugin(SessionStore)
  const fiber = await ctx.plugin(JsonlSessionPersistence, { root: dir, compression: 'none' })
  if (mountRoom) await ctx.plugin(RoomService)
  return {
    ctx,
    dir,
    cleanup: async () => {
      await fiber.dispose()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

describe('room journal persistence', () => {
  // ORDER MATTERS: this control must run before any RoomService mount in this
  // process — registration mutates the process-global catalog.
  it('refuses a room log when room is not mounted (the guard works)', async () => {
    const fix = await makeFixture(false)
    try {
      const id = SessionId('foreign-room')
      expect(ROOM_EVENT_TYPES.some(type => !KNOWN_SESSION_EVENT_TYPES.has(type))).toBe(true)
      await fix.ctx.sessionPersistence.create({ version: 0, id, createdAt: 1 })
      await fix.ctx.sessionPersistence.append(id, roomLogFixture())
      const failure = await fix.ctx.sessionPersistence.load(id)
        .then(() => undefined, (error: unknown) => error as Error)
      expect(failure?.name).toBe('SessionFormatUnsupportedError')
      expect(failure?.message).toMatch(/not marked ignorable/)
    } finally {
      await fix.cleanup()
    }
  })

  it('registers the room vocabulary into the persistence catalog at apply time', async () => {
    const fix = await makeFixture(true)
    try {
      for (const type of ROOM_EVENT_TYPES) expect(KNOWN_SESSION_EVENT_TYPES.has(type)).toBe(true)
    } finally {
      await fix.cleanup()
    }
  })

  it('round-trips a room written through the service: reload finds every event', async () => {
    const fix = await makeFixture(true)
    try {
      const service = fix.ctx.get('room') as RoomService
      const { sessionId } = await service.createRoom({})
      const session = fix.ctx.sessions.get(sessionId)!
      session.append('room/member-added', { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human' })
      session.append('room/member-updated', { name: 'ada', instructions: '后端' })
      session.append('room/dispatch', { targets: ['ada'], text: '出方案' })
      session.append('room/note', { text: '笔记' })
      session.append('room/speech', { member: 'ada', text: '方案 A' })
      session.append('room/run-state', { member: 'ada', state: 'done', startedAt: 1, elapsedMs: 2 })
      session.append('room/member-removed', { name: 'ada' })
      await fix.ctx.sessions.flush(session)

      const loaded = await fix.ctx.sessionPersistence.load(sessionId)
      const types = new Set(loaded.events.map(event => event.type as string))
      for (const type of ROOM_EVENT_TYPES) expect(types.has(type)).toBe(true)
    } finally {
      await fix.cleanup()
    }
  })
})
