// @vitest-environment jsdom
/**
 * Restart recovery in the browser (restart-recovery consolidation R5,
 * prototype restart-recovery.html): a round a restart cut off says so on its
 * own closed card and nowhere else; the goal panel shows it as one line of the
 * attempt history; nothing asks the human to reconcile.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { RoomRunView } from '../src/client/RoomRunView.tsx'
import { RoomPlanView } from '../src/client/RoomPlanView.tsx'
import { roomRunDefinition } from '../src/client/nodes.ts'
import { en, zh } from '../src/client/locales.ts'
import { MEMBER_WAITING_TEXT, RESTART_UNKNOWN_TEXT } from '../src/restart-interrupted.ts'
import { recoverPlan, admitPlanAttempt, changePlan, queuePlanAttempt } from '../src/plan.ts'
import type { RoomPlan } from '../src/plan.ts'
import type { RoomMember, RoomState } from '../src/types.ts'

afterEach(cleanup)

const t = makeTranslate(zh) as never
const mapper: RoomMember = { id: 'm-map', name: '地图匠', kind: 'cli', provider: 'kimi-cli', invitedBy: 'human', childSessionId: 'child-map' as never }
const roomStore = (state: RoomState) => ({ subscribe: () => () => {}, getCached: () => state }) as never
const node = (data: Record<string, unknown>) => ({ key: 'k', kind: 'room-run', id: 'x', target: 'chat', anchorSeq: 5, location: { kind: 'unresolved' }, visibility: 'visible', data: { seq: 5, time: 5, member: '地图匠', startedAt: 100, runId: '4:m-map', ...data } })
const card = (data: Record<string, unknown>, state: Partial<RoomState> = {}, renderMemberOutput = vi.fn(() => <p>地形已经写了一半</p>)) => render(<RoomRunView {...{
  node: node(data), sessionId: 'room-1', roomStore: roomStore({ members: [mapper], relays: [], tasks: [], runs: [], ...state }),
  openSession: vi.fn(), cancelMember: vi.fn(), renderMemberOutput, renderSlot: () => null, t,
} as never} />)

describe('the closed card: the one place a round says 被重启打断', () => {
  it('a round closed by recovery: its title line, quiet, no stop button, its output up to the cut-off', () => {
    const output = vi.fn(() => <p>地形已经写了一半</p>)
    const view = card({ state: 'cancelled', endedBy: 'restart' }, { deliveries: [{ id: '4:m-map', dispatchSeq: 4, memberId: 'm-map', status: 'cancelled', endedBy: 'restart', interruptedAt: 900, origin: 'coordinator', text: '活', queuedAt: 50 }] }, output)
    expect(view.container.textContent).toContain('地图匠 · 被重启打断')
    expect(view.container.textContent).toContain('地形已经写了一半')
    expect(output).toHaveBeenCalledWith('child-map', 100, { until: 900 })
    expect(screen.queryByRole('button', { name: /停止|Stop/ })).toBeNull()
    expect(view.container.textContent).not.toMatch(/对账|核对|结果不确定/)
  })

  it('legacy shapes read the same: a restart-failed card (English reason never shown), a projected uncertain run', () => {
    const legacy = card({ state: 'failed', error: RESTART_UNKNOWN_TEXT, elapsedMs: 50 })
    expect(legacy.container.textContent).toContain('地图匠 · 被重启打断')
    expect(legacy.container.textContent).not.toContain('Execution outcome')
    cleanup()
    const projected = card({ state: 'running' }, { executions: [{ id: '4:m-map', runId: '4:m-map', member: '地图匠', memberId: 'm-map', state: 'cancelled', endedBy: 'restart', startedAt: 100 }] })
    expect(projected.container.textContent).toContain('被重启打断')
    cleanup()
    const english = render(<RoomRunView {...{ node: node({ state: 'cancelled', endedBy: 'restart' }), sessionId: 'room-1', roomStore: roomStore({ members: [mapper], relays: [], tasks: [], runs: [] }), openSession: vi.fn(), cancelMember: vi.fn(), renderSlot: () => null, t: makeTranslate(en) } as never} />)
    expect(english.container.textContent).toContain('interrupted by a restart')
  })

  it('a legacy 待对账 wait row (a message that never ran) shows nothing; an ordinary cancellation stays hidden', () => {
    expect(card({ state: 'failed', error: MEMBER_WAITING_TEXT }).container.textContent).toBe('')
    cleanup()
    expect(card({ state: 'cancelled' }).container.textContent).toBe('')
  })

  it('the run Definition keeps a restart-closed card visible and hides an ordinary cancellation', () => {
    const context = (state: Record<string, unknown>) => ({ key: 'k', id: 'x', start: { location: { kind: 'unresolved' } }, state: { seq: 5, time: 5, member: '地图匠', startedAt: 100, ...state } })
    expect((roomRunDefinition.buildViewNode(context({ state: 'cancelled', endedBy: 'restart' }) as never) as { visibility: string }).visibility).toBe('visible')
    expect((roomRunDefinition.buildViewNode(context({ state: 'cancelled' }) as never) as { visibility: string }).visibility).toBe('hidden')
    const updated = roomRunDefinition.update(context({ state: 'running' }) as never, { event: { type: 'room/run-state', seq: 6, time: 6, data: { member: '地图匠', startedAt: 100, state: 'cancelled', endedBy: 'restart' } } } as never)
    expect(updated).toMatchObject({ state: 'cancelled', endedBy: 'restart' })
  })
})

describe('the goal panel: one line of the attempt history', () => {
  const members = new Set(['m-map'])
  const context = { actor: { kind: 'coordinator' as const, memberId: 'm-map' }, memberIds: members, now: 0 }
  function goal(): RoomPlan {
    let plan = changePlan(undefined, { action: 'create', requestId: 'c', expectedRevision: 0, id: 'north', objective: '北岭关卡', mode: 'execute', budget: { maxParallel: 2, maxAttempts: 12, maxAttemptsPerTask: 3, maxActiveMs: 7_200_000 } }, context)
    plan = changePlan(plan, { action: 'extend', requestId: 'e', expectedRevision: plan.revision, stages: [{ id: 's', title: '北岭' }], tasks: [{ id: 'level', title: '北岭关卡数据', stageId: 's', kind: 'task', ownerMemberId: 'm-map', instruction: '做关卡', criteria: ['可核对'], inputRefs: [], artifactPaths: [], dependsOn: [] }] }, context)
    plan = admitPlanAttempt(queuePlanAttempt(plan, 'level', 'a1', 'd1', 10), 'level', 'a1', 20)
    plan = recoverPlan(plan, 30, { autoContinue: true })
    return admitPlanAttempt(queuePlanAttempt(plan, 'level', 'a2', 'd2', 40), 'level', 'a2', 50)
  }

  it('「第 1 次 · 被重启打断」「第 2 次 · 执行中」, the budget counts only the second, no reconciliation', () => {
    const view = render(<RoomPlanView plan={goal()} members={[mapper]} command={vi.fn()} expanded t={t} />)
    fireEvent.click(screen.getByText(/北岭关卡数据/))
    const text = view.container.textContent ?? ''
    expect(text).toContain('第 1 次 · 被重启打断')
    expect(text).toContain('第 2 次')
    expect(text).toContain('尝试 1 / 12')
    expect(text).not.toMatch(/对账|结果未知|Execution outcome/)
  })

  it('a goal paused by a restart shows no reason line (the composer line explains and acts)', () => {
    const paused = recoverPlan(admitPlanAttempt(queuePlanAttempt(changePlan(changePlan(undefined, { action: 'create', requestId: 'c', expectedRevision: 0, id: 'g', objective: '北岭', mode: 'execute', budget: { maxParallel: 1, maxAttempts: 3, maxAttemptsPerTask: 3, maxActiveMs: 60_000 } }, context),
      { action: 'extend', requestId: 'e', expectedRevision: 1, stages: [{ id: 's', title: 'S' }], tasks: [{ id: 't', title: 'T', stageId: 's', kind: 'task', ownerMemberId: 'm-map', instruction: 'x', criteria: ['y'], inputRefs: [], artifactPaths: [], dependsOn: [] }] }, context), 't', 'a1', 'd1', 1), 't', 'a1', 2), 3)
    expect(paused.reason).toBe('被重启打断')
    const view = render(<RoomPlanView plan={paused} members={[mapper]} command={vi.fn()} expanded t={t} />)
    expect(view.container.querySelector('[role="status"]')).toBeNull()
  })
})
