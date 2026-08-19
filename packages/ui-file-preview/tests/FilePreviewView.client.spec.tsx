// @vitest-environment jsdom
/**
 * FilePreviewView spec under the four-share props form: a real store instance
 * (createFilePreviewStore().create()), a stub useSessions feed, and injected
 * listFiles/readFile mocks. Asserts the list lifecycle, selection-driven
 * previews, diff/content toggling, the missing-path hint, and the collapsed
 * list after selection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { FilePreviewView } from '../src/client/FilePreviewView.tsx'
import type { FilePreviewViewProps } from '../src/client/contract.ts'
import { createFilePreviewStore } from '../src/client/file-preview-store.ts'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { FilePreviewList, FilePreviewRead } from '@khorsheed/dsh-file-preview/types'

/** Selector hook over the store engine instance (the test-sanctioned engine path). */
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
    listFiles: vi.fn(),
    readFile: vi.fn(),
    openExternal: vi.fn(),
    revealFolder: vi.fn(),
    copyPath: vi.fn(async () => true),
  }
}

function renderView(
  h: Harness,
  t?: (key: string, params?: Record<string, unknown>) => string,
  opts: { canOpen?: boolean } = {},
) {
  const canOpen = opts.canOpen ?? true
  const props: FilePreviewViewProps = {
    sessionId: 's1' as SessionId,
    useSession: undefined as never,
    useInput: undefined as never,
    inputActions: undefined as never,
    useProjection: undefined as never,
    useSessions: ((sel: (s: unknown) => unknown) => sel({
      current: 's1',
      byId: { s1: { cwd: '/work' } },
    })) as never,
    useWorkspaces: (() => undefined) as never,
    useStore: hookOf(h.instance) as never,
    actions: h.actions,
    listFiles: h.listFiles as unknown as FilePreviewViewProps['listFiles'],
    readFile: h.readFile as unknown as FilePreviewViewProps['readFile'],
    isLoopback: canOpen,
    useHostDescription: ((sel: (d: { canOpenPath: boolean }) => unknown) => sel({ canOpenPath: canOpen })) as never,
    openExternal: h.openExternal as never,
    revealFolder: h.revealFolder as never,
    copyPath: h.copyPath as never,
    t: t ?? ((key: string) => key),
  }
  return render(<FilePreviewView {...props} />)
}

afterEach(() => { cleanup() })
beforeEach(() => { vi.restoreAllMocks() })

describe('FilePreviewView', () => {
  it('fetches the list on mount and shows products only', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: {
        entries: [
          { path: '/work/notes.md', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] },
          { path: '/work/src/a.ts', op: 'read', seq: 2, turn: 2, step: 3, diffs: [] },
        ],
        asOfSeq: 2,
        truncated: false,
      },
    })
    renderView(h)
    expect(await screen.findByText('notes.md')).toBeTruthy()
    // The list is products-only — the chat area's vocabulary: reads never appear.
    expect(screen.queryByText('a.ts')).toBeNull()
    expect(screen.getAllByText('drawer.step')).toHaveLength(1)
    expect(h.listFiles).toHaveBeenCalledWith('s1')
  })

  it('survives a write/edit entry whose diffs field is absent (stale or old-format list)', async () => {
    const h = makeHarness()
    // Old-format / rev-skewed server data can omit `diffs` on write/edit rows.
    h.listFiles.mockResolvedValue({
      ok: true,
      value: {
        entries: [
          { path: '/work/legacy.md', op: 'edit', seq: 1, turn: 1, step: 1 },
          { path: '/work/readonly.md', op: 'read', seq: 2, turn: 1, step: 2, diffs: [] },
        ],
        asOfSeq: 2,
        truncated: false,
      },
    })
    renderView(h)
    // The row renders even when the old-format entry omits `diffs`; the read stays hidden.
    expect(await screen.findByText('legacy.md')).toBeTruthy()
    expect(screen.getByText('drawer.step')).toBeTruthy()
    expect(screen.queryByText('readonly.md')).toBeNull()
  })

  it('filters by a search term across the whole path and highlights the match', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: {
        entries: [
          { path: '/work/src/agent.ts', op: 'write', seq: 3, turn: 1, step: 1, diffs: [] },
          { path: '/work/docs/guide.md', op: 'write', seq: 2, turn: 1, step: 2, diffs: [] },
          { path: '/work/src/utils.ts', op: 'edit', seq: 1, turn: 1, step: 3, diffs: [] },
        ],
        asOfSeq: 3,
        truncated: false,
      },
    })
    renderView(h)
    expect(await screen.findByText('agent.ts')).toBeTruthy()
    const searchInput = screen.getByLabelText('view.search.placeholder')
    act(() => { fireEvent.change(searchInput, { target: { value: 'utils' } }) })
    // The basename match keeps only utils.ts and highlights the match.
    await waitFor(() => {
      expect(document.querySelectorAll('nav[aria-label="open"] button')).toHaveLength(1)
    })
    expect(screen.queryByText('agent.ts')).toBeNull()
    expect(screen.queryByText('guide.md')).toBeNull()
    const mark = document.querySelector('mark')
    expect(mark?.textContent).toBe('utils')
  })

  it('shows a no-match state and clears back to the full list', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: {
        entries: [
          { path: '/work/src/agent.ts', op: 'write', seq: 2, turn: 1, step: 1, diffs: [] },
          { path: '/work/docs/guide.md', op: 'edit', seq: 1, turn: 1, step: 2, diffs: [] },
        ],
        asOfSeq: 2,
        truncated: false,
      },
    })
    renderView(h)
    expect(await screen.findByText('agent.ts')).toBeTruthy()
    const searchInput = screen.getByLabelText('view.search.placeholder')
    act(() => { fireEvent.change(searchInput, { target: { value: 'zzz' } }) })
    expect(await screen.findByText('view.search.noMatch')).toBeTruthy()
    expect(screen.queryByText('agent.ts')).toBeNull()
    act(() => { fireEvent.change(searchInput, { target: { value: '' } }) })
    expect(await screen.findByText('agent.ts')).toBeTruthy()
    expect(screen.getByText('guide.md')).toBeTruthy()
  })

  it('search narrows the products list but never surfaces reads', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: {
        entries: [
          { path: '/work/readme.md', op: 'read', seq: 3, turn: 1, step: 1, diffs: [] },
          { path: '/work/src/read.ts', op: 'edit', seq: 2, turn: 1, step: 2, diffs: [] },
        ],
        asOfSeq: 3,
        truncated: false,
      },
    })
    renderView(h)
    expect(await screen.findByText('read.ts')).toBeTruthy()
    const searchInput = screen.getByLabelText('view.search.placeholder')
    act(() => { fireEvent.change(searchInput, { target: { value: 'read' } }) })
    // The read-only readme.md stays hidden even though it matches the term.
    await waitFor(() => {
      expect(document.querySelectorAll('nav[aria-label="open"] button')).toHaveLength(1)
    })
  })

  it('shows the loading marker while the list is in flight', async () => {    const h = makeHarness()
    h.listFiles.mockReturnValue(new Promise(() => {}))
    renderView(h)
    expect(await screen.findByText('drawer.loading')).toBeTruthy()
  })

  it('shows the list error when the fetch fails', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({ ok: false, error: { code: 'x', message: 'boom' } })
    renderView(h)
    expect(await screen.findByText('drawer.listError')).toBeTruthy()
  })

  it('shows the empty state for a session with no files', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({ ok: true, value: { entries: [], asOfSeq: 0, truncated: false } })
    renderView(h)
    expect(await screen.findByText('drawer.empty')).toBeTruthy()
  })

  it('selects a row, reads its content, and renders the text preview', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: { entries: [{ path: '/work/notes.md', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: 1, truncated: false },
    })
    h.readFile.mockResolvedValue({ ok: true, value: { path: '/work/notes.md', kind: 'text', content: 'hello world', truncated: false } })
    renderView(h)
    const row = await screen.findByText('notes.md')
    act(() => { row.click() })
    expect(await screen.findByText('hello world')).toBeTruthy()
    expect(h.readFile).toHaveBeenCalledWith('s1', '/work/notes.md')
  })

  it('shows the selected file\'s gesture row and routes copy/folder/IDE with its path', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: { entries: [{ path: '/work/notes.md', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: 1, truncated: false },
    })
    h.readFile.mockResolvedValue({ ok: true, value: { path: '/work/notes.md', kind: 'text', content: 'x', truncated: false } })
    renderView(h)
    const row = await screen.findByText('notes.md')
    act(() => { row.click() })
    await screen.findByText('drawer.copyPath')
    // The preview header shows the file's resolved path (left) beside the
    // gesture buttons (right), mirroring the drawer header.
    expect(screen.getByText('/work/notes.md')).toBeTruthy()
    act(() => { screen.getByLabelText('drawer.copyPath').click() })
    await act(async () => {})
    expect(h.copyPath).toHaveBeenCalledWith('/work/notes.md')
    expect(screen.getByLabelText('drawer.copied')).toBeTruthy()
    act(() => { screen.getByLabelText('drawer.openFolder').click() })
    expect(h.revealFolder).toHaveBeenCalledWith('/work/notes.md')
    act(() => { screen.getByLabelText('drawer.openIde').click() })
    expect(h.openExternal).toHaveBeenCalledWith('/work/notes.md')
  })

  it('resolves a relative recorded path for the preview header', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: { entries: [{ path: 'a.md', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: 1, truncated: false },
    })
    h.readFile.mockResolvedValue({ ok: true, value: { path: 'a.md', kind: 'text', content: 'x', truncated: false } })
    renderView(h)
    const row = await screen.findByText('a.md')
    act(() => { row.click() })
    await screen.findByText('drawer.copyPath')
    // 'a.md' resolves against the session cwd (/work) to the absolute path.
    expect(screen.getByText('/work/a.md')).toBeTruthy()
  })

  it('does not claim a copy the host declined', async () => {
    const h = makeHarness()
    h.copyPath.mockResolvedValue(false)
    h.listFiles.mockResolvedValue({
      ok: true,
      value: { entries: [{ path: '/work/notes.md', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: 1, truncated: false },
    })
    h.readFile.mockResolvedValue({ ok: true, value: { path: '/work/notes.md', kind: 'text', content: 'x', truncated: false } })
    renderView(h)
    const row = await screen.findByText('notes.md')
    act(() => { row.click() })
    await screen.findByText('drawer.copyPath')
    act(() => { screen.getByLabelText('drawer.copyPath').click() })
    await act(async () => {})
    expect(h.copyPath).toHaveBeenCalledWith('/work/notes.md')
    expect(screen.queryByLabelText('drawer.copied')).toBeNull()
  })

  it('gates the host-open gestures but keeps copy when the host cannot open paths', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: { entries: [{ path: '/work/notes.md', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: 1, truncated: false },
    })
    h.readFile.mockResolvedValue({ ok: true, value: { path: '/work/notes.md', kind: 'text', content: 'x', truncated: false } })
    renderView(h, undefined, { canOpen: false })
    const row = await screen.findByText('notes.md')
    act(() => { row.click() })
    await screen.findByText('drawer.copyPath')
    expect(screen.getByLabelText('drawer.copyPath')).toBeTruthy()
    expect(screen.queryByLabelText('drawer.openFolder')).toBeNull()
    expect(screen.queryByLabelText('drawer.openIde')).toBeNull()
  })

  it('hides the gesture row while no file is selected', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: { entries: [{ path: '/work/notes.md', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: 1, truncated: false },
    })
    renderView(h)
    await screen.findByText('notes.md')
    expect(screen.queryByLabelText('drawer.copyPath')).toBeNull()
    expect(screen.queryByLabelText('drawer.openFolder')).toBeNull()
  })

  it('shows the current content by default and steps the recorded diffs', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: {
        entries: [{
          path: '/work/a.md', op: 'edit', seq: 1, turn: 1, step: 1, diffs: [
            { seq: 1, turn: 1, step: 1, oldText: 'old', newText: 'new' },
            { seq: 2, turn: 1, step: 2, oldText: 'new', newText: 'newer' },
          ],
          lastDiff: { oldText: 'new', newText: 'newer' },
        }],
        asOfSeq: 1,
        truncated: false,
      },
    })
    h.readFile.mockResolvedValue({ ok: true, value: { path: '/work/a.md', kind: 'text', content: 'current', truncated: false } })
    renderView(h)
    const row = await screen.findByText('a.md')
    act(() => { row.click() })
    // Content is the default view.
    expect(await screen.findByText('current')).toBeTruthy()
    // The changes tab opens on the latest diff (2/2) and steps back.
    act(() => { screen.getByText(/drawer\.tab\.diff/).click() })
    expect(await screen.findByText('newer')).toBeTruthy()
    act(() => { screen.getByLabelText('drawer.step.older').click() })
    expect(await screen.findByText('old')).toBeTruthy()
    expect(screen.getByText('new')).toBeTruthy()
    act(() => { screen.getByLabelText('drawer.step.newer').click() })
    expect(await screen.findByText('newer')).toBeTruthy()
  })

  it('searches the previewed content with marks and match jumping', async () => {
    // jsdom lacks scrollIntoView; stub it so the jump-scroll arm executes.
    const scrollSpy = vi.fn()
    Element.prototype.scrollIntoView = scrollSpy
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: {
        entries: [{ path: '/work/a.md', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }],
        asOfSeq: 1,
        truncated: false,
      },
    })
    h.readFile.mockResolvedValue({
      ok: true,
      value: { path: '/work/a.md', kind: 'text', content: 'alpha\nbeta\ngamma beta', truncated: false },
    })
    renderView(h)
    const row = await screen.findByText('a.md')
    act(() => { row.click() })
    const input = await screen.findByLabelText('preview.search.placeholder')
    act(() => { fireEvent.change(input, { target: { value: 'beta' } }) })
    // Two matching lines, three marks ("beta" line + "gamma beta").
    expect((await screen.findAllByText('beta')).length).toBe(2)
    expect(screen.getByText('1/2')).toBeTruthy()
    act(() => { screen.getByLabelText('preview.search.next').click() })
    expect(screen.getByText('2/2')).toBeTruthy()
    // Wrap-around in both directions.
    act(() => { screen.getByLabelText('preview.search.next').click() })
    expect(screen.getByText('1/2')).toBeTruthy()
    act(() => { screen.getByLabelText('preview.search.prev').click() })
    expect(screen.getByText('2/2')).toBeTruthy()
    expect(scrollSpy).toHaveBeenCalled()
    // A miss keeps the code view and says so; clearing returns to it.
    act(() => { fireEvent.change(input, { target: { value: 'zzz' } }) })
    expect(await screen.findByText('preview.search.noMatch')).toBeTruthy()
    act(() => { fireEvent.change(input, { target: { value: '' } }) })
    await waitFor(() => {
      expect(screen.queryByText('preview.search.noMatch')).toBeNull()
    })
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it('clamps the stepper at both ends and returns to content', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: {
        entries: [{
          path: '/work/a.md', op: 'edit', seq: 1, turn: 1, step: 1, diffs: [
            { seq: 1, turn: 1, step: 1, oldText: 'old', newText: 'new' },
            { seq: 2, turn: 1, step: 2, oldText: 'new', newText: 'newer' },
          ],
          lastDiff: { oldText: 'new', newText: 'newer' },
        }],
        asOfSeq: 1,
        truncated: false,
      },
    })
    h.readFile.mockResolvedValue({ ok: true, value: { path: '/work/a.md', kind: 'text', content: 'current', truncated: false } })
    renderView(h)
    const row = await screen.findByText('a.md')
    act(() => { row.click() })
    // Wait for the preview (and so the tabs) to render before stepping.
    expect(await screen.findByText('current')).toBeTruthy()
    act(() => { screen.getByText(/drawer\.tab\.diff/).click() })
    expect(await screen.findByText(/drawer\.step\.count/)).toBeTruthy()
    // At the latest change the newer button is disabled and older walks back.
    expect(screen.getByLabelText('drawer.step.newer')).toHaveProperty('disabled', true)
    act(() => { screen.getByLabelText('drawer.step.older').click() })
    act(() => { screen.getByLabelText('drawer.step.older').click() })
    expect(screen.getByLabelText('drawer.step.older')).toHaveProperty('disabled', true)
    act(() => { screen.getByText('drawer.tab.content').click() })
    expect(await screen.findByText('current')).toBeTruthy()
  })

  it('renders markdown files through the official renderer (bold, table)', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: { entries: [{ path: '/work/readme.md', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: 1, truncated: false },
    })
    h.readFile.mockResolvedValue({
      ok: true,
      value: {
        path: '/work/readme.md',
        kind: 'text',
        content: '**bold**\n\n| a | b |\n| - | - |\n| 1 | 2 |',
        truncated: false,
      },
    })
    renderView(h)
    const row = await screen.findByText('readme.md')
    act(() => { row.click() })
    // The document view sits in the block frame with a format banner.
    expect(await screen.findByText('markdown')).toBeTruthy()
    // Bold renders as <strong> — the raw '**' markers are gone.
    expect(screen.getByText('bold')).toBeTruthy()
    expect(screen.queryByText(/\*\*bold\*\*/)).toBeNull()
    // The GFM table renders its cells.
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('a')).toBeTruthy()
    expect(screen.getByText('b')).toBeTruthy()
  })

  it('renders JSON files through the JsonTree inspector', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: { entries: [{ path: '/work/config.json', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: 1, truncated: false },
    })
    h.readFile.mockResolvedValue({
      ok: true,
      value: { path: '/work/config.json', kind: 'text', content: '{"name": "demo", "count": 2}', truncated: false },
    })
    renderView(h)
    const row = await screen.findByText('config.json')
    act(() => { row.click() })
    // The tree sits in the block frame with its format banner.
    expect(await screen.findByText('json')).toBeTruthy()
    // JsonTree renders the string value with its quotes and the number value.
    expect(screen.getByText('"demo"')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('falls back to the code view when JSON does not parse', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: { entries: [{ path: '/work/broken.json', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: 1, truncated: false },
    })
    h.readFile.mockResolvedValue({ ok: true, value: { path: '/work/broken.json', kind: 'text', content: '{ not json', truncated: false } })
    renderView(h)
    const row = await screen.findByText('broken.json')
    act(() => { row.click() })
    // Invalid JSON keeps the literal code view.
    expect(await screen.findByText('{ not json')).toBeTruthy()
  })

  it('renders CSV files as a table', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: { entries: [{ path: '/work/data.csv', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: 1, truncated: false },
    })
    h.readFile.mockResolvedValue({
      ok: true,
      value: { path: '/work/data.csv', kind: 'text', content: 'name,count\nalpha,1\nbeta,2', truncated: false },
    })
    renderView(h)
    const row = await screen.findByText('data.csv')
    act(() => { row.click() })
    // The delimited file renders as a table — cells, not the raw source —
    // inside the block frame with its format banner.
    expect(await screen.findByText('csv')).toBeTruthy()
    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.getByText('beta')).toBeTruthy()
    expect(screen.getByText('count')).toBeTruthy()
  })

  it('keeps non-markdown text in the syntax-highlighted code view', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: { entries: [{ path: '/work/notes.txt', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: 1, truncated: false },
    })
    h.readFile.mockResolvedValue({ ok: true, value: { path: '/work/notes.txt', kind: 'text', content: '**not bold** here', truncated: false } })
    renderView(h)
    const row = await screen.findByText('notes.txt')
    act(() => { row.click() })
    // A non-markdown text file keeps its literal source — no markdown parse.
    expect(await screen.findByText('**not bold** here')).toBeTruthy()
  })

  it('shows the recorded path for a missing file', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: { entries: [{ path: '/work/gone.md', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: 1, truncated: false },
    })
    h.readFile.mockResolvedValue({ ok: true, value: { path: '/work/gone.md', kind: 'missing' } })
    renderView(h)
    const row = await screen.findByText('gone.md')
    act(() => { row.click() })
    expect(await screen.findByText('drawer.kind.missing')).toBeTruthy()
    expect(screen.getByText('drawer.missingPath')).toBeTruthy()
  })

  it('flags truncated text and renders every non-text preview kind', async () => {
    const cases: Array<{ read: FilePreviewRead; marker: string }> = [
      { read: { path: 'a', kind: 'text', content: 'x', truncated: true }, marker: 'drawer.truncated' },
      { read: { path: 'a', kind: 'text', truncated: true }, marker: 'drawer.truncated' },
      { read: { path: 'a.png', kind: 'binary', size: 42 }, marker: 'drawer.kind.binary' },
      { read: { path: 'a.bin', kind: 'binary' }, marker: 'drawer.kind.binary' },
      { read: { path: 'a', kind: 'missing' }, marker: 'drawer.kind.missing' },
      { read: { path: 'a', kind: 'too-large', size: 999 }, marker: 'drawer.kind.tooLarge' },
      { read: { path: 'a', kind: 'too-large' }, marker: 'drawer.kind.tooLarge' },
      { read: { path: 'a', kind: 'error', message: 'nope' }, marker: 'nope' },
      { read: { path: 'a', kind: 'error' }, marker: 'drawer.kind.error' },
    ]
    for (const { read, marker } of cases) {
      cleanup()
      const h = makeHarness()
      h.listFiles.mockResolvedValue({
        ok: true,
        value: { entries: [{ path: read.path, op: 'edit', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: 1, truncated: false },
      })
      h.readFile.mockResolvedValue({ ok: true, value: read })
      renderView(h)
      const row = await screen.findByText(read.path.split('/').at(-1) ?? read.path)
      act(() => { row.click() })
      expect(await screen.findByText(new RegExp(marker))).toBeTruthy()
    }
  })

  it('renders an image read through the host-served URL', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: { entries: [{ path: 'a.png', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: 1, truncated: false },
    })
    h.readFile.mockResolvedValue({ ok: true, value: { path: 'a.png', kind: 'image', url: '/file-preview-image/s1/a.png', size: 42 } })
    renderView(h)
    const row = await screen.findByText('a.png')
    act(() => { row.click() })
    const img = await screen.findByAltText('a.png')
    expect(img.getAttribute('src')).toBe('/file-preview-image/s1/a.png')
    expect(screen.getByText('42 B')).toBeTruthy()
    // An image read without a size renders the bitmap without the size note.
    cleanup()
    const noSize = makeHarness()
    noSize.listFiles.mockResolvedValue({
      ok: true,
      value: { entries: [{ path: 'a.png', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: 1, truncated: false },
    })
    noSize.readFile.mockResolvedValue({ ok: true, value: { path: 'a.png', kind: 'image', url: '/file-preview-image/s1/a.png' } })
    renderView(noSize)
    const row2 = await screen.findByText('a.png')
    act(() => { row2.click() })
    expect(await screen.findByAltText('a.png')).toBeTruthy()
    expect(screen.queryByText(/B$/)).toBeNull()
  })

  it('shows the preview error when the read fails', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: { entries: [{ path: 'a.md', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: 1, truncated: false },
    })
    h.readFile.mockResolvedValue({ ok: false, error: { code: 'x', message: 'read boom' } })
    renderView(h)
    const row = await screen.findByText('a.md')
    act(() => { row.click() })
    expect(await screen.findByText('drawer.kind.error')).toBeTruthy()
  })

  it('keeps the list visible after selection and orders latest activity first', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: {
        entries: [
          { path: '/work/a.md', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] },
          { path: '/work/b.md', op: 'edit', seq: 2, turn: 1, step: 2, diffs: [] },
        ],
        asOfSeq: 2,
        truncated: false,
      },
    })
    h.readFile.mockResolvedValue({ ok: true, value: { path: '/work/a.md', kind: 'text', content: 'x', truncated: false } })
    renderView(h)
    const row = await screen.findByText('a.md')
    act(() => { row.click() })
    // The list stays visible in the roomy tab; the newest file renders first.
    const nav = screen.getByRole('navigation', { name: 'open' })
    const names = [...nav.querySelectorAll('button')].map(el => el.textContent ?? '')
    expect(names[0]).toContain('b.md')
    expect(names[1]).toContain('a.md')
  })

  it('refresh re-triggers the list fetch', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: { entries: [{ path: 'a.md', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: 1, truncated: false },
    })
    renderView(h)
    await screen.findByText('a.md')
    expect(h.listFiles).toHaveBeenCalledTimes(1)
    act(() => { h.actions.refreshList() })
    await act(async () => {})
    expect(h.listFiles).toHaveBeenCalledTimes(2)
  })

  it('drops a stale in-flight preview read when the selection moves', async () => {
    const h = makeHarness()
    h.listFiles.mockResolvedValue({
      ok: true,
      value: {
        entries: [
          { path: 'a.md', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] },
          { path: 'b.md', op: 'edit', seq: 2, turn: 1, step: 2, diffs: [] },
        ],
        asOfSeq: 2,
        truncated: false,
      },
    })
    let resolveReadA: (v: ReadResult) => void = () => {}
    h.readFile.mockReturnValueOnce(new Promise((res) => { resolveReadA = res }))
    h.readFile.mockResolvedValue({ ok: true, value: { path: 'b.md', kind: 'text', content: 'B', truncated: false } })
    renderView(h)
    const rowA = await screen.findByText('a.md')
    act(() => { rowA.click() })
    await act(async () => {})
    act(() => { screen.getByText('b.md').click() })
    await act(async () => { resolveReadA({ ok: true, value: { path: 'a.md', kind: 'text', content: 'A', truncated: false } }) })
    expect(await screen.findByText('B')).toBeTruthy()
    expect(screen.queryByText('A')).toBeNull()
  })

  it('drops a stale in-flight list fetch when the view remounts', async () => {
    const h = makeHarness()
    let resolveList: (v: ListResult) => void = () => {}
    h.listFiles.mockReturnValue(new Promise((res) => { resolveList = res }))
    const { unmount } = renderView(h)
    unmount()
    await act(async () => {
      resolveList({ ok: true, value: { entries: [{ path: 'a.md', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: 1, truncated: false } })
    })
    expect(h.instance.getSnapshot().list).toBeNull()
  })
})
