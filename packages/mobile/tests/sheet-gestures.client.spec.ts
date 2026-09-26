// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { installSheetGestures } from '../src/client/sheetGestures.ts'
let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); document.body.innerHTML = ''; document.documentElement.removeAttribute('data-dsh-mobile') })
function setup() {
  document.documentElement.setAttribute('data-dsh-mobile', '')
  document.body.innerHTML = '<div data-mobile-room-overlay><div data-mobile-room-form><h2>Invite</h2><input><p>Form body</p><details><summary>Model</summary></details></div></div>'
  const overlay = document.querySelector<HTMLElement>('[data-mobile-room-overlay]')!, sheet = overlay.firstElementChild as HTMLElement
  const close = vi.fn(); overlay.addEventListener('mousedown', e => { if (e.target === overlay) close() })
  dispose = installSheetGestures(document)
  return { overlay, sheet, close }
}
function swipe(target: Element, y = 20, end = 120) {
  fireEvent.touchStart(target, { touches: [{ clientX: 30, clientY: y }] })
  fireEvent.touchMove(target, { touches: [{ clientX: 32, clientY: end }] })
  fireEvent.touchEnd(target, { changedTouches: [{ clientX: 32, clientY: end }] })
}
it('dismisses from the header or an outside tap through the original owner', () => {
  const { overlay, sheet, close } = setup()
  swipe(sheet.querySelector('h2')!); expect(close).toHaveBeenCalledOnce(); expect(sheet.style.transform).toBe('')
  swipe(overlay, 10, 10); expect(close).toHaveBeenCalledTimes(2)
})
it('leaves form scrolling, inputs, short drags and desktop behavior alone', () => {
  const { sheet, close } = setup()
  swipe(sheet.querySelector('p')!, 150, 260); swipe(sheet.querySelector('input')!); swipe(sheet.querySelector('summary')!)
  swipe(sheet.querySelector('h2')!, 20, 45)
  sheet.scrollTop = 50; swipe(sheet.querySelector('h2')!)
  sheet.scrollTop = 0; document.documentElement.removeAttribute('data-dsh-mobile'); swipe(sheet.querySelector('h2')!)
  expect(close).not.toHaveBeenCalled()
})
it('restores drag styles on cancellation and removes handlers on disposal', () => {
  const { sheet, close } = setup(), title = sheet.querySelector('h2')!
  fireEvent.touchStart(title, { touches: [{ clientX: 30, clientY: 20 }] })
  fireEvent.touchMove(title, { touches: [{ clientX: 30, clientY: 60 }] })
  expect(sheet.style.transform).toContain('40px')
  fireEvent.touchCancel(title); expect(sheet.style.transform).toBe('')
  dispose?.(); swipe(title); expect(close).not.toHaveBeenCalled()
})
it('closes the native tools sheet only from its header or backdrop, preserving body interactions', () => {
  document.documentElement.setAttribute('data-dsh-mobile', '')
  document.body.innerHTML = '<dialog open data-mobile-tools-dialog><header><strong>Tools</strong><button>Close</button></header><div><button>Attachment</button></div></dialog>'
  const sheet = document.querySelector('dialog')!, close = vi.fn()
  sheet.close = close
  sheet.getBoundingClientRect = () => ({ top: 200, bottom: 600, left: 0, right: 393 } as DOMRect)
  dispose = installSheetGestures(document)
  swipe(sheet.querySelector('strong')!, 220, 320); expect(close).toHaveBeenCalledOnce()
  swipe(sheet, 100, 100); expect(close).toHaveBeenCalledTimes(2)
  swipe(sheet, 400, 500); swipe(sheet.querySelector('button')!, 220, 320)
  swipe(sheet.querySelector('strong')!, 220, 245)
  expect(close).toHaveBeenCalledTimes(2)
})
