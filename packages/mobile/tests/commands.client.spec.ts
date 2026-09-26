// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { openMobileCommands } from '../src/client/commands.ts'
it('opens the official source with the captured insertion revision without focusing or editing the draft', () => {
  document.body.innerHTML = '<div contenteditable="true">Unsent draft</div>'
  const editor = document.querySelector<HTMLElement>('[contenteditable]')!, focus = vi.spyOn(editor, 'focus')
  const toggleSource = vi.fn(), span = { start: 4, end: 4, draftRev: 7 }
  expect(openMobileCommands({ toggleSource }, 'text', span)).toBe(true)
  expect(toggleSource).toHaveBeenCalledWith('command', { trigger: '/', query: '', quoted: false, position: 'inline', span })
  expect(editor.textContent).toBe('Unsent draft'); expect(focus).not.toHaveBeenCalled()
  openMobileCommands({ toggleSource }, '   ', { ...span, start: 0, end: 0 })
  expect(toggleSource.mock.lastCall![1].position).toBe('leading')
  expect(openMobileCommands(undefined, '', span)).toBe(false)
  document.body.innerHTML = ''
})
