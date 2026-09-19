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
import SessionStore, { KNOWN_SESSION_EVENT_TYPES, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import RoomService, { ROOM_EVENT_TYPES } from '../src/index.ts'
import { stubAgents } from './agents-stub.ts'
import { createRoom } from './promote.ts'

/** A hand-written log covering every room event type (the control's payload). */
function roomLogFixture(): SessionEvent[] {
  const rows: Array<[string, unknown]> = [
    ['room/created', { version: 1 }],
    ['room/member-added', { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human' }],
    ['room/member-updated', { name: 'ada', instructions: '后端' }],
    ['room/dispatch', { targets: ['ada'], text: '出方案' }],
    ['room/task-added', { id: 't1', member: 'ada', title: '出方案', status: 'in_progress' }],
    ['room/task-updated', { id: 't1', status: 'done' }],
    ['room/speech', { member: 'ada', text: '方案 A' }],
    ['room/relay', { id: 'r1', from: 'ada', to: 'bill', content: '接口定稿' }],
    ['room/relay-resolved', { id: 'r1', state: 'sent' }],
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
  stubAgents(ctx)
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
  // Registration happens at module load (not service construction), so this
  // process's catalog already holds the room vocabulary: the "not mounted"
  // control simulates a build without room by temporarily removing it.
  it('refuses a room log when room is not mounted (the guard works)', async () => {
    const catalog = KNOWN_SESSION_EVENT_TYPES as Set<string>
    const removed: string[] = []
    for (const type of ROOM_EVENT_TYPES) {
      if (catalog.delete(type)) removed.push(type)
    }
    const fix = await makeFixture(false)
    try {
      const id = SessionId('foreign-room')
      expect(ROOM_EVENT_TYPES.some(type => !KNOWN_SESSION_EVENT_TYPES.has(type))).toBe(true)
      const handle = await fix.ctx.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false })
      await handle.append(roomLogFixture())
      await handle.flush()
      // The refusal fires on the READ path (the write path accepts any JSON).
      const failure = await (async () => {
        const reader = await fix.ctx.sessionPersistence.open(id, 'read')
        try {
          await reader.read(0)
        } finally {
          await reader.close()
        }
      })().then(() => undefined, (error: unknown) => error as Error)
      expect(failure?.name).toBe('SessionFormatUnsupportedError')
      expect(failure?.message).toMatch(/not marked ignorable/)
    } finally {
      for (const type of removed) catalog.add(type)
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
      const sessionId = await createRoom(fix.ctx, service)
      const session = fix.ctx.sessions.get(sessionId)!
      session.append('room/member-added', { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human' })
      session.append('room/member-updated', { name: 'ada', instructions: '后端' })
      session.append('room/dispatch', { targets: ['ada'], text: '出方案' })
      session.append('room/task-added', { id: 't1', member: 'ada', title: '出方案', status: 'in_progress' })
      session.append('room/task-updated', { id: 't1', status: 'done' })
      session.append('room/task-edited', { id: 't1', title: '出方案 v2' })
      session.append('room/speech', { member: 'ada', text: '方案 A' })
      session.append('room/relay', { id: 'r1', from: 'ada', to: 'bill', content: '接口定稿' })
      session.append('room/relay-resolved', { id: 'r1', state: 'sent' })
      session.append('room/run-state', { member: 'ada', state: 'done', startedAt: 1, elapsedMs: 2 })
      session.append('room/member-removed', { name: 'ada' })
      session.append('room/goal', { text: '插件 API v2 上线' })
      expect(await service.planCommand({ sessionId, command: JSON.stringify({ action: 'create', requestId: 'persist-goal', expectedRevision: 0, id: 'goal', objective: 'Verify persistence', mode: 'draft', budget: { maxParallel: 1, maxAttempts: 3, maxAttemptsPerTask: 2, maxActiveMs: 60000 } }) })).toEqual({ ok: true })
      session.append('room/coordinator', { version: 1, memberId: 'legacy:1', previousMemberId: 'legacy:1', revision: 1, handoff: 'Continue' })
      session.append('room/delivery-state', { id: 'delivery', dispatchSeq: 3, memberId: 'ada', state: 'done' })
      await fix.ctx.sessions.flush(session)

      const reader = await fix.ctx.sessionPersistence.open(sessionId, 'read')
      let loadedEvents: readonly SessionEvent[]
      try {
        loadedEvents = (await reader.read(0)).events
      } finally {
        await reader.close()
      }
      const types = new Set(loadedEvents.map(event => event.type as string))
      for (const type of ROOM_EVENT_TYPES) expect(types.has(type)).toBe(true)
    } finally {
      await fix.cleanup()
    }
  })

  it('a cold room answers reads from its durable log and a mutation cold-resumes its agent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'room-persistence-'))
    try {
      // Phase 1 (the "previous boot"): write a room and flush it durable.
      const ctxA = new Context()
      stubAgents(ctxA)
      await ctxA.plugin(SessionStore)
      const fiberA = await ctxA.plugin(JsonlSessionPersistence, { root: dir, compression: 'none' })
      await ctxA.plugin(RoomService)
      const serviceA = ctxA.get('room') as RoomService
      const sessionId = await createRoom(ctxA, serviceA)
      const roomA = ctxA.sessions.get(sessionId)!
      roomA.append('room/task-added', { id: 't1', member: 'main', title: '积压', status: 'pending' })
      await ctxA.sessions.flush(roomA)
      await fiberA.dispose()

      // Phase 2 (the "restarted host"): a fresh store — the room is cold.
      const ctxB = new Context()
      const agents = stubAgents(ctxB, {
        resume: async ({ resumeSessionId }) => {
          // The 0.1.5 handle-based reattach (mirrors agentLoop.resume).
          const handle = await ctxB.sessionPersistence.open(resumeSessionId, 'write')
          const cold = await handle.read(0)
          const session = ctxB.sessions.prepare(resumeSessionId, {
            seed: [...cold.events],
            meta: structuredClone(handle.header),
            inheritedEventCount: handle.inheritedEventCount,
            eventState: cold.eventState,
          })
          // The seeded constructor's session/end-seed marker lands before
          // enter() installs publication hooks — push it through the handle.
          const unstored = session.snapshotEvents().slice(cold.events.length)
          if (unstored.length > 0) await handle.append(unstored)
          ctxB.sessions.enter(session)
          return { agent: { id: resumeSessionId, session }, dispose: async () => { await handle.close() } }
        },
      })
      await ctxB.plugin(SessionStore)
      const fiberB = await ctxB.plugin(JsonlSessionPersistence, { root: dir, compression: 'none' })
      await ctxB.plugin(RoomService)
      try {
        const serviceB = ctxB.get('room') as RoomService

        // Read-only probes answer from the log and attach/resume NOTHING.
        expect(await serviceB.isRoom({ sessionId })).toBe(true)
        expect(ctxB.sessions.get(sessionId)).toBeUndefined()
        expect(await serviceB.getState({ sessionId })).toMatchObject({
          ok: true,
          value: {
            members: [{ name: 'main', kind: 'main-agent' }],
            tasks: [{ id: 't1', member: 'main', title: '积压', status: 'pending' }],
          },
        })
        expect(ctxB.sessions.get(sessionId)).toBeUndefined()

        // A cold non-room never pays a resume.
        expect(await serviceB.isRoom({ sessionId: SessionId('ghost') })).toBe(false)
        expect(await serviceB.postMessage({ sessionId: SessionId('ghost'), text: '@main hi' }))
          .toEqual({ ok: false, error: { code: 'session-not-found' } })
        expect(agents.resume).not.toHaveBeenCalled()

        // The first mutation cold-resumes the agent, republishing the session.
        const added = await serviceB.addTask({ sessionId, member: 'main', title: '重启后的第一条' })
        expect(added.ok).toBe(true)
        expect(agents.resume).toHaveBeenCalledTimes(1)
        expect(agents.resume).toHaveBeenCalledWith(
          expect.objectContaining({ resumeSessionId: sessionId }),
        )
        expect(ctxB.sessions.get(sessionId)).toBeDefined()
        expect(await serviceB.getState({ sessionId })).toMatchObject({
          ok: true,
          value: {
            tasks: [
              { id: 't1', title: '积压' },
              { title: '重启后的第一条', status: 'pending' },
            ],
          },
        })
        // A second mutation reuses the live session (no second resume).
        await serviceB.addTask({ sessionId, member: 'main', title: '又一条' })
        expect(agents.resume).toHaveBeenCalledTimes(1)
      } finally {
        await fiberB.dispose()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})


describe('linked Room event vocabulary', () => {
  it('registers the running loader catalog before plugin readiness', async () => {
    const ctx = new Context()
    stubAgents(ctx)
    await ctx.plugin(SessionStore)
    const catalog = new Set<string>()
    ctx.provide('loader', { import: async (name: string) => {
      if (name !== '@deepseek-ai/dsh-session') throw new Error('no source export')
      return { KNOWN_SESSION_EVENT_TYPES: catalog }
    } } as never)
    const fiber = await ctx.plugin(RoomService)
    try { expect([...catalog]).toEqual([...ROOM_EVENT_TYPES]) }
    finally { await fiber.dispose() }
  })
})
