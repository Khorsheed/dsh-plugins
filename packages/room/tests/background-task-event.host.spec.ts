/**
 * `room/background-task` is registered before any build writes it (design
 * 2026-11-06-member-self-started-rounds, step M0; precedent batch 5 S0's
 * `local-agent/execution`): a stored room log carrying the fact must load
 * through the host's real jsonl reader and replay into the room state, and
 * the same log must be refused once the registration is gone — the control
 * that shows why the registration can never be removed.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { KNOWN_SESSION_EVENT_TYPES, SESSION_FORMAT_VERSION, Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { RoomBackgroundTaskEvent } from '../src/index.ts'
// Module load performs the registration under test.
import { ROOM_EVENT_TYPES } from '../src/index.ts'
import { replay } from '../src/journal.ts'

const TYPE = 'room/background-task'

const lost: RoomBackgroundTaskEvent = {
  member: 'kimi-canvas', memberId: 'm-kimi', taskId: 'bash-icfn1mfm', label: '部署 canvas-novel 到 3080',
  state: 'lost', because: 'host-restart', startedByRunId: 'run-a',
}

/** A room log the way M6 will write it: a roster, a finished run, then the lost-task fact. */
function roomLog(withFact = true): SessionEvent[] {
  const session = Session.create(SessionId('room-log'))
  session.append('room/created', { version: 1 } as never)
  session.append('room/member-added', { name: 'kimi-canvas', id: 'm-kimi', kind: 'cli', provider: 'kimi', invitedBy: 'human' } as never)
  session.append('room/run-state', { member: 'kimi-canvas', runId: 'run-a', state: 'done', startedAt: 1, elapsedMs: 2 } as never)
  if (withFact) {
    session.append(TYPE, lost)
    // Optional field absent: the start chain was not on record.
    const { startedByRunId: _omitted, ...unchained } = lost
    session.append(TYPE, { ...unchained, taskId: 'agent-2', because: 'process-reclaimed' })
  }
  return [...session.snapshotEvents()]
}

async function readBack(rows: SessionEvent[]): Promise<readonly SessionEvent[]> {
  const dir = await mkdtemp(join(tmpdir(), 'room-background-task-'))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const fiber = await ctx.plugin(JsonlSessionPersistence, { root: dir, compression: 'none' })
  try {
    const id = SessionId('room-stored')
    const handle = await ctx.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false })
    await handle.append(rows)
    await handle.flush()
    const reader = await ctx.sessionPersistence.open(id, 'read')
    try {
      return (await reader.read(0)).events
    } finally {
      await reader.close()
    }
  } finally {
    await fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  }
}

describe('room/background-task registration (M0)', () => {
  it('is in the room vocabulary and in the host event catalog at module load', () => {
    expect(ROOM_EVENT_TYPES).toContain(TYPE)
    expect(KNOWN_SESSION_EVENT_TYPES.has(TYPE)).toBe(true)
  })

  it('a stored room log carrying the fact loads through the host reader and replays', async () => {
    const events = await readBack(roomLog())
    expect(events.filter(event => event.type === TYPE).map(event => event.data)).toEqual([
      lost,
      { member: 'kimi-canvas', memberId: 'm-kimi', taskId: 'agent-2', label: '部署 canvas-novel 到 3080', state: 'lost', because: 'process-reclaimed' },
    ])
    // M0 folds nothing from it: the room state equals the same log without the fact.
    const state = replay(events)
    expect(state.members.map(member => member.name)).toContain('kimi-canvas')
    expect(state).toEqual(replay(await readBack(roomLog(false))))
  })

  it('without the registration the same log is refused (the control: removal breaks the room)', async () => {
    const catalog = KNOWN_SESSION_EVENT_TYPES as Set<string>
    catalog.delete(TYPE)
    try {
      const failure = await readBack(roomLog()).then(() => undefined, (error: unknown) => error as Error)
      expect(failure?.name).toBe('SessionFormatUnsupportedError')
      expect(failure?.message).toMatch(/not marked ignorable/)
      // Everything else in the log is still registered: the refusal is this type's alone.
      expect(await readBack(roomLog(false))).toHaveLength(roomLog(false).length)
    } finally {
      catalog.add(TYPE)
    }
  })

  it('nothing in room writes it yet (M0 registers only)', () => {
    const root = join(import.meta.dirname, '../src')
    const sources = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter(path => /\.tsx?$/.test(path))
      .filter(path => readFileSync(join(root, path), 'utf8').includes(`'${TYPE}'`))
      .sort()
    expect(sources).toEqual(['journal.ts', 'types.ts'])
  })
})
