// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { MobileSurface } from '../src/client/surface.ts'
const instances: MobileSurface[] = []
afterEach(() => { instances.splice(0).forEach(x => x.dispose()); document.body.innerHTML = '' })
function fixture() {
  document.body.innerHTML = `<div data-mobile-frame><div data-slot="main.conversation"><div data-phase="active">
  <div data-slot="conversation.session.header"><header><div data-test-row><div><nav><span><button disabled>Title</button><div data-slot="conversation.session.header.lineage"></div></span></nav><div data-slot="conversation.session.header.actions"><span title="Preset description"><svg><mask id="mask0_agent_preset_16"></mask></svg>Standard</span></div></div><div data-slot="conversation.session.header.utilities"><span><div><button><img src="/open-in-app/icon/finder"/></button><button>Apps</button></div></span><span><button aria-label="More actions" aria-haspopup="menu" aria-busy="false">More</button></span></div><div data-conversation-header-corner><button data-sidebar-right-expand>Panel</button></div></div><div role="tablist"><button role="tab" aria-selected="true">对话</button><button role="tab" aria-selected="false">轨迹</button></div></header></div>
  <div data-conversation-scroll><div data-composer-seat><div data-composer-card><textarea>Unsent draft</textarea></div><div data-composer-stats>51 tokens</div></div></div>
  </div></div></div>`
  const frame = document.querySelector<HTMLElement>('[data-mobile-frame]')!
  const surface = new MobileSurface(document); instances.push(surface)
  return { frame, surface }
}
it('projects the real preset label, collapses only known chrome and restores the original DOM', () => {
  const { frame, surface } = fixture(), original = frame.innerHTML
  const listener = vi.fn(); surface.subscribe(listener); surface.sync(frame)
  expect(surface.getSnapshot()).toBe('Standard')
  expect(listener).toHaveBeenCalledOnce()
  expect(document.querySelector('[data-test-row]')!.hasAttribute('data-mobile-header-hidden')).toBe(true)
  surface.sync(frame); expect(listener).toHaveBeenCalledOnce()
  surface.dispose(); expect(frame.innerHTML).toBe(original)
})
it('retains unknown plugin controls, callback ownership and ancestor navigation', () => {
  const { frame, surface } = fixture()
  const actions = document.querySelector('[data-slot="conversation.session.header.actions"]')!
  actions.insertAdjacentHTML('beforeend', '<button id="plugin-action">Plugin action</button>')
  const button = document.getElementById('plugin-action')!, owner = button.parentElement, action = vi.fn()
  button.addEventListener('click', action); surface.sync(frame)
  expect(document.querySelector('[data-test-row]')!.hasAttribute('data-mobile-header-hidden')).toBe(false)
  expect(button.hasAttribute('data-mobile-header-hidden')).toBe(false)
  expect(button.parentElement).toBe(owner); button.click(); expect(action).toHaveBeenCalledOnce()
  document.querySelector('nav')!.insertAdjacentHTML('afterbegin', '<span><button>Parent</button></span>')
  surface.sync(frame); expect(surface.getSnapshot()).toBe('')
  expect(document.querySelector('[data-mobile-header-hidden]')).toBeNull()
  surface.sync(undefined); expect(document.querySelector('[data-mobile-hidden-tab]')).toBeNull()
  expect(document.querySelector('textarea')!.value).toBe('Unsent draft')
})
it('keeps selected trajectory and unrelated views available', () => {
  const { frame, surface } = fixture()
  const tabs = document.querySelector('[role="tablist"]')!, trajectory = tabs.lastElementChild!
  trajectory.setAttribute('aria-selected', 'true'); surface.sync(frame)
  expect(document.querySelector('[data-mobile-hidden-tab]')).toBeNull()
  trajectory.setAttribute('aria-selected', 'false'); tabs.insertAdjacentHTML('beforeend', '<button role="tab">Plugin view</button>'); surface.sync(frame)
  expect(trajectory.hasAttribute('data-mobile-hidden-tab')).toBe(true)
  expect(tabs.hasAttribute('data-mobile-hidden-tab')).toBe(false)
  expect(tabs.lastElementChild!.hasAttribute('data-mobile-hidden-tab')).toBe(false)
})
