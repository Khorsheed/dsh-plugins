/**
 * The one reader of 「被重启打断」 (restart-interrupted.ts): the new mark and
 * every shape older logs carry, read by data — never by date.
 */
import { describe, expect, it } from 'vitest'
import {
  AUTO_CONTINUE_MOVED_ON_TEXT, DELIVERY_UNKNOWN_TEXT, HELP_MOVED_ON_TEXT, MEMBER_WAITING_TEXT, MOVED_ON_TEXT, RESTART_STOPPED_TEXT, RESTART_UNKNOWN_TEXT,
  STOPPED_UNCHECKED_TEXT, SUPERSEDED_BACKLOG_TEXT, deliveryEnding, interruptedByRestart, obsoleteRestartReport, restartHandled,
} from '../src/restart-interrupted.ts'
import { interruptedRounds } from '../src/restart-continue.ts'
import { DEFAULT_ROOM_SETTINGS } from '../src/journal.ts'
import type { RoomDelivery, RoomMember, RoomMemberRun, RoomState } from '../src/types.ts'

describe('interruptedByRestart', () => {
  it('reads the new mark and the four legacy shapes as 被重启打断', () => {
    expect(interruptedByRestart({ state: 'cancelled', endedBy: 'restart' })).toBe(true)
    // 1. a delivery's `uncertain` edge
    expect(interruptedByRestart({ state: 'uncertain', error: DELIVERY_UNKNOWN_TEXT })).toBe(true)
    // 2. a run failed with the legacy restart reason
    expect(interruptedByRestart({ state: 'failed', error: RESTART_UNKNOWN_TEXT })).toBe(true)
    // 3. a 「按没做完处理」/「任务已被停止」 cancellation
    for (const text of [MOVED_ON_TEXT, AUTO_CONTINUE_MOVED_ON_TEXT, HELP_MOVED_ON_TEXT, STOPPED_UNCHECKED_TEXT]) expect(interruptedByRestart({ state: 'cancelled', text })).toBe(true)
    // 4. a queued message 「被取代」
    expect(interruptedByRestart({ state: 'cancelled', text: SUPERSEDED_BACKLOG_TEXT })).toBe(true)
  })

  it('is not fooled by ordinary endings, a human-reconciled outcome, or a row that never ran', () => {
    expect(interruptedByRestart({ state: 'cancelled' })).toBe(false)
    expect(interruptedByRestart({ state: 'cancelled', text: '你编辑了这条消息' })).toBe(false)
    expect(interruptedByRestart({ state: 'failed', error: 'the member round failed' })).toBe(false)
    expect(interruptedByRestart({ state: 'done', text: '不确认是否做完' })).toBe(false)
    expect(interruptedByRestart({ state: 'failed', error: MEMBER_WAITING_TEXT })).toBe(false)
    expect(interruptedByRestart(undefined)).toBe(false)
  })

  it('a stopped round and an older move-on need no decision; a plain closing does', () => {
    expect(restartHandled({ state: 'cancelled', endedBy: 'restart', text: RESTART_STOPPED_TEXT })).toBe(true)
    expect(restartHandled({ state: 'cancelled', text: MOVED_ON_TEXT })).toBe(true)
    expect(restartHandled({ state: 'cancelled', endedBy: 'restart', text: '被重启打断' })).toBe(false)
    expect(restartHandled({ state: 'uncertain' })).toBe(false)
  })

  it('retires the obsolete restart reports only', () => {
    expect(obsoleteRestartReport(RESTART_UNKNOWN_TEXT)).toBe(true)
    expect(obsoleteRestartReport(SUPERSEDED_BACKLOG_TEXT)).toBe(true)
    expect(obsoleteRestartReport('Human reconciled task t, attempt a as submitted. Evidence: {}')).toBe(true)
    expect(obsoleteRestartReport('北岭三段对话写好了')).toBe(false)
  })
})

describe('interruptedRounds over the legacy shapes', () => {
  const ada: RoomMember = { id: 'm-ada', name: 'ada', kind: 'cli', provider: 'kimi-cli', invitedBy: 'human' }
  const state = (run: RoomMemberRun, delivery: Partial<RoomDelivery>): RoomState => ({
    members: [ada], relays: [], tasks: [], runs: [run], settings: DEFAULT_ROOM_SETTINGS,
    deliveries: [{ id: '4:m-ada', dispatchSeq: 4, memberId: 'm-ada', status: 'cancelled', origin: 'human', text: '活', queuedAt: 1, ...delivery }],
  })
  const run = (extra: Partial<RoomMemberRun>): RoomMemberRun => ({ member: 'ada', runId: '4:m-ada', state: 'cancelled', startedAt: 1, ...extra })

  it('an open round: the new mark, an `uncertain` delivery, a restart-failed card', () => {
    expect(interruptedRounds(state(run({ endedBy: 'restart' }), { endedBy: 'restart' }))).toMatchObject([{ member: 'ada', runId: '4:m-ada' }])
    expect(interruptedRounds(state(run({ state: 'failed', error: RESTART_UNKNOWN_TEXT }), { status: 'uncertain' }))).toMatchObject([{ member: 'ada' }])
    expect(interruptedRounds(state(run({ state: 'failed', error: RESTART_UNKNOWN_TEXT }), { status: 'failed' }))).toMatchObject([{ member: 'ada' }])
  })

  it('handled: a legacy move-on, a stop, a continuation — none listed', () => {
    expect(interruptedRounds(state(run({}), { note: MOVED_ON_TEXT }))).toEqual([])
    expect(interruptedRounds(state(run({ endedBy: 'restart' }), { endedBy: 'restart', note: RESTART_STOPPED_TEXT }))).toEqual([])
    expect(interruptedRounds({ ...state(run({ endedBy: 'restart' }), { endedBy: 'restart' }), continued: ['4:m-ada'] })).toEqual([])
  })

  it('deliveryEnding maps a projected delivery onto an edge', () => {
    expect(deliveryEnding({ status: 'cancelled', note: MOVED_ON_TEXT })).toEqual({ state: 'cancelled', text: MOVED_ON_TEXT })
  })
})
