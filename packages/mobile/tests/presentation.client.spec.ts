// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORDINARY_TITLE } from '../src/client/styles.ts'
import { createElement } from 'react'
import { render, fireEvent, screen, cleanup } from '@testing-library/react'
import { MobileChrome } from '../src/client/MobileChrome.tsx'
import type { MobileChromeInjected } from '../src/client/MobileChrome.tsx'
import { MobileNavigation } from '../src/client/navigation.ts'
import { en } from '../src/client/locales.ts'
import { MobilePresentation } from '../src/client/presentation.ts'

const frameHTML = `<div data-slot="root"><div data-sidebar-collapsed>
  <div><div data-slot="sidebar"><button>Existing navigation</button></div></div>
  <div><div data-slot="main"><div data-slot="main.conversation"><div><textarea>draft</textarea></div></div></div></div>
  <div data-rightbar-col></div><div data-shell-overlay></div>
</div></div>`
const active: MobilePresentation[] = []
const match = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
function mount(shell = false) { const p = new MobilePresentation(window, shell); active.push(p); return p }
async function update() { await new Promise(resolve => setTimeout(resolve, 40)) }

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
  document.body.innerHTML = frameHTML
  vi.stubGlobal('matchMedia', vi.fn(() => match))
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => window.setTimeout(() => fn(0), 0))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
})
afterEach(() => { cleanup(); active.splice(0).forEach(p => p.dispose()); vi.unstubAllGlobals(); document.body.innerHTML = '' })

describe('mobile presentation ownership', () => {
  it('leaves a normal desktop document and its official navigation unchanged', () => {
    const original = document.body.innerHTML
    const p = mount()
    expect(p.getSnapshot().active).toBe(false)
    expect(document.body.innerHTML).toBe(original)
    expect(document.documentElement.hasAttribute('data-dsh-mobile')).toBe(false)
  })
  it('activates in a native shell and restores the same draft and DOM on disposal', () => {
    const textarea = document.querySelector('textarea')!
    textarea.value = 'unfinished text'
    const p = mount(true)
    expect(p.getSnapshot().active).toBe(true)
    expect(document.querySelector('[data-mobile-frame]')).not.toBeNull()
    p.dispose()
    expect(document.querySelector('textarea')).toBe(textarea)
    expect(textarea.value).toBe('unfinished text')
    expect(document.querySelector('[data-mobile-frame]')).toBeNull()
    expect(document.querySelector('[data-mobile-owned]')).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--mobile-height')).toBe('')
  })
  it('falls back when the official frame is unavailable, and recovers after late mount', async () => {
    document.body.innerHTML = '<main>Unrelated client</main>'
    const p = mount(true)
    expect(p.getSnapshot()).toMatchObject({ active: false, supported: false })
    document.body.innerHTML = frameHTML
    await update()
    expect(p.getSnapshot()).toMatchObject({ active: true, supported: true })
    document.querySelector('[data-shell-overlay]')!.remove()
    await update()
    expect(p.getSnapshot().active).toBe(false)
  })
  it('observes official sidebar state without rewriting layout or storage', async () => {
    const p = mount(true)
    const frame = document.querySelector('[data-mobile-frame]')!
    frame.removeAttribute('data-sidebar-collapsed')
    await update()
    expect(p.getSnapshot().drawer).toBe(true)
    expect(localStorage.length).toBe(0)
    frame.setAttribute('data-sidebar-collapsed', '')
    await update()
    expect(p.getSnapshot().drawer).toBe(false)
  })
  it('can turn off in-place and remember only its own preference', () => {
    const p = mount(true)
    const draft = document.querySelector('textarea')
    p.setMode('desktop')
    expect(p.getSnapshot().active).toBe(false)
    expect(document.querySelector('textarea')).toBe(draft)
    expect(localStorage.getItem('dsh.mobile.display')).toBe('desktop')
    p.dispose()
    expect(mount(true).getSnapshot().active).toBe(false)
  })
  it('reinstalling contributes exactly one style and stops all callbacks after removal', async () => {
    const old = mount(true)
    const listener = vi.fn()
    old.subscribe(listener)
    old.dispose()
    mount(true)
    expect(document.querySelectorAll('[data-mobile-owned="styles"]')).toHaveLength(1)
    document.body.innerHTML = frameHTML
    await update()
    expect(listener).not.toHaveBeenCalled()
  })
  it('keeps a return control after closing desktop options and across a reload', () => {
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
    HTMLDialogElement.prototype.close = function () { this.open = false }
    const mountChrome = (p: MobilePresentation) => render(createElement(MobileChrome, {
      presentation: p, navigation: new MobileNavigation(), toggleSidebar: vi.fn(),
      connection: { state: { subscribe: () => () => {}, getSnapshot: () => 'connected' } },
      t: (key: keyof typeof en) => en[key],
    } as MobileChromeInjected & { t: (key: keyof typeof en) => string }))
    const p = mount(true), page = mountChrome(p)
    fireEvent.click(screen.getByRole('button', { name: en.options }))
    fireEvent.click(screen.getByRole('button', { name: en.desktop, exact: true }))
    fireEvent.click(screen.getByRole('button', { name: en.done }))
    expect(screen.getByRole('button', { name: en.restoreMobile })).toBeTruthy()
    page.unmount(); p.dispose()
    const next = mount(true)
    mountChrome(next)
    fireEvent.click(screen.getByRole('button', { name: en.restoreMobile }))
    expect(next.getSnapshot().active).toBe(true)
    expect(localStorage.getItem('dsh.mobile.display')).toBe('mobile')
    expect(screen.queryByRole('button', { name: en.restoreMobile })).toBeNull()
  })
  it('suppresses entry autofocus but allows tapping, message actions and keyboard navigation without losing drafts', () => {
    const main = document.querySelector('[data-slot="main"]')!
    main.innerHTML = '<div data-composer-card><div contenteditable="true" tabindex="0">unsent draft</div></div><div data-conversation-scroll><button>Edit</button></div>'
    const editor = main.querySelector<HTMLElement>('[contenteditable]')!
    const p = mount(true)
    editor.focus()
    expect(document.activeElement).not.toBe(editor)
    fireEvent.pointerDown(editor); editor.focus()
    expect(document.activeElement).toBe(editor)
    p.prepareNavigation(); editor.focus()
    expect(document.activeElement).not.toBe(editor)
    fireEvent.pointerDown(main.querySelector('button')!); editor.focus()
    expect(document.activeElement).toBe(editor)
    p.prepareNavigation(); fireEvent.keyDown(document.body, { key: 'Tab' }); editor.focus()
    expect(document.activeElement).toBe(editor)
    p.prepareNavigation(); p.setMode('desktop'); editor.focus()
    expect(document.activeElement).toBe(editor)
    p.setMode('mobile'); p.prepareNavigation(); p.dispose(); editor.focus()
    expect(document.activeElement).toBe(editor)
    expect(editor.textContent).toBe('unsent draft')
  })

  it('deduplicates only an ordinary title, retaining contributed lineage and ancestor navigation', () => {
    const main = document.querySelector('[data-slot="main.conversation"]')!
    main.innerHTML = '<header><div><nav><span><button disabled>Title</button><div data-slot="conversation.session.header.lineage"></div></span></nav><div data-slot="conversation.session.header.actions"><button>Preset</button></div><div data-conversation-header-corner></div></div><div role="tablist">Conversation / Trajectory</div></header>'
    const nav = main.querySelector('nav')!
    expect(document.querySelector(ORDINARY_TITLE)).toBe(nav)
    const lineage = nav.querySelector('[data-slot]')!
    lineage.innerHTML = '<button>Agent details</button>'
    expect(document.querySelector(ORDINARY_TITLE)).toBeNull()
    lineage.innerHTML = ''
    nav.insertAdjacentHTML('afterbegin', '<span><button>Parent</button></span>')
    expect(document.querySelector(ORDINARY_TITLE)).toBeNull()
    expect(main.querySelector('[role="tablist"]')!.textContent).toBe('Conversation / Trajectory')
  })

})
