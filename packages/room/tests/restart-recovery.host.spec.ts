/**
 * Restart recovery consolidation (design 2026-11-09): a round a host restart
 * cut off is closed as 「被重启打断」, the member itself checks and continues,
 * and the dispatcher only ever hears the continued round's normal report.
 * Replays the synthetic incident fixture (tests/fixtures/restart-incident.ts)
 * and the design's scenarios against the real room service and the core
 * double (run-entry-shim).
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import RoomService from '../src/index.ts'
import { readPlan } from '../src/plan-service.ts'
import { replay } from '../src/journal.ts'
import { withRunEntry } from './run-entry-shim.ts'
import { createRoom } from './promote.ts'
import { seedRestartIncident, type IncidentCast } from './fixtures/restart-incident.ts'

export interface Bench {
  ctx: Context
  service: RoomService
  sessionId: SessionId
  facade: { start: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }
  stub: ReturnType<typeof withRunEntry> & Record<string, unknown>
}

async function bootRoom(): Promise<Bench> {
  const ctx = new Context()
  const agent = { followup: vi.fn(), whenIdle: vi.fn(async () => {}) }
  ctx.provide('agents', {
    get: () => agent,
    create: vi.fn(async (request: { sessionId: SessionId; meta?: Record<string, unknown> }) => {
      const session = ctx.sessions.create(request.sessionId, { meta: request.meta ?? {} })
      return { agent: { id: session.id, session }, dispose: async () => {} }
    }),
  } as never)
  const facade = { start: vi.fn(), resume: vi.fn(), cancel: vi.fn(() => false) }
  const stub = withRunEntry({ ...facade } as Record<string, unknown>, ctx)
  ctx.provide('localAgent', stub as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(RoomService)
  const service = ctx.get('room') as RoomService
  const sessionId = await createRoom(ctx, service)
  return { ctx, service, sessionId, facade, stub: stub as Bench['stub'] }
}

function settledRun(id: string, text: string, stopReason: SubagentResult['stopReason'] = 'completed'): SubagentRun {
  return { id: SessionId(id), localAgent: undefined, result: Promise.resolve({ output: [{ type: 'text', text }], stopReason }), dispose: async () => {} } as SubagentRun
}

/** Seat the incident's cast: two CLI members with child sessions, and 剧情师. */
async function seatCast(bench: Bench): Promise<IncidentCast> {
  const room = bench.ctx.sessions.get(bench.sessionId)!
  for (const name of ['总编排', '地图匠', '剧情师']) await bench.service.invite({ sessionId: bench.sessionId, provider: 'kimi', name })
  room.append('room/member-updated', { name: '总编排', childSessionId: SessionId('child-coord') })
  room.append('room/member-updated', { name: '地图匠', childSessionId: SessionId('child-map') })
  const members = replay(room.snapshotEvents()).members
  const idOf = (name: string): string => members.find(member => member.name === name)!.id!
  return {
    coordinator: { id: idOf('总编排'), name: '总编排', child: 'child-coord' },
    mapper: { id: idOf('地图匠'), name: '地图匠', child: 'child-map' },
    writer: { id: idOf('剧情师'), name: '剧情师' },
  }
}

/** The incident's room, its core ledgers seeded, every edge journaled by an earlier process (stale). */
export async function incidentRoom() {
  const bench = await bootRoom()
  const cast = await seatCast(bench)
  const room = bench.ctx.sessions.get(bench.sessionId)!
  const seeded = seedRestartIncident(room, cast, Date.now() - 3_600_000)
  for (const row of seeded.ledgers.coordinator) bench.stub.seedLedgerRow(cast.coordinator.child, row)
  for (const row of seeded.ledgers.mapper) bench.stub.seedLedgerRow(cast.mapper.child, row)
  await new Promise(resolve => setTimeout(resolve, 5))
  bench.service.engine.bootedAt = Date.now()
  bench.facade.resume.mockImplementation(async (_parent: string, _provider: string, child: string) => settledRun(child, '核对过了，接着做完'))
  return { bench, cast, room, seeded }
}

export const edges = (room: { snapshotEvents(): readonly SessionEvent[] }, id: string): string[] =>
  room.snapshotEvents().flatMap(event => event.type === 'room/delivery-state' && event.data.id === id ? [event.data.state] : [])

describe('the incident fixture (R0)', () => {
  it('replays to the shape the incident left behind: the goal stuck paused, task-a\'s attempt uncertain, task-b\'s still queued', async () => {
    const { room, seeded } = await incidentRoom()
    const plan = readPlan(room)!
    expect(plan).toMatchObject({ status: 'paused', reason: 'Reconcile uncertain attempts before continuing' })
    expect(plan.tasks.map(task => [task.id, task.status, task.attempts.map(attempt => attempt.status)])).toEqual([
      ['task-a', 'pending', ['uncertain']],
      ['task-b', 'running', ['queued']],
    ])
    const deliveries = replay(room.snapshotEvents()).deliveries!
    const status = (id: string) => deliveries.find(row => row.id === id)?.status
    expect(status(seeded.d1530)).toBe('cancelled')
    expect(status(seeded.d1539)).toBe('cancelled')
    expect(status(seeded.d1541)).toBe('done')
    expect(status(seeded.d1580)).toBe('queued')
    expect(status(seeded.d1601)).toBe('queued')
    expect(seeded.releases.map(status)).toEqual(['queued', 'queued', 'queued', 'queued', 'queued'])
  })
})
