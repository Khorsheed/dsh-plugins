// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { MobileSurface } from '../src/client/surface.ts'

const instances: MobileSurface[] = []
afterEach(() => { instances.splice(0).forEach(x => x.dispose()); document.body.innerHTML = '' })
function fixture() {
  document.body.innerHTML = `<div data-mobile-frame><div data-slot="main.conversation"><div data-phase="active">
  <div data-slot="conversation.session.header"><header><div data-test-row><div><nav><span><button disabled>Title</button><div data-slot="conversation.session.header.lineage"></div></span></nav><div data-slot="conversation.session.header.actions"><span>Standard</span><button id="plugin-action">Plugin action</button></div></div><div data-slot="conversation.session.header.utilities"><div><button><img src="/open-in-app/icon/finder"/></button><button>Apps</button></div></div><div data-conversation-header-corner><button>More</button></div></div><div role="tablist"><button role="tab" aria-selected="true">对话</button><button role="tab" aria-selected="false">轨迹</button></div></header></div>
  <div data-conversation-scroll><div data-composer-seat><div data-mobile-context-seat><span>workspace</span></div><div data-composer-card><textarea>Unsent draft</textarea></div><div data-composer-stats>51 tokens</div></div></div>
  </div></div></div>`
  const frame = document.querySelector<HTMLElement>('[data-mobile-frame]')!
  const root = document.querySelector<HTMLElement>('[data-phase]')!
  const seat = document.querySelector<HTMLElement>('[data-mobile-context-seat]')!
  root.getBoundingClientRect = () => ({ bottom: 800 } as DOMRect)
  seat.getBoundingClientRect = () => ({ bottom: 620 } as DOMRect)
  const surface = new MobileSurface(document); instances.push(surface)
  return { frame, root, surface }
}
it('positions existing header controls without moving or rebinding them; statistics and drafts survive', () => {
  const { frame, root, surface } = fixture()
  const original = frame.innerHTML
  const button = document.getElementById('plugin-action')!, owner = button.parentElement, action = vi.fn()
  button.addEventListener('click', action)
  surface.sync(frame)
  expect(root.style.getPropertyValue('--mobile-context-bottom')).toBe('180px')
  expect(document.querySelectorAll('[data-mobile-context-row]')).toHaveLength(1)
  expect(document.querySelectorAll('[data-mobile-desktop-launch]')).toHaveLength(1)
  expect(document.querySelector('[data-composer-stats]')!.textContent).toBe('51 tokens')
  expect(button.parentElement).toBe(owner)
  button.click(); expect(action).toHaveBeenCalledOnce()
  surface.dispose()
  // Empty style attribute is harmless; all actual styles and owned marks are released.
  root.removeAttribute('style')
  expect(frame.innerHTML).toBe(original)
})
it('keeps an already selected trajectory reachable and preserves unrelated view tabs', () => {
  const { frame, surface } = fixture()
  const tabs = document.querySelector('[role="tablist"]')!, trajectory = tabs.lastElementChild!
  trajectory.setAttribute('aria-selected', 'true'); surface.sync(frame)
  expect(document.querySelector('[data-mobile-hidden-tab]')).toBeNull()
  trajectory.setAttribute('aria-selected', 'false')
  tabs.insertAdjacentHTML('beforeend', '<button role="tab">Plugin view</button>')
  surface.sync(frame)
  expect(trajectory.hasAttribute('data-mobile-hidden-tab')).toBe(true)
  expect(tabs.hasAttribute('data-mobile-hidden-tab')).toBe(false)
  expect(tabs.lastElementChild!.hasAttribute('data-mobile-hidden-tab')).toBe(false)
})
it('falls back for ancestor navigation, unknown frames and removed context seats', () => {
  const { frame, root, surface } = fixture()
  document.querySelector('nav')!.insertAdjacentHTML('afterbegin', '<span><button>Parent</button></span>')
  surface.sync(frame)
  expect(root.hasAttribute('data-mobile-context-layout')).toBe(false)
  document.querySelector('nav > span')!.remove(); surface.sync(frame)
  expect(root.hasAttribute('data-mobile-context-layout')).toBe(true)
  document.querySelector('[data-mobile-context-seat]')!.remove(); surface.sync(frame)
  expect(root.hasAttribute('data-mobile-context-layout')).toBe(false)
  surface.sync(undefined)
  expect(document.querySelector('[data-mobile-hidden-tab]')).toBeNull()
  expect(document.querySelector('textarea')!.value).toBe('Unsent draft')
})
