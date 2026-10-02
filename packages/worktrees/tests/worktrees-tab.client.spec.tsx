// @vitest-environment jsdom
/**
 * Worktrees tab spec under the composed-props form: a real store instance
 * (createWorktreesStore().create()) and injected Remote mocks. Asserts the
 * mount → changes-fetch → file-select → diff-fetch chain that the browser
 * flow depends on, the navigation-params guard (a user mode switch must
 * stick), and that switching the worktree selector re-fetches so the
 * 工作树待提交 list follows the selected worktree.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { WorktreesTabProps } from '../src/client/contract.ts'
import { WorktreesTab } from '../src/client/WorktreesTab.tsx'
import { createWorktreesStore } from '../src/client/store.ts'
import type { ChangesResult, FileDiffResult, ReadFileResult, SessionSummary, WorktreeInfo } from '../src/types.ts'

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

const WORKTREES: WorktreeInfo[] = [
  { path: '/repo', branch: 'room', isMain: true, dirty: 1, stale: false },
  { path: '/repo-wt2', branch: 'wt2', isMain: false, dirty: 2, stale: false },
]

interface HarnessOptions {
  /** Navigation params the open carried (the badge's mode). */
  params?: { mode?: 'worktree' | 'commits' | 'repo' }
  /** Navigation revision (0 = a record nobody opened by address). */
  revision?: number
}

function makeHarness(over: HarnessOptions = {}) {
  const instance = createWorktreesStore().create()
  const fetchSummary = vi.fn<() => Promise<Result<SessionSummary>>>()
  const fetchChanges = vi.fn<() => Promise<Result<ChangesResult>>>()
  const fetchRepoFiles = vi.fn<() => Promise<Result<string[]>>>()
  const fetchCommitLog = vi.fn<() => Promise<Result<never[]>>>()
  const fetchCommitFiles = vi.fn()
  const fetchWorktrees = vi.fn<() => Promise<Result<WorktreeInfo[]>>>()
  const switchWorktree = vi.fn<() => Promise<Result<WorktreeInfo>>>()
  const fetchFileDiff = vi.fn<() => Promise<Result<FileDiffResult>>>()
  const fetchReadFile = vi.fn<() => Promise<Result<ReadFileResult>>>()
  const openExternal = vi.fn()
  const copyBranch = vi.fn<() => Promise<boolean>>()

  fetchSummary.mockResolvedValue({ ok: true as const, value: SUMMARY })
  fetchChanges.mockResolvedValue({ ok: true as const, value: CHANGES })
  fetchRepoFiles.mockResolvedValue({ ok: true as const, value: [] })
  fetchCommitLog.mockResolvedValue({ ok: true as const, value: [] })
  fetchCommitFiles.mockResolvedValue({ ok: true as const, value: { sha: 'x', files: [] } })
  fetchWorktrees.mockResolvedValue({ ok: true as const, value: WORKTREES })
  switchWorktree.mockResolvedValue({ ok: true as const, value: WORKTREES[1]! })
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
    actions: instance.actions,
    // No probed apps: the open-in-app gestures stay hidden.
    useOpenInApp: ((sel: (apps: readonly string[] | null) => unknown) => sel([])) as never,
    fetchSummary,
    fetchChanges,
    fetchRepoFiles,
    fetchCommitLog,
    fetchCommitFiles,
    fetchWorktrees,
    switchWorktree,
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

  return { instance, props, fetchFileDiff, fetchReadFile, fetchChanges, fetchCommitLog, switchWorktree }
}

/** Expand the tree down to the fixture file and click it. */
async function drillToIndexTs(region: () => ReturnType<typeof within>): Promise<void> {
  for (const dir of ['packages', 'room', 'src']) {
    const dirRow = await region().findByRole('button', { name: dir })
    fireEvent.click(dirRow)
  }
}

afterEach(() => { cleanup() })

describe('WorktreesTab', () => {
  it('fetches changes on mount and drives fileDiff on select + diff view', async () => {
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

  it('re-fetches after a worktree switch so the pending list follows the selected worktree', async () => {
    const { instance, props, fetchChanges, switchWorktree } = makeHarness()
    render(<WorktreesTab {...props} />)
    await waitFor(() => expect(fetchChanges).toHaveBeenCalledTimes(1))

    // Open the switcher and pick the second worktree.
    fireEvent.click(await screen.findByRole('button', { name: 'wt.pickWorktree' }))
    fireEvent.click(await screen.findByRole('option', { name: /wt2/ }))
    await waitFor(() => expect(switchWorktree).toHaveBeenCalledWith(SESSION, '/repo-wt2'))
    // The switch repoints the active worktree and refreshes the data planes.
    await waitFor(() => expect(fetchChanges).toHaveBeenCalledTimes(2))
    expect(instance.getSnapshot().activeWorktreePath).toBe('/repo-wt2')
    // The refresh ticks `rev`, whose effect pushes the invalidation to the
    // session-header badge — the capsule must not lag the pane.
    await waitFor(() => expect(props.bumpVersion).toHaveBeenCalled())
  })

  it('applies the navigation params mode on arrival', async () => {
    const { instance, props, fetchCommitLog } = makeHarness({ params: { mode: 'commits' }, revision: 1 })
    render(<WorktreesTab {...props} />)
    await waitFor(() => expect(instance.getSnapshot().mode).toBe('commits'))
    // The commits mode's data plane is the commit log.
    await waitFor(() => expect(fetchCommitLog).toHaveBeenCalledWith(SESSION))
  })

  it('keeps the user-switched mode instead of snapping back to the navigated one (5e5232d regression)', async () => {
    const { instance, props } = makeHarness({ params: { mode: 'worktree' }, revision: 1 })
    render(<WorktreesTab {...props} />)
    await waitFor(() => expect(instance.getSnapshot().mode).toBe('worktree'))
    // The user switches to 仓库提交记录; the navigation-params effect must NOT
    // re-fire on the local mode change and revert it.
    fireEvent.click(await screen.findByRole('button', { name: /mode\.commits/ }))
    await waitFor(() => expect(instance.getSnapshot().mode).toBe('commits'))
    await new Promise(r => setTimeout(r, 200))
    expect(instance.getSnapshot().mode).toBe('commits')
  })

  it('the pane reload gesture re-reads the active view (diff and content)', async () => {
    const { props, fetchFileDiff, fetchReadFile } = makeHarness()
    fetchReadFile
      .mockResolvedValueOnce({ ok: true as const, value: { content: 'v1\n' } })
      .mockResolvedValueOnce({ ok: true as const, value: { content: 'v2\n' } })
    render(<WorktreesTab {...props} />)
    const region = () => within(screen.getByRole('region'))
    await drillToIndexTs(region)
    fireEvent.click(await region().findByRole('button', { name: /index\.ts/ }))
    // The detail opens on the diff view; reload re-fetches the diff.
    await waitFor(() => expect(fetchFileDiff).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'action.reload' }))
    await waitFor(() => expect(fetchFileDiff).toHaveBeenCalledTimes(2))

    // The content view reloads through readFile and the fresh read renders.
    fireEvent.click(await screen.findByText('detail.content'))
    await waitFor(() => expect(fetchReadFile).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(document.body.textContent).toContain('v1'))
    fireEvent.click(screen.getByRole('button', { name: 'action.reload' }))
    await waitFor(() => expect(fetchReadFile).toHaveBeenCalledTimes(2))
    expect(fetchReadFile).toHaveBeenLastCalledWith(SESSION, { path: 'packages/room/src/index.ts' })
    await waitFor(() => expect(document.body.textContent).toContain('v2'))
  })

  it('a failed reload keeps the old content and recovers on the next one', async () => {
    const { instance, props, fetchReadFile } = makeHarness()
    fetchReadFile
      .mockResolvedValueOnce({ ok: true as const, value: { content: 'v1\n' } })
      .mockResolvedValueOnce({ ok: false as const, error: { code: 'io', message: 'disk gone' } })
      .mockResolvedValueOnce({ ok: true as const, value: { content: 'v2\n' } })
    render(<WorktreesTab {...props} />)
    const region = () => within(screen.getByRole('region'))
    await drillToIndexTs(region)
    fireEvent.click(await region().findByRole('button', { name: /index\.ts/ }))
    fireEvent.click(await screen.findByText('detail.content'))
    await waitFor(() => expect(fetchReadFile).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(document.body.textContent).toContain('v1'))

    fireEvent.click(screen.getByRole('button', { name: 'action.reload' }))
    await waitFor(() => expect(instance.getSnapshot().error).toBe('disk gone'))
    // The old read survives the failed reload in state.
    expect(instance.getSnapshot().content).toEqual({ content: 'v1\n' })

    fireEvent.click(screen.getByRole('button', { name: 'action.reload' }))
    await waitFor(() => expect(document.body.textContent).toContain('v2'))
    expect(instance.getSnapshot().error).toBeNull()
  })
})

it('opens a narrow detail and returns to the retained tree without clearing the diff', async () => {
  const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 390, height: 700, x: 0, y: 0, top: 0, left: 0, right: 390, bottom: 700, toJSON: () => ({}) })
  try {
    const { props, fetchFileDiff, instance } = makeHarness()
    const { container } = render(<WorktreesTab {...props}/>)
    const region = () => within(screen.getByRole('region'))
    await drillToIndexTs(region)
    const row = await region().findByRole('button', { name: /index\.ts/ })
    fireEvent.click(row)
    await waitFor(() => expect(fetchFileDiff).toHaveBeenCalledOnce())
    const split = container.querySelector('[data-adaptive-split]')!
    expect(split.getAttribute('data-adaptive-split')).toBe('narrow')
    expect((split.children[0] as HTMLElement).hidden).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'tree.expand' }))
    expect((split.children[0] as HTMLElement).hidden).toBe(false)
    expect(instance.getSnapshot().selectedPath).toBe('packages/room/src/index.ts')
    expect(region().getByRole('button', { name: /index\.ts/ })).toBe(row)
    fireEvent.click(row)
    await act(async () => {})
    expect(instance.getSnapshot().diff).not.toBeNull()
    expect(fetchFileDiff).toHaveBeenCalledOnce()
  } finally { measure.mockRestore() }
})

it('opens the preselected commit and reopens it without dropping its eight loaded files', async () => {
  const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 390 } as DOMRect)
  try {
    const { props, instance } = makeHarness()
    const commit = { sha: 'abc123', subject: 'Eight changed files', author: 'Author', time: 1, branches: '', files: 8 }
    const files = Array.from({ length: 8 }, (_, index) => ({ path: `file-${index}.md`, status: 'M', additions: 1, deletions: 0 }))
    props.fetchCommitLog = vi.fn().mockResolvedValue({ ok: true, value: [commit] })
    props.fetchCommitFiles = vi.fn().mockResolvedValue({ ok: true, value: { sha: commit.sha, files, body: 'Commit body' } })
    instance.actions.setMode('commits')
    render(<WorktreesTab {...props}/>)
    await waitFor(() => expect(instance.getSnapshot().commitFiles).toHaveLength(8))
    const back = () => screen.queryByRole('button', { name: 'tree.expand' })
    if (back()) fireEvent.click(back()!)
    const row = screen.getByRole('button', { name: /Eight changed files/ })
    fireEvent.click(row)
    await act(async () => {})
    expect(screen.getByRole('button', { name: /file-7.md/ })).toBeTruthy()
    expect(instance.getSnapshot().commitFiles).toHaveLength(8)
    fireEvent.click(back()!)
    fireEvent.click(row)
    await act(async () => {})
    expect(screen.getByRole('button', { name: /file-7.md/ })).toBeTruthy()
    expect(props.fetchCommitFiles).toHaveBeenCalledOnce()
  } finally { measure.mockRestore() }
})

it('reports a failed commit read and retries its details through refresh', async () => {
  const { props, instance } = makeHarness()
  const commit = { sha: 'abc123', subject: 'Read retry', author: 'Author', time: 1, branches: '', files: 8 }
  props.fetchCommitLog = vi.fn().mockResolvedValue({ ok: true, value: [commit] })
  props.fetchCommitFiles = vi.fn()
    .mockResolvedValueOnce({ ok: false, error: { code: 'io', message: 'retry me' } })
    .mockResolvedValueOnce({ ok: true, value: { sha: commit.sha, files: [{ path: 'restored.md', status: 'M', additions: 1, deletions: 0 }], body: '' } })
  instance.actions.setMode('commits')
  render(<WorktreesTab {...props}/>)
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('retry me'))
  expect(instance.getSnapshot().commitFiles).toBeNull()
  act(() => instance.actions.refresh())
  await waitFor(() => expect(screen.getByRole('button', { name: /restored.md/ })).toBeTruthy())
  expect(props.fetchCommitFiles).toHaveBeenCalledTimes(2)
})
