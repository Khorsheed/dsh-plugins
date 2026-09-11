// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
afterEach(() => { active.splice(0).forEach(p => p.dispose()); vi.unstubAllGlobals(); document.body.innerHTML = '' })

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
})
