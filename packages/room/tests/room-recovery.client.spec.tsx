// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RoomRecoveryView } from '../src/client/RoomRecoveryView.tsx'
import { en } from '../src/client/locales.ts'
import type { RoomDelivery } from '../src/types.ts'

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
