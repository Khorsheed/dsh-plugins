// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RoomActivityDock } from '../src/client/RoomActivityDock.tsx'
import { descendantRows, executionRows } from '../src/client/executions.ts'
import { en } from '../src/client/locales.ts'
import type { RoomState } from '../src/types.ts'

afterEach(cleanup)
const t = ((key: keyof typeof en, vars?: Record<string, unknown>) => en[key].replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? k))) as never
const state: RoomState = {
  members: [{ id: 'm', name: 'kimi', kind: 'cli', invitedBy: 'human', provider: 'kimi', childSessionId: 'child' as never }], tasks: [], relays: [],
  runs: [{ runId: '2:m', member: 'kimi', state: 'running', startedAt: 200 }],
  executions: [
    { id: '1:m', runId: '1:m', memberId: 'm', member: 'kimi', childSessionId: 'child' as never, state: 'done', startedAt: 100, elapsedMs: 70, tokens: 123, model: 'K3' },
    { id: '2:m', runId: '2:m', memberId: 'm', member: 'kimi', childSessionId: 'child' as never, state: 'running', startedAt: 200 },
  ],
  deliveries: [
    { id: '1:m', dispatchSeq: 1, memberId: 'm', status: 'done', origin: 'human', text: 'First task' },
    { id: '2:m', dispatchSeq: 2, memberId: 'm', status: 'running', origin: 'coordinator', text: 'Second task' },
  ],
}
const plan = { version: 1 as const, id: 'p', revision: 1, objective: 'Improve Room', status: 'running' as const, budget: { maxParallel: 2, maxAttempts: 12, maxAttemptsPerTask: 3, maxActiveMs: 1800000 }, activeMs: 0, stages: [], tasks: [] }

describe('Room execution capsules', () => {
  it('includes native descendants, skips unrelated sessions and avoids duplicating Room members', () => {
    const rows = descendantRows({
      child: { id: 'child', parentId: 'room', origin: 'subagent', running: true },
      native: { id: 'native', parentId: 'room', origin: 'subagent', displayTitle: 'Inspect API', running: true },
      nested: { id: 'nested', parentId: 'child', origin: 'subagent', displayTitle: 'Review patch' },
      unrelated: { id: 'unrelated', parentId: 'other', origin: 'subagent', running: true },
    }, 'room', state, 400)
    expect(rows.map(row => row.childSessionId).sort()).toEqual(['native', 'nested'])
    expect(rows[0]?.tokens).toBeUndefined()
    expect(rows.every(row => row.sessionTotal)).toBe(true)
  })
  it('keeps only the label and a green indicator when folded; history remains available after settlement', () => {
    const { rerender } = render(<RoomActivityDock state={state} t={t} />)
    const capsule = screen.getByRole('button', { name: 'Background agents' })
    expect(capsule.textContent).toBe('Background agents')
    expect(capsule.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByTestId('room-running-dot')).toBeDefined()
    expect(screen.queryByText('Second task')).toBeNull()
    rerender(<RoomActivityDock state={{ ...state, runs: [], executions: state.executions!.map(run => ({ ...run, state: 'done' })), deliveries: state.deliveries!.map(row => ({ ...row, status: 'done' })) }} t={t} />)
    expect(screen.queryByTestId('room-running-dot')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Background agents' }))
    expect(screen.getByText('First task')).toBeDefined()
  })

  it('opens the real child session and fences stop to the displayed execution', async () => {
    const openSession = vi.fn(); const stopExecution = vi.fn(async () => ({ ok: true as const }))
    render(<RoomActivityDock state={state} openSession={openSession} stopExecution={stopExecution} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Background agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'View conversation: First task' }))
    expect(openSession).toHaveBeenCalledWith('child')
    fireEvent.click(screen.getByRole('button', { name: 'Stop: Second task' }))
    await waitFor(() => expect(stopExecution).toHaveBeenCalledWith('kimi', expect.objectContaining({ runId: '2:m', startedAt: 200 })))
    expect(screen.queryByRole('button', { name: 'Stop: First task' })).toBeNull()
    expect(screen.getByText(/123 tok/)).toBeDefined()
  })

  it('keeps direct member follow-ups visible after Room deliveries settle, without surfacing the coordinator', () => {
    const settled: RoomState = { ...state, executions: state.executions!.map(run => ({ ...run, state: 'done' })), deliveries: state.deliveries!.map(delivery => ({ ...delivery, status: 'done' })) }
    const sessions = { child: { id: 'child', parentId: 'room', origin: 'subagent', running: false } }
    expect(descendantRows(sessions, 'room', settled, 500)).toHaveLength(0)
    expect(descendantRows(sessions, 'room', settled, 500, ['child'])).toMatchObject([{ id: 'session:child', status: 'running', sessionTotal: true }])
    expect(descendantRows(sessions, 'room', { ...settled, coordinator: { version: 1, memberId: 'm', previousMemberId: 'main', revision: 1, handoff: '' } }, 500, ['child'])).toHaveLength(0)
  })

  it('opens only one panel and dismisses on outside click or Escape', () => {
    render(<RoomActivityDock state={{ ...state, plan }} openPlan={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Background agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Current plan 0/0' }))
    expect(screen.queryByText('First task')).toBeNull()
    expect(screen.getByText('Improve Room')).toBeDefined()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Improve Room')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Background agents' }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByText('First task')).toBeNull()
  })

  it('keeps normal chat free of the empty goal form and opens full details only on request', () => {
    const openPlan = vi.fn()
    const { rerender } = render(<RoomActivityDock state={state} t={t} />)
    expect(screen.queryByText('Goal')).toBeNull()
    rerender(<RoomActivityDock state={{ ...state, plan }} openPlan={openPlan} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Current plan 0/0' }))
    expect(openPlan).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Plan details and limits' }))
    expect(openPlan).toHaveBeenCalledOnce()
  })

  it('does not merge rounds or mistake completion for acceptance; uncertain runs cannot be stopped', () => {
    const rows = executionRows({ ...state, deliveries: state.deliveries!.map(row => ({ ...row, status: 'uncertain' })) })
    expect(rows).toHaveLength(2)
    expect(rows.every(row => row.status === 'uncertain')).toBe(true)
    expect(rows.find(row => row.id === '2:m')?.tokens).toBeUndefined()
    expect(executionRows(state).find(row => row.id === '1:m')?.status).toBe('done')
  })
})
