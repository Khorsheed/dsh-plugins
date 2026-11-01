/**
 * The follow rule and the follower: only appended (live) results whose call
 * was appended too move the Sidebar; replays, other kinds, errors, a busy
 * panel, a narrow window and a second destination in one Turn do not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { destinationLine } from '../src/destination.ts'
import { BUSY_MS, decideFollow, markInteraction, navRegistry, startNavFollower, type NavFollowerHost } from '../src/client/follow.ts'

const base = { live: true, onScreen: true, idleMs: undefined, narrow: false, seen: false, turnFollowed: false }

describe('decideFollow', () => {
  it('follows a watched call and names the first failing check otherwise', () => {
    expect(decideFollow(base)).toEqual({ decision: 'follow', reason: 'watched' })
    expect(decideFollow({ ...base, seen: true, live: false })).toEqual({ decision: 'skip', reason: 'seen' })
    expect(decideFollow({ ...base, live: false })).toEqual({ decision: 'skip', reason: 'replay' })
    expect(decideFollow({ ...base, onScreen: false })).toEqual({ decision: 'badge', reason: 'offscreen' })
    expect(decideFollow({ ...base, role: 'member' })).toEqual({ decision: 'badge', reason: 'member' })
    expect(decideFollow({ ...base, role: 'coordinator' })).toEqual({ decision: 'follow', reason: 'watched' })
    expect(decideFollow({ ...base, narrow: true })).toEqual({ decision: 'badge', reason: 'narrow' })
    expect(decideFollow({ ...base, idleMs: BUSY_MS - 1 })).toEqual({ decision: 'badge', reason: 'busy' })
    expect(decideFollow({ ...base, idleMs: BUSY_MS })).toEqual({ decision: 'follow', reason: 'watched' })
    expect(decideFollow({ ...base, turnFollowed: true })).toEqual({ decision: 'badge', reason: 'turn-once' })
  })
})

/** A fake host: one on-screen session whose event window the test drives. */
function fakeHost(sessionId = 's1') {
  let screen: string | undefined = sessionId
  const screenListeners = new Set<() => void>()
  const windows = new Map<string, { snapshot: { change: { kind: string; entries: unknown[] } }; listeners: Set<() => void> }>()
  const windowOf = (id: string) => {
    let w = windows.get(id)
    if (w === undefined) { w = { snapshot: { change: { kind: 'replace', entries: [] } }, listeners: new Set() }; windows.set(id, w) }
    return w
  }
  const host: NavFollowerHost = {
    onScreen: { getSnapshot: () => screen, subscribe: l => { screenListeners.add(l); return () => { screenListeners.delete(l) } } },
    events: id => {
      const w = windowOf(id)
      return { getSnapshot: () => w.snapshot as never, subscribe: l => { w.listeners.add(l); return () => { w.listeners.delete(l) } } }
    },
  }
  const publish = (id: string, kind: string, events: unknown[]) => {
    const w = windowOf(id)
    w.snapshot = { change: { kind, entries: events.map(event => ({ type: 'event', event })) } }
    for (const l of [...w.listeners]) l()
  }
  return {
    host,
    call: (callId: string, turn = 1, id = sessionId) => { publish(id, 'append', [{ type: 'tool/call', data: { turn, callId, name: 'novel_write' } }]) },
    result: (callId: string, text: string, turn = 1, id = sessionId, kind = 'append', isError = false) => {
      publish(id, kind, [{ type: 'tool/result', data: { turn, message: { source: { callId }, isError, content: [{ type: 'text', text }] } } }])
    },
    replay: (events: unknown[], id = sessionId) => { publish(id, 'replace', events) },
    append: (event: unknown, id = sessionId) => { publish(id, 'append', [event]) },
    switchTo: (id: string | undefined) => { screen = id; for (const l of [...screenListeners]) l() },
  }
}

const dest = (id: string, kind = 'canvas') => destinationLine({ id, kind, params: { canvasId: 'c1' }, label: id })

describe('startNavFollower', () => {
  beforeEach(() => {
    const registry = navRegistry()
    registry.seen.clear()
    registry.turnFollowed.clear()
    registry.lastInteraction = undefined
  })

  it('follows a live call once, and badges a second destination in the same Turn', () => {
    const fake = fakeHost()
    const open = vi.fn()
    const badge = vi.fn()
    const log = vi.fn()
    startNavFollower(fake.host, { kinds: ['canvas'], open, badge, log, width: () => 1400 })
    fake.call('a')
    fake.result('a', `ok\n${dest('d1')}`)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0]![0].id).toBe('d1')
    fake.call('b')
    fake.result('b', `ok\n${dest('d2')}`)
    expect(open).toHaveBeenCalledTimes(1)
    expect(badge.mock.calls[0]![0].id).toBe('d2')
    // The same id again (a re-sent answer) is skipped.
    fake.result('a', `ok\n${dest('d1')}`)
    expect(open).toHaveBeenCalledTimes(1)
    expect(log.mock.calls.map(c => c[0])).toEqual([
      '[nav] dest=d1 kind=canvas decision=follow reason=watched session=s1',
      '[nav] dest=d2 kind=canvas decision=badge reason=turn-once session=s1',
      '[nav] dest=d1 kind=canvas decision=skip reason=seen session=s1',
    ])
  })

  it('a new Turn may follow again', () => {
    const fake = fakeHost()
    const open = vi.fn()
    startNavFollower(fake.host, { kinds: ['canvas'], open, log: () => {}, width: () => 1400 })
    fake.call('a', 1); fake.result('a', dest('d1'), 1)
    fake.call('b', 2); fake.result('b', dest('d2'), 2)
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('never follows a replay, a result whose call it did not see, an error, or another kind', () => {
    const fake = fakeHost()
    const open = vi.fn()
    const badge = vi.fn()
    startNavFollower(fake.host, { kinds: ['canvas'], open, badge, log: () => {}, width: () => 1400 })
    fake.replay([
      { type: 'tool/call', data: { turn: 1, callId: 'a' } },
      { type: 'tool/result', data: { turn: 1, message: { source: { callId: 'a' }, content: [{ type: 'text', text: dest('d1') }] } } },
    ])
    fake.result('z', dest('d2'))
    fake.call('e'); fake.result('e', dest('d3'), 1, 's1', 'append', true)
    fake.call('k'); fake.result('k', dest('d4', 'library'))
    expect(open).not.toHaveBeenCalled()
    expect(badge).not.toHaveBeenCalled()
  })

  it('badges while the person works in a panel, or in a narrow window', () => {
    const fake = fakeHost()
    const open = vi.fn()
    const badge = vi.fn()
    let width = 1400
    let clock = 100_000
    startNavFollower(fake.host, { kinds: ['canvas'], open, badge, log: () => {}, width: () => width, now: () => clock })
    markInteraction(clock - 5_000)
    fake.call('a'); fake.result('a', dest('d1'))
    clock += BUSY_MS
    width = 600
    fake.call('b', 2); fake.result('b', dest('d2'), 2)
    expect(open).not.toHaveBeenCalled()
    expect(badge.mock.calls.map(c => c[0].id)).toEqual(['d1', 'd2'])
  })

  it('judges an owner\'s own live events with their role: the coordinator\'s follows, a member\'s badges, a replay never', () => {
    const fake = fakeHost()
    const open = vi.fn()
    const badge = vi.fn()
    const events = (event: { type: string; seq?: number; data?: unknown }) => event.type !== 'room/desk-opened' ? [] : [{
      destination: { id: `desk:${event.seq}`, kind: 'canvas', params: { canvasId: 'c1' }, label: '画布' },
      role: (event.data as { role: 'coordinator' | 'member' }).role,
    }]
    startNavFollower(fake.host, { kinds: ['canvas'], open, badge, events, log: () => {}, width: () => 1400 })
    const desk = (seq: number, role: string) => ({ type: 'room/desk-opened', seq, data: { role } })
    fake.replay([desk(1, 'coordinator')])
    expect(open).not.toHaveBeenCalled()
    fake.append(desk(2, 'member'))
    expect(badge.mock.calls.map(c => c[0].id)).toEqual(['desk:2'])
    fake.append(desk(3, 'coordinator'))
    expect(open.mock.calls.map(c => c[0].id)).toEqual(['desk:3'])
  })

  it('follows the session on screen only, re-attaching when it changes', () => {
    const fake = fakeHost('s1')
    const open = vi.fn()
    startNavFollower(fake.host, { kinds: ['canvas'], open, log: () => {}, width: () => 1400 })
    fake.switchTo('s2')
    fake.call('a', 1, 's1'); fake.result('a', dest('d1'), 1, 's1')
    expect(open).not.toHaveBeenCalled()
    fake.call('b', 1, 's2'); fake.result('b', dest('d2'), 1, 's2')
    expect(open.mock.calls[0]![0].id).toBe('d2')
  })
})
