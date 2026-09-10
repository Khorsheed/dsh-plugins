// @vitest-environment jsdom
/**
 * Badge spec for the `visiblePresets` display gate (pilot: per-session UI
 * self-hide). The gate arrives over the Remote (`fetchBadgeConfig`) because
 * the web boot hands client entries no config; the badge reads the current
 * session's preset through `useSessions` (the ui-agent-preset header-label
 * read). Semantics pinned here: an absent/empty list never gates (the
 * zero-change default), a non-empty list hides the badge when the session's
 * preset id is outside it, and a session with NO preset projection stays
 * visible (fail-open).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { WorktreesBadgeProps } from '../src/client/contract.ts'
import { WorktreesBadge } from '../src/client/Badge.tsx'
import type { BadgeConfig, SessionSummary } from '../src/types.ts'

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

const SESSION = 'sess-1'

const SUMMARY: SessionSummary = {
  isRepo: true,
  repo: '/repo',
  repoName: 'repo',
  branch: 'room',
  isMain: false,
  head: 'a1b2c3d',
  ahead: 2,
  behind: 0,
  dirty: 0,
  uncommitted: { additions: 0, deletions: 0 },
  committed: { additions: 10, deletions: 2 },
  baseRef: 'main',
}

interface HarnessOptions {
  /** The composition's gate as the Remote answers it ([] = no gate). */
  visiblePresets?: string[]
  /** The session's projectionValues row; absent = a session with no preset. */
  projectionValues?: { agentPreset?: unknown }
  /**
   * The 0.1.1 line's TOP-LEVEL list-row preset field (that line's client row
   * type predates the projection); absent = the 0.1.2 shape.
   */
  legacyAgentPreset?: unknown
}

function makeHarness(over: HarnessOptions = {}) {
  const summary = vi.fn<() => Promise<Result<SessionSummary>>>()
  const fetchBadgeConfig = vi.fn<() => Promise<Result<BadgeConfig>>>()
  summary.mockResolvedValue({ ok: true as const, value: SUMMARY })
  fetchBadgeConfig.mockResolvedValue({
    ok: true as const,
    value: { visiblePresets: over.visiblePresets ?? [] },
  })
  const sessionRow = {
    ...(over.projectionValues === undefined ? {} : { projectionValues: over.projectionValues }),
    ...(over.legacyAgentPreset === undefined ? {} : { agentPreset: over.legacyAgentPreset }),
  }
  const props = {
    sessionId: SESSION,
    summary,
    fetchBadgeConfig,
    open: vi.fn(),
    subscribeVersion: vi.fn(() => () => {}),
    getVersion: vi.fn(() => Promise.resolve(0)),
    useSessions: ((sel: (s: { byId: Record<string, unknown> }) => unknown) => sel({
      byId: { [SESSION]: sessionRow },
    })) as never,
    t: (key: string, params?: Record<string, unknown>) => (
      params === undefined ? key : `${key} ${JSON.stringify(params)}`
    ),
  } as unknown as WorktreesBadgeProps
  return { props, summary, fetchBadgeConfig }
}

afterEach(() => { cleanup() })

describe('WorktreesBadge visiblePresets gate', () => {
  it('shows the badge when the composition sets no gate (the zero-change default)', async () => {
    const { props } = makeHarness({ projectionValues: { agentPreset: 'dev' } })
    render(<WorktreesBadge {...props} />)
    expect(await screen.findByRole('status')).toBeTruthy()
  })

  it('shows the badge when the session preset is in the list', async () => {
    const { props } = makeHarness({ visiblePresets: ['dev', 'standard'], projectionValues: { agentPreset: 'dev' } })
    render(<WorktreesBadge {...props} />)
    expect(await screen.findByRole('status')).toBeTruthy()
  })

  it('hides the badge when the session preset is outside the list', async () => {
    const { props } = makeHarness({ visiblePresets: ['standard'], projectionValues: { agentPreset: 'dev' } })
    render(<WorktreesBadge {...props} />)
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('keeps the badge visible when the session has no preset projection (fail-open)', async () => {
    const { props } = makeHarness({ visiblePresets: ['standard'] })
    render(<WorktreesBadge {...props} />)
    expect(await screen.findByRole('status')).toBeTruthy()
  })

  it('hides the badge on the 0.1.1 top-level agentPreset key when the preset is outside the list', async () => {
    const { props } = makeHarness({ visiblePresets: ['standard'], legacyAgentPreset: 'dev' })
    render(<WorktreesBadge {...props} />)
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('shows the badge on the 0.1.1 top-level agentPreset key when the preset is in the list', async () => {
    const { props } = makeHarness({ visiblePresets: ['standard'], legacyAgentPreset: 'standard' })
    render(<WorktreesBadge {...props} />)
    expect(await screen.findByRole('status')).toBeTruthy()
  })

  it('renders nothing while the summary is still loading', () => {
    const { props, summary } = makeHarness({ projectionValues: { agentPreset: 'dev' } })
    summary.mockReturnValue(new Promise(() => {}))
    render(<WorktreesBadge {...props} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders nothing in a non-repo session (the workspace capsule left the header)', async () => {
    const { props, summary } = makeHarness({ projectionValues: { agentPreset: 'dev' } })
    summary.mockResolvedValue({
      ok: true as const,
      value: { ...SUMMARY, isRepo: false, repo: '', repoName: '', branch: null, head: '' },
    })
    render(<WorktreesBadge {...props} />)
    await waitFor(() => expect(summary).toHaveBeenCalled())
    expect(screen.queryByRole('status')).toBeNull()
  })
})
