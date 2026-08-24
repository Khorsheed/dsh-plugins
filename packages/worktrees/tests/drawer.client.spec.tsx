// @vitest-environment jsdom
/**
 * Drawer spec under the composed-props form: a real store instance
 * (createWorktreesStore().create()) and injected Remote mocks. Asserts the
 * open → changes-fetch → file-select → diff-fetch chain that the browser
 * flow depends on: selecting a committed file must drive a
 * `fetchFileDiff(sessionId, { path, segment: 'committed' })` call when the
 * detail view switches to diff, and a `fetchReadFile` call for content.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { WorktreesDrawerProps } from '../src/client/contract.ts'
import { WorktreesDrawer } from '../src/client/Drawer.tsx'
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
  uncommitted: [],
  committed: [
    { path: 'packages/room/src/index.ts', status: 'A', additions: 47, deletions: 0 },
  ],
}

function makeHarness() {
  const instance = createWorktreesStore().create()
  const fetchSummary = vi.fn<() => Promise<Result<SessionSummary>>>()
  const fetchChanges = vi.fn<() => Promise<Result<ChangesResult>>>()
  const fetchRepoFiles = vi.fn<() => Promise<Result<string[]>>>()
  const fetchCommitLog = vi.fn<() => Promise<Result<never[]>>>()
  const fetchCommitFiles = vi.fn()
  const fetchFileDiff = vi.fn<() => Promise<Result<FileDiffResult>>>()
  const fetchReadFile = vi.fn<() => Promise<Result<ReadFileResult>>>()
  const openExternal = vi.fn()
  const copyBranch = vi.fn<() => Promise<boolean>>()

  fetchSummary.mockResolvedValue({ ok: true as const, value: SUMMARY })
  fetchChanges.mockResolvedValue({ ok: true as const, value: CHANGES })
  fetchRepoFiles.mockResolvedValue({ ok: true as const, value: [] })
  fetchCommitLog.mockResolvedValue({ ok: true as const, value: [] })
  fetchCommitFiles.mockResolvedValue({ ok: true as const, value: { sha: 'x', files: [] } })
  fetchFileDiff.mockResolvedValue({ ok: true as const, value: { diff: 'diff --git a/x b/x\n+new\n' } })
  fetchReadFile.mockResolvedValue({ ok: true as const, value: { content: 'hello\n' } })

  const props = {
    useStore: hookOf(instance),
    actions: instance.actions,
    useSessions: ((sel: (s: { current: string | undefined }) => unknown) => sel({ current: SESSION })) as never,
    fetchSummary,
    fetchChanges,
    fetchRepoFiles,
    fetchCommitLog,
    fetchCommitFiles,
    fetchFileDiff,
    fetchReadFile,
    isLoopback: true,
    useHostDescription: ((sel: (d: { canOpenPath: boolean }) => unknown) => sel({ canOpenPath: true })) as never,
    openExternal,
    copyBranch,
    t: (key: string, params?: Record<string, unknown>) => (
      params === undefined ? key : `${key} ${JSON.stringify(params)}`
    ),
  } as unknown as WorktreesDrawerProps

  return { instance, props, fetchFileDiff, fetchReadFile, fetchChanges }
}

afterEach(() => { cleanup() })

describe('WorktreesDrawer', () => {
  it('renders nothing while closed', () => {
    const { instance, props } = makeHarness()
    render(<WorktreesDrawer {...props} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('fetches changes on open and drives fileDiff on select + diff view', async () => {
    const { instance, props, fetchFileDiff, fetchReadFile, fetchChanges } = makeHarness()
    render(<WorktreesDrawer {...props} />)

    // Open in changes mode.
    instance.actions.open('worktree')
    await waitFor(() => expect(fetchChanges).toHaveBeenCalledWith(SESSION))
    await waitFor(() => expect(fetchChanges.mock.results[0]?.value).toBeDefined())
    await new Promise(r => setTimeout(r, 500))
    // The tree defaults to the first level — expand the directories down to
    // the committed file, then click it. The tree rows are buttons whose text
    // lives in a child span; query the span and climb to the row.
    const dialog = () => within(screen.getByRole('dialog'))
    for (const dir of ['packages', 'room', 'src']) {
      const dirRow = await dialog().findByRole('button', { name: dir })
      fireEvent.click(dirRow)
    }
    const row = await dialog().findByRole('button', { name: /index\.ts/ })
    fireEvent.click(row)
    // In a changes context the detail defaults to the diff → fileDiff drives
    // with the committed segment immediately.
    await waitFor(() => expect(fetchFileDiff).toHaveBeenCalledWith(
      SESSION,
      { path: 'packages/room/src/index.ts', segment: 'committed' },
    ))

    // Switching to the content view drives readFile.
    const contentButton = await screen.findByText('detail.content')
    fireEvent.click(contentButton)
    await waitFor(() => expect(fetchReadFile).toHaveBeenCalledWith(SESSION, { path: 'packages/room/src/index.ts' }))
  })
})
