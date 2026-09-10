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
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { WorkspaceViewProps } from '../src/client/contract.ts'
import { clearLocalRoot, localRootOf, rememberLocalRoot } from '../src/client/local-root.ts'
import { createLocalFilesStore } from '../src/client/store-local.ts'
import { WorkspaceView } from '../src/client/WorkspaceView.tsx'

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
    pickWorkspace: vi.fn(() => Promise.resolve(null)),
    useOpenInApps: ((sel: (s: readonly string[] | null) => unknown) => sel([])) as never,
    openFolder: vi.fn(),
    openIDE: vi.fn(),
  } as unknown as WorkspaceViewProps
  return { props, instance, box, listDirectory }
}

afterEach(() => {
  cleanup()
  clearLocalRoot(SESSION)
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
