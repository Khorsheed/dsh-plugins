// @vitest-environment jsdom
/**
 * 重启后继续 (member-self-started-rounds M9): the shared interrupted-rounds
 * rule, and the composer banner / timeline row / members line built on it
 * (prototype member-activity.html states 4–7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { autoContinueRounds, interruptedRounds, RESTART_CONTINUE_TEXT } from '../src/restart-continue.ts'
import { restartBanner } from '../src/client/restart-view.ts'
import { RoomAutoContinueView, RoomRestartBanner } from '../src/client/RoomRestart.tsx'
import { roomAutoContinueDefinition } from '../src/client/nodes.ts'
import { en, zh } from '../src/client/locales.ts'
import { DEFAULT_ROOM_SETTINGS } from '../src/journal.ts'
import type { RoomDelivery, RoomMember, RoomState } from '../src/types.ts'

afterEach(cleanup)
beforeEach(() => { try { localStorage.clear() } catch { /* no storage */ } })

const LOST = 'Execution outcome is unknown after restart; reconcile before retrying'
const t = makeTranslate(zh) as never
const ada: RoomMember = { id: 'm-ada', name: 'ada', kind: 'cli', provider: 'kimi-cli', invitedBy: 'human', childSessionId: 'child-ada' as SessionId }
const bill: RoomMember = { id: 'm-bill', name: 'bill', kind: 'cli', provider: 'kimi-cli', invitedBy: 'human', childSessionId: 'child-bill' as SessionId }
const delivery = (id: string, memberId: string, extra: Partial<RoomDelivery> = {}): RoomDelivery =>
  ({ id, dispatchSeq: Number(id.split(':')[0]), memberId, status: 'uncertain', origin: 'human', text: '活', queuedAt: 1, task: 'task-1', ...extra })

/** ada and bill both cut off by a restart (the core says uncertain). */
function interrupted(extra: Partial<RoomState> = {}): RoomState {
  return {
    members: [ada, bill], relays: [], tasks: [],
    runs: [
      { member: 'ada', runId: '4:m-ada', state: 'uncertain', startedAt: 1, error: LOST },
      { member: 'bill', runId: '5:m-bill', state: 'uncertain', startedAt: 2, error: LOST },
    ],
    deliveries: [delivery('4:m-ada', 'm-ada'), delivery('5:m-bill', 'm-bill')],
    settings: DEFAULT_ROOM_SETTINGS,
    ...extra,
  }
}

describe('the shared rule', () => {
  it('lists every member whose latest room round a restart cut off; outside rounds and waiting rows are not the room\'s', () => {
    const state = interrupted({ runs: [
      { member: 'ada', runId: '4:m-ada', state: 'uncertain', startedAt: 1, error: LOST },
      { member: 'bill', runId: 'execution:x', state: 'uncertain', startedAt: 2, error: LOST },
    ] })
    expect(interruptedRounds(state)).toEqual([{ member: 'ada', memberId: 'm-ada', runId: '4:m-ada', task: 'task-1' }])
    expect(interruptedRounds(interrupted({ runs: [{ member: 'ada', runId: '9:m-ada', state: 'uncertain', startedAt: 1, waiting: 'reconcile' }] }))).toEqual([])
    // A legacy failed row with the restart reason counts (no run id: never automatic).
    const legacy = interrupted({ runs: [{ member: 'ada', state: 'failed', startedAt: 1, error: LOST }] })
    expect(interruptedRounds(legacy)).toEqual([{ member: 'ada', memberId: 'm-ada' }])
    expect(autoContinueRounds(legacy)).toEqual([])
  })

  it('auto-continues by default; off, already continued, again, self-triggered, paused queue, paused room and goal attempts do not', () => {
    expect(autoContinueRounds(interrupted()).map(round => round.member)).toEqual(['ada', 'bill'])
    expect(autoContinueRounds(interrupted({ settings: { ...DEFAULT_ROOM_SETTINGS, autoContinueAfterRestart: false } }))).toEqual([])
    expect(interruptedRounds(interrupted({ continued: ['4:m-ada'] })).map(round => round.member)).toEqual(['bill'])
    const blocked = interruptedRounds(interrupted({
      deliveries: [delivery('4:m-ada', 'm-ada', { via: 'auto-continue' }), delivery('5:m-bill', 'm-bill')],
      restartFacts: { restartInitiator: 'child-bill' },
    }))
    expect(blocked.map(round => round.blocked)).toEqual(['again', 'self-restart'])
    expect(interruptedRounds(interrupted({ restartFacts: { queuePaused: ['m-ada'] } })).map(round => round.blocked)).toEqual(['queue-paused', undefined])
    expect(interruptedRounds(interrupted({ settings: { ...DEFAULT_ROOM_SETTINGS, paused: true } })).map(round => round.blocked)).toEqual(['room-paused', 'room-paused'])
    const goal = interrupted({ deliveries: [delivery('4:m-ada', 'm-ada', { plan: { goalId: 'g', taskId: 't' } }), delivery('5:m-bill', 'm-bill')] })
    expect(autoContinueRounds(goal).map(round => round.member)).toEqual(['bill'])
  })
})

describe('only this restart\'s rounds (incident 2026-11-06)', () => {
  // ada's interruption edge was journaled at 100 (an earlier restart), bill's at 300; this process booted at 200.
  const mixed = (extra: Partial<RoomState> = {}) => interrupted({
    deliveries: [delivery('4:m-ada', 'm-ada', { interruptedAt: 100 }), delivery('5:m-bill', 'm-bill', { interruptedAt: 300 })],
    restartFacts: { bootedAt: 200 },
    ...extra,
  })

  it('a round whose interruption edge predates this boot is stale: never automatic, listed for 全部继续 without a reason', () => {
    expect(interruptedRounds(mixed()).map(round => [round.member, round.stale])).toEqual([['ada', true], ['bill', undefined]])
    expect(autoContinueRounds(mixed()).map(round => round.member)).toEqual(['bill'])
    expect(autoContinueRounds(mixed(), undefined, { recorded: true }).map(round => round.member)).toEqual(['bill'])
    const banner = restartBanner(mixed())
    expect(banner.manual.map(round => round.member)).toEqual(['ada'])
  })

  it('a legacy run edge (startedAt + elapsedMs) dates the interruption when the delivery has none', () => {
    const state = mixed({
      runs: [{ member: 'ada', runId: '4:m-ada', state: 'failed', startedAt: 50, elapsedMs: 50, error: LOST }],
      deliveries: [delivery('4:m-ada', 'm-ada', { status: 'failed' })],
    })
    expect(interruptedRounds(state)).toMatchObject([{ member: 'ada', stale: true }])
    expect(autoContinueRounds(state)).toEqual([])
  })

  it('the server pass needs the edge itself: a projection-only interruption only brings the room live', () => {
    const projected = interrupted({ restartFacts: { bootedAt: 200 } })
    expect(autoContinueRounds(projected).map(round => round.member)).toEqual(['ada', 'bill'])
    expect(autoContinueRounds(projected, undefined, { recorded: true })).toEqual([])
  })

  it('a round that started before the previous host process did is stale, however fresh its edge (a room no process loaded since that restart)', () => {
    // Both edges were just written by this process's recovery (300 ≥ boot 200);
    // ada's round started at 1, bill's at 160; the previous process started at 150.
    const state = interrupted({
      runs: [
        { member: 'ada', runId: '4:m-ada', state: 'uncertain', startedAt: 1, error: LOST },
        { member: 'bill', runId: '5:m-bill', state: 'uncertain', startedAt: 160, error: LOST },
      ],
      deliveries: [delivery('4:m-ada', 'm-ada', { interruptedAt: 300 }), delivery('5:m-bill', 'm-bill', { interruptedAt: 300 })],
      restartFacts: { bootedAt: 200, previousProcessStartedAt: 150 },
    })
    expect(interruptedRounds(state).map(round => [round.member, round.stale])).toEqual([['ada', true], ['bill', undefined]])
    expect(autoContinueRounds(state, undefined, { recorded: true }).map(round => round.member)).toEqual(['bill'])
    expect(restartBanner(state).manual.map(round => round.member)).toEqual(['ada'])
    // Without the record (first boot with it, or no core): the edge rule alone, as before.
    const { previousProcessStartedAt: _gone, ...edgeOnly } = state.restartFacts!
    expect(autoContinueRounds({ ...state, restartFacts: edgeOnly }, undefined, { recorded: true }).map(round => round.member)).toEqual(['ada', 'bill'])
  })
})

describe('the composer line (the one place the room asks the human)', () => {
  it('setting off: names, 停止 and 全部继续, no reasons', () => {
    const state = interrupted({ settings: { ...DEFAULT_ROOM_SETTINGS, autoContinueAfterRestart: false }, restartFacts: { queuePaused: ['m-ada'] } })
    const onContinue = vi.fn()
    const onStop = vi.fn()
    render(<RoomRestartBanner state={state} busy={false} onContinue={onContinue} onStop={onStop} t={t} />)
    const text = screen.getByTestId('restart-manual-banner').textContent ?? ''
    expect(text).toContain('2 位成员被重启打断：ada、bill')
    expect(text).not.toContain('暂停')
    expect(text).not.toContain('对账')
    expect(text).not.toContain('核对')
    fireEvent.click(screen.getByRole('button', { name: '全部继续' }))
    expect(onContinue.mock.calls[0]![0].map((round: { member: string }) => round.member)).toEqual(['ada', 'bill'])
    expect(onContinue.mock.calls[0]![1]).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(onStop.mock.calls[0]![0].map((round: { member: string }) => round.member)).toEqual(['ada', 'bill'])
  })

  it('setting on: rounds the room is about to continue are not offered, and nothing says the room continued them', () => {
    const { container } = render(<RoomRestartBanner state={interrupted()} busy={false} onContinue={vi.fn()} t={t} />)
    expect(container.textContent).toBe('')
    const running: RoomState = {
      members: [ada, bill], relays: [], tasks: [], settings: DEFAULT_ROOM_SETTINGS,
      runs: [{ member: 'ada', runId: '7:m-ada', state: 'running', startedAt: 3 }],
      deliveries: [delivery('7:m-ada', 'm-ada', { status: 'running', via: 'auto-continue' })],
      continued: ['4:m-ada'],
    }
    expect(render(<RoomRestartBanner state={running} busy={false} onContinue={vi.fn()} t={t} />).container.textContent).toBe('')
  })

  it('a reason only where the human cannot see it: interrupted again after an automatic continue, the member requested the restart — never the paused room', () => {
    const again = interrupted({
      runs: [{ member: 'ada', runId: '7:m-ada', state: 'cancelled', endedBy: 'restart', startedAt: 3 }, { member: 'bill', runId: '7:m-bill', state: 'running', startedAt: 3 }],
      deliveries: [delivery('7:m-ada', 'm-ada', { status: 'cancelled', endedBy: 'restart', via: 'auto-continue' }), delivery('7:m-bill', 'm-bill', { status: 'running', via: 'auto-continue' })],
      continued: ['4:m-ada', '5:m-bill'],
    })
    render(<RoomRestartBanner state={again} busy={false} onContinue={vi.fn()} t={t} />)
    const text = screen.getByTestId('restart-manual-banner').textContent ?? ''
    expect(text).toContain('ada 被重启打断')
    expect(text).toContain('上次自动继续后又被打断，这次请你决定')
    cleanup()
    const paused = interrupted({ settings: { ...DEFAULT_ROOM_SETTINGS, paused: true } })
    render(<RoomRestartBanner state={paused} busy={false} onContinue={vi.fn()} t={t} />)
    expect(screen.getByTestId('restart-manual-banner').textContent).not.toContain('房间已暂停')
  })

  it('a goal the restart paused: 「这个目标被重启打断」; 全部继续 continues the goal', () => {
    const goal = {
      version: 1 as const, id: 'g', revision: 2, objective: '北岭', status: 'paused' as const, reason: '被重启打断', activeMs: 0,
      budget: { maxParallel: 2, maxAttempts: 12, maxAttemptsPerTask: 3, maxActiveMs: 60_000 }, stages: [], tasks: [],
    }
    const state: RoomState = { members: [ada], relays: [], tasks: [], runs: [], settings: DEFAULT_ROOM_SETTINGS, plan: goal }
    const onContinue = vi.fn()
    render(<RoomRestartBanner state={state} busy={false} onContinue={onContinue} onStop={vi.fn()} t={t} />)
    expect(screen.getByTestId('restart-manual-banner').textContent).toContain('这个目标被重启打断')
    fireEvent.click(screen.getByRole('button', { name: '全部继续' }))
    expect(onContinue).toHaveBeenCalledWith([], true)
    // An older version's pause reason reads the same.
    expect(restartBanner({ ...state, plan: { ...goal, reason: 'Reconcile uncertain attempts before continuing' } }).goal).toEqual({ id: 'g' })
    expect(restartBanner({ ...state, plan: { ...goal, reason: '已停止' } }).goal).toBeUndefined()
  })
})

describe('the room\'s auto-continue node', () => {
  const roomStore = (state: RoomState) => ({ subscribe: () => () => {}, getCached: () => state }) as never

  it('reads 「房间 · 自动」, the message itself, and 设置 (the switch in place); no 「已自动继续」 line', () => {
    const node = { key: 'k', kind: 'room-auto-continue', id: '7', target: 'chat', anchorSeq: 7, location: { kind: 'unresolved' }, visibility: 'visible',
      data: { seq: 7, time: 7, targets: ['ada', 'bill'], text: RESTART_CONTINUE_TEXT } }
    const setSettings = vi.fn(async () => ({ ok: true as const }))
    render(<RoomAutoContinueView {...{ node, sessionId: 'room-1', roomStore: roomStore(interrupted()), setSettings, t } as never} />)
    const row = screen.getByTestId('restart-auto-row').textContent ?? ''
    expect(row).toContain('房间 · 自动')
    expect(row).toContain(RESTART_CONTINUE_TEXT)
    expect(row).not.toContain('已自动继续')
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    fireEvent.click(screen.getByRole('switch', { name: '重启后自动继续' }))
    expect(setSettings).toHaveBeenCalledWith('room-1', { autoContinueAfterRestart: false })
    cleanup()
    render(<RoomAutoContinueView {...{ node, sessionId: 'room-1', roomStore: roomStore(interrupted()), t: makeTranslate(en) } as never} />)
    expect(screen.getByTestId('restart-auto-row').textContent).toContain('Room · automatic')
  })

  it('gives a manual continuation without a user/message its own accurately labelled row', () => {
    const event = { type: 'room/dispatch', seq: 1777, time: 17_770, data: {
      origin: 'human', targets: ['人物建模大师'], text: RESTART_CONTINUE_TEXT,
      continues: ['1761:78e6ea0c-7631-47a4-9b41-c3de6c5a0fcb'], task: 'ca281806-e638-4402-a281-87950ffaebbd',
    } }
    expect(roomAutoContinueDefinition.match({ ...event, data: { ...event.data, messageId: 'u-human' } } as never)).toBeNull()
    expect(roomAutoContinueDefinition.match({ ...event, data: { ...event.data, origin: 'member' } } as never)).toBeNull()
    const match = roomAutoContinueDefinition.match(event as never)
    expect(match).toEqual({ id: '1777', role: 'start' })
    if (match === null || match.role !== 'start') throw new Error('manual continuation must have a start match')
    const state = roomAutoContinueDefinition.start({} as never, { event } as never)
    expect(state).toMatchObject({ seq: 1777, manual: true })
    const node = roomAutoContinueDefinition.buildViewNode({ key: '18:room-auto-continue1777', id: '1777', state } as never, {} as never)
    render(<RoomAutoContinueView {...{ node, sessionId: 'room-1', roomStore: roomStore(interrupted()), t } as never} />)
    expect(screen.getByTestId('restart-auto-row').textContent).toContain('房间 · 手动')
    expect(screen.getByTestId('restart-auto-row').getAttribute('data-room-dispatch')).toBe('1777')
    cleanup()
    render(<RoomAutoContinueView {...{ node, sessionId: 'room-1', roomStore: roomStore(interrupted()), t: makeTranslate(en) } as never} />)
    expect(screen.getByTestId('restart-auto-row').textContent).toContain('Room · manual')
  })
})
