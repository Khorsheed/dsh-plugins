// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MobilePanels, type MobilePanelService, type MobilePanelTab } from '../src/client/panels.ts'
import { MobilePanelEntry, MobilePanelNavigation } from '../src/client/MobilePanelNavigation.tsx'
import { MOBILE_CSS } from '../src/client/styles.ts'
import { en } from '../src/client/locales.ts'

const t = ((key: keyof typeof en) => en[key]) as never
const owned: MobilePanels[] = []
afterEach(() => { cleanup(); for (const panels of owned.splice(0)) panels.dispose(); document.body.innerHTML = '' })
function fixture() {
  document.body.innerHTML = '<div data-sidebar-right-panel="fullscreen" data-sidebar-right-session="s1"><div data-dockkit-host="dock"><textarea>retained draft</textarea></div></div>'
  let expanded = false, active = 'files', session: string | undefined = 's1'
  let tabs: MobilePanelTab[] = [{ id: 'files', title: 'Files', kind: 'files' }, { id: 'canvas', title: 'Canvas', kind: 'canvas' }]
  const listeners = new Set<() => void>()
  const service: MobilePanelService = {
    mounted: { getSnapshot: () => session, subscribe: cb => { listeners.add(cb); return () => { listeners.delete(cb) } } },
    toggleExpanded: vi.fn(() => { expanded = !expanded }), isExpanded: () => expanded,
    active: () => tabs.find(tab => tab.id === active), tabsIn: () => tabs,
    focus: vi.fn(id => { active = id }), close: vi.fn(id => { tabs = tabs.filter(tab => tab.id !== id); active = tabs[0]?.id ?? '' }),
    openTab: vi.fn(() => { tabs = [...tabs, { id: 'guide', title: 'Start', kind: 'guide' }]; active = 'guide' }),
  }
  const panels = new MobilePanels(document); owned.push(panels); panels.set(service)
  return { panels, service, listeners, setSession: (id: string | undefined) => { session = id; for (const listener of listeners) listener() } }
}
it('uses owner operations for open, switch, add, close and return, retaining the existing body', () => {
  const f = fixture(), original = document.querySelector('textarea')
  render(<><MobilePanelEntry panels={f.panels} beforeOpen={() => {}} t={t}/><MobilePanelNavigation panels={f.panels} active prepareNavigation={() => {}} t={t}/></>)
  fireEvent.click(screen.getByRole('button', { name: en.panels }))
  expect(document.documentElement.hasAttribute('data-mobile-panel-open')).toBe(true)
  fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }))
  expect(f.service.focus).toHaveBeenCalledWith('canvas')
  fireEvent.click(screen.getByRole('button', { name: en.addPanel }))
  expect(f.service.openTab).toHaveBeenCalledWith('guide')
  fireEvent.click(screen.getByRole('button', { name: en.closePanel }))
  expect(f.service.close).toHaveBeenCalledWith('guide')
  fireEvent.click(screen.getByRole('button', { name: en.backToChat }))
  expect(document.documentElement.hasAttribute('data-mobile-panel-open')).toBe(false)
  expect(document.querySelector('textarea')).toBe(original)
  expect(original?.value).toBe('retained draft')
})
it('withdraws the replacement when capability or checked anchors disappear', async () => {
  const f = fixture()
  render(<MobilePanelNavigation panels={f.panels} active prepareNavigation={() => {}} t={t}/>)
  expect(document.documentElement.hasAttribute('data-mobile-panel-managed')).toBe(true)
  await act(async () => { document.querySelector('[data-dockkit-host]')!.remove() })
  expect(document.documentElement.hasAttribute('data-mobile-panel-managed')).toBe(false)
  act(() => f.panels.set(undefined))
  expect(f.panels.getSnapshot().available).toBe(false)
  expect(f.listeners.size).toBe(0)
})
it('does not change selection on failed close, and hides when there is no mounted session', () => {
  const f = fixture()
  f.service.close = vi.fn(() => { throw new Error('Owner refused close') })
  f.panels.toggle(); f.panels.close()
  expect(f.panels.getSnapshot()).toMatchObject({ failed: true, activeId: 'files', expanded: true })
  expect(f.panels.getSnapshot().tabs).toHaveLength(2)
  f.setSession(undefined)
  expect(f.panels.getSnapshot().available).toBe(false)
})
it('falls back to native chrome for an older partial service and ignores unknown tab ids', () => {
  const f = fixture()
  f.panels.select('unknown')
  expect(f.service.focus).not.toHaveBeenCalled()
  f.panels.set({ ...f.service, tabsIn: undefined })
  expect(f.panels.getSnapshot()).toMatchObject({ available: true, managed: false })
})

it('moves keyboard focus into the panel and restores chat access on Escape', () => {
  const f = fixture()
  document.body.insertAdjacentHTML('beforeend', '<div data-mobile-frame><div><div data-slot="main"><textarea>chat draft</textarea></div></div></div>')
  render(<><MobilePanelEntry panels={f.panels} beforeOpen={() => {}} t={t}/><MobilePanelNavigation panels={f.panels} active prepareNavigation={() => {}} t={t}/></>)
  const entry = screen.getByRole('button', { name: en.panels })
  fireEvent.click(entry)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: en.backToChat }))
  expect(document.querySelector<HTMLElement>('[data-mobile-frame] > div')!.inert).toBe(true)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(document.querySelector<HTMLElement>('[data-mobile-frame] > div')!.inert).toBe(false)
  expect(document.activeElement).toBe(entry)
})

it('covers a collapsed host track while open and restores native geometry on return', () => {
  const style = document.createElement('style')
  style.textContent = '[data-rightbar-col] { position:relative; }' + MOBILE_CSS
  document.head.append(style)
  document.documentElement.setAttribute('data-dsh-mobile', '')
  document.documentElement.setAttribute('data-mobile-panel-open', '')
  document.body.innerHTML = '<div data-mobile-frame data-rightbar-collapsed><div data-rightbar-col></div></div>'
  const column = document.querySelector<HTMLElement>('[data-rightbar-col]')!
  try {
    const opened = getComputedStyle(column)
    expect(opened.position).toBe('absolute')
    expect(opened.gridArea).toBe('auto')
    expect(opened.width).toBe('100%')
    expect(document.querySelector('[data-rightbar-collapsed]')).not.toBeNull()
    document.documentElement.removeAttribute('data-mobile-panel-open')
    expect(getComputedStyle(column).position).toBe('relative')
  } finally {
    style.remove()
    document.documentElement.removeAttribute('data-dsh-mobile')
    document.documentElement.removeAttribute('data-mobile-panel-open')
  }
})

it('replaces only the native panel entry and removes the unused hero action space', () => {
  const style = document.createElement('style')
  style.textContent = MOBILE_CSS
  document.head.append(style)
  document.documentElement.setAttribute('data-dsh-mobile', '')
  document.body.innerHTML = '<div data-phase="hero"></div><nav data-mobile-toolbar data-library="false"><button data-mobile-panel-entry>Panel</button><button data-mobile-new="true">New</button></nav><button data-sidebar-right-expand>Native panel</button>'
  const native = document.querySelector<HTMLElement>('[data-sidebar-right-expand]')!
  const newButton = document.querySelector<HTMLElement>('[data-mobile-new]')!
  try {
    expect(getComputedStyle(native).display).toBe('none')
    expect(getComputedStyle(newButton).display).toBe('none')
    document.querySelector('[data-mobile-panel-entry]')!.remove()
    expect(getComputedStyle(native).display).not.toBe('none')
    document.querySelector('[data-phase]')!.remove()
    expect(getComputedStyle(newButton).display).not.toBe('none')
    document.documentElement.removeAttribute('data-dsh-mobile')
    expect(getComputedStyle(native).display).not.toBe('none')
  } finally {
    style.remove()
    document.documentElement.removeAttribute('data-dsh-mobile')
  }
})

it('exposes all opened tabs and supports arrow-key selection without a dropdown', () => {
  const f = fixture()
  f.panels.toggle()
  render(<MobilePanelNavigation panels={f.panels} active prepareNavigation={() => {}} t={t}/>)
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.getAllByRole('tab')).toHaveLength(2)
  const files = screen.getByRole('tab', { name: 'Files' })
  expect(files.getAttribute('aria-selected')).toBe('true')
  fireEvent.keyDown(files, { key: 'ArrowRight' })
  const canvas = screen.getByRole('tab', { name: 'Canvas' })
  expect(canvas.getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(canvas)
})

it('does not re-read panel state for streaming text or history node insertion', async () => {
  const f = fixture()
  document.body.insertAdjacentHTML('beforeend', '<div data-conversation-scroll><div data-slot="conversation.session"><p>First</p></div></div>')
  await act(async () => {})
  const read = vi.spyOn(f.service, 'tabsIn')
  await act(async () => {
    const history = document.querySelector('[data-slot="conversation.session"]')!
    history.querySelector('p')!.firstChild!.textContent = 'Next token'
    history.insertAdjacentHTML('beforeend', '<p>Next paragraph</p>')
  })
  expect(read).not.toHaveBeenCalled()
  await act(async () => { document.querySelector('[data-dockkit-host]')!.remove() })
  expect(f.panels.getSnapshot().managed).toBe(false)
})
