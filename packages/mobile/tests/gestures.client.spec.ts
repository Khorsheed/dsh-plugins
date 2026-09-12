// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { installNavigationGestures, navigationSwipe } from '../src/client/gestures.ts'
beforeEach(() => { vi.stubGlobal('innerWidth',393) })
afterEach(() => { document.body.innerHTML = ''; document.documentElement.removeAttribute('data-mobile-library-open'); vi.unstubAllGlobals() })
it('requires a deliberate horizontal swipe and leaves vertical and short motion alone', () => {
  expect(navigationSwipe(90, 8, 393)).toBe('open')
  expect(navigationSwipe(-100, 8, 393)).toBe('close')
  expect(navigationSwipe(30, 2, 393)).toBeUndefined()
  expect(navigationSwipe(90, 100, 393)).toBeUndefined()
})
it('preserves controls, text selection and modal gestures and releases listeners', () => {
  document.body.innerHTML = '<main><p>Chat</p><textarea>Draft</textarea><pre>Code</pre></main>'
  const change = vi.fn(), dispose = installNavigationGestures(document, change)
  const swipe = (node: Element) => {
    fireEvent.touchStart(node, { touches: [{ clientX: 30, clientY: 100 }] })
    fireEvent.touchMove(node, { touches: [{ clientX: 140, clientY: 106 }] })
    fireEvent.touchEnd(node, { changedTouches: [{ clientX: 140, clientY: 106 }] })
  }
  swipe(document.querySelector('textarea')!); swipe(document.querySelector('pre')!); expect(change).not.toHaveBeenCalled()
  swipe(document.querySelector('p')!); expect(change).toHaveBeenLastCalledWith(true)
  document.body.insertAdjacentHTML('beforeend','<dialog open>Modal</dialog>')
  swipe(document.querySelector('p')!); expect(change).toHaveBeenCalledTimes(1)
  document.querySelector('dialog')!.remove(); dispose(); swipe(document.querySelector('p')!); expect(change).toHaveBeenCalledTimes(1)
})

it('closes from a list button or the preview, consumes the following tap and cancels vertical or multi-touch drags', () => {
  document.body.innerHTML = '<button data-mobile-session>Other conversation</button><button data-mobile-peek-close>Preview</button>'
  document.documentElement.setAttribute('data-mobile-library-open','')
  const change = vi.fn(), open = vi.fn(), dispose = installNavigationGestures(document,change)
  const row = document.querySelector('button')!; row.addEventListener('click',open)
  const drag = (node: Element, x: number, y: number) => {
    fireEvent.touchStart(node,{touches:[{clientX:240,clientY:100}]})
    fireEvent.touchMove(node,{touches:[{clientX:x,clientY:y}]})
    fireEvent.touchEnd(node,{changedTouches:[{clientX:x,clientY:y}]})
  }
  drag(row,100,104); expect(change).toHaveBeenLastCalledWith(false)
  fireEvent.click(row,{detail:1}); expect(open).not.toHaveBeenCalled()
  fireEvent.click(row,{detail:1}); expect(open).toHaveBeenCalledOnce()
  change.mockClear(); drag(row,230,250); expect(change).not.toHaveBeenCalled()
  fireEvent.touchStart(row,{touches:[{clientX:240,clientY:100}]})
  fireEvent.touchMove(row,{touches:[{clientX:120,clientY:100},{clientX:110,clientY:100}]})
  fireEvent.touchEnd(row,{changedTouches:[{clientX:120,clientY:100}]}); expect(change).not.toHaveBeenCalled()
  drag(document.querySelector('[data-mobile-peek-close]')!,100,105); expect(change).toHaveBeenLastCalledWith(false)
  dispose()
})
it('dismisses a right sidebar through its owner toggle and leaves pinned wide layouts alone', () => {
  document.body.innerHTML = '<aside data-sidebar-right-panel="push" data-sidebar-right-open><button data-sidebar-right-toggle>Close</button><p>Preview</p></aside>'
  const owner = vi.fn(), change = vi.fn(), dispose = installNavigationGestures(document,change)
  document.querySelector('button')!.addEventListener('click',owner)
  const swipe = () => {
    const node = document.querySelector('p')!
    fireEvent.touchStart(node,{touches:[{clientX:20,clientY:100}]})
    fireEvent.touchMove(node,{touches:[{clientX:160,clientY:104}]})
    fireEvent.touchEnd(node,{changedTouches:[{clientX:160,clientY:104}]})
  }
  swipe(); expect(owner).toHaveBeenCalledOnce(); expect(change).not.toHaveBeenCalled()
  vi.stubGlobal('innerWidth',1100); swipe(); expect(owner).toHaveBeenCalledOnce()
  dispose()
})
it('closes the Host workspace sidebar through the existing navigation owner', () => {
  document.body.innerHTML = '<aside><div data-slot="sidebar"><button>Workspace</button></div></aside>'
  const close = vi.fn(), change = vi.fn(), dispose = installNavigationGestures(document,change,close)
  const row = document.querySelector('button')!
  fireEvent.touchStart(row,{touches:[{clientX:230,clientY:100}]})
  fireEvent.touchMove(row,{touches:[{clientX:80,clientY:104}]})
  fireEvent.touchEnd(row,{changedTouches:[{clientX:80,clientY:104}]})
  expect(close).toHaveBeenCalledOnce(); expect(change).not.toHaveBeenCalled()
  dispose()
})
