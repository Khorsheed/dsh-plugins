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
  surface.sync(frame); expect(surface.getSnapshot()).toBe('Standard')
  expect(document.querySelector('nav')!.hasAttribute('data-mobile-header-hidden')).toBe(false)
  expect(document.querySelector('[data-test-row]')!.hasAttribute('data-mobile-header-hidden')).toBe(false)
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
it('restyles only the checked Room form and restores its original nodes on desktop', () => {
  const { frame, surface } = fixture()
  frame.insertAdjacentHTML('beforeend', '<div role="presentation"><div role="dialog" aria-modal="true"><div data-member="ada"></div><details><input readonly /></details><button aria-label="Random name">Dice</button></div></div><div role="dialog" aria-modal="true"><input /></div>')
  const original = frame.innerHTML
  surface.sync(frame)
  expect(frame.querySelectorAll('[data-mobile-room-form]')).toHaveLength(1)
  expect(frame.querySelectorAll('[data-mobile-room-overlay]')).toHaveLength(1)
  surface.dispose(); expect(frame.innerHTML).toBe(original)
})

it('uses the same header adaptation for Rooms while preserving membership and plugin actions', () => {
  const { frame, surface } = fixture()
  document.querySelector('[data-slot="conversation.session.header.lineage"]')!.innerHTML = '<button>Room parent</button>'
  document.querySelector('[data-slot="conversation.session.header.actions"]')!.insertAdjacentHTML('beforeend', '<button data-room-members>Agent Team</button><button data-git-branch>main</button>')
  surface.sync(frame)
  expect(surface.getSnapshot()).toBe('Standard')
  expect(document.querySelector('img')!.closest('[data-mobile-header-hidden]')).not.toBeNull()
  expect(document.querySelector('[aria-label="More actions"]')!.hasAttribute('data-mobile-header-hidden')).toBe(true)
  for (const selector of ['[data-room-members]', '[data-git-branch]', 'nav']) expect(document.querySelector(selector)!.closest('[data-mobile-header-hidden]')).toBeNull()
})

it('compacts the current title without replacing the live catalog or ancestor navigation', () => {
  const { frame, surface } = fixture()
  const nav = document.querySelector('nav')!
  nav.insertAdjacentHTML('afterbegin', '<span><button data-parent>Parent</button></span>')
  const slot = document.querySelector('[data-slot="conversation.session.header.lineage"]')!
  slot.innerHTML = '<div><span>/</span><button aria-haspopup="tree" aria-expanded="false"><span>1 个子代理</span></button></div>'
  const original = frame.innerHTML
  const count = slot.querySelector('button')!, parent = nav.querySelector<HTMLButtonElement>('[data-parent]')!
  const open = vi.fn(), back = vi.fn()
  count.addEventListener('click', open); parent.addEventListener('click', back)
  surface.sync(frame)
  expect(nav.querySelector('button:disabled')!.hasAttribute('data-mobile-header-hidden')).toBe(true)
  expect(count.previousElementSibling!.hasAttribute('data-mobile-header-hidden')).toBe(true)
  expect(count.hasAttribute('data-mobile-lineage-count')).toBe(true)
  expect(parent.closest('[data-mobile-header-hidden]')).toBeNull()
  count.querySelector('span')!.textContent = '12 个子代理'; surface.sync(frame)
  expect(count.textContent).toBe('12 个子代理')
  count.click(); parent.click(); expect(open).toHaveBeenCalledOnce(); expect(back).toHaveBeenCalledOnce()
  count.querySelector('span')!.textContent = '1 个子代理'
  surface.dispose(); expect(frame.innerHTML).toBe(original)
})
it('leaves unknown lineage shapes and interactive subagent switchers unchanged', () => {
  const { frame, surface } = fixture()
  const slot = document.querySelector('[data-slot="conversation.session.header.lineage"]')!
  slot.innerHTML = '<div><button aria-haspopup="tree">Child title</button></div>'
  surface.sync(frame)
  expect(document.querySelector('nav [data-mobile-header-hidden]')).toBeNull()
  expect(document.querySelector('[data-mobile-lineage-count]')).toBeNull()
})

it('compacts the 0.1.7 text crumb without relying on Agent Team being present', () => {
  const { frame, surface } = fixture()
  const title = document.querySelector('nav button:disabled')!
  const plain = document.createElement('span'); plain.textContent = title.textContent
  title.replaceWith(plain)
  surface.sync(frame)
  expect(document.querySelector('[data-test-row]')!.hasAttribute('data-mobile-header-hidden')).toBe(true)
  const slot = document.querySelector('[data-slot="conversation.session.header.lineage"]')!
  slot.innerHTML = '<div><span>/</span><button aria-haspopup="tree">2 个子代理</button></div>'
  surface.sync(frame)
  expect(plain.hasAttribute('data-mobile-header-hidden')).toBe(true)
  expect(slot.querySelector('button')!.hasAttribute('data-mobile-lineage-count')).toBe(true)
})
it('does not hide invitation just because a tools launcher exists; requires a real member shortcut', () => {
  const { frame, surface } = fixture()
  const actions = document.querySelector('[data-slot="conversation.session.header.actions"]')!
  actions.insertAdjacentHTML('beforeend', '<button aria-label="邀请 agent">＋ 邀请 agent</button>')
  document.body.insertAdjacentHTML('beforeend', '<button data-mobile-tools-open>+</button>')
  const invite = actions.querySelector('button')!
  surface.sync(frame); expect(invite.hasAttribute('data-mobile-header-hidden')).toBe(false)
  document.body.insertAdjacentHTML('beforeend', '<button data-mobile-members-open>Members</button>')
  surface.sync(frame); expect(invite.hasAttribute('data-mobile-header-hidden')).toBe(true)
})
it('reads the current host preset artwork and hides directory launch controls without relying on image URLs', () => {
  const { frame, surface } = fixture()
  document.querySelector('[title="Preset description"]')!.innerHTML = '<svg><path d="M6.51867 12.3282C7 12 8 12 9 12"/></svg>开发模式'
  const utilities = document.querySelector('[data-slot="conversation.session.header.utilities"]')!
  utilities.insertAdjacentHTML('beforeend', '<div data-open-target="directory"><button aria-label="Finder"><img src="data:image/png;base64,x"></button><button aria-haspopup="menu">More ways to open</button></div><button data-unrelated>Other</button>')
  surface.sync(frame)
  expect(surface.getSnapshot()).toBe('开发模式')
  expect(document.querySelector('[data-open-target="directory"]')!.hasAttribute('data-mobile-header-hidden')).toBe(true)
  expect(document.querySelector('[data-unrelated]')!.closest('[data-mobile-header-hidden]')).toBeNull()
  surface.dispose(); expect(document.querySelector('[data-open-target="directory"]')!.hasAttribute('data-mobile-header-hidden')).toBe(false)
})
