// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { ComposerActions } from '../src/client/composerActions.ts'
let controller: ComposerActions | undefined
afterEach(() => { controller?.dispose(); document.body.innerHTML = '' })
function fixture() {
  document.body.innerHTML = `<div data-composer-card><div contenteditable>Unsent draft</div><div><div><button aria-haspopup="listbox" aria-label="Commands"></button><button aria-label="Attachment"></button><input type="file" hidden><div><span><button aria-label="Access"><span aria-hidden><svg/></span><span>Workspace write</span><span aria-hidden><svg/></span></button><div role="menu">Official permission menu</div></span><div data-slot="conversation.input.plan"><button>Plugin control</button></div></div><span data-seat></span></div><div><button>Send</button></div></div></div>`
  controller = new ComposerActions(document.querySelector('[data-seat]')!)
  return controller
}
it('uses original callbacks, keeps permission owners mounted and preserves draft on disposal', () => {
  const actions = fixture(), targets = actions.getSnapshot(), callback = vi.fn()
  targets.permissions!.button.addEventListener('click', callback)
  const owner = targets.permissions!.button.parentElement
  expect(actions.invoke('permissions')).toBe(true); expect(callback).toHaveBeenCalledOnce()
  expect(targets.permissions!.button.parentElement).toBe(owner)
  expect(document.querySelector('[role=menu]')?.hasAttribute('data-mobile-folded-action')).toBe(false)
  expect(document.querySelector('[data-slot] button')?.hasAttribute('data-mobile-folded-action')).toBe(false)
  expect(document.querySelectorAll('[data-mobile-folded-action]')).toHaveLength(3)
  actions.dispose(); expect(document.querySelector('[data-mobile-folded-action]')).toBeNull()
  expect(document.querySelector('[contenteditable]')!.textContent).toBe('Unsent draft')
})
it('rechecks disabled state synchronously and mirrors permission text changes', async () => {
  const actions = fixture(), target = actions.getSnapshot().attachments!.button, click = vi.fn()
  target.addEventListener('click', click); target.disabled = true
  expect(actions.invoke('attachments')).toBe(false); expect(click).not.toHaveBeenCalled()
  target.disabled = false; expect(actions.invoke('attachments')).toBe(true); expect(click).toHaveBeenCalledOnce()
  actions.getSnapshot().permissions!.button.querySelector('span:not([aria-hidden])')!.textContent = 'Read only'
  await vi.waitFor(() => expect(actions.getSnapshot().permissions!.label).toBe('Read only'))
})
it('releases controls and refuses stale callbacks when the official structure disappears', () => {
  const actions = fixture(), original = actions.getSnapshot().commands!.button, click = vi.fn()
  original.addEventListener('click', click)
  document.querySelector('input[type=file]')!.remove()
  expect(actions.invoke('commands')).toBe(false); expect(click).not.toHaveBeenCalled()
  expect(original.hasAttribute('data-mobile-folded-action')).toBe(false)
  expect(actions.getSnapshot()).toEqual({})
})
it('focuses the existing editor only for an explicit command choice, keeping its keyboard handler active', () => {
  const actions = fixture(), editor = document.querySelector<HTMLElement>('[contenteditable]')!
  editor.setAttribute('contenteditable', 'true')
  const focus = vi.spyOn(editor, 'focus')
  actions.invoke('permissions'); expect(focus).not.toHaveBeenCalled()
  actions.invoke('commands'); expect(focus).toHaveBeenCalledWith({ preventScroll: true })
})
it('adapts the unified add button and keeps attachment admission aligned with the editable owner', async () => {
  fixture(); controller!.dispose()
  document.querySelector('[aria-label=Attachment]')!.remove()
  const editor = document.querySelector('[contenteditable]')!
  editor.setAttribute('contenteditable', 'true')
  const actions = controller = new ComposerActions(document.querySelector('[data-seat]')!)
  const file = document.querySelector<HTMLInputElement>('input[type=file]')!, pick = vi.fn()
  file.addEventListener('click', pick)
  expect(actions.getSnapshot().attachments!.button).toBe(file)
  expect(document.querySelectorAll('[data-mobile-folded-action]')).toHaveLength(2)
  expect(actions.invoke('attachments')).toBe(true); expect(pick).toHaveBeenCalledOnce()
  editor.setAttribute('contenteditable', 'false')
  await vi.waitFor(() => expect(actions.getSnapshot().attachments!.disabled).toBe(true))
  expect(actions.invoke('attachments')).toBe(false)
  editor.setAttribute('contenteditable', 'true'); file.disabled = true
  expect(actions.invoke('attachments')).toBe(false)
  file.disabled = false
  ;(actions.getSnapshot().commands!.button as HTMLButtonElement).disabled = true
  expect(actions.invoke('attachments')).toBe(false); expect(pick).toHaveBeenCalledOnce()
})
