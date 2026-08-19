import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import RoomService from '../src/index.ts'
import {
  isRoomLog, parseMentions, parseRelayDirective, pendingInstructions, previousCursor, replay,
} from '../src/journal.ts'
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
  it('folds the full vocabulary: roster, relays, tasks, run states', () => {
    resetSeq()
    const events = [
      ev('room/created', { version: 1 }),                                                    // 0
      ev('room/member-added', { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human', instructions: '后端', cwd: '/home/user/api' }), // 1
      ev('room/member-added', { name: 'bill', kind: 'cli', provider: 'codex', invitedBy: 'agent' }),                     // 2
      ev('room/member-updated', { name: 'ada', instructions: '后端 + 接口评审' }),           // 3
      ev('room/dispatch', { targets: ['ada', 'bill'], text: '出方案' }),                     // 4
      ev('room/task-added', { id: 't1', member: 'ada', title: '出方案', status: 'in_progress' }), // 5
      ev('room/speech', { member: 'ada', text: '方案 A', durationMs: 1200 }),                // 6
      ev('room/task-updated', { id: 't1', status: 'done' }),                                 // 7
      ev('room/run-state', { member: 'ada', state: 'running', startedAt: 100 }),             // 8
      ev('room/dispatch', { targets: ['ada'], text: '按方案 A 实现' }),                      // 9
      ev('room/run-state', { member: 'ada', state: 'done', startedAt: 100, elapsedMs: 900 }), // 10
      ev('room/relay', { id: 'r1', from: 'ada', to: 'bill', content: '接口定稿' }),           // 11
      ev('room/relay-resolved', { id: 'r1', state: 'confirmed' }),                           // 12
    ]
    const state = replay(events)
    expect(state.members).toEqual([
      { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human', instructions: '后端 + 接口评审', cwd: '/home/user/api' },
      { name: 'bill', kind: 'cli', provider: 'codex', invitedBy: 'agent' },
    ])
    expect(state.tasks).toEqual([{ id: 't1', member: 'ada', title: '出方案', status: 'done' }])
    expect(state.relays).toEqual([{ id: 'r1', from: 'ada', to: 'bill', content: '接口定稿', state: 'confirmed' }])
    // The latest run-state event wins.
    expect(state.runs).toEqual([{ member: 'ada', state: 'done', startedAt: 100, elapsedMs: 900 }])
  })

  it('member-removed cleans the roster and the run state; relays and tasks stay as history', () => {
    resetSeq()
    const events = [
      ev('room/created', { version: 1 }),
      ev('room/member-added', { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human' }),
      ev('room/dispatch', { targets: ['ada'], text: '干活' }),
      ev('room/task-added', { id: 't1', member: 'ada', title: '干活', status: 'in_progress' }),
      ev('room/relay', { id: 'r1', from: 'ada', to: 'bill', content: '看下' }),
      ev('room/run-state', { member: 'ada', state: 'running', startedAt: 100 }),
      ev('room/member-removed', { name: 'ada' }),
    ]
    const state = replay(events)
    expect(state.members).toEqual([])
    expect(state.runs).toEqual([])
    expect(state.tasks).toEqual([{ id: 't1', member: 'ada', title: '干活', status: 'in_progress' }])
    expect(state.relays).toEqual([{ id: 'r1', from: 'ada', to: 'bill', content: '看下', state: 'pending' }])
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

  it('relay/task resolutions fold by id, latest winning; resolutions of unknown ids are dropped', () => {
    resetSeq()
    const events = [
      ev('room/relay', { id: 'r1', from: 'ada', to: 'bill', content: '接口定稿' }),
      ev('room/relay-resolved', { id: 'ghost', state: 'dismissed' }),
      ev('room/relay-resolved', { id: 'r1', state: 'confirmed' }),
      ev('room/relay-resolved', { id: 'r1', state: 'sent' }),
      ev('room/task-added', { id: 't1', member: 'bill', title: '评接口', status: 'pending' }),
      ev('room/task-updated', { id: 'ghost', status: 'done' }),
      ev('room/task-updated', { id: 't1', status: 'in_progress' }),
      ev('room/task-updated', { id: 't1', status: 'cancelled' }),
    ]
    const state = replay(events)
    expect(state.relays).toEqual([{ id: 'r1', from: 'ada', to: 'bill', content: '接口定稿', state: 'sent' }])
    expect(state.tasks).toEqual([{ id: 't1', member: 'bill', title: '评接口', status: 'cancelled' }])
  })

  it('skips unknown legacy event types (the dropped room/note of the blackboard design)', () => {
    resetSeq()
    const events = [
      ev('room/created', { version: 1 }),
      ev('room/note', { text: '旧黑板消息' }),
      ev('room/member-added', { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human' }),
    ]
    const state = replay(events)
    expect(state.members).toHaveLength(1)
    expect(state.relays).toEqual([])
    expect(state.tasks).toEqual([])
  })

  it('isRoomLog keys on the marker only', () => {
    resetSeq()
    expect(isRoomLog([ev('room/created', { version: 1 })])).toBe(true)
    expect(isRoomLog([ev('room/dispatch', { targets: [], text: 'x' })])).toBe(false)
    expect(replay([ev('room/dispatch', { targets: [], text: 'x' })]).members).toEqual([])
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

describe('parseRelayDirective (the fallback notification channel)', () => {
  it('parses a trailing own-line @name directive', () => {
    expect(parseRelayDirective('方案已完成。\n@bill 接口定稿了，请评审'))
      .toEqual({ to: 'bill', content: '接口定稿了，请评审' })
  })

  it('ignores mentions inside prose and non-final lines', () => {
    expect(parseRelayDirective('我问过 @bill 了，他没问题')).toBeUndefined()
    expect(parseRelayDirective('@bill 先说这个\n后来又聊了别的')).toBeUndefined()
    expect(parseRelayDirective('@bill')).toBeUndefined()
    expect(parseRelayDirective('')).toBeUndefined()
    expect(parseRelayDirective('   ')).toBeUndefined()
  })

  it('tolerates trailing blank lines after the directive', () => {
    expect(parseRelayDirective('做完了。\n@bill 请接手\n\n')).toEqual({ to: 'bill', content: '请接手' })
  })
})
