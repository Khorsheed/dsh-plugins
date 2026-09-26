// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { MobileChrome } from '../src/client/MobileChrome.tsx'
import type { MobileChromeInjected } from '../src/client/MobileChrome.tsx'
import { MobileLibrary } from '../src/client/MobileLibrary.tsx'
import { GROUPING_KEY, groupSessions, MobileNavigation, recentSessions } from '../src/client/navigation.ts'
import type { NavigationCapabilities } from '../src/client/navigation.ts'
import { en } from '../src/client/locales.ts'

beforeEach(() => { vi.stubGlobal('innerWidth', 393) })
afterEach(() => { vi.unstubAllGlobals() })
afterEach(() => { cleanup(); localStorage.clear(); delete window.__DSH_MOBILE_SHELL__; delete window.webkit })
const t = (key: keyof typeof en) => en[key]
function row(id: string, more: Partial<SessionSummary> = {}): SessionSummary {
  return { id, displayTitle: id, blank: false, running: false, updatedAt: 1, ...more } as SessionSummary
}
function list(rows: SessionSummary[], current?: string): SessionListState {
  const byId = Object.fromEntries(rows.map(r => [r.id, r]))
  // alpha.2 marks the main-view session as a per-row retain count; 0.1.5 carried the list's own `current`.
  if (current !== undefined && byId[current]) byId[current] = { ...byId[current], retainedBy: { mainView: 1 } }
  return { ids: rows.map(r => r.id), byId, phase: 'ready', subagentsByParent: {}, jobsBySession: {} } as SessionListState
}
function fixture() {
  const state = list([row('one', { title: 'First draft', cwd: '/home/user/project' }), row('two', { title: 'Second draft', updatedAt: 2 })])
  const workspaces = { items: [], archivedSessionIds: [] }
  const openSession = vi.fn(), onOpen = vi.fn()
  const navigation = { sessions: { list: { getSnapshot: () => state, subscribe: () => () => {} } }, workspaces: { list: { getSnapshot: () => workspaces, subscribe: () => () => {} } }, workspace: { openSession } } as unknown as NavigationCapabilities
  return { navigation, openSession, onOpen }
}
describe('mobile session navigation', () => {
  it('groups by local calendar boundaries and keeps full workspace identities in recency order', () => {
    const labels = { today: 'today', yesterday: 'yesterday', earlier: 'earlier', workspace: 'unassigned' }
    const today = new Date(2026, 8, 11), yesterday = new Date(2026, 8, 10)
    const rows = [row('a', { cwd: '/home/user/a/project', updatedAt: +today }), row('b', { cwd: '/home/user/b/project', updatedAt: +yesterday }), row('c', { cwd: '/home/user/a/project', updatedAt: +yesterday - 1 })]
    expect(groupSessions(rows, 'time', labels, today).map(g => [g.key, g.rows.map(r => r.id)])).toEqual([['today', ['a']], ['yesterday', ['b']], ['earlier', ['c']]])
    expect(groupSessions(rows, 'workspace', labels, today).map(g => [g.label, g.rows.map(r => r.id)])).toEqual([['/home/user/a/project', ['a', 'c']], ['/home/user/b/project', ['b']]])
  })
  it('remembers grouping and reveals search matches without losing collapsed workspace state', () => {
    const f = fixture()
    const page = render(<MobileLibrary {...f} t={t}/>)
    fireEvent.click(screen.getByRole('button', { name: en.byWorkspace, exact: true }))
    expect(localStorage.getItem(GROUPING_KEY)).toBe('workspace')
    fireEvent.click(screen.getByRole('button', { name: /project/, expanded: true }))
    expect(screen.queryByText('First draft')).toBeNull()
    fireEvent.focus(screen.getByRole('searchbox'))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'first' } })
    expect(screen.getByText('First draft')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(screen.queryByText('First draft')).toBeNull()
    page.unmount()
    render(<MobileLibrary {...f} t={t}/>)
    expect(screen.getByRole('button', { name: en.byWorkspace, exact: true }).getAttribute('aria-pressed')).toBe('true')
  })
  it('shows native scanning only on a capable shell and substitutes cancel while searching', () => {
    const f = fixture(), postMessage = vi.fn()
    const page = render(<MobileLibrary {...f} t={t}/>)
    expect(screen.queryByRole('button', { name: en.scan })).toBeNull()
    window.__DSH_MOBILE_SHELL__ = { bridgeVersion: 1, capabilities: ['scan'] }
    window.webkit = { messageHandlers: { dshMobile: { postMessage } } }
    page.rerender(<MobileLibrary {...f} t={t}/>)
    fireEvent.click(screen.getByRole('button', { name: en.scan }))
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'scan', bridgeVersion: 1 })
    fireEvent.focus(screen.getByRole('searchbox'))
    expect(screen.queryByRole('button', { name: en.scan })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(screen.getByRole('button', { name: en.scan })).toBeTruthy()
  })
  it('keeps archived, unselected blanks and addressed children out of ordinary recents without changing Host order', () => {
    const state = list([row('old'), row('archived'), row('blank', { blank: true }), row('child', { origin: 'subagent' }), row('current', { blank: true, updatedAt: 3 }), row('new', { updatedAt: 2 }), row('fork', { parentId: 'old' as SessionSummary['id'], updatedAt: 4 })], 'current')
    const original = [...state.ids]
    expect(recentSessions(state, ['archived'], '').map(r => r.id)).toEqual(['fork', 'current', 'new', 'old'])
    expect(state.ids).toEqual(original)
  })
  it('keeps the selected blank visible through the 0.1.5 list `current` read as well', () => {
    const state = { ...list([row('current', { blank: true, updatedAt: 2 }), row('new', { updatedAt: 1 })]), current: 'current' } as SessionListState
    expect(recentSessions(state, [], '').map(r => r.id)).toEqual(['current', 'new'])
  })
  it('filters metadata and delegates selection to the official navigation owner exactly once', () => {
    const f = fixture()
    render(<MobileLibrary {...f} t={t} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'PROJECT' } })
    expect(screen.queryByText('Second draft')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /First draft/ }))
    expect(f.openSession).toHaveBeenCalledExactlyOnceWith('one')
    expect(f.onOpen).toHaveBeenCalledOnce()
  })
  it('retains navigation on owner failure and presents a retryable error', () => {
    const f = fixture(); f.openSession.mockImplementation(() => { throw Error('fixture failure') })
    render(<MobileLibrary {...f} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /First draft/ }))
    expect(screen.getByRole('alert').textContent).toBe(en.navigationError)
    expect(f.onOpen).not.toHaveBeenCalled()
  })
  it('preserves official feed receivers, observes archive updates and releases subscriptions', () => {
    class Feed<T> {
      listeners = new Set<() => void>()
      constructor(public value: T) {}
      getSnapshot() { return this.value }
      subscribe(listener: () => void) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      }
      set(value: T) { this.value = value; for (const listener of this.listeners) listener() }
    }
    const f = fixture()
    const sessions = new Feed(f.navigation.sessions.list.getSnapshot())
    const workspaces = new Feed(f.navigation.workspaces.list.getSnapshot())
    const navigation = { ...f.navigation, sessions: { list: sessions }, workspaces: { list: workspaces } } as unknown as NavigationCapabilities
    const page = render(<MobileLibrary {...f} navigation={navigation} t={t} />)
    expect(screen.getByRole('button', { name: /First draft/ })).toBeTruthy()
    act(() => workspaces.set({ ...workspaces.value, archivedSessionIds: ['one'] as typeof workspaces.value.archivedSessionIds }))
    expect(screen.queryByRole('button', { name: /First draft/ })).toBeNull()
    expect(sessions.listeners.size).toBe(1)
    expect(workspaces.listeners.size).toBe(1)
    page.unmount()
    expect(sessions.listeners.size).toBe(0)
    expect(workspaces.listeners.size).toBe(0)
  })
  it('notifies removal of optional official services and releases subscribers', () => {
    const source = new MobileNavigation(), changed = vi.fn(), f = fixture()
    const dispose = source.subscribe(changed)
    source.set(f.navigation); source.set(undefined)
    expect(source.getSnapshot()).toBeUndefined(); expect(changed).toHaveBeenCalledTimes(2)
    dispose(); source.set(f.navigation); expect(changed).toHaveBeenCalledTimes(2)
  })
  it('keeps the official editor mounted while browsing and restores it when optional navigation disappears', () => {
    const f = fixture(), navigation = new MobileNavigation()
    navigation.set(f.navigation)
    const snapshot = { active: true, drawer: false, supported: true, mode: 'mobile' }
    const props = {
      navigation, toggleSidebar: vi.fn(),
      presentation: { prepareNavigation: vi.fn(), getSnapshot: () => snapshot, subscribe: () => () => {} },
      connection: { state: { getSnapshot: () => 'connected', subscribe: () => () => {} } },
    } as unknown as MobileChromeInjected
    HTMLDialogElement.prototype.close = function () { this.open = false }
    const page = render(<div data-mobile-frame><div data-testid="official-main"><div data-slot="main"><textarea defaultValue="unsent draft" /></div></div><MobileChrome {...props} t={t}/></div>)
    const editor = page.container.querySelector('textarea')!
    const main = screen.getByTestId('official-main')
    expect(main.inert).toBe(true)
    vi.mocked(props.presentation.prepareNavigation).mockClear()
    fireEvent.click(screen.getByRole('button', { name: en.returnToConversation }))
    expect(main.inert).toBeFalsy()
    expect(document.documentElement.hasAttribute('data-mobile-library-open')).toBe(false)
    expect(page.container.querySelector('textarea')).toBe(editor)
    expect(editor.value).toBe('unsent draft')
    expect(document.activeElement).not.toBe(editor)
    expect(f.openSession).not.toHaveBeenCalled()
    expect(props.presentation.prepareNavigation).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Conversations', exact: true }))
    act(() => { vi.stubGlobal('innerWidth', 1024); window.dispatchEvent(new Event('resize')) })
    expect(screen.queryByRole('button', { name: en.returnToConversation })).toBeNull()
    expect(main.inert).toBeFalsy()
    act(() => { vi.stubGlobal('innerWidth', 393); window.dispatchEvent(new Event('resize')) })
    expect(main.inert).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /First draft/ }))
    expect(page.container.querySelector('textarea')).toBe(editor)
    expect(editor.value).toBe('unsent draft')
    expect(main.inert).toBeFalsy()
    fireEvent.click(screen.getByRole('button', { name: 'Conversations', exact: true }))
    expect(main.inert).toBe(true)
    act(() => navigation.set(undefined))
    expect(main.inert).toBeFalsy()
    expect(screen.queryByRole('heading', { name: en.menu })).toBeNull()
    expect(editor.value).toBe('unsent draft')
  })

  it('routes library settings to the native sheet and keeps chat back/new separate', () => {
    const f = fixture(), navigation = new MobileNavigation(), postMessage = vi.fn(), startSession = vi.fn()
    navigation.set({ ...f.navigation, workspace: { ...f.navigation.workspace, startSession } })
    window.__DSH_MOBILE_SHELL__ = { bridgeVersion: 1, capabilities: ['settings'] }
    window.webkit = { messageHandlers: { dshMobile: { postMessage } } }
    const snapshot = { active: true, drawer: false, supported: true, mode: 'mobile' }
    const props = {
      navigation, toggleSidebar: vi.fn(),
      presentation: { prepareNavigation: vi.fn(), getSnapshot: () => snapshot, subscribe: () => () => {} },
      connection: { state: { getSnapshot: () => 'connected', subscribe: () => () => {} } },
    } as unknown as MobileChromeInjected
    render(<MobileChrome {...props} t={t}/>)
    fireEvent.click(screen.getByRole('button', { name: en.settings }))
    expect(postMessage).toHaveBeenCalledWith({ type: 'settings', bridgeVersion: 1 })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /First draft/ }))
    expect(screen.queryByRole('button', { name: en.options })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.newSession }))
    expect(startSession).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: en.menu, exact: true }))
    expect(screen.getByRole('button', { name: en.settings })).toBeTruthy()
  })

})

describe('cold mobile catalog enrichment', () => {
  it('hydrates a visible cold title through the official projection store without opening it', async () => {
    const f = fixture()
    let state = list([row('cold', { cwd: '/home/user/project', displayTitle: 'project' })])
    const listeners = new Set<() => void>()
    const refreshProjections = vi.fn(async () => {
      state = list([row('cold', { cwd: '/home/user/project', displayTitle: 'Saved conversation', title: 'Saved conversation' })])
      for (const listener of listeners) listener()
    })
    const sessions = { list: { getSnapshot: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } }, refreshProjections }
    const navigation = { ...f.navigation, sessions } as unknown as NavigationCapabilities
    await act(async () => { render(<MobileLibrary navigation={navigation} onOpen={f.onOpen} t={t}/>) })
    expect(refreshProjections).toHaveBeenCalledExactlyOnceWith('cold')
    expect(screen.getByText('Saved conversation')).toBeTruthy()
    expect(f.openSession).not.toHaveBeenCalled()
  })
  it('does no catalog enrichment while the library is hidden and cancels offscreen queued reads', async () => {
    const f = fixture()
    const callbacks: IntersectionObserverCallback[] = []
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { callbacks.push(callback) }
      observe() {} disconnect() {}
    })
    const refreshProjections = vi.fn(() => new Promise<void>(() => {}))
    const state = list(Array.from({ length: 8 }, (_, i) => row(String(i), { displayTitle: 'project' })))
    const navigation = { ...f.navigation, sessions: { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections } } as unknown as NavigationCapabilities
    const page = render(<MobileLibrary navigation={navigation} onOpen={f.onOpen} t={t} visible={false}/>)
    expect(callbacks).toHaveLength(0)
    expect(refreshProjections).not.toHaveBeenCalled()
    page.rerender(<MobileLibrary navigation={navigation} onOpen={f.onOpen} t={t} visible/>)
    await act(async () => {
      for (const callback of callbacks) callback([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver)
    })
    expect(refreshProjections).toHaveBeenCalledTimes(2)
    page.unmount()
  })
})
