// @vitest-environment jsdom
/**
 * WorkspaceView root-defaulting and the back-to-workspace gesture: a session
 * with no remembered root lands on its workspace cwd (including when the
 * session row loads late), a remembered root always wins, and the
 * back-to-workspace button renders exactly while the current root differs
 * from the workspace — its click re-roots and remembers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { WorkspaceViewProps } from '../src/client/contract.ts'
import { clearLocalRoot, localRootOf, rememberLocalRoot } from '../src/client/local-root.ts'
import { createLocalFilesStore } from '../src/client/store-local.ts'
import { WorkspaceView, crumbsOf } from '../src/client/WorkspaceView.tsx'

const SESSION = 'sess-1'
const WORKSPACE = '/work/repo'

type Result<T> = { ok: true; value: T }
type SessionsSnapshot = { byId: Record<string, { cwd?: string }> }

/**
 * One store instance plus the view's props. `sessions` is read through a
 * closure, so a test can grow the snapshot between rerenders (the session row
 * arriving late).
 */
function makeProps(sessions: SessionsSnapshot) {
  const instance = createLocalFilesStore().create()
  const box = { sessions }
  const listDirectory = vi.fn(() => Promise.resolve({ ok: true, value: { entries: [] } } as Result<{ entries: never[] }>))
  const props = {
    sessionId: SESSION,
    useStore: ((sel: (s: never) => unknown) =>
      // eslint-disable-next-line react-hooks/rules-of-hooks -- the harness binds the selector hook exactly this way
      useSyncExternalStore(instance.subscribe, () => sel(instance.getSnapshot() as never))) as never,
    useSessions: ((sel: (s: never) => unknown) => sel(box.sessions as never)) as never,
    actions: instance.actions,
    t: (key: string) => key,
    listDirectory,
    readFile: vi.fn(),
    searchFiles: vi.fn(),
    pickWorkspace: vi.fn(() => Promise.resolve(null)),
    useOpenInApps: ((sel: (s: readonly string[] | null) => unknown) => sel([])) as never,
    openFolder: vi.fn(),
    openIDE: vi.fn(),
  } as unknown as WorkspaceViewProps
  return { props, instance, box, listDirectory }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  clearLocalRoot(SESSION)
})

it('opens a selected file at narrow width, keeps its read on back, and resets navigation on root change', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 390 } as DOMRect)
  const { props, instance } = makeProps({ byId: { [SESSION]: { cwd: WORKSPACE } } })
  props.listDirectory = vi.fn().mockResolvedValue({ ok: true, value: { entries: [{ name: 'a.md', isDir: false }] } })
  props.readFile = vi.fn().mockResolvedValue({ ok: true, value: { path: `${WORKSPACE}/a.md`, kind: 'text', content: 'Retained read' } })
  render(<WorkspaceView {...props} />)
  await act(async () => {})
  const file = screen.getByRole('button', { name: 'a.md' })
  fireEvent.click(file)
  await act(async () => {})
  expect(screen.queryByRole('button', { name: 'a.md' })).toBeNull()
  expect(screen.getByText('Retained read')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'detail.back' }))
  expect(screen.getByRole('button', { name: 'a.md' })).toBe(file)
  expect(instance.getSnapshot().preview).toMatchObject({ content: 'Retained read' })
  fireEvent.click(file)
  await act(async () => {})
  expect(screen.getByText('Retained read')).toBeTruthy()
  expect(props.readFile).toHaveBeenCalledTimes(1)
  act(() => instance.actions.setRoot('/work/other'))
  await act(async () => {})
  expect(screen.queryByRole('button', { name: 'detail.back' })).toBeNull()
  expect(screen.getByRole('button', { name: 'a.md' })).toBeTruthy()
})

describe('WorkspaceView root defaulting', () => {
  it('lands on the session workspace when nothing is remembered', () => {
    const { props, instance } = makeProps({ byId: { [SESSION]: { cwd: WORKSPACE } } })
    render(<WorkspaceView {...props} />)
    expect(instance.getSnapshot().root).toBe(WORKSPACE)
  })

  it('restores the remembered root even when the workspace is known', () => {
    rememberLocalRoot(SESSION, '/tmp/elsewhere')
    const { props, instance } = makeProps({ byId: { [SESSION]: { cwd: WORKSPACE } } })
    render(<WorkspaceView {...props} />)
    expect(instance.getSnapshot().root).toBe('/tmp/elsewhere')
  })

  it('stays empty while the session row is unloaded, then fills in when it arrives', () => {
    const { props, instance, box } = makeProps({ byId: {} })
    const { rerender } = render(<WorkspaceView {...props} />)
    expect(instance.getSnapshot().root).toBe('')
    box.sessions = { byId: { [SESSION]: { cwd: WORKSPACE } } }
    rerender(<WorkspaceView {...props} />)
    expect(instance.getSnapshot().root).toBe(WORKSPACE)
  })

  it('never overrides a manual choice when the session row arrives late', () => {
    const { props, instance, box } = makeProps({ byId: {} })
    const { rerender } = render(<WorkspaceView {...props} />)
    instance.actions.setRoot('/tmp/manual')
    box.sessions = { byId: { [SESSION]: { cwd: WORKSPACE } } }
    rerender(<WorkspaceView {...props} />)
    expect(instance.getSnapshot().root).toBe('/tmp/manual')
  })
})

describe('WorkspaceView breadcrumb', () => {
  it('renders the current segment as plain text, not a button (no pill state)', () => {
    const { props } = makeProps({ byId: { [SESSION]: { cwd: WORKSPACE } } })
    render(<WorkspaceView {...props} />)
    // Root /work/repo → crumbs "work" (button) and "repo" (current, a span).
    expect(screen.getByRole('button', { name: 'work' })).toBeTruthy()
    const current = screen.getByText('repo')
    expect(current.tagName).toBe('SPAN')
  })
})

describe('WorkspaceView back-to-workspace', () => {
  it('shows the button only while the current root differs from the workspace', () => {
    rememberLocalRoot(SESSION, '/tmp/elsewhere')
    const { props } = makeProps({ byId: { [SESSION]: { cwd: WORKSPACE } } })
    render(<WorkspaceView {...props} />)
    expect(screen.queryByTitle('local.backToWorkspace')).not.toBeNull()
  })

  it('hides the button when the current root IS the workspace', () => {
    const { props } = makeProps({ byId: { [SESSION]: { cwd: WORKSPACE } } })
    render(<WorkspaceView {...props} />)
    expect(screen.queryByTitle('local.backToWorkspace')).toBeNull()
  })

  it('re-roots to the workspace and remembers the choice on click', () => {
    rememberLocalRoot(SESSION, '/tmp/elsewhere')
    const { props, instance } = makeProps({ byId: { [SESSION]: { cwd: WORKSPACE } } })
    render(<WorkspaceView {...props} />)
    fireEvent.click(screen.getByTitle('local.backToWorkspace'))
    expect(instance.getSnapshot().root).toBe(WORKSPACE)
    expect(localRootOf(SESSION)).toBe(WORKSPACE)
  })
})

describe('WorkspaceView reload gesture', () => {
  const FILE = '/work/repo/a.md'

  it('re-reads the selected file through the Remote and shows the fresh content', async () => {
    const readFile = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { path: FILE, kind: 'text', content: 'old draft' } })
      .mockResolvedValueOnce({ ok: true, value: { path: FILE, kind: 'text', content: 'new draft' } })
    const { props, instance } = makeProps({ byId: { [SESSION]: { cwd: WORKSPACE } } })
    props.readFile = readFile as never
    render(<WorkspaceView {...props} />)
    act(() => { instance.actions.select(FILE) })
    await act(async () => {})
    expect(readFile).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain('old draft')

    fireEvent.click(screen.getByRole('button', { name: 'action.reload' }))
    await act(async () => {})
    expect(readFile).toHaveBeenCalledTimes(2)
    expect(readFile).toHaveBeenLastCalledWith({ path: FILE })
    expect(document.body.textContent).toContain('new draft')
  })

  it('keeps the old read in state and reports the failure through the error slot', async () => {
    const readFile = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { path: FILE, kind: 'text', content: 'old draft' } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'io', message: 'disk gone' } })
    const { props, instance } = makeProps({ byId: { [SESSION]: { cwd: WORKSPACE } } })
    props.readFile = readFile as never
    render(<WorkspaceView {...props} />)
    act(() => { instance.actions.select(FILE) })
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: 'action.reload' }))
    await act(async () => {})
    // The stored read is not wiped by a failed reload; the failure surfaces
    // through the package's shared error slot (the tree column AND the pane
    // both print it — the existing convention for any failed read).
    expect(instance.getSnapshot().preview).toMatchObject({ kind: 'text', content: 'old draft' })
    expect(instance.getSnapshot().error).toBe('disk gone')
    expect(screen.getAllByText('state.error').length).toBeGreaterThan(0)
  })
})

it('shows loading while a selected file is pending instead of asking for a selection', async () => {
  const { props } = makeProps({ byId: { [SESSION]: { cwd: WORKSPACE } } })
  props.listDirectory = vi.fn().mockResolvedValue({ ok: true, value: { entries: [{ name: 'slow.md', isDir: false }] } })
  let finish!: (value: unknown) => void
  props.readFile = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve }))
  render(<WorkspaceView {...props}/>)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'slow.md' }))
  expect(screen.getByText('state.loading')).toBeTruthy()
  expect(screen.queryByText('detail.noSelection')).toBeNull()
  await act(async () => finish({ ok: true, value: { kind: 'text', path: `${WORKSPACE}/slow.md`, content: 'Loaded file' } }))
  expect(screen.getByText('Loaded file')).toBeTruthy()
})

describe('WorkspaceView filename search', () => {
  const HITS = {
    ok: true,
    value: {
      path: WORKSPACE,
      truncated: false,
      entries: [
        { path: 'docs/guide', isDir: true, nameMatch: false },
        { path: 'docs/guide/intro.md', isDir: false, nameMatch: true },
      ],
    },
  }

  it('filters the tree to name hits with ancestors force-expanded, then restores', async () => {
    const { props } = makeProps({ byId: { [SESSION]: { cwd: WORKSPACE } } })
    props.listDirectory = vi.fn().mockResolvedValue({ ok: true, value: { entries: [{ name: 'docs', isDir: true }, { name: 'top.md', isDir: false }] } })
    const searchFiles = vi.fn().mockResolvedValue(HITS)
    props.searchFiles = searchFiles as never
    render(<WorkspaceView {...props} />)
    await act(async () => {})
    // Normal mode renders only the first level.
    expect(screen.getByRole('button', { name: 'docs' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'top.md' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'intro.md' })).toBeNull()

    fireEvent.click(screen.getByTitle('tree.search'))
    fireEvent.change(screen.getByPlaceholderText('tree.searchPlaceholder'), { target: { value: 'intro' } })
    // The search is debounced (200ms) before the Remote round-trip.
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 300) }) })
    expect(searchFiles).toHaveBeenCalledWith({ path: WORKSPACE, query: 'intro', includeHidden: false })
    // The hit's ancestor chain renders expanded with no clicking; a
    // non-matching root row is filtered out.
    expect(screen.getByRole('button', { name: 'intro.md' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'guide' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'docs' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'top.md' })).toBeNull()

    // Clearing the query restores the plain tree.
    fireEvent.change(screen.getByPlaceholderText('tree.searchPlaceholder'), { target: { value: '' } })
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'top.md' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'intro.md' })).toBeNull()
  })

  it('shows the no-match state when nothing matches', async () => {
    const { props } = makeProps({ byId: { [SESSION]: { cwd: WORKSPACE } } })
    props.listDirectory = vi.fn().mockResolvedValue({ ok: true, value: { entries: [{ name: 'top.md', isDir: false }] } })
    props.searchFiles = vi.fn().mockResolvedValue({ ok: true, value: { path: WORKSPACE, truncated: false, entries: [] } }) as never
    render(<WorkspaceView {...props} />)
    await act(async () => {})
    fireEvent.click(screen.getByTitle('tree.search'))
    fireEvent.change(screen.getByPlaceholderText('tree.searchPlaceholder'), { target: { value: 'zzz' } })
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 300) }) })
    expect(screen.getByText('tree.searchNoMatch')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'top.md' })).toBeNull()
  })
})

describe('WorkspaceView search expansion', () => {
  it('starts name-hit folders collapsed, name-hit files revealed, and rows toggle freely', async () => {
    const { props } = makeProps({ byId: { [SESSION]: { cwd: WORKSPACE } } })
    props.listDirectory = vi.fn().mockResolvedValue({ ok: true, value: { entries: [{ name: 'docs', isDir: true }] } })
    props.searchFiles = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        path: WORKSPACE,
        truncated: false,
        entries: [
          // A name-hit folder whose contents matched only through the path.
          { path: 'docs/web-eval', isDir: true, nameMatch: true },
          { path: 'docs/web-eval/restart.sh', isDir: false, nameMatch: false },
          // A name-hit file buried under a plain ancestor chain.
          { path: 'docs/deep/intro.md', isDir: false, nameMatch: true },
        ],
      },
    }) as never
    render(<WorkspaceView {...props} />)
    await act(async () => {})
    fireEvent.click(screen.getByTitle('tree.search'))
    fireEvent.change(screen.getByPlaceholderText('tree.searchPlaceholder'), { target: { value: 'eval' } })
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 300) }) })

    // The ancestor chain is open; the name-hit folder starts collapsed; the
    // name-hit file's chain starts open.
    expect(screen.getByRole('button', { name: 'web-eval' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'restart.sh' })).toBeNull()
    expect(screen.getByRole('button', { name: 'intro.md' })).toBeTruthy()

    // Rows toggle freely: open the hit folder, fold the revealed chain.
    fireEvent.click(screen.getByRole('button', { name: 'web-eval' }))
    expect(screen.getByRole('button', { name: 'restart.sh' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'deep' }))
    expect(screen.queryByRole('button', { name: 'intro.md' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'deep' }))
    expect(screen.getByRole('button', { name: 'intro.md' })).toBeTruthy()
  })

  it('re-seeds the expansion when a fresh hit set lands', async () => {
    const { props } = makeProps({ byId: { [SESSION]: { cwd: WORKSPACE } } })
    props.listDirectory = vi.fn().mockResolvedValue({ ok: true, value: { entries: [{ name: 'docs', isDir: true }] } })
    const searchFiles = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { path: WORKSPACE, truncated: false, entries: [{ path: 'docs/guide/intro.md', isDir: false, nameMatch: true }] },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { path: WORKSPACE, truncated: false, entries: [{ path: 'docs/web-eval', isDir: true, nameMatch: true }] },
      })
    props.searchFiles = searchFiles as never
    render(<WorkspaceView {...props} />)
    await act(async () => {})
    fireEvent.click(screen.getByTitle('tree.search'))
    fireEvent.change(screen.getByPlaceholderText('tree.searchPlaceholder'), { target: { value: 'intro' } })
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 300) }) })
    // Fold the revealed chain, then change the query: the fresh answer
    // re-seeds instead of keeping the fold.
    fireEvent.click(screen.getByRole('button', { name: 'guide' }))
    expect(screen.queryByRole('button', { name: 'intro.md' })).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('tree.searchPlaceholder'), { target: { value: 'eval' } })
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 300) }) })
    expect(screen.getByRole('button', { name: 'web-eval' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'intro.md' })).toBeNull()
  })
})

describe('WorkspaceView compact header (panel-responsive-spec P1)', () => {
  it('folds the home prefix into one navigable ~ segment only when asked', () => {
    expect(crumbsOf('/home/user/code/Writing', true)).toEqual([
      { label: '~', path: '/home/user' }, { label: 'code', path: '/home/user/code' }, { label: 'Writing', path: '/home/user/code/Writing' },
    ])
    expect(crumbsOf('/home/user', true)).toEqual([{ label: '~', path: '/home/user' }])
    expect(crumbsOf('/home/user/code', false).map(crumb => crumb.label)).toEqual(['home', 'user', 'code'])
    expect(crumbsOf('/work/repo', true).map(crumb => crumb.label)).toEqual(['work', 'repo'])
    expect(crumbsOf('', true)).toEqual([])
  })

  it('merges the breadcrumb and tree headers into one row, and gives it up while a file is open', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 390 } as DOMRect)
    const { props, instance } = makeProps({ byId: { [SESSION]: { cwd: WORKSPACE } } })
    props.listDirectory = vi.fn().mockResolvedValue({ ok: true, value: { entries: [{ name: 'a.md', isDir: false }] } })
    props.readFile = vi.fn().mockResolvedValue({ ok: true, value: { path: `${WORKSPACE}/a.md`, kind: 'text', content: '# A' } })
    render(<WorkspaceView {...props} />)
    await act(async () => {})
    // One header: the trail is the title, search inline, no tree title strip, no up arrow.
    expect(screen.getByText('repo')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'local.goUp' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'tree.search' }))
    expect(screen.getByRole('searchbox', { name: 'tree.searchPlaceholder' })).toBeTruthy()
    // Every ancestor segment climbs straight to that folder.
    fireEvent.click(screen.getByRole('button', { name: 'work' }))
    expect(instance.getSnapshot().root).toBe('/work')
    act(() => instance.actions.setRoot(WORKSPACE))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'a.md' }))
    await act(async () => {})
    // The open file owns the only header row, back included.
    expect(screen.queryByRole('button', { name: 'work' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'detail.back' })).toHaveLength(1)
  })
})

