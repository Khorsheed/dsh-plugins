// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MobileQueue } from '../src/client/MobileQueue.tsx'
import { en } from '../src/client/locales.ts'
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  document.documentElement.setAttribute('data-dsh-mobile', '')
  document.body.innerHTML = '<div data-mobile-frame><div data-composer-seat><div data-chain-overlay-fallback="conversation.composer" style="display:none"></div><div data-testid="room-queue-strip">Host queue preview</div></div></div>'
})
afterEach(() => { cleanup(); document.body.innerHTML = ''; document.documentElement.removeAttribute('data-dsh-mobile') })
it('sends the selected queue occurrence through official steer, retaining it until host acknowledgement', async () => {
  const updateQueue = vi.fn().mockResolvedValue(undefined)
  const snapshot = { queue: [{ id: 'q-1', placement: 'queued', text: 'Do next', content: [{ type: 'text', text: 'Do next' }] }], running: true, subagent: null, pendingSubmissions: [] }
  render(<MobileQueue {...({ useSession: (select: (s: unknown) => unknown) => select(snapshot), updateQueue, t: (key: keyof typeof en) => en[key] } as any)}/>)
  fireEvent.click(await screen.findByRole('button', { name: /Queued messages/ }))
  fireEvent.click(screen.getByRole('button', { name: en.sendNow }))
  await waitFor(() => expect(updateQueue).toHaveBeenCalledExactlyOnceWith('q-1', { kind: 'steer' }))
  expect(snapshot.queue).toHaveLength(1); expect(screen.getByText('Do next')).toBeTruthy()
})
it('keeps the original Room preview when the mutation service is missing', async () => {
  render(<MobileQueue {...({ useSession: (select: (s: unknown) => unknown) => select({ queue: [], running: false, subagent: null, pendingSubmissions: [] }), t: (key: keyof typeof en) => en[key] } as any)}/>)
  expect(screen.getByText('Host queue preview')).toBeTruthy()
  expect(screen.queryByRole('button', { name: en.sendNow })).toBeNull()
})
it('counts pending submissions once their request id is admitted and leaves unsupported rows uneditable', async () => {
  const updateQueue = vi.fn()
  const snapshot = { queue: [{ id: 'q-1', rpcId: 'request-1', placement: 'queued', text: null, content: [{ type: 'image', attachment: { attachmentId: 'image-1' } }] }], running: true, subagent: null, pendingSubmissions: [{ requestId: 'request-1', placement: 'queued' }, { requestId: 'request-2', placement: 'queued' }] }
  render(<MobileQueue {...({ useSession: (select: (s: unknown) => unknown) => select(snapshot), updateQueue, t: (key: keyof typeof en) => en[key] } as any)}/>)
  fireEvent.click(await screen.findByRole('button', { name: 'Queued messages · 2' }))
  expect(screen.getByRole('button', { name: en.editQueued }).disabled).toBe(true)
  expect(screen.getByRole('status').textContent).toBe(en.sendingQueued)
  expect(updateQueue).not.toHaveBeenCalled()
})
it('closes an edit when the authoritative queue row disappears', async () => {
  const snapshot = { queue: [{ id: 'q-1', placement: 'queued', text: 'First', content: [{ type: 'text', text: 'First' }] }], running: true, subagent: null, pendingSubmissions: [] }
  const props = { useSession: (select: (s: unknown) => unknown) => select(snapshot), updateQueue: vi.fn(), t: (key: keyof typeof en) => en[key] } as any
  const view = render(<MobileQueue {...props}/>); fireEvent.click(await screen.findByRole('button', { name: /Queued messages/ })); fireEvent.click(screen.getByRole('button', { name: en.editQueued }))
  expect(screen.getByRole('textbox')).toBeTruthy(); snapshot.queue = []; view.rerender(<MobileQueue {...props}/>);
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull()); expect(props.updateQueue).not.toHaveBeenCalled()
})
