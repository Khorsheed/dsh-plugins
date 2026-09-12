// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { installNavigationGestures, navigationSwipe } from '../src/client/gestures.ts'
afterEach(() => { document.body.innerHTML = '' })
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
