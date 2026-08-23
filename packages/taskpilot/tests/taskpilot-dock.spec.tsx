// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { JobView } from '@deepseek-ai/dsh-client-runtime/client'
import { TaskPilotDock } from '../src/client/TaskPilotDock.tsx'
import { t } from './helpers.ts'

const SESSION = 's1' as unknown as import('@deepseek-ai/dsh-api-remotes/client').SessionId

function job(overrides: Partial<JobView> = {}): JobView {
  return {
    id: 'bash-1' as JobView['id'],
    kind: 'bash',
    label: 'pnpm build',
    status: 'running',
    startedAt: 1_000,
    ...overrides,
  }
}

function dockProps(overrides: Partial<Parameters<typeof TaskPilotDock>[0]> = {}) {
  const empty = { jobsBySession: {}, subagentsByParent: {}, byId: {} }
  const base = {
    sessionId: SESSION,
    useSessions: (selector: (state: unknown) => unknown) => selector(empty),
    t,
    stopJob: vi.fn(async () => undefined),
    interruptSubagent: vi.fn(async () => undefined),
    openJob: vi.fn(),
    openSubagent: vi.fn(),
    pollActiveDelegations: vi.fn(async () => []),
  }
  return { ...base, ...overrides }
}


function subSummary(id: string, parentId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    origin: 'subagent' as const,
    parentId,
    displayTitle: id,
    running: false,
    ...overrides,
  }
}

/**
 * Settle the dock's immediate delegation-poll tick inside act. The first tick
 * fires from the mount effect; its promise resolves in a microtask after the
 * sync `render`/`fireEvent` act scopes, so tests with subagent rows flush it
 * explicitly to keep React's act warnings quiet.
 */
async function flushPoll(): Promise<void> {
  await act(async () => {})
}

describe('TaskPilotDock', () => {
  it('renders nothing when the session has no jobs or subagent lineage', () => {
    const { container } = render(<TaskPilotDock {...dockProps()} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows a jobs capsule with the job count; rows appear only after clicking it', () => {
    const jobs = [job()]
    const props = dockProps({
      useSessions: (selector) => selector({ jobsBySession: { [SESSION]: jobs }, subagentsByParent: {} }),
    })
    render(<TaskPilotDock {...props} />)
    // Capsule visible, row hidden until expanded.
    expect(screen.getByRole('button', { name: /Background jobs/ })).toBeTruthy()
    expect(screen.queryByText('pnpm build')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Background jobs/ }))
    expect(screen.getByText('pnpm build')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop job bash-1' })).toBeTruthy()
  })

  it('lists settled jobs without a stop verb', () => {
    const settled = job({ status: 'completed', finishedAt: 2_000 })
    render(<TaskPilotDock {...dockProps({
      useSessions: (selector) => selector({ jobsBySession: { [SESSION]: [settled] }, subagentsByParent: {} }),
    })} />)
    fireEvent.click(screen.getByRole('button', { name: /Background jobs/ }))
    expect(screen.getByText('pnpm build')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop job bash-1' })).toBeNull()
  })

  it('calls stopJob with the job id when Stop is clicked inside the popover', () => {
    const stopJob = vi.fn(async () => undefined)
    render(<TaskPilotDock {...dockProps({
      stopJob,
      useSessions: (selector) => selector({ jobsBySession: { [SESSION]: [job()] }, subagentsByParent: {} }),
    })} />)
    fireEvent.click(screen.getByRole('button', { name: /Background jobs/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop job bash-1' }))
    expect(stopJob).toHaveBeenCalledWith('bash-1')
  })

  it('opens the drawer when a job row is clicked', () => {
    const openJob = vi.fn()
    render(<TaskPilotDock {...dockProps({
      openJob,
      useSessions: (selector) => selector({ jobsBySession: { [SESSION]: [job()] }, subagentsByParent: {} }),
    })} />)
    fireEvent.click(screen.getByRole('button', { name: /Background jobs/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Open details for job bash-1' }))
    expect(openJob).toHaveBeenCalledWith('bash-1')
  })

  it('lists running subagents with an interrupt verb and the direct-parent id', async () => {
    const interruptSubagent = vi.fn(async () => undefined)
    const byId = {
      'child-2': subSummary('child-2', SESSION, { displayTitle: 'analysis', running: true }),
    }
    render(<TaskPilotDock {...dockProps({
      interruptSubagent,
      useSessions: (selector) => selector({ jobsBySession: {}, byId }),
    })} />)
    await flushPoll()
    fireEvent.click(screen.getByRole('button', { name: /Subagents/ }))
    expect(screen.getByText('analysis')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt subagent child-2' }))
    expect(interruptSubagent).toHaveBeenCalledWith('child-2', SESSION)
  })

  it('flattens the whole descendant lineage with duration, tokens and per-parent interrupt', async () => {
    const interruptSubagent = vi.fn(async () => undefined)
    const openSession = vi.fn()
    const byId = {
      'child-1': subSummary('child-1', SESSION, {
        displayTitle: '分析代码', running: true,
        projectionValues: { tokenUsage: { uncachedInputTokens: 1200, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 }, subagentTiming: { settledMs: 60_000, active: { since: 1_000_000, through: 1_001_000 } } },
      }),
      'child-2': subSummary('child-2', SESSION, {
        displayTitle: '写文档',
        projectionValues: { tokenUsage: { uncachedInputTokens: 50_000, outputTokens: 10_000, cacheReadTokens: 0, cacheWriteTokens: 0 }, subagentTiming: { settledMs: 30_000 } },
      }),
      // Deep descendant: child-3 belongs to child-1, not to the session.
      'child-3': subSummary('child-3', 'child-1', { displayTitle: '跑测试', running: true }),
    }
    render(<TaskPilotDock {...dockProps({
      interruptSubagent,
      openSession,
      useSessions: (selector) => selector({ jobsBySession: {}, byId }),
    })} />)
    await flushPoll()
    fireEvent.click(screen.getByRole('button', { name: /Subagents/ }))
    // The capsule count covers the whole lineage (3), like the header tree.
        expect(screen.getByRole('button', { name: /Subagents3/ })).toBeTruthy()
    expect(screen.getByText('分析代码')).toBeTruthy()
    expect(screen.getByText('写文档')).toBeTruthy()
    expect(screen.getByText('跑测试')).toBeTruthy()
    // Duration and token columns render from the summaries (1.5K tokens for child-1).
    expect(screen.getByText('1.5K')).toBeTruthy()
    expect(screen.getByText('60K')).toBeTruthy()
    // Two running rows carry interrupt verbs; the inactive one does not.
    expect(screen.getAllByRole('button', { name: /Interrupt subagent/ })).toHaveLength(2)
    // The deep descendant passes its direct parent (child-1), not the session.
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt subagent child-3' }))
    expect(interruptSubagent).toHaveBeenCalledWith('child-3', 'child-1')
    // Rows open the session directly (works for any depth without an address mode).
    fireEvent.click(screen.getByRole('button', { name: 'Open subagent child-3' }))
    expect(openSession).toHaveBeenCalledWith('child-3')
  })

  it('prefers the catalog descriptor label for direct children over the lagging displayTitle', async () => {
    // displayTitle has not been projected yet (falls back to the workspace
    // basename), but the direct-child catalog carries the durable creation label.
    const byId = { 'child-1': subSummary('child-1', SESSION, { displayTitle: 'deepseek harness', running: true }) }
    const catalog = { entries: [{ kind: 'child', id: 'child-1', activity: 'running', hasChildren: false, mode: 'continuable', label: '分析代码' }], parentAvailable: true }
    render(<TaskPilotDock {...dockProps({
      useSessions: (selector) => selector({ jobsBySession: {}, byId, subagentsByParent: { [SESSION]: catalog } }),
    })} />)
    await flushPoll()
    fireEvent.click(screen.getByRole('button', { name: /Subagents/ }))
    expect(screen.getByText('分析代码')).toBeTruthy()
    expect(screen.queryByText('deepseek harness')).toBeNull()
  })

  it('shows only the subagent capsule when there are no jobs', async () => {
    const byId = { 'child-9': subSummary('child-9', SESSION, { displayTitle: 'sibling' }) }
    render(<TaskPilotDock {...dockProps({
      useSessions: (selector) => selector({ jobsBySession: {}, byId }),
    })} />)
    await flushPoll()
    // No jobs capsule at all; the subagent capsule renders with the lineage.
    expect(screen.queryByRole('button', { name: /Background jobs/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Subagents/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Subagents/ }))
    expect(screen.getByText('sibling')).toBeTruthy()
  })

  it('marks a one-shot row running while the delegation poll reports its id', async () => {
    // No live agent, so the official running flag stays false — the second
    // source (the local-agent delegation poll) is what renders the interrupt
    // verb for this local-agent family row.
    const poll = vi.fn(async () => ['one-shot-1'])
    const interruptSubagent = vi.fn(async () => undefined)
    const byId = { 'one-shot-1': subSummary('one-shot-1', SESSION, { displayTitle: 'kimi run' }) }
    render(<TaskPilotDock {...dockProps({
      pollActiveDelegations: poll,
      interruptSubagent,
      useSessions: (selector) => selector({ jobsBySession: {}, byId }),
    })} />)
    fireEvent.click(screen.getByRole('button', { name: /Subagents/ }))
    // The immediate first tick reports the delegation; the row turns running.
    expect(await screen.findByRole('button', { name: 'Interrupt subagent one-shot-1' })).toBeTruthy()
    expect(poll).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt subagent one-shot-1' }))
    expect(interruptSubagent).toHaveBeenCalledWith('one-shot-1', SESSION)
  })

  it('keeps the single-source behavior when the poll reports no delegations', async () => {
    const poll = vi.fn(async () => [])
    const byId = { 'one-shot-2': subSummary('one-shot-2', SESSION, { displayTitle: 'settled run' }) }
    render(<TaskPilotDock {...dockProps({
      pollActiveDelegations: poll,
      useSessions: (selector) => selector({ jobsBySession: {}, byId }),
    })} />)
    await flushPoll()
    fireEvent.click(screen.getByRole('button', { name: /Subagents/ }))
    expect(screen.getByText('settled run')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Interrupt subagent one-shot-2' })).toBeNull()
  })

  it('drops the running state once the delegation leaves the active set', async () => {
    vi.useFakeTimers()
    try {
      const poll = vi.fn()
        .mockResolvedValueOnce(['one-shot-3'])
        .mockResolvedValue([])
      const byId = { 'one-shot-3': subSummary('one-shot-3', SESSION, { displayTitle: 'finishing run' }) }
      render(<TaskPilotDock {...dockProps({
        pollActiveDelegations: poll,
        useSessions: (selector) => selector({ jobsBySession: {}, byId }),
      })} />)
      fireEvent.click(screen.getByRole('button', { name: /Subagents/ }))
      // Immediate first tick: the delegation is active, the row is running.
      await act(async () => {})
      expect(screen.getByRole('button', { name: 'Interrupt subagent one-shot-3' })).toBeTruthy()
      // Interval tick: the delegation ended; the row settles back.
      await act(async () => { vi.advanceTimersByTime(1_500) })
      expect(screen.queryByRole('button', { name: 'Interrupt subagent one-shot-3' })).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not poll the delegation channel when no subagent rows exist', () => {
    const poll = vi.fn(async () => [])
    render(<TaskPilotDock {...dockProps({ pollActiveDelegations: poll })} />)
    expect(poll).not.toHaveBeenCalled()
  })
})
