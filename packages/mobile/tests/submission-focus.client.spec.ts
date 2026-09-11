// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { SubmissionFocus, acceptedMessages } from '../src/client/SubmissionFocus.tsx'
let controller: SubmissionFocus
afterEach(() => { controller?.dispose(); document.body.innerHTML = ''; document.documentElement.removeAttribute('data-dsh-mobile'); vi.unstubAllGlobals() })
function fixture() {
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => fn())
  document.documentElement.setAttribute('data-dsh-mobile', '')
  document.body.innerHTML = '<div data-composer-seat><textarea></textarea><button aria-label="发送">Send</button></div>'
  controller = new SubmissionFocus(document)
  controller.update([{ id: 'message:1', text: 'old' }])
  const editor = document.querySelector('textarea')!; editor.value = 'hello'; editor.focus()
  return { editor, send: () => document.querySelector('button')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })) }
}
it('dismisses only after the matching message or queue admission, without changing draft', () => {
  const { editor, send } = fixture(); send(); editor.value = ''
  controller.update([{ id: 'message:1', text: 'old' }]); expect(document.activeElement).toBe(editor)
  controller.update([{ id: 'queue:2', text: 'hello' }]); expect(document.activeElement).not.toBe(editor)
  expect(editor.value).toBe('')
})
it('keeps keyboard for rejected sends, another device and newly entered text', () => {
  const { editor, send } = fixture(); send()
  controller.update([{ id: 'message:3', text: 'remote' }]); expect(document.activeElement).toBe(editor)
  editor.value = 'next draft'
  controller.update([{ id: 'message:4', text: 'hello' }]); expect(document.activeElement).toBe(editor)
  expect(editor.value).toBe('next draft')
})
it('ignores history without send intent, IME Enter, desktop and unmounted observers', () => {
  const { editor, send } = fixture()
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
  controller.update([{ id: 'message:2', text: 'hello' }]); expect(document.activeElement).toBe(editor)
  document.documentElement.removeAttribute('data-dsh-mobile'); send(); editor.value = ''
  controller.update([{ id: 'message:3', text: 'hello' }]); expect(document.activeElement).toBe(editor)
  controller.dispose()
})
it('accepts only durable user/steering records, excluding optimistic echoes and assistant text', () => {
  expect(acceptedMessages({ nodes: { values: () => [
    { kind: 'user', seq: 2, content: [{ type: 'text', text: 'yes' }] },
    { kind: 'assistant', seq: 3, content: [{ type: 'text', text: 'no' }] },
    { kind: 'user', content: [{ type: 'text', text: 'pending' }] },
  ] } })).toEqual([{ id: 'message:2', text: 'yes' }])
})
