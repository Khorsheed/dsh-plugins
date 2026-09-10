// @vitest-environment jsdom
/**
 * Worktrees tab spec under the composed-props form: a real store instance
 * (createWorktreesStore().create()) and injected Remote mocks. Asserts the
 * mount → changes-fetch → file-select → diff-fetch chain that the browser
 * flow depends on, plus the 本会话改动 filter: the worktree mode lists the
 * git uncommitted files ∩ the session-touched set (the sibling file-preview
 * fold), with null touched set = no filter (the pre-filter behavior).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { WorktreesTabProps } from '../src/client/contract.ts'
import { WorktreesTab } from '../src/client/WorktreesTab.tsx'
import { createWorktreesStore } from '../src/client/store.ts'
import type { ChangesResult, FileDiffResult, ReadFileResult, SessionSummary } from '../src/types.ts'

/** Selector hook over the store engine instance (the test-sanctioned engine path). */
function hookOf(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => unknown }) {
  return function useSelector<S>(sel: (s: unknown) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

type Store = ReturnType<typeof createWorktreesStore>
type Instance = ReturnType<Store['create']>

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

const CHANGES: ChangesResult = {
  uncommitted: [
    { path: 'packages/room/src/index.ts', status: 'M', additions: 47, deletions: 0 },
  ],
  committed: [],
}

interface HarnessOptions {
  /** Navigation params the open carried (the badge's mode). */
  params?: { mode?: 'worktree' | 'commits' | 'repo' }
  /** Navigation revision (0 = a record nobody opened by address). */
  revision?: number
  /** The session-touched paths the fold answers; null = no filter. */
  touched?: readonly string[] | null
  /** Extra uncommitted files beyond the fixture's index.ts. */
  extraUncommitted?: ChangesResult['uncommitted'][number][]
}

function makeHarness(over: HarnessOptions = {}) {
  const instance = createWorktreesStore().create()
  const changes: ChangesResult = {
    uncommitted: [...CHANGES.uncommitted, ...(over.extraUncommitted ?? [])],
    committed: [],
  }
  const fetchSummary = vi.fn<() => Promise<Result<SessionSummary>>>()
  const fetchChanges = vi.fn<() => Promise<Result<ChangesResult>>>()
  const fetchSessionTouched = vi.fn<() => Promise<readonly string[] | null>>()
  const fetchRepoFiles = vi.fn<() => Promise<Result<string[]>>>()
  const fetchCommitLog = vi.fn<() => Promise<Result<never[]>>>()
  const fetchCommitFiles = vi.fn()
  const fetchFileDiff = vi.fn<() => Promise<Result<FileDiffResult>>>()
  const fetchReadFile = vi.fn<() => Promise<Result<ReadFileResult>>>()
  const openExternal = vi.fn()
  const copyBranch = vi.fn<() => Promise<boolean>>()

  fetchSummary.mockResolvedValue({ ok: true as const, value: SUMMARY })
  fetchChanges.mockResolvedValue({ ok: true as const, value: changes })
  fetchSessionTouched.mockResolvedValue(over.touched === undefined ? null : over.touched)
  fetchRepoFiles.mockResolvedValue({ ok: true as const, value: [] })
  fetchCommitLog.mockResolvedValue({ ok: true as const, value: [] })
  fetchCommitFiles.mockResolvedValue({ ok: true as const, value: { sha: 'x', files: [] } })
  fetchFileDiff.mockResolvedValue({ ok: true as const, value: { diff: 'diff --git a/x b/x\n+new\n' } })
  fetchReadFile.mockResolvedValue({ ok: true as const, value: { content: 'hello\n' } })

  const navigation = { address: 'sidebar://worktrees', params: over.params, revision: over.revision ?? 0 }
  // Stable identities: the body lists `tab.signal` in effect deps, so a fresh
  // object per render would re-fire every fetch effect in a loop.
  const tab = { id: 'tab-1', signal: new AbortController().signal, navigation }
  const props = {
    sessionId: SESSION,
    useTabInfo: () => ({ tab }),
    useStore: hookOf(instance),
    useSessions: ((sel: (s: { byId: Record<string, unknown> }) => unknown) => sel({
      byId: { [SESSION]: { cwd: '/repo' } },
    })) as never,
    actions: instance.actions,
    // No probed apps: the open-in-app gestures stay hidden.
    useOpenInApp: ((sel: (apps: readonly string[] | null) => unknown) => sel([])) as never,
    fetchSummary,
    fetchChanges,
    fetchSessionTouched,
    fetchRepoFiles,
    fetchCommitLog,
    fetchCommitFiles,
    fetchWorktrees: vi.fn(),
    switchWorktree: vi.fn(),
    directAgent: vi.fn(),
    bumpVersion: vi.fn(),
    fetchFileDiff,
    fetchReadFile,
    fetchReadFileAtCommit: vi.fn(),
    fetchReadRepoImage: vi.fn(),
    openExternal,
    copyBranch,
    t: (key: string, params?: Record<string, unknown>) => (
      params === undefined ? key : `${key} ${JSON.stringify(params)}`
    ),
  } as unknown as WorktreesTabProps

  return { instance, props, fetchFileDiff, fetchReadFile, fetchChanges, fetchCommitLog }
}

/** Expand the tree down to the committed fixture file and click it. */
async function drillToIndexTs(region: () => ReturnType<typeof within>): Promise<void> {
  for (const dir of ['packages', 'room', 'src']) {
    const dirRow = await region().findByRole('button', { name: dir })
    fireEvent.click(dirRow)
  }
}

afterEach(() => { cleanup() })

describe('WorktreesTab', () => {
  it('fetches changes on mount and drives fileDiff on select + diff view (no touched set = no filter)', async () => {
    const { props, fetchFileDiff, fetchReadFile, fetchChanges } = makeHarness()
    render(<WorktreesTab {...props} />)

    await waitFor(() => expect(fetchChanges).toHaveBeenCalledWith(SESSION))
    await new Promise(r => setTimeout(r, 500))
    // The tree defaults to the first level — expand the directories down to
    // the uncommitted file, then click it. The tree rows are buttons whose
    // text lives in a child span; query the row by name.
    const region = () => within(screen.getByRole('region'))
    await drillToIndexTs(region)
    const row = await region().findByRole('button', { name: /index\.ts/ })
    fireEvent.click(row)
    // Selecting a file no longer folds the tree (manual collapse only) and the
    // detail defaults to the diff → fileDiff drives
    // with the uncommitted segment immediately.
    await waitFor(() => expect(fetchFileDiff).toHaveBeenCalledWith(
      SESSION,
      { path: 'packages/room/src/index.ts', segment: 'uncommitted' },
    ))

    // Switching to the content view drives readFile.
    const contentButton = await screen.findByText('detail.content')
    fireEvent.click(contentButton)
    await waitFor(() => expect(fetchReadFile).toHaveBeenCalledWith(SESSION, { path: 'packages/room/src/index.ts' }))
  })

  it('filters the worktree mode to session-touched files when the fold answers', async () => {
    const { props } = makeHarness({
      touched: ['packages/room/src/index.ts'],
      extraUncommitted: [{ path: 'other.ts', status: 'M', additions: 1, deletions: 0 }],
    })
    render(<WorktreesTab {...props} />)
    const region = () => within(screen.getByRole('region'))
    await drillToIndexTs(region)
    await region().findByRole('button', { name: /index\.ts/ })
    // The untouched file never enters the tree, at any expansion level.
    expect(region().queryByRole('button', { name: /other\.ts/ })).toBeNull()
  })

  it('shows the session-empty copy when the touched set intersects nothing', async () => {
    const { props } = makeHarness({ touched: [] })
    render(<WorktreesTab {...props} />)
    await screen.findByText('group.emptySession')
    expect(screen.queryByRole('button', { name: /index\.ts/ })).toBeNull()
  })

  it('applies the navigation params mode on arrival', async () => {
    const { instance, props, fetchCommitLog } = makeHarness({ params: { mode: 'commits' }, revision: 1 })
    render(<WorktreesTab {...props} />)
    await waitFor(() => expect(instance.getSnapshot().mode).toBe('commits'))
    // The commits mode's data plane is the commit log.
    await waitFor(() => expect(fetchCommitLog).toHaveBeenCalledWith(SESSION))
  })
})
