// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { MobileViewport } from '../src/client/viewport.ts'
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML=''; delete window.webkit })
it('reserves the live official seat height, observes growth and releases geometry on unmount', () => {
  let resize = () => {}; const disconnect=vi.fn(), observe=vi.fn()
  vi.stubGlobal('ResizeObserver',class {constructor(fn: () => void){resize=fn} observe=observe; disconnect=disconnect})
  document.body.innerHTML='<div data-mobile-frame><div data-slot="main.conversation"><div data-phase="active"><div data-composer-seat><textarea>Draft</textarea></div></div></div></div>'
  const frame=document.querySelector<HTMLElement>('[data-mobile-frame]')!,root=document.querySelector<HTMLElement>('[data-phase]')!,seat=document.querySelector<HTMLElement>('[data-composer-seat]')!
  let height=180;vi.spyOn(seat,'getBoundingClientRect').mockImplementation(()=>({height}) as DOMRect)
  const v=new MobileViewport(window);v.sync(frame)
  expect(root.style.getPropertyValue('--mobile-composer-height')).toBe('180px');expect(observe).toHaveBeenCalledWith(seat)
  height=250;resize();expect(root.style.getPropertyValue('--mobile-composer-height')).toBe('250px')
  v.sync(undefined);expect(root.style.getPropertyValue('--mobile-composer-height')).toBe('')
  expect(document.querySelector('textarea')?.value).toBe('Draft');v.dispose();expect(disconnect).toHaveBeenCalled()
})
