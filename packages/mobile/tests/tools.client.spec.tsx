// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Tools } from '../src/client/MobileTools.tsx'
import { ComposerActions } from '../src/client/composerActions.ts'
import { en } from '../src/client/locales.ts'
let actions: ComposerActions | undefined
afterEach(() => { cleanup(); actions?.dispose(); document.body.innerHTML = '' })
it('opens the sheet without launching commands or restoring editor focus when dismissed', () => {
  document.body.innerHTML = '<div data-composer-card><div contenteditable="true" tabindex="0">Unsent draft</div><div><div><button aria-haspopup="listbox">Commands</button><input type="file" hidden><div></div><span data-seat></span></div><div></div></div></div>'
  actions = new ComposerActions(document.querySelector('[data-seat]')!)
  const commands = vi.fn(), file = vi.fn(), openCommands = vi.fn(() => true)
  actions.getSnapshot().commands!.button.addEventListener('click', commands)
  actions.getSnapshot().attachments!.button.addEventListener('click', file)
  render(<Tools actions={actions} openCommands={openCommands} t={key => en[key]} invite={undefined}/> )
  const dialog = document.querySelector('dialog')!, editor = document.querySelector<HTMLElement>('[contenteditable]')!
  let returnFocus: Element | null
  dialog.showModal = () => { returnFocus = document.activeElement; dialog.setAttribute('open', ''); dialog.querySelector('button')!.focus() }
  dialog.close = () => { dialog.removeAttribute('open'); (returnFocus as HTMLElement)?.focus(); dialog.dispatchEvent(new Event('close')) }
  editor.focus()
  fireEvent.click(screen.getByRole('button', { name: en.inputTools }))
  expect(dialog.open).toBe(true); expect(editor).not.toBe(document.activeElement)
  expect(commands).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: en.closeTools }))
  expect(dialog.open).toBe(false); expect(editor).not.toBe(document.activeElement)
  fireEvent.click(screen.getByRole('button', { name: en.inputTools }))
  fireEvent.click(screen.getByRole('button', { name: en.attachments }))
  expect(file).toHaveBeenCalledOnce(); expect(commands).not.toHaveBeenCalled()
  expect(editor.textContent).toBe('Unsent draft'); expect(dialog.open).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: en.inputTools }))
  fireEvent.click(within(dialog).getByRole('button', { name: en.commands, exact: true }))
  expect(openCommands).toHaveBeenCalledOnce(); expect(commands).not.toHaveBeenCalled()
  expect(editor).not.toBe(document.activeElement)
})
