// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SessionRename } from '../src/client/SessionRename.tsx'
import type { NavigationCapabilities } from '../src/client/navigation.ts'
import { en } from '../src/client/locales.ts'
const t = (key: keyof typeof en) => en[key]
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})
afterEach(cleanup)
function fixture() {
  const rename = vi.fn().mockResolvedValue({ ok: true }), close = vi.fn()
  const binding = vi.fn().mockReturnValue({ session: { rename } })
  const navigation = { sessions: { binding } } as unknown as NavigationCapabilities
  render(<SessionRename navigation={navigation} sessionId={'one' as never} title="Automatic title" close={close} t={t}/> )
  return { rename, close, binding }
}
it('confirms an unchanged automatic title through the official binding, allowing Host title pinning', async () => {
  const f = fixture()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
  expect(f.binding).toHaveBeenCalledWith('one')
  expect(f.rename).toHaveBeenCalledExactlyOnceWith('Automatic title')
  expect(f.close).toHaveBeenCalledOnce()
})
it('retains the draft on Host refusal and permits retry without touching the composer', async () => {
  const f = fixture(); f.rename.mockResolvedValueOnce({ ok: false, error: { message: 'Host refusal' } })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '  New title  ' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
  expect(screen.getByRole('alert').textContent).toBe('Host refusal')
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('  New title  ')
  expect(f.close).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
  expect(f.rename).toHaveBeenLastCalledWith('New title'); expect(f.close).toHaveBeenCalledOnce()
})
it('does not submit on cancel or blank input and does not duplicate pending requests', async () => {
  const f = fixture()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '  ' } })
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(f.rename).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Pending' } })
  let resolve!: (value: unknown) => void
  f.rename.mockImplementation(() => new Promise(done => { resolve = done }))
  await act(async () => { fireEvent.submit(screen.getByRole('textbox').closest('form')!); fireEvent.submit(screen.getByRole('textbox').closest('form')!) })
  expect(f.rename).toHaveBeenCalledOnce()
  await act(async () => { resolve({ ok: true }) })
})
