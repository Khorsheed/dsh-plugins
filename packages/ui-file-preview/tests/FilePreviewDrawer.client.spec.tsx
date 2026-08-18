// @vitest-environment jsdom
/**
 * FilePreviewDrawer spec under the four-share props form: a real store
 * instance, a stub useSessions feed, and injected listFiles/readFile mocks.
 * Asserts the closed state, the openPath-driven content preview, the diff
 * pane, the close gesture, and preview failures — content only, no file list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { FilePreviewDrawer } from '../src/client/FilePreviewDrawer.tsx'
import type { FilePreviewDrawerProps } from '../src/client/contract.ts'
import { createFilePreviewStore } from '../src/client/file-preview-store.ts'
import type { FilePreviewList, FilePreviewRead } from '@khorsheed/dsh-file-preview/types'

function hookOf(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => unknown }) {
  return function useSelector<S>(sel: (s: unknown) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

type ReadResult = { ok: true; value: FilePreviewRead } | { ok: false; error: { code: string; message: string } }
type ListResult = { ok: true; value: FilePreviewList } | { ok: false; error: { code: string; message: string } }

type Store = ReturnType<typeof createFilePreviewStore>
type Instance = ReturnType<Store['create']>

interface Harness {
  instance: Instance
  actions: Instance['actions']
  listFiles: ReturnType<typeof vi.fn>
  readFile: ReturnType<typeof vi.fn>
  openExternal: ReturnType<typeof vi.fn>
  revealFolder: ReturnType<typeof vi.fn>
  copyPath: ReturnType<typeof vi.fn>
}

function makeHarness(): Harness {
  const instance = createFilePreviewStore().create()
  return {
    instance,
    actions: instance.actions,
    listFiles: vi.fn(async () => ({ ok: true, value: { entries: [], asOfSeq: 0, truncated: false } })),
    readFile: vi.fn(async () => ({ ok: true, value: { path: 'x', kind: 'text', content: 'x', truncated: false } })),
    openExternal: vi.fn(),
    revealFolder: vi.fn(),
    copyPath: vi.fn(async () => true),
  }
}

function renderDrawer(h: Harness, opts: { current?: string | undefined; canOpen?: boolean } = {}) {
  const current = 'current' in opts ? opts.current : 's1'
  const canOpen = opts.canOpen ?? true
  const props: FilePreviewDrawerProps = {
    useSessions: ((sel: (s: unknown) => unknown) => sel({
      current,
      byId: current === undefined ? {} : { [current]: { cwd: '/work' } },
    })) as never,
    useWorkspaces: (() => undefined) as never,
    useStore: hookOf(h.instance) as never,
    actions: h.actions,
    listFiles: h.listFiles as unknown as FilePreviewDrawerProps['listFiles'],
    readFile: h.readFile as unknown as FilePreviewDrawerProps['readFile'],
    isLoopback: canOpen,
    useHostDescription: ((sel: (d: { canOpenPath: boolean }) => unknown) => sel({ canOpenPath: canOpen })) as never,
    openExternal: h.openExternal as never,
    revealFolder: h.revealFolder as never,
    copyPath: h.copyPath as never,
    t: (key: string) => key,
  }
  return render(<FilePreviewDrawer {...props} />)
}

afterEach(() => { cleanup() })
beforeEach(() => { vi.restoreAllMocks() })

describe('FilePreviewDrawer', () => {
  it('renders nothing while closed', () => {
    const h = makeHarness()
    const { container } = renderDrawer(h)
    expect(container.firstChild).toBeNull()
  })

  it('shows the placeholder when opened without a selection', () => {
    const h = makeHarness()
    renderDrawer(h)
    act(() => { h.actions.open() })
    expect(screen.getByText('drawer.previewEmpty')).toBeTruthy()
    // Without a selection the header keeps the generic title.
    expect(screen.getByText('drawer.title')).toBeTruthy()
    // The list still loads (it supplies the diff); no file read is issued.
    expect(h.listFiles).toHaveBeenCalledTimes(1)
    expect(h.readFile).not.toHaveBeenCalled()
  })

  it('shows the selected file\'s resolved path in the header', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({ ok: true, value: { entries: [], asOfSeq: 0, truncated: false } })
    h.readFile.mockResolvedValue({ ok: true, value: { path: 'a.md', kind: 'text', content: 'x', truncated: false } })
    renderDrawer(h)
    // A relative recorded path resolves against the current session cwd — the
    // same spelling copy/open/reveal act on, so the header shows the real path.
    act(() => { h.actions.openPath('a.md') })
    await screen.findByRole('dialog')
    expect(screen.getByText('/work/a.md')).toBeTruthy()
    expect(screen.queryByText('drawer.title')).toBeNull()
  })

  it('does not fetch without a current session', () => {
    const h = makeHarness()
    renderDrawer(h, { current: undefined })
    act(() => { h.actions.openPath('/work/a.md') })
    expect(h.listFiles).not.toHaveBeenCalled()
    expect(h.readFile).not.toHaveBeenCalled()
  })

  it('shows the opened file content by default and fetches the diff list', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: {
        entries: [{ path: '/work/a.md', op: 'edit', seq: 1, turn: 1, step: 1, diffs: [
          { seq: 1, turn: 1, step: 1, oldText: 'old', newText: 'new' },
        ], lastDiff: { oldText: 'old', newText: 'new' } }],
        asOfSeq: 1,
        truncated: false,
      },
    })
    h.readFile.mockResolvedValue({ ok: true, value: { path: '/work/a.md', kind: 'text', content: 'current', truncated: false } })
    renderDrawer(h)
    act(() => { h.actions.openPath('/work/a.md') })
    expect(await screen.findByRole('dialog')).toBeTruthy()
    // Content is the default view; the recorded change lives behind the tab.
    expect(await screen.findByText('current')).toBeTruthy()
    act(() => { screen.getByText(/drawer\.tab\.diff/).click() })
    expect(await screen.findByText('old')).toBeTruthy()
    expect(screen.getByText('new')).toBeTruthy()
    expect(h.listFiles).toHaveBeenCalledWith('s1')
    expect(h.readFile).toHaveBeenCalledWith('s1', '/work/a.md')
  })

  it('shows the preview error when the read fails', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({ ok: true, value: { entries: [], asOfSeq: 0, truncated: false } })
    h.readFile.mockResolvedValue({ ok: false, error: { code: 'x', message: 'boom' } })
    renderDrawer(h)
    act(() => { h.actions.openPath('/work/a.md') })
    expect(await screen.findByText('drawer.kind.error')).toBeTruthy()
  })

  it('closes on the close button', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({ ok: true, value: { entries: [], asOfSeq: 0, truncated: false } })
    h.readFile.mockResolvedValue({ ok: true, value: { path: '/work/a.md', kind: 'text', content: 'x', truncated: false } })
    const { container } = renderDrawer(h)
    act(() => { h.actions.openPath('/work/a.md') })
    await screen.findByRole('dialog')
    act(() => { screen.getByLabelText('drawer.close').click() })
    expect(container.firstChild).toBeNull()
  })

  it('routes the folder and IDE gestures with the selected path', async () => {
    const h = makeHarness()
    renderDrawer(h)
    act(() => { h.actions.openPath('/work/a.md') })
    await screen.findByRole('dialog')
    act(() => { screen.getByLabelText('drawer.openFolder').click() })
    expect(h.revealFolder).toHaveBeenCalledWith('/work/a.md')
    act(() => { screen.getByLabelText('drawer.openIde').click() })
    expect(h.openExternal).toHaveBeenCalledWith('/work/a.md')
  })

  it('copies the selected path and flips to the copied label on success', async () => {
    const h = makeHarness()
    renderDrawer(h)
    act(() => { h.actions.openPath('/work/a.md') })
    await screen.findByRole('dialog')
    act(() => { screen.getByLabelText('drawer.copyPath').click() })
    await act(async () => {})
    expect(h.copyPath).toHaveBeenCalledWith('/work/a.md')
    expect(screen.getByLabelText('drawer.copied')).toBeTruthy()
  })

  it('does not claim a copy the host declined', async () => {
    const h = makeHarness()
    h.copyPath.mockResolvedValue(false)
    renderDrawer(h)
    act(() => { h.actions.openPath('/work/a.md') })
    await screen.findByRole('dialog')
    act(() => { screen.getByLabelText('drawer.copyPath').click() })
    await act(async () => {})
    expect(h.copyPath).toHaveBeenCalledWith('/work/a.md')
    // The label stays on the idle copy state — no false success feedback.
    expect(screen.queryByLabelText('drawer.copied')).toBeNull()
  })

  it('keeps copy available without a selection hidden and host-open gestures gated', async () => {
    const h = makeHarness()
    renderDrawer(h, { canOpen: false })
    act(() => { h.actions.openPath('/work/a.md') })
    await screen.findByRole('dialog')
    // Clipboard works in any browser context; only the host gestures are gated.
    expect(screen.getByLabelText('drawer.copyPath')).toBeTruthy()
    expect(screen.queryByLabelText('drawer.openFolder')).toBeNull()
    expect(screen.queryByLabelText('drawer.openIde')).toBeNull()
    act(() => { h.actions.close() })
    expect(screen.queryByLabelText('drawer.copyPath')).toBeNull()
  })

  it('hides the host-open gestures when the host cannot open paths', async () => {
    const h = makeHarness()
    renderDrawer(h, { canOpen: false })
    act(() => { h.actions.openPath('/work/a.md') })
    await screen.findByRole('dialog')
    expect(screen.queryByLabelText('drawer.openFolder')).toBeNull()
    expect(screen.queryByLabelText('drawer.openIde')).toBeNull()
  })

  it('ignores a list error (the list only supplies the diff)', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({ ok: false, error: { code: 'x', message: 'boom' } })
    h.readFile.mockResolvedValue({ ok: true, value: { path: '/work/a.md', kind: 'text', content: 'x', truncated: false } })
    renderDrawer(h)
    act(() => { h.actions.openPath('/work/a.md') })
    expect(await screen.findByText('x')).toBeTruthy()
  })

  it('drops stale in-flight fetches when the drawer closes', async () => {
    const h = makeHarness()
    let resolveList: (v: ListResult) => void = () => {}
    h.listFiles.mockReturnValue(new Promise((res) => { resolveList = res }))
    let resolveRead: (v: ReadResult) => void = () => {}
    h.readFile.mockReturnValue(new Promise((res) => { resolveRead = res }))
    renderDrawer(h)
    act(() => { h.actions.openPath('/work/a.md') })
    act(() => { h.actions.close() })
    await act(async () => {
      resolveList({ ok: true, value: { entries: [], asOfSeq: 0, truncated: false } })
      resolveRead({ ok: true, value: { path: '/work/a.md', kind: 'text', content: 'x', truncated: false } })
    })
    expect(h.instance.getSnapshot().list).toBeNull()
    expect(h.instance.getSnapshot().preview).toBeNull()
  })
})
