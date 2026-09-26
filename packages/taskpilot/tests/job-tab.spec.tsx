// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { JobView } from '@deepseek-ai/dsh-jobs/view'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { JobTab, type HistoryPage } from '../src/client/JobTab.tsx'
import { taskpilotDefinition, TASKPILOT_KIND, TASKPILOT_TAB_ID } from '../src/client/definition.ts'
import { t } from './helpers.ts'

const SESSION = 's1' as SessionId

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

/** A history page carrying one job_output read for bash-1. */
function historyPage(): HistoryPage {
  return {
    hasMore: false,
    events: [{
      type: 'tool/call',
      seq: 1,
      time: 1_000,
      data: { callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'pnpm build', run_in_background: true }) },
    }, {
      type: 'tool/result',
      seq: 2,
      time: 1_000,
      data: {
        message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'job started: bash-1' }] }] },
      },
    }, {
      type: 'tool/call',
      seq: 3,
      time: 2_000,
      data: { callId: 'c2', name: 'job_output', arguments: JSON.stringify({ job_id: 'bash-1' }) },
    }, {
      type: 'tool/result',
      seq: 4,
      time: 2_000,
      data: {
        message: { content: [{ type: 'tool-result', toolCallId: 'c2', content: [{ type: 'text', text: 'compiling...\n[status: running]' }] }] },
      },
    }] as HistoryPage['events'],
  }
}

/** A useTabInfo stub: one page tab navigated to the given job. */
function useTabInfo(jobId: string | undefined, revision = 1) {
  return () => ({
    sidebar: { expanded: true, fullscreen: false },
    panel: { id: 'pane-1' },
    tab: {
      id: 'tab-1',
      kind: TASKPILOT_KIND,
      contentId: `sidebar://${TASKPILOT_KIND}`,
      title: 'Job details',
      visible: true,
      navigation: {
        address: `sidebar://${TASKPILOT_KIND}`,
        params: jobId === undefined ? undefined : { jobId },
        revision,
      },
      signal: new AbortController().signal,
      actions: { openResource: () => {}, openTab: () => {}, close: () => {} },
    },
  })
}

function tabProps(overrides: Record<string, unknown> = {}) {
  const empty = { jobsBySession: {}, subagentsByParent: {} }
  return {
    sessionId: SESSION,
    useSessions: (selector: (state: unknown) => unknown) => selector(empty),
    // rc.1's jobs channel starts empty: every legacy-mirror stub below drives
    // through the 0.1.5 read it names.
    useJobs: (selector: (state: { rows: Record<string, never> }) => unknown) => selector({ rows: {} }),
    watchRows: () => () => {},
    useTabInfo: useTabInfo('bash-1'),
    loadHistory: vi.fn(async () => historyPage()),
    t,
    ...overrides,
  }
}

describe('taskpilotDefinition', () => {
  it('registers as a page type: no address patterns, extension band by default', () => {
    const definition = taskpilotDefinition(t as never)
    expect(definition.id).toBe(TASKPILOT_TAB_ID)
    expect(definition.kind).toBe(TASKPILOT_KIND)
    expect(definition.patterns).toBeUndefined()
    expect(definition.priority).toBeUndefined()
    expect(definition.guide).toBeUndefined()
    expect(definition.title('sidebar://taskpilot')).toBe('Job details')
  })
})

describe('JobTab', () => {
  it('shows metadata and folds the trail rows from history', async () => {
    const props = tabProps({
      useSessions: (selector: (state: unknown) => unknown) => selector({ jobsBySession: { [SESSION]: [job()] } }),
    })
    render(<JobTab {...props as never} />)
    // Metadata rows render immediately.
    expect(screen.getByText('pnpm build')).toBeTruthy()
    expect(screen.getByText('bash')).toBeTruthy()
    // The trail folds from the stubbed history page.
    await waitFor(() => expect(screen.getByText(/bash-1 started/)).toBeTruthy())
    expect(screen.getByText(/job_output bash-1/)).toBeTruthy()
    expect(props.loadHistory).toHaveBeenCalledWith(SESSION, undefined, 200)
  })

  it('follows re-navigation: new params reload the trail', async () => {
    const props = tabProps()
    const { rerender } = render(<JobTab {...props as never} />)
    await waitFor(() => expect(props.loadHistory).toHaveBeenCalledTimes(1))
    rerender(<JobTab {...{ ...props, useTabInfo: useTabInfo('bash-2', 2) } as never} />)
    await waitFor(() => expect(props.loadHistory).toHaveBeenCalledTimes(2))
  })

  it('expands a trail row to show its full text', async () => {
    render(<JobTab {...tabProps({
      useSessions: (selector: (state: unknown) => unknown) => selector({ jobsBySession: { [SESSION]: [job()] } }),
    }) as never} />)
    await waitFor(() => expect(screen.getAllByText(/job_output bash-1/).length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText(/job_output bash-1/)[0] as Element)
    await waitFor(() => expect(screen.getByText(/compiling\.\.\./)).toBeTruthy())
  })

  it('renders an empty state when history carries no entries for the job', async () => {
    render(<JobTab {...tabProps({ loadHistory: vi.fn(async () => ({ hasMore: false, events: [] })) }) as never} />)
    await waitFor(() => expect(screen.getByText(/No log entries/)).toBeTruthy())
  })

  it('renders the empty state without loading when the tab was never navigated to a job', () => {
    const props = tabProps({ useTabInfo: useTabInfo(undefined, 0) })
    render(<JobTab {...props as never} />)
    expect(screen.getByText(/No log entries/)).toBeTruthy()
    expect(props.loadHistory).not.toHaveBeenCalled()
  })

  it('ticks the duration while the job is live, instead of freezing at 0s', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-23T01:34:15Z'))
      const startedAt = Date.now() - 5_000
      render(<JobTab {...tabProps({
        useSessions: (selector: (state: unknown) => unknown) => selector({ jobsBySession: { [SESSION]: [job({ startedAt })] } }),
      }) as never} />)
      expect(metaValue('Duration')).toBe('5s')
      await act(async () => { vi.advanceTimersByTime(2_000) })
      expect(metaValue('Duration')).toBe('7s')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the exact span of a settled job', () => {
    render(<JobTab {...tabProps({
      useSessions: (selector: (state: unknown) => unknown) => selector({
        jobsBySession: { [SESSION]: [job({ status: 'completed', startedAt: 1_000, finishedAt: 131_000 })] },
      }),
    }) as never} />)
    expect(metaValue('Duration')).toBe('2m 10s')
  })

  it('reads the job from rc.1\'s jobs channel when the session-list mirror is absent', () => {
    render(<JobTab {...tabProps({
      useJobs: (selector: (state: { rows: Record<string, JobView[]> }) => unknown) => selector({
        rows: { [SESSION]: [job({ status: 'completed', startedAt: 1_000, finishedAt: 61_000 })] },
      }),
    }) as never} />)
    expect(screen.getByText('pnpm build')).toBeTruthy()
    expect(metaValue('Duration')).toBe('1m 0s')
  })

  it('renders — for the duration of a settled row that carries no finish time', () => {
    render(<JobTab {...tabProps({
      useSessions: (selector: (state: unknown) => unknown) => selector({
        jobsBySession: { [SESSION]: [job({ status: 'killed' })] },
      }),
    }) as never} />)
    expect(metaValue('Duration')).toBe('—')
  })
})

/** The value cell of one metadata row, read by its label. */
function metaValue(label: string): string {
  const row = screen.getByText(label).parentElement
  return row?.textContent?.slice(label.length) ?? ''
}
