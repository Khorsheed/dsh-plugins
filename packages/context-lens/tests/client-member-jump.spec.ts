/**
 * The room lens's hand-over to a member's own session (member-jump.ts): open
 * the session, wait for it to be on screen and for the lens kind to accept
 * the tab, give up after the timeout; and the panel's kept place, taken back once.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  KEPT_PLACE_MS, MEMBER_JUMP_TIMEOUT_MS, foreignLocate, forgetSelection, openInMemberSession, rememberSelection, sameSession, takeSelection, type MemberJumpDeps,
} from '../src/client/member-jump.ts'

/** A manual clock: `tick` runs the scheduled attempt after advancing time. */
function clock() {
  let time = 0
  const queue: Array<() => void> = []
  return {
    now: () => time,
    schedule: (callback: () => void, ms: number) => { queue.push(() => { time += ms; callback() }) },
    tick: (count = 1) => { for (let i = 0; i < count; i += 1) queue.shift()?.() },
    pending: () => queue.length,
  }
}

describe('openInMemberSession', () => {
  it('cannot start without a way to open sessions, or when opening throws', () => {
    const openTab = vi.fn(() => true)
    expect(openInMemberSession({ currentSession: () => undefined, openTab }, 'm1', { callId: 'c' })).toBe(false)
    expect(openInMemberSession({ openSession: () => { throw new Error('gone') }, currentSession: () => 'm1', openTab }, 'm1', { callId: 'c' })).toBe(false)
    expect(openTab).not.toHaveBeenCalled()
  })

  it('opens the tab only once the member session is on screen and the kind accepts it', () => {
    const c = clock()
    let current = 'session-room'
    const accepts = [false, true]
    const openTab = vi.fn(() => accepts.shift() ?? true)
    const deps: MemberJumpDeps = { openSession: vi.fn(() => {}), currentSession: () => current, openTab, schedule: c.schedule, now: c.now }
    expect(openInMemberSession(deps, '443e7c65', { callId: 'tool_x', hostTurn: 53 })).toBe(true)
    expect(deps.openSession).toHaveBeenCalledWith('443e7c65')
    expect(openTab).not.toHaveBeenCalled()
    c.tick()
    expect(openTab).not.toHaveBeenCalled()
    // The id appears with the session- prefix once switched.
    current = 'session-443e7c65'
    c.tick()
    expect(openTab).toHaveBeenCalledTimes(1)
    c.tick()
    expect(openTab).toHaveBeenCalledTimes(2)
    // The navigation names the member session: another session's lens leaves it alone.
    expect(openTab).toHaveBeenLastCalledWith({ locateCall: { callId: 'tool_x', hostTurn: 53, session: '443e7c65' } })
    expect(c.pending()).toBe(0)
  })

  it('gives up after the timeout when the member session never comes up', () => {
    const c = clock()
    const openTab = vi.fn(() => true)
    openInMemberSession({ openSession: () => {}, currentSession: () => 'session-room', openTab, schedule: c.schedule, now: c.now }, 'm1', { callId: 'c' })
    c.tick(MEMBER_JUMP_TIMEOUT_MS / 100 + 5)
    expect(openTab).not.toHaveBeenCalled()
    expect(c.pending()).toBe(0)
  })

  it('sameSession ignores the session- prefix', () => {
    expect(sameSession('session-abc', 'abc')).toBe(true)
    expect(sameSession('abc', 'abd')).toBe(false)
    expect(sameSession(undefined, 'abc')).toBe(false)
  })
})

describe('kept panel place', () => {
  const place = { revision: 3, viewed: null, turnSeq: 84, scopeId: 'main', selectedSeq: 12, mainTab: 'token' as const }

  it('is taken back by every mount on the way back, under the same or a restarted revision, until forgotten', () => {
    rememberSelection('room', place)
    expect(takeSelection('room', 3)).toEqual(place)
    // A second mount (the Sidebar re-adopting its store) still gets it.
    expect(takeSelection('room', 3)).toEqual(place)
    expect(takeSelection('room', 0)).toEqual(place)
    forgetSelection('room')
    expect(takeSelection('room', 3)).toBeUndefined()
  })

  it('loses to a newer navigation, for good', () => {
    rememberSelection('room', place)
    expect(takeSelection('room', 4)).toBeUndefined()
    expect(takeSelection('room', 3)).toBeUndefined()
  })

  it('a newer navigation that is a call for another session does not take it away', () => {
    rememberSelection('room', place)
    const params = { locateCall: { callId: 'tool_x', session: '443e7c65' } }
    expect(foreignLocate(params, 'room')).toBe(true)
    expect(foreignLocate(params, 'session-443e7c65')).toBe(false)
    expect(foreignLocate({ locateCall: { callId: 'tool_x' } }, 'room')).toBe(false)
    expect(takeSelection('room', 4, foreignLocate(params, 'room'))).toEqual(place)
  })

  it('expires', () => {
    rememberSelection('room', place, 1_000)
    expect(takeSelection('room', 3, false, 1_000 + KEPT_PLACE_MS + 1)).toBeUndefined()
  })
})
