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
import { memberRestartLine, restartBanner } from '../src/client/restart-view.ts'
import { MemberRestartLineView, RoomAutoContinueView, RoomRestartBanner } from '../src/client/RoomRestart.tsx'
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

describe('the composer banner', () => {
  it('setting off: the manual banner as before — names, 全部继续, no reasons', () => {
    const state = interrupted({ settings: { ...DEFAULT_ROOM_SETTINGS, autoContinueAfterRestart: false }, restartFacts: { queuePaused: ['m-ada'] } })
    const onContinueAll = vi.fn()
    render(<RoomRestartBanner sessionId="room-1" state={state} busy={false} onContinueAll={onContinueAll} t={t} />)
    expect(screen.getByTestId('restart-manual-banner').textContent).toContain('2 位成员被重启打断：ada、bill')
    expect(screen.getByTestId('restart-manual-banner').textContent).not.toContain('暂停')
    fireEvent.click(screen.getByRole('button', { name: '全部继续' }))
    expect(onContinueAll.mock.calls[0]![0].map((round: { member: string }) => round.member)).toEqual(['ada', 'bill'])
    expect(restartBanner(state).auto).toBeUndefined()
  })

  it('setting on: rounds the room is about to continue are not offered (pressing would send twice)', () => {
    const { container } = render(<RoomRestartBanner sessionId="room-1" state={interrupted()} busy={false} onContinueAll={vi.fn()} t={t} />)
    expect(container.textContent).toBe('')
  })

  it('auto-continued: 「重启后已自动继续 N 位成员 · 设置」, dismissible; the 设置 link opens the switch in place', async () => {
    const setSettings = vi.fn(async () => ({ ok: true as const }))
    const state: RoomState = {
      members: [ada, bill], relays: [], tasks: [], settings: DEFAULT_ROOM_SETTINGS,
      runs: [{ member: 'ada', runId: '7:m-ada', state: 'running', startedAt: 3 }, { member: 'bill', runId: '7:m-bill', state: 'running', startedAt: 3 }],
      deliveries: [delivery('7:m-ada', 'm-ada', { status: 'running', via: 'auto-continue' }), delivery('7:m-bill', 'm-bill', { status: 'queued', via: 'auto-continue' })],
      continued: ['4:m-ada', '5:m-bill'],
    }
    const view = render(<RoomRestartBanner sessionId="room-1" state={state} busy={false} onContinueAll={vi.fn()} setSettings={setSettings} t={t} />)
    expect(screen.getByTestId('restart-auto-banner').textContent).toContain('重启后已自动继续 2 位成员')
    expect(screen.queryByTestId('restart-manual-banner')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    const toggle = screen.getByRole('switch', { name: '重启后自动继续' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith({ autoContinueAfterRestart: false }))
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.queryByTestId('restart-auto-banner')).toBeNull()
    // Dismissed for this continue only (kept in the browser across renders).
    view.unmount()
    render(<RoomRestartBanner sessionId="room-1" state={state} busy={false} onContinueAll={vi.fn()} t={t} />)
    expect(screen.queryByTestId('restart-auto-banner')).toBeNull()
  })

  it('an auto-continued round interrupted again falls back to the human with the reason; the others are unaffected', () => {
    const state = interrupted({
      runs: [{ member: 'ada', runId: '7:m-ada', state: 'uncertain', startedAt: 3, error: LOST }, { member: 'bill', runId: '7:m-bill', state: 'running', startedAt: 3 }],
      deliveries: [delivery('7:m-ada', 'm-ada', { via: 'auto-continue' }), delivery('7:m-bill', 'm-bill', { status: 'running', via: 'auto-continue' })],
      continued: ['4:m-ada', '5:m-bill'],
    })
    render(<RoomRestartBanner sessionId="room-1" state={state} busy={false} onContinueAll={vi.fn()} t={t} />)
    const manual = screen.getByTestId('restart-manual-banner').textContent ?? ''
    expect(manual).toContain('ada 被重启打断')
    expect(manual).toContain('上次自动继续后又被打断，这次请你决定')
    expect(screen.getByTestId('restart-auto-banner').textContent).toContain('重启后已自动继续 1 位成员')
  })
})

describe('the timeline row and the members line', () => {
  const roomStore = (state: RoomState) => ({ subscribe: () => () => {}, getCached: () => state }) as never

  it('the room\'s auto-continue reads 「已自动继续：…（重启打断）」 and shows the message from 「房间 · 自动」', () => {
    const node = { key: 'k', kind: 'room-auto-continue', id: '7', target: 'chat', anchorSeq: 7, location: { kind: 'unresolved' }, visibility: 'visible',
      data: { seq: 7, time: 7, targets: ['ada', 'bill'], text: RESTART_CONTINUE_TEXT } }
    const setSettings = vi.fn(async () => ({ ok: true as const }))
    render(<RoomAutoContinueView {...{ node, sessionId: 'room-1', roomStore: roomStore(interrupted()), setSettings, t } as never} />)
    const row = screen.getByTestId('restart-auto-row').textContent ?? ''
    expect(row).toContain('已自动继续：ada、bill（重启打断）')
    expect(row).toContain('房间自动')
    expect(row).toContain('发给 ada、bill · 重启后自动继续')
    expect(row).toContain(RESTART_CONTINUE_TEXT)
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    fireEvent.click(screen.getByRole('switch', { name: '重启后自动继续' }))
    expect(setSettings).toHaveBeenCalledWith('room-1', { autoContinueAfterRestart: false })
  })

  it('members page: 「重启后已继续」 while the continued round runs, 「被重启打断」 while it waits for the human', () => {
    const running: RoomState = { members: [ada], relays: [], tasks: [], runs: [{ member: 'ada', runId: '7:m-ada', state: 'running', startedAt: 3 }],
      deliveries: [delivery('7:m-ada', 'm-ada', { status: 'running', via: 'auto-continue' })] }
    expect(memberRestartLine(running, 'ada')).toEqual({ kind: 'continued' })
    expect(memberRestartLine({ ...running, deliveries: [delivery('7:m-ada', 'm-ada', { status: 'done', via: 'auto-continue' })] }, 'ada')).toBeUndefined()
    render(<MemberRestartLineView state={running} member="ada" t={t} />)
    expect(screen.getByTestId('member-restart-line').textContent).toContain('重启后已继续这一轮结束后消失')
    cleanup()
    const off = interrupted({ settings: { ...DEFAULT_ROOM_SETTINGS, autoContinueAfterRestart: false } })
    expect(memberRestartLine(off, 'ada')).toEqual({ kind: 'interrupted' })
    render(<MemberRestartLineView state={off} member="ada" t={makeTranslate(en) as never} />)
    expect(screen.getByTestId('member-restart-line').textContent).toContain('Interrupted by a restartwaiting for you')
  })
})
