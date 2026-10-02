// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MobilePanels, type MobilePanelService, type MobilePanelTab } from '../src/client/panels.ts'
import { MobilePanelEntry, MobilePanelNavigation } from '../src/client/MobilePanelNavigation.tsx'
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
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'canvas' } })
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
