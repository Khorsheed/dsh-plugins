import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import RoomService from '../src/index.ts'
import { isRoomLog, parseMentions, pendingInstructions, previousCursor, replay } from '../src/journal.ts'
import { stubAgents } from './agents-stub.ts'

/** The REAL composition: a cordis root, the real SessionStore plugin, and the package's own service plugin. */
async function boot() {
  const ctx = new Context()
  // The agents registry is an external service to this package; stub its face.
  stubAgents(ctx)
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

let seq = 0
/** A log-only journal event with a fresh seq. */
function ev(type: string, data: unknown): SessionEvent {
  const event = { type, seq, time: 1000, data }
  seq += 1
  return event as SessionEvent
}

function resetSeq(): void {
  seq = 0
}

describe('replay (pure journal fold)', () => {
  it('folds the full vocabulary: roster, blackboard order, cursors, run states', () => {
    resetSeq()
    const events = [
      ev('room/created', { version: 1 }),                                                    // 0
      ev('room/member-added', { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human', instructions: '后端' }), // 1
      ev('room/member-added', { name: 'bill', kind: 'cli', provider: 'codex', invitedBy: 'agent' }),                     // 2
      ev('room/member-updated', { name: 'ada', instructions: '后端 + 接口评审' }),           // 3
      ev('room/dispatch', { targets: ['ada', 'bill'], text: '出方案' }),                     // 4
      ev('room/note', { text: '以上先放着' }),                                               // 5
      ev('room/speech', { member: 'ada', text: '方案 A', durationMs: 1200 }),                // 6
      ev('room/run-state', { member: 'ada', state: 'running', startedAt: 100 }),             // 7
      ev('room/dispatch', { targets: ['ada'], text: '按方案 A 实现' }),                      // 8
      ev('room/run-state', { member: 'ada', state: 'done', startedAt: 100, elapsedMs: 900 }), // 9
    ]
    const state = replay(events)
    expect(state.members).toEqual([
      { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human', instructions: '后端 + 接口评审' },
      { name: 'bill', kind: 'cli', provider: 'codex', invitedBy: 'agent' },
    ])
    expect(state.blackboard).toEqual([
      { kind: 'dispatch', seq: 4, targets: ['ada', 'bill'], text: '出方案' },
      { kind: 'note', seq: 5, text: '以上先放着' },
      { kind: 'speech', seq: 6, member: 'ada', text: '方案 A', durationMs: 1200 },
      { kind: 'dispatch', seq: 8, targets: ['ada'], text: '按方案 A 实现' },
    ])
    // The cursor tracks the LATEST dispatch naming the member.
    expect(state.cursors).toEqual([{ member: 'ada', seq: 8 }, { member: 'bill', seq: 4 }])
    // The latest run-state event wins.
    expect(state.runs).toEqual([{ member: 'ada', state: 'done', startedAt: 100, elapsedMs: 900 }])
  })

  it('member-removed cleans the roster, the cursor, and the run state', () => {
    resetSeq()
    const events = [
      ev('room/created', { version: 1 }),
      ev('room/member-added', { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human' }),
      ev('room/dispatch', { targets: ['ada'], text: '干活' }),
      ev('room/run-state', { member: 'ada', state: 'running', startedAt: 100 }),
      ev('room/member-removed', { name: 'ada' }),
    ]
    const state = replay(events)
    expect(state.members).toEqual([])
    expect(state.cursors).toEqual([])
    expect(state.runs).toEqual([])
  })

  it('duplicate member-added keeps the first record; updates/removals of unknown members are dropped', () => {
    resetSeq()
    const events = [
      ev('room/member-added', { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human' }),
      ev('room/member-added', { name: 'ada', kind: 'cli', provider: 'codex', invitedBy: 'agent' }),
      ev('room/member-updated', { name: 'ghost', instructions: 'x' }),
      ev('room/member-removed', { name: 'ghost' }),
    ]
    expect(replay(events).members).toEqual([
      { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human' },
    ])
  })

  it('isRoomLog keys on the marker only', () => {
    resetSeq()
    expect(isRoomLog([ev('room/created', { version: 1 })])).toBe(true)
    expect(isRoomLog([ev('room/note', { text: 'x' })])).toBe(false)
    expect(replay([ev('room/note', { text: 'x' })]).members).toEqual([])
  })

  it('member-updated folds a childSessionId onto the member (delegation handle journaled)', () => {
    resetSeq()
    const events = [
      ev('room/member-added', { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human' }),
      ev('room/member-updated', { name: 'ada', childSessionId: 'child-1' }),
    ]
    expect(replay(events).members).toEqual([
      { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human', childSessionId: 'child-1' },
    ])
  })
})

describe('previousCursor', () => {
  it('finds the latest earlier dispatch naming the member', () => {
    resetSeq()
    const events = [
      ev('room/dispatch', { targets: ['ada'], text: '一' }),          // 0
      ev('room/dispatch', { targets: ['bill'], text: '二' }),         // 1
      ev('room/dispatch', { targets: ['ada', 'bill'], text: '三' }),  // 2
    ]
    expect(previousCursor(events, 'ada', 2)).toBe(0)
    expect(previousCursor(events, 'bill', 2)).toBe(1)
    // First dispatch: no earlier cursor.
    expect(previousCursor(events, 'ada', 0)).toBeUndefined()
    expect(previousCursor(events, 'ghost', 2)).toBeUndefined()
  })
})

describe('pendingInstructions', () => {
  it('is initial before the first dispatch, silent after, update after an edit', () => {
    resetSeq()
    const added = [
      ev('room/member-added', { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human', instructions: '后端' }), // 0
    ]
    expect(pendingInstructions(added, 'ada', undefined)).toEqual({ kind: 'initial', instructions: '后端' })

    const dispatched = [...added, ev('room/dispatch', { targets: ['ada'], text: '干活' })] // 1
    // Already carried by the dispatch at seq 1 (cursor 0...1 boundary).
    expect(pendingInstructions(dispatched, 'ada', 1)).toBeUndefined()
    expect(pendingInstructions(dispatched, 'ada', 0)).toBeUndefined()

    const edited = [...dispatched, ev('room/member-updated', { name: 'ada', instructions: '后端 + 评审' })] // 2
    expect(pendingInstructions(edited, 'ada', 1)).toEqual({ kind: 'update', instructions: '后端 + 评审' })
    // The update still counts as initial when the member was never dispatched.
    expect(pendingInstructions(edited, 'ada', undefined)).toEqual({ kind: 'initial', instructions: '后端 + 评审' })
  })

  it('is undefined without instructions', () => {
    resetSeq()
    const events = [ev('room/member-added', { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human' })]
    expect(pendingInstructions(events, 'ada', undefined)).toBeUndefined()
    expect(pendingInstructions(events, 'ghost', undefined)).toBeUndefined()
  })
})

describe('parseMentions', () => {
  it('parses no mention, one mention, and a fan-out', () => {
    expect(parseMentions('随便聊聊')).toEqual({ targets: [], text: '随便聊聊' })
    expect(parseMentions('@ada 看下这个')).toEqual({ targets: ['ada'], text: '看下这个' })
    expect(parseMentions('@ada @bill 对齐一下')).toEqual({ targets: ['ada', 'bill'], text: '对齐一下' })
  })

  it('dedupes repeated mentions and treats inline @ as plain text', () => {
    expect(parseMentions('@ada @ada 说')).toEqual({ targets: ['ada'], text: '说' })
    expect(parseMentions('问 @ada 一下')).toEqual({ targets: [], text: '问 @ada 一下' })
  })

  it('a bare mention leaves an empty body', () => {
    expect(parseMentions('@ada')).toEqual({ targets: ['ada'], text: '' })
  })
})
