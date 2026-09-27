// @vitest-environment jsdom
/**
 * Badge spec for the display gate (per-session UI self-hide). Two criteria,
 * pinned here: a configured non-empty `visiblePresets` is the OVERRIDE (the
 * pilot semantics — list outside = hidden); otherwise the DEFAULT criterion
 * reads the OFFICIAL pluginInventory composition data and shows the badge
 * exactly when the session's preset composition names the
 * `@khorsheed/dsh-worktrees/tool` row. Sessions with no preset, a missing
 * namespace, a failed RPC, and a missing/broken preset group all fail open
 * (visible). The badge reads the current session's preset through
 * `useSessions` (the ui-agent-preset header-label read, dual key per host
 * line); the config arrives over the Remote (`fetchBadgeConfig`) because the
 * web boot hands client entries no config.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WorktreesBadgeProps } from '../src/client/contract.ts'
import { WorktreesBadge } from '../src/client/Badge.tsx'
import type { BadgeConfig, PluginInventorySnapshot, SessionSummary } from '../src/types.ts'

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
  /**
   * The OFFICIAL inventory snapshot as the probed namespace answers it;
   * absent = the host mounts no pluginInventory namespace (fail-open path).
   */
  composition?: PluginInventorySnapshot
  /** Make the inventory RPC fail outright (still the fail-open path). */
  compositionFails?: boolean
}

function makeHarness(over: HarnessOptions = {}) {
  const summary = vi.fn<() => Promise<Result<SessionSummary>>>()
  const fetchBadgeConfig = vi.fn<() => Promise<Result<BadgeConfig>>>()
  const fetchComposition = vi.fn<() => Promise<Result<PluginInventorySnapshot>>>()
  summary.mockResolvedValue({ ok: true as const, value: SUMMARY })
  fetchBadgeConfig.mockResolvedValue({
    ok: true as const,
    value: { visiblePresets: over.visiblePresets ?? [] },
  })
  if (over.compositionFails === true) {
    fetchComposition.mockResolvedValue({ ok: false as const, error: { code: 'x', message: 'unavailable' } })
  } else {
    fetchComposition.mockResolvedValue({
      ok: true as const,
      value: over.composition ?? { agentPresets: [] },
    })
  }
  // The Host's forwarded session events reach the badge through this face.
  const sessionListeners = new Set<(id: string) => void>()
  const sessionRow = {
    ...(over.projectionValues === undefined ? {} : { projectionValues: over.projectionValues }),
    ...(over.legacyAgentPreset === undefined ? {} : { agentPreset: over.legacyAgentPreset }),
  }
  const props = {
    sessionId: SESSION,
    summary,
    fetchBadgeConfig,
    // The client wiring leaves the prop undefined on a namespace-less host;
    // the harness mirrors that (only the presence cases pass a fetcher).
    ...(over.composition === undefined && over.compositionFails !== true
      ? {}
      : { fetchComposition }),
    open: vi.fn(),
    subscribeVersion: vi.fn(() => () => {}),
    subscribeSessionEvents: (listener: (id: string) => void) => {
      sessionListeners.add(listener)
      return () => { sessionListeners.delete(listener) }
    },
    useSessions: ((sel: (s: { byId: Record<string, unknown> }) => unknown) => sel({
      byId: { [SESSION]: sessionRow },
    })) as never,
    t: (key: string, params?: Record<string, unknown>) => (
      params === undefined ? key : `${key} ${JSON.stringify(params)}`
    ),
  } as unknown as WorktreesBadgeProps
  const emitSession = (id: string): void => { for (const listener of sessionListeners) listener(id) }
  return { props, summary, fetchBadgeConfig, fetchComposition, emitSession }
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

describe('WorktreesBadge composition criterion (the default, no visiblePresets)', () => {
  const WITH_ROW: PluginInventorySnapshot = {
    agentPresets: [
      { id: 'dev', rows: [{ moduleName: '@khorsheed/dsh-worktrees/tool' }] },
      { id: 'standard', rows: [{ moduleName: '@deepseek-ai/dsh-tool-bash' }] },
    ],
  }

  it('shows the badge when the session preset composition names the tool row', async () => {
    const { props } = makeHarness({ projectionValues: { agentPreset: 'dev' }, composition: WITH_ROW })
    render(<WorktreesBadge {...props} />)
    expect(await screen.findByRole('status')).toBeTruthy()
  })

  it('hides the badge when the session preset composition does not name the tool row', async () => {
    const { props } = makeHarness({ projectionValues: { agentPreset: 'standard' }, composition: WITH_ROW })
    render(<WorktreesBadge {...props} />)
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('fails open when the host answers no inventory (no namespace)', async () => {
    const { props } = makeHarness({ projectionValues: { agentPreset: 'standard' } })
    render(<WorktreesBadge {...props} />)
    expect(await screen.findByRole('status')).toBeTruthy()
  })

  it('fails open when the inventory RPC fails', async () => {
    const { props } = makeHarness({ projectionValues: { agentPreset: 'standard' }, compositionFails: true })
    render(<WorktreesBadge {...props} />)
    expect(await screen.findByRole('status')).toBeTruthy()
  })

  it('fails open when the session preset group is broken or absent from the snapshot', async () => {
    const broken: PluginInventorySnapshot = {
      agentPresets: [{ id: 'standard', broken: 'unreadable', rows: [] }],
    }
    const { props } = makeHarness({ projectionValues: { agentPreset: 'standard' }, composition: broken })
    render(<WorktreesBadge {...props} />)
    expect(await screen.findByRole('status')).toBeTruthy()
  })

  it('lets a configured visiblePresets override the composition criterion', async () => {
    // The list admits 'standard' even though the composition names no row —
    // the override wins over the default criterion (pilot back-compat).
    const { props } = makeHarness({
      visiblePresets: ['standard'],
      projectionValues: { agentPreset: 'standard' },
      composition: WITH_ROW,
    })
    render(<WorktreesBadge {...props} />)
    expect(await screen.findByRole('status')).toBeTruthy()
  })
})

describe('WorktreesBadge invalidation channels', () => {
  it('re-reads the summary when a forwarded session event names this session', async () => {
    const { props, summary, emitSession } = makeHarness({ projectionValues: { agentPreset: 'dev' } })
    render(<WorktreesBadge {...props} />)
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(1))
    emitSession(SESSION)
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(2))
  })

  it('ignores a forwarded event for another session', async () => {
    const { props, summary, emitSession } = makeHarness({ projectionValues: { agentPreset: 'dev' } })
    render(<WorktreesBadge {...props} />)
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(1))
    emitSession('some-other-session')
    // Give the (absent) refetch a chance to land before asserting it did not.
    await new Promise(resolve => { setTimeout(resolve, 10) })
    expect(summary).toHaveBeenCalledTimes(1)
  })

  it('re-reads when the window regains focus (out-of-band changes)', async () => {
    const { props, summary } = makeHarness({ projectionValues: { agentPreset: 'dev' } })
    render(<WorktreesBadge {...props} />)
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(1))
    fireEvent.focus(window)
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(2))
  })
})
