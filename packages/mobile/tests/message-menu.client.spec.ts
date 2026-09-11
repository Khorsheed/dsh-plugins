// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { MessageMenu } from '../src/client/messageMenu.ts'
let menu: MessageMenu
afterEach(() => { menu?.dispose(); document.body.innerHTML = ''; document.documentElement.removeAttribute('data-dsh-mobile') })
it('invokes the original message-tools action exactly once, leaving confirmation to its owner', () => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  document.documentElement.setAttribute('data-dsh-mobile', '')
  document.body.innerHTML = '<div data-conversation-scroll><div data-time-hover-root><div><p>Message</p></div><div><button aria-label="复制">Copy</button><button aria-label="编辑">Edit</button><button aria-label="撤回" disabled>Withdraw</button></div></div></div>'
  const action = vi.fn(), original = document.querySelectorAll('button')[1]!, row = original.parentElement
  original.addEventListener('click', action); menu = new MessageMenu(document)
  document.querySelector('p')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  const dialog = document.querySelector('dialog')!
  expect(dialog.querySelectorAll('button')).toHaveLength(3); expect(dialog.querySelectorAll('button')[2]!.disabled).toBe(true)
  dialog.querySelectorAll('button')[1]!.click(); expect(action).toHaveBeenCalledOnce(); expect(original.parentElement).toBe(row)
  expect(document.querySelector('dialog')).toBeNull()
})
it('leaves unknown messages and desktop context menus intact', () => {
  document.body.innerHTML = '<div data-conversation-scroll><div data-time-hover-root><p>Unknown</p><div><button aria-label="Run tool">Run</button></div></div></div>'
  menu = new MessageMenu(document)
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.querySelector('p')!.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false); expect(document.querySelector('dialog')).toBeNull()
})
it('uses the matching assistant turn actions without borrowing user edit or withdraw', () => {
  document.documentElement.setAttribute('data-dsh-mobile', '')
  document.body.innerHTML = '<div data-conversation-scroll><div data-chat-flow-kind="assistant-step" data-chat-turn="2"><p>Answer</p></div><div data-turn-tail="1"><button aria-label="复制">Wrong turn</button></div><div data-turn-tail="2"><div><button aria-label="复制">Copy</button><div><button aria-label="好的回答">Like</button></div><button aria-label="在新对话中分支">Branch</button></div></div></div>'
  const action = vi.fn(); document.querySelector('[data-turn-tail="2"] button')!.addEventListener('click', action)
  menu = new MessageMenu(document); document.querySelector('p')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  const dialog = document.querySelector('dialog')!
  expect([...dialog.querySelectorAll('button')].map(b => b.textContent)).toEqual(['复制', '好的回答', '在新对话中分支'])
  dialog.querySelector('button')!.click(); expect(action).toHaveBeenCalledOnce()
})
