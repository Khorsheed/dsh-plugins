/**
 * Room → Context Lens contract. Context Lens reads room's session events
 * structurally (no dependency on this package), so this suite runs room's
 * REAL writers through a scripted member lifecycle and records the room log
 * they produce as a checked-in fixture that lens's `room-contract.spec.ts`
 * replays through its own parsers. The fixture is stale when room's writers
 * change what they write: this suite then fails; regenerate it with
 * `UPDATE_ROOM_CONTRACT=1 pnpm --filter @khorsheed/dsh-room test` and let
 * the lens suite say whether it still reads it.
 *
 * It also pins the two `/compact` mirrors (room journal.ts, lens room.ts) to
 * the local-agent core's isCompactCommand over one case table.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { isCompactCommand as coreIsCompactCommand } from '@khorsheed/dsh-local-agent/types'
import RoomService from '../src/index.ts'
import { isCompactCommand } from '../src/journal.ts'
import { createRoom } from './promote.ts'

const FIXTURE = fileURLToPath(new URL('../../context-lens/tests/fixtures/room-contract.json', import.meta.url))

/** Inputs both mirrors must judge exactly as the core does. */
const COMPACT_INPUTS = ['/compact', '  /compact\n', '/compact now', 'please /compact', '/Compact', '/compactx', '', '@ada /compact']

function run(id: string, result: Promise<SubagentResult>): SubagentRun {
  return { id: SessionId(id), localAgent: undefined, result, dispose: async () => {} }
}

function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/** UUIDs (member ids, run ids, session ids) → stable placeholders by first appearance. */
function normalize(value: unknown): unknown {
  const ids = new Map<string, string>()
  const text = JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (uuid) => {
    if (!ids.has(uuid)) ids.set(uuid, `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, '0')}`)
    return ids.get(uuid)!
  })
  return JSON.parse(text)
}

/** Run room's real writers through one member lifecycle; returns the room log as log rows. */
async function produce(): Promise<unknown> {
  // A deterministic clock: every Date.now() call advances 10 ms.
  let now = 1_800_000_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => (now += 10))
  const ctx = new Context()
  ctx.provide('agents', {
    get: () => ({ followup: vi.fn(), whenIdle: vi.fn(async () => {}) }),
    create: vi.fn(async (request: { sessionId: SessionId; meta?: Record<string, unknown> }) => {
      const session = ctx.sessions.create(request.sessionId, { meta: request.meta ?? {} })
      return { agent: { id: session.id, session }, dispose: async () => {} }
    }),
  } as never)
  const facade = { start: vi.fn(), resume: vi.fn(), cancel: vi.fn(() => true) }
  ctx.provide('localAgent', { ...facade } as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(RoomService)
  const service = ctx.get('room') as RoomService
  const sessionId = await createRoom(ctx, service)
  const child = ctx.sessions.create(SessionId('child-ada'), { meta: {} })
  const round = (turn: number, text: string, stopReason: SubagentResult['stopReason'] = 'completed'): SubagentRun => {
    child.append('turn/start', { turn })
    return run('child-ada', Promise.resolve({ output: [{ type: 'text', text }], stopReason }))
  }

  // 1. A member joins with a first task (round 1), then a human message (round 2).
  facade.start.mockImplementationOnce(async () => round(1, '骨架已搭'))
  await service.invite({ sessionId, provider: 'kimi-cli', name: 'ada', firstTask: '搭骨架' })
  await service.engine.idle()
  facade.resume.mockImplementationOnce(async () => round(2, '第二块好了'))
  await service.postMessage({ sessionId, text: '@ada 第二轮' })
  await service.engine.idle()

  // 2. A rename (addressed by the member's current name).
  await service.updateMember({ sessionId, name: 'ada', rename: 'bea' })

  // 3. A run the human stops mid-round (round 3).
  let stop!: (result: SubagentResult) => void
  facade.resume.mockImplementationOnce(async () => {
    child.append('turn/start', { turn: 3 })
    return run('child-ada', new Promise(resolve => { stop = resolve }))
  })
  await service.postMessage({ sessionId, text: '@bea 长任务' })
  for (let index = 0; index < 20 && stop === undefined; index += 1) await tick()
  await service.cancel({ sessionId, name: 'bea' })
  stop({ output: [], stopReason: 'aborted' })
  await service.engine.idle()

  // 4. A relay from outside the roster, confirmed: a delivery with no journaled dispatch (UUID run id, round 4).
  await service.receiveMemberMessage({ from: 'child-outsider', to: 'bea', content: '看一下', parentSessionId: sessionId,
    provenance: { childSessionId: 'child-outsider', provider: 'codex-local', parentSessionId: sessionId } })
  const relay = ctx.sessions.get(sessionId)!.snapshotEvents().findLast(event => event.type === 'room/relay')
  if (relay?.type !== 'room/relay') throw new Error('no relay journaled')
  facade.resume.mockImplementationOnce(async () => round(4, '看过了'))
  await service.confirmRelay({ sessionId, relayId: relay.data.id })
  await service.engine.idle()

  // 5. The human's /compact: a compaction round, the provider's compaction record in the member log.
  facade.resume.mockImplementationOnce(async () => {
    child.append('local-agent/compaction', { source: 'manual', outcome: 'completed', provider: 'kimi-cli', beforeTokens: 500_000, afterTokens: 40_000,
      startedAt: Date.now(), endedAt: Date.now(), boundarySeq: child.snapshotEvents().length })
    return run('child-ada', Promise.resolve({ output: [], stopReason: 'completed' }))
  })
  await service.postMessage({ sessionId, text: '@bea /compact' })
  await service.engine.idle()

  const rows = ctx.sessions.get(sessionId)!.snapshotEvents().map(event => ({ type: event.type, seq: event.seq, time: event.time, data: event.data }))
  return normalize({
    note: 'Generated by packages/room/tests/lens-contract.host.spec.ts from room\'s real writers; do not edit by hand.',
    roomRows: rows,
    compactCases: COMPACT_INPUTS.map(text => ({ text, compact: coreIsCompactCommand(text) })),
  })
}

afterEach(() => { vi.restoreAllMocks() })

describe('room → Context Lens contract fixture', () => {
  it('room\'s writers still produce the checked-in fixture lens replays', async () => {
    const produced = await produce()
    if (process.env['UPDATE_ROOM_CONTRACT'] === '1') writeFileSync(FIXTURE, `${JSON.stringify(produced, null, 2)}\n`)
    const checkedIn: unknown = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    // Stale: regenerate with UPDATE_ROOM_CONTRACT=1 and rerun the context-lens suite.
    expect(checkedIn).toEqual(produced)
  })

  it('the room /compact mirror judges every case exactly as the core', () => {
    for (const text of COMPACT_INPUTS) expect([text, isCompactCommand(text)]).toEqual([text, coreIsCompactCommand(text)])
  })
})
