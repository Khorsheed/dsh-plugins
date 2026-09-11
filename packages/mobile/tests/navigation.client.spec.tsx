// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { MobileChrome } from '../src/client/MobileChrome.tsx'
import type { MobileChromeInjected } from '../src/client/MobileChrome.tsx'
import { MobileLibrary } from '../src/client/MobileLibrary.tsx'
import { MobileNavigation, recentSessions } from '../src/client/navigation.ts'
import type { NavigationCapabilities } from '../src/client/navigation.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const t = (key: keyof typeof en) => en[key]
function row(id: string, more: Partial<SessionSummary> = {}): SessionSummary {
  return { id, displayTitle: id, blank: false, running: false, updatedAt: 1, ...more } as SessionSummary
}
function list(rows: SessionSummary[], current?: string): SessionListState {
  return { ids: rows.map(r => r.id), byId: Object.fromEntries(rows.map(r => [r.id, r])), current, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined } as SessionListState
}
function fixture() {
  const state = list([row('one', { title: 'First draft', cwd: '/home/user/project' }), row('two', { title: 'Second draft', updatedAt: 2 })])
  const workspaces = { items: [], archivedSessionIds: [] }
  const openSession = vi.fn(), onOpen = vi.fn()
  const navigation = { sessions: { list: { getSnapshot: () => state, subscribe: () => () => {} } }, workspaces: { list: { getSnapshot: () => workspaces, subscribe: () => () => {} } }, workspace: { openSession } } as unknown as NavigationCapabilities
  return { navigation, openSession, onOpen }
}
describe('mobile session navigation', () => {
  it('keeps archived, unselected blanks and addressed children out of ordinary recents without changing Host order', () => {
    const state = list([row('old'), row('archived'), row('blank', { blank: true }), row('child', { origin: 'subagent' }), row('current', { blank: true, updatedAt: 3 }), row('new', { updatedAt: 2 }), row('fork', { parentId: 'old' as SessionSummary['id'], updatedAt: 4 })], 'current')
    const original = [...state.ids]
    expect(recentSessions(state, ['archived'], '').map(r => r.id)).toEqual(['fork', 'current', 'new', 'old'])
    expect(state.ids).toEqual(original)
  })
  it('filters metadata and delegates selection to the official navigation owner exactly once', () => {
    const f = fixture()
    render(<MobileLibrary {...f} t={t} onNew={vi.fn()} onSettings={vi.fn()} onWorkspaces={vi.fn()} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'PROJECT' } })
    expect(screen.queryByText('Second draft')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /First draft/ }))
    expect(f.openSession).toHaveBeenCalledExactlyOnceWith('one')
    expect(f.onOpen).toHaveBeenCalledOnce()
  })
  it('retains navigation on owner failure and presents a retryable error', () => {
    const f = fixture(); f.openSession.mockImplementation(() => { throw Error('fixture failure') })
    render(<MobileLibrary {...f} t={t} onNew={vi.fn()} onSettings={vi.fn()} onWorkspaces={vi.fn()} />)
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
    const page = render(<MobileLibrary {...f} navigation={navigation} t={t} onNew={vi.fn()} onSettings={vi.fn()} onWorkspaces={vi.fn()} />)
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
      presentation: { getSnapshot: () => snapshot, subscribe: () => () => {} },
      connection: { state: { getSnapshot: () => 'connected', subscribe: () => () => {} } },
    } as unknown as MobileChromeInjected
    HTMLDialogElement.prototype.close = function () { this.open = false }
    const page = render(<div data-mobile-frame><div data-testid="official-main"><div data-slot="main"><textarea defaultValue="unsent draft" /></div></div><MobileChrome {...props} t={t}/></div>)
    const editor = page.container.querySelector('textarea')!
    const main = screen.getByTestId('official-main')
    expect(main.inert).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /First draft/ }))
    expect(page.container.querySelector('textarea')).toBe(editor)
    expect(editor.value).toBe('unsent draft')
    expect(main.inert).toBeFalsy()
    fireEvent.click(screen.getByRole('button', { name: 'Conversations', exact: true }))
    expect(main.inert).toBe(true)
    act(() => navigation.set(undefined))
    expect(main.inert).toBeFalsy()
    expect(screen.queryByRole('heading', { name: en.libraryTitle })).toBeNull()
    expect(editor.value).toBe('unsent draft')
  })

})
