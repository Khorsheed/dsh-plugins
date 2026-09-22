// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RoomPlanView } from '../src/client/RoomPlanView.tsx'
import { en } from '../src/client/locales.ts'
import { admitPlanAttempt, changePlan, queuePlanAttempt, recoverPlan, settlePlanAttempt } from '../src/plan.ts'
import type { RoomPlan } from '../src/plan.ts'

afterEach(cleanup)
const t = ((key: keyof typeof en, vars?: Record<string, unknown>) => en[key].replace(/\{(\w+)\}/g, (_match, key: string) => String(vars?.[key] ?? key))) as never
const members = [{ id: 'worker', name: 'Worker', kind: 'cli' as const, provider: 'kimi', invitedBy: 'human' as const, childSessionId: 'child' as never }]
function plan(): RoomPlan {
  const context = { actor: { kind: 'human' as const, memberId: 'human' }, memberIds: new Set(['worker']), now: 0 }
  const created = changePlan(undefined, { action: 'create', requestId: 'create', expectedRevision: 0, id: 'goal', objective: 'Test goal', mode: 'execute', budget: { maxParallel: 2, maxAttempts: 5, maxAttemptsPerTask: 3, maxActiveMs: 60000 } }, context)
  const extended = changePlan(created, { action: 'extend', requestId: 'extend', expectedRevision: 1, stages: [{ id: 'stage', title: 'Implementation' }], tasks: [{ id: 'a', title: 'Task A', stageId: 'stage', kind: 'task', ownerMemberId: 'worker', instruction: 'Produce an output', criteria: ['Verify the output'], inputRefs: [], artifactPaths: ['result.txt'], dependsOn: [] }] }, context)
  return admitPlanAttempt(queuePlanAttempt(extended, 'a', 'try-a', 'delivery:a', 1), 'a', 'try-a', 2)
}
function submitted(): RoomPlan {
  return settlePlanAttempt(plan(), 'a', 'try-a', { state: 'done', evidence: { summary: 'Produced output', references: ['session:child'], artifacts: ['result.txt'] } }, 3)
}
function openPlan(): void { fireEvent.click(screen.getByTestId('room-plan').querySelector('summary')!) }
function openTask(): void { fireEvent.click(screen.getByText(/Task A ·/)) }
function fillEvidence(): void {
  fireEvent.change(screen.getByLabelText('Decision or reason'), { target: { value: 'Checked every criterion' } })
  fireEvent.change(screen.getByLabelText('Evidence references (one per line)'), { target: { value: 'review:test-pass' } })
}

describe('formal goal controls', () => {
  it('fences the human pause to the displayed goal identity', async () => {
    const command = vi.fn(async (_json: string) => ({ ok: true as const }))
    render(<RoomPlanView plan={plan()} members={members} command={command} t={t} />)
    openPlan()
    fireEvent.click(screen.getByRole('button', { name: 'Pause automatic progress' }))
    await waitFor(() => expect(command).toHaveBeenCalledOnce())
    expect(JSON.parse(command.mock.calls[0]![0])).toMatchObject({ action: 'pause', goalId: 'goal', expectedRevision: plan().revision })
  })

  it('offers an optional draft and never starts work just by opening the panel', async () => {
    const command = vi.fn(async (_json: string) => ({ ok: true as const }))
    render(<RoomPlanView members={members} command={command} t={t} />)
    openPlan()
    expect(command).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'Explore a design' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(command).toHaveBeenCalledOnce())
    expect(JSON.parse(command.mock.calls[0]![0] as unknown as string)).toMatchObject({ action: 'create', mode: 'draft', objective: 'Explore a design', expectedRevision: 0 })
  })

  it('requires review evidence and waits for durable state before changing accepted counts', async () => {
    const command = vi.fn(async (_json: string) => ({ ok: true as const }))
    render(<RoomPlanView plan={submitted()} members={members} command={command} t={t} />)
    openPlan(); openTask()
    expect(screen.getByText(/Accepted 0 \/ current plan 1/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Review / rework' }))
    expect((screen.getByRole('button', { name: 'Accept result' }) as HTMLButtonElement).disabled).toBe(true)
    fillEvidence()
    fireEvent.click(screen.getByRole('button', { name: 'Accept result' }))
    await waitFor(() => expect(command).toHaveBeenCalledOnce())
    expect(JSON.parse(command.mock.calls[0]![0])).toMatchObject({ action: 'review', taskId: 'a', attemptId: 'try-a', decision: 'accepted', references: ['review:test-pass'] })
    expect(screen.getByText(/Accepted 0 \/ current plan 1/)).toBeDefined()
  })

  it('keeps member navigation and targeted Stop available during a formal execution', () => {
    const openSession = vi.fn(); const stopMember = vi.fn()
    render(<RoomPlanView plan={plan()} members={members} command={vi.fn()} openSession={openSession} stopMember={stopMember} t={t} />)
    openPlan(); openTask()
    expect(screen.queryByRole('button', { name: 'Review / rework' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open member session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }))
    expect(openSession).toHaveBeenCalledWith('child')
    expect(stopMember).toHaveBeenCalledWith('Worker')
  })

  it('records an uncertain outcome with evidence without silently resuming the goal', async () => {
    const command = vi.fn(async (_json: string) => ({ ok: true as const }))
    render(<RoomPlanView plan={recoverPlan(plan(), 5)} members={members} command={command} t={t} />)
    openPlan(); openTask()
    fireEvent.click(screen.getByRole('button', { name: 'Reconcile' }))
    fillEvidence()
    fireEvent.click(screen.getByRole('button', { name: 'Reconcile as submitted' }))
    await waitFor(() => expect(command).toHaveBeenCalledOnce())
    expect(JSON.parse(command.mock.calls[0]![0])).toMatchObject({ action: 'reconcile', outcome: 'submitted', evidence: { references: ['review:test-pass'] } })
  })

  it('preserves a retry identity after a lost acknowledgement', async () => {
    const command = vi.fn(async (_json: string) => ({ ok: true as const })).mockRejectedValueOnce(new Error('connection lost'))
    render(<RoomPlanView plan={submitted()} members={members} command={command} t={t} />)
    openPlan(); openTask()
    fireEvent.click(screen.getByRole('button', { name: 'Review / rework' }))
    fillEvidence()
    fireEvent.click(screen.getByRole('button', { name: 'Accept result' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Accept result' }))
    await waitFor(() => expect(command).toHaveBeenCalledTimes(2))
    expect(command.mock.calls[1]![0]).toBe(command.mock.calls[0]![0])
  })

  it('counts accepted leaf tasks, excluding groups, cancellations and repeated attempts', () => {
    const current = submitted()
    const task = current.tasks[0]!
    task.status = 'accepted'; task.attempts[0]!.status = 'accepted'
    task.attempts.unshift({ ...task.attempts[0]!, id: 'old', status: 'rejected', number: 0 })
    current.tasks.push({ ...task, id: 'group', kind: 'group', attempts: [] }, { ...task, id: 'cancelled', status: 'cancelled', attempts: [] })
    render(<RoomPlanView plan={current} members={members} command={vi.fn()} t={t} />)
    expect(screen.getByText(/Accepted 1 \/ current plan 1/)).toBeDefined()
  })
})
