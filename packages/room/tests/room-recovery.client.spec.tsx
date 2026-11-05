// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { RoomRecoveryView } from '../src/client/RoomRecoveryView.tsx'
import { RoomRunView } from '../src/client/RoomRunView.tsx'
import { RoomDispatchView } from '../src/client/RoomDispatchView.tsx'
import { RoomStore, type RoomGateway } from '../src/client/room-store.ts'
import type { RoomDispatchViewProps, RoomRunViewProps } from '../src/client/slots.ts'
import { en, zh } from '../src/client/locales.ts'
import type { RoomDelivery, RoomState } from '../src/types.ts'

afterEach(cleanup)
const t = ((key: keyof typeof en) => en[key]) as never
const member = { id: 'coordinator', name: 'Kimi', kind: 'cli' as const, invitedBy: 'human' as const, childSessionId: 'child' as never }
const row: RoomDelivery = { id: '12:coordinator', dispatchSeq: 12, memberId: 'coordinator', status: 'uncertain', origin: 'human', text: 'Interrupted request' }

it('requires evidence, opens the same member session and preserves input on failed reconciliation', async () => {
  const reconcile = vi.fn().mockResolvedValueOnce({ ok: false, message: 'Unavailable' }).mockResolvedValue({ ok: true })
  const openSession = vi.fn()
  render(<RoomRecoveryView deliveries={[row]} members={[member]} reconcile={reconcile} openSession={openSession} t={t} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open member session' }))
  expect(openSession).toHaveBeenCalledWith('child')
  fireEvent.click(screen.getByRole('button', { name: 'Reconcile' }))
  expect((screen.getByRole('button', { name: 'Confirm completed' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Decision or reason'), { target: { value: 'Inspected child history: incomplete output' } })
  fireEvent.click(screen.getByRole('button', { name: 'Abandon this execution' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Unavailable'))
  expect((screen.getByLabelText('Decision or reason') as HTMLTextAreaElement).value).toContain('incomplete output')
  fireEvent.click(screen.getByRole('button', { name: 'Abandon this execution' }))
  await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(2))
  expect(reconcile).toHaveBeenLastCalledWith(row.id, 'cancelled', 'Inspected child history: incomplete output')
})

it('leaves formal task reconciliation to the plan and ordinary queued work untouched', () => {
  render(<RoomRecoveryView deliveries={[
    { ...row, status: 'queued' },
    { ...row, id: 'task', plan: { goalId: 'goal', taskId: 'task', attemptId: 'attempt' } },
  ]} members={[member]} reconcile={vi.fn()} openSession={vi.fn()} t={t} />)
  expect(screen.queryByTestId('room-recovery')).toBeNull()
})

// Batch 5 S7: the core's ledger is the one place a restart-lost round is
// recorded; the room's timeline row and dispatch line read 待对账 from the
// projection instead of 运行失败.
describe('待对账 in the timeline (batch 5 S7)', () => {
  const zhT = makeTranslate(zh)
  const ada = { name: 'ada', id: 'm-ada', kind: 'cli' as const, provider: 'kimi', invitedBy: 'human' as const, childSessionId: 'child-ada' as SessionId }
  async function storeOf(state: Partial<RoomState>): Promise<RoomStore> {
    const full: RoomState = { members: [ada], relays: [], tasks: [], runs: [], ...state }
    const gateway: RoomGateway = { isRoom: async () => ({ ok: true, value: true }), getState: async () => ({ ok: true, value: { ok: true, value: full } }) }
    const store = new RoomStore({ sessions: { list: createSnapshotStore<{ current: SessionId | undefined }>({ current: undefined }) } } as unknown as Context, gateway)
    await store.ensure('room-1' as SessionId)
    return store
  }
  const runNode = (data: Record<string, unknown>) => ({ key: 'k', kind: 'room-run', id: '3', target: 'chat', anchorSeq: 3, location: { kind: 'unresolved' }, visibility: 'visible',
    data: { seq: 3, time: 1003, member: 'ada', startedAt: 1000, ...data } })
  function renderRun(store: RoomStore, data: Record<string, unknown>) {
    const cancelMember = vi.fn()
    const openSession = vi.fn()
    render(<RoomRunView {...{ node: runNode(data), sessionId: 'room-1' as SessionId, roomStore: store, openSession, cancelMember, renderMemberOutput: vi.fn(), t: zhT } as unknown as RoomRunViewProps} />)
    return { cancelMember, openSession }
  }
  const RESTART = 'Execution outcome is unknown after restart; reconcile before retrying'

  it('a round the core holds as uncertain reads 待对账 with the hint, no stop, and still opens the member session', async () => {
    const store = await storeOf({ executions: [{ id: '5:m-ada', runId: '5:m-ada', member: 'ada', memberId: 'm-ada', startedAt: 1000, state: 'uncertain', executionId: 'exec-1', error: RESTART }] })
    // The journal's card: the running edge, closed failed by recovery.
    const { openSession } = renderRun(store, { runId: '5:m-ada', state: 'failed', error: RESTART })
    expect(screen.getByText('ada 的这一轮待对账')).toBeDefined()
    expect(screen.getByText(`· ${zh['run.uncertainHint']}`)).toBeDefined()
    expect(screen.queryByText('ada 运行失败')).toBeNull()
    expect(screen.queryByText(RESTART)).toBeNull()
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull()
    expect(document.querySelector('[data-state="uncertain"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /待对账/ }))
    expect(openSession).toHaveBeenCalledWith('child-ada')
  })

  it('reconciled anywhere, the same card goes away (the projection reads the core\'s outcome)', async () => {
    const store = await storeOf({ executions: [{ id: '5:m-ada', runId: '5:m-ada', member: 'ada', memberId: 'm-ada', startedAt: 1000, state: 'cancelled', executionId: 'exec-1' }] })
    renderRun(store, { runId: '5:m-ada', state: 'failed', error: RESTART })
    expect(screen.queryByText(/待对账|运行失败/)).toBeNull()
  })

  it('a delivery waiting for its member\'s 待对账 says it has not gone out; once it runs, the waiting row steps aside', async () => {
    const waiting = await storeOf({ executions: [{ id: '7:m-ada', runId: '7:m-ada', member: 'ada', memberId: 'm-ada', startedAt: 1000, state: 'uncertain', waiting: 'reconcile', error: '等待对账：…' }] })
    renderRun(waiting, { runId: '7:m-ada', state: 'failed', error: '等待对账：…' })
    expect(screen.getByText('ada 待对账，这条消息还没发出')).toBeDefined()
    expect(screen.getByText(`· ${zh['run.waitingReconcileHint']}`)).toBeDefined()
    cleanup()
    // Reconciled: the delivery went out under the same run id, with its own (later) card.
    const moved = await storeOf({ executions: [{ id: '7:m-ada', runId: '7:m-ada', member: 'ada', memberId: 'm-ada', startedAt: 2000, state: 'running', executionId: 'exec-2' }] })
    renderRun(moved, { runId: '7:m-ada', state: 'failed', error: '等待对账：…' })
    expect(screen.queryByText(/待对账|运行失败/)).toBeNull()
  })

  it('a member-to-member line whose recipient waits for 待对账 says 待对账, not 排队中', async () => {
    const store = await storeOf({ deliveries: [{ ...row, id: '9:m-ada', dispatchSeq: 9, memberId: 'm-ada', status: 'queued', waiting: 'reconcile', origin: 'coordinator', text: '去做', queuedAt: 1 }] })
    render(<RoomDispatchView {...{ node: { data: { seq: 9, time: 1, kind: 'task', from: 'm-ada', targets: ['ada'], text: '去做' } }, sessionId: 'room-1' as SessionId, roomStore: store, t: zhT } as unknown as RoomDispatchViewProps} />)
    expect(screen.getByText('待对账')).toBeDefined()
    expect(screen.queryByText('排队中')).toBeNull()
  })
})
