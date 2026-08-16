// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { JobView } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { JobDrawer, type HistoryPage } from '../src/client/JobDrawer.tsx'
import { createDrawerStore } from '../src/client/drawer-store.ts'
import type { TrajectoryEntry } from '../src/types.ts'
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
      event: {
        type: 'tool/call',
        seq: 1,
        time: 1_000,
        data: { callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'pnpm build', run_in_background: true }) },
      },
    }, {
      event: {
        type: 'tool/result',
        seq: 2,
        time: 1_000,
        data: {
          message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'job started: bash-1' }] }] },
        },
      },
    }, {
      event: {
        type: 'tool/call',
        seq: 3,
        time: 2_000,
        data: { callId: 'c2', name: 'job_output', arguments: JSON.stringify({ job_id: 'bash-1' }) },
      },
    }, {
      event: {
        type: 'tool/result',
        seq: 4,
        time: 2_000,
        data: {
          message: { content: [{ type: 'tool-result', toolCallId: 'c2', content: [{ type: 'text', text: 'compiling...\n[status: running]' }] }] },
        },
      },
    }] as HistoryPage['events'],
  }
}

function drawerProps(overrides: Partial<Parameters<typeof JobDrawer>[0]> = {}) {
  const store = createDrawerStore()
  store.actions.openJob(SESSION, 'bash-1')
  const empty = { jobsBySession: {}, subagentsByParent: {} }
  const base = {
    useSessions: (selector: (state: unknown) => unknown) => selector(empty),
    useStore: (selector: (state: unknown) => unknown) => selector(store.get()),
    loadHistory: vi.fn(async () => historyPage()),
    close: vi.fn(),
    t,
    actions: {},
  }
  return { ...base, ...overrides }
}

describe('JobDrawer', () => {
  it('renders nothing while closed', () => {
    const store = createDrawerStore()
    const { container } = render(<JobDrawer {...drawerProps({
      useStore: (selector) => selector(store.get()),
    })} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows metadata and folds the trail rows from history', async () => {
    const props = drawerProps({
      useSessions: (selector) => selector({ jobsBySession: { [SESSION]: [job()] } }),
    })
    render(<JobDrawer {...props} />)
    // Metadata rows render immediately.
    expect(screen.getByText('pnpm build')).toBeTruthy()
    expect(screen.getByText('bash')).toBeTruthy()
    // The trail folds from the stubbed history page.
    await waitFor(() => expect(screen.getByText(/bash-1 started/)).toBeTruthy())
    expect(screen.getByText(/job_output bash-1/)).toBeTruthy()
    expect(props.loadHistory).toHaveBeenCalledWith(SESSION, undefined, 200)
  })

  it('expands a trail row to show its full text', async () => {
    render(<JobDrawer {...drawerProps({
      useSessions: (selector) => selector({ jobsBySession: { [SESSION]: [job()] } }),
    })} />)
    await waitFor(() => expect(screen.getAllByText(/job_output bash-1/).length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText(/job_output bash-1/)[0] as Element)
    await waitFor(() => expect(screen.getByText(/compiling\.\.\./)).toBeTruthy())
  })

  it('closes through the injected close verb', () => {
    const close = vi.fn()
    render(<JobDrawer {...drawerProps({ close })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(close).toHaveBeenCalled()
  })

  it('renders an empty state when history carries no entries for the job', async () => {
    const props = drawerProps({
      loadHistory: vi.fn(async () => ({ hasMore: false, events: [] })),
    })
    render(<JobDrawer {...props} />)
    await waitFor(() => expect(screen.getByText(/No log entries/)).toBeTruthy())
  })
})

// Keep the TrajectoryEntry import referenced for type-level coverage.
export type { TrajectoryEntry }
