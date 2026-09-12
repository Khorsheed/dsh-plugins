// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { MobilePickers } from '../src/client/pickers.ts'
let pickers: MobilePickers | undefined
afterEach(() => { pickers?.dispose(); document.body.innerHTML = ''; document.documentElement.removeAttribute('data-dsh-mobile') })
it('adapts a portaled preset menu without replacing its choices or selection callback', () => {
  document.documentElement.setAttribute('data-dsh-mobile','')
  document.body.innerHTML = '<span data-slot="conversation.hero.agentPreset"><button aria-haspopup="menu">Mode</button></span>'
  const trigger = document.querySelector('button')!, selected = vi.fn()
  pickers = new MobilePickers(document)
  trigger.addEventListener('click', () => {
    const current = document.querySelector('[role=menu]')
    if(current) { current.remove(); return }
    const menu = document.createElement('div'); menu.setAttribute('role','menu')
    const item = document.createElement('button'); item.setAttribute('role','menuitem'); item.textContent='Preset'; item.onclick=selected; menu.append(item); document.body.append(menu)
  })
  trigger.click(); pickers.sync(true)
  const item = document.querySelector<HTMLButtonElement>('[role=menuitem]')!
  expect(document.querySelector('[data-mobile-picker=preset]')).not.toBeNull()
  item.click(); expect(selected).toHaveBeenCalledOnce()
  document.querySelector<HTMLButtonElement>('[data-mobile-picker-chrome] button')!.click(); pickers.sync(true)
  expect(document.querySelector('[data-mobile-picker-shade]')).toBeNull()
  trigger.click(); pickers.sync(true); pickers.dispose()
  expect(document.querySelector('[role=menuitem]')).not.toBeNull()
  expect(document.querySelector('[data-mobile-picker-chrome]')).toBeNull()
})
it('does not capture unrelated menus or a menu opened on desktop', () => {
  document.body.innerHTML='<button aria-haspopup="menu">Other</button><div role="menu"><button role="menuitem">Action</button></div>'
  pickers = new MobilePickers(document); document.querySelector('button')!.click(); pickers.sync(false)
  expect(document.querySelector('[data-mobile-picker]')).toBeNull()
})
it('separates nested preset options without depending on menu wrappers or changing actions', () => {
  document.documentElement.setAttribute('data-dsh-mobile','')
  document.body.innerHTML = '<div data-slot="conversation.hero.agentPreset"><button aria-haspopup="menu">Mode</button></div>'
  const trigger = document.querySelector('button')!, action = vi.fn()
  pickers = new MobilePickers(document); trigger.click()
  document.body.insertAdjacentHTML('beforeend','<div role="menu"><div><div role="menuitem">One</div></div><div><div role="menuitem">Two</div></div></div>')
  const second = document.querySelectorAll<HTMLElement>('[role=menuitem]')[1]!
  second.addEventListener('click',action); pickers.sync(true)
  expect(second.hasAttribute('data-mobile-picker-divider')).toBe(true)
  expect(document.querySelector('[role=menuitem]')!.hasAttribute('data-mobile-picker-divider')).toBe(false)
  second.click(); expect(action).toHaveBeenCalledOnce()
  pickers.sync(false); expect(second.hasAttribute('data-mobile-picker-divider')).toBe(false)
})
